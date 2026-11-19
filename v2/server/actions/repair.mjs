// ============================================================
//  จอด / ซ่อมเสร็จ (เดินต่อ) — ของกลางเครื่องเป่า (ทีมผลิต) และเครื่องสกรีน (ทีมสกรีน)            v2/server/actions/repair.mjs
//  · ชิ้นส่วน (part) = ชิปเสริม ไม่บังคับ · สาเหตุ (reason) ยังบังคับเหมือนเดิม
//  · ซ่อมเสร็จ = จดคนแก้ (คนที่กด — ทีมผลิตใส่ PIN ตอนกด) + เวลาหยุดรวม + แก้ชิ้นส่วนได้ถ้าเพิ่งรู้ตอนซ่อม
//  · ข้อความแชร์ลงไลน์ (ภาษาไทยสั้น ไม่มีรหัสระบบ) ทำที่หลังบ้าน → result.share (หน้าเว็บแค่กดแชร์/คัดลอก)
//  · "หยุดบ่อยเพราะอะไร" = stopSummary() (ครั้ง + ชั่วโมงต่อชิ้นส่วน 7/30 วัน)
//  เครื่องสกรีน S1–S8: smachine.list · smachine.stop · smachine.resume (บทบาท screen · ไม่มีรอบเครื่อง)
// ============================================================
import { bad, conflict, notFound, need, text, int, iso, thaiDay, thaiHm } from "../core.mjs";

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
/** ระยะเวลาเป็นคำ: "3 นาที" · "1 ชม. 20 นาที" · "2 วัน 3 ชม." */
export function durThai(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return m + " นาที";
  const hh = Math.floor(m / 60), mm = m % 60;
  if (hh < 24) return hh + " ชม." + (mm ? " " + mm + " นาที" : "");
  return Math.floor(hh / 24) + " วัน" + (hh % 24 ? " " + (hh % 24) + " ชม." : "");
}
const bits = (...a) => a.filter(Boolean).join(" · ");
/** "PET 4 จอด 10:58 · หลอด/ฮีตเตอร์ · ก้ามปู" */
export const stopText = (name, e) => bits(name + " จอด " + thaiHm(Date.parse(e.started_at)), e.reason, e.part && e.part !== e.reason ? e.part : "", e.detail);
/** "PET 4 เดินต่อ 11:01 · หยุด 3 นาที · ก้ามปู · แก้โดย บอส" */
export const resumeText = (name, e, endAt, fixer) => bits(name + " เดินต่อ " + thaiHm(Date.parse(endAt)), "หยุด " + durThai(Date.parse(endAt) - Date.parse(e.started_at)), e.part || e.reason, e.fix_note, fixer ? "แก้โดย " + fixer : "");
/** เปลี่ยนโมลด์: แจ้ง/เริ่ม/เสร็จ */
export function moldText(name, stage, ev, at, to) {
  const hm = thaiHm(Date.parse(at));
  if (stage === "จะเปลี่ยน") return bits(name + " จะเปลี่ยนโมลด์ (แจ้ง " + hm + ")", to ? "→ " + to : "");
  if (stage === "กำลังเปลี่ยน") return bits(name + " หยุดเปลี่ยนโมลด์ " + hm, to ? "→ " + to : "");
  if (stage === "เสร็จ") return bits(name + " เปลี่ยนโมลด์เสร็จ " + hm, to, ev && (ev.work_at || ev.started_at) ? "ใช้เวลา " + durThai(Date.parse(at) - Date.parse(ev.work_at || ev.started_at)) : "");
  return name + " ยกเลิกเปลี่ยนโมลด์ " + hm;
}

/**
 * หยุดบ่อยเพราะอะไร: rows = เรื่องจอด (started_at · ended_at · part · reason) ย้อนหลัง ≥ 30 วัน
 * → { d7: [{ part, n, hours }], d30: [...] } เรียงชั่วโมงมากสุดก่อน · ยังจอดอยู่ = นับถึงตอนนี้ · ช่วงที่เริ่มก่อนกรอบเวลา = ตัดที่ขอบ
 */
