import { ProviderError } from "./types.js";

export interface FlyConfig {
  apiToken: string;
  /** Fly app that holds all pod machines. */
  appName: string;
  /** Default region for new pods. */
  region: string;
  /** Default guest sizing. `cpuKind`: "shared" | "performance" (dedicated). */
  guest: { cpuKind: string; cpus: number; memoryMb: number };
  /** Volume size (GB) per pod. */
  volumeSizeGb: number;
  /** Base image booted for pods (until per-env image build exists). */
  baseImage: string;
  /** Fly Machines API base URL. */
  apiBaseUrl: string;
  /** Port the in-pod agent listens on. */
  agentPort: number;
}

const DEFAULTS = {
  region: "fra",
  // Dedicated CPUs: shared cores starve the agent CLI + dev server + builds
  // (12-minute onboarding, janky terminal). Suspend-on-idle keeps cost ~0 when
  // inactive, so size for the ACTIVE experience. Override via PODBAY_POD_*.
  guest: { cpuKind: "performance", cpus: 2, memoryMb: 4096 },
  volumeSizeGb: 10,
  baseImage: "registry.fly.io/podbay-pod-base:latest",
  apiBaseUrl: "https://api.machines.dev/v1",
  agentPort: 8080,
};

/** Build a FlyConfig from explicit values or environment variables. */
export function loadFlyConfig(overrides: Partial<FlyConfig> = {}): FlyConfig {
  const apiToken = overrides.apiToken ?? process.env.FLY_API_TOKEN ?? "";
  const appName = overrides.appName ?? process.env.PODBAY_PODS_APP ?? "podbay-pods";
  if (!apiToken) {
    throw new ProviderError("FLY_API_TOKEN is required", "invalid");
  }
  return {
    apiToken,
    appName,
    region: overrides.region ?? process.env.PODBAY_REGION ?? DEFAULTS.region,
    guest: overrides.guest ?? {
      cpuKind: process.env.PODBAY_POD_CPU_KIND ?? DEFAULTS.guest.cpuKind,
      cpus: Number(process.env.PODBAY_POD_CPUS ?? DEFAULTS.guest.cpus),
      memoryMb: Number(process.env.PODBAY_POD_MEMORY_MB ?? DEFAULTS.guest.memoryMb),
    },
    volumeSizeGb: overrides.volumeSizeGb ?? DEFAULTS.volumeSizeGb,
    baseImage: overrides.baseImage ?? process.env.PODBAY_BASE_IMAGE ?? DEFAULTS.baseImage,
    apiBaseUrl: overrides.apiBaseUrl ?? DEFAULTS.apiBaseUrl,
    agentPort: overrides.agentPort ?? DEFAULTS.agentPort,
  };
}
