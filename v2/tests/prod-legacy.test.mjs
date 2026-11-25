// เทสต์นำเข้ารอบผลิตเก่า (หัวคอลัมน์จริงของแท็บ ProductionLog · ข้อมูลสมมติรูปแบบเดียวกัน) ครบสาย: gas/Code.gs จริง → ส่งออกลงชื่อ → D1
//   วันที่ พ.ศ. d/m/yyyy · เวลา h:mm:ss · คนคั่น " , " · ไม่ระบุเครื่อง · ข้ามเที่ยงคืน vs พิมพ์ผิด · รันซ้ำเป็นรอบ ๆ (ซิงก์ทางเดียว) · ไม่ทับที่แก้ใน v2
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGas } from "./gas/harness.mjs";
import { seedGas, IDS } from "./fixtures/sheets.mjs";
import { world } from "./helpers/world.mjs";
import { legacyTimes, parseClock, parseNet } from "../server/actions/prodLegacy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "gas", "Code.gs"), "utf8");
const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);   // 16 พ.ย. 2569 09:00 ไทย
const HEAD = ["ID", "วันที่", "เวลาเริ่มเครื่อง", "สถานะ", "เวลาเปลี่ยนสี/ปิดเครื่อง", "ผู้ปฏิบัติงาน", "เครื่อง", "ประเภทสินค้า", "ขนาด", "คอขวด", "สี", "รูปทรง",
  "ผลิตได้ (ใบ)", "เกรด B (ใบ)", "ของเสีย (ใบ)", "หมายเหตุ", "เวลาทำงานสุทธิ", "สินค้า", "ขนาด (Ref)", "SessionID"];
const ROWS = () => [
  ["a01", "10/11/2569", "8:15:00", "ปิดงาน", "16:53:00", "เอ , บี", "PET 4", "ขวด", "250 ml", "คอสั้น", "น้ำเงิน", "เพชร", "50891", "0", "95", "", "8:38:00", "ขวด 250", "250 ml", "S-1"],
  ["a02", "10/11/2569", "22:00:00", "เสร็จสิ้น", "6:30:00", "บี", "PET 1", "ขวด", "600 ml", "คอยาว", "ใส", "MK", "20,000", "120", "30", "เริ่มฉีด22.00น", "8:30:00", "", "", "S-2"],
  ["a03", "11/11/2569", "10:00:00", "ปิดงาน", "8:00:00", "ซี", "PET 2", "ขวด", "250 ml", "คอยาว", "ใส", "เพชร", "4000", "10", "5", "", "", "", "", "S-3"],
  ["a04", "11/11/2569", "7:00:00", "ปิดงาน", "5:00:00", "ดี", "SHE230G PET", "พรีฟอร์ม", "9 กรัม", "", "ใส", "", "79416", "0", "0", "", "22:00:00", "", "", "S-4"],
  ["a05", "12/11/2569", "9:00:00", "ปิดงาน", "12:00:00", "ดี", "", "ขวด", "500 ml", "คอยาว", "ใส", "เรียบ", "3000", "0", "10", "", "3:00:00", "", "", "S-5"],
  ["a06", "16/11/2569", "7:30:00", "กำลังผลิต", "", "เอ", "SHE230G PET", "พรีฟอร์ม", "9 กรัม", "", "ใส", "", "", "", "", "", "", "", "", "S-6"],
  ["a07", "12/11/2569", "8:00:00", "กำลังผลิต", "", "บี", "LG17-228 PET", "พรีฟอร์ม", "12.5 กรัม", "", "น้ำเงิน", "", "", "", "", "", "", "", "", "S-7"],
  ["a08", "13/11/2569", "8:00:00", "ปิดงาน", "17:00:00", "เอ", "PET 11", "ขวด", "600 ml", "คอสั้น", "ใส", "", "9000", "0", "0", "", "", "", "", "S-8"],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
];

async function setup(rows) {
  const G = loadGas(SRC, { now: T0 });
  seedGas(G);
  G.books.get(IDS.stock).getSheetByName("ProductionLog").data = [HEAD, ...rows];
  const gasFetch = async url => { const p = Object.fromEntries(new URL(url).searchParams.entries()); return new Response(JSON.stringify(G.call(p.action, p)), { headers: { "content-type": "application/json" } }); };
  const W = world({ now: T0, fetch: gasFetch, env: { PK_TICKET_KEY: G.ctx.v2Key_("ticket"), PK_SYNC_KEY: G.ctx.v2Key_("sync"), PK_GAS_URL: "https://gas.test/exec" } });
  const boss = G.call("pkV2Ticket", {}, { sid: "S004", pin: "4444" }).ticket;
  const run = async (source, limit) => {
    let cursor = "0", runId = "", last, pages = 0;
    do {
      last = await W.call(boss, "import.run", { source, cursor, run: runId, limit: limit || 100 });
      assert.equal(last.status, 200, source + ": " + JSON.stringify(last.error));
      runId = last.data.run; cursor = last.data.next; pages++;
    } while (cursor !== null && pages < 50);
    return { ...last.data, pages };
  };
  return { G, W, boss, run, sheet: () => G.books.get(IDS.stock).getSheetByName("ProductionLog") };
}

