import DashboardPage from "@/components/dashboard-page";
import RelayConnectCard from "@/components/relay-connect-card";
import { myRelayStatus } from "@/lib/relay-actions";
import { editionOss } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Settings — theme/font live in the terminal top bar; account actions in the sidebar
 * user menu. The relay lives here because it is an owner-level capability (one relay
 * per person, shared across their pods), not a per-pod setting. */
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  // Self-host: the relay routes egress through podbay.cloud's relay authority, which self-host has
  // no part of — and a self-host pod already egresses from the owner's own network. So it's not a
  // thing in OSS; don't show it (nor mint a relay command that can't work).
  const oss = editionOss();
  const relay = oss ? null : await myRelayStatus();
  return (
    <DashboardPage title="Settings">
      <div className="space-y-6">
        {!oss && relay && <RelayConnectCard initial={relay} />}
        <p className="text-sm text-muted-foreground">
          Sign out is in the user menu at the bottom of the sidebar. More settings are coming soon.
        </p>
      </div>
    </DashboardPage>
  );
}
