"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, RefreshCw, Smartphone, Monitor, Radio, Check, X } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { CopyCodeButton } from "@/components/copy-code-button";
import {
  getCodexPairingCode,
  getCodexRcActive,
  getCodexDevices,
  confirmCodexDevice,
  forgetCodexDevice,
} from "@/lib/actions";

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
      Open the Codex app, tap the <Chip>☰</Chip> menu
    </>,
    <>
      Choose <Chip>Remote</Chip>, then <Chip>⋯</Chip> (top-right)
    </>,
    <>
      <Chip>Add connection</Chip> → <Chip>Pair manually</Chip>
    </>,
    <>Enter the code below</>,
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
 * DESKTOP ONLY. The two apps diverge after pairing, and conflating them makes onboarding
 * worse in both directions:
 *  - phone: pairing is enough — the pod appears under Projects on its own (verified 2026-08-09),
 *    so listing these steps there would send the user on an errand the app already did;
 *  - desktop: pairing opens nothing until the pod is added as a remote project by hand, so a
 *    user who paired "successfully" sees no session and reasonably concludes the pod is broken.
 *
 * There is no shortcut: `codex remote-control start` takes no project/dir argument and
 * `-C/--cd` only sets a CLI session's root, so this navigation lives entirely inside their
 * app and we can only state it exactly. What we CAN pre-empt, we do: the pod ships
 * `[projects."/home/dev/work"] trust_level = "trusted"` in ~/.codex/config.toml, so no trust
 * prompt stacks on top of it.
 */
const OPEN_STEPS: ReactNode[] = [
  <>
    In the sidebar, click <Chip>+</Chip> next to <Chip>Projects</Chip>
  </>,
  <>
    Choose <Chip>Remote</Chip> (&ldquo;a folder on a connected machine&rdquo;) → <Chip>Next</Chip>
  </>,
  <>
    Type any <Chip>Project name</Chip>
  </>,
  <>
    Pick this pod under <Chip>Remote host</Chip>
  </>,
  <>
    Set <Chip>Source folder</Chip> to <Chip>work</Chip> — it defaults to <Chip>/home/dev</Chip>,
    the home folder, which is not your project
  </>,
  <>
    Click <Chip>Add project</Chip>
  </>,
];

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
  const [rcActive, setRcActive] = useState(false);
  const [devices, setDevices] = useState<{ name: string; at: string }[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [saving, setSaving] = useState(false);
  const [isWide, setIsWide] = useState(false);

  const loadDevices = useCallback(async () => {
    setDevices(await getCodexDevices(slug).catch(() => []));
  }, [slug]);
  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  // Is remote control live on the pod? This says "registered and available in your
  // Codex app" — the honest signal. It is NOT "a device is paired": that lives
  // server-side, and a badge keyed off local state told users they were connected
  // before they had done anything (reverted 2026-07-27).
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const a = await getCodexRcActive(slug).catch(() => false);
      if (!stop) setRcActive(a);
    };
    void poll();
    const t = setInterval(() => void poll(), 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [slug]);

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
    await confirmCodexDevice(slug, deviceName || (platform === "phone" ? "My phone" : "My desktop"));
    setDeviceName("");
    await loadDevices();
    setSaving(false);
    onPaired?.();
  }, [slug, deviceName, platform, loadDevices, onPaired]);

  const tab = (p: Platform, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setPlatform(p)}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
        platform === p ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground"
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
            {embedded ? "Pair a device" : "Connect the Codex app to this pod"}
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
          {!embedded && rcActive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[12px] text-success">
              <Radio className="size-3" /> Remote control active
            </span>
          )}
        </div>
        <span className="text-[13px] leading-relaxed text-muted-foreground">
          Sign into the Codex app with your account — your pod appears as{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{device}</code>.
        </span>
      </div>

      {!embedded && devices.length > 0 && (
        <ul className="flex flex-col gap-1">
          {devices.map((d) => (
            <li key={d.name} className="flex items-center gap-2 text-[13px]">
              <Check className="size-3.5 shrink-0 text-success" />
              <span className="font-medium">{d.name}</span>
              <span className="text-muted-foreground">paired {new Date(d.at).toLocaleDateString()}</span>
              <button
                type="button"
                aria-label={`Forget ${d.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => void forgetCodexDevice(slug, d.name).then(loadDevices)}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Which app are you connecting? The two reach the pair screen differently. */}
      <div className="inline-flex self-start rounded-lg border border-border/60 p-0.5 text-[13px]">
        {tab("phone", <Smartphone className="size-3.5" />, "Phone")}
        {tab("desktop", <Monitor className="size-3.5" />, "Desktop")}
      </div>

      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        1 · Pair the app
      </p>
      <ol className="flex flex-col gap-1.5">
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
            Scan this with your phone at step 3, or enter the code below.
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
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
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
      )}

      {/* The apps diverge here: the phone app adds the pod itself, the desktop app does not. */}
      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          2 · Open your session
        </p>
        {platform === "phone" ? (
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">
            Nothing else to do — once paired, this pod appears under <b>Projects</b> in the app and
            the session is right there.
          </span>
        ) : (
          <>
            <span className="text-[12.5px] leading-relaxed text-muted-foreground">
              On desktop, pairing doesn&rsquo;t open anything by itself — add the pod as a project
              once:
            </span>
            <ol className="mt-0.5 flex flex-col gap-1.5">
              {OPEN_STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                  <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <span className="text-[12.5px] text-muted-foreground">
        Remote control needs the pod awake — it stays connected while the pod is running.
      </span>
    </div>
  );
}
