// podbay egress proxy — a transparent TLS-SNI / HTTP-Host allowlist filter.
//
// iptables REDIRECTs the agent's outbound :80/:443 here. We recover the ORIGINAL
// destination (SO_ORIGINAL_DST), peek the SNI (443) or Host header (80), and only
// forward to hosts on the allowlist. Our own upstream dials set SO_MARK so
// iptables excludes them from the REDIRECT (no loop) — owner/cgroup matches are
// unavailable on Fly's kernel, fwmark is the one that works.
package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	soOriginalDst = 80      // SO_ORIGINAL_DST (IPPROTO_IP) and IP6T_SO_ORIGINAL_DST (IPPROTO_IPV6)
	fwMark        = 0x1     // excluded from the REDIRECT rule
	peekMax       = 8 << 10 // bytes of the first request we buffer to read the host
)

var allowlist []string

func main() {
	listen := envOr("PODBAY_EGRESS_LISTEN", ":3129")
	allowlist = loadAllow(envOr("PODBAY_EGRESS_ALLOWLIST", "/etc/podbay/egress-domains"))
	ln, err := net.Listen("tcp", listen)
	if err != nil {
		log.Fatalf("listen %s: %v", listen, err)
	}
	log.Printf("podbay-egress: listening %s, %d allowed domain suffixes", listen, len(allowlist))
	for {
		c, err := ln.Accept()
		if err != nil {
			continue
		}
		go handle(c.(*net.TCPConn))
	}
}

func handle(client *net.TCPConn) {
	defer client.Close()
	dstIP, dstPort, err := originalDst(client)
	if err != nil {
		return
	}

	_ = client.SetReadDeadline(time.Now().Add(10 * time.Second))
	buf := make([]byte, peekMax)
	n, err := client.Read(buf)
	if err != nil || n == 0 {
		return
	}
	_ = client.SetReadDeadline(time.Time{})
	head := buf[:n]

	var host string
	if dstPort == 443 {
		host = sniFromClientHello(head)
	} else {
		host = hostFromHTTP(head)
	}
	if host == "" || !allowed(host) {
		log.Printf("podbay-egress: DENY host=%q dst=%s:%d", host, dstIP, dstPort)
		return
	}

	upstream, err := dialMarked(dstIP, dstPort)
	if err != nil {
		log.Printf("podbay-egress: upstream %s:%d: %v", dstIP, dstPort, err)
		return
	}
	defer upstream.Close()
	if _, err := upstream.Write(head); err != nil {
		return
	}
	pipe(client, upstream)
}

// originalDst recovers the pre-REDIRECT destination via getsockopt.
func originalDst(c *net.TCPConn) (net.IP, int, error) {
	raw, err := c.SyscallConn()
	if err != nil {
		return nil, 0, err
	}
	var ip net.IP
	var port int
	var perr error
	cerr := raw.Control(func(fd uintptr) {
		// IPv6 (also covers v4-mapped connections on a dual-stack listener).
		var a6 syscall.RawSockaddrInet6
		l6 := uint32(unsafe.Sizeof(a6))
		if _, _, e := syscall.Syscall6(syscall.SYS_GETSOCKOPT, fd, uintptr(syscall.IPPROTO_IPV6),
			soOriginalDst, uintptr(unsafe.Pointer(&a6)), uintptr(unsafe.Pointer(&l6)), 0); e == 0 &&
			a6.Family == syscall.AF_INET6 {
			ip = net.IP(a6.Addr[:])
			port = int(binary.BigEndian.Uint16((*[2]byte)(unsafe.Pointer(&a6.Port))[:]))
			if v4 := ip.To4(); v4 != nil {
				ip = v4
			}
			return
		}
		// IPv4.
		var a4 syscall.RawSockaddrInet4
		l4 := uint32(unsafe.Sizeof(a4))
		if _, _, e := syscall.Syscall6(syscall.SYS_GETSOCKOPT, fd, uintptr(syscall.IPPROTO_IP),
			soOriginalDst, uintptr(unsafe.Pointer(&a4)), uintptr(unsafe.Pointer(&l4)), 0); e == 0 {
			ip = net.IP(a4.Addr[:])
			port = int(binary.BigEndian.Uint16((*[2]byte)(unsafe.Pointer(&a4.Port))[:]))
			return
		}
		perr = fmt.Errorf("no original dst")
	})
	if cerr != nil {
		return nil, 0, cerr
	}
	if perr != nil {
		return nil, 0, perr
	}
	return ip, port, nil
}

