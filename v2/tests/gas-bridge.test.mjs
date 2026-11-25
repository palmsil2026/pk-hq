// เทสต์สะพาน GAS (gas/Code.gs ตัวจริง รันใน Node) — ออกตั๋ว · ต่ออายุ · ส่งออกอ่านอย่างเดียว + เทียบ action เดิมกับรุ่นใน main
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadGas } from "./gas/harness.mjs";
import { seedGas, IDS } from "./fixtures/sheets.mjs";
import { readTicket, hmacB64u } from "../server/ticket.mjs";
import { world } from "./helpers/world.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const SRC = fs.readFileSync(path.join(ROOT, "gas", "Code.gs"), "utf8");
const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);

function fresh() { const G = loadGas(SRC, { now: T0 }); seedGas(G); return G; }
const keyOf = (G, name) => G.ctx.v2Key_(name);
async function signedExport(G, source, cursor, limit, ts, keyOverride) {
  const t = String(ts || T0), c = String(cursor || "0"), l = String(limit || "300");
  const sig = await hmacB64u(keyOverride || keyOf(G, "sync"), ["pkV2Export", source, c, l, t].join("|"));
  return G.call("pkV2Export", { source, cursor: c, limit: l, ts: t, sig });
}

test("ออกตั๋ว: PIN ถูก → ตั๋วที่ Cloudflare ตรวจผ่าน (รูปแบบตรงกันสองฝั่ง) · ไม่มี PIN ในตั๋ว", async () => {
  const G = fresh();
  const r = G.call("pkV2Ticket", {}, { sid: "S001", pin: "1111" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.staff, { id: "S001", nick: "เอ", roles: ["office"] });
  const t = await readTicket(keyOf(G, "ticket"), r.ticket, T0 + 1000);
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(t.p.sid, "S001"); assert.equal(t.p.k, "s"); assert.deepEqual(t.p.r, ["office"]); assert.equal(t.p.pf.length, 22);
  assert.equal(t.p.exp - t.p.iat, 30 * 864e5);
  assert.ok(!r.ticket.includes("1111") && !Buffer.from(r.ticket.split(".")[1], "base64url").toString().includes("1111"));
  const g = G.call("pkV2Ticket", {}, { nick: "บี", pin: "2222", kind: "g" });
  const tg = await readTicket(keyOf(G, "ticket"), g.ticket, T0);
  assert.equal(tg.p.k, "g"); assert.equal(tg.p.exp - tg.p.iat, 5 * 60000); assert.deepEqual(tg.p.r, ["prod"]);
  // ตั๋วจาก GAS ใช้กับหลังบ้าน v2 ได้จริง (คนยังไม่อยู่ในฐาน = ลงทะเบียนจากตั๋ว)
  const W = world({ env: { PK_TICKET_KEY: keyOf(G, "ticket") }, now: T0 + 2000 });
  const me = await W.call(r.ticket, "system.me");
  assert.equal(me.status, 200, JSON.stringify(me)); assert.equal(me.data.staff.nick, "เอ");
});

test("ออกตั๋ว: PIN ผิด · พักงาน · แถวพิมพ์มือไม่มี ID · GET ไม่รับ · ผิด 5 ครั้งล็อก", () => {
  const G = fresh();
  assert.match(G.call("pkV2Ticket", { sid: "S001", pin: "1111" }).error, /POST/);
  const w = G.call("pkV2Ticket", {}, { sid: "S001", pin: "0000" });
  assert.equal(w.ok, false); assert.equal(w.pinWrong, true);
  assert.match(G.call("pkV2Ticket", {}, { sid: "S003", pin: "3333" }).error, /พัก/);
  assert.equal(G.call("pkV2Ticket", {}, { nick: "อี", pin: "" }).ok, false);
  for (let i = 0; i < 4; i++) G.call("pkV2Ticket", {}, { sid: "S002", pin: "9999" });
  const locked = G.call("pkV2Ticket", {}, { sid: "S002", pin: "9999" });
  assert.equal(locked.ok, false);
  const after = G.call("pkV2Ticket", {}, { sid: "S002", pin: "2222" });
  assert.equal(after.locked, true, "ล็อกแล้วแม้ PIN ถูกก็ยังเข้าไม่ได้ 10 นาที");
});

test("ต่ออายุตั๋ว: ได้เมื่อ PIN เดิม · เปลี่ยน PIN ในชีตแล้วต่อไม่ได้ · ตั๋ว g ต่อไม่ได้", () => {
  const G = fresh();
  const r = G.call("pkV2Ticket", {}, { sid: "S001", pin: "1111" });
  G.tick(864e5);
  const n = G.call("pkV2Renew", {}, { ticket: r.ticket });
  assert.equal(n.ok, true); assert.notEqual(n.ticket, r.ticket);
  const g = G.call("pkV2Ticket", {}, { sid: "S001", pin: "1111", kind: "g" });
  assert.equal(G.call("pkV2Renew", {}, { ticket: g.ticket }).ok, false);
  const staff = G.books.get(G.props.PK_SHEET_ID).getSheetByName("Staff");
  staff.data.find(x => x[0] === "S001")[4] = "5555";
  G.ctx.dirty_();
  const bad = G.call("pkV2Renew", {}, { ticket: n.ticket });
  assert.equal(bad.ok, false); assert.equal(bad.needLogin, true);
});

test("ส่งออก: ต้องลงชื่อ · หมดอายุ 5 นาที · คำตอบลงชื่อกลับ · พนักงานไม่มี PIN/Token", async () => {
  const G = fresh();
  assert.match((await signedExport(G, "staff", 0, 300, T0, "กุญแจผิด")).error, /ลายเซ็น/);
  assert.match((await signedExport(G, "staff", 0, 300, T0 - 6 * 60000)).error, /หมดอายุ/);
  assert.match((await signedExport(G, "pk:Staff")).error, /ส่งออกไม่ได้/);
  const r = await signedExport(G, "staff");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sig, await hmacB64u(keyOf(G, "sync"), r.data), "คำตอบต้องลงชื่อด้วยกุญแจ sync");
  const d = JSON.parse(r.data);
  assert.deepEqual(d.head, ["Staff_ID", "ชื่อ", "ชื่อเล่น", "แผนก", "สถานะ", "เริ่มงาน", "pf"]);
  assert.equal(d.rows.length, 4, "แถวพิมพ์มือที่ไม่มี Staff_ID ไม่ถูกส่ง");
  for (const pin of ["1111", "2222", "3333", "4444"]) assert.ok(!r.data.includes(pin), "PIN หลุดในข้อมูลส่งออก");
  // ลายนิ้วมือในข้อมูลส่งออก = ลายนิ้วมือในตั๋ว (นำเข้าแล้วตั๋วที่ออกก่อนหน้ายังใช้ได้)
  const tk = G.call("pkV2Ticket", {}, { sid: "S002", pin: "2222" });
  const t = await readTicket(keyOf(G, "ticket"), tk.ticket, T0);
  assert.equal(d.rows.find(x => x[0] === "S002")[6], t.p.pf);
});

