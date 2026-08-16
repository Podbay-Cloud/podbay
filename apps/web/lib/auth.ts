import "server-only";
import { createAuth, isAuthConfigured, isTestLoginEnabled, type AuthEnv } from "./auth-config";

let cached: ReturnType<typeof createAuth> | null = null;

export function authConfigured(): boolean {
  const env = process.env as AuthEnv;
  return isAuthConfigured(env) || isTestLoginEnabled(env);
}

/** Lazily build the better-auth instance so importing this never touches the DB. */
export function getAuth(): ReturnType<typeof createAuth> {
  if (!cached) cached = createAuth(process.env as AuthEnv);
  return cached;
}
