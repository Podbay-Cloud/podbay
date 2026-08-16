import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Auth-gated + internal surfaces: nothing to index, and some are per-user.
        disallow: ["/dashboard/", "/admin/", "/api/", "/preview/", "/dev-harness/", "/new", "/pending", "/pods/"],
      },
    ],
    sitemap: "https://podbay.cloud/sitemap.xml",
    host: "https://podbay.cloud",
  };
}
