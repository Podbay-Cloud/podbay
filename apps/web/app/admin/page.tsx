import { requireAdmin, listUsers } from "@/lib/access";
import DashboardPage from "@/components/dashboard-page";
import AdminUserRow from "@/components/admin-user-row";
import type { AdminUser } from "@/lib/access";

export const dynamic = "force-dynamic";

export const metadata = { title: "Access requests" };

function RequestList({ users, deferred }: { users: AdminUser[]; deferred: boolean }) {
  return (
    <ul className="pod-list">
      {users.map((u) => (
        <li key={u.id} className="pod-row">
          <div className="pod-meta">
            <span className="pod-name">{u.name}</span>
            <span className="pod-sub">
              {u.email} ·{" "}
              <span className="pod-status-sleeping">{deferred ? "later" : "pending"}</span>
            </span>
          </div>
          <AdminUserRow id={u.id} approved={u.approved} deferred={deferred} />
        </li>
      ))}
    </ul>
  );
}

export default async function Admin() {
  await requireAdmin();
  // Access requests = people WAITING for approval. Approved users (incl. you) live on /admin/users.
  // "Later" = requests the operator set aside to revisit — kept out of the main queue but not lost.
  const all = (await listUsers()).filter((u) => !u.approved);
  const waiting = all.filter((u) => !u.deferredAt);
  const later = all.filter((u) => u.deferredAt);

  return (
    <DashboardPage
      title="Access requests"
      intro={
        waiting.length
          ? `${waiting.length} waiting${later.length ? ` · ${later.length} on hold` : ""}`
          : later.length
            ? `No one waiting · ${later.length} on hold for later`
            : "No one waiting — all caught up."
      }
    >
      {waiting.length === 0 ? (
        <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
          No pending requests. See <a className="underline" href="/admin/users">all users →</a>
        </p>
      ) : (
        <RequestList users={waiting} deferred={false} />
      )}

      {later.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            Later · {later.length}
          </h2>
          <p className="mb-3 text-[12.5px] text-muted-foreground">
            Set aside to revisit. Approve when ready, or move back to the waiting queue.
          </p>
          <RequestList users={later} deferred={true} />
        </div>
      )}
    </DashboardPage>
  );
}
