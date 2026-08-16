"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/track";
import styles from "@/app/signin/signin.module.css";

/** A strong, copy-pasteable password from the browser CSPRNG (no ambiguous chars). */
function generatePassword(len = 20): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export default function SignInForm({
  next,
  oss = false,
  ownerExists = true,
  ownerEmail = "owner@localhost",
}: {
  next: string;
  /** Self-host edition: email+password owner instead of the GitHub button. */
  oss?: boolean;
  /** OSS only: does an owner credential exist yet? false ⇒ first-run SETUP, true ⇒ LOGIN. */
  ownerExists?: boolean;
  /** OSS only: the owner's login email (pre-filled). */
  ownerEmail?: string;
}) {
  if (oss) {
    return <OwnerForm next={next} setup={!ownerExists} ownerEmail={ownerEmail} />;
  }
  return <GithubForm next={next} />;
}

/** Cloud: GitHub OAuth (unchanged). */
function GithubForm({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    track("sign_in_initiated", { provider: "github" });
    try {
      const result = await authClient.signIn.social({ provider: "github", callbackURL: next });
      if (result.error) {
        setError("GitHub sign-in could not start. Please try again.");
        setBusy(false);
      }
    } catch {
      setError("GitHub sign-in could not start. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.authContent}>
      <p className={styles.eyebrow}>Private alpha</p>
      <h1 id="signin-title">Sign in to Podbay</h1>
      <p className={styles.intro}>Use GitHub to request access or return to your projects.</p>

      <form className={styles.authForm} onSubmit={submit} aria-busy={busy}>
        <button className={styles.githubButton} type="submit" disabled={busy}>
          {busy ? "Connecting to GitHub…" : "Continue with GitHub"}
        </button>
      </form>

      <div className={styles.authOutcome}>
        <strong>What happens next</strong>
        <p>
          Approved accounts continue to the Podbay dashboard. New requests join the private-alpha
          queue.
        </p>
      </div>

      <p className={styles.identityNote}>
        GitHub signs you into Podbay. Repository access and Claude or Codex sign-in stay separate.
      </p>

      <p className={styles.error} aria-live="polite">{error}</p>
    </div>
  );
}

/** Self-host: first-run owner SETUP or normal LOGIN (email + password). */
function OwnerForm({ next, setup, ownerEmail }: { next: string; setup: boolean; ownerEmail: string }) {
  const [email, setEmail] = useState(ownerEmail);
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setPassword(generatePassword());
    setGenerated(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = setup
        ? await authClient.signUp.email({ email, password, name: "Owner", callbackURL: next })
        : await authClient.signIn.email({ email, password, callbackURL: next });
      if (result.error) {
        setError(
          setup
            ? result.error.message || "Could not create the owner. Is one already set up?"
            : "Incorrect email or password.",
        );
        setBusy(false);
        return;
      }
      // Cookie is set by better-auth; go to the requested destination.
      window.location.assign(next);
    } catch {
      setError(setup ? "Could not create the owner." : "Sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.authContent}>
      <p className={styles.eyebrow}>Self-host</p>
      <h1 id="signin-title">{setup ? "Set up your owner account" : "Sign in"}</h1>
      <p className={styles.intro}>
        {setup
          ? "Create the single owner for this install. Choose a password or generate a strong one."
          : "Enter your owner password to continue."}
      </p>

      <form className={styles.authForm} onSubmit={submit} aria-busy={busy}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="owner-email">Email</label>
          <input
            id="owner-email"
            className={styles.input}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="owner-password">Password</label>
          <input
            id="owner-password"
            className={styles.input}
            // When generated, show it so the owner can copy it; otherwise mask.
            type={setup && generated ? "text" : "password"}
            autoComplete={setup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setGenerated(false);
            }}
            minLength={8}
            required
          />
          {setup && (
            <div className={styles.generateRow}>
              <button type="button" className={styles.linkButton} onClick={generate} disabled={busy}>
                Generate a strong password
              </button>
            </div>
          )}
          {setup && generated && (
            <p className={styles.generatedNote}>
              Copy this password and store it somewhere safe — this install can’t email you a reset.
            </p>
          )}
        </div>

        <button className={styles.githubButton} type="submit" disabled={busy}>
          {busy
            ? setup
              ? "Creating owner…"
              : "Signing in…"
            : setup
              ? "Create owner & continue"
              : "Sign in"}
        </button>
      </form>

      <p className={styles.error} aria-live="polite">{error}</p>
    </div>
  );
}
