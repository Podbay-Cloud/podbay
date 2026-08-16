import { requireAdmin, listUsersDetailed } from "@/lib/access";
import DashboardPage from "@/components/dashboard-page";
import AdminUserRow from "@/components/admin-user-row";

export const dynamic = "force-dynamic";

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : shortDate(iso);
}
function duration(ms: number | null): string {
  if (ms == null) return "—";
  const d = Math.round(ms / 86400000);
  return d >= 1 ? `${d}d` : `${Math.round(ms / 3600000)}h`;
}

/**
 * Backoffice users console. Everyone who has signed in, with the signals that
 * matter at alpha: who they are, whether they're approved, when they registered,
 * login recency + count, pods, and plan. Subscription is a placeholder until
 * billing lands. Pending approvals also surface on /admin (Access requests).
 */
export const metadata = { title: "Users" };

export default async function UsersPage() {
  await requireAdmin();
  const users = await listUsersDetailed();
  const approved = users.filter((u) => u.approved).length;

  const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
  const td = "px-3 py-2.5 align-middle whitespace-nowrap";

  return (
    <DashboardPage title="Users" intro={`${users.length} total · ${approved} approved`} wide>
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full border-collapse text-[13px]">
          <thead className="border-b border-border/60 bg-white/[0.02]">
            <tr>
              <th className={th}>User</th>
              <th className={th}>Status</th>
              <th className={th}>Registered</th>
              <th className={th}>Last login</th>
              <th className={`${th} text-right`}>Logins</th>
              <th className={`${th} text-right`}>Pods</th>
              <th className={th}>Plan</th>
              <th className={th}>Last IP</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border/60">
                <td className={td}>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">{u.email}</div>
                </td>
                <td className={td}>
                  <span
                    className={
                      u.approved
                        ? "rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success"
                        : "rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning"
                    }
                  >
                    {u.approved ? "approved" : "pending"}
                  </span>
                </td>
                <td className={`${td} text-muted-foreground`}>{shortDate(u.createdAt)}</td>
                <td className={td}>
                  <span title={u.lastLoginAt ?? "never"}>{ago(u.lastLoginAt)}</span>
                  {u.lastLoginAt && (
                    <span className="ml-1 text-[11px] text-muted-foreground">· {duration(u.lastSessionMs)} session</span>
                  )}
                </td>
                <td className={`${td} text-right tabular-nums`}>{u.loginCount}</td>
                <td className={`${td} text-right tabular-nums`}>{u.podCount}</td>
                <td className={`${td} text-muted-foreground`}>alpha</td>
                <td className={`${td} font-mono text-[11.5px] text-muted-foreground`}>
                  <span className="block max-w-[120px] truncate" title={u.lastIp ?? undefined}>
                    {u.lastIp ?? "—"}
                  </span>
                </td>
                <td className={`${td} text-right`}>
                  <AdminUserRow id={u.id} approved={u.approved} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Login count + last IP come from active sessions (better-auth). Plan is a placeholder until
        billing lands. Pending users can be approved here or on <a className="underline" href="/admin">Access requests</a>.
      </p>
    </DashboardPage>
  );
}