func dialMarked(ip net.IP, port int) (net.Conn, error) {
	d := &net.Dialer{
		Timeout: 15 * time.Second,
		Control: func(_, _ string, c syscall.RawConn) error {
			return c.Control(func(fd uintptr) {
				_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, fwMark)
			})
		},
	}
	return d.Dial("tcp", net.JoinHostPort(ip.String(), strconv.Itoa(port)))
}

func pipe(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	cp := func(dst, src net.Conn) {
		defer wg.Done()
		_, _ = io.Copy(dst, src)
		if tc, ok := dst.(*net.TCPConn); ok {
			_ = tc.CloseWrite()
		}
	}
	go cp(a, b)
	go cp(b, a)
	wg.Wait()
}

// sniFromClientHello extracts the SNI host from a TLS ClientHello record.
func sniFromClientHello(b []byte) string {
	if len(b) < 5 || b[0] != 0x16 { // TLS handshake record
		return ""
	}
	rec := int(binary.BigEndian.Uint16(b[3:5]))
	if 5+rec > len(b) {
		rec = len(b) - 5
	}
	p := b[5 : 5+rec]
	if len(p) < 4 || p[0] != 0x01 { // ClientHello
		return ""
	}
	p = p[4:] // skip handshake header
	if len(p) < 34 {
		return ""
	}
	p = p[34:] // client_version(2) + random(32)
	// session id
	if len(p) < 1 || len(p) < 1+int(p[0]) {
		return ""
	}
	p = p[1+int(p[0]):]
	// cipher suites
	if len(p) < 2 {
		return ""
	}
	cs := int(binary.BigEndian.Uint16(p))
	p = p[2:]
	if len(p) < cs {
		return ""
	}
	p = p[cs:]
	// compression methods
	if len(p) < 1 || len(p) < 1+int(p[0]) {
		return ""
	}
	p = p[1+int(p[0]):]
	// extensions
	if len(p) < 2 {
		return ""
	}
	extLen := int(binary.BigEndian.Uint16(p))
	p = p[2:]
	if len(p) < extLen {
		extLen = len(p)
	}
	p = p[:extLen]
	for len(p) >= 4 {
		typ := binary.BigEndian.Uint16(p)
		ln := int(binary.BigEndian.Uint16(p[2:]))
		p = p[4:]
		if len(p) < ln {
			return ""
		}
		if typ == 0x00 { // server_name
			sn := p[:ln]
			if len(sn) < 5 {
				return ""
			}
			// server_name_list(2) + type(1) + name_len(2)
			nameLen := int(binary.BigEndian.Uint16(sn[3:5]))
			if 5+nameLen > len(sn) {
				return ""
			}
			return strings.ToLower(string(sn[5 : 5+nameLen]))
		}
		p = p[ln:]
	}
	return ""
}

func hostFromHTTP(b []byte) string {
	for _, line := range strings.Split(string(b), "\r\n") {
		if len(line) >= 5 && strings.EqualFold(line[:5], "host:") {
			h := strings.TrimSpace(line[5:])
			if i := strings.IndexByte(h, ':'); i >= 0 {
				h = h[:i]
			}
			return strings.ToLower(h)
		}
	}
	return ""
}

func allowed(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for _, d := range allowlist {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}

func loadAllow(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("podbay-egress: no allowlist at %s: %v (deny all)", path, err)
		return nil
	}
	var out []string
	for _, l := range strings.Split(string(data), "\n") {
		l = strings.TrimSpace(strings.ToLower(l))
		if l != "" && !strings.HasPrefix(l, "#") {
			out = append(out, l)
		}
	}
	return out
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
