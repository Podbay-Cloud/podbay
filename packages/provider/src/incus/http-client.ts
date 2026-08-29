import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";

/**
 * Minimal Incus REST client — only what IncusProvider needs (M1 prep, written
 * ahead of the box; every endpoint is from the Incus REST API docs and must be
 * VERIFIED against a live daemon in M0 before this is wired anywhere).
 *
 * Auth: TLS client certificate over HTTPS (the daemon listens on :8443 on the
 * WireGuard address; our cert is added via `incus config trust add-certificate`).
 * The daemon cert is self-signed — trust = the daemon-side client-cert allowlist
 * plus the private WireGuard transport, not a CA chain.
 *
 * Zero new dependencies: node:https (global fetch can't present client certs).
 * All mutating calls return async operations — waitOp() blocks on them.
 */

export interface IncusClientOptions {
  /** e.g. https://10.77.0.1:8443 (WireGuard address of the box) */
  baseUrl: string;
  /** PEM client certificate + key, trusted by the daemon. */
  clientCertPem: string;
  clientKeyPem: string;
  /** Incus project scoping every request (multi-tenancy isolation). */
  project?: string;
}

export interface IncusInstance {
  name: string;
  status: string; // Running | Stopped | Frozen | Error
  status_code: number;
  config: Record<string, string>;
  devices: Record<string, Record<string, string>>;
}

export interface IncusInstanceState {
  status: string;
  network?: Record<string, { addresses: { family: string; address: string; scope: string }[] }>;
  memory?: { usage?: number };
}

export interface IncusImage {
  fingerprint: string;
  size: number; // bytes
  created_at: string;
  aliases: { name: string; description?: string }[];
}

interface IncusResponse<T> {
  type: "sync" | "async" | "error";
  status_code: number;
  // On an ERROR response Incus sets status_code to 0 and carries the HTTP-ish
  // code in error_code (e.g. 404 for a missing instance). Success responses use
  // status_code. We must read error_code when throwing or 404-tolerance breaks.
  error_code?: number;
  error?: string;
  operation?: string;
  metadata: T;
}

export class IncusApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "IncusApiError";
  }
}

export class IncusApi {
  private readonly project: string;
  private readonly host: string;
  private readonly port: number;

  constructor(private readonly opts: IncusClientOptions) {
    this.project = opts.project ?? "podbay";
    const u = new URL(opts.baseUrl);
    this.host = u.hostname;
    this.port = Number(u.port || 8443);
  }

