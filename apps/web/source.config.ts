import { defineDocs } from "fumadocs-mdx/config";

/**
 * Public product documentation. Keep this content separate from the repository's
 * internal strategy, planning, and operator runbooks under the root `docs/` folder.
 */
export const { docs, meta } = defineDocs({
  dir: "content/docs",
});