test("ส่งออกแบ่งหน้า + ชีทบัญชี/AppSheet อ่านอย่างเดียว (เขียนเมื่อไหร่ harness throw)", async () => {
  const G = fresh();
  const p1 = JSON.parse((await signedExport(G, "legacy:order", 0, 3)).data);
  assert.equal(p1.rows.length, 3); assert.equal(p1.next, 3); assert.equal(p1.total, 4); assert.equal(p1.head[0], "ID");
  const p2 = JSON.parse((await signedExport(G, "legacy:order", 3, 3)).data);
  assert.equal(p2.rows.length, 1); assert.equal(p2.next, null);
  // ชีทบัญชี: ไล่ทีละแท็บที่มีหัว เลขที่บิล/รายชื่อลูกค้า (หัวไม่อยู่แถวแรกก็หาเจอ)
  const pages = [];
  let cur = "0:0";
  while (cur !== null && pages.length < 20) { const d = JSON.parse((await signedExport(G, "acct", cur, 2)).data); pages.push(d); cur = d.next; }
  assert.deepEqual([...new Set(pages.map(p => p.tab))], ["บิลรายวัน 2025", "ลูกหนี้", "รายชื่อ"]);
  assert.equal(pages[0].head[1], "เลขที่บิล");
  const cus = JSON.parse((await signedExport(G, "legacy:customer")).data);
  assert.equal(cus.rows.length, 3); assert.equal(cus.head[1], "เส้นทาง-2");
  const runs = JSON.parse((await signedExport(G, "legacy:stock:ProductionLog")).data);
  assert.equal(runs.rows.length, 3);
  for (const id of [IDS.acct, IDS.order, IDS.customer, IDS.stock]) assert.equal(G.books.get(id).writes, 0, id + " ถูกเขียน!");
  const G2 = loadGas(SRC, { now: T0 }); seedGas(G2, { stockProp: false });
  assert.match((await signedExport(G2, "legacy:stock:ProductionLog")).error, /LEGACY_STOCK_SHEET_ID/);
});

