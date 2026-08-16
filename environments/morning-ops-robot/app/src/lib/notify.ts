import "server-only";
import type { Alert, Digest } from "./types";

// Outbound delivery so the ops bot reaches you when you're AWAY — the dashboard
// alone doesn't (the morning brief + urgent alerts are useless if you have to be
// looking at the tab). Channels are opt-in via env secrets; delivery is
// best-effort and never throws (a down channel must not break the run).
//
//   SLACK_WEBHOOK_URL                    — a Slack Incoming Webhook (simplest)
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID — a BotFather bot + your chat id

async function post(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* best-effort: a failed notification must never break a run */
  }
}

/** Send a plain-text message to every configured channel. */
async function send(text: string): Promise<void> {
  const slack = process.env.SLACK_WEBHOOK_URL;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  const jobs: Promise<void>[] = [];
  if (slack) jobs.push(post(slack, { text }));
  if (tgToken && tgChat) {
    jobs.push(
      post(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        chat_id: tgChat,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    );
  }
  await Promise.allSettled(jobs);
}

export function channelsConfigured(): boolean {
  return Boolean(
    process.env.SLACK_WEBHOOK_URL ||
      (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  );
}

const SEV_ICON: Record<Alert["severity"], string> = {
  critical: "🔴",
  warning: "🟠",
  info: "🔵",
};

/** Deliver an urgent alert. Called only for NEW firing alerts (dedup upstream). */
export async function notifyAlert(a: Alert): Promise<void> {
  if (!channelsConfigured()) return;
  const head = `${SEV_ICON[a.severity]} *${a.severity.toUpperCase()}* — ${a.title}`;
  await send(a.detail ? `${head}\n${a.detail}` : head);
}

/** Deliver the morning brief. */
export async function notifyDigest(d: Digest): Promise<void> {
  if (!channelsConfigured()) return;
  const lines = [`🌅 *Morning brief — ${d.date}*`, d.summary];
  if (d.needsAttention.length) lines.push("", "*Needs you:*", ...d.needsAttention.map((x) => `• ${x}`));
  if (d.actions.length) lines.push("", "*Recommended:*", ...d.actions.map((x) => `• ${x}`));
  await send(lines.join("\n"));
}
