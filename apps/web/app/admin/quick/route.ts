import { verifyActionToken, sendApprovalEmail } from "@podbay/auth";
import { createAppDb, user as userTable, eq } from "@podbay/db";

// One-click Approve / Later from the operator's new-request email. NO session gate on purpose: the
// `?t=` token is AES-encrypted with the pod's cred key, so only the server could have minted it — the
// link itself is the capability. It only ever actions the single user encoded in the token, and it
// expires. (docs: packages/auth/src/action-token.ts)
export const dynamic = "force-dynamic";

function page(title: string, msg: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title} · Podbay</title>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:14vh auto;padding:0 1.5rem;line-height:1.5">` +
      `<h1 style="font-size:1.15rem;margin:0 0 .4rem">${title}</h1>` +
      `<p style="color:#555;margin:0 0 1rem">${msg}</p>` +
      `<p><a href="https://podbay.cloud/admin" style="color:#2563eb">Open access requests →</a></p>`,
    { headers: { "content-type": "text/html; charset=utf-8" }, status: 200 },
  );
}

export async function GET(req: Request): Promise<Response> {
  const t = new URL(req.url).searchParams.get("t");
  if (!t) return page("Invalid link", "This link is missing its token.");
  const v = verifyActionToken(t, Date.now());
  if (!v) {
    return page(
      "Link expired or invalid",
      "This approve/later link is no longer valid. Open the admin panel to action it there.",
    );
  }
  const db = createAppDb();
  const [u] = await db
    .select({ email: userTable.email, name: userTable.name, approved: userTable.approved })
    .from(userTable)
    .where(eq(userTable.id, v.userId));
  if (!u) return page("Not found", "That access request no longer exists.");

  if (v.action === "approve") {
    const wasApproved = u.approved;
    await db.update(userTable).set({ approved: true, deferredAt: null }).where(eq(userTable.id, v.userId));
    // Send the "you're in" email only on the real transition (a re-click must not re-spam them).
    if (!wasApproved) await sendApprovalEmail({ name: u.name, email: u.email }).catch(() => undefined);
    return page(
      "Approved ✓",
      `${u.name || u.email} is approved${wasApproved ? " (already was)" : " and has been emailed their invite"}.`,
    );
  }

  await db.update(userTable).set({ deferredAt: new Date() }).where(eq(userTable.id, v.userId));
  return page("Moved to Later", `${u.name || u.email} is set aside — find them under “Later” in the admin panel.`);
}