test("ตัวแกะเวลา: h:mm:ss · วันที่+เวลา · ข้ามเที่ยงคืน (เกณฑ์ชั่วโมง/เวลาทำงานสุทธิ) vs พิมพ์ผิด", () => {
  assert.deepEqual(parseClock("8:15:30"), { day: "", sec: 8 * 3600 + 15 * 60 + 30 });
  assert.deepEqual(parseClock("2026-11-10 22:05"), { day: "2026-11-10", sec: 22 * 3600 + 300 });
  assert.equal(parseClock("10/11/2569 6:30:00").day, "2026-11-10");
  assert.equal(parseClock("25:00"), null); assert.equal(parseClock("abc"), null);
  assert.equal(parseNet("007:30:00"), 450); assert.equal(parseNet(""), null);
  const night = legacyTimes("10/11/2569", "22:00:00", "6:30:00", "", 20);
  assert.deepEqual([night.started_at, night.ended_at, night.crossed, night.time_issue], ["2026-11-10T15:00:00.000Z", "2026-11-10T23:30:00.000Z", true, ""]);
  assert.match(legacyTimes("11/11/2569", "10:00:00", "8:00:00", "", 20).time_issue, /พิมพ์ผิด/);
  assert.equal(legacyTimes("11/11/2569", "7:00:00", "5:00:00", "22:00:00", 20).crossed, true, "เวลาสุทธิยืนยันว่ารอบยาวข้ามคืน");
  assert.match(legacyTimes("11/11/2569", "17:00:00", "5:00:00", "2:00:00", 20).time_issue, /พิมพ์ผิด/, "เวลาสุทธิไม่ตรง = พิมพ์ผิด");
  assert.equal(legacyTimes("11/11/2569", "", "5:00:00", "", 20).time_issue, "ไม่มีเวลาเริ่ม");
  assert.equal(legacyTimes("2026-11-11", "08:00", "2026-11-12 02:00", "", 20).ended_at, "2026-11-11T19:00:00.000Z", "เวลาปิดมีวันที่ในตัว = ใช้วันนั้น");
  assert.equal(legacyTimes("31/2/2569", "8:00", "9:00", "", 20), null);
});

test("นำเข้ารอบเก่าด้วยหัวคอลัมน์จริง: พ.ศ. · กะดึก · พิมพ์ผิด (ธง ไม่นับชั่วโมง) · ไม่ระบุเครื่อง · เครื่องไม่รู้จัก → ถาด · รอบค้าง · ไม่แตะสต๊อก", async () => {
  const { W, run, boss } = await setup(ROWS());
  const early = await run("legacy:stock:ProductionLog");
  assert.equal(early.status, "ล้มเหลว"); assert.match(early.problems[0], /ทะเบียนเครื่อง/);
  await run("ref:machines"); await run("ref:products"); await run("staff");
  const r = await run("legacy:stock:ProductionLog", 3);
  assert.equal(r.status, "สำเร็จ"); assert.equal(r.pages, 3);
  assert.equal(W.one("SELECT inserted FROM sync_runs WHERE id = ?", r.run).inserted, 8);
  const one = id => W.one("SELECT * FROM machine_runs WHERE id = ?", "L-" + id);
  assert.deepEqual([one("a01").started_at, one("a01").ended_at, one("a01").chain_id, one("a01").good_pcs], ["2026-11-10T01:15:00.000Z", "2026-11-10T09:53:00.000Z", "LS-S-1", 50891]);
  assert.deepEqual([one("a02").ended_day, one("a02").good_pcs, one("a02").status], ["2026-11-11", 20000, "ปิดแล้ว"]);
  assert.match(one("a03").time_issue, /พิมพ์ผิด/); assert.equal(one("a03").ended_at, ""); assert.equal(one("a03").good_pcs, 4000);
  assert.equal(one("a04").ended_day, "2026-11-12"); assert.equal(one("a04").time_issue, "");
  assert.equal(one("a05").machine_id, "NOMACHINE");
  assert.equal(one("a06").status, "ค้างจากระบบเดิม"); assert.equal(one("a07").status, "ค้างจากระบบเดิม");
  assert.match(one("a08").machine_id, /^LM/);
  assert.deepEqual(W.q("SELECT name_text, staff_id FROM run_crew WHERE run_id = 'L-a01' ORDER BY name_text").map(x => x.name_text + ":" + (x.staff_id || "")), ["บี:S002", "เอ:S001"]);
  for (const k of ["import:legacy:runs:time", "import:legacy:runs:nomachine", "import:legacy:runs:stuck"]) assert.equal(W.one("SELECT count(*) n FROM flags WHERE dedupe_key = ?", k).n, 1, k);
  assert.equal(W.one("SELECT count(*) n FROM stock_moves").n, 0, "ประวัติไม่แตะสต๊อก");
  // แผนผัง: รอบเก่าที่เพิ่งเริ่ม = เดิน (ช่วงเปลี่ยนผ่าน) · รอบเก่าที่ค้างหลายวัน = ค้าง · เครื่องไม่รู้จักอยู่ถาด
  const S9 = boss;
  const f = (await W.call(S9, "prod.floor", {})).data;
  const she = f.machines.find(m => m.id === "SHE230G");
  assert.equal(she.state, "เดิน"); assert.equal(she.run.legacy, true);
  assert.equal(f.machines.find(m => m.id === "LG17228").stuck, 1);
  assert.ok(f.machines.some(m => m.id === one("a08").machine_id && !m.plant));
  // รายละเอียดเครื่อง: ไม่นับชั่วโมงของแถวพิมพ์ผิด
  const d = (await W.call(S9, "prod.machine", { id: "PET2" })).data;
  assert.equal(d.info.hours, 0); assert.equal(d.info.bad_time, 1); assert.equal(d.info.good, 4000);
  // รันซ้ำ = ไม่มีอะไรเปลี่ยน
  const again = await run("legacy:stock:ProductionLog");
  assert.equal(W.one("SELECT inserted + updated AS n FROM sync_runs WHERE id = ?", again.run).n, 0);
  assert.equal(W.one("SELECT count(*) n FROM machine_runs WHERE src = 'legacy:stock'").n, 8);
});

