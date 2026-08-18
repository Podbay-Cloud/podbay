import { spawn, type ChildProcess } from "node:child_process";

/**
 * Keep the machine from idle-sleeping the relay while it runs — OPT-IN (`relay start --keep-awake`),
 * for a Mac meant to stay online 24/7. The hardened heartbeat already survives normal App-Nap timer
 * throttling; this is the stronger "never let the Mac idle-sleep out from under the relay" lever a
 * dedicated host wants.
 *
 * macOS: `caffeinate -is -w <our pid>` asserts prevent-idle-sleep (+ prevent-system-sleep on AC) and
 * auto-RELEASES when this relay process exits (via `-w`), so a crash never leaves the Mac stuck awake;
 * we also kill it on a clean stop. Other platforms: a best-effort note — idle-sleep there is the
 * user's power settings / service manager to own, not ours to hijack.
 *
 * Returns a `release()` to drop the assertion early.
 */
export function keepAwake(log: (m: string) => void): () => void {
  if (process.platform !== "darwin") {
    log("keep-awake: macOS only — on Linux/Windows use your power settings or a service manager");
    return () => {};
  }
  let child: ChildProcess | undefined;
  try {
    child = spawn("caffeinate", ["-is", "-w", String(process.pid)], { stdio: "ignore" });
    child.on("error", () => log("keep-awake: `caffeinate` unavailable — skipped"));
    child.unref();
    log("keep-awake: ON — this Mac won't idle-sleep while the relay is running");
  } catch {
    log("keep-awake: could not start `caffeinate` — skipped");
  }
  return () => {
    try {
      child?.kill();
    } catch {
      /* already gone */
    }
  };
}
