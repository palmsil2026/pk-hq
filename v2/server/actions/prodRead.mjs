// ============================================================
//  ทีมผลิต: หน้าอ่าน — แผนผังโรงงาน · รายละเอียดเครื่อง · ตัวเลือกเปิดรอบ · ประวัติ · รายละเอียดรอบ     v2/server/actions/prodRead.mjs
//  ทุกหน้า 1 รอบคุยกับฐาน (X.db.reads) · ไม่ส่งรหัสไปโชว์ (ส่งใน id สำหรับกด/บรรทัด "รหัสอ้างอิง")
//  prod.floor / prod.machine ใช้ได้ทั้งทีมผลิต ประธาน ออฟฟิศ (อ่านอย่างเดียว — ปุ่มบันทึกอยู่ที่หน้าเว็บทีมผลิตเท่านั้น)
// ============================================================
import { bad, notFound, need, text, iso, thaiDay, atThai, addDays, isDay, specLabel } from "../core.mjs";
import { FLOOR } from "../import/reference.generated.mjs";
import { runState, runHours, OPEN_RUN, RUN_KINDS, PROD_TYPES } from "./prodLib.mjs";
import { loadJobs } from "./prodStock.mjs";

const READ = ["prod", "exec", "office"];
const CREW = "(SELECT group_concat(name_text, ' , ') FROM run_crew c WHERE c.run_id = r.id AND c.status = 'ใช้งาน') AS crew";
const DAYOF = "coalesce(nullif(r.ended_day, ''), r.started_day)";
const HOURS = "CASE WHEN r.ended_at <> '' AND r.time_issue = '' THEN (julianday(r.ended_at) - julianday(r.started_at)) * 24 ELSE 0 END";
const runOut = r => ({ id: r.id, machine_id: r.machine_id, machine: r.machine_name, type: r.type, size: r.size, neck: r.neck, shape: r.shape, color: r.color, label: specLabel(r),
  started_at: r.started_at, started_day: r.started_day, ended_at: r.ended_at, ended_day: r.ended_day, end_kind: r.end_kind, status: r.status, good: r.good_pcs, b: r.grade_b_pcs, waste: r.waste_pcs,
  waste_reason: r.waste_reason, note: r.note, crew: r.crew || "", job_id: r.job_id, time_issue: r.time_issue, late_close: r.late_close, legacy: String(r.src || "").startsWith("legacy"), per_bag: r.per_bag || 0, version: r.version });

