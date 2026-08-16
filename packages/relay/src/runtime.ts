import type { RelayMode, RelaySource } from "./audit.js";

export type GatewayState = "connected" | "reconnecting" | "unavailable";

export interface ActiveRelayWork {
  id: string;
  source?: RelaySource;
  mode: RelayMode;
  target: string;
  startedAt: string;
  bytesUp?: number;
  bytesDown?: number;
}

export interface RelayRuntimeSnapshot {
  daemon: "running" | "stopped";
  gateway: GatewayState;
  stateSince: string;
  updatedAt: string;
  version: string;
  active: ActiveRelayWork[];
}

/** In-memory truth owned by the daemon; the dashboard reads snapshots, never state files. */
export class RelayRuntime {
  private gateway: GatewayState = "reconnecting";
  private stateSince: string;
  private readonly active = new Map<string, ActiveRelayWork>();

  constructor(
    private readonly options: { now?: () => number; version?: string; daemon?: "running" | "stopped" } = {},
  ) {
    this.stateSince = this.iso();
  }

  private now(): number { return (this.options.now ?? Date.now)(); }
  private iso(): string { return new Date(this.now()).toISOString(); }

  setGateway(state: GatewayState): void {
    if (state === this.gateway) return;
    this.gateway = state;
    this.stateSince = this.iso();
  }

  begin(work: Omit<ActiveRelayWork, "startedAt"> & { startedAt?: string }): void {
    this.active.set(work.id, {
      ...work,
      startedAt: work.startedAt ?? this.iso(),
      ...(work.mode === "tunnel" ? { bytesUp: work.bytesUp ?? 0, bytesDown: work.bytesDown ?? 0 } : {}),
    });
  }

  addBytes(id: string, direction: "up" | "down", count: number): void {
    const work = this.active.get(id);
    if (!work || work.mode !== "tunnel") return;
    if (direction === "up") work.bytesUp = (work.bytesUp ?? 0) + Math.max(0, count);
    else work.bytesDown = (work.bytesDown ?? 0) + Math.max(0, count);
  }

  finish(id: string): ActiveRelayWork | undefined {
    const work = this.active.get(id);
    this.active.delete(id);
    return work;
  }

  clearActive(): void { this.active.clear(); }

  snapshot(): RelayRuntimeSnapshot {
    return {
      daemon: this.options.daemon ?? "running",
      gateway: this.options.daemon === "stopped" ? "unavailable" : this.gateway,
      stateSince: this.stateSince,
      updatedAt: this.iso(),
      version: this.options.version ?? "unknown",
      active: [...this.active.values()].map((work) => ({ ...work, source: work.source ? { ...work.source } : undefined })),
    };
  }
}
