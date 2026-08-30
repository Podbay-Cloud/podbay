import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { docsSource } from "@/lib/docs-source";
import { editionOss } from "@/lib/session";

const BASE = "https://podbay.cloud";

/** Public, indexable routes only — auth-gated (/dashboard, /new, /pending, /pods) and internal
 * (/api, /admin, /preview, /dev-harness) routes are excluded here and disallowed in robots.ts. */
export default function sitemap(): MetadataRoute.Sitemap {
  // Self-host (OSS) has no public podbay.cloud marketing surface to advertise — emit nothing rather
  // than list podbay.cloud URLs on the owner's own domain. (robots.ts also disallows all in OSS.)
  if (editionOss()) return [];
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/selfhost`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/signin`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/cookies`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
  const posts: MetadataRoute.Sitemap = getAllPosts().map((p) => ({
    url: `${BASE}/blog/${p.slug}`,
    lastModified: new Date(p.date),
    changeFrequency: "monthly",
    priority: 0.7,
  }));
  const docs: MetadataRoute.Sitemap = docsSource.getPages().map((page) => ({
    url: `${BASE}${page.url}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: page.url === "/docs" ? 0.8 : 0.65,
  }));
  return [...staticRoutes, ...docs, ...posts];
}
