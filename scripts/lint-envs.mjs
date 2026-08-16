// Env-lint (pre-alpha-plan Phase 4): resolve every environments/* manifest so a
// broken podbay.yaml fails a PR instead of a launch. Uses the same resolver the
// control plane runs at launch, so "it lints" == "it launches". Run after the
// packages are built (needs @podbay/shared's dist).
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// Import the built dist directly — the root isn't a workspace member that
// depends on @podbay/shared, so bare-specifier resolution from /scripts fails.
import { resolveWithConfig } from "../packages/shared/dist/index.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "environments");

let failed = false;
for (const d of readdirSync(root, { withFileTypes: true })) {
  // Skip non-dirs and shared/partial dirs (leading underscore).
  if (!d.isDirectory() || d.name.startsWith("_") || d.name.startsWith(".")) continue;
  try {
    await resolveWithConfig(path.join(root, d.name));
    console.log(`ok   ${d.name}`);
  } catch (e) {
    console.error(`FAIL ${d.name}: ${e instanceof Error ? e.message : e}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