  private raw(
    method: string,
    path: string,
    body?: Buffer | string,
    headers?: Record<string, string>,
    /** Socket timeout (ms). Without one, a stalled incus daemon leaves the request pending FOREVER —
     * which hung the cockpit's Stats tab on "Loading metrics…" until the user switched tabs to remount
     * (velsa, 2026-08-23). 30s covers every quick call; the long server-side operation WAIT
     * (`/wait?timeout=…`) passes a bigger value from waitOp so it isn't cut off. */
    timeoutMs = 30_000,
  ): Promise<{ status: number; body: Buffer }> {
    const sep = path.includes("?") ? "&" : "?";
    const options: RequestOptions = {
      host: this.host,
      port: this.port,
      path: `${path}${sep}project=${encodeURIComponent(this.project)}`,
      method,
      cert: this.opts.clientCertPem,
      key: this.opts.clientKeyPem,
      rejectUnauthorized: false, // self-signed daemon cert; see class doc
      headers,
    };
    return new Promise((resolve, reject) => {
      const req = httpsRequest(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`incus ${method} ${path}: timed out after ${timeoutMs}ms`)));
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  private async req<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<IncusResponse<T>> {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const { body: buf } = await this.raw(
      method,
      path,
      payload,
      payload !== undefined ? { "content-type": "application/json" } : undefined,
      timeoutMs,
    );
    let json: IncusResponse<T>;
    try {
      json = JSON.parse(buf.toString("utf8")) as IncusResponse<T>;
    } catch {
      throw new IncusApiError(`incus ${method} ${path}: non-JSON response`, 500);
    }
    if (json.type === "error") {
      // Incus puts the code in error_code on errors (status_code is 0 there);
      // fall back to status_code for safety. Getting this wrong silently breaks
      // 404-tolerance in getInstance/instanceState — see IncusResponse.error_code.
      throw new IncusApiError(
        json.error ?? `incus ${method} ${path} failed`,
        json.error_code ?? json.status_code,
      );
    }
    return json;
  }

  /** Block on an async operation (server-side wait endpoint). */
  private async waitOp(operationUrl: string, timeoutSecs = 120): Promise<void> {
    const r = await this.req<{ status: string; err?: string }>(
      "GET",
      `${operationUrl}/wait?timeout=${timeoutSecs}`,
      undefined,
      // This request BLOCKS server-side for up to timeoutSecs, so the socket timeout must outlast it
      // (30s slack) — otherwise a legitimately-long stop/create operation would be cut off.
      (timeoutSecs + 30) * 1000,
    );
    if (r.metadata?.status !== "Success") {
      throw new IncusApiError(r.metadata?.err ?? "operation failed", 500);
    }
  }

  private async doAsync(method: string, path: string, body?: unknown, timeoutSecs?: number): Promise<void> {
    const r = await this.req<unknown>(method, path, body);
    if (r.type === "async" && r.operation) await this.waitOp(r.operation, timeoutSecs);
  }

  // --- instances ---

  async createInstance(spec: {
    name: string;
    imageAlias: string;
    config: Record<string, string>;
    devices: Record<string, Record<string, string>>;
  }): Promise<void> {
    await this.doAsync(
      "POST",
      "/1.0/instances",
      {
        name: spec.name,
        type: "virtual-machine",
        source: { type: "image", alias: spec.imageAlias },
        config: spec.config,
        devices: spec.devices,
      },
      600, // first create may unpack the image
    );
  }

  async getInstance(name: string): Promise<IncusInstance | null> {
    try {
      return (await this.req<IncusInstance>("GET", `/1.0/instances/${name}`)).metadata;
    } catch (e) {
      if (e instanceof IncusApiError && e.statusCode === 404) return null;
      throw e;
    }
  }

  async listInstances(): Promise<IncusInstance[]> {
    return (await this.req<IncusInstance[]>("GET", "/1.0/instances?recursion=1")).metadata;
  }

  async instanceState(name: string): Promise<IncusInstanceState | null> {
    try {
      return (await this.req<IncusInstanceState>("GET", `/1.0/instances/${name}/state`)).metadata;
    } catch (e) {
      if (e instanceof IncusApiError && e.statusCode === 404) return null;
      throw e;
    }
  }

  /** `stateful` stop = suspend-to-disk (RAM saved); a later start resumes.
   * This is the user-facing "suspend" verb in the 24/7 model. */
  async setState(
    name: string,
    action: "start" | "stop" | "restart",
    opts?: { stateful?: boolean; force?: boolean },
  ): Promise<void> {
    await this.doAsync(
      "PUT",
      `/1.0/instances/${name}/state`,
      { action, stateful: opts?.stateful ?? false, force: opts?.force ?? false, timeout: 60 },
      300,
    );
  }

  async deleteInstance(name: string): Promise<void> {
    await this.doAsync("DELETE", `/1.0/instances/${name}`);
  }

  async patchInstance(
    name: string,
    patch: { config?: Record<string, string>; devices?: Record<string, Record<string, string>> },
  ): Promise<void> {
    await this.req("PATCH", `/1.0/instances/${name}`, patch);
  }

  // --- files (init injection: pod-spec, kickoff, .claude layer, secrets.env) ---

  async pushFile(
    instance: string,
    guestPath: string,
    content: Buffer,
    mode = "0644",
    uid = 0,
    gid = 0,
  ): Promise<void> {
    const { status } = await this.raw(
      "POST",
      `/1.0/instances/${instance}/files?path=${encodeURIComponent(guestPath)}`,
      content,
      {
        "content-type": "application/octet-stream",
        "x-incus-type": "file",
        "x-incus-mode": mode,
        "x-incus-uid": String(uid),
        "x-incus-gid": String(gid),
        "x-incus-write": "overwrite",
      },
    );
    if (status >= 300) throw new IncusApiError(`push ${guestPath}: HTTP ${status}`, status);
  }

  // --- exec (record-output mode; small command results only) ---

  async exec(
    instance: string,
    command: string[],
    timeoutSecs = 60,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const r = await this.req<unknown>("POST", `/1.0/instances/${instance}/exec`, {
      command,
      "record-output": true,
      interactive: false,
      "wait-for-websocket": false,
    });
    if (!r.operation) throw new IncusApiError("exec returned no operation", 500);
    const op = await this.req<{ status: string; metadata?: { return?: number; output?: Record<string, string> } }>(
      "GET",
      `${r.operation}/wait?timeout=${timeoutSecs}`,
      undefined,
      // The socket timeout MUST outlast the server-side /wait block (mirrors waitOp). Without this it
      // defaulted to 30s, so ANY exec whose command ran >30s died mid-wait with a spurious socket
      // timeout — e.g. the T3 "wait for :3000" loop, which then reported enable as failed.
      (timeoutSecs + 30) * 1000,
    );
    const exitCode = op.metadata?.metadata?.return ?? -1;
    const output = op.metadata?.metadata?.output ?? {};
    const read = async (logPath?: string): Promise<string> => {
      if (!logPath) return "";
      const res = await this.raw("GET", logPath);
      return res.status < 300 ? res.body.toString("utf8") : "";
    };
    return { exitCode, stdout: await read(output["1"]), stderr: await read(output["2"]) };
  }

  // --- storage volumes (the per-pod /home/dev — survives instance recreation) ---

  async createVolume(pool: string, name: string, sizeGb: number): Promise<void> {
    await this.doAsync("POST", `/1.0/storage-pools/${pool}/volumes/custom`, {
      name,
      config: { size: `${sizeGb}GiB` },
      // BLOCK, not filesystem: a filesystem volume is shared into the VM over 9p,
      // whose broken POSIX semantics caused a whole class of bugs (guest chown not
      // reflected → "root-owned ~/work", EACCES on valid mkdir → Turbopack .next
      // failures, slow I/O). A block volume attaches as a real device the guest
      // formats ext4 and mounts (podbay-home-mount.service) — native semantics,
      // like the root disk. docs/plans/byo-repo-plan.md sibling: docs/runbooks/home-9p-to-block.md.
      content_type: "block",
    });
  }

  async getVolume(
    pool: string,
    name: string,
  ): Promise<{ name: string; content_type?: string } | null> {
    try {
      return (
        await this.req<{ name: string; content_type?: string }>(
          "GET",
          `/1.0/storage-pools/${pool}/volumes/custom/${name}`,
        )
      ).metadata;
    } catch (e) {
      if (e instanceof IncusApiError && e.statusCode === 404) return null;
      throw e;
    }
  }

  async deleteVolume(pool: string, name: string): Promise<void> {
    await this.doAsync("DELETE", `/1.0/storage-pools/${pool}/volumes/custom/${name}`);
  }

  /** Grow a custom volume to `sizeGb` (ZFS grows online). Incus rejects a shrink
   * below current usage — callers only ever pass a larger high-water mark. */
  async resizeVolume(pool: string, name: string, sizeGb: number): Promise<void> {
    await this.req("PATCH", `/1.0/storage-pools/${pool}/volumes/custom/${name}`, {
      config: { size: `${sizeGb}GiB` },
    });
  }

  // --- host resources (backoffice box stats) ---

  /** Host hardware totals: CPU thread count + memory used/total (bytes). */
  async hostResources(): Promise<{ cpu?: { total?: number }; memory?: { used?: number; total?: number } }> {
    return (
      await this.req<{ cpu?: { total?: number }; memory?: { used?: number; total?: number } }>(
        "GET",
        "/1.0/resources",
      )
    ).metadata;
  }

  /** Storage-pool space used/total (bytes). */
  async poolResources(pool: string): Promise<{ space?: { used?: number; total?: number } }> {
    return (
      await this.req<{ space?: { used?: number; total?: number } }>(
        "GET",
        `/1.0/storage-pools/${pool}/resources`,
      )
    ).metadata;
  }

  async snapshotVolume(pool: string, volume: string, snapshotName: string): Promise<void> {
    await this.doAsync("POST", `/1.0/storage-pools/${pool}/volumes/custom/${volume}/snapshots`, {
      name: snapshotName,
    });
  }

  // --- images (pod-base manifest prune) ---

  async listImages(): Promise<IncusImage[]> {
    return (await this.req<IncusImage[]>("GET", "/1.0/images?recursion=1")).metadata;
  }

  async deleteImage(fingerprint: string): Promise<void> {
    await this.doAsync("DELETE", `/1.0/images/${fingerprint}`);
  }
}
