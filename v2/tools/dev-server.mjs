// ============================================================
//  เครื่องนักพัฒนา: เสิร์ฟหน้าเว็บ v2/web + หลังบ้านจริง (server/) บน SQLite แทน D1 + สะพาน GAS จำลองด้วย gas/Code.gs ตัวจริง
//    node --no-warnings v2/tools/dev-server.mjs [--port 8787] [--mem] [--fresh]
//    --mem   = ฐานในหน่วยความจำ (เทสต์หน้าจอใช้) · ไม่ใส่ = ไฟล์ v2/.dev/pk.sqlite (ข้อมูลอยู่ข้ามการรัน)
//    --fresh = ลบไฟล์ฐานเดิมแล้วเริ่มใหม่ (ข้อมูลสมมติชุดใหม่)
//  เข้าระบบในเครื่องนี้: แตะชื่อไหนก็ได้ PIN 1234 (ข้อมูลสมมติ) — ไม่มีอะไรออกไปหา Google/Cloudflare จริง
// ============================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, migrate } from "../tests/helpers/d1.mjs";
import { loadGas } from "../tests/gas/harness.mjs";
import { seedGas } from "../tests/fixtures/sheets.mjs";
import { createApp } from "../server/app.mjs";
import { buildRegistry } from "../server/actions/index.mjs";
import { seedDemo, DEMO_STAFF, DEMO_PIN } from "./seed-demo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const WEB = path.join(ROOT, "web");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp" };

export async function startDev(opt) {
  const o = opt || {};
  // สะพาน GAS จำลอง = gas/Code.gs ตัวจริง + ชีตจำลอง (พนักงานตัวอย่าง PIN 1234)
  const G = loadGas(fs.readFileSync(path.join(ROOT, "..", "gas", "Code.gs"), "utf8"), { now: Date.now() });
  seedGas(G);
  const sheet = G.books.get(G.props.PK_SHEET_ID).getSheetByName("Staff");
  sheet.data.splice(1);
  for (const [id, nick, dept] of DEMO_STAFF) sheet.data.push([id, nick + " (ตัวอย่าง)", nick, dept, DEMO_PIN, "ทำงาน", "2026-01-01", "", "", ""]);
  G.ctx.dirty_();
  const clock = () => { const n = Date.now(); G.setNow(n); return n; };

  let file = ":memory:";
  if (!o.mem) {
    fs.mkdirSync(path.join(ROOT, ".dev"), { recursive: true });
    file = path.join(ROOT, ".dev", "pk.sqlite");
    if (o.fresh && fs.existsSync(file)) fs.rmSync(file);
  }
  const d1 = makeD1(file);
  migrate(d1);
  if (!d1.one("SELECT count(*) n FROM staff").n) await seedDemo(d1, { now: clock(), pinFp: async (sid, pin) => G.ctx.v2PinFp_(sid, pin) });
  const env = { DB: d1, PK_TICKET_KEY: G.ctx.v2Key_("ticket"), PK_SYNC_KEY: G.ctx.v2Key_("sync"), PK_GAS_URL: "http://dev.local/__gas" };
  const gasFetch = async url => { clock(); const u = new URL(url); return new Response(JSON.stringify(G.call(u.searchParams.get("action"), Object.fromEntries(u.searchParams))), { headers: { "content-type": "application/json" } }); };
  const app = createApp({ registry: buildRegistry(), now: clock, fetch: gasFetch });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      if (url.pathname === "/__gas") {   // เว็บแอป GAS จำลอง (ตรวจ PIN → ตั๋ว)
        clock();
        const out = G.call(url.searchParams.get("action"), Object.fromEntries(url.searchParams), req.method === "POST" ? body.toString("utf8") : undefined);
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out)); return;
      }
      if (url.pathname.startsWith("/api/")) {
        const r = await app.handle(new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body }), env, url.pathname.slice(5));
        res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
      }
      if (url.pathname === "/config.js") {
        res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" });
        res.end('window.PK_CONFIG = { apiBase: "api", gasUrl: "/__gas", dev: true };'); return;
      }
      let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
      if (!p || p.endsWith("/")) p += "index.html";
      const f = path.join(WEB, p);
      if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("ไม่พบ " + p); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(f).pipe(res);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }); res.end("dev server: " + (e.stack || e));
    }
  });
  await new Promise(r => server.listen(o.port || 0, "127.0.0.1", r));
  const port = server.address().port;
  return { port, url: "http://127.0.0.1:" + port + "/", close: () => new Promise(r => server.close(r)), d1, G, env, gasFetch, clock };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startDev({ port: Number(arg("--port", 8787)), mem: process.argv.includes("--mem"), fresh: process.argv.includes("--fresh") }).then(s => {
    console.log("โรงขวด P&K v2 (เครื่องนักพัฒนา) → " + s.url);
    console.log("  เปิดแต่ละแอป: " + ["office", "prod", "screen", "deliver", "account", "exec"].map(r => s.url + "?app=" + r).join("  "));
    console.log("  เข้าระบบ: แตะชื่อไหนก็ได้ PIN " + DEMO_PIN + " (ข้อมูลสมมติ)");
  });
}
