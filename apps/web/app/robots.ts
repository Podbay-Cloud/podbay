import type { MetadataRoute } from "next";
import { editionOss } from "@/lib/session";

export default function robots(): MetadataRoute.Robots {
  // Self-host (OSS) is a PRIVATE, single-owner install on the owner's own domain — it must NOT invite
  // indexing, and it has no podbay.cloud marketing surface to point a crawler at. Disallow everything.
  if (editionOss()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
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
