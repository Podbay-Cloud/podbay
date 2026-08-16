import type {
  CreateMachineInput,
  CreateVolumeInput,
  FlyApi,
  FlyMachine,
  FlyVolume,
} from "../src/fly/api.js";

/** In-memory FlyApi for deterministic provider tests. */
export class FakeFly implements FlyApi {
  machines = new Map<string, FlyMachine>();
  volumes = new Map<string, FlyVolume>();
  execHandler: (id: string, command: string[]) => { exit_code: number; stdout: string; stderr: string } =
    () => ({ exit_code: 0, stdout: "", stderr: "" });
  suspendSupported = true;
  private seq = 0;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq.toString().padStart(4, "0")}`;
  }

  async listMachines(): Promise<FlyMachine[]> {
    return [...this.machines.values()];
  }
  async getMachine(id: string): Promise<FlyMachine | null> {
    return this.machines.get(id) ?? null;
  }
  async createMachine(input: CreateMachineInput): Promise<FlyMachine> {
    const id = this.id("machine");
    const m: FlyMachine = {
      id,
      state: "started",
      region: input.region,
      private_ip: `fdaa:0:${this.seq}::1`,
      config: input.config,
    };
    this.machines.set(id, m);
    return m;
  }
  async suspendMachine(id: string): Promise<void> {
    if (!this.suspendSupported) {
      const { ProviderError } = await import("../src/types.js");
      throw new ProviderError("suspend unsupported", "unsupported");
    }
    this.mut(id, (m) => (m.state = "suspended"));
  }
  async startMachine(id: string): Promise<void> {
    this.mut(id, (m) => (m.state = "started"));
  }
  async stopMachine(id: string): Promise<void> {
    this.mut(id, (m) => (m.state = "stopped"));
  }
  async destroyMachine(id: string): Promise<void> {
    this.machines.delete(id);
  }
  async updateMachineMetadata(id: string, key: string, value: string): Promise<void> {
    this.mut(id, (m) => {
      m.config.metadata = { ...(m.config.metadata ?? {}), [key]: value };
    });
  }
  async waitForState(): Promise<void> {
    // fake machines are created already "started"; nothing to wait for
  }
  async execMachine(id: string, command: string[]) {
    if (!this.machines.has(id)) {
      const { ProviderError } = await import("../src/types.js");
      throw new ProviderError("machine not found", "not_found");
    }
    return this.execHandler(id, command);
  }
  async listVolumes(): Promise<FlyVolume[]> {
    return [...this.volumes.values()];
  }
  async createVolume(input: CreateVolumeInput): Promise<FlyVolume> {
    const id = this.id("vol");
    const v: FlyVolume = { id, name: input.name, region: input.region };
    this.volumes.set(id, v);
    return v;
  }
  async destroyVolume(id: string): Promise<void> {
    this.volumes.delete(id);
  }
  async snapshotVolume(id: string): Promise<{ id: string }> {
    return { id: `snap_of_${id}` };
  }

  private mut(id: string, fn: (m: FlyMachine) => void) {
    const m = this.machines.get(id);
    if (m) fn(m);
  }
}