export function defineProdRead(R) {
  // ── แผนผังโรงงาน (หน้าแรกทีมผลิต) ──
  R.define({
    name: "prod.floor", roles: READ,
    async run(X) {
      const today = thaiDay(X.now);
      const staleH = Number(X.settings.RUN_STALE_HOURS || 14);
      const cut = iso(X.now - staleH * 3600000);
      const [machines, runs, evs, made, flags, waitJobs, waitItems] = await X.db.reads([
        ["SELECT id, name, map_label, sub, kind, plant, pos_x, pos_y, w, h, tracked, status, makes, rating, mold, version FROM machines WHERE status <> 'เลิกใช้' ORDER BY plant, pos_y, pos_x"],
        [`SELECT r.id, r.machine_id, r.type, r.size, r.neck, r.shape, r.color, r.started_at, r.status, r.job_id, r.src, r.version, ${CREW} FROM machine_runs r WHERE r.status IN ${OPEN_RUN} ORDER BY r.started_at DESC`],
        ["SELECT id, machine_id, kind, reason, stage, mold_to, started_at, work_at, version FROM machine_events WHERE ended_at = '' AND status = 'ใช้งาน'"],
        [`SELECT r.machine_id, sum(r.good_pcs) AS good, sum(r.grade_b_pcs) AS b FROM machine_runs r WHERE r.status = 'ปิดแล้ว' AND ${DAYOF} = ? GROUP BY r.machine_id`, today],
        ["SELECT dedupe_key FROM flags WHERE status = 'เปิด' AND instr(dedupe_key, 'stale:') = 1"],
        ["SELECT count(*) AS n FROM production_jobs WHERE status IN ('รอผลิต','กำลังผลิต')"],
        [`SELECT count(*) AS n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.status = 'ใช้งาน' AND o.status IN ('รอผลิต','กำลังผลิต') AND i.type IN (${PROD_TYPES.map(() => "?").join(",")})
           AND NOT EXISTS (SELECT 1 FROM production_jobs j WHERE j.order_item_id = i.id AND j.status <> 'ยกเลิก')`, ...PROD_TYPES],
      ]);
      const flagged = new Set(flags.map(f => f.dedupe_key));
      const runBy = {}, legacyBy = {}, stopBy = {}, moldBy = {}, madeBy = {};
      for (const r of runs) {
        if (r.status === "กำลังผลิต") { if (!runBy[r.machine_id]) runBy[r.machine_id] = r; }
        else (legacyBy[r.machine_id] = legacyBy[r.machine_id] || []).push(r);
      }
      evs.forEach(e => { if (e.kind === "จอดเครื่อง") stopBy[e.machine_id] = e; else if (e.kind === "เปลี่ยนโมลด์") moldBy[e.machine_id] = e; });
      made.forEach(m => { madeBy[m.machine_id] = { good: m.good || 0, b: m.b || 0 }; });
      let sweep = false;
      const list = machines.map(m => {
        const leg = legacyBy[m.id] || [];
        // รอบจากแอปเดิมที่ยัง "กำลังผลิต" และเพิ่งเริ่ม (ช่วงเปลี่ยนผ่าน ทีมยังลงแอปเดิม) = เครื่องเดินจริง · เก่ากว่านั้น = ค้าง
        const liveLegacy = leg.find(r => r.started_at >= cut);
        const run = runBy[m.id] || liveLegacy || null;
        const st = runState(m, run, stopBy[m.id], moldBy[m.id], X.now, staleH);
        const stuck = leg.filter(r => r.started_at < cut).length;
        if (run && run.status === "กำลังผลิต" && st === "ค้างปิด" && !flagged.has("stale:" + run.id)) sweep = true;
        if (stuck && !flagged.has("stale:legacy")) sweep = true;
        const s = stopBy[m.id], md = moldBy[m.id];
        return { id: m.id, name: m.name, label: m.map_label || m.name, sub: m.sub, kind: m.kind, plant: m.plant, x: m.pos_x, y: m.pos_y, w: m.w, h: m.h, tracked: m.tracked, status: m.status, mold: m.mold,
          state: st, runnable: RUN_KINDS.indexOf(m.kind) >= 0,
          run: run ? { id: run.id, label: specLabel(run), type: run.type, size: run.size, neck: run.neck, shape: run.shape, color: run.color, started_at: run.started_at, crew: run.crew || "", job_id: run.job_id, version: run.version, legacy: run.status !== "กำลังผลิต" } : null,
          stop: s ? { id: s.id, reason: s.reason, started_at: s.started_at, version: s.version } : null,
          moldEv: md ? { id: md.id, stage: md.stage, mold_to: md.mold_to, started_at: md.started_at, work_at: md.work_at, version: md.version } : null,
          today: madeBy[m.id] || { good: 0, b: 0 }, stuck };
      });
      const prodM = list.filter(m => m.runnable);
      const counted = prodM.filter(m => m.tracked || m.state === "เดิน");   // ตัวหาร = เครื่องที่นับ (12) + เครื่องอื่นที่กำลังเดินจริง
      return {
        asOf: iso(X.now), today, layout: FLOOR, staleHours: staleH,
        summary: {
          running: counted.filter(m => m.state === "เดิน").length, total: counted.length,
          stopped: list.filter(m => m.state === "จอด").length, stale: list.filter(m => m.state === "ค้างปิด").length,
          mold: list.filter(m => m.state === "โมลด์").length, stuck: list.reduce((a, m) => a + m.stuck, 0),
          madeToday: list.reduce((a, m) => a + m.today.good, 0), jobsWaiting: (waitJobs[0].n || 0) + (waitItems[0].n || 0),
        },
        sweep, machines: list,
      };
    },
  });

  // ── รายละเอียดเครื่อง (แผ่นล่าง): ไทม์ไลน์วันนี้ · ยอดผลิต วัน/เดือน/ทั้งหมด · ข้อมูลเครื่อง ──
  R.define({
    name: "prod.machine", roles: READ,
    input: raw => ({ id: need(raw.id, "เครื่อง", 40), day: raw.day ? (isDay(String(raw.day)) ? String(raw.day) : (() => { throw bad("วันที่ไม่ถูกต้อง"); })()) : "" }),
    async run(X, input) {
      const day = input.day || thaiDay(X.now);
      const month = day.slice(0, 7);
      const dayStart = iso(atThai(day, 0, 0));
      const cut = iso(X.now - Number(X.settings.RUN_STALE_HOURS || 14) * 3600000);
      const id = input.id;
      const agg = cond => [`SELECT r.type, r.size, r.neck, r.shape, r.color, sum(r.good_pcs) AS good, sum(r.grade_b_pcs) AS b, sum(r.waste_pcs) AS waste, count(*) AS runs, max(ts.per_bag) AS per_bag
        FROM machine_runs r LEFT JOIN type_sizes ts ON ts.type = r.type AND ts.size = r.size WHERE r.machine_id = ? AND r.status = 'ปิดแล้ว' ${cond} GROUP BY r.type, r.size, r.neck, r.shape, r.color ORDER BY good DESC LIMIT 12`];
      const [m, runs, evs, aDay, aMonth, aAll, tot, top, rate, crew, notes, stuck, devs, molds, slots] = await X.db.reads([
        ["SELECT * FROM machines WHERE id = ?", id],
        [`SELECT r.*, ${CREW}, ts.per_bag FROM machine_runs r LEFT JOIN type_sizes ts ON ts.type = r.type AND ts.size = r.size
           WHERE r.machine_id = ? AND r.status <> 'ยกเลิก' AND (r.started_day = ? OR r.ended_day = ? OR (r.status IN ${OPEN_RUN} AND r.started_day <= ?)) ORDER BY r.started_at LIMIT 60`, id, day, day, day],
        ["SELECT e.*, s.nick AS by_nick FROM machine_events e LEFT JOIN staff s ON s.id = e.by WHERE e.machine_id = ? AND e.status = 'ใช้งาน' AND (e.started_day = ? OR e.ended_at = '' OR e.ended_at >= ?) ORDER BY e.started_at LIMIT 40", id, day, dayStart],
        [...agg(`AND ${DAYOF} = ?`), id, day],
        [...agg(`AND substr(${DAYOF}, 1, 7) = ?`), id, month],
        [...agg(""), id],
        [`SELECT count(*) AS runs, coalesce(sum(${HOURS}), 0) AS hours, min(r.started_day) AS first_day, coalesce(sum(r.good_pcs), 0) AS good, coalesce(sum(r.grade_b_pcs), 0) AS b, coalesce(sum(r.waste_pcs), 0) AS waste,
            sum(CASE WHEN r.time_issue <> '' THEN 1 ELSE 0 END) AS bad_time FROM machine_runs r WHERE r.machine_id = ? AND r.status = 'ปิดแล้ว'`, id],
        ["SELECT type, size, count(*) AS n FROM machine_runs WHERE machine_id = ? AND status IN ('ปิดแล้ว','กำลังผลิต','ค้างจากระบบเดิม') GROUP BY type, size ORDER BY n DESC LIMIT 3", id],
        [`SELECT r.type, r.size, sum(r.good_pcs) AS good, sum(${HOURS}) AS hours FROM machine_runs r WHERE r.machine_id = ? AND r.status = 'ปิดแล้ว' AND r.good_pcs > 0 AND r.time_issue = '' AND r.ended_at <> ''
           AND (julianday(r.ended_at) - julianday(r.started_at)) * 24 >= 0.5 GROUP BY r.type, r.size`, id],
        ["SELECT c.name_text, count(*) AS n FROM run_crew c JOIN machine_runs r ON r.id = c.run_id WHERE r.machine_id = ? AND c.status = 'ใช้งาน' AND r.status <> 'ยกเลิก' GROUP BY c.name_text ORDER BY n DESC LIMIT 3", id],
        ["SELECT started_day, note FROM machine_runs WHERE machine_id = ? AND note <> '' AND status <> 'ยกเลิก' ORDER BY started_at DESC LIMIT 3", id],
        [`SELECT r.*, ${CREW} FROM machine_runs r WHERE r.machine_id = ? AND (r.status = 'ค้างจากระบบเดิม' OR (r.status = 'กำลังผลิต' AND r.started_at < ?)) ORDER BY r.started_at LIMIT 30`, id, cut],
        ["SELECT d.id, d.kind, d.name, d.unit, (SELECT value FROM device_readings x WHERE x.device_id = d.id ORDER BY x.at DESC LIMIT 1) AS last, (SELECT at FROM device_readings x WHERE x.device_id = d.id ORDER BY x.at DESC LIMIT 1) AS last_at FROM devices d WHERE d.machine_id = ? AND d.status = 'ใช้งาน'", id],
        ["SELECT e.kind, e.stage, e.mold_from, e.mold_to, e.started_at, e.ended_at, e.reason FROM machine_events e WHERE e.machine_id = ? AND e.kind IN ('เปลี่ยนโมลด์','ซ่อม') AND e.status = 'ใช้งาน' ORDER BY e.started_at DESC LIMIT 5", id],
        ["SELECT id, name, map_label, plant FROM machines WHERE kind = ? AND tracked = 0 AND status = 'ใช้งาน' AND plant <> '' ORDER BY name", "ฉีด"],
      ]);
      const mm = m[0];
      if (!mm) throw notFound("ไม่พบเครื่องนี้");
      const t = tot[0];
      const rates = new Map(rate.map(r => [r.type + "|" + r.size, r]));
      const main = top[0] && rates.get(top[0].type + "|" + top[0].size);
      const all = t.good + t.b + t.waste;
      const out = r => r.map(x => ({ type: x.type, size: x.size, neck: x.neck, shape: x.shape, color: x.color, label: specLabel(x), good: x.good || 0, b: x.b || 0, waste: x.waste || 0, runs: x.runs, per_bag: x.per_bag || 0 }));
      return {
        asOf: iso(X.now), day, month,
        machine: { id: mm.id, name: mm.name, label: mm.map_label || mm.name, sub: mm.sub, kind: mm.kind, plant: mm.plant, makes: mm.makes, rating: mm.rating, mold: mm.mold, legacy_name: mm.legacy_name, note: mm.note,
          model: mm.model, bought: mm.bought, molds: mm.molds, capacity: mm.capacity, tracked: mm.tracked, status: mm.status, version: mm.version, runnable: RUN_KINDS.indexOf(mm.kind) >= 0, placed: !!mm.plant },
        runs: runs.map(runOut),
        events: evs.map(e => ({ id: e.id, kind: e.kind, reason: e.reason, stage: e.stage, mold_from: e.mold_from, mold_to: e.mold_to, started_at: e.started_at, work_at: e.work_at, ended_at: e.ended_at, detail: e.detail, by: e.by_nick || "", version: e.version })),
        totals: { day: out(aDay), month: out(aMonth), all: out(aAll) },
        info: {
          runs: t.runs, hours: Math.round(t.hours * 10) / 10, first_day: t.first_day || "", good: t.good, b: t.b, waste: t.waste, bad_time: t.bad_time || 0,
          b_rate: all ? t.b / all : null, waste_rate: all ? t.waste / all : null,
          top: top.map(x => ({ label: [x.type, x.size].filter(Boolean).join(" "), n: x.n })),
          per_hour: main && main.hours > 0 ? { label: [top[0].type, top[0].size].join(" "), pcs: Math.round(main.good / main.hours) } : null,
          crew: crew.map(c => c.name_text), notes,
          missing: [["model", "รุ่น/ยี่ห้อ"], ["bought", "ปีที่ซื้อ"], ["molds", "แม่พิมพ์ที่ใช้ได้"], ["capacity", "กำลังผลิตตามสเปก"]].filter(([k]) => !mm[k]).map(([, th]) => th).concat(molds.some(x => x.kind === "ซ่อม") ? [] : ["ประวัติซ่อม"]),
          molds: molds.filter(x => x.kind === "เปลี่ยนโมลด์"), repairs: molds.filter(x => x.kind === "ซ่อม"),
        },
        stuck: stuck.map(runOut),
        meters: devs.map(d => ({ id: d.id, kind: d.kind, name: d.name, unit: d.unit, last: d.last, last_at: d.last_at })),
        slots: mm.plant ? [] : slots.map(s => ({ id: s.id, name: s.map_label || s.name, plant: s.plant })),
      };
    },
  });

  // ── ตัวเลือกตอนเปิดรอบ: สเปกเรียงตามที่เครื่องนี้ทำบ่อย · สี · คน · งานรอผลิต ──
  R.define({
    name: "prod.specs", roles: ["prod", "exec"],
    input: raw => ({ machine: text(raw.machine, 40) }),
    async run(X, input) {
      const id = input.machine || "-";
      const [types, sizes, values, combos, colors, staff, names, mk] = await X.db.reads([
        [`SELECT code, axes, piece_unit, pos FROM product_types WHERE code IN (${PROD_TYPES.map(() => "?").join(",")}) ORDER BY pos`, ...PROD_TYPES],
        ["SELECT type, size, per_bag, pos FROM type_sizes WHERE active = 1 ORDER BY pos"],
        ["SELECT axis, value, grade, pos FROM spec_values WHERE axis IN ('คอขวด','รูปทรง','สี') ORDER BY axis, pos"],
        ["SELECT type, size, neck, shape, count(*) AS n, max(started_at) AS last FROM machine_runs WHERE machine_id = ? AND status IN ('ปิดแล้ว','กำลังผลิต','ค้างจากระบบเดิม') GROUP BY type, size, neck, shape ORDER BY n DESC LIMIT 12", id],
        ["SELECT color, count(*) AS n FROM machine_runs WHERE machine_id = ? AND status IN ('ปิดแล้ว','กำลังผลิต','ค้างจากระบบเดิม') AND color <> '' GROUP BY color ORDER BY n DESC LIMIT 12", id],
        ["SELECT s.id, s.nick FROM staff s JOIN staff_roles x ON x.staff_id = s.id AND x.active = 1 AND x.role = 'prod' WHERE s.status = 'ทำงาน' ORDER BY s.nick"],
        ["SELECT c.name_text, count(*) AS n, max(r.started_at) AS last FROM run_crew c JOIN machine_runs r ON r.id = c.run_id WHERE r.machine_id = ? AND c.status = 'ใช้งาน' GROUP BY c.name_text ORDER BY n DESC LIMIT 12", id],
        ["SELECT kind FROM machines WHERE id = ?", id],
      ]);
      const kind = mk[0] ? mk[0].kind : "";
      const freqType = {}, freqSize = {}, freqNeck = {}, freqShape = {};
      combos.forEach(c => { freqType[c.type] = (freqType[c.type] || 0) + c.n; freqSize[c.type + "|" + c.size] = (freqSize[c.type + "|" + c.size] || 0) + c.n; freqNeck[c.neck] = (freqNeck[c.neck] || 0) + c.n; freqShape[c.shape] = (freqShape[c.shape] || 0) + c.n; });
      const prefer = t => (kind === "ฉีด" ? (t === "พรีฟอร์ม" ? 1 : 0) : (t === "พรีฟอร์ม" ? 0 : 1));
      const tl = types.map(t => ({ code: t.code, axes: t.axes.split(","), unit: t.piece_unit })).sort((a, b) => (freqType[b.code] || 0) - (freqType[a.code] || 0) || prefer(b.code) - prefer(a.code));
      const bySize = {};
      sizes.forEach(s => { (bySize[s.type] = bySize[s.type] || []).push({ size: s.size, per_bag: s.per_bag }); });
      for (const k of Object.keys(bySize)) bySize[k].sort((a, b) => (freqSize[k + "|" + b.size] || 0) - (freqSize[k + "|" + a.size] || 0));
      const ax = { "คอขวด": [], "รูปทรง": [], "สี": [] };
      values.forEach(v => ax[v.axis].push({ value: v.value, grade: v.grade }));
      const cf = new Map(colors.map(c => [c.color, c.n]));
      ax["คอขวด"].sort((a, b) => (freqNeck[b.value] || 0) - (freqNeck[a.value] || 0));
      ax["รูปทรง"].sort((a, b) => (freqShape[b.value] || 0) - (freqShape[a.value] || 0));
      ax["สี"].sort((a, b) => (cf.get(b.value) || 0) - (cf.get(a.value) || 0));
      for (const c of colors) if (!ax["สี"].some(v => v.value === c.color)) ax["สี"].push({ value: c.color, grade: "A", seen: true });   // สีที่เคยพิมพ์เองในแอปเดิม
      const crewN = new Map(names.map(n => [n.name_text, n.n]));
      const people = staff.map(s => ({ nick: s.nick, id: s.id, n: crewN.get(s.nick) || 0 }));
      for (const n of names) if (!people.some(p => p.nick === n.name_text)) people.push({ nick: n.name_text, id: "", n: n.n });
      people.sort((a, b) => b.n - a.n || a.nick.localeCompare(b.nick, "th"));
      const jobs = (await loadJobs(X, { open: true })).filter(j => j.status !== "เสร็จ");
      return { asOf: iso(X.now), kind, types: tl, sizes: bySize, values: ax, combos: combos.slice(0, 6).map(c => ({ ...c, label: specLabel(c) })), people, jobs };
    },
  });

  // ── ประวัติ: รอบของวันที่เลือก · เหตุการณ์ · รอบค้างที่ต้องปิด ──
  R.define({
    name: "prod.history", roles: READ,
    input: raw => ({ day: raw.day ? (isDay(String(raw.day)) ? String(raw.day) : (() => { throw bad("วันที่ไม่ถูกต้อง"); })()) : "", machine: text(raw.machine, 40) }),
    async run(X, input) {
      const today = thaiDay(X.now), day = input.day || today;
      const cut = iso(X.now - Number(X.settings.RUN_STALE_HOURS || 14) * 3600000);
      const mf = input.machine ? " AND r.machine_id = ?" : "";
      const ma = input.machine ? [input.machine] : [];
      const [runs, evs, stuck, stuckN] = await X.db.reads([
        [`SELECT r.*, m.name AS machine_name, ${CREW}, ts.per_bag FROM machine_runs r JOIN machines m ON m.id = r.machine_id LEFT JOIN type_sizes ts ON ts.type = r.type AND ts.size = r.size
           WHERE r.status <> 'ยกเลิก' AND (r.started_day = ? OR r.ended_day = ?)${mf} ORDER BY m.plant, m.name, r.started_at LIMIT 300`, day, day, ...ma],
        [`SELECT e.*, m.name AS machine_name, s.nick AS by_nick FROM machine_events e JOIN machines m ON m.id = e.machine_id LEFT JOIN staff s ON s.id = e.by
           WHERE e.status = 'ใช้งาน' AND e.started_day = ?${input.machine ? " AND e.machine_id = ?" : ""} ORDER BY e.started_at LIMIT 200`, day, ...ma],
        [`SELECT r.*, m.name AS machine_name, ${CREW}, ts.per_bag FROM machine_runs r JOIN machines m ON m.id = r.machine_id LEFT JOIN type_sizes ts ON ts.type = r.type AND ts.size = r.size
           WHERE (r.status = 'ค้างจากระบบเดิม' OR (r.status = 'กำลังผลิต' AND r.started_at < ?))${mf} ORDER BY r.started_at DESC LIMIT 60`, cut, ...ma],
        [`SELECT count(*) AS n FROM machine_runs r WHERE (r.status = 'ค้างจากระบบเดิม' OR (r.status = 'กำลังผลิต' AND r.started_at < ?))${mf}`, cut, ...ma],
      ]);
      const closed = runs.filter(r => r.status === "ปิดแล้ว" && (r.ended_day || r.started_day) === day);
      const sum = k => closed.reduce((a, r) => a + (r[k] || 0), 0);
      return {
        asOf: iso(X.now), day, today, days: Array.from({ length: 14 }, (_, i) => addDays(today, -i)),
        totals: { good: sum("good_pcs"), b: sum("grade_b_pcs"), waste: sum("waste_pcs"), runs: closed.length, period: "รอบที่ปิดวันที่ " + day },
        runs: runs.map(runOut),
        events: evs.map(e => ({ id: e.id, machine_id: e.machine_id, machine: e.machine_name, kind: e.kind, reason: e.reason, stage: e.stage, mold_to: e.mold_to, started_at: e.started_at, ended_at: e.ended_at, by: e.by_nick || "", detail: e.detail })),
        stuck: stuck.map(runOut), stuckTotal: stuckN[0].n,
      };
    },
  });

  // ── รายละเอียดรอบเดียว ──
  R.define({
    name: "prod.run", roles: READ,
    input: raw => ({ id: need(raw.id, "รอบ", 40) }),
    async run(X, input) {
      const [r, crew, moves, ev, job] = await X.db.reads([
        ["SELECT r.*, m.name AS machine_name, ts.per_bag, (SELECT nick FROM staff WHERE id = r.opened_by) AS opened_nick, (SELECT nick FROM staff WHERE id = r.closed_by) AS closed_nick FROM machine_runs r JOIN machines m ON m.id = r.machine_id LEFT JOIN type_sizes ts ON ts.type = r.type AND ts.size = r.size WHERE r.id = ?", input.id],
        ["SELECT c.name_text, s.nick AS staff FROM run_crew c LEFT JOIN staff s ON s.id = c.staff_id WHERE c.run_id = ? AND c.status = 'ใช้งาน'", input.id],
        ["SELECT at, grade, qty_pcs, move_type, reason FROM stock_moves WHERE ref_entity = 'machine_runs' AND ref_id = ? ORDER BY id", input.id],
        ["SELECT kind, reason, started_at, ended_at FROM machine_events WHERE run_id = ? AND status = 'ใช้งาน' ORDER BY started_at", input.id],
        ["SELECT j.id, j.status, j.target_pcs, c.name AS customer, o.brand FROM production_jobs j JOIN machine_runs r ON r.job_id = j.id LEFT JOIN orders o ON o.id = j.order_id LEFT JOIN customers c ON c.id = o.customer_id WHERE r.id = ?", input.id],
      ]);
      if (!r[0]) throw notFound("ไม่พบรอบนี้");
      return { asOf: iso(X.now), run: { ...runOut({ ...r[0], crew: crew.map(c => c.name_text).join(" , ") }), hours: runHours(r[0]), opened_by: r[0].opened_nick || "", closed_by: r[0].closed_nick || "", stocked: r[0].stocked, src: r[0].src, chain_id: r[0].chain_id },
        moves, events: ev, job: job[0] || null };
    },
  });
}
