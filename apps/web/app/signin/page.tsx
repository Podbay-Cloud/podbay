import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAppDb } from "@podbay/db";
import SignInForm from "@/components/signin-form";
import { getCurrentUser, editionOss } from "@/lib/session";
import { ownerCredentialExists } from "@/lib/auth-config";
import { resolveSignInCallback } from "@/lib/signin-callback";
import styles from "./signin.module.css";

/** The owner's login email in OSS (self-host-auth-gate) — pre-filled so the owner mostly types a
 * password. Overridable so a non-default email can be used. */
// A valid-FORMAT default (better-auth's email validator rejects `owner@localhost` — no dot in the
// domain). `.local` is a non-routable convention; the owner can change it to their real email.
const OSS_OWNER_EMAIL = process.env.PODBAY_AUTH_EMAIL || "owner@podbay.local";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in to Podbay",
  description: "Sign in with GitHub to request private-alpha access or return to your projects.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = resolveSignInCallback(next);
  // Already signed in → nothing to do here; honor the callback target (defaults
  // to /dashboard). ONLY /signin does this — the landing (/) stays viewable
  // while signed in (the CTA swap covers it), so iterating on landing copy
  // never requires logging out.
  if (await getCurrentUser()) redirect(safeNext);
  // OSS (self-host-auth-gate): decide first-run SETUP vs normal LOGIN — is there an owner
  // credential yet? Cloud keeps its GitHub button (oss=false).
  const oss = editionOss();
  const ownerExists = oss ? await ownerCredentialExists(createAppDb()) : true;
  return (
    <main className={styles.page}>
      <section className={styles.surface} aria-labelledby="signin-title">
        <div className={styles.signinPanel}>
          <header className={styles.panelHeader}>
            <Link className={styles.brand} href="/" aria-label="Podbay home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.brandMark} src="/podbay-mark.svg" alt="" />
              <span className={styles.wordmark}><span>pod</span>bay</span>
            </Link>
            <Link className={styles.backLink} href="/"><span aria-hidden>←</span> Back to home</Link>
          </header>
          <div className={styles.formPosition}>
            <SignInForm next={safeNext} oss={oss} ownerExists={ownerExists} ownerEmail={OSS_OWNER_EMAIL} />
          </div>
        </div>
      </section>
    </main>
  );
}
