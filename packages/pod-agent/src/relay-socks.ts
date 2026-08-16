/**
 * Minimal SOCKS5 (RFC 1928) codec for the pod-side relay proxy — the CONNECT path only
 * (no BIND, no UDP, no auth). Apps in the pod point `PODBAY_RELAY_PROXY` at this proxy;
 * each CONNECT is dialed through the owner's relay (the dialer is injected — wired to the
 * control-link mux in a later phase).
 *
 * Pure parse/build + the SSRF classification, so the protocol handling is tested without
 * a socket. The proxy server (relay-proxy.ts) wires these to a real net.Server + dialer.
 */

/** SOCKS5 reply codes we use. */
export const REP = {
  OK: 0x00,
  GENERAL_FAILURE: 0x01,
  NOT_ALLOWED: 0x02, // SSRF-refused target
  CONNECTION_REFUSED: 0x05, // no relay running → fail closed
  ADDR_TYPE_UNSUPPORTED: 0x08,
} as const;

export interface ConnectRequest {
  /** Destination host — an IPv4/IPv6 literal or a domain name. */
  host: string;
  port: number;
  /** The ATYP byte, so the reply can echo a matching address family. */
  atyp: 1 | 3 | 4;
}

/**
 * Parse the client greeting `VER NMETHODS METHODS...`. Returns whether it's a well-formed
 * SOCKS5 greeting that offers no-auth (0x00). We only support no-auth (the proxy is
 * localhost-only inside the pod; auth adds nothing).
 */
export function parseGreeting(buf: Buffer): { ok: boolean; noAuth: boolean } {
  if (buf.length < 2 || buf[0] !== 0x05) return { ok: false, noAuth: false };
  const n = buf[1]!;
  if (buf.length < 2 + n) return { ok: false, noAuth: false };
  const methods = buf.subarray(2, 2 + n);
  return { ok: true, noAuth: methods.includes(0x00) };
}

/** The greeting reply selecting a method (0x00 no-auth, or 0xFF "no acceptable"). */
export function greetingReply(noAuth: boolean): Buffer {
  return Buffer.from([0x05, noAuth ? 0x00 : 0xff]);
}

/**
 * Parse the CONNECT request `VER CMD RSV ATYP DST.ADDR DST.PORT`. Returns the target, or
 * a reply code to fail with (unsupported command / address type / truncated).
 */
export function parseConnect(buf: Buffer): { req: ConnectRequest } | { fail: number } {
  if (buf.length < 4 || buf[0] !== 0x05) return { fail: REP.GENERAL_FAILURE };
  if (buf[1] !== 0x01) return { fail: REP.GENERAL_FAILURE }; // only CONNECT
  const atyp = buf[3];
  let host: string;
  let offset: number;
  if (atyp === 0x01) {
    if (buf.length < 4 + 4 + 2) return { fail: REP.GENERAL_FAILURE };
    host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
    offset = 8;
  } else if (atyp === 0x03) {
    const len = buf[4]!;
    if (buf.length < 5 + len + 2) return { fail: REP.GENERAL_FAILURE };
    host = buf.subarray(5, 5 + len).toString("utf8");
    offset = 5 + len;
  } else if (atyp === 0x04) {
    if (buf.length < 4 + 16 + 2) return { fail: REP.GENERAL_FAILURE };
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16));
    host = parts.join(":");
    offset = 20;
  } else {
    return { fail: REP.ADDR_TYPE_UNSUPPORTED };
  }
  const port = buf.readUInt16BE(offset);
  return { req: { host, port, atyp: atyp as 1 | 3 | 4 } };
}

/** Build a CONNECT reply. BND.ADDR/PORT are 0.0.0.0:0 — clients ignore them for CONNECT. */
export function connectReply(code: number): Buffer {
  return Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

export { isDisallowedTarget } from "@podbay/shared/net-guard";
