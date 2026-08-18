import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createNeonDb, createAppDb, schema } from "@podbay/db";
import { notifySignup, sendNewRequestEmail } from "./notify.js";
import { mintActionToken } from "./action-token.js";

export * from "./notify.js";
export * from "./action-token.js";

/**
 * Shared better-auth configuration + session helpers, used by both apps/web and
 * the terminal gateway so they validate sessions identically. No framework
 * imports; reads only server-side secrets.
 */
export interface AuthEnv {
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** e.g. ".podbay.cloud" — scopes the session cookie so subdomains (the gateway) can read it. */
  COOKIE_DOMAIN?: string;
  /** comma-separated allowed origins, e.g. "https://podbay.cloud,https://gw.podbay.cloud". */
  TRUSTED_ORIGINS?: string;
  /** "1" enables test-only email+password sign-in (never in production). */
  PODBAY_TEST_LOGIN?: string;
  /** "oss" ⇒ the self-host edition: email+password login (no GitHub OAuth). */
  PODBAY_EDITION?: string;
}

export type Auth = ReturnType<typeof createAuth>;

/** Self-host edition — email+password is the login mechanism (no GitHub OAuth app on a self-host box). */
export function isOssEdition(env: AuthEnv): boolean {
  return env.PODBAY_EDITION === "oss";
}

/**
 * The trusted origin(s) for better-auth's CSRF check in OSS, derived from the request's OWN host —
 * because a self-host install is served on an unknowable origin (the owner's VPS IP, a domain, or
 * localhost:8080). A legit same-origin request has `Origin === Host` and passes; a cross-origin CSRF
 * sends `Origin: evil.com` but `Host: <this box>`, so it's rejected. Caddy (the single ingress)
 * preserves Host and sets x-forwarded-host/proto. Returns [] when no host header is present.
 */
export function ossTrustedOrigins(headers?: Headers): string[] {
  if (!headers) return [];
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return [];
  const proto = (headers.get("x-forwarded-proto") ?? "http").split(",")[0].trim() || "http";
  return [`${proto}://${host}`];
}

export function isAuthConfigured(env: AuthEnv): boolean {
  // OSS: no GitHub OAuth — the owner logs in with email+password, so a database + a session secret
  // is all that's required. (The email+password plugin needs no external provider.)
  if (isOssEdition(env)) return Boolean(env.DATABASE_URL && env.BETTER_AUTH_SECRET);
  return Boolean(
    env.DATABASE_URL && env.BETTER_AUTH_SECRET && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
  );
}

/** Test-only email+password sign-in — enabled for e2e/local, never in production. */
export function isTestLoginEnabled(env: AuthEnv = process.env as AuthEnv): boolean {
  return env.PODBAY_TEST_LOGIN === "1" && process.env.NODE_ENV !== "production";
}

