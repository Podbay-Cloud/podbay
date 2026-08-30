"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, RefreshCw, Smartphone, Monitor, Check, X } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { CopyCodeButton } from "@/components/copy-code-button";
import { getCodexPairingCode, confirmCodexDevice } from "@/lib/actions";

type Pairing = { manualPairingCode: string; pairingCode: string; expiresAt: number; deviceName: string };
type Platform = "phone" | "desktop";

/** An inline "kbd"-style chip for a menu item / glyph, so the nav steps read as UI. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
      {children}
    </span>
  );
}

/** The pair-screen path for each app — they differ (vels mapped both). Rendered as
 * numbered steps so it reads as a walkthrough, not an arrow-string. */
const STEPS: Record<Platform, ReactNode[]> = {
  phone: [
    <>
      Open the ChatGPT app, tap the <Chip>☰</Chip> menu
    </>,
    <>
      Choose <Chip>Remote</Chip>, then <Chip>⋯</Chip> (top-right)
    </>,
    <>
      <Chip>Add connection</Chip> → <Chip>Pair a new device</Chip>
    </>,
  ],
  desktop: [
    <>
      Click your name → <Chip>Settings</Chip>
    </>,
    <>
      <Chip>Connections</Chip> → <Chip>Control other devices</Chip>
    </>,
    <>
      Click <Chip>Add</Chip>
    </>,
    <>Enter the 8-digit code below</>,
  ],
};

/**
 * The Codex remote-control hand-off — the codex analog of Claude's "Continue in
 * Claude" session URL. Codex has no clickable link: the pod runs a daemon and the
 * user pairs their Codex app with a short-lived CODE (validated live 2026-07-26).
 * The phone and desktop apps reach the pair screen differently, so a picker shows one
 * platform's steps at a time.
 *
 * There is deliberately NO "Connected" state: pairing is recorded server-side by
 * OpenAI, and nothing on the pod says whether an app is paired. `remote_control_enrollments`
 * looks like it would, but it is the DAEMON's own self-enrollment — it appears as soon
 * as the daemon starts, identically on paired and unpaired pods, so keying a "Connected"
 * badge off it claimed success before the user had paired at all (shipped and reverted
 * 2026-07-27). The honest UI is: show the code, tell them where it lands. A real signal
 * would need the app-server's `remoteControl/pairing/status` RPC over the control socket
 * (needs an initialize handshake — unexplored).
 */
