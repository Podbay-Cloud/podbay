import "server-only";
import {
  PodService,
  DrizzlePodStore,
  DrizzleSecretStore,
  SecretVault,
  FetchMemory,
} from "@podbay/control-plane";
import { createAppDb } from "@podbay/db";
import { credKeyFromEnv } from "@podbay/shared/crypto";
import {
  FlyProvider,
  FlyHttpClient,
  FakeProvider,
  LocalProvider,
  loadFlyConfig,
  ProviderError,
  IncusProvider,
  IncusApi,
  isIncusConfigured,
  loadIncusClientOptions,
  loadIncusConfig,
  type SandboxProvider,
  type HostCapacity,
} from "@podbay/provider";
import { getEnvironmentsRoot } from "./environments";

/** Test/e2e: in-memory provider instead of Fly. */
function isFakeProvider(): boolean {
  return process.env.PODBAY_FAKE_PROVIDER === "1";
}

/** OSS / self-host: pods run as local (or ssh://) Docker containers instead of on Fly. */
function isLocalProvider(): boolean {
  return process.env.PODBAY_LOCAL_PROVIDER === "1";
}

/** Pod provisioning requires a Fly token (or the fake/local provider). */
export function isProvisioningEnabled(): boolean {
  return isFakeProvider() || isLocalProvider() || Boolean(process.env.FLY_API_TOKEN);
}

/**
 * Self-host preview URL for a pod: the container's `:3000` published to a host port,
 * e.g. `http://127.0.0.1:<port>` (or the remote host for an ssh:// any-VM). Cloud derives
 * previews from PODBAY_PREVIEW_BASE instead; this fills the gap so the self-host cockpit can
 * actually open the running dev server. Returns null when not local, or the pod isn't running /
 * hasn't published the port yet.
 */
export async function localPreviewUrl(slug: string): Promise<string | null> {
  if (!isLocalProvider()) return null;
  try {
    // publishedAddress (not podAddress): the link is for the BROWSER, so it must be the host
    // port mapping even when the control plane runs inside the compose network.
    return await new LocalProvider().publishedAddress(slug, 3000);
  } catch {
    return null;
  }
}

/** The Docker host's compute + what podbay pods have reserved, for the self-host size picker.
 * Null when not in local-provider mode or docker can't be reached. (self-host-pod-sizing task 2.2) */
export async function hostCapacity(): Promise<HostCapacity | null> {
  if (!isLocalProvider()) return null;
  try {
    return await new LocalProvider().hostCapacity();
  } catch {
    return null;
  }
}

/** The digest of the pod-base image currently pulled on the host — a pod on a different digest has
 * an update available. Null in cloud / when docker is unreachable. (self-host update detection) */
export async function latestPodImageDigest(): Promise<string | null> {
  if (!isLocalProvider()) return null;
  try {
    return (await new LocalProvider().latestImageDigest()) ?? null;
  } catch {
    return null;
  }
}

/** Stand-in provider used before Fly is wired — reads go through the store, writes are refused. */
class DisabledProvider implements SandboxProvider {
  private nope(): never {
    throw new ProviderError("pod provisioning is not enabled", "unsupported");
  }
  async createPod() {
    return this.nope();
  }
  async getPod() {
    return this.nope();
  }
  async listPods() {
    return [];
  }
  async exec() {
    return this.nope();
  }
  async sleep() {
    return this.nope();
  }
  async wake() {
    return this.nope();
  }
  async setKeepAwake() {
    return this.nope();
  }
  async resize() {
    return this.nope();
  }
  async fetchMetrics() {
    return null;
  }
  async githubStatus() {
    return { connected: false, login: null };
  }
  async secretRequests() {
    return [];
  }
  async setGithubToken() {
    return this.nope();
  }
  async listRepos() {
    return [];
  }
  async cloneRepo(): Promise<never> {
    return this.nope();
  }
  async clearGithubToken(): Promise<never> {
    return this.nope();
  }
  async podHealth(): Promise<never> {
    return this.nope();
  }
  async setCodexRc(): Promise<never> {
    return this.nope();
  }
  async sendAgentInput(): Promise<never> {
    return this.nope();
  }
  async runDoctor(): Promise<never> {
    return this.nope();
  }
  async podReport(): Promise<never> {
    return this.nope();
  }
  async codexPair(): Promise<never> {
    return this.nope();
  }
  async codexRcActive(): Promise<never> {
    return this.nope();
  }
  async snapshot() {
    return this.nope();
  }
  async destroy() {
    return this.nope();
  }
  async endpoint() {
    return this.nope();
  }
  async podAddress() {
    return this.nope();
  }
  async agentReady() {
    return false;
  }
  async agentIdleMs() {
    return null;
  }
  async agentSessionUrl() {
    return null;
  }
  async updateImage() {
    return this.nope();
  }
  async agentStatus() {
    return null;
  }
  async injectSecrets() {
    return this.nope();
  }
}

