#!/usr/bin/env node
/**
 * podbay — single-machine self-host CLI (spike). Verbs: launch | ls | attach | rm | serve.
 * See docs/strategy/oss-strategy.md. One control plane, a Docker provider (local, or any
 * VM via PODBAY_DOCKER_HOST=ssh://user@host), an embedded PGlite store, a fixed local owner.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node packages/selfhost/podbay.mjs launch nextjs-starter
 *   node packages/selfhost/podbay.mjs ls
 *   node packages/selfhost/podbay.mjs attach <id>
 *   node packages/selfhost/podbay.mjs rm <id>
 *   PODBAY_DB=pg DATABASE_URL=… node packages/selfhost/podbay.mjs serve  # gateway + provisioner
 *
 * DB model: the one-shot verbs use the embedded PGlite (single-writer, standalone). `serve` runs
 * the terminal GATEWAY + the provision/reconcile loop, so it must coexist with the web app on the
 * SAME database — it requires shared Postgres (PODBAY_DB=pg). Don't run a one-shot PGlite verb and
 * `serve` against one PGlite dir at once; the daemon-API split (verbs as thin clients of `serve`)
 * is the v1.5 fix.
 */
import path from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PodService, DrizzlePodStore, DrizzleSecretStore, SecretVault } from "@podbay/control-plane";
import { LocalProvider } from "@podbay/provider";
import { GatewayServer } from "@podbay/gateway";
import { createPgliteDb, migratePgliteDb, createAppDb, schema } from "@podbay/db";
import { createAuth, getSessionUserId, resolveOwnerId, ownerCredentialExists } from "@podbay/auth";

const OWNER = "local";
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const environmentsRoot = process.env.PODBAY_ENVIRONMENTS_ROOT ?? path.join(repoRoot, "environments");
const dataDir = process.env.PODBAY_DATA_DIR ?? path.join(repoRoot, ".podbay-selfhost");

