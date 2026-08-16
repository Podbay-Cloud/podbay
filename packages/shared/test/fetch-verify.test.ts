import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyFetch, extractText } from "../src/fetch-verify.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fetch");
const fx = (n: string) => readFileSync(path.join(dir, n), "utf8");

/**
 * Every fixture here is a REAL response captured from a pod on 2026-07-30, not a
 * hand-written approximation — the whole point is that refusals in the wild do not
 * look like the refusals you imagine. Sources are public pages.
 */
describe("verifying what a rung actually returned", () => {
  it("catches a reader service reporting the site's refusal inside a 200", () => {
    // The one that motivated this work: r.jina.ai answered 200, and the body was
    // Reddit's block page. An unverified ladder reports that as the article.
    const r = verifyFetch({ rung: "reader", status: 200, body: fx("reader-blocked-reddit.txt") });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("blocked");
    // It also surfaces the upstream status the reader passed through.
    expect(r.reason).toMatch(/upstream 403/);
  });

  it("records a bot-management challenge as a CHALLENGE, not a generic block", () => {
    // Real capture from g2.com. The distinction matters because the two want
    // different next moves: a challenge might yield to a browser, an edge block
    // needs a different network origin entirely.
    const r = verifyFetch({ rung: "direct", status: 403, body: fx("challenge-cloudflare.html") });
    expect(r.outcome).toBe("challenged");
  });

  it("catches reddit's 'Prove your humanity' interstitial as a challenge", () => {
    // Seen 2026-08-01 served to a residential relay browser: the whole page was the
    // challenge, not content. A 200 makes it a lie the signature must catch.
    const body = "<html><head><title>Reddit - Prove your humanity</title></head><body>Prove your humanity <button>Continue</button></body></html>";
    const r = verifyFetch({ rung: "relay", status: 200, body });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("challenged");
  });

  it("reads a plain refusal as blocked", () => {
    const r = verifyFetch({ rung: "direct", status: 403, body: fx("direct-403-reddit.html") });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("blocked");
  });

  it("calls a client-rendered shell EMPTY, which points at the browser rung", () => {
    // excalidraw.com to a plain fetch: 79 characters of text. Not the site's fault
    // and not a block — the wrong rung.
    const r = verifyFetch({ rung: "direct", status: 200, body: fx("shell-js-excalidraw.html") });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("empty");
    expect(r.textLength).toBeLessThan(200);
  });

  it("accepts a real page and a real API response — the negative controls", () => {
    // A verifier that rejects everything is as useless as one that accepts
    // everything, so the good cases are asserted as carefully as the bad ones.
    const html = verifyFetch({ rung: "direct", status: 200, body: fx("good-html-react.html") });
    expect(html.ok).toBe(true);
    expect(html.textLength).toBeGreaterThan(1000);

    const api = verifyFetch({
      rung: "api",
      status: 200,
      body: fx("good-api-hn.json"),
      contentType: "application/json",
    });
    expect(api.ok).toBe(true);
  });
});

describe("the checks that are easy to get subtly wrong", () => {
  it("matches signatures on the RAW body, since markup carries the clearest ones", () => {
    // `challenge-platform` lives in a script src, which text extraction throws away.
    // Matching only visible text would miss the best signal on the page.
    const raw = fx("challenge-cloudflare.html");
    expect(extractText(raw)).not.toMatch(/challenge-platform/);
    expect(verifyFetch({ rung: "direct", status: 403, body: raw }).outcome).toBe("challenged");
  });

  it("treats a redirect to a sign-in page as a login wall, not a success", () => {
    const r = verifyFetch({
      rung: "browser",
      status: 200,
      body: "<html><body>" + "x".repeat(500) + "</body></html>",
      finalUrl: "https://example.com/login?next=%2Farticle",
    });
    expect(r.outcome).toBe("login");
  });

  it("lets relevance WARN but never fail — it is the check that can be wrong", () => {
    const r = verifyFetch({
      rung: "direct",
      status: 200,
      body: fx("good-html-react.html"),
      wanted: ["a phrase that is definitely not on this page"],
    });
    expect(r.ok, "a good page must not be discarded over a keyword miss").toBe(true);
    expect(r.warnings.join(" ")).toMatch(/not found/);
  });

  it("respects a caller's lower text floor for legitimately short pages", () => {
    const short = { rung: "api" as const, status: 200, body: "<p>Yes.</p>" };
    expect(verifyFetch(short).outcome).toBe("empty");
    expect(verifyFetch({ ...short, minText: 3 }).ok).toBe(true);
  });
});

describe("a signature is not a refusal when the page is also serving content", () => {
  it("keeps a real page that happens to carry a challenge script", () => {
    // Found by testing the owner's hypothesis, not by review: crunchbase.com answers
    // 200 with 23,156 characters of text AND Cloudflare's challenge-platform script at
    // byte 874,740. A signature-only verifier threw the whole page away.
    const r = verifyFetch({ rung: "browser", status: 200, body: fx("good-html-with-cf-script.html") });
    expect(r.ok, "a served page must not be discarded for carrying a vendor script").toBe(true);
    expect(r.textLength).toBeGreaterThan(1200);
    // Not silently: the signature is still worth saying out loud.
    expect(r.warnings.join(" ")).toMatch(/challenge-platform/);
  });

  it("still rejects the SAME signature when no content came back", () => {
    // The distinction is content, not the marker — so the real interstitial, which has
    // 50 characters of text, must still fail.
    const r = verifyFetch({ rung: "direct", status: 403, body: fx("challenge-cloudflare.html") });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("challenged");
  });

  it("generalises past bot-management: a login CTA on a served article", () => {
    // This is the wider trap. Half the web has "Log in to continue" in a header while
    // serving the whole page; a signature-only verifier would have called all of it a
    // login wall.
    const body = "<html><body><p>" + "Real article text. ".repeat(120) + "</p><a>Log in to continue</a></body></html>";
    const r = verifyFetch({ rung: "direct", status: 200, body });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/Log in to continue/i);
  });
});

describe("a page's noscript fallback is not the page", () => {
  it("does not call a successful RENDER empty because of a leftover noscript", () => {
    // Real case, found by running the ladder rather than by review: excalidraw.com
    // renders 537 characters of real content in a browser and still carries
    // "You need to enable JavaScript to run this app" in a <noscript>. Matching that
    // made the verifier reject a perfectly good render and fall through to a reader
    // service — the wrong rung, slower, and less truthful.
    const body =
      "<html><body><noscript>You need to enable JavaScript to run this app.</noscript>" +
      "<div>" + "Rendered application content. ".repeat(12) + "</div></body></html>";
    const r = verifyFetch({ rung: "browser", status: 200, body });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe("ok");
  });

  it("still catches a page that genuinely has nothing without JavaScript", () => {
    // The honest mechanism for that page is the text floor, not the signature: strip
    // the fallback and there is simply no content left.
    const body = "<html><body><noscript>Please enable JavaScript</noscript><div id=root></div></body></html>";
    const r = verifyFetch({ rung: "direct", status: 200, body });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("empty");
  });
});
