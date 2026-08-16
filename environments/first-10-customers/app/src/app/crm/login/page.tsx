"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CrmLogin() {
  const router = useRouter();
  const [next, setNext] = useState("/crm");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    if (n) setNext(n);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/crm-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.replace(next);
    else setError(true);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Private pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Input
              type="password"
              autoFocus
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-sm text-destructive">Wrong password.</p>}
            <Button type="submit" disabled={busy || !password}>
              {busy ? "Checking…" : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