function flyProvider(): SandboxProvider {
  const cfg = loadFlyConfig();
  return new FlyProvider(
    new FlyHttpClient({ apiToken: cfg.apiToken, appName: cfg.appName, apiBaseUrl: cfg.apiBaseUrl }),
    cfg,
  );
}

/** Per-pod app-secret vault (pod-secrets), keyed by PODBAY_CRED_KEY. */
function secretVault(db = createAppDb()): SecretVault | undefined {
  if (!process.env.PODBAY_CRED_KEY) return undefined;
  return new SecretVault(new DrizzleSecretStore(db), credKeyFromEnv());
}

// The fake provider holds pod state in memory, so it must be a singleton across
// requests — otherwise a pod launched in one request is "not found" in the next.
// Stored on globalThis (not a module `let`) because Next runs server actions and
// page renders in SEPARATE module graphs, so a module-level singleton wouldn't be
// shared between e.g. the wake action and the dashboard render.
const fakeKey = Symbol.for("podbay.fakeProvider");
type FakeGlobal = typeof globalThis & { [fakeKey]?: FakeProvider };

function chooseProvider(): SandboxProvider {
  if (isFakeProvider()) {
    const g = globalThis as FakeGlobal;
    g[fakeKey] ??= new FakeProvider({ agentEndpoint: process.env.PODBAY_FAKE_AGENT_ENDPOINT });
    return g[fakeKey];
  }
  if (isLocalProvider()) return new LocalProvider(); // stateless (queries Docker) — no singleton needed
  return Boolean(process.env.FLY_API_TOKEN) ? flyProvider() : new DisabledProvider();
}

/** Server-only PodService: app DB always, real/fake provider + secret vault.
 * Incus joins the provider map only when PODBAY_INCUS_URL is set (never in fake
 * mode); PODBAY_DEFAULT_PROVIDER flips where NEW pods land (infra-strategy M1). */
export function getPodService(): PodService {
  const db = createAppDb();
  const store = new DrizzlePodStore(db);
  const base = chooseProvider();
  const localMode = isLocalProvider();
  // OSS self-host runs one provider named "local"; cloud keys the base as "fly" (+ optional incus).
  const providers: Record<string, SandboxProvider> = localMode ? { local: base } : { fly: base };
  if (!isFakeProvider() && !localMode && isIncusConfigured()) {
    providers.incus = new IncusProvider(new IncusApi(loadIncusClientOptions()), loadIncusConfig());
  }
  const defaultProviderName = process.env.PODBAY_DEFAULT_PROVIDER ?? (localMode ? "local" : "fly");
  const svc = new PodService(providers[defaultProviderName] ?? base, store, {
    environmentsRoot: getEnvironmentsRoot(),
    secretVault: secretVault(db),
    providers,
    defaultProviderName,
    // Shared fetch memory: pods report what they learned on the reconcile poll and
    // get the fleet's plan back on the same pass.
    fetchMemory: new FetchMemory(db),
  });
  ensureProvisioner();
  return svc;
}

/**
 * Start the durable-provisioning worker once, in this (long-lived, Node) web
 * process — the home of launchPod and every pod control, so its provider is the
 * single lifecycle authority (docs/runbooks/durable-provisioning-plan.md). Kicked off
 * lazily on the first getPodService() call (a page render or server action)
 * rather than from instrumentation.ts, which the bundler compiles for the edge
 * runtime and can't resolve the pg driver there. Multiple web instances are fine
 * — the DB lease makes claims exclusive.
 */
const provisionerKey = Symbol.for("podbay.provisioner");
type ProvisionerGlobal = typeof globalThis & { [provisionerKey]?: boolean };
function ensureProvisioner(): void {
  const g = globalThis as ProvisionerGlobal;
  const intervalMs = Number(process.env.PODBAY_PROVISION_INTERVAL_MS ?? 4000);
  if (g[provisionerKey] || intervalMs <= 0) return;
  g[provisionerKey] = true;
  let running = false;
  setInterval(() => {
    if (running) return; // never overlap ticks
    running = true;
    void getPodService()
      .provisionPending()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, intervalMs).unref?.();
}
