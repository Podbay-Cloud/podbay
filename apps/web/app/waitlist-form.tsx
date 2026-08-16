"use client";

import { useState } from "react";
import { track } from "@/lib/track";

type State = "idle" | "loading" | "ok" | "error";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setState("ok");
        setMsg(data.already ? "You're already on the list." : "You're on the list.");
        if (!data.already) {
          track("waitlist_submitted");
          // Mirror to GA4 as a recommended lead event so the digest can report
          // conversions. Consent-gated + production-only (window.gtag is undefined
          // otherwise). Mark `generate_lead` as a Key event in GA Admin to count it.
          window.gtag?.("event", "generate_lead", { method: "waitlist" });
        }
      } else {
        setState("error");
        setMsg(data.error || "Something went wrong.");
      }
    } catch {
      setState("error");
      setMsg("Network error — try again.");
    }
  }

  if (state === "ok") {
    return (
      <div className="waitlist done" role="status">
        <span className="check">✓</span> {msg}
      </div>
    );
  }

  return (
    <form className="waitlist" onSubmit={submit}>
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@work.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={state === "loading"}
        aria-label="Email address"
      />
      <button type="submit" disabled={state === "loading"}>
        {state === "loading" ? "…" : "Request access"}
      </button>
      {state === "error" && <span className="err">{msg}</span>}
    </form>
  );
}
