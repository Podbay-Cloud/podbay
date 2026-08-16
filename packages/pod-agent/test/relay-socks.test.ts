import { describe, it, expect } from "vitest";
import {
  REP,
  parseGreeting,
  greetingReply,
  parseConnect,
  connectReply,
  isDisallowedTarget,
} from "../src/relay-socks.js";

describe("SOCKS5 greeting", () => {
  it("accepts a v5 greeting offering no-auth", () => {
    expect(parseGreeting(Buffer.from([0x05, 0x01, 0x00]))).toEqual({ ok: true, noAuth: true });
  });
  it("flags a greeting that offers no no-auth method", () => {
    expect(parseGreeting(Buffer.from([0x05, 0x01, 0x02]))).toEqual({ ok: true, noAuth: false });
  });
  it("rejects a non-v5 or truncated greeting", () => {
    expect(parseGreeting(Buffer.from([0x04, 0x01, 0x00])).ok).toBe(false);
    expect(parseGreeting(Buffer.from([0x05, 0x02, 0x00])).ok).toBe(false); // says 2 methods, sends 1
  });
  it("replies with the selected method", () => {
    expect([...greetingReply(true)]).toEqual([0x05, 0x00]);
    expect([...greetingReply(false)]).toEqual([0x05, 0xff]);
  });
});

describe("SOCKS5 CONNECT parsing", () => {
  it("parses a domain target (the common case for a proxied browser)", () => {
    const host = "example.com";
    const buf = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
      Buffer.from(host, "utf8"),
      (() => { const p = Buffer.alloc(2); p.writeUInt16BE(443); return p; })(),
    ]);
    expect(parseConnect(buf)).toEqual({ req: { host: "example.com", port: 443, atyp: 3 } });
  });

  it("parses an IPv4 target", () => {
    const buf = Buffer.from([0x05, 0x01, 0x00, 0x01, 93, 184, 216, 34, 0x01, 0xbb]);
    expect(parseConnect(buf)).toEqual({ req: { host: "93.184.216.34", port: 443, atyp: 1 } });
  });

  it("refuses a non-CONNECT command and an unsupported address type", () => {
    expect(parseConnect(Buffer.from([0x05, 0x02, 0x00, 0x01, 1, 2, 3, 4, 0, 80]))).toEqual({
      fail: REP.GENERAL_FAILURE,
    });
    expect(parseConnect(Buffer.from([0x05, 0x01, 0x00, 0x09, 0, 0]))).toEqual({
      fail: REP.ADDR_TYPE_UNSUPPORTED,
    });
  });

  it("refuses a truncated request rather than reading past the buffer", () => {
    expect(parseConnect(Buffer.from([0x05, 0x01, 0x00, 0x01, 1, 2]))).toEqual({
      fail: REP.GENERAL_FAILURE,
    });
  });

  it("builds a reply carrying the code", () => {
    expect([...connectReply(REP.OK)].slice(0, 4)).toEqual([0x05, 0x00, 0x00, 0x01]);
    expect([...connectReply(REP.CONNECTION_REFUSED)][1]).toBe(REP.CONNECTION_REFUSED);
  });
});

describe("SSRF guard — the owner's LAN is never reachable from a pod", () => {
  it("refuses loopback, private, link-local, CGNAT and multicast literals", () => {
    for (const h of [
      "127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.0.1", "172.31.255.254",
      "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "0.0.0.0",
      "localhost", "foo.localhost", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1",
    ]) {
      expect(isDisallowedTarget(h), `${h} should be refused`).toBe(true);
    }
  });

  it("allows public literals and domain names", () => {
    for (const h of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "example.com", "sub.example.co.uk", "2606:4700::1111"]) {
      expect(isDisallowedTarget(h), `${h} should be allowed`).toBe(false);
    }
  });

  it("refuses a malformed IPv4 literal rather than letting it through", () => {
    expect(isDisallowedTarget("999.1.1.1")).toBe(true);
  });
});
