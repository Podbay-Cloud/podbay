/** Minimal Fly Machines/Volumes surface the provider needs. */

export interface FlyMachineFile {
  guest_path: string;
  raw_value: string; // base64
}

export interface FlyMachineConfig {
  image: string;
  guest: { cpu_kind: string; cpus: number; memory_mb: number };
  env?: Record<string, string>;
  mounts?: { volume: string; path: string }[];
  metadata?: Record<string, string>;
  files?: FlyMachineFile[];
  auto_destroy?: boolean;
  restart?: { policy: string };
}

export interface FlyMachine {
  id: string;
  /** created | starting | started | stopping | stopped | suspended | destroying | destroyed */
  state: string;
  region: string;
  private_ip?: string;
  config: FlyMachineConfig;
}

export interface FlyVolume {
  id: string;
  name: string;
  region: string;
}

export interface CreateMachineInput {
  region: string;
  config: FlyMachineConfig;
}

export interface CreateVolumeInput {
  name: string;
  region: string;
  size_gb: number;
}

/** The operations FlyProvider depends on. Real impl = FlyHttpClient; tests = in-memory fake. */
export interface FlyApi {
  listMachines(): Promise<FlyMachine[]>;
  getMachine(id: string): Promise<FlyMachine | null>;
  createMachine(input: CreateMachineInput): Promise<FlyMachine>;
  suspendMachine(id: string): Promise<void>;
  startMachine(id: string): Promise<void>;
  stopMachine(id: string): Promise<void>;
  destroyMachine(id: string): Promise<void>;
  updateMachineMetadata(id: string, key: string, value: string): Promise<void>;
  /** Replace a machine's config (Fly's update is a full-config POST, so callers
   * read the current config and hand back a modified copy — never a partial). */
  updateMachine(id: string, config: FlyMachineConfig): Promise<FlyMachine>;
  /** Block until the machine reaches `state` (or timeout). */
  waitForState(id: string, state: string, timeoutSec?: number): Promise<void>;
  execMachine(
    id: string,
    command: string[],
  ): Promise<{ exit_code: number; stdout: string; stderr: string }>;
  listVolumes(): Promise<FlyVolume[]>;
  createVolume(input: CreateVolumeInput): Promise<FlyVolume>;
  destroyVolume(id: string): Promise<void>;
  snapshotVolume(id: string): Promise<{ id: string }>;
}
