import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);
const DOCTOR = new URL("../pod-base/podbay-doctor", import.meta.url).pathname;

/**
 * The diagnostic bundle exists so support never needs a shell on a user's pod.
 * That trade is only honest if the boundary holds, so these tests assert the
 * boundary rather than the feature: what it collects, and what it must never emit.
 */
describe("podbay doctor --report", () => {
  it("emits named sections — an unlabelled dump would just be a shell", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-report-"));
    const { stdout } = await run("bash", [DOCTOR, "--report"], {
      env: { ...process.env, PODBAY_HOME: home },
      maxBuffer: 4_000_000,
    });
    const report = JSON.parse(stdout);
    const names = report.sections.map((s: { name: string }) => s.name);
    // Every section is named, so a reader can see exactly what was taken.
    expect(names).toContain("disk-free");
    expect(names).toContain("processes");
    expect(names).toContain("zero-byte-files");
    expect(report.sections.every((s: { name: string }) => s.name.length > 0)).toBe(true);
  });

  it("reports process NAMES, never command lines", async () => {
    // An argument can carry a token ("node server.js --key=…"). A diagnostic bundle
    // that leaks a secret is worse than the outage it was collecting.
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-report-"));
    const { stdout } = await run("bash", [DOCTOR, "--report"], {
      env: { ...process.env, PODBAY_HOME: home },
      maxBuffer: 4_000_000,
    });
    const procs = JSON.parse(stdout).sections.find(
      (s: { name: string }) => s.name === "processes",
    );
    // ps -o comm gives "node", never "node /path/to/thing --flag=value".
    expect(procs.text).not.toMatch(/--\w+=/);
    expect(procs.text).not.toMatch(/\s\/\w+\/\S+\.(js|ts|sh)\b/);
  });

  it("redacts credential SHAPES out of anything it does collect", async () => {
    // The setup log is ours, but a clone URL or an echoed header could still carry
    // one; redaction is the belt to the boundary's braces.
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-report-"));
    await fs.writeFile(
      path.join(home, ".podbay-setup.log"),
      [
        "cloning https://x-user:supersecretvaluehere1234@github.com/a/b",
        "token=abcdefghijklmnopqrstuvwx",
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        "podbay: setup complete",
      ].join("\n"),
    );
    const { stdout } = await run("bash", [DOCTOR, "--report"], {
      env: { ...process.env, PODBAY_HOME: home },
      maxBuffer: 4_000_000,
    });
    const log = JSON.parse(stdout).sections.find(
      (s: { name: string }) => s.name === "podbay-setup-log",
    );
    expect(log.text).not.toContain("supersecretvaluehere1234");
    expect(log.text).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(log.text).toContain("REDACTED");
    // …while still being a useful log.
    expect(log.text).toContain("setup complete");
  });

  it("never reads the system journal", async () => {
    // The first version fell back to journalctl, which on a real pod returned sudo
    // lines carrying full COMMAND LINES — the exact thing the boundary excludes,
    // arriving through a section that claimed to be our own log.
    const src = await fs.readFile(DOCTOR, "utf8");
    const collectors = src.slice(src.indexOf("# ── REPORT BOUNDARY"), src.indexOf("emit_report()"));
    expect(collectors).not.toMatch(/journalctl/);
  });
});
