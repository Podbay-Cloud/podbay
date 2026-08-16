import type { IncomingMessage } from "node:http";
import type { PodService } from "@podbay/control-plane";
import type { Logger } from "@podbay/shared/log";

/**
 * The relay's control-plane surface, as the gateway needs it. Structural, so the real
 * `RelayService` (from @podbay/control-plane) satisfies it and a fake stands in for
 * tests. Everything the gateway does to relay auth/state goes through here.
 */
export interface RelayAuthority {
  /** Spend a pairing code, returning the owner it belongs to, or null if unknown,
   * expired, or already used. Single-use is enforced here. */
  redeemPairingCode(code: string): Promise<string | null>;
  /** Mint a fresh pairing code for an owner (used when a pod asks its owner to bring
   * up a relay). */
  mintPairingCode(ownerId: string): Promise<{ code: string; expiresAt: number }>;
  /** Issue a durable, reusable reconnect token at pairing, handed to the relay so it
   * can reconnect after a restart/blip without re-pairing. */
  issueReconnectToken(ownerId: string): Promise<string>;
  /** Validate a reusable reconnect token (does NOT consume it), returning the owner or
   * null if unknown/expired. */
  validateReconnectToken(token: string): Promise<string | null>;
  /** Record (or refresh) that an owner's relay is connected. */
  markConnected(ownerId: string, loginDomains: string[]): Promise<void>;
  /** Keep-alive while the socket is up. */
  heartbeat(ownerId: string): Promise<void>;
  /** The socket closed and we know it. */
  markDisconnected(ownerId: string): Promise<void>;
}

export interface GatewayConfig {
  /** Structured logger; defaults to a JSON-line logger on stdout. */
  logger?: Logger;
  /** The control plane (ownership, lifecycle, idle policy). */
  control: PodService;
  /** Fetch-memory sink for the pod control sockets. Optional: absent → the control
   * hub is not created and the gateway behaves exactly as before. */
  fetchMemory?: import("./pod-control-hub.js").FetchMemorySink;
  /** Relay registry. Absent → the /relay endpoint 404s and nothing else changes. */
  relays?: import("./relay-registry.js").RelayRegistry;
  /** Public wss:// base a relay dials to reach this gateway, e.g.
   * "wss://gateway.podbay.cloud". Used to build the copy-paste command a pod hands its
   * owner. Absent → the pod-pairing convenience is off (the dashboard still works). */
  relayConnectUrl?: string;
  /** Authority that validates relay pairing codes and records connection state,
   * backed by the shared database (RelayService satisfies this). Absent → a relay
   * cannot authenticate, so /relay closes every connection. Injected as an interface,
   * not a concrete service, so the socket path stays testable without a database. */
  relayAuthority?: RelayAuthority;
  /** Authenticate an upgrade request to a user id, or null if unauthenticated. */
  authenticate: (req: IncomingMessage) => Promise<string | null>;
  /** Resolve a running pod's pod-agent WebSocket URL. */
  resolveAgentUrl: (podId: string) => Promise<string>;
  /**
   * Preview URL base host (e.g. "preview.podbay.cloud"). When set, the gateway
   * also serves `<slug>.<previewBase>` by proxying to the pod's app port. Unset
   * (local/dev) → previews disabled, terminal-only.
   */
  previewBase?: string;
  /** Pod app port the preview proxies to (default 3000). */
  previewPort?: number;
  /** The main app origin (e.g. "https://podbay.cloud"). When set, an
   * unauthenticated BROWSER hitting a private preview is redirected here to sign
   * in (the session cookie is domain-shared, so the retry then works) instead of
   * a bare 401. */
  appOrigin?: string;
  /** Resolve a running pod's preview origin, e.g. `http://[ip]:3000`. */
  resolvePreviewOrigin?: (podId: string) => Promise<string>;
  host?: string;
  port?: number;
  /** Idle threshold handed to the control-plane idle policy. */
  idleThresholdMs?: number;
  /** Pods to re-check per sweep. Bounded so a large fleet rotates instead of
   * hammering the provider once a minute. */
  reconcilePerSweep?: number;
  /** How often the idle sweep runs. */
  tickMs?: number;
  /** How often the provisioner sweep runs (builds "provisioning" pods). Fast so
   * launches feel immediate. 0 disables the worker in this instance. */
  provisionIntervalMs?: number;
  /** Max time to wait for a woken pod to reach running. */
  wakeTimeoutMs?: number;
  /** Maintenance-wake dormancy threshold (ms). 0/undefined = disabled (opt-in). */
  maintenanceDormantMs?: number;
  /** Max pods to maintenance-wake per sweep (bounds cost). */
  maintenanceMaxPerSweep?: number;
}