test("หมวดสะพาน v2 ในโค้ดไม่มีคำสั่งเขียนชีตเลย (ตรวจข้อความโค้ด)", () => {
  const sec = SRC.slice(SRC.indexOf("สะพานแอป v2 (Cloudflare Pages + D1"));
  const body = sec.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  for (const w of ["setValue", "setValues", "appendRow", "appendObj", "insertSheet", "deleteRow", "clear(", "updateWhere", "deleteSheet"]) {
    assert.ok(!body.includes(w), "หมวดสะพาน v2 มี " + w);
  }
});

// ---- action เดิมทุกตัวต้องทำงานเหมือนรุ่นใน main (ของที่ขึ้นจริงตอนนี้) ----
function baseline() {
  for (const ref of ["origin/main", "main"]) {
    try { return execFileSync("git", ["show", ref + ":gas/Code.gs"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { /* ลองตัวถัดไป */ }
  }
  return null;
}
function scenario(G) {
  const out = [];
  const c = (a, p, b) => { const r = G.call(a, p, b); out.push([a, r]); G.tick(60000); return r; };
  c("pkHealth");
  c("pkStaffCards");
  c("pkNope");
  c("pkTeamData", { token: "ไม่มี" });
  const login = c("pkLogin", { payload: JSON.stringify({ nick: "เอ", pin: "1111" }) });
  const tok = login.token;
  c("pkLogin", { payload: JSON.stringify({ nick: "เอ", pin: "0000" }) });
  const T = (a, pay) => c(a, { token: tok, payload: JSON.stringify(pay || {}) });
  T("pkCustSave", { name: "ร้านทดสอบ หนึ่ง", tel: "080", credit: 30 });
  const o = T("pkOrderSave", { customer: "ร้านทดสอบ หนึ่ง", due: "2026-11-20", items: [{ type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส", bags: 10, screen: true, price: 2 }], payStatus: "รอโอนเงิน", urgent: true, _rid: "r1" });
  T("pkOrderSave", { customer: "ร้านทดสอบ หนึ่ง", items: [{ type: "ขวด", size: "600 ml", bags: 10 }], _rid: "r1" });
  T("pkOrderDetail", { id: o.id });
  T("pkOrderEdit", { id: o.id, customer: "ร้านทดสอบ หนึ่ง", due: "2026-11-22", items: [{ type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส", bags: 12 }] });
  const o2 = T("pkOrderSave", { customer: "ร้านทดสอบ สอง", items: [{ type: "ถัง", size: "18.9 ลิตร", color: "ใส", bags: 6 }] });
  T("pkOrderFlags", { id: o2.id, "สถานะเงิน": "โอนแล้ว", "สถานะแบบ": "รอแบบ", "ด่วน": true, "ค่าบล็อก": 500 });
  T("pkTeamData");
  const pk = G.books.get(G.props.PK_SHEET_ID);
  const firstOf = (tab, orderId) => { const d = pk.getSheetByName(tab).data; const h = d[0]; const r = d.slice(1).find(x => x[h.indexOf("Order_ID")] === orderId); return r ? r[h.indexOf("Job_ID")] : ""; };
  const o3 = T("pkOrderSave", { customer: "ร้านทดสอบ สาม", items: [{ type: "ขวด", size: "250 ml", color: "น้ำเงิน", bags: 4, screen: true }] });
  const jid = firstOf("Production", o2.id), sid = firstOf("ScreenJobs", o3.id);
  T("pkJobStart", { type: "prod", id: jid });
  T("pkProdLog", { type: "prod", id: jid, good: 30, waste: 2, gradeB: 1, reason: "ก้นบาง", machine: "PET 9" });
  T("pkJobClose", { type: "prod", id: jid });
  T("pkScreenAssign", { id: sid, team: "ทีม 2" });
  T("pkScreenAssign", { id: sid, done: true });
  T("pkDeliver", { orderId: o2.id, items: [{ name: "ถัง 18.9 ลิตร ใส", qty: 10 }], truck: "05" });
  T("pkBillCreate", { orderId: o2.id, type: "เครดิต" });
  T("pkBills");
  T("pkStockIn", { kind: "วัตถุดิบ", name: "พรีฟอร์ม 9 กรัม", qty: 1000 });
  T("pkOrders", {});
  T("pkCustomerHistory", { customer: "ร้านทดสอบ หนึ่ง" });
  T("pkScreenHistory", {});
  T("pkOrderCancel", { id: o.id, note: "ทดสอบ" });
  c("pkExec", { key: "exec-test-key" });
  c("pkPriceSet", { key: "exec-test-key", payload: JSON.stringify({ name: "ขวด PET 600ml MK ใส", price: 2.1, unit: "ใบ", note: "ทดสอบ" }) });
  c("pkStaffSave", { key: "exec-test-key", payload: JSON.stringify({ name: "คนใหม่", nick: "เอฟ", dept: "บัญชี", pin: "6666" }) });
  const acc = c("pkLogin", { payload: JSON.stringify({ nick: "เอฟ", pin: "6666" }) });
  c("pkAcctData", { token: acc.token, payload: "{}" });
  c("pkAcctBill", { token: acc.token, payload: JSON.stringify({ customer: "ร้านทดสอบ หนึ่ง", amount: 500, type: "เงินสด", channel: "เงินสด", date: "2026-11-16" }) });
  c("pkStaffCards");
  return out;
}
// เลขรุ่น (CODE_VERSION) ของสองฝั่งต่างกันเสมอ — แทนด้วยป้ายเดียวกันก่อนเทียบ (อ่านจากโค้ดจริง ไม่ต้องแก้เทสต์ทุกครั้งที่ขยับรุ่น)
const verOf = src => (/const CODE_VERSION = '([^']+)'/.exec(src || "") || [])[1] || "<none>";
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let VER_RE = /2026-09-13a/g;
const norm = s => JSON.parse(JSON.stringify(s).replace(VER_RE, "<VER>"));

test("action เดิมทุกตัวได้ผลเหมือนรุ่นใน main (คำตอบ + ชีตหลังจบ ตรงกันทุกช่อง)", t => {
  const base = baseline();
  if (!base) { t.skip("ไม่มี origin/main ในเครื่อง (git fetch --depth=1 origin main)"); return; }
  VER_RE = new RegExp([verOf(base), verOf(SRC)].map(esc).join("|"), "g");
  const A = loadGas(base, { now: T0 }), B = loadGas(SRC, { now: T0 });
  seedGas(A); seedGas(B);
  const ra = scenario(A), rb = scenario(B);
  assert.equal(ra.length, rb.length);
  let okCount = 0;
  for (let i = 0; i < ra.length; i++) {
    assert.deepEqual(norm(rb[i][1]), norm(ra[i][1]), "คำตอบของ " + ra[i][0] + " (ขั้นที่ " + (i + 1) + ") ไม่เหมือนรุ่นใน main");
    if (ra[i][1] && ra[i][1].ok) okCount++;
  }
  assert.ok(okCount >= 20, "สถานการณ์ต้องผ่านงานจริงหลายตัว (ได้ ok " + okCount + " ขั้น)");
  const da = A.books.get(A.props.PK_SHEET_ID).dump(), db = B.books.get(B.props.PK_SHEET_ID).dump();
  assert.deepEqual(norm(db), norm(da), "ข้อมูลในชีต PKSystem หลังจบไม่เหมือนกัน");
  for (const id of [IDS.acct, IDS.order, IDS.customer, IDS.stock]) assert.equal(B.books.get(id).writes, 0);
});
