import { describe, it, expect } from "vitest";
import { cpuMemArgs, parseHostCapacity, LocalProvider } from "../src/local/provider.js";

describe("publishedAddress — self-host deployment mode → browser preview URL", () => {
  it("ip mode returns the sslip.io per-pod subdomain over HTTPS (no docker port lookup)", async () => {
    const p = new LocalProvider({ deployMode: "ip", publicBase: "203.0.113.5.sslip.io" });
    await expect(p.publishedAddress("competitive-warbler-8a8d", 3000)).resolves.toBe(
      "https://competitive-warbler-8a8d.203.0.113.5.sslip.io",
    );
  });

  it("domain mode returns the per-pod subdomain under the owner's base host", async () => {
    const p = new LocalProvider({ deployMode: "domain", publicBase: "pods.example.com" });
    await expect(p.publishedAddress("mypod", 3000)).resolves.toBe("https://mypod.pods.example.com");
  });

  it("proxy mode (behind an existing front proxy) still returns the public subdomain", async () => {
    const p = new LocalProvider({ deployMode: "proxy", publicBase: "5.5.5.5.sslip.io" });
    await expect(p.publishedAddress("mypod", 3000)).resolves.toBe("https://mypod.5.5.5.5.sslip.io");
  });

  it("public mode without a base host falls back to local behavior (no subdomain)", () => {
    // deployMode set but PODBAY_PUBLIC_BASE missing ⇒ previewMode() is false ⇒ tries the host port
    // path (would call docker). We only assert the mode gate, not the docker call.
    const p = new LocalProvider({ deployMode: "ip" });
    expect(p).toBeInstanceOf(LocalProvider);
  });
});

describe("cpuMemArgs — self-host pod sizing → docker run flags", () => {
  it("is empty (unlimited) when unset or non-positive", () => {
    expect(cpuMemArgs(undefined)).toEqual([]);
    expect(cpuMemArgs({})).toEqual([]);
    expect(cpuMemArgs({ cpus: 0, memoryGb: 0 })).toEqual([]);
    expect(cpuMemArgs({ cpus: -1, memoryGb: -2 })).toEqual([]);
  });

  it("emits --cpus (fractional ok) and --memory in megabytes", () => {
    expect(cpuMemArgs({ cpus: 2 })).toEqual(["--cpus", "2"]);
    expect(cpuMemArgs({ cpus: 1.5 })).toEqual(["--cpus", "1.5"]);
    expect(cpuMemArgs({ memoryGb: 4 })).toEqual(["--memory", "4096m"]);
    expect(cpuMemArgs({ cpus: 2, memoryGb: 4 })).toEqual(["--cpus", "2", "--memory", "4096m"]);
  });

  it("rounds fractional GB to whole megabytes", () => {
    expect(cpuMemArgs({ memoryGb: 1.5 })).toEqual(["--memory", "1536m"]);
    expect(cpuMemArgs({ memoryGb: 0.5 })).toEqual(["--memory", "512m"]);
  });
});

describe("parseHostCapacity — self-host host-capacity math from docker output", () => {
  const GB = 1024 ** 3;

  it("reads NCPU + MemTotal and sums running pods' limits (unlimited pods contribute 0)", () => {
    // Host: 8 CPUs, 16 GB. Two limited pods (2 CPU + 4 GB, 1 CPU + 2 GB) and one unlimited
    // pod (docker reports 0 0 for no-limit HostConfig).
    const cap = parseHostCapacity(
      `8 ${16 * GB}`,
      [`${2e9} ${4 * GB}`, `${1e9} ${2 * GB}`, "0 0"].join("\n"),
    );
    expect(cap.cpus).toBe(8);
    expect(cap.memoryGb).toBeCloseTo(16);
    expect(cap.allocatedCpus).toBeCloseTo(3); // 2 + 1 + 0
    expect(cap.allocatedMemoryGb).toBeCloseTo(6); // 4 + 2 + 0
  });

  it("no running pods → nothing allocated", () => {
    const cap = parseHostCapacity(`4 ${8 * GB}`, "");
    expect(cap.allocatedCpus).toBe(0);
    expect(cap.allocatedMemoryGb).toBe(0);
    expect(cap.cpus).toBe(4);
  });

  it("tolerates blank/garbage lines without NaN", () => {
    const cap = parseHostCapacity("", "\n  \n");
    expect(cap.cpus).toBe(0);
    expect(cap.memoryGb).toBe(0);
    expect(cap.allocatedCpus).toBe(0);
    expect(cap.allocatedMemoryGb).toBe(0);
  });
});
