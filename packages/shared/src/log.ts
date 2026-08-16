/**
 * Minimal structured logger: one JSON line per event to stdout/stderr, which
 * Fly captures — so `fly logs` is the queryable truth for every service.
 * No deps, safe in any server context.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  info(event: string, ctx?: LogContext): void;
  warn(event: string, ctx?: LogContext): void;
  error(event: string, ctx?: LogContext): void;
}

/** Keys whose values must never reach a log line. */
const SENSITIVE_KEY = /token|secret|password|credential|authorization|cookie/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const e = value as Error & { code?: unknown };
    return { message: e.message, ...(e.code !== undefined ? { code: e.code } : {}) };
  }
  if (Array.isArray(value)) return depth < 3 ? value.map((v) => sanitize(v, depth + 1)) : "[array]";
  if (value !== null && typeof value === "object") {
    if (depth >= 3) return "[object]";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(svc: string, write: (line: string) => void = defaultWrite): Logger {
  const emit = (level: LogLevel, event: string, ctx?: LogContext) => {
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, svc, event };
    if (ctx) Object.assign(entry, sanitize(ctx) as Record<string, unknown>);
    write(JSON.stringify(entry));
  };
  return {
    info: (event, ctx) => emit("info", event, ctx),
    warn: (event, ctx) => emit("warn", event, ctx),
    error: (event, ctx) => emit("error", event, ctx),
  };
}

function defaultWrite(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
}
