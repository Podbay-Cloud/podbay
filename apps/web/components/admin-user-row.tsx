"use client";

import { useTransition } from "react";
import { approveUser, revokeUser } from "@/lib/admin-actions";

export default function AdminUserRow({
  id,
  approved,
}: {
  id: string;
  approved: boolean;
}) {
  const [pending, start] = useTransition();
  return approved ? (
    <button className="pill" disabled={pending} onClick={() => start(() => revokeUser(id))}>
      Revoke
    </button>
  ) : (
    <button className="gh" disabled={pending} onClick={() => start(() => approveUser(id))}>
      Approve
    </button>
  );
}
