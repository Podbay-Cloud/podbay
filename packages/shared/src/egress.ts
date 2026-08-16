/**
 * Effective egress allowlist per network policy. Domains here are matched as
 * host suffixes by the in-pod proxy (see init.sh) — `github.com` also allows
 * `api.github.com`.
 */

/** Always allowed when enforcing: the agent CLIs' own endpoints (so the agent
 * works and can log in / call home) + nothing else. */
export const BASE_ALLOWLIST: readonly string[] = [
  // Claude / Anthropic
  "anthropic.com",
  "claude.ai",
  "claude.com",
  "sentry.io",
  // Codex / OpenAI
  "openai.com",
  "chatgpt.com",
  "oaistatic.com",
];

/** `trusted` adds a curated developer set on top of the base. */
export const TRUSTED_ALLOWLIST: readonly string[] = [
  // package registries
  "npmjs.org",
  "yarnpkg.com",
  "pnpm.io",
  "pypi.org",
  "pythonhosted.org",
  "crates.io",
  "rubygems.org",
  // source hosts
  "github.com",
  "githubusercontent.com",
  "gitlab.com",
  // runtimes / system packages
  "nodejs.org",
  "deb.debian.org",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  // common CDNs used by installs
  "jsdelivr.net",
  "unpkg.com",
  "cloudflare.com",
];

/**
 * Hosts the web-fetch ladder needs, per rung, when egress is ENFORCED.
 *
 * Only the fixed-host rungs can appear here. `api` and `direct` fetch whatever the
 * research target happens to be, so no allowlist can cover them — under a
 * restricted policy those rungs are blocked by design and the reader/archive rungs
 * are the working path. That is a real limit, and stating it here is better than an
 * agent discovering it as a mystery connection failure mid-task.
 */
export const WEBFETCH_RUNG_HOSTS: Readonly<Record<string, readonly string[]>> = {
  api: [],
  direct: [],
  archive: ["web.archive.org", "archive.org"],
  service: ["r.jina.ai", "jina.ai"],
  // The relay runs on the OWNER's machine at a URL only they know, so it cannot be
  // baked in; a `custom` env must add its own host via network.allow.
  relay: [],
};

/** Every rung, in ladder order — the default when an env doesn't restrict them. */
export const WEBFETCH_ALL_RUNGS: readonly string[] = ["api", "direct", "archive", "service", "relay"];

export interface WebFetchCapability {
  enabled: boolean;
  rungs?: readonly string[];
}

/** The extra hosts a web-fetch-enabled env needs on top of its policy. */
export function webFetchDomains(cap?: WebFetchCapability): string[] {
  if (!cap?.enabled) return [];
  const rungs = cap.rungs ?? WEBFETCH_ALL_RUNGS;
  return rungs.flatMap((r) => [...(WEBFETCH_RUNG_HOSTS[r] ?? [])]);
}

export type NetworkPolicy = "none" | "trusted" | "full" | "custom";

export interface EffectiveEgress {
  /** When false, no restriction is applied (policy `full`). */
  enforce: boolean;
  /** Host suffixes allowed through the proxy (deduped, sorted). */
  domains: string[];
}

/**
 * Resolve a policy + author allow-list into the enforced egress config.
 *
 * `webFetch` is folded in here rather than left to each env author: an env that
 * declares the capability and a restricted policy would otherwise ship an agent
 * instructed to use a reader service it cannot reach — the skill says "use
 * r.jina.ai", the proxy says no, and the failure looks like a broken network rather
 * than a policy decision. Declaring the capability is what asks for those hosts.
 */
export function effectiveAllowlist(
  policy: NetworkPolicy,
  allow: string[] = [],
  webFetch?: WebFetchCapability,
): EffectiveEgress {
  if (policy === "full") return { enforce: false, domains: [] };
  const extra =
    policy === "trusted" ? TRUSTED_ALLOWLIST : policy === "custom" ? allow : /* none */ [];
  const domains = [
    ...new Set(
      [...BASE_ALLOWLIST, ...extra, ...webFetchDomains(webFetch)].map((d) => d.trim().toLowerCase()),
    ),
  ]
    .filter(Boolean)
    .sort();
  return { enforce: true, domains };
}
