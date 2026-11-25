// ตรวจเร็วก่อน commit/ใน CI: ไวยากรณ์ทุกไฟล์ · ไม่มี DELETE · ไม่มีอีโมจิในหน้าจอ · ไฟล์ที่สร้างอัตโนมัติตรงต้นทาง · ไม่มีความลับในโค้ด
//   node v2/tools/check.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.join(HERE, "..");
const ROOT = path.join(V2, "..");
let bad = 0;
const fail = m => { console.error("✗ " + m); bad++; };
const walk = (d, re, out = []) => { if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === "node_modules" || e.name.startsWith(".")) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, re, out); else if (re.test(e.name)) out.push(p); } return out; };
const code = l => l.replace(/^\s*(\/\/|\*|\/\*).*$/, "");

// ① ไวยากรณ์
const files = [...walk(path.join(V2, "server"), /\.m?js$/), ...walk(path.join(V2, "functions"), /\.js$/), ...walk(path.join(V2, "tools"), /\.m?js$/), ...walk(path.join(V2, "tests"), /\.m?js$/), ...walk(path.join(V2, "web"), /\.js$/)];
for (const f of files) { try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { fail("ไวยากรณ์ผิด " + path.relative(ROOT, f) + "\n" + String(e.stderr || e).slice(0, 400)); } }
const tmp = path.join(os.tmpdir(), "pk-code-gs.cjs");
fs.copyFileSync(path.join(ROOT, "gas", "Code.gs"), tmp);
try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); } catch (e) { fail("gas/Code.gs ไวยากรณ์ผิด"); }

// ② ไม่มี DELETE ในหลังบ้าน/migration (ย้อน = พลิกสถานะ)
for (const f of [...walk(path.join(V2, "server"), /\.m?js$/), ...walk(path.join(V2, "functions"), /\.js$/), ...walk(path.join(V2, "db", "migrations"), /\.sql$/)]) {
  fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => { const c = f.endsWith(".sql") ? l.replace(/--.*$/, "") : code(l); if (/\bDELETE\s+FROM\b/i.test(c)) fail("มี DELETE: " + path.relative(ROOT, f) + ":" + (i + 1)); });
}
// ②b หลังบ้านต้องรันบน Cloudflare Workers ได้ — ห้าม import โมดูลของ Node ใน server/ functions/
for (const f of [...walk(path.join(V2, "server"), /\.m?js$/), ...walk(path.join(V2, "functions"), /\.js$/)]) {
  if (/from\s+["']node:|require\(/.test(fs.readFileSync(f, "utf8"))) fail("หลังบ้านใช้โมดูล Node (รันบน Workers ไม่ได้): " + path.relative(ROOT, f));
}
// ③ หน้าจอไม่มีอีโมจิ (ไอคอน SVG ชุดเดียว) — ตรวจเฉพาะบรรทัดโค้ด ไม่นับคอมเมนต์
for (const f of walk(path.join(V2, "web"), /\.(js|html)$/)) {
  fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]/u.test(code(l))) fail("มีอีโมจิในหน้าจอ: " + path.relative(ROOT, f) + ":" + (i + 1)); });
}
// ④ ความลับห้ามอยู่ในโค้ด (กุญแจยาว ๆ ที่ตั้งค่าตรง ๆ)
for (const f of [...files, ...walk(path.join(V2, "web"), /\.(html|json)$/)]) {
  const s = fs.readFileSync(f, "utf8");
  if (/(PK_TICKET_KEY|PK_SYNC_KEY|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["'][A-Za-z0-9_-]{24,}["']/.test(s)) fail("มีค่าลับในโค้ด: " + path.relative(ROOT, f));
}
// ⑤ ไฟล์ที่สร้างอัตโนมัติต้องตรงต้นทาง
for (const [cmd, args] of [["python3", [path.join(V2, "design", "gen_tokens.py"), "--check"]], [process.execPath, [path.join(V2, "tools", "gen-reference-sql.mjs"), "--check"]], [process.execPath, [path.join(V2, "tools", "gen-reference-data.mjs"), "--check"]]]) {
  try { execFileSync(cmd, args, { stdio: "pipe" }); } catch (e) { fail(String(e.stdout || "") + String(e.stderr || "") || args[0]); }
}
// ⑥ เวอร์ชันหน้าเว็บตรงกัน (app.js ↔ version.json)
const wv = /WEB_VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(V2, "web", "assets", "app.js"), "utf8"));
const vj = JSON.parse(fs.readFileSync(path.join(V2, "web", "version.json"), "utf8")).web;
if (!wv || wv[1] !== vj) fail("WEB_VERSION ใน app.js (" + (wv && wv[1]) + ") ไม่ตรงกับ version.json (" + vj + ")");
if (bad) { console.error("\n❌ ไม่ผ่าน " + bad + " ข้อ"); process.exit(1); }
console.log("✅ ตรวจผ่าน: ไวยากรณ์ " + (files.length + 1) + " ไฟล์ · ไม่มี DELETE · ไม่มีอีโมจิ · ไม่มีความลับ · ไฟล์สร้างอัตโนมัติตรงต้นทาง · เวอร์ชันตรงกัน");
