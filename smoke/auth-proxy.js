// Minimal zero-dependency front door for the smoke test.
// Cookie-session auth (works on mobile WS upgrades, unlike HTTP Basic Auth),
// reverse-proxying both HTTP and WebSocket to ttyd on 127.0.0.1:7681.
const http = require("http");
const net = require("net");
const crypto = require("crypto");

const PASS = process.env.TTYD_PASS;
if (!PASS) { console.error("TTYD_PASS not set"); process.exit(1); }
const SECRET = process.env.PROXY_SECRET || crypto.randomBytes(16).toString("hex");
const TOKEN = crypto.createHmac("sha256", SECRET).update(PASS).digest("hex");
const COOKIE = "pbsess";
const UPSTREAM = { host: "127.0.0.1", port: 7681 };

const authed = (req) => {
  const c = req.headers.cookie || "";
  const m = c.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  return m && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(TOKEN));
};

const loginPage = (msg = "") => `<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>podbay</title><style>
body{background:#1a1a1a;color:#eee;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}
form{display:flex;flex-direction:column;gap:12px;width:260px}
input{padding:12px;font-size:16px;border-radius:8px;border:1px solid #444;background:#222;color:#eee}
button{padding:12px;font-size:16px;border-radius:8px;border:0;background:#d97757;color:#fff;font-weight:600}
.m{color:#e06;min-height:1em;font-size:14px}</style></head><body>
<form method=POST action=/login><b style="font-size:20px">podbay</b>
<div class=m>${msg}</div>
<input name=password type=password placeholder=Password autofocus autocomplete=current-password>
<button>Enter</button></form></body></html>`;

const proxyHttp = (req, res) => {
  const up = http.request({ ...UPSTREAM, method: req.method, path: req.url, headers: req.headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", () => { res.writeHead(502); res.end("upstream down"); });
  req.pipe(up);
};

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => {
      const p = decodeURIComponent((body.match(/password=([^&]*)/) || [])[1] || "").replace(/\+/g, " ");
      if (p === PASS) {
        res.writeHead(302, { "Set-Cookie": `${COOKIE}=${TOKEN}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`, Location: "/" });
        res.end();
      } else { res.writeHead(401, { "Content-Type": "text/html" }); res.end(loginPage("Wrong password")); }
    });
    return;
  }
  if (!authed(req)) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(loginPage()); return; }
  proxyHttp(req, res);
});

// WebSocket upgrades: cookies ARE sent here by all browsers, so auth works on mobile.
server.on("upgrade", (req, socket, head) => {
  if (!authed(req)) { socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); return; }
  const up = net.connect(UPSTREAM.port, UPSTREAM.host, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` +
      Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
    if (head && head.length) up.write(head);
    socket.pipe(up); up.pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(8080, () => console.log("auth-proxy on :8080 -> ttyd:7681"));
