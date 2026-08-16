import {
  isAgentMessage,
  type AgentMessage,
  type ClientMessage,
  type WindowInfo,
} from "@podbay/shared/protocol";

/** Minimal WebSocket surface so the client is testable with a mock. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

// "lost" = gave up auto-reconnecting after maxAttempts (the pod is likely removed
// or suspended); the UI shows a manual Reconnect instead of looping forever.
export type ConnState = "connecting" | "connected" | "disconnected" | "lost";

export interface TerminalClientEvents {
  output: (data: string) => void;
  links: (urls: string[]) => void;
  status: (s: {
    idleMs: number;
    idle: boolean;
    ready: boolean;
    paneChars?: number;
    /** The agent's login state (per-pod login) — drives the launch wizard. */
    cred?: { agent: string; authed: boolean; hash: string };
  }) => void;
  exit: (code: number) => void;
  state: (state: ConnState) => void;
  /** The pod's tmux windows — the web terminal's tab strip (cheap-tabs). */
  windows: (windows: WindowInfo[]) => void;
}

export interface TerminalClientOptions {
  /** Gateway base URL, e.g. wss://gateway.podbay.cloud */
  gatewayUrl: string;
  podId: string;
  /** Injectable socket factory (defaults to browser WebSocket). */
  socketFactory?: (url: string) => SocketLike;
  reconnect?: boolean;
  maxBackoffMs?: number;
  /** Give up auto-reconnecting after this many consecutive failures (then emit
   * "lost" and wait for a manual reconnect()). Stops a tab left open on a removed
   * or suspended pod from retrying the gateway forever. Default 8. */
  maxAttempts?: number;
}

const OPEN = 1;

/**
 * Framework-agnostic terminal client: manages the gateway WebSocket, speaks the
 * @podbay/shared wire protocol, and reconnects on unexpected drops.
 */
export class TerminalClient {
  private ws: SocketLike | null = null;
  private manualClose = false;
  private backoff = 500;
  private attempts = 0;
  private readonly listeners: { [K in keyof TerminalClientEvents]: Set<TerminalClientEvents[K]> } = {
    output: new Set(),
    links: new Set(),
    status: new Set(),
    exit: new Set(),
    state: new Set(),
    windows: new Set(),
  };

  constructor(private readonly opts: TerminalClientOptions) {}

  private get url(): string {
    // Same-origin mode: gatewayUrl "auto" means "the gateway is reachable at this page's own
    // origin" (a reverse proxy routes /pods/* to it — the self-host compose install). Derive
    // ws(s):// from the page location, so the install needs no baked gateway URL and works on
    // localhost and a VPS domain alike. "" still means "no gateway" (pages show their fallback).
    const base =
      this.opts.gatewayUrl === "auto" && typeof location !== "undefined"
        ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
        : this.opts.gatewayUrl;
    return `${base.replace(/\/$/, "")}/pods/${encodeURIComponent(this.opts.podId)}`;
  }

  private makeSocket(url: string): SocketLike {
    if (this.opts.socketFactory) return this.opts.socketFactory(url);
    return new WebSocket(url) as unknown as SocketLike;
  }

  on<K extends keyof TerminalClientEvents>(event: K, cb: TerminalClientEvents[K]): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  private emit<K extends keyof TerminalClientEvents>(
    event: K,
    ...args: Parameters<TerminalClientEvents[K]>
  ): void {
    for (const cb of this.listeners[event]) (cb as (...a: unknown[]) => void)(...args);
  }

  connect(): void {
    this.manualClose = false;
    this.emit("state", "connecting");
    const ws = this.makeSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.attempts = 0;
      this.emit("state", "connected");
    };
    ws.onmessage = (ev) => this.handle(String(ev.data));
    ws.onerror = () => {
      /* close handler drives reconnect */
    };
    ws.onclose = () => {
      this.emit("state", "disconnected");
      if (!this.manualClose && this.opts.reconnect !== false) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    // Give up after N consecutive failures so a tab on a removed/suspended pod
    // doesn't retry the gateway forever — surface "lost" and wait for a manual
    // reconnect() (the UI shows a Reconnect button).
    if (++this.attempts > (this.opts.maxAttempts ?? 8)) {
      this.emit("state", "lost");
      return;
    }
    const max = this.opts.maxBackoffMs ?? 8000;
    const delay = Math.min(this.backoff, max);
    this.backoff = Math.min(this.backoff * 2, max);
    setTimeout(() => {
      if (!this.manualClose) this.connect();
    }, delay);
  }

  /** Manual reconnect after "lost" — resets the give-up counter and dials again. */
  reconnect(): void {
    this.attempts = 0;
    this.backoff = 500;
    this.connect();
  }

  private handle(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isAgentMessage(msg)) return;
    const m = msg as AgentMessage;
    switch (m.type) {
      case "output":
        this.emit("output", m.data);
        break;
      case "links":
        this.emit("links", m.urls);
        break;
      case "status":
        this.emit("status", {
          idleMs: m.idleMs,
          idle: m.idle,
          ready: m.ready,
          paneChars: m.paneChars,
          cred: m.cred,
        });
        break;
      case "windows":
        this.emit("windows", m.windows);
        break;
      case "exit":
        this.emit("exit", m.code);
        break;
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInput(data: string): void {
    this.send({ type: "input", data });
  }
  sendResize(cols: number, rows: number): void {
    this.send({ type: "resize", cols, rows });
  }
  /** Open a new tmux window (the tab strip's "+"). Ignored by pods on an image
   * that predates the protocol message — the "+" simply does nothing there. */
  createWindow(): void {
    this.send({ type: "new-window" });
  }

  /** Switch the active tmux window (a tab click). */
  selectWindow(index: number): void {
    this.send({ type: "select-window", index });
  }

  close(): void {
    this.manualClose = true;
    this.ws?.close();
    this.ws = null;
  }
}
