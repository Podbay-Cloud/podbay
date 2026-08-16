-- Per-pod agent auth mode (api-key-pod-mode.md): "subscription" (default, via /login)
-- or "api-key" (BYO key stored as the reserved PODBAY_AGENT_* secret). Nullable;
-- null = fall back to the environment's default.
ALTER TABLE "pods" ADD COLUMN IF NOT EXISTS "agent_auth" text;
