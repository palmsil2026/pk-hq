// ============================================================
//  ความคืบหน้างานสกรีน (ทำบางส่วน · งานหลายวัน) — ของที่โมดูลอื่นอ่านได้          v2/server/actions/screen-progress.mjs
//  ออฟฟิศใช้ในรายละเอียดออเดอร์: import { screenProgress } from "./screen-progress.mjs"
//    const map = await screenProgress(X, { orders: ["OD…"] })   → Map(order_item_id | job_id → ความคืบหน้า)
//    หรือเรียก action `screen.progress { order }` จากหน้าเว็บ (บทบาท office · screen · exec)
//  แต่ละงาน: { job_id, order_id, order_item_id, status, team, planned_pcs, made_pcs, per_bag, text ("ทำแล้ว 30/100 ถุง"),
//             parts: [{ at, day, team, qty_pcs, text, by }] (ทุกช่วง เรียงเวลา) · done: { at, team, by, rest_pcs } (ส่วนที่เหลือตอนกดเสร็จ) }
//  ไม่มีตัวเลขเงิน · อ่านจาก view screen_progress (0320) + screen_parts
// ============================================================
import { bad, text, iso } from "../core.mjs";

const fmt = n => Number(n || 0).toLocaleString("en-US");
/** จำนวนเป็นคำ: ถุง + เศษใบ ("20 ถุง" · "20 ถุง 50 ใบ") · ไม่รู้ใบต่อถุง = ใบ */
export function amountText(pcs, item) {
  const per = item && item.per_bag > 0 ? item.per_bag : 0, unit = (item && item.piece_unit) || "ใบ";
  if (!per) return fmt(pcs) + " " + unit;
  const bags = Math.floor(pcs / per), loose = pcs - bags * per;
  return (bags ? fmt(bags) + " ถุง" : "") + (bags && loose ? " " : "") + (loose || !bags ? fmt(loose) + " " + unit : "");
}
/** "ทำแล้ว 30/100 ถุง" (ถุงไม่ลงตัว = ใบ) */
export function progressText(made, planned, per) {
  if (per > 0 && made % per === 0 && planned % per === 0) return "ทำแล้ว " + fmt(made / per) + "/" + fmt(planned / per) + " ถุง";
  return "ทำแล้ว " + fmt(made) + "/" + fmt(planned) + " ใบ";
}

/** ความคืบหน้าของงานสกรีนตามออเดอร์ (≤ 90 ออเดอร์ต่อครั้ง) หรือตามงาน — 1 รอบคุยกับฐาน */
export async function screenProgress(X, by) {
  const orders = (by.orders || []).slice(0, 90), jobs = (by.jobs || []).slice(0, 90);
  if (!orders.length && !jobs.length) return new Map();
  const col = orders.length ? "order_id" : "job_id", ids = orders.length ? orders : jobs;
  const qs = ids.map(() => "?").join(",");
  const [rows, parts] = await X.db.reads([
    [`SELECT g.*, (SELECT nick FROM staff WHERE id = j.done_by) AS done_nick, coalesce(t.piece_unit, 'ใบ') AS piece_unit FROM screen_progress g JOIN screen_jobs j ON j.id = g.job_id
       LEFT JOIN order_items i ON i.id = g.order_item_id LEFT JOIN product_types t ON t.code = i.type WHERE g.${col} IN (${qs}) ORDER BY g.job_id`, ...ids],
    [`SELECT p.job_id, p.at, p.day, p.team, p.qty_pcs, s.nick FROM screen_parts p LEFT JOIN staff s ON s.id = p.by WHERE p.status = 'ใช้งาน' AND p.${col} IN (${qs}) ORDER BY p.at`, ...ids],
  ]);
  const out = new Map();
  for (const r of rows) {
    const it = { per_bag: r.per_bag, piece_unit: r.piece_unit };
    const mine = parts.filter(p => p.job_id === r.job_id);
    const p = {
      job_id: r.job_id, order_id: r.order_id, order_item_id: r.order_item_id, status: r.status, team: r.team || "", colors: r.colors,
      planned_pcs: r.planned_pcs, made_pcs: r.made_pcs, partial_pcs: r.partial_pcs, per_bag: r.per_bag,
      text: r.status === "เสร็จแล้ว" ? "เสร็จแล้ว " + amountText(r.made_pcs, it) : r.partial_pcs ? progressText(r.partial_pcs, r.planned_pcs, r.per_bag) : r.status === "เตรียมการสกรีน" ? "กำลังสกรีน" : "รอสกรีน",
      parts: mine.map(x => ({ at: x.at, day: x.day, team: x.team || "", qty_pcs: x.qty_pcs, text: amountText(x.qty_pcs, it), by: x.nick || "" })),
      done: r.status === "เสร็จแล้ว" ? { at: r.done_at, day: r.done_day, team: r.team || "", by: r.done_nick || "", rest_pcs: Math.max(0, r.made_pcs - r.partial_pcs), text: amountText(Math.max(0, r.made_pcs - r.partial_pcs), it) } : null,
    };
    out.set(r.job_id, p);
    if (r.order_item_id && !out.has(r.order_item_id)) out.set(r.order_item_id, p);
  }
  return out;
}

export function defineScreenProgress(R) {
  R.define({
    name: "screen.progress", roles: ["screen", "office", "exec"],
    input: raw => {
      const order = text(raw.order, 40), job = text(raw.job, 40);
      if (!order && !job) throw bad("ต้องระบุออเดอร์หรืองานสกรีน");
      return { order, job };
    },
    async run(X, input) {
      const m = await screenProgress(X, input.order ? { orders: [input.order] } : { jobs: [input.job] });
      return { asOf: iso(X.now), jobs: [...new Set(m.values())] };
    },
  });
}
