// ============================================================
//  งวดส่ง · ต้องการเมื่อไร · จอง/นัดแล้ว — ฟังก์ชันล้วน (หลังบ้านทุกโมดูล + เทสต์ใช้ตัวเดียวกัน)         v2/server/actions/office-plan-lib.mjs
//
//  แบบงวด (orders.plan_mode):
//    ครั้งเดียว   = งวดเดียวครบ · ส่งไม่ครบ = ค้างในงวดเดิม
//    กำหนดจำนวน  = ต่อครั้ง (ใบของรายการแรก) × กี่ครั้ง หรือ ทุกกี่วัน → หลายงวด · ส่งไม่ครบ = ส่วนขาดไปรวมงวดถัดไป
//    ทยอย        = ตามที่ทำได้ (เพดานต่อเที่ยวไม่บังคับ) · ส่งไม่ครบ = ค้างต่อ · ส่งแล้ววันที่นัด = รอนัดเที่ยวถัดไป
//    ''          = ไม่ได้วางงวด (ออเดอร์เก่า/นำเข้า) → ถือ due_day เป็นงวดเดียว
//  งวดเก็บ "ส่วนของออเดอร์" (part_bp หน่วย 1/10000) — ออเดอร์หลายรายการแบ่งตามสัดส่วนเดียวกัน · นับถุงปัดเป็นถุงเต็ม · งวดสุดท้ายเก็บเศษให้ครบ
//  ส่งครบ/ส่งไม่ครบของแต่ละงวด "คิดจากการส่งจริง" (วันที่ส่งแล้ว) ไม่มีปุ่มให้คนกดปิดงวด
//  จอง = ยังมีของต้องส่ง แต่ไม่มีงวดไหนที่ยังไม่ส่งมีวันนัด
// ============================================================
import { bad, int, oneOf, day, addDays } from "../core.mjs";

export const PLAN_MODES = ["ครั้งเดียว", "กำหนดจำนวน", "ทยอย"];
export const WANT_WHEN = ["สัปดาห์นี้", "สัปดาห์หน้า", "ไม่รีบ", "ระบุวัน"];
export const MAX_ROUNDS = 52;
export const FULL = 10000;

/** แผนงวดจากหน้าเว็บ → ตรวจแล้ว · ไม่ส่งมา = null (ใช้ due_day แบบเดิม) */
export function planInput(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mode = oneOf(raw.mode || "ครั้งเดียว", PLAN_MODES, "แบบงวดส่ง");
  const p = {
    mode, first_day: day(raw.first_day, "วันนัดส่ง", true),
    each_pcs: int(raw.each_pcs || null, "จำนวนต่อครั้ง", { optional: true, min: 1, max: 100000000 }) || 0,
    times: int(raw.times || null, "จำนวนครั้ง", { optional: true, min: 1, max: MAX_ROUNDS }) || 0,
    every_days: int(raw.every_days || null, "ทุกกี่วัน", { optional: true, min: 0, max: 365 }) || 0,
    cap_pcs: int(raw.cap_pcs || null, "เพดานต่อเที่ยว", { optional: true, min: 0, max: 100000000 }) || 0,
  };
  if (mode === "กำหนดจำนวน" && !p.each_pcs && !p.times) throw bad("งวดแบบกำหนดจำนวน: ใส่จำนวนต่อครั้ง หรือจำนวนครั้ง");
  if (mode !== "กำหนดจำนวน") { p.each_pcs = 0; p.times = 0; p.every_days = 0; }
  if (mode !== "ทยอย") p.cap_pcs = 0;
  return p;
}
/** ต้องการเมื่อไร (ไม่บังคับ · ไม่ตั้งให้เอง) */
export function wantInput(raw) {
  const when = oneOf(raw.want_when || "", ["", ...WANT_WHEN], "ต้องการเมื่อไร");
  const wday = when === "ระบุวัน" ? day(raw.want_day, "วันที่ลูกค้าต้องการ") : "";
  return { want_when: when, want_day: wday };
}

/** แผน → งวด [{seq, plan_day, part_bp}] · mainQty = จำนวนของรายการแรก (ฐานของ "ต่อครั้ง") */
export function buildRounds(plan, mainQty) {
  if (!plan || plan.mode !== "กำหนดจำนวน") return [{ seq: 1, plan_day: plan ? plan.first_day : "", part_bp: FULL }];
  const Q = Math.max(1, Number(mainQty) || 1);
  let n = plan.each_pcs ? Math.ceil(Q / plan.each_pcs) : plan.times;
  n = Math.max(1, n);
  if (n > MAX_ROUNDS) throw bad("แบ่งได้ไม่เกิน " + MAX_ROUNDS + " งวด — เพิ่มจำนวนต่อครั้ง");
  const cum = k => (k >= n ? FULL : k <= 0 ? 0 : plan.each_pcs ? Math.floor(FULL * k * plan.each_pcs / Q) : Math.floor(FULL * k / n));
  const out = [];
  for (let k = 1; k <= n; k++) {
    const part = cum(k) - cum(k - 1);
    if (part < 1) throw bad("จำนวนต่อครั้งน้อยเกินไปเมื่อเทียบกับทั้งออเดอร์");
    out.push({ seq: k, part_bp: part, plan_day: k === 1 ? plan.first_day : plan.every_days && plan.first_day ? addDays(plan.first_day, (k - 1) * plan.every_days) : "" });
  }
  return out;
}

