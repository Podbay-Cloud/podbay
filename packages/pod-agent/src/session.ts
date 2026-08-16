import * as pty from "node-pty";

export interface PtySessionOptions {
  /** tmux session name (attach-or-create). */
  sessionName: string;
  cwd?: string;
  /** Env overrides merged over process.env. A plain map — not NodeJS.ProcessEnv,
   * whose required NODE_ENV would reject partial object literals under strict tsc. */
  env?: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
  /** Command run only when the tmux session is first created. */
  bootCommand?: string;
  /** Drop privileges to this uid/gid when spawning (e.g. the pod's `dev` user). */
  uid?: number;
  gid?: number;
}

/**
 * A PTY attached to a persistent tmux session (`tmux new -A`). The tmux session
 * outlives this process; disconnect never ends the work. Tracks activity on both
 * input and output for idle reporting.
 */
export class PtySession {
  private readonly p: pty.IPty;
  readonly sessionName: string;
  private lastActivity = Date.now();
  private readonly dataListeners = new Set<(d: string) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();
  private exited = false;

  constructor(opts: PtySessionOptions) {
    this.sessionName = opts.sessionName;
    const args = ["new", "-A", "-s", opts.sessionName];
    if (opts.bootCommand) args.push(opts.bootCommand);
    this.p = pty.spawn("tmux", args, {
      name: "xterm-256color",
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd ?? process.env.HOME,
      env: { ...process.env, ...opts.env },
      // Drop to the pod's unprivileged user for the shell (pod-agent itself runs
      // as root only to perform first-boot seeding). No-op when unset (tests).
      ...(opts.uid !== undefined ? { uid: opts.uid } : {}),
      ...(opts.gid !== undefined ? { gid: opts.gid } : {}),
    });
    this.p.onData((d) => {
      this.lastActivity = Date.now();
      for (const l of this.dataListeners) l(d);
    });
    this.p.onExit(({ exitCode }) => {
      this.exited = true;
      for (const l of this.exitListeners) l(exitCode);
    });
  }

  write(data: string): void {
    this.lastActivity = Date.now();
    this.p.write(data);
  }

  resize(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.p.resize(cols, rows);
  }

  onData(l: (d: string) => void): () => void {
    this.dataListeners.add(l);
    return () => this.dataListeners.delete(l);
  }

  onExit(l: (code: number) => void): () => void {
    this.exitListeners.add(l);
    return () => this.exitListeners.delete(l);
  }

  idleMs(): number {
    return Date.now() - this.lastActivity;
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  /** Detach the PTY without killing the tmux session (it persists on the server). */
  dispose(): void {
    try {
      this.p.kill();
    } catch {
      /* already gone */
    }
  }

  /** Kill the underlying tmux session (used by tests for cleanup). */
  async killSession(): Promise<void> {
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve) => {
      execFile("tmux", ["kill-session", "-t", this.sessionName], () => resolve());
    });
    this.dispose();
  }
}
