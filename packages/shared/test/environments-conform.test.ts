import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvironment } from "../src/index.js";

const envRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
);

/** Every first-party environment under environments/ must validate (5.2). */
describe("first-party environments conform to podbay/v0", () => {
  it("all environments/*/podbay.yaml validate", async () => {
    const entries = await fs.readdir(envRoot, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    expect(dirs.length).toBeGreaterThan(0);

    for (const d of dirs) {
      const yamlPath = path.join(envRoot, d.name, "podbay.yaml");
      const yaml = await fs.readFile(yamlPath, "utf8").catch(() => null);
      if (yaml === null) continue; // dir without a podbay.yaml is not an environment
      const r = validateEnvironment(yaml);
      expect(r.ok, `${d.name}: ${r.errors.join("; ")}`).toBe(true);
    }
  });
});
