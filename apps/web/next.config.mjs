import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Trace workspace packages (e.g. @podbay/db) into the standalone bundle.
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@podbay/db"],
  // pglite ships wasm + fs access, and pg does a conditional require('fs') that
  // Next's bundler can't resolve (it broke the instrumentation entry that boots
  // the provisioner). Keep both external so they load via node require at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Analytics is proxied through our own origin so ad-blockers don't silently drop
  // it (and so the browser never talks to a third-party host directly).
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // Required by the /ingest proxy above: Next would otherwise 308 PostHog's
  // trailing-slash paths and the redirect loses the POST body. This is app-wide, so
  // it is here deliberately rather than as an unexplained flag — our own routes do
  // not depend on trailing-slash redirects.
  skipTrailingSlashRedirect: true,
};

const withMDX = createMDX();

export default withMDX(nextConfig);
