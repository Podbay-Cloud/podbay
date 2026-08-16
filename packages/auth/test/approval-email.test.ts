import { describe, expect, it, vi } from "vitest";
import { sendApprovalEmail } from "../src/notify.js";

const CFG = {
  saJson: JSON.stringify({ client_email: "sa@x.iam", private_key: "PEM" }),
  impersonate: "itzhak@podbay.cloud",
  from: "Itzhak · Podbay <hi@podbay.cloud>",
};

describe("sendApprovalEmail (Gmail API)", () => {
  it("no-ops (never calls) until all three env values are set", async () => {
    const f = vi.fn();
    await expect(sendApprovalEmail({ name: "A", email: "a@x.com" }, { fetchImpl: f as never })).resolves.toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("posts a base64url RFC822 message to the Gmail send endpoint with a delegated token", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    const tokenFn = vi.fn(async () => "ya29.test-token");
    await sendApprovalEmail(
      { name: "Ada", email: "ada@x.com" },
      { ...CFG, fetchImpl: f as never, tokenFn },
    );
    expect(tokenFn).toHaveBeenCalledWith(CFG.saJson, CFG.impersonate, expect.anything());
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer ya29.test-token" });
    // The raw is base64url of the RFC822 message — decode and check it addresses the recipient
    const raw = JSON.parse((init as RequestInit).body as string).raw as string;
    const msg = Buffer.from(raw, "base64url").toString("utf8");
    expect(msg).toContain("To: ada@x.com");
    expect(msg).toContain("<hi@podbay.cloud>");
    expect(msg).toMatch(/=\?UTF-8\?B\?/); // non-ASCII From/subject MIME-encoded, not raw
  });

  it("never throws even if the token exchange or send fails", async () => {
    const boom = vi.fn(async () => { throw new Error("google down"); });
    await expect(
      sendApprovalEmail({ name: "A", email: "a@x.com" }, { ...CFG, tokenFn: boom }),
    ).resolves.toBeUndefined();
  });
});
