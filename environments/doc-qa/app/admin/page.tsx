"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Doc = { doc: string; chunks: number };
type Question = { question: string; answered: boolean; sources: string[]; asked_at: string };
type Auth = { configured: boolean; authed: boolean };

export default function Admin() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState({ name: "", text: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAuth = useCallback(
    () =>
      fetch("/api/admin")
        .then((r) => r.json())
        .then(setAuth)
        .catch(() => setAuth({ configured: false, authed: false })),
    [],
  );
  const load = useCallback(async () => {
    const [d, q] = await Promise.all([
      fetch("/api/docs").then((r) => r.json()).catch(() => []),
      fetch("/api/questions").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    setDocs(Array.isArray(d) ? d : []);
    setQuestions(Array.isArray(q) ? q : []);
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);
  useEffect(() => {
    if (auth?.authed) load();
  }, [auth?.authed, load]);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr(false);
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (r.ok) {
      setPassword("");
      loadAuth();
    } else setLoginErr(true);
  }
  async function doLogout() {
    await fetch("/api/admin", { method: "DELETE" });
    loadAuth();
  }
  async function upload(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    await fetch("/api/docs", { method: "POST", body: fd }).catch(() => {});
    setBusy(false);
    load();
  }
  async function addPaste() {
    if (!paste.name.trim() || !paste.text.trim()) return;
    setBusy(true);
    await fetch("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paste),
    }).catch(() => {});
    setBusy(false);
    setPaste({ name: "", text: "" });
    load();
  }
  async function remove(name: string) {
    setBusy(true);
    await fetch("/api/docs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => {});
    setBusy(false);
    load();
  }

  if (!auth) return <div className="admin"><p className="muted">Loading…</p></div>;

  if (!auth.configured)
    return (
      <div className="admin">
        <h1>Owner console</h1>
        <div className="card locked">
          <h2>Locked</h2>
          <p>
            This bot&rsquo;s page is public, so the console is protected. Set an{" "}
            <code>ADMIN_PASSWORD</code> secret for this pod in the Podbay dashboard, restart the
            dev server, then reload this page to sign in.
          </p>
        </div>
      </div>
    );

  if (!auth.authed)
    return (
      <div className="admin">
        <h1>Owner console</h1>
        <form className="card login" onSubmit={doLogin}>
          <label htmlFor="pw">Owner password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="ADMIN_PASSWORD"
            autoFocus
          />
          {loginErr && <p className="err">Incorrect password.</p>}
          <button type="submit" disabled={!password}>Sign in</button>
        </form>
      </div>
    );

  const unanswered = questions.filter((q) => !q.answered);
  return (
    <div className="admin">
      <div className="admin-head">
        <h1>Owner console</h1>
        <div className="admin-actions">
          <a href="/" className="link">View public bot ↗</a>
          <button className="ghost" onClick={doLogout}>Sign out</button>
        </div>
      </div>

      <section className="card">
        <h2>Documents <span className="count">{docs.length}</span></h2>
        <p className="muted">The bot answers only from these. Upload a file or paste text.</p>
        <div className="uploads">
          <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Working…" : "Upload a file"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.csv,.json,.log,.text,.html,.htm"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload(f);
            }}
          />
        </div>
        <details className="paste">
          <summary>…or paste text</summary>
          <input
            placeholder="Document name (e.g. Handbook.md)"
            value={paste.name}
            onChange={(e) => setPaste((p) => ({ ...p, name: e.target.value }))}
          />
          <textarea
            placeholder="Paste the document text…"
            value={paste.text}
            onChange={(e) => setPaste((p) => ({ ...p, text: e.target.value }))}
            rows={6}
          />
          <button className="primary" disabled={busy || !paste.name.trim() || !paste.text.trim()} onClick={addPaste}>
            Add document
          </button>
        </details>
        <ul className="doclist">
          {docs.length === 0 && <li className="muted">No documents yet.</li>}
          {docs.map((d) => (
            <li key={d.doc}>
              <span className="doc-name">{d.doc}</span>
              <span className="doc-chunks">{d.chunks} chunk{d.chunks > 1 ? "s" : ""}</span>
              <button className="danger" disabled={busy} onClick={() => remove(d.doc)}>Remove</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>
          Questions <span className="count">{questions.length}</span>
          {unanswered.length > 0 && <span className="count warn">{unanswered.length} unanswered</span>}
        </h2>
        <p className="muted">
          What people asked. <strong>Unanswered</strong> ones tell you which docs to add next.
        </p>
        <ul className="qlist">
          {questions.length === 0 && <li className="muted">No questions yet.</li>}
          {questions.map((q, i) => (
            <li key={i} className={q.answered ? "" : "un"}>
              <span className="q-badge" aria-hidden>{q.answered ? "✓" : "✗"}</span>
              <span className="q-text">{q.question}</span>
              {q.sources.length > 0 && (
                <span className="q-src">{q.sources.join(", ")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
