import path from "node:path";
import type { IncomingMessage } from "node:http";
import { createAuth, getSessionUserId, notifyOps, type AuthEnv } from "@podbay/auth";
import { PodService, DrizzlePodStore, FetchMemory, AgentMessages, RelayService } from "@podbay/control-plane";
import { RelayRegistry } from "./relay-registry.js";
import {
  FlyProvider,
  FlyHttpClient,
  loadFlyConfig,
  IncusProvider,
  IncusApi,
  isIncusConfigured,
  loadIncusClientOptions,
  loadIncusConfig,
  type SandboxProvider,
} from "@podbay/provider";
import { createAppDb } from "@podbay/db";
import { GatewayServer } from "./server.js";

/** Production wiring: real better-auth sessions, Fly (+ optional Incus)
 * providers, Neon-backed pods. Incus joins only when PODBAY_INCUS_URL is set
 * (infra-strategy.md M1); PODBAY_DEFAULT_PROVIDER flips where NEW pods land. */
async function main(): Promise<void> {
  const auth = createAuth(process.env as AuthEnv);

  const flyConfig = loadFlyConfig();
  const fly = new FlyProvider(
    new FlyHttpClient({
      apiToken: flyConfig.apiToken,
      appName: flyConfig.appName,
      apiBaseUrl: flyConfig.apiBaseUrl,
    }),
    flyConfig,
  );
  const providers: Record<string, SandboxProvider> = { fly };
  if (isIncusConfigured()) {
    providers.incus = new IncusProvider(new IncusApi(loadIncusClientOptions()), loadIncusConfig());
  }
  const defaultProviderName = process.env.PODBAY_DEFAULT_PROVIDER ?? "fly";
  const provider = providers[defaultProviderName] ?? fly;
  // createAppDb (not createNeonDb) so PODBAY_DB selects the driver — the web app
  // already did this, and the mismatch broke prod when the DB moved off Neon
  // 2026-07-27: the gateway kept using the neon-http driver against a plain
  // Postgres URL, so EVERY query failed ("NeonDbError: fetch failed") — terminal
  // WS rejected with 500 and the reconcile sweep died, while web looked fine.
  const db = createAppDb();
  const fetchMemory = new FetchMemory(db);
  const agentMessages = new AgentMessages(db);
  const relays = new RelayRegistry();
  const relayService = new RelayService(db);
  const control = new PodService(provider, new DrizzlePodStore(db), {
    environmentsRoot: process.env.PODBAY_ENVIRONMENTS_ROOT ?? path.resolve("environments"),
    providers,
    defaultProviderName,
    // The HTTP exchange floor also runs from the gateway's reconcile, so a pod on an
    // older image (no control socket) still syncs.
    fetchMemory,
    // Owner-scoped pod↔pod messaging drains + routes on the same reconcile sweep.
    agentMessages,
    // Critical unplanned incidents (agent OOM, wedged pod, failed provision) page the
    // ops Telegram — deduped per pod+type inside the service. Runs here because the
    // reconcile (which detects them) lives in the gateway.
    onIncident: async (info) => {
      // Show the owner-chosen display name where set (with the slug for support), so the
      // page reads "pod: my-crawler (dual-bear-fb14)" rather than just the slug.
      const name = await control.nameOf(info.podId).catch(() => null);
      const label = name && name !== info.podId ? `${name} (${info.podId})` : info.podId;
      await notifyOps(`⚠️ podbay incident\n${info.title}\npod: ${label}`).catch(() => undefined);
    },
  });

  const server = new GatewayServer({
    control,
    // Adapt owner-scoped FetchMemory to the hub's FetchMemorySink (M1): the hub knows
    // only podId, so resolve the owner here for attribution, and broadcast the TRUSTED
    // global baseline (owner "") — a pod's own-owner verdicts ride the reconcile push.
    fetchMemory: {
      record: async (podId, domain, rung, outcome) => {
        const owner = await control.ownerOf(podId).catch(() => null);
        if (owner != null) await fetchMemory.record(owner, domain, rung as never, outcome as never);
      },
      fleetPlan: () => fetchMemory.fleetPlan(""),
    },
    relays,
    relayAuthority: relayService,
    // Public wss:// this gateway is reachable at, for the pod→owner pairing command.
    // Derived from the preview base if unset (gateway.<root>), so a standard deploy
    // needs no extra config; PODBAY_RELAY_CONNECT_URL overrides.
    relayConnectUrl: relayConnectUrl(),
    authenticate: async (req: IncomingMessage) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      return getSessionUserId(auth, headers);
    },
    // Route by each pod's recorded provider, so a terminal/preview to a pod on
    // ANY backend resolves to the right address (Fly 6PN or Incus-over-WG).
    resolveAgentUrl: async (podId) => {
      const endpoint = await (await control.providerForPod(podId)).endpoint(podId);
      return endpoint.replace(/^http/, "ws");
    },
    // Preview URLs: served on `<slug>.<PODBAY_PREVIEW_BASE>` when configured.
    previewBase: process.env.PODBAY_PREVIEW_BASE || undefined,
    previewPort: Number(process.env.PODBAY_PREVIEW_PORT ?? 3000),
    resolvePreviewOrigin: async (podId) =>
      (await control.providerForPod(podId)).podAddress(
        podId,
        Number(process.env.PODBAY_PREVIEW_PORT ?? 3000),
      ),
    host: process.env.PODBAY_GATEWAY_HOST ?? "::",
    port: Number(process.env.PODBAY_GATEWAY_PORT ?? 8090),
    // Where to send a signed-out browser that hit a private preview. Explicit
    // PODBAY_APP_ORIGIN, else the first trusted origin, else derived from the
    // preview base (preview.podbay.cloud → https://podbay.cloud).
    appOrigin: appOrigin(),
    // Maintenance wake is opt-in: set PODBAY_MAINTENANCE_DORMANT_DAYS to enable
    // (keeps dormant pods' logins alive; costs a short wake per dormant pod).
    maintenanceDormantMs: process.env.PODBAY_MAINTENANCE_DORMANT_DAYS
      ? Number(process.env.PODBAY_MAINTENANCE_DORMANT_DAYS) * 24 * 60 * 60 * 1000
      : undefined,
  });

  const { host, port } = await server.listen();
  console.log(`podbay-gateway listening on ${host}:${port}`);

  // Fleet reconcile sweep: periodically re-sync every pod's DB record with the
  // provider's real state, so the owner + admin dashboards always show the truth
  // without anyone clicking anything — drift (a ghost, a stuck status, a crashed
  // machine) heals on its own within a sweep. Wake-safe: service.reconcile reads
  // instance metadata and only dials the agent for a pod already running, so a
  // suspended pod is never woken. Best-effort + batched so a large fleet can't
  // hammer the provider. Set PODBAY_RECONCILE_SWEEP_MS=0 to disable.
  const sweepMs = Number(process.env.PODBAY_RECONCILE_SWEEP_MS ?? 90_000);
  if (sweepMs > 0) {
    let sweeping = false;
    const sweep = async () => {
      if (sweeping) return; // never overlap a slow sweep with the next tick
      sweeping = true;
      try {
        const pods = await control.listAllPods();
        for (let i = 0; i < pods.length; i += 6) {
          await Promise.all(
            pods.slice(i, i + 6).map((p) => control.reconcile(p.id).catch(() => undefined)),
          );
        }
      } catch (e) {
        console.error("reconcile_sweep_failed", e);
      } finally {
        sweeping = false;
      }
    };
    setInterval(() => void sweep(), sweepMs).unref();
    console.log(`podbay-gateway reconcile sweep every ${sweepMs}ms`);
  }

  // Daily WARNINGS digest (§7): criticals page immediately (onIncident above);
  // warnings batch into one ops summary. In-memory cadence — a gateway restart resets
  // the clock (at most one extra/late digest), acceptable for a best-effort summary.
  const digestMs = Number(process.env.PODBAY_WARN_DIGEST_MS ?? 24 * 60 * 60_000);
  if (digestMs > 0) {
    setInterval(() => {
      void (async () => {
        try {
          const text = await control.buildWarnDigest(Date.now() - digestMs);
          if (text) await notifyOps(text);
        } catch (e) {
          console.error("warn_digest_failed", e);
        }
      })();
    }, digestMs).unref();
    console.log(`podbay-gateway warn digest every ${digestMs}ms`);
  }

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => void server.close().finally(() => process.exit(0)));
  }
}

