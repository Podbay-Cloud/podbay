import { redirect } from "next/navigation";
import { currentUserAllowed } from "@/lib/access";
import SignOutButton from "../dashboard/sign-out-button";
import { linkCurrentLandingAttribution } from "@/lib/landing-experiment-attribution";

export const dynamic = "force-dynamic";

export default async function Pending() {
  const { user, allowed } = await currentUserAllowed();
  if (!user) redirect("/signin");
  if (allowed) redirect("/dashboard");
  await linkCurrentLandingAttribution(user.id);
  return (
    <main className="center">
      <div className="card auth">
        <span className="logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-mark" src="/podbay-mark.svg" alt="Podbay" />
          <span className="wordmark">
            <span className="pod">pod</span>
            <span className="bay">bay</span>
          </span>
        </span>
        <h2 style={{ fontSize: 18 }}>You&apos;re on the list</h2>
        <p className="muted">
          Thanks for requesting access, {user.name}. Podbay is in invite-only alpha — we&apos;ll email
          you at <b>{user.email}</b> when your spot opens up.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
