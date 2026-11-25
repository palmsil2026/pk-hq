// เทสต์สะพานทะเบียนพนักงาน: gas/Code.gs ตัวจริง (pkV2Staff) → ใบรับลงชื่อ → exec.staff_apply → D1
//   PIN ไปที่ Google เท่านั้น · ตั๋วประธานตรวจที่ GAS เอง + แผนกในชีตตอนนี้ต้องเป็น "บริหาร" · ประวัติใน ActivityLog (ไม่มี PIN)
//   · กันแอบเพิ่มคนผ่านชีต (ไม่เติมสถานะ/PIN ให้เอง) · กันล็อกตัวเอง · ใบรับปลอม/ของคนอื่น/เก่า/ซ้ำ · พักงาน = ตั๋วตายทันที
//   · เขียนเฉพาะแท็บ Staff/ActivityLog/Settings(ตัวนับ) ของ PKSystem — ชีทบัญชี/AppSheet ไม่ถูกแตะ
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGas } from "./gas/harness.mjs";
import { seedGas, IDS } from "./fixtures/sheets.mjs";
import { world } from "./helpers/world.mjs";
import { hmacB64u } from "../server/ticket.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "gas", "Code.gs"), "utf8");
const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);
let ridSeq = 0;
const rid = () => "rid-test-" + String(++ridSeq).padStart(6, "0");

async function setup() {
  const G = loadGas(SRC, { now: T0 });
  seedGas(G);
  const gasFetch = async url => { const u = new URL(url); G.setNow(W.clock.now); return new Response(JSON.stringify(G.call(u.searchParams.get("action"), Object.fromEntries(u.searchParams))), { headers: { "content-type": "application/json" } }); };
  const W = world({ now: T0, fetch: gasFetch, env: { PK_TICKET_KEY: G.ctx.v2Key_("ticket"), PK_SYNC_KEY: G.ctx.v2Key_("sync"), PK_GAS_URL: "https://gas.test/exec" } });
  const tk = (sid, pin) => { G.setNow(W.clock.now); const r = G.call("pkV2Ticket", {}, { sid, pin }); assert.equal(r.ok, true, JSON.stringify(r)); return r.ticket; };
  const boss = tk("S004", "4444");
  // นำเข้าพนักงานจากชีตก่อน (แบบใช้งานจริง)
  let cursor = "0", run = "", last;
  do { last = await W.call(boss, "import.run", { source: "staff", cursor, run }); assert.equal(last.status, 200, JSON.stringify(last.error)); run = last.data.run; cursor = last.data.next; } while (cursor !== null);
  const pk = () => G.books.get(G.props.PK_SHEET_ID);
  const row = sid => { const d = pk().getSheetByName("Staff").data; const h = d[0]; const r = d.find(x => x[0] === sid); return r ? Object.fromEntries(h.map((k, i) => [k, r[i]])) : null; };
  const gas = (ticket, body) => { G.setNow(W.clock.now); return G.call("pkV2Staff", {}, Object.assign({ ticket, rid: rid() }, body)); };
  return { G, W, boss, tk, gas, row, pk };
}

