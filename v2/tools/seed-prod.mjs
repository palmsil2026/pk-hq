// ============================================================
//  ข้อมูลสมมติของทีมผลิต (เครื่องนักพัฒนา · พรีวิว · เทสต์หน้าจอ) — ชื่อคน/ยอดไม่ใช่ของจริง       v2/tools/seed-prod.mjs
//  ประวัติรอบ 10 วันย้อนหลัง (ใช้คำนวณ ใบ/ชม. · ทำบ่อย · คนใช้บ่อย) · ผู้ปฏิบัติงานของรอบที่เดินอยู่ · รอบค้างจากแอปเดิม
//  แจ้งจะเปลี่ยนโมลด์ · สต๊อก (ผลิตเข้า/รับพรีฟอร์ม/เม็ด/ส่งออก) · งานผลิตผูกรอบ
// ============================================================
import { compileOps, wrapDb } from "../server/db.mjs";
import { iso, thaiDay, atThai, addDays, specKey, specLabel, newId } from "../server/core.mjs";
import "../server/actions/prodLib.mjs";

const AXES = { "ขวด": "ขนาด,คอขวด,รูปทรง,สี", "ถัง": "ขนาด,สี", "พรีฟอร์ม": "ขนาด,สี" };
const PLAN = {   // เครื่อง → [สเปก, ใบ/ชม.]
  PET1: [["ขวด", "600 ml", "คอยาว", "MK"], 1100], PET2: [["ขวด", "250 ml", "คอยาว", "เพชร"], 1500], PET3: [["ขวด", "500 ml", "คอยาว", "เหลี่ยม"], 800],
  PET4: [["ขวด", "250 ml", "คอสั้น", "เพชร"], 4300], PET5: [["ขวด", "500 ml", "คอยาว", "เรียบ"], 950], PET6: [["ขวด", "น้ำลัง ปากแคบ (920)", "", ""], 210],
  PET7: [["ขวด", "น้ำลัง ปากกว้าง (920)", "", ""], 160], PET8: [["ถัง", "18.9 ลิตร", "", ""], 55], PET9: [["ขวด", "600 ml", "คอสั้น", "เรียบ"], 900],
  PET10: [["ขวด", "800 ml", "คอยาว", "เพชร"], 700], SHE230G: [["พรีฟอร์ม", "9 กรัม", "", ""], 6200], LG17228: [["พรีฟอร์ม", "13.3 กรัม", "", ""], 4600],
};
const COLORS = ["ใส", "น้ำเงิน", "ใส", "น้ำเงิน", "ฟ้าทะเล", "ใส"];
const CREW = [["บอส"], ["เก่ง"], ["นุ่น"], ["บอส", "เก่ง"], ["เก่ง", "นุ่น"]];
const NICK = { "บอส": "S111", "เก่ง": "S112", "นุ่น": "S113" };

