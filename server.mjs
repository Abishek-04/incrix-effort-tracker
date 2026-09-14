// LAN-only production server: serves the app to devices on your local network and refuses everyone else.
// The check uses the TCP connection's real address (not headers), so it can't be spoofed.
// Run with: npm run start:lan
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import next from "next";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

/** Loopback, private (RFC 1918), link-local and IPv6 unique-local addresses. */
export function isLocalAddress(raw = "") {
  const ip = raw.replace(/^::ffff:/i, "").toLowerCase();
  if (ip === "::1" || ip.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(ip)) return true;
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return (
    p[0] === 127 ||
    p[0] === 10 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254)
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const app = next({ dev: false, hostname: HOST, port: PORT });
  const handle = app.getRequestHandler();
  await app.prepare();

  createServer((req, res) => {
    const ip = req.socket.remoteAddress ?? "";
    if (!isLocalAddress(ip)) {
      console.warn(`[lan-only] blocked ${ip} ${req.method} ${req.url}`);
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Incrix Effort Tracker is only available on the office network.");
      return;
    }
    req.headers["x-forwarded-for"] = ip; // replace any client-supplied value with the real address
    handle(req, res);
  }).listen(PORT, HOST, () => {
    const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
    console.log(`\n  Incrix Effort Tracker — local network only`);
    console.log(`  This Mac:     http://localhost:${PORT}`);
    lan.forEach((a) => console.log(`  Wi-Fi/LAN:    http://${a}:${PORT}`));
    console.log(`\n  Keep this window open. Press Ctrl+C to stop.\n`);
  });
}
