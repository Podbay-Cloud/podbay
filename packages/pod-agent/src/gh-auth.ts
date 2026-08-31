import { spawn, execFile } from "node:child_process";
import { readdir } from "node:fs/promises";

/**
 * GitHub connection for private-repo clones. The web app runs the OAuth *device
 * flow* (it holds the client_id); the pod-agent only ever receives the final
 * user token and hands it to `gh` so `git clone` of the user's private repos
 * just works. The token arrives via stdin — never argv — so it never shows up in
 * the pod's process list. Related: docs/runbooks/bulletproof-launch.md step 7.
 *
 * CRITICAL: run gh/git as the DEV user with HOME=/home/dev. The pod-agent is
 * root under systemd with no $HOME, so a bare spawn gave gh/git "fatal: $HOME not
 * set" and would have stored creds in root's home — but `git clone` runs in the
 * dev shell. Running as uid 1000 lands the token + credential helper in
 * /home/dev/.config/gh + ~/.gitconfig, on the persistent volume, where dev's git
 * finds it.
 */
const DEV_HOME = "/home/dev";
const DEV_UID = 1000;
const DEV_GID = 1000;

/** Spawn/exec options that run a child as `dev` with a real HOME. */
function devOpts<T extends object>(extra?: T) {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  return {
    env: { ...process.env, HOME: DEV_HOME, USER: "dev", LOGNAME: "dev" },
    ...(asRoot ? { uid: DEV_UID, gid: DEV_GID } : {}),
    ...extra,
  };
}

export interface GhStatus {
  connected: boolean;
  login: string | null;
  /** The `owner/repo` already checked out in ~/work (its `origin` remote), or null when ~/work is not
   * a GitHub clone. Lets the UI say "this pod is working on X" instead of pushing "choose a repo to
   * clone" at a pod that already has one. */
  workRepo?: string | null;
}

/** Extract `owner/repo` from a GitHub remote URL (ssh or https), or null if it isn't one.
 * Handles git@github.com:owner/repo.git and https://github.com/owner/repo(.git). Pure + exported
 * so the parse is unit-pinned. */
export function parseGithubRemote(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The GitHub repo currently checked out in ~/work (origin remote), or null. Best-effort. */
async function workRepoRemote(): Promise<string | null> {
  try {
    const out = await runOut("git", ["-C", `${DEV_HOME}/work`, "remote", "get-url", "origin"]);
    return parseGithubRemote(out);
  } catch {
    return null; // not a git repo, no origin, or ~/work absent
  }
}

/** Install a GitHub token into gh + git. Returns the authenticated login. */
export async function setGithubToken(token: string): Promise<{ login: string }> {
  await ghLoginWithToken(token.trim());
  // Route git's HTTPS auth through gh so `git clone https://github.com/...`
  // picks up the token without the user touching a credential helper.
  await run("gh", ["auth", "setup-git", "--hostname", "github.com"]);
  const login = await ghLogin();
  if (!login) throw new Error("gh reported no authenticated user after login");
  return { login };
}

/** Whether the pod already has a working GitHub login, and as whom. */
export async function githubStatus(): Promise<GhStatus> {
  const login = await ghLogin();
  return { connected: !!login, login, workRepo: await workRepoRemote() };
}

/** Forget the GitHub connection: log `gh` out so the stored token is removed and
 * git's credential helper stops resolving it. Idempotent — logging out when
 * nothing is connected is a no-op, not an error. Already-cloned repos stay on
 * disk (only future auth'd operations stop working), which is what the
 * confirmation dialog promises. */
export async function clearGithubToken(): Promise<void> {
  const login = await ghLogin();
  if (!login) return;
  await run("gh", ["auth", "logout", "--hostname", "github.com"]).catch(() => {});
}

// GitHub CLI's OWN public OAuth app id. Self-host has no podbay OAuth app, so the pod drives the
// device flow itself with gh's client — the owner authorizes "GitHub CLI", exactly as a local
// `gh auth login` would. Public knowledge (it ships in the gh binary).
const GH_CLIENT_ID = "178c6fc778ccc68e1d6a";
const GH_SCOPES = "repo,read:org,gist,workflow";

export interface GhDeviceStart {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
}

/** Begin an in-pod GitHub device-flow login. The pod (not the web app) asks GitHub for a one-time
 * user code the owner types at github.com/login/device — no OAuth app to configure on self-host. */
export async function ghDeviceStart(): Promise<GhDeviceStart> {
  const r = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GH_CLIENT_ID, scope: GH_SCOPES }),
  });
  if (!r.ok) throw new Error(`GitHub device-code request failed (${r.status})`);
  const j = (await r.json()) as Record<string, unknown>;
  if (!j.device_code) throw new Error((j.error_description as string) || "no device code from GitHub");
  return {
    userCode: String(j.user_code),
    verificationUri: String(j.verification_uri),
    deviceCode: String(j.device_code),
    interval: Number(j.interval ?? 5),
    expiresIn: Number(j.expires_in ?? 900),
  };
}

export type GhDevicePoll =
  | { status: "connected"; login: string }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "error"; error: string };

/** Poll the device flow. Once GitHub authorizes, install the token into gh + git (setGithubToken)
 * so clone/push and the agent's own gh all work, and report the login. */