/** The main app origin for the private-preview sign-in redirect. */
/** The public wss:// a relay dials to reach this gateway. Explicit override, else the
 * gateway's own host under the preview root (gateway.podbay.cloud), else off. */
function relayConnectUrl(): string | undefined {
  if (process.env.PODBAY_RELAY_CONNECT_URL) return process.env.PODBAY_RELAY_CONNECT_URL;
  const base = process.env.PODBAY_PREVIEW_BASE?.replace(/^\.+|\.+$/g, "");
  // preview.podbay.cloud → gateway.podbay.cloud
  if (base && base.split(".").length > 2) return `wss://gateway.${base.split(".").slice(1).join(".")}`;
  return base ? `wss://gateway.${base}` : undefined;
}

function appOrigin(): string | undefined {
  if (process.env.PODBAY_APP_ORIGIN) return process.env.PODBAY_APP_ORIGIN;
  const trusted = process.env.TRUSTED_ORIGINS?.split(",")[0]?.trim();
  if (trusted) return trusted;
  const base = process.env.PODBAY_PREVIEW_BASE?.replace(/^\.+|\.+$/g, "");
  // Strip the leading preview label: preview.podbay.cloud → podbay.cloud.
  if (base && base.split(".").length > 2) return `https://${base.split(".").slice(1).join(".")}`;
  return base ? `https://${base}` : undefined;
}

main().catch((e) => {
  console.error("gateway failed to start:", e);
  process.exit(1);
});