const die = (m) => {
  console.error(`podbay: ${m}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Persistent vault key so secrets encrypted by one command decrypt in the next. Prefers the web
 * app's PODBAY_CRED_KEY (base64, same as @podbay/shared credKeyFromEnv) so a shared-DB `serve` can
 * decrypt secrets the web app stored; otherwise a local per-machine key for the standalone CLI. */
function vaultKey() {
  if (process.env.PODBAY_CRED_KEY) {
    const k = Buffer.from(process.env.PODBAY_CRED_KEY, "base64");
    if (k.length === 32) return k;
  }
  mkdirSync(dataDir, { recursive: true });
  const f = path.join(dataDir, "vault.key");
  if (existsSync(f)) return Buffer.from(readFileSync(f, "utf8").trim(), "base64");
  const k = randomBytes(32);
  writeFileSync(f, k.toString("base64"), { mode: 0o600 });
  return k;
}

/** Wire the whole self-host core: provider + embedded store + local owner + secret vault. */
async function core() {
  const db = createPgliteDb(dataDir);
  await migratePgliteDb(db);
  await db
    .insert(schema.user)
    .values({ id: OWNER, name: "Local", email: "local@localhost", approved: true })
    .onConflictDoNothing();
  const provider = new LocalProvider(); // dockerHost from PODBAY_DOCKER_HOST → any-VM
  // Silence the control-plane's operational JSON logs so CLI output stays clean (PODBAY_DEBUG=1
  // restores them). Failures still surface — the CLI throws and we print a one-liner.
  const quiet = { info() {}, warn() {}, error() {} };
  const podbay = new PodService(provider, new DrizzlePodStore(db), {
    environmentsRoot,
    defaultProviderName: "local",
    secretVault: new SecretVault(new DrizzleSecretStore(db), vaultKey()),
    ...(process.env.PODBAY_DEBUG ? {} : { logger: quiet }),
  });
  return { podbay, provider };
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function launch(args) {
  const env = args.find((a) => !a.startsWith("--")) ?? "nextjs-starter";
  // Default: the SAME subscription /login flow as cloud — you log into your own Claude account
  // (attach → /login). No key needed. `--api-key` opts into unattended api-key mode instead.
  const useApiKey = args.includes("--api-key");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (useApiKey && !apiKey) die("--api-key needs ANTHROPIC_API_KEY set");
  const { podbay, provider } = await core();
  const pod = await podbay.launchPod(OWNER, env, {
    slotCap: Infinity, // you host it — no billing/slot caps
    name: flag(args, "--name"),
    ...(useApiKey ? { agentAuth: "api-key", agentApiKey: apiKey } : {}), // else the env default (subscription)
  });
  console.log(`launched ${pod.id} (env ${env}); provisioning…`);
  await podbay.provisionPending();
  const preview = await provider.podAddress(pod.id, 3000).catch(() => "(pending)");
  const agent = await provider.podAddress(pod.id, 8080).catch(() => "(pending)");
  console.log(
    `\n  pod:       ${pod.id}\n  container: podbay-${pod.id}\n  preview:   ${preview}\n  agent:     ${agent}\n` +
      `  attach:    node packages/selfhost/podbay.mjs attach ${pod.id}\n` +
      `  ${useApiKey ? "auth:      api-key (agent runs on your ANTHROPIC_API_KEY)" : "login:     attach, then run /login in the claude window (your own Claude account)"}\n` +
      `  stop:      node packages/selfhost/podbay.mjs rm ${pod.id}\n`,
  );
}

async function ls() {
  const { podbay } = await core();
  const pods = await podbay.listPods(OWNER);
  for (const p of pods) await podbay.reconcile(p.id).catch(() => {}); // live status from the provider
  const live = (await podbay.listPods(OWNER)).filter((p) => p.status !== "gone" && p.status !== "destroying");
  if (!live.length) return console.log("no running pods (launch one: podbay launch <env>)");
  console.log(["ID", "NAME", "ENV", "STATUS", "PROVIDER"].map((h) => h.padEnd(22)).join(""));
  for (const p of live) {
    console.log([p.id, p.name ?? "—", p.environmentName, p.status, p.provider].map((c) => String(c).padEnd(22)).join(""));
  }
}

async function attach(args) {
  const id = args[0] ?? die("usage: podbay attach <id>");
  // No DB needed — the container name is podbay-<id>; tmux runs on the dev user's socket.
  const r = spawnSync("docker", ["exec", "-it", "-u", "dev", `podbay-${id}`, "tmux", "attach", "-t", "main"], {
    stdio: "inherit",
  });
  if (r.status !== 0 && r.error) die(`attach failed: ${r.error.message}`);
}

async function rm(args) {
  const id = args[0] ?? die("usage: podbay rm <id>");
  const { podbay } = await core();
  await podbay.destroy(OWNER, id);
  console.log(`removed ${id}`);
}

async function serve() {
  // serve = the terminal GATEWAY + the provision/reconcile loop, one process. The gateway must
  // coexist with the web app on the SAME database, and PGlite is single-writer — so serve runs on
  // shared Postgres (PODBAY_DB=pg + DATABASE_URL, same as the web app). The one-shot verbs stay on
  // the embedded PGlite; don't point both at one PGlite dir at once.
  if (process.env.PODBAY_DB !== "pg") {
    die("podbay serve needs PODBAY_DB=pg + DATABASE_URL (the DB it shares with the web app) — PGlite is single-writer");
  }
  const db = createAppDb();
  const provider = new LocalProvider();
  const quiet = { info() {}, warn() {}, error() {} };
  const control = new PodService(provider, new DrizzlePodStore(db), {
    environmentsRoot,
    defaultProviderName: process.env.PODBAY_DEFAULT_PROVIDER ?? "local",
    providers: { local: provider },
    secretVault: new SecretVault(new DrizzleSecretStore(db), vaultKey()),
    ...(process.env.PODBAY_DEBUG ? {} : { logger: quiet }),
  });

  // AUTH GATE (self-host-auth-gate). The terminal used to authenticate EVERY connection as the owner
  // — wide open on a VPS. Now it validates the same better-auth session cookie the web app sets, so
  // the WebSocket is refused without a signed-in owner. web + serve MUST share BETTER_AUTH_SECRET.
  let auth;
  try {
    auth = createAuth(process.env);
  } catch (e) {
    die(
      `serve needs the auth gate configured — set PODBAY_EDITION=oss, DATABASE_URL, and BETTER_AUTH_SECRET ` +
        `(the compose install generates the secret automatically). ${e?.message ?? e}`,
    );
  }
  // Optional pre-seed for a public VPS: create the owner from env before serving so there's no
  // first-run claim window. Idempotent — skipped once an owner exists.
  if (process.env.PODBAY_AUTH_PASSWORD && !(await ownerCredentialExists(db))) {
    const email = process.env.PODBAY_AUTH_EMAIL || "owner@podbay.local"; // valid format (localhost has no dot)
    try {
      await auth.api.signUpEmail({ body: { email, password: process.env.PODBAY_AUTH_PASSWORD, name: "Owner" } });
      console.log(`podbay serve — seeded owner ${email} from PODBAY_AUTH_PASSWORD`);
    } catch (e) {
      die(`could not pre-seed the owner from PODBAY_AUTH_PASSWORD: ${e?.message ?? e}`);
    }
  }
  const headersFrom = (req) => {
    const h = new Headers();
    for (const [k, v] of Object.entries(req.headers ?? {})) {
      if (typeof v === "string") h.set(k, v);
      else if (Array.isArray(v)) h.set(k, v.join(", "));
    }
    return h;
  };

  // The real @podbay/gateway as a transparent WS proxy, bound to loopback, resolving the pod-agent's
  // published :8080 (http→ws). Same code + resolver the cloud uses. provisionIntervalMs:0 — the loop
  // below provisions, don't double up.
  const gateway = new GatewayServer({
    control,
    // Validate the session; single-tenant, so any valid session IS the owner. null ⇒ refused.
    authenticate: async (req) => getSessionUserId(auth, headersFrom(req)),
    resolveAgentUrl: async (podId) => {
      const endpoint = await (await control.providerForPod(podId)).endpoint(podId);
      return endpoint.replace(/^http/, "ws");
    },
    host: process.env.PODBAY_GATEWAY_HOST ?? "127.0.0.1",
    port: Number(process.env.PODBAY_GATEWAY_PORT ?? 3001),
    provisionIntervalMs: 0,
  });
  const { host, port } = await gateway.listen();
  console.log(
    `podbay serve — gateway + provisioner (Ctrl-C to stop)\n` +
      `  terminal:  ws://${host}:${port}  → set NEXT_PUBLIC_GATEWAY_URL=ws://localhost:${port} for the web app\n` +
      `  loop:      provisions pending pods + refreshes status every 15s`,
  );
  for (;;) {
    await control.provisionPending().catch(() => {});
    // Owner id is dynamic now (created by first-run setup, not a hardcoded "local"). Skip the
    // per-owner reconcile until an owner exists.
    const owner = await resolveOwnerId(db).catch(() => null);
    if (owner) {
      for (const p of await control.listPods(owner).catch(() => [])) await control.reconcile(p.id).catch(() => {});
    }
    await sleep(15_000);
  }
}

const [verb, ...rest] = process.argv.slice(2);
const verbs = { launch, ls, attach, rm, serve };
if (!verbs[verb]) {
  console.log("usage: podbay <launch <env> [--name X] | ls | attach <id> | rm <id> | serve>");
  process.exit(verb ? 1 : 0);
}
verbs[verb](rest).then(
  () => process.exit(0),
  (e) => die(e?.message ?? String(e)),
);
