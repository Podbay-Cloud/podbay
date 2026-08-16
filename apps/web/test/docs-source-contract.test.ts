import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceAdapter = readFileSync(
  new URL("../lib/docs-source.ts", import.meta.url),
  "utf8",
);

function mdxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const pathname = join(directory, entry.name);
    if (entry.isDirectory()) return mdxFiles(pathname);
    return entry.name.endsWith(".mdx") ? [pathname] : [];
  });
}

describe("public docs content adapter", () => {
  it("materializes MDX files for the Fumadocs Core 15 source contract", () => {
    expect(sourceAdapter).toContain("resolveFiles({ docs, meta })");
    expect(sourceAdapter).not.toContain("createMDXSource(docs, meta)");
  });

  it("preserves the generated MDX page-data type at the adapter boundary", () => {
    expect(sourceAdapter).toContain("Source<DocsSourceConfig>");
    expect(sourceAdapter).toContain('as Source<DocsSourceConfig>["files"]');
    expect(sourceAdapter).toContain("loader(contentSource");
  });

  it("keeps agent command syntax out of the human documentation", () => {
    const docsDirectory = fileURLToPath(new URL("../content/docs/", import.meta.url));
    const agentCommand = /\bpodbay\s+(?:info|preview|link|doctor|dev|secrets|schedule|startup|fetch|relay|msg)\b/;

    for (const filename of mdxFiles(docsDirectory)) {
      expect(readFileSync(filename, "utf8"), filename).not.toMatch(agentCommand);
    }
  });
});
