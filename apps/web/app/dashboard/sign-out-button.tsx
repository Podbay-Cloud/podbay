"use client";

import { authClient } from "@/lib/auth-client";
import posthog from "posthog-js";

export default function SignOutButton() {
  return (
    <button
      className="gh secondary"
      onClick={async () => {
        posthog.capture("user_signed_out");
        posthog.reset();
        await authClient.signOut();
        window.location.href = "/";
      }}
    >
      Sign out
    </button>
  );
}