/** เป้าสะสมของรายการหนึ่ง ณ ส่วนสะสม cumBp — นับถุงปัดเป็นถุงเต็ม · ครบ 10000 = ทั้งรายการ */
export function targetOf(item, cumBp) {
  const q = Number(item.qty_pcs) || 0;
  if (cumBp >= FULL) return q;
  const per = Number(item.per_bag) || 0;
  if (per > 0) return Math.min(q, Math.round((q / per) * cumBp / FULL) * per);
  return Math.min(q, Math.round(q * cumBp / FULL));
}

/**
 * สภาพงวดตอนนี้ (ฟังก์ชันล้วน)
 *   order  = { plan_mode, plan_cap_pcs, due_day }
 *   rounds = แถว order_rounds (ทุกสถานะ — ตัวนี้กรองเอง)
 *   items  = รายการที่ยังใช้งาน { id, qty_pcs, per_bag, delivered } (delivered = ส่งแล้วรวมทุกทาง)
 *   sent   = ของที่ส่งแล้ว [{ order_item_id, qty_pcs, done_day }] (delivery_loads สถานะ ส่งแล้ว)
 * → { mode, rounds[…สถานะต่องวด], current, due, reserve, done, n }
 */
export function planState(order, rounds, items, sent) {
  const mode = order.plan_mode || "";
  let R = (rounds || []).filter(r => r.status !== "ยกเลิก").sort((a, b) => a.seq - b.seq).map(r => ({ id: r.id, seq: r.seq, plan_day: r.plan_day || "", part_bp: r.part_bp, version: r.version }));
  const virtual = !R.length;
  if (virtual) R = [{ id: "", seq: 1, plan_day: order.due_day || "", part_bp: FULL, version: 0 }];
  let acc = 0;
  R.forEach(r => { acc += r.part_bp; r.cum = Math.min(FULL, acc); });
  R[R.length - 1].cum = FULL;
  const its = (items || []).filter(i => i.status !== "ยกเลิก");
  const total = new Map(its.map(i => [i.id, Number(i.delivered) || 0]));
  const met = (k, D) => its.every(i => (D.get(i.id) || 0) >= targetOf(i, R[k].cum));
  const byDay = new Map();
  for (const s of sent || []) {
    if (!s.done_day) continue;
    const m = byDay.get(s.done_day) || new Map();
    m.set(s.order_item_id, (m.get(s.order_item_id) || 0) + (Number(s.qty_pcs) || 0));
    byDay.set(s.done_day, m);
  }
  const days = [...byDay.keys()].sort();
  const n = R.length;
  R.forEach(r => { r.state = "รอ"; r.days = []; });
  let k = 0;
  const D = new Map();
  if (mode === "กำหนดจำนวน" && n > 1) {
    for (const d of days) {
      while (k < n && its.length && met(k, D)) { R[k].state = "ส่งครบ"; k++; }
      if (k >= n) break;
      for (const [id, q] of byDay.get(d)) D.set(id, (D.get(id) || 0) + q);
      R[k].days.push(d);
      if (k < n - 1) { R[k].state = met(k, D) ? "ส่งครบ" : "ส่งไม่ครบ"; k++; }
    }
  }
  while (k < n && its.length && met(k, total)) { R[k].state = "ส่งครบ"; if (!R[k].days.length && days.length) R[k].days.push(days[days.length - 1]); k++; }
  const done = k >= n;
  const lastDay = days.length ? days[days.length - 1] : "";
  let current = null, due = "";
  if (!done) {
    const r = R[k];
    r.state = "ถึงคิว";
    let need = its.map(i => ({ item_id: i.id, pcs: Math.max(0, targetOf(i, r.cum) - (total.get(i.id) || 0)) }));
    const cap = Number(order.plan_cap_pcs) || 0;
    if (mode === "ทยอย" && cap > 0 && its[0]) need = need.map(x => (x.item_id === its[0].id ? { ...x, pcs: Math.min(x.pcs, cap) } : x));
    due = r.plan_day;
    // ทยอย: ส่งไปแล้วตั้งแต่วันที่นัด = เที่ยวนั้นจบ → รอนัดเที่ยวถัดไป (ไม่โชว์ว่าเลยกำหนดผิด ๆ)
    const waitNext = mode === "ทยอย" && !!due && !!lastDay && lastDay >= due;
    if (waitNext) due = "";
    current = { id: r.id, seq: r.seq, n, plan_day: r.plan_day, version: r.version, need, wait_next: waitNext, carried: k > 0 && R[k - 1].state === "ส่งไม่ครบ" };
  }
  const reserve = !done && !due && !R.slice(k + 1).some(r => r.plan_day);
  return { mode, virtual, n, done, due, reserve, current, last_day: lastDay, rounds: R.map(({ cum, ...r }) => ({ ...r, cum_bp: cum })) };
}

/** "ต้องการ สัปดาห์นี้" → ช่วงวันคร่าว ๆ จากวันที่สั่ง (สัปดาห์ = จันทร์–อาทิตย์) — ไว้โชว์ ไม่ใช่วันนัด */
export function wantRange(orderDay, when, wday) {
  if (when === "ระบุวัน") return { from: wday, to: wday };
  if (when !== "สัปดาห์นี้" && when !== "สัปดาห์หน้า") return null;
  const dow = new Date(orderDay + "T12:00:00Z").getUTCDay();
  const sunday = addDays(orderDay, (7 - dow) % 7);
  return when === "สัปดาห์นี้" ? { from: orderDay, to: sunday } : { from: addDays(sunday, 1), to: addDays(sunday, 7) };
}