export function CodexPairPanel({
  slug,
  podName,
  embedded = false,
  onClose,
  onPaired,
}: {
  slug: string;
  podName?: string | null;
  /** Rendered inside an agent card: the card owns the border, the RC status and
   * the device list, so the panel drops its own copies of all three. */
  embedded?: boolean;
  onClose?: () => void;
  onPaired?: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>("phone");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [saving, setSaving] = useState(false);
  const [isWide, setIsWide] = useState(false);

  // The QR is scanned by a phone camera pointed at a SEPARATE screen, so it only
  // helps on a desktop-sized cockpit + the Phone flow. On a phone-sized viewport (you'd
  // be scanning your own screen) or the Desktop app (no scanner — it takes the typed
  // code) we show only the code.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const on = () => setIsWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Encode the pairing URL the Codex app expects (confirmed by decoding a real
  // desktop-app pairing QR): https://chatgpt.com/codex/pair?pairing_code=<pairingCode>.
  useEffect(() => {
    const code = pairing?.pairingCode;
    if (!code) {
      setQrDataUrl(null);
      return;
    }
    let stale = false;
    QRCode.toDataURL(`https://chatgpt.com/codex/pair?pairing_code=${code}`, { margin: 2, width: 320 })
      .then((u) => !stale && setQrDataUrl(u))
      .catch(() => !stale && setQrDataUrl(null));
    return () => {
      stale = true;
    };
  }, [pairing?.pairingCode]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await getCodexPairingCode(slug).catch(() => ({
      error: "Couldn’t reach this pod to pair",
    }));
    if ("error" in r) {
      setError(r.error);
      setPairing(null);
    } else {
      setPairing(r);
      setNow(Date.now());
    }
    setLoading(false);
  }, [slug]);

  // Tick the countdown only while a code is showing.
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  const secondsLeft = pairing ? Math.max(0, Math.round(pairing.expiresAt - now / 1000)) : 0;
  const expired = pairing != null && secondsLeft <= 0;
  // Pre-pairing we have no response yet, so fall back to the pod's chosen NAME —
  // that is what the pod now reports to Codex as its device name. Falling back to
  // the slug (as this did) told the user the wrong thing until they generated a code.
  const device = pairing?.deviceName ?? podName?.trim() ?? slug;

  const confirm = useCallback(async () => {
    setSaving(true);
    setError(null);
    const label = deviceName || (platform === "phone" ? "My phone" : "My desktop");
    const r = await confirmCodexDevice(slug, label).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "Couldn’t record this pairing",
    }));
    setSaving(false);
    if (r && "error" in r) {
      // Keep the wizard open with the entered label intact — design decision 6: a failed
      // confirmation must not mimic success (rc-reconnect-hardening).
      setError(r.error);
      return;
    }
    setDeviceName("");
    onPaired?.();
  }, [slug, deviceName, platform, onPaired]);

  const tab = (p: Platform, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setPlatform(p)}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
        platform === p ? "bg-white/[0.06] text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      data-tour="pair-codex"
      className={
        embedded
          ? "flex flex-col gap-3 border-t border-border/60 pt-3"
          : "flex flex-col gap-3 rounded-xl border border-border/60 bg-white/[0.02] px-[18px] py-4"
      }
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">
            {embedded ? "Pair a device" : "Connect the ChatGPT app to this pod"}
          </span>
          {onClose && (
            <button
              type="button"
              aria-label="Close pairing"
              onClick={onClose}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <span className="text-[13px] leading-relaxed text-muted-foreground">
          Sign into the ChatGPT app with your account — your pod appears as{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{device}</code>.
        </span>
      </div>

      {/* Which app are you connecting? The two reach the pair screen differently. */}
      <div className="inline-flex self-start rounded-lg border border-border/60 p-0.5 text-[13px]">
        {tab("phone", <Smartphone className="size-3.5" />, "Phone")}
        {tab("desktop", <Monitor className="size-3.5" />, "Desktop")}
      </div>

      <ol className="mt-1 flex flex-col gap-1.5">
        {STEPS[platform].map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
              {i + 1}
            </span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      {!pairing && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button onClick={() => void generate()} disabled={loading} className="self-start">
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Generating…
              </>
            ) : (
              "Generate pairing code"
            )}
          </Button>
          {error && <span className="text-[13px] text-[var(--accent-light)]">{error}</span>}
        </div>
      )}

      {pairing && platform === "phone" && isWide && qrDataUrl && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="Codex pairing QR"
            width={132}
            height={132}
            className="rounded-lg bg-white p-1.5"
          />
          <span className="text-[13px] leading-relaxed text-muted-foreground">
            Scan this with your phone at step 3, or tap <Chip>Pair manually</Chip> and enter the
            code below.
          </span>
        </div>
      )}

      {pairing && (
        <div className="flex flex-wrap items-center gap-2.5">
          <CopyCodeButton
            code={pairing.manualPairingCode}
            className="px-3 py-2 text-lg tracking-[0.15em]"
          />
          {expired ? (
            <span className="text-[13px] text-muted-foreground">Code expired — get a new one</span>
          ) : (
            <span className="text-[13px] tabular-nums text-muted-foreground">
              expires in {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, "0")}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void generate()} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> New code
          </Button>
        </div>
      )}

      {pairing && (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={platform === "phone" ? "My phone" : "My desktop"}
              maxLength={40}
              className="h-8 rounded-md border border-border/60 bg-background px-2.5 text-[13px] outline-none focus:border-border-strong"
            />
            <Button size="sm" variant="outline" onClick={() => void confirm()} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              I&rsquo;ve paired this
            </Button>
            <span className="text-[12.5px] text-muted-foreground">
              We can&rsquo;t see pairings — tell us and we&rsquo;ll remember it here.
            </span>
          </div>
          {error && <span className="text-[13px] text-[var(--accent-light)]">{error}</span>}
        </div>
      )}

    </div>
  );
}
