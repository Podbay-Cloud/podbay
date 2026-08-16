import { ProviderError } from "../types.js";
import type { IncusConfig } from "./provider.js";
import type { IncusClientOptions } from "./http-client.js";

/**
 * Env-driven Incus wiring (infra-strategy.md M1). The provider is only
 * constructed when PODBAY_INCUS_URL is set — Fly-only deployments never touch
 * this. Cert/key are PEM contents (Fly secrets carry multiline values fine).
 */

export function isIncusConfigured(env = process.env): boolean {
  return Boolean(env.PODBAY_INCUS_URL);
}

export function loadIncusClientOptions(env = process.env): IncusClientOptions {
  const baseUrl = env.PODBAY_INCUS_URL;
  const clientCertPem = env.PODBAY_INCUS_CLIENT_CERT;
  const clientKeyPem = env.PODBAY_INCUS_CLIENT_KEY;
  if (!baseUrl || !clientCertPem || !clientKeyPem) {
    throw new ProviderError(
      "PODBAY_INCUS_URL, PODBAY_INCUS_CLIENT_CERT and PODBAY_INCUS_CLIENT_KEY are all required",
      "invalid",
    );
  }
  return { baseUrl, clientCertPem, clientKeyPem, project: env.PODBAY_INCUS_PROJECT ?? "podbay" };
}

export function loadIncusConfig(env = process.env): IncusConfig {
  return {
    pool: env.PODBAY_INCUS_POOL ?? "podbay",
    imageAlias: env.PODBAY_INCUS_IMAGE_ALIAS ?? "pod-base",
    // Fingerprint printed by scripts/incus/build-image.sh at publish time.
    imageDigest: env.PODBAY_INCUS_IMAGE_DIGEST ?? "",
    region: env.PODBAY_INCUS_REGION ?? "hetzner-eu",
    agentPort: Number(env.PODBAY_INCUS_AGENT_PORT ?? 8080),
    cpus: Number(env.PODBAY_INCUS_POD_CPUS ?? 2),
    memoryGb: Number(env.PODBAY_INCUS_POD_MEMORY_GB ?? 4),
    homeVolumeGb: Number(env.PODBAY_INCUS_POD_HOME_GB ?? 10),
  };
}
