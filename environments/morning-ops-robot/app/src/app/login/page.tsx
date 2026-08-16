"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(false);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.replace(next);
    } else {
      setErr(true);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ops dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the dashboard password to continue.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pw">Password</Label>
          <Input
            id="pw"
            type="password"
            value={pw}
            autoFocus
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
        {err && <p className="text-sm text-red-600">Incorrect password.</p>}
        <Button type="submit" disabled={busy || !pw}>
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </main>
  );
}