export function stopSummary(rows, now) {
  const win = days => {
    const from = now - days * DAY, by = new Map();
    for (const r of rows) {
      const a = Date.parse(r.started_at), b = r.ended_at ? Date.parse(r.ended_at) : now;
      if (b < from) continue;
      const k = r.part || "ไม่ระบุชิ้นส่วน";
      const g = by.get(k) || { part: k, n: 0, ms: 0, reasons: new Map() };
      g.n++; g.ms += Math.max(0, b - Math.max(a, from));
      if (r.reason) g.reasons.set(r.reason, (g.reasons.get(r.reason) || 0) + 1);
      by.set(k, g);
    }
    return [...by.values()].map(g => ({ part: g.part, n: g.n, hours: Math.round(g.ms / HOUR * 10) / 10, reason: [...g.reasons.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0])[0] || "" }))
      .sort((x, y) => y.hours - x.hours || y.n - x.n);
  };
  const d7 = win(7), d30 = win(30);
  const tot = list => ({ n: list.reduce((s, x) => s + x.n, 0), hours: Math.round(list.reduce((s, x) => s + x.hours, 0) * 10) / 10 });
  return { d7, d30, t7: tot(d7), t30: tot(d30) };
}
export const STOP_ROWS_SQL = "SELECT started_at, ended_at, part, reason FROM machine_events WHERE machine_id = ? AND kind = 'จอดเครื่อง' AND status = 'ใช้งาน' AND (ended_at = '' OR ended_at >= ?) ORDER BY started_at";

/** แผนการเขียน "จอด" (ใช้ทั้ง run.stop และ smachine.stop) */
export function stopPlan(X, m, open, run, input) {
  if (!m || m.status === "เลิกใช้") throw notFound("ไม่พบเครื่องนี้");
  if (open) throw conflict(m.name + " จอดอยู่แล้ว ตั้งแต่ " + thaiHm(Date.parse(open.started_at)) + " (" + (open.reason || "ไม่ระบุ") + ")", { stop: { id: open.id, version: open.version } });
  const at = input.at || iso(X.now);
  const id = "E" + X.newId();
  const row = { id, machine_id: m.id, run_id: run ? run.id : null, kind: "จอดเครื่อง", reason: X.reason, part: input.part || "", detail: input.note || "", started_at: at, started_day: thaiDay(Date.parse(at)), by: X.staff.id, src: "v2" };
  return { result: { id, share: stopText(m.name, row) }, label: bits("จอด " + m.name, X.reason, input.part), ops: [{ op: "insert", table: "machine_events", row }] };
}
/** แผนการเขียน "ซ่อมเสร็จ/เดินต่อ" — e มี machine_name */
export function resumePlan(X, e, input) {
  if (!e || e.kind !== "จอดเครื่อง") throw notFound("ไม่พบเรื่องที่จอด");
  if (e.ended_at || e.status !== "ใช้งาน") throw conflict("เครื่องนี้เดินต่อไปแล้ว — โหลดใหม่");
  if (e.version !== input.version) throw conflict();
  const at = input.at || iso(X.now);
  if (at < e.started_at) throw bad("เวลาเดินต่ออยู่ก่อนเวลาที่จอด (" + thaiHm(Date.parse(e.started_at)) + ")");
  const { machine_name, ...old } = e;
  const set = { ended_at: at, fixed_by: X.staff.id };
  if (input.part && input.part !== e.part) set.part = input.part;
  if (input.note) set.fix_note = input.note;
  const after = { ...old, ...set };
  return {
    result: { id: e.id, minutes: Math.round((Date.parse(at) - Date.parse(e.started_at)) / MIN), share: resumeText(machine_name, after, at, X.staff.nick) },
    label: bits("เดินเครื่องต่อ " + machine_name, "หยุด " + durThai(Date.parse(at) - Date.parse(e.started_at))),
    ops: [{ op: "update", table: "machine_events", id: e.id, expect: e.version, before: old, set }],
  };
}
/** ข้อมูลเรื่องจอดสำหรับหน้าเว็บ (+ข้อความแชร์) */
export function eventOut(e, name, now) {
  const end = e.ended_at || "";
  return { id: e.id, kind: e.kind, reason: e.reason, part: e.part || "", detail: e.detail, stage: e.stage, mold_from: e.mold_from, mold_to: e.mold_to,
    started_at: e.started_at, work_at: e.work_at, ended_at: end, by: e.by_nick || "", fixed_by: e.fixed_nick || "", fix_note: e.fix_note || "", version: e.version,
    minutes: e.kind === "จอดเครื่อง" ? Math.round(((end ? Date.parse(end) : now) - Date.parse(e.started_at)) / MIN) : null,
    share: e.kind === "จอดเครื่อง" ? (end ? resumeText(name, e, end, e.fixed_nick || "") : stopText(name, e)) : moldText(name, e.stage === "เสร็จ" ? "เสร็จ" : e.stage, e, end || e.work_at || e.started_at, e.mold_to) };
}