export function createAuth(env: AuthEnv) {
  const testLogin = isTestLoginEnabled(env);
  const oss = isOssEdition(env);
  if (!testLogin && !isAuthConfigured(env)) {
    throw new Error(
      "auth is not configured: set DATABASE_URL, BETTER_AUTH_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET",
    );
  }
  const db = process.env.PODBAY_DB ? createAppDb() : createNeonDb(env.DATABASE_URL);
  const explicitTrusted = env.TRUSTED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const hasGithub = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  // Email+password is the login for OSS (the owner) and for e2e; both have no SMTP, so a created
  // account is trusted-verified (see the create.before hook below).
  const emailPassword = testLogin || oss;
  // Trusted origins for better-auth's CSRF origin check. Explicit TRUSTED_ORIGINS wins. Otherwise,
  // OSS is served on an UNKNOWABLE origin (the owner's VPS IP, a domain, or localhost:8080), so
  // trust the request's OWN host: a legit same-origin request has Origin == Host and passes; a
  // cross-origin CSRF from evil.com sends Origin=evil.com but Host=<this box>, so it's rejected.
  // (Caddy — the single ingress — preserves Host and sets x-forwarded-host/proto.)
  const trustedOrigins = explicitTrusted?.length
    ? explicitTrusted
    : oss
      ? (request?: Request): string[] => ossTrustedOrigins(request?.headers)
      : undefined;
  // Cookie security context. better-auth infers useSecureCookies from the request/baseURL, but with
  // NODE_ENV=production and NEITHER a baseURL NOR a resolvable request origin (the case for serve's
  // terminal-WS session check), it falls back to assuming a SECURE context and then rejects the
  // plain-HTTP session cookie — silently returning no session (the self-host terminal-401 bug). A
  // self-host install is HTTP by default (or the owner terminates TLS at their own proxy), so force
  // non-secure cookies in OSS unless the owner declared an https origin via BETTER_AUTH_URL.
  const advanced: Record<string, unknown> = {};
  if (env.COOKIE_DOMAIN) advanced.crossSubDomainCookies = { enabled: true, domain: env.COOKIE_DOMAIN };
  if (oss && !env.BETTER_AUTH_URL?.startsWith("https://")) advanced.useSecureCookies = false;
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    ...(trustedOrigins ? { trustedOrigins } : {}),
    ...(Object.keys(advanced).length ? { advanced } : {}),
    // Email+password sign-in — e2e (test) and the OSS owner. Cloud stays GitHub-only.
    ...(emailPassword ? { emailAndPassword: { enabled: true } } : {}),
    ...(hasGithub
      ? {
          socialProviders: {
            github: {
              clientId: env.GITHUB_CLIENT_ID as string,
              clientSecret: env.GITHUB_CLIENT_SECRET as string,
            },
          },
        }
      : {}),
    databaseHooks: {
      user: {
        create: {
          // Test-login signs up with email+password, which better-auth marks
          // `emailVerified: false`. Production has no such path — GitHub OAuth is the ONLY
          // way in and it always verifies — so an unverified user is a TEST ARTIFACT, not a
          // real state. Once `requireAdmin` began (correctly) demanding a verified email,
          // that artifact silently redirected every admin-gated e2e test to /dashboard: 15
          // "element not found" failures whose real cause was the sign-up path, not the UI.
          // Mirror production here rather than weakening the gate the tests exist to protect.
          // Email+password sign-up (e2e or the OSS owner) has no SMTP to verify against, so a
          // created account is trusted-verified — otherwise verified-email gates would reject the
          // owner on a self-host box that can't send mail.
          ...(emailPassword
            ? {
                before: async (user: Record<string, unknown>) => {
                  // OSS is single-owner: refuse a second account. The guard is "does an owner
                  // credential already exist" — false for the legitimate first-run sign-up (no
                  // credential yet), true for any later attempt. Immune to a stray no-credential
                  // user row. Throwing aborts better-auth's sign-up.
                  if (oss && (await ownerCredentialExists(db))) {
                    throw new Error("This self-host install already has an owner.");
                  }
                  // OSS: the created account IS the owner — approve it so it doesn't land on
                  // /pending (the cloud invite gate is meaningless single-tenant).
                  return { data: { ...user, emailVerified: true, ...(oss ? { approved: true } : {}) } };
                },
              }
            : {}),
          after: async (created: { id: string; name?: string | null; email: string }) => {
            // No ops mailbox to notify on a self-host install — the "signup" is just the owner.
            if (oss) return;
            await notifySignup({ name: created.name, email: created.email });
            // Email the operator a new-request alert with ONE-CLICK Approve / Later links (each a
            // capability token only the server could mint). Best-effort — sendNewRequestEmail no-ops
            // if Gmail isn't configured; nothing here may fail the signup.
            const adminEmail =
              process.env.PODBAY_ADMIN_NOTIFY_EMAIL ||
              process.env.ADMIN_EMAILS?.split(",")[0]?.trim();
            if (adminEmail) {
              const base = (process.env.PODBAY_PUBLIC_URL || "https://podbay.cloud").replace(/\/+$/, "");
              const link = (a: "approve" | "later"): string =>
                `${base}/admin/quick?t=${encodeURIComponent(mintActionToken(a, created.id, Date.now()))}`;
              await sendNewRequestEmail(
                adminEmail,
                { name: created.name, email: created.email },
                { approveUrl: link("approve"), laterUrl: link("later") },
              );
            }
          },
        },
      },
    },
  });
}

/** Resolve request headers to the signed-in user's id, or null. */
export async function getSessionUserId(auth: Auth, headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers });
  return session?.user?.id ?? null;
}

/**
 * Self-host owner helpers (single-tenant). The "owner" is the one user that has a password
 * credential (a `credential` account row). Used to switch first-run setup vs login (web) and to
 * resolve the served path's owner id (serve daemon). `db` is a @podbay/db app db.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ownerCredentialExists(db: any): Promise<boolean> {
  return (await resolveOwnerId(db)) != null;
}

/** The single owner's user id (the one account with a password credential), or null before
 * first-run setup. Single-tenant, so the `account` table is tiny — filtering in JS avoids pulling a
 * drizzle operator dependency into this package. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveOwnerId(db: any): Promise<string | null> {
  const rows: Array<{ userId: string; password: string | null }> = await db
    .select({ userId: schema.account.userId, password: schema.account.password })
    .from(schema.account);
  return rows.find((r) => r.password)?.userId ?? null;
}
