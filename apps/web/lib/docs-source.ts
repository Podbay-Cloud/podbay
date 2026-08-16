import { loader, type Source } from "fumadocs-core/source";
import { resolveFiles } from "fumadocs-mdx";
import { docs, meta } from "@/.source";

type DocsSourceConfig = {
  pageData: (typeof docs)[number];
  metaData: (typeof meta)[number];
};

// Fumadocs Core 15's loader consumes materialized VirtualFile entries. The MDX
// package still exposes the older callable-source helper, so resolve the
// collection explicitly while retaining its generated page-data type.
const contentSource: Source<DocsSourceConfig> = {
  // resolveFiles' public return type intentionally widens data to PageData; the
  // entries came from these generated collections, so restore that known type.
  files: resolveFiles({ docs, meta }) as Source<DocsSourceConfig>["files"],
};

export const docsSource = loader(contentSource, { baseUrl: "/docs" });
