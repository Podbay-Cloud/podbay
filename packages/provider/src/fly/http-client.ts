import { createLogger, type Logger } from "@podbay/shared/log";
import { ProviderError } from "../types.js";
import type {
  CreateMachineInput,
  CreateVolumeInput,
  FlyApi,
  FlyMachine,
  FlyMachineConfig,
  FlyVolume,
} from "./api.js";

type FetchFn = typeof fetch;

/** Real FlyApi over the Fly Machines REST API, with bounded retry on 429/5xx. */
export class FlyHttpClient implements FlyApi {
  private readonly log: Logger;

  constructor(
    private readonly opts: {
      apiToken: string;
      appName: string;
      apiBaseUrl: string;
      fetchImpl?: FetchFn;
      maxRetries?: number;
      logger?: Logger;
    },
  ) {
    this.log = opts.logger ?? createLogger("provider");
  }

  private get fetchImpl(): FetchFn {
    return this.opts.fetchImpl ?? fetch;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.opts.apiBaseUrl}${path}`;
    const max = this.opts.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= max; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.opts.apiToken}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        lastErr = e;
        if (attempt < max) {
          this.log.warn("fly_retry", { method, path, attempt, err: e });
          await delay(attempt);
          continue;
        }
        this.log.error("fly_failed", { method, path, attempt, err: e });
        throw new ProviderError("Fly request failed", "transient", e);
      }
      if (res.status === 404) throw new ProviderError(`not found: ${path}`, "not_found");
      if (res.status === 409) throw new ProviderError(`conflict: ${path}`, "conflict");
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ProviderError(`Fly ${res.status}`, res.status === 429 ? "rate_limited" : "transient");
        if (attempt < max) {
          this.log.warn("fly_retry", { method, path, status: res.status, attempt });
          await delay(attempt);
          continue;
        }
        this.log.error("fly_failed", { method, path, status: res.status, attempt });
        throw lastErr;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.log.error("fly_rejected", { method, path, status: res.status, body: text.slice(0, 200) });
        throw new ProviderError(`Fly ${res.status}: ${text}`, "invalid");
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    throw lastErr instanceof Error ? lastErr : new ProviderError("Fly request failed", "transient");
  }

  private app(path: string): string {
    return `/apps/${this.opts.appName}${path}`;
  }

  listMachines(): Promise<FlyMachine[]> {
    return this.req<FlyMachine[]>("GET", this.app("/machines"));
  }
  async getMachine(id: string): Promise<FlyMachine | null> {
    try {
      return await this.req<FlyMachine>("GET", this.app(`/machines/${id}`));
    } catch (e) {
      if (e instanceof ProviderError && e.code === "not_found") return null;
      throw e;
    }
  }
  createMachine(input: CreateMachineInput): Promise<FlyMachine> {
    return this.req<FlyMachine>("POST", this.app("/machines"), input);
  }
  async suspendMachine(id: string): Promise<void> {
    await this.req("POST", this.app(`/machines/${id}/suspend`));
  }
  async startMachine(id: string): Promise<void> {
    await this.req("POST", this.app(`/machines/${id}/start`));
  }
  async stopMachine(id: string): Promise<void> {
    await this.req("POST", this.app(`/machines/${id}/stop`));
  }
  async destroyMachine(id: string): Promise<void> {
    await this.req("DELETE", this.app(`/machines/${id}?force=true`));
  }
  async updateMachineMetadata(id: string, key: string, value: string): Promise<void> {
    await this.req("POST", this.app(`/machines/${id}/metadata/${key}`), { value });
  }
  updateMachine(id: string, config: FlyMachineConfig): Promise<FlyMachine> {
    // Fly's machine-update endpoint takes the WHOLE config and replaces it — the
    // same call `fly machine update` makes. The volume mount rides in the config,
    // so the pod's data survives (verified live 2026-07-17: ~/work, PLAN.md and
    // the Claude login all persisted across an in-place image swap).
    return this.req<FlyMachine>("POST", this.app(`/machines/${id}`), { config });
  }
  async waitForState(id: string, state: string, timeoutSec = 60): Promise<void> {
    await this.req("GET", this.app(`/machines/${id}/wait?state=${state}&timeout=${timeoutSec}`));
  }
  execMachine(id: string, command: string[]) {
    return this.req<{ exit_code: number; stdout: string; stderr: string }>(
      "POST",
      this.app(`/machines/${id}/exec`),
      { command },
    );
  }
  listVolumes(): Promise<FlyVolume[]> {
    return this.req<FlyVolume[]>("GET", this.app("/volumes"));
  }
  createVolume(input: CreateVolumeInput): Promise<FlyVolume> {
    return this.req<FlyVolume>("POST", this.app("/volumes"), input);
  }
  async destroyVolume(id: string): Promise<void> {
    await this.req("DELETE", this.app(`/volumes/${id}`));
  }
  snapshotVolume(id: string): Promise<{ id: string }> {
    return this.req<{ id: string }>("POST", this.app(`/volumes/${id}/snapshots`));
  }
}

function delay(attempt: number): Promise<void> {
  const ms = Math.min(1000 * 2 ** attempt, 5000);
  return new Promise((r) => setTimeout(r, ms));
}
