import { describe, it, expect, vi } from "vitest";
import { notifySignup, notifyOps } from "../src/notify.js";

describe("notifySignup", () => {
  it("no-ops (no fetch) when token/chat are unconfigured", async () => {
    const f = vi.fn();
    await notifySignup({ name: "A", email: "a@x.com" }, { fetchImpl: f as unknown as typeof fetch });
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to Telegram sendMessage when configured", async () => {
    const f = vi.fn(async () => new Response("{}"));
    await notifySignup(
      { name: "Vels", email: "v@x.com" },
      { token: "TOK", chatId: "123", fetchImpl: f as unknown as typeof fetch },
    );
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://api.telegram.org/botTOK/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe("123");
    expect(body.text).toContain("v@x.com");
  });

  it("never throws even if fetch rejects", async () => {
    const f = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(
      notifySignup({ name: "A", email: "a@x.com" }, { token: "T", chatId: "1", fetchImpl: f as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
  });
});

describe("notifyOps (dedicated ops channel)", () => {
  it("no-ops when the ops bot is unconfigured", async () => {
    const f = vi.fn();
    await notifyOps("boom", { fetchImpl: f as unknown as typeof fetch });
    expect(f).not.toHaveBeenCalled();
  });

  it("posts the incident text to the ops chat when configured", async () => {
    const f = vi.fn(async () => new Response("{}"));
    await notifyOps("⚠️ pod ran out of memory", {
      token: "OPS",
      chatId: "999",
      fetchImpl: f as unknown as typeof fetch,
    });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://api.telegram.org/botOPS/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe("999");
    expect(body.text).toContain("out of memory");
  });
});
