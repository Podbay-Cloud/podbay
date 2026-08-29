import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PreviewShotter, _internal } from "../src/preview-shot.js";

// Runs where the prebaked headless Chromium exists (the pod image + this dev pod); SKIPs otherwise
// (a bare CI box) rather than failing spuriously — same posture as the golden-path CLI tests.
const hasBinary = Boolean(_internal.findShellBinary());

describe("PreviewShotter", () => {
  it.runIf(hasBinary)(
    "captures a PNG thumbnail of a local server",
    async () => {
      const server = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body style='background:#123;color:#fff'>preview</body></html>");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      const port = (server.address() as AddressInfo).port;
      try {
        const shot = new PreviewShotter({ port, maxAgeMs: 60_000, width: 800, height: 500 });
        const buf = await shot.get();
        expect(buf, "expected a captured buffer").toBeTruthy();
        // PNG magic number — proves it's a real image, not an error page.
        expect(buf!.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        // The second call is served from cache (same buffer instance), not a fresh capture.
        expect(await shot.get()).toBe(buf);
      } finally {
        server.close();
      }
    },
    30_000,
  );

  it.skipIf(hasBinary)("reports no binary where Chromium is absent", () => {
    expect(_internal.findShellBinary()).toBeNull();
  });
});