test("ตั้ง PIN ใหม่: ชีตเปลี่ยน + ประวัติ (ไม่มี PIN) · ใบรับ → D1 ทันที · ตั๋วเก่าตาย ตั๋วจาก PIN ใหม่ใช้ได้ · ใบรับไม่มี PIN", async () => {
  const { G, W, boss, tk, gas, row, pk } = await setup();
  const old = tk("S002", "2222");
  assert.equal((await W.call(old, "system.me")).status, 200);
  const r = gas(boss, { op: "pin", sid: "S002", pin: "8642" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(row("S002")["PIN"], "8642");
  assert.ok(!r.receipt.data.includes("8642") && !JSON.stringify(r).includes("8642"), "PIN หลุดในใบรับ");
  const log = pk().getSheetByName("ActivityLog").data.slice(-1)[0];
  assert.match(log.join("|"), /ตั้ง PIN ใหม่/); assert.ok(!log.join("|").includes("8642"));
  assert.equal(r.receipt.sig, await hmacB64u(G.ctx.v2Key_("sync"), "staff|" + r.receipt.data));
  const a = await W.call(boss, "exec.staff_apply", { receipt: r.receipt });
  assert.equal(a.status, 200, JSON.stringify(a.error)); assert.equal(a.data.changed, true);
  const o = await W.call(old, "system.me");
  assert.equal(o.status, 401, "ตั๋วจาก PIN เก่าต้องตายทันที"); assert.match(o.error.message, /PIN/);
  W.tick(1000);
  assert.equal((await W.call(tk("S002", "8642"), "system.me")).status, 200);
  assert.equal(W.q("SELECT * FROM audit_log WHERE action='exec.staff_apply'").length >= 2, true);
  for (const id of [IDS.acct, IDS.order, IDS.customer, IDS.stock]) assert.equal(G.books.get(id).writes, 0, id + " ถูกเขียน!");
});

test("พักงาน/เปิดงาน: พัก = ตั๋วตายทันที (แอปเดิมหลุดด้วย) · เปิดงานคนที่ไม่มี PIN ไม่ได้ (กันแอบเพิ่มคนผ่านชีต) · พักตัวเองไม่ได้", async () => {
  const { G, W, boss, tk, gas, row, pk } = await setup();
  const b = tk("S002", "2222");
  const r = gas(boss, { op: "status", sid: "S002", status: "พัก" });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(row("S002")["สถานะ"], "พัก"); assert.equal(row("S002")["Token"], "");
  assert.equal((await W.call(boss, "exec.staff_apply", { receipt: r.receipt })).status, 200);
  assert.equal(W.one("SELECT status FROM staff WHERE id='S002'").status, "พัก");
  const x = await W.call(b, "system.me");
  assert.equal(x.status, 401); assert.match(x.error.message, /พัก/);
  const me = gas(boss, { op: "status", sid: "S004", status: "พัก" });
  assert.equal(me.ok, false); assert.match(me.error, /ตัวเอง/);
  // แถวที่พิมพ์ลงชีตเอง (มี Staff_ID แต่ไม่มี PIN) → เปิดงานไม่ได้จนกว่าประธานตั้ง PIN
  pk().getSheetByName("Staff").data.push(["S077", "แอบเพิ่ม", "แอบ", "บัญชี", "", "", "", "", "", ""]);
  G.ctx.dirty_();   // คำขอใหม่ของ GAS จริงอ่านชีตใหม่เสมอ
  const sneak = gas(boss, { op: "status", sid: "S077", status: "ทำงาน" });
  assert.equal(sneak.ok, false); assert.equal(sneak.needPin, true);
  assert.equal(row("S077")["สถานะ"], "", "ระบบไม่เติมสถานะให้เอง");
  const p = gas(boss, { op: "pin", sid: "S077", pin: "1357" });
  assert.equal(p.ok, true);
  const ap = await W.call(boss, "exec.staff_apply", { receipt: p.receipt });
  assert.equal(ap.status, 200); assert.equal(W.one("SELECT status FROM staff WHERE id='S077'").status, "พัก", "ตั้ง PIN อย่างเดียว ยังเข้าไม่ได้");
  const on = gas(boss, { op: "status", sid: "S077", status: "ทำงาน" });
  assert.equal(on.ok, true);
  assert.equal((await W.call(boss, "exec.staff_apply", { receipt: on.receipt })).status, 200);
  assert.equal(W.one("SELECT status, exec_ok_at <> '' AS ok FROM staff WHERE id='S077'").status, "ทำงาน");
});

test("สิทธิ์ที่ GAS: ตั๋วคนที่ไม่ใช่บริหาร = ไม่ได้ · ถูกย้ายแผนกในชีตแล้ว ตั๋วเดิมใช้ไม่ได้ทันที · ตั๋วผิด/ไม่มี = ไม่ได้ · ต้องส่งแบบ POST", async () => {
  const { G, W, boss, tk, gas, pk } = await setup();
  const office = tk("S001", "1111");
  const r = gas(office, { op: "pin", sid: "S002", pin: "1111" });
  assert.equal(r.ok, false); assert.equal(r.forbidden, true);
  assert.equal(gas("pk1.ปลอม", { op: "pin", sid: "S002", pin: "1111" }).needLogin, true);
  assert.match(G.call("pkV2Staff", { op: "pin" }).error, /POST/);
  pk().getSheetByName("Staff").data.find(x => x[0] === "S004")[3] = "ออฟฟิศ";
  G.ctx.dirty_();
  const demoted = gas(boss, { op: "pin", sid: "S002", pin: "1111" });
  assert.equal(demoted.ok, false); assert.match(demoted.error, /บริหาร/);
  assert.equal((await W.call(office, "exec.staff_apply", { receipt: { data: "{}", sig: "x".repeat(43) } })).status, 403, "ฝั่ง v2 ก็เฉพาะประธาน");
});

test("เพิ่มพนักงาน + เปลี่ยนแผนก: รหัสจากตัวนับเดิม · ชื่อเล่นซ้ำไม่ได้ · บทบาทตามแผนก · ย้ายตัวเองออกจากบริหารไม่ได้", async () => {
  const { W, boss, tk, gas, row } = await setup();
  assert.match(gas(boss, { op: "create", name: "ทดลอง ใหม่", nick: "เอ", dept: "บัญชี", pin: "2468" }).error, /มีแล้ว/);
  assert.match(gas(boss, { op: "create", name: "ทดลอง ใหม่", nick: "ใหม่", dept: "คลังลับ", pin: "2468" }).error, /แผนก/);
  assert.match(gas(boss, { op: "create", name: "ทดลอง ใหม่", nick: "ใหม่", dept: "บัญชี", pin: "12" }).error, /4 หลัก/);
  const c = gas(boss, { op: "create", name: "ทดลอง ใหม่", nick: "ใหม่", dept: "บัญชี", pin: "2468" });
  assert.equal(c.ok, true, JSON.stringify(c)); assert.equal(c.sid, "S005");
  assert.equal(row("S005")["สถานะ"], "ทำงาน");
  const a = await W.call(boss, "exec.staff_apply", { receipt: c.receipt });
  assert.equal(a.status, 200); assert.deepEqual(a.data.roles, ["account"]);
  const s = W.one("SELECT * FROM staff WHERE id='S005'");
  assert.equal(s.nick, "ใหม่"); assert.equal(s.pin_fp.length, 22); assert.ok(s.exec_ok_at, "คนที่ประธานเพิ่มเอง = ยืนยันแล้ว");
  W.tick(1000);
  assert.equal((await W.call(tk("S005", "2468"), "home.account")).status, 200);
  const d = gas(boss, { op: "dept", sid: "S005", dept: "ส่งของ" });
  assert.equal(d.ok, true);
  await W.call(boss, "exec.staff_apply", { receipt: d.receipt });
  assert.deepEqual(W.q("SELECT role FROM staff_roles WHERE staff_id='S005' AND active=1").map(r => r.role), ["deliver"]);
  assert.equal((await W.call(tk("S005", "2468"), "home.account")).status, 403, "ย้ายแผนกแล้วสิทธิ์เงินหายทันที");
  assert.match(gas(boss, { op: "dept", sid: "S004", dept: "ออฟฟิศ" }).error, /ตัวเอง/);
});

test("ใบรับ: ปลอม/ถูกแก้ = ไม่บันทึก · ของประธานคนอื่น = ไม่ได้ · เก่าเกิน 15 นาที = ไม่ใช้ · ส่งซ้ำ = ไม่เปลี่ยนอะไร · GAS ส่งซ้ำ rid เดิม = ไม่เขียนซ้ำ", async () => {
  const { G, W, boss, gas, pk } = await setup();
  const r = gas(boss, { op: "status", sid: "S001", status: "พัก" });
  const forged = { data: r.receipt.data.replace("พัก", "ทำงาน").replace('"S001"', '"S002"'), sig: r.receipt.sig };
  const f = await W.call(boss, "exec.staff_apply", { receipt: forged });
  assert.equal(f.status, 400); assert.match(f.error.message, /ลายเซ็น/);
  pk().getSheetByName("Staff").data.push(["S010", "ประธาน สอง", "ปอ", "บริหาร", "9090", "ทำงาน", "", "", "", ""]);
  G.ctx.dirty_();
  G.setNow(W.clock.now);
  const boss2 = G.call("pkV2Ticket", {}, { sid: "S010", pin: "9090" }).ticket;
  assert.equal((await W.call(boss2, "exec.staff_apply", { receipt: r.receipt })).status, 403, "ใบรับของคนอื่น");
  const ok1 = await W.call(boss, "exec.staff_apply", { receipt: r.receipt });
  assert.equal(ok1.status, 200); assert.equal(ok1.data.changed, true);
  const again = await W.call(boss, "exec.staff_apply", { receipt: r.receipt });
  assert.equal(again.status, 200); assert.equal(again.data.changed, false, "ส่งใบรับเดิมซ้ำ = ไม่เปลี่ยนอะไร");
  const late = gas(boss, { op: "status", sid: "S001", status: "ทำงาน" });
  W.tick(16 * 60000);
  const bossNew = (G.setNow(W.clock.now), G.call("pkV2Ticket", {}, { sid: "S004", pin: "4444" }).ticket);
  assert.equal((await W.call(bossNew, "exec.staff_apply", { receipt: late.receipt })).status, 410);
  // GAS: rid เดิม (เน็ตหลุดแล้วส่งซ้ำ) = ผลเดิม ไม่เขียน ActivityLog ซ้ำ
  const n0 = pk().getSheetByName("ActivityLog").data.length;
  G.setNow(W.clock.now);
  const once = G.call("pkV2Staff", {}, { ticket: bossNew, rid: "rid-fixed-000001", op: "status", sid: "S001", status: "พัก" });
  const twice = G.call("pkV2Staff", {}, { ticket: bossNew, rid: "rid-fixed-000001", op: "status", sid: "S001", status: "พัก" });
  assert.deepEqual(twice, once);
  assert.equal(pk().getSheetByName("ActivityLog").data.length, n0 + 1);
});

test("GAS เขียนเฉพาะแท็บ Staff · ActivityLog · Settings (ตัวนับ) — แท็บอื่นของ PKSystem ไม่ถูกแตะ", async () => {
  const { G, boss, gas, pk } = await setup();
  const before = pk().dump();
  gas(boss, { op: "create", name: "ทดลอง สอง", nick: "สอง", dept: "ผลิต", pin: "1212" });
  gas(boss, { op: "pin", sid: "S001", pin: "3434" });
  gas(boss, { op: "status", sid: "S002", status: "ลาออก" });
  const after = pk().dump();
  const changed = Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort();
  assert.deepEqual(changed, ["ActivityLog", "Settings", "Staff"]);
  for (const id of [IDS.acct, IDS.order, IDS.customer, IDS.stock]) assert.equal(G.books.get(id).writes, 0);
});
