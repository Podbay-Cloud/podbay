"use client";

import { useTransition } from "react";
import { approveUser, revokeUser, deferUser, undeferUser } from "@/lib/admin-actions";

export default function AdminUserRow({
  id,
  approved,
  deferred = false,
}: {
  id: string;
  approved: boolean;
  /** A pending request the operator set aside ("Later"). Shows Approve + Move-back instead of Later. */
  deferred?: boolean;
}) {
  const [pending, start] = useTransition();

  if (approved) {
    return (
      <button className="pill" disabled={pending} onClick={() => start(() => revokeUser(id))}>
        Revoke
      </button>
    );
  }

  return (
    <span className="inline-flex gap-1.5">
      <button className="gh" disabled={pending} onClick={() => start(() => approveUser(id))}>
        Approve
      </button>
      {deferred ? (
        <button className="pill" disabled={pending} onClick={() => start(() => undeferUser(id))}>
          Move back
        </button>
      ) : (
        <button className="pill" disabled={pending} onClick={() => start(() => deferUser(id))}>
          Later
        </button>
      )}
    </span>
  );
}