// ── เครื่องสกรีน (แอปทีมสกรีน) ─────────────────────────────────────────────
const SROLES = ["screen"];
async function loadScreenMachine(X, id) {
  const [m, ev] = await X.db.reads([
    ["SELECT * FROM machines WHERE id = ?", id],
    ["SELECT * FROM machine_events WHERE machine_id = ? AND kind = 'จอดเครื่อง' AND ended_at = '' AND status = 'ใช้งาน'", id],
  ]);
  if (m[0] && m[0].kind !== "สกรีน") throw bad(m[0].name + " ไม่ใช่เครื่องสกรีน — จอดได้จากแอปทีมผลิต");
  return { m: m[0], open: ev[0] };
}
export function defineRepair(R) {
  R.define({
    name: "smachine.list", roles: ["screen", "office", "exec"],
    async run(X) {
      const since = iso(X.now - 30 * DAY);
      const [ms, evs] = await X.db.reads([
        ["SELECT id, name, map_label, sub, plant, makes, version FROM machines WHERE kind = 'สกรีน' AND status = 'ใช้งาน' ORDER BY name"],
        [`SELECT e.*, s.nick AS by_nick, f.nick AS fixed_nick FROM machine_events e JOIN machines m ON m.id = e.machine_id LEFT JOIN staff s ON s.id = e.by LEFT JOIN staff f ON f.id = e.fixed_by
           WHERE m.kind = 'สกรีน' AND e.kind = 'จอดเครื่อง' AND e.status = 'ใช้งาน' AND (e.ended_at = '' OR e.ended_at >= ?) ORDER BY e.started_at`, since],
      ]);
      const machines = ms.map(m => {
        const mine = evs.filter(e => e.machine_id === m.id);
        const open = mine.find(e => !e.ended_at);
        const last = mine.filter(e => e.ended_at).slice(-1)[0];
        return { id: m.id, name: m.name, label: m.map_label || m.name, sub: m.sub, plant: m.plant, makes: m.makes,
          stop: open ? eventOut(open, m.name, X.now) : null, last: last ? eventOut(last, m.name, X.now) : null,
          stats: stopSummary(mine, X.now), recent: mine.slice(-5).reverse().map(e => eventOut(e, m.name, X.now)) };
      });
      return { asOf: iso(X.now), machines, stopped: machines.filter(m => m.stop).length };
    },
  });
  R.define({
    name: "smachine.stop", roles: SROLES, write: true, reason: "required", label: "จอดเครื่องสกรีน",
    input: raw => ({ machine: need(raw.machine, "เครื่อง", 40), part: text(raw.part, 60, "ชิ้นส่วน"), note: text(raw.note, 300) }),
    load: (X, input) => loadScreenMachine(X, input.machine),
    onUnique: () => conflict("เครื่องนี้เพิ่งถูกกดจอดไปพร้อมกัน — โหลดใหม่"),
    run: (X, input, ctx) => stopPlan(X, ctx.m, ctx.open, null, input),
  });
  R.define({
    name: "smachine.resume", roles: SROLES, write: true, label: "เครื่องสกรีนเดินต่อ",
    input: raw => ({ event: need(raw.event, "เรื่องที่จอด", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), part: text(raw.part, 60, "ชิ้นส่วน"), note: text(raw.note, 300) }),
    async load(X, input) {
      const [e] = await X.db.reads([["SELECT e.*, m.name AS machine_name, m.kind AS machine_kind FROM machine_events e JOIN machines m ON m.id = e.machine_id WHERE e.id = ?", input.event]]);
      if (e[0] && e[0].machine_kind !== "สกรีน") throw bad("เรื่องนี้ไม่ใช่ของเครื่องสกรีน");
      if (e[0]) delete e[0].machine_kind;
      return { e: e[0] };
    },
    run: (X, input, ctx) => resumePlan(X, ctx.e, input),
  });
}