export async function seedProd(d1, opt) {
  const now = (opt && opt.now) || Date.now();
  const X = { db: wrapDb(d1), now, staff: { id: "system", nick: "ระบบ" }, newId: () => newId("", now), reqKey: "seed-prod" };
  const today = thaiDay(now);
  const ops = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const crewOps = (runId, names) => names.map(n => ({ op: "insert", table: "run_crew", row: { id: runId + "|" + n, run_id: runId, name_text: n, staff_id: NICK[n] || null, src: "demo" } }));
  // ประวัติ 10 วัน
  for (let dd = 10; dd >= 1; dd--) {
    const day = addDays(today, -dd);
    for (const [m, [[type, size, neck, shape], rate]] of Object.entries(PLAN)) {
      if (rnd() < 0.18) continue;
      const startH = 7 + Math.floor(rnd() * 3), hours = 6 + Math.floor(rnd() * 6);
      const color = type === "ถัง" ? (rnd() < 0.5 ? "น้ำเงิน" : "เขียว") : COLORS[Math.floor(rnd() * COLORS.length)];
      const it = { type, size, neck, shape, color };
      const s = atThai(day, startH, Math.floor(rnd() * 4) * 15), e = s + hours * 3600000;
      const good = Math.round(rate * hours * (0.85 + rnd() * 0.25)), b = Math.round(good * 0.004 * rnd()), w = Math.round(good * 0.006 * rnd());
      const id = "RH" + m + dd;
      const crew = CREW[Math.floor(rnd() * CREW.length)];
      ops.push({ op: "insert", table: "machine_runs", row: { id, machine_id: m, ...it, spec_key: specKey(it, AXES[type]), started_at: iso(s), started_day: day, ended_at: iso(e), ended_day: thaiDay(e), end_kind: "ปิดรอบ",
        good_pcs: good, grade_b_pcs: b, waste_pcs: w, status: "ปิดแล้ว", opened_by: NICK[crew[0]], closed_by: NICK[crew[0]], chain_id: id, stocked: 1, src: "demo",
        note: dd === 3 && m === "PET4" ? "หลอดเบอร์ 5 ร้าว เปลี่ยนแล้ว" : dd === 2 && m === "PET1" ? "ลมตกช่วงบ่าย ของเสียเยอะ" : "" } });
      ops.push(...crewOps(id, crew));
      ops.push({ op: "move", item_key: "spec:" + specKey(it, AXES[type]), label: specLabel(it), grade: "A", qty_pcs: good, move_type: "ผลิตเข้า", ref_entity: "machine_runs", ref_id: id, src: "demo" });
      if (b) ops.push({ op: "move", item_key: "spec:" + specKey(it, AXES[type]), label: specLabel(it), grade: "B", qty_pcs: b, move_type: "ผลิตเข้า", ref_entity: "machine_runs", ref_id: id, src: "demo" });
      if (type !== "พรีฟอร์ม" && rnd() < 0.7) ops.push({ op: "move", item_key: "spec:" + specKey(it, AXES[type]), label: specLabel(it), grade: "A", qty_pcs: -Math.round(good * (0.5 + rnd() * 0.4)), move_type: "ส่งออก", ref_entity: "demo", ref_id: id, src: "demo" });
    }
  }
  // รอบเก่าจากแอปเดิม: ค้าง 3 วัน + เวลาพิมพ์ผิด 1 รอบ
  const ls = atThai(addDays(today, -3), 8, 0);
  ops.push({ op: "insert", table: "machine_runs", row: { id: "L-demo1", machine_id: "LG17228", type: "พรีฟอร์ม", size: "13.3 กรัม", color: "น้ำเงิน", spec_key: "พรีฟอร์ม|13.3 กรัม|||น้ำเงิน", started_at: iso(ls), started_day: thaiDay(ls), status: "ค้างจากระบบเดิม", src: "legacy:stock", sync_version: 1 } });
  ops.push(...crewOps("L-demo1", ["นุ่น"]));
  const tb = atThai(addDays(today, -4), 10, 0);
  ops.push({ op: "insert", table: "machine_runs", row: { id: "L-demo2", machine_id: "PET2", type: "ขวด", size: "250 ml", neck: "คอยาว", shape: "เพชร", color: "ใส", spec_key: "ขวด|250 ml|คอยาว|เพชร|ใส", started_at: iso(tb), started_day: thaiDay(tb),
    end_kind: "ปิดรอบ", good_pcs: 4000, grade_b_pcs: 10, waste_pcs: 5, status: "ปิดแล้ว", time_issue: "เวลาปิดก่อนเวลาเริ่ม (เริ่ม 10:00 ปิด 08:00) น่าจะพิมพ์ผิด", src: "legacy:stock", sync_version: 1 } });
  // ผู้ปฏิบัติงานของรอบที่เดินอยู่ (seed-demo สร้างรอบไว้แล้ว)
  const open = d1.q ? d1.q("SELECT id, machine_id FROM machine_runs WHERE status = 'กำลังผลิต'") : [];
  open.forEach((r, i) => { if (!d1.one("SELECT 1 AS x FROM run_crew WHERE run_id = ?", r.id)) ops.push(...crewOps(r.id, CREW[i % CREW.length])); });
  // งานผลิต: ถังของร้าน E ผูกกับรอบ PET9
  const it9 = d1.one ? d1.one("SELECT * FROM order_items WHERE order_id = 'OD005'") : null;
  if (it9 && !d1.one("SELECT 1 AS x FROM production_jobs WHERE order_item_id = ?", it9.id)) {
    ops.push({ op: "insert", table: "production_jobs", row: { id: "JD005", order_id: "OD005", order_item_id: it9.id, type: it9.type, size: it9.size, neck: it9.neck, shape: it9.shape, color: it9.color, spec_key: it9.spec_key, target_pcs: it9.qty_pcs, good_pcs: 25, status: "กำลังผลิต", due_day: addDays(today, 4), src: "demo" } });
    ops.push({ op: "raw", sql: "UPDATE machine_runs SET job_id = 'JD005' WHERE id = 'RDPET9'" });
  }
  // จะเปลี่ยนโมลด์ · โมลด์ที่ติดอยู่ · รับพรีฟอร์ม/เม็ดเข้า
  ops.push({ op: "insert", table: "machine_events", row: { id: "EVM1", machine_id: "PET10", kind: "เปลี่ยนโมลด์", stage: "จะเปลี่ยน", mold_from: "800 ml เพชร", mold_to: "600 ml เรียบ คอสั้น", started_at: iso(now - 40 * 60000), started_day: today, by: "S112", src: "demo" } });
  ops.push({ op: "raw", sql: "UPDATE machines SET mold = '800 ml เพชร' WHERE id = 'PET10'" }, { op: "raw", sql: "UPDATE machines SET mold = '600 ml MK เหล็ก' WHERE id = 'PET1'" });
  ops.push({ op: "move", item_key: "spec:พรีฟอร์ม|13.3 กรัม|||ใส", label: "พรีฟอร์ม 13.3 กรัม ใส", grade: "A", qty_pcs: 48000, move_type: "รับเข้า", ref_entity: "stock_receive", ref_id: "SRD1", reason: "ซื้อเข้า", src: "demo" });
  ops.push({ op: "move", item_key: "mat:RESIN-PET", label: "เม็ดพลาสติก PET", grade: "A", qty_pcs: 1500, move_type: "รับเข้า", ref_entity: "stock_receive", ref_id: "SRD2", reason: "ซื้อเข้า", src: "demo" });
  const { stmts } = compileOps(X, ops);
  for (let i = 0; i < stmts.length; i += 200) await X.db.batch(stmts.slice(i, i + 200));
}