export async function ghDevicePoll(deviceCode: string): Promise<GhDevicePoll> {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GH_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (j.access_token) {
    const { login } = await setGithubToken(String(j.access_token));
    return { status: "connected", login };
  }
  switch (j.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "expired_token":
      return { status: "expired" };
    default:
      return { status: "error", error: (j.error_description as string) || String(j.error) || "device flow failed" };
  }
}

function ghLoginWithToken(token: string): Promise<void> {
  if (!token) return Promise.reject(new Error("empty GitHub token"));
  return new Promise((resolve, reject) => {
    const child = spawn(
      "gh",
      ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--with-token"],
      devOpts({ stdio: ["pipe", "ignore", "pipe"] }),
    );
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim() || `gh auth login exited ${code}`)),
    );
    child.stdin.end(token + "\n");
  });
}

/** The authenticated login via the API (parse-stable, unlike `gh auth status`
 * text), or null when unauthenticated. */
function ghLogin(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("gh", ["api", "user", "--jq", ".login"], devOpts({ timeout: 10_000 }), (e, stdout) => {
      resolve(e ? null : stdout.trim() || null);
    });
  });
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, devOpts({ timeout: 15_000 }), (e, _out, stderr) =>
      e ? reject(new Error((stderr || "").trim() || e.message)) : resolve(),
    );
  });
}

function runOut(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, devOpts({ timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }), (e, stdout, stderr) =>
      e ? reject(new Error((stderr || "").trim() || e.message)) : resolve(stdout),
    );
  });
}

/** Run a shell script as dev — for the multi-step clone (clone → move → clean) that
 * mirrors init.sh's BYO clone. The script is built from validated inputs only. */
function runShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "bash",
      ["-c", script],
      devOpts({ timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }),
      (e, _out, stderr) => (e ? reject(new Error((stderr || "").trim() || e.message)) : resolve()),
    );
  });
}

export interface Repo {
  fullName: string;
  private: boolean;
  updatedAt: string;
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** List the authed user's repositories (owner + collaborator + org member), most
 * recent first — via the pod's own gh credentials, so no token ever reaches the web. */
export async function listRepos(): Promise<Repo[]> {
  const out = await runOut("gh", [
    "api",
    "user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member",
    "--jq",
    ".[] | {fullName: .full_name, private: .private, updatedAt: .updated_at}",
  ]);
  // gh streams one compact JSON object per line for a `.[] | …` jq program.
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Repo);
}

export interface CloneOpts {
  /** Overwrite a non-empty ~/work instead of refusing it. The existing contents are
   * cleared and replaced with the repo — but only AFTER the clone succeeds (see below),
   * so a failed clone never destroys the old workspace. The caller gates this behind an
   * explicit user confirmation ("replace ~/work"). Default false = one pod, one repo. */
  force?: boolean;
  /** Test seam: point the clone at a scratch workspace / a local origin so the real
   * clone+move mechanics run without touching the pod's real ~/work or the network.
   * Both default to production behaviour (clone github.com into ~/work). */
  workDir?: string;
  urlFor?: (repo: string) => string;
}

/**
 * Clone a repository into ~/work. By default this proceeds ONLY when ~/work is empty —
 * one pod maps to one repo, and existing work is refused rather than overwritten. With
 * `force`, a non-empty ~/work is REPLACED with the repo (the confirmed "override" path).
 *
 * Either way the clone lands in a temp subdir FIRST; only once it succeeds do we clear
 * the workspace (force only) and move the new tree up (incl. .git), mirroring init.sh's
 * BYO clone. So a partial/failed clone can never leave a half-populated ~/work, and a
 * forced overwrite never deletes the old contents until the replacement is in hand.
 */
export async function cloneRepo(
  repo: string,
  opts: CloneOpts = {},
): Promise<{ ok: true; dest: string } | { ok: false; reason: "not-empty" | "invalid" }> {
  if (!REPO_RE.test(repo)) return { ok: false, reason: "invalid" };
  const work = opts.workDir ?? `${DEV_HOME}/work`;
  const entries = await readdir(work).catch(() => [] as string[]);
  if (entries.length > 0 && !opts.force) return { ok: false, reason: "not-empty" };
  const url = (opts.urlFor ?? ((r) => `https://github.com/${r}.git`))(repo);
  // Clone first, then clear-and-overlay. The `find … -exec rm` clears everything EXCEPT
  // the freshly-cloned temp — a no-op on an empty workspace, and the overwrite on a
  // forced one. It runs only after `git clone` exits 0 (set -e), so existing work
  // survives a clone that fails for any reason (bad repo, network, auth).
  // node_modules is a BIND MOUNT (init.sh mounts the env's prebuilt deps there), so `rm` on it
  // fails "Device or resource busy" and aborted the whole overwrite (velsa). Skip it in the clear
  // AND the overlay — the mount stays put and the repo's files land around it. (`.git` is copied so
  // the clone is a real working tree.)
  await runShell(
    `set -e; rm -rf '${work}/.podbay-clone'; ` +
      `git clone --depth 1 '${url}' '${work}/.podbay-clone'; ` +
      `find '${work}' -mindepth 1 -maxdepth 1 ! -name .podbay-clone ! -name node_modules -exec rm -rf {} +; ` +
      `find '${work}/.podbay-clone' -mindepth 1 -maxdepth 1 ! -name node_modules -exec cp -a {} '${work}/' \\; ; ` +
      `rm -rf '${work}/.podbay-clone'`,
  );
  return { ok: true, dest: work };
}
