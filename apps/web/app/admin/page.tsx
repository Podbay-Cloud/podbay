import { requireAdmin, listUsers } from "@/lib/access";
import DashboardPage from "@/components/dashboard-page";
import AdminUserRow from "@/components/admin-user-row";

export const dynamic = "force-dynamic";

export const metadata = { title: "Access requests" };

export default async function Admin() {
  await requireAdmin();
  // Access requests = people WAITING for approval. Approved users (incl. you)
  // live on /admin/users, so this page isn't cluttered with everyone.
  const pending = (await listUsers()).filter((u) => !u.approved);

  return (
    <DashboardPage
      title="Access requests"
      intro={pending.length ? `${pending.length} waiting` : "No one waiting — all caught up."}
    >
      {pending.length === 0 ? (
        <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
          No pending requests. See <a className="underline" href="/admin/users">all users →</a>
        </p>
      ) : (
      <ul className="pod-list">
        {pending.map((u) => (
          <li key={u.id} className="pod-row">
            <div className="pod-meta">
              <span className="pod-name">{u.name}</span>
              <span className="pod-sub">
                {u.email} ·{" "}
                <span className={u.approved ? "pod-status-running" : "pod-status-sleeping"}>
                  {u.approved ? "approved" : "pending"}
                </span>
              </span>
            </div>
            <AdminUserRow id={u.id} approved={u.approved} />
          </li>
        ))}
      </ul>
      )}
    </DashboardPage>
  );
}
