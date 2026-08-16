"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";

// Make it yours: the title, the one-line intro, and the starter questions. These
// are what visitors see first — point them at what your docs actually cover.
const TITLE = "Ask Your Docs";
const INTRO = "Ask a question and get answers straight from the documents — with citations.";
const SUGGESTIONS = [
  "How long is a day on Venus?",
  "What is the Great Red Spot?",
  "Why do we only ever see one side of the Moon?",
];

/** Render answer text with inline [Source.md] citations styled as chips. */
function Answer({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(\[[^\]\n]+\])/g), [text]);
  return (
    <>
      {parts.map((p, i) =>
        /^\[[^\]\n]+\]$/.test(p) ? (
          <span key={i} className="cite" title={p.slice(1, -1)}>
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function Home() {
  const { messages, sendMessage, status, error, stop } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  // Which documents the bot can answer from (informational — the public can't edit).
  const [docs, setDocs] = useState<{ doc: string; chunks: number }[]>([]);
  useEffect(() => {
    fetch("/api/docs")
      .then((r) => r.json())
      .then((d) => setDocs(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  // Pin the app to the VISIBLE viewport so the composer stays above the phone
  // keyboard (iOS keeps a separate visual viewport the keyboard shrinks + pans).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const root = document.documentElement;
      root.style.setProperty("--app-h", `${vv.height}px`);
      root.style.setProperty("--app-y", `${vv.offsetTop}px`);
      window.scrollTo(0, 0);
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden>❝</span>
          <div className="brand-text">
            <h1>{TITLE}</h1>
            <p className="status">
              {docs.length > 0 ? (
                <>
                  <span className="dot" aria-hidden /> Answering from {docs.length} document
                  {docs.length > 1 ? "s" : ""}
                </>
              ) : (
                <>
                  <span className="dot" aria-hidden /> Grounded answers · cited
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      <main className="chat" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="empty">
            <div className="empty-mark" aria-hidden>❝</div>
            <h2>Ask the documents anything.</h2>
            <p>{INTRO}</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" type="button" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const streaming = isLast && m.role === "assistant" && status === "streaming";
              const text = (m.parts ?? [])
                .filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join("");
              return (
                <div key={m.id} className={`row ${m.role}`}>
                  {m.role === "assistant" && <span className="avatar" aria-hidden>❝</span>}
                  <div className="bubble">
                    {m.role === "assistant" ? <Answer text={text} /> : <span>{text}</span>}
                    {streaming && <span className="caret" aria-hidden />}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="banner" role="alert">
            Something went wrong. If you&rsquo;re the owner, make sure{" "}
            <code>ANTHROPIC_API_KEY</code> is set in this pod&rsquo;s secrets, then restart the
            dev server and try again.
          </div>
        )}
      </main>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          aria-label="Ask a question"
          autoFocus
        />
        {busy ? (
          <button type="button" className="send stop" onClick={() => stop()} aria-label="Stop">
            <span className="square" aria-hidden />
          </button>
        ) : (
          <button type="submit" className="send" disabled={!input.trim()} aria-label="Ask">
            <span aria-hidden>➤</span>
          </button>
        )}
      </form>
    </div>
  );
}