test("ซิงก์ซ้ำช่วงเปลี่ยนผ่าน: แอปเดิมปิดรอบ/แก้คน → ตามได้ · รอบที่ปิดใน v2 แล้วไม่ถูกทับ (ขึ้นธงถ้าต่าง) · ไม่เขียนกลับชีต", async () => {
  const { W, run, sheet, G } = await setup(ROWS());
  await run("ref:machines"); await run("ref:products"); await run("staff");
  await run("legacy:stock:ProductionLog");
  // v2 ปิดรอบค้าง a07 ย้อนหลัง
  const g = G.call("pkV2Ticket", {}, { nick: "บี", pin: "2222", kind: "g" }).ticket;
  const c = await W.call(g, "run.close", { run: "L-a07", version: 1, good: 30000 }, { as: "prod", reason: "ปิดในแอปเดิมแล้ว" });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  // แอปเดิม: ปิด a06 · แก้ยอด a07 · a01 เหลือคนเดียว
  const rows = sheet().data;
  const at = id => rows.findIndex(r => r[0] === id);
  rows[at("a06")][3] = "ปิดงาน"; rows[at("a06")][4] = "8:45:00"; rows[at("a06")][12] = "15000";
  rows[at("a07")][3] = "ปิดงาน"; rows[at("a07")][4] = "20:00:00"; rows[at("a07")][12] = "31000";
  rows[at("a01")][5] = "เอ";
  const r = await run("legacy:stock:ProductionLog");
  assert.equal(W.one("SELECT updated FROM sync_runs WHERE id = ?", r.run).updated, 1, "a06 อัปเดต (a01 เปลี่ยนแค่คน · a07 ไม่ทับ)");
  const a06 = W.one("SELECT * FROM machine_runs WHERE id = 'L-a06'");
  assert.deepEqual([a06.status, a06.good_pcs, a06.ended_at], ["ปิดแล้ว", 15000, "2026-11-16T01:45:00.000Z"]);
  assert.equal(a06.version, a06.sync_version);
  assert.equal(W.one("SELECT good_pcs FROM machine_runs WHERE id = 'L-a07'").good_pcs, 30000, "ไม่ทับที่ v2 ปิดแล้ว");
  assert.equal(W.one("SELECT count(*) n FROM flags WHERE dedupe_key = 'legacy-diff:L-a07' AND status = 'เปิด'").n, 1);
  assert.deepEqual(W.q("SELECT name_text FROM run_crew WHERE run_id = 'L-a01' AND status = 'ใช้งาน'").map(x => x.name_text), ["เอ"]);
  assert.equal(W.one("SELECT count(*) n FROM stock_moves").n, 0);
  // ชีตเดิมไม่ถูกเขียนกลับ (ชีต AppSheet ในโลกจำลองเปิดแบบอ่านอย่างเดียว — เขียน = ล้ม) · แถวยังเท่าเดิม
  assert.equal(sheet().data.length, ROWS().length + 1);
});
