/**
 * Best-effort Telegram alerts. No-ops when unconfigured, and never throw — a signup or
 * a pod incident must not fail because a notification did.
 */
export interface NotifyDeps {
  token?: string;
  chatId?: string;
  fetchImpl?: typeof fetch;
}

async function sendTelegram(token: string, chatId: string, text: string, f: typeof fetch): Promise<void> {
  try {
    await f(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Ops alert to a DEDICATED ops bot/channel — separate from growth/signup, so an OOM at
 * 3am does not land in the same feed as a new signup. Env: TELEGRAM_OPS_BOT_TOKEN /
 * TELEGRAM_OPS_CHAT_ID. No-op when unconfigured.
 */
export async function notifyOps(text: string, deps: NotifyDeps = {}): Promise<void> {
  const token = deps.token ?? process.env.TELEGRAM_OPS_BOT_TOKEN;
  const chatId = deps.chatId ?? process.env.TELEGRAM_OPS_CHAT_ID;
  if (!token || !chatId) return;
  await sendTelegram(token, chatId, text, deps.fetchImpl ?? fetch);
}

export async function notifySignup(
  u: { name?: string | null; email: string },
  deps: NotifyDeps = {},
): Promise<void> {
  const token = deps.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = deps.chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await sendTelegram(token, chatId, `🔔 New podbay signup: ${u.name || "(no name)"} — ${u.email}`, deps.fetchImpl ?? fetch);
}

export interface EmailDeps {
  saJson?: string;
  impersonate?: string;
  from?: string;
  fetchImpl?: typeof fetch;
  /** Injectable so the unit test doesn't need real Google creds or a network. */
  tokenFn?: (saJson: string, impersonate: string, f: typeof fetch) => Promise<string>;
}

const b64url = (x: Buffer | string): string => Buffer.from(x).toString("base64url");

/** MIME encoded-word for a header value with non-ASCII (the `·`/`—` in our From + subject). */
function encodeHeaderWord(s: string): string {
  return /^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** `Name <addr>` → encode the display name, keep the address raw. */
function encodeFrom(from: string): string {
  const m = from.match(/^(.*)<([^>]+)>\s*$/);
  if (!m) return from;
  return `${encodeHeaderWord(m[1]!.trim())} <${m[2]!.trim()}>`;
}

/**
 * A Google service-account access token via DOMAIN-WIDE DELEGATION (impersonating a real
 * Workspace mailbox). Hand-rolled JWT (RS256) → token exchange, so there's no google-auth SDK
 * in the web bundle. `sub` is the impersonated user; scope is gmail.send.
 */
async function gmailToken(saJson: string, impersonate: string, f: typeof fetch): Promise<string> {
  const { client_email, private_key } = JSON.parse(saJson) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: client_email,
      scope: "https://www.googleapis.com/auth/gmail.send",
      aud: "https://oauth2.googleapis.com/token",
      sub: impersonate,
      iat: now,
      exp: now + 3600,
    }),
  );
  const { createSign } = await import("node:crypto");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${b64url(signer.sign(private_key))}`;
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) throw new Error(`gmail token exchange failed: ${json.error_description ?? "no token"}`);
  return json.access_token;
}

/**
 * Tell an APPROVED user they're in. This is the email the /pending page promises
 * ("we'll email you when your spot opens up") — without it, that promise is a lie to every
 * waitlisted user. Sends via the Google Workspace GMAIL API using a service account with
 * domain-wide delegation (impersonating a real mailbox, sending From the `hi@` alias). Best-effort
 * and env-gated (GOOGLE_SERVICE_ACCOUNT_JSON / PODBAY_GMAIL_IMPERSONATE / PODBAY_FROM_EMAIL):
 * approving a user must never fail because the email did, and it no-ops cleanly until the three
 * are set. See docs/runbooks/gmail-api-setup.md.
 */
export async function sendApprovalEmail(
  u: { name?: string | null; email: string },
  deps: EmailDeps = {},
): Promise<void> {
  const saJson = deps.saJson ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const impersonate = deps.impersonate ?? process.env.PODBAY_GMAIL_IMPERSONATE;
  const from = deps.from ?? process.env.PODBAY_FROM_EMAIL;
  if (!saJson || !impersonate || !from) return; // not configured yet → no-op, never throw
  const name = (u.name ?? "").trim() || "there";
  const f = deps.fetchImpl ?? fetch;
  try {
    const token = await (deps.tokenFn ?? gmailToken)(saJson, impersonate, f);
    // Copy of record: docs/strategy/alpha-invite-copy.md §1. Keep them in sync.
    const subject = "You're in — your Podbay alpha spot is live";
    const body =
      `Hi ${name},\n\n` +
      `You're in. Podbay gives your coding agent a real computer in the cloud — isolated, ` +
      `yours, and still working after you close the laptop.\n\n` +
      `Sign in and launch your first environment (about a minute to a working project):\n` +
      `https://podbay.cloud/signin\n\n` +
      `You're one of a small first group, so I'll actually read what you send back. Reply to ` +
      `this email with anything — a bug, a rough edge, an idea, or just what you built.\n\n` +
      // Personalize this signature to your name before inviting (see the copy doc).
      `— The Podbay team`;
    // RFC822 with UTF-8: base64 the body (the em dash) and MIME-encode the non-ASCII headers.
    const message =
      `From: ${encodeFrom(from)}\r\n` +
      `To: ${u.email}\r\n` +
      `Subject: ${encodeHeaderWord(subject)}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      Buffer.from(body, "utf8").toString("base64");
    await f("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(message) }),
    });
  } catch {
    /* best-effort: never let a notification break the approval */
  }
}
