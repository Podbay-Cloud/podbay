import { toNextJsHandler } from "better-auth/next-js";
import { authConfigured, getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notConfigured(): Response {
  return new Response(JSON.stringify({ error: "auth not configured" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(req: Request): Promise<Response> {
  if (!authConfigured()) return notConfigured();
  return toNextJsHandler(getAuth()).GET(req);
}

export async function POST(req: Request): Promise<Response> {
  if (!authConfigured()) return notConfigured();
  return toNextJsHandler(getAuth()).POST(req);
}
