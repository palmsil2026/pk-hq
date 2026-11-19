// ═══════════════════════════════════════════════════════════════════════
//  ทีมผลิต — หน้าแรก = แผนผังโรงงาน (ไฟสถานะทุกเครื่อง · แตะเครื่อง = แผ่นล่างพร้อมปุ่มงาน)                v2/web/roles/prod.js
//   เมนู: แผนผัง · งานรอผลิต · สต๊อก · ประวัติ
//   ปุ่มงาน: เปิดรอบ · เปลี่ยนสี · จอดเครื่อง/เดินต่อ · เปลี่ยนโมลด์ · ปิดรอบ (ดี/เกรด B/เสีย ด้วยแป้นตัวเลขของแอป) · ปิดรอบค้างย้อนหลัง
//              งาน: เริ่มผลิตงานนี้ · ค้าง+สาเหตุ · ทำครบแล้ว · สต๊อก: รับเข้า · นับปรับ · ประวัติ: แก้ยอด · ผูกงาน
//   ไม่มีหน้าเข้าระบบทุกวัน — กดบันทึก = ถามใครบันทึก + PIN ทุกครั้ง (ctx.save ทำให้เอง) · ทุกปุ่มมีแถบ "ย้อน"
// ═══════════════════════════════════════════════════════════════════════
import { stopSheet, resumeSheet, shareBtn, shareSnack, eventRow } from "./repair.js";   // 0110 ชิ้นส่วน · ซ่อมเสร็จ · แชร์ลงไลน์
import * as ui from "../assets/ui.js";
import { floorView, ensureCss, STATE, swatch, bagsText, machineSections, runRow, durText, infoSheet, machineTile, put, add } from "./floor.js";
const { h, icon } = ui;
const fmt = ui.fmt;
const AX = [["size", "ขนาด"], ["neck", "คอขวด"], ["shape", "รูปทรง"], ["color", "สี"]];
const OTHER = "อื่น ๆ (พิมพ์เอง)";
let lastFloor = null, swept = 0;

// ── ชิ้นส่วนฟอร์ม ─────────────────────────────────────────────────────
/** กลุ่มชิป (เลือกหนึ่ง/หลายอัน) + "อื่น ๆ (พิมพ์เอง)" — value() คืนค่าที่เลือก */
function chipGroup(o) {
  const box = h("div.stack", { style: { gap: "6px" } });
  let picked = o.multi ? new Set(o.value || []) : (o.value || ""), otherOn = false;
  const input = h("input", { type: "text", maxlength: o.max || 60, placeholder: o.placeholder || "พิมพ์เอง", "aria-label": (o.label || "") + " (พิมพ์เอง)" });
  const field = h("div.field", { hidden: true }, input);
  const draw = () => {
    const items = (o.items || []).slice();
    if (!o.multi && picked && !items.some(i => i.value === picked)) items.unshift({ value: picked });
    if (o.multi) for (const v of picked) if (!items.some(i => i.value === v)) items.push({ value: v });
    const chips = items.map(it => h("button.chip", { type: "button", "aria-pressed": String(o.multi ? picked.has(it.value) : picked === it.value), onclick: () => {
      if (o.multi) { if (picked.has(it.value)) picked.delete(it.value); else picked.add(it.value); }
      else picked = picked === it.value && o.toggle ? "" : it.value;
      otherOn = false; field.hidden = true; draw(); if (o.onChange) o.onChange(value());
    } }, it.swatch ? swatch(it.value) : null, it.label || it.value, it.sub ? h("small", it.sub) : null));
    if (o.other !== false) chips.push(h("button.chip", { type: "button", "aria-pressed": String(otherOn), onclick: () => { otherOn = !otherOn; field.hidden = !otherOn; draw(); if (otherOn) input.focus(); } }, o.multi ? "เพิ่มชื่อ (พิมพ์เอง)" : OTHER));
    put(box, h("div.lbl", o.label, o.hint ? h("span.small.muted", " " + o.hint) : null), h("div.chips", { role: "group", "aria-label": o.label }, chips), field);
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
  input.addEventListener("change", () => commit());
  function commit() {
    const v = input.value.trim();
    if (!v) return;
    if (o.multi) picked.add(v); else picked = v;
    input.value = ""; otherOn = false; field.hidden = true; draw(); if (o.onChange) o.onChange(value());
  }
  const value = () => (o.multi ? [...picked] : picked);
  draw();
  return { el: box, value: () => { if (input.value.trim()) commit(); return value(); }, set(v) { picked = o.multi ? new Set(v) : v; draw(); }, redraw(items) { o.items = items; draw(); } };
}

/** ช่องนับ ดี / เกรด B / เสีย + แป้นตัวเลขของแอปในแผ่นเดียว */
function countPad(o) {
  const vals = Object.assign({ good: "", b: "0", waste: "0" }, o.values || {});
  let cur = "good";
  const F = [["good", "ดี (ใบ)"], ["b", "เกรด B (ใบ)"], ["waste", "เสีย (ใบ)"]];
  const row = h("div.cnt", { role: "group", "aria-label": "จำนวนที่ผลิตได้" });
  const note = h("p.cnt-note", { "aria-live": "polite" });
  const draw = () => {
    put(row, ...F.map(([k, l]) => h("button", { type: "button", "aria-pressed": String(cur === k), "aria-label": l + " " + (vals[k] === "" ? "ยังไม่ใส่" : vals[k]), onclick: () => { cur = k; fresh = true; draw(); } },
      h("span", l), h("b", vals[k] === "" ? "—" : fmt(Number(vals[k]))))));
    const g = Number(vals.good || 0);
    note.textContent = vals.good === "" ? "แตะช่องแล้วกดตัวเลข" : (o.perBag ? "ดี = " + bagsText(g, o.perBag) + " · " : "") + "รวม " + fmt(g + Number(vals.b || 0) + Number(vals.waste || 0)) + " ใบ";
    if (o.onChange) o.onChange(get());
  };
  let fresh = true;
  const pad = ui.numpad(k => {
    let v = vals[cur];
    if (k === "del") v = v.slice(0, -1);
    else if (k === "ok") { const i = F.findIndex(f => f[0] === cur); cur = F[(i + 1) % 3][0]; fresh = true; draw(); return; }
    else { if (fresh) v = ""; if (v.length < 7) v = (v === "0" ? "" : v) + k; }
    fresh = false;
    vals[cur] = v; draw();
  }, { ok: "ถัดไป", okAria: "ไปช่องถัดไป" });
  const get = () => ({ good: vals.good === "" ? null : Number(vals.good), b: Number(vals.b || 0), waste: Number(vals.waste || 0) });
  draw();
  return { el: h("div.stack", row, note, pad), get };
}

/** เวลาไทย (วัน + HHMM) → ISO */
const isoOf = (day, hhmm) => new Date(Date.parse(day + "T" + hhmm.slice(0, 2) + ":" + hhmm.slice(2, 4) + ":00+07:00")).toISOString();
const thaiToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const addDay = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function specKeyOf(sel, axes) {
  const n = v => String(v || "").replace(/\s+/g, " ").trim().replace(/\|/g, "/");
  return [n(sel.type), ...AX.map(([k, th]) => (axes.indexOf(th) >= 0 ? n(sel[k]) : ""))].join("|");
}
const specText = sel => [sel.type, sel.size, sel.neck, sel.shape, sel.color].filter(Boolean).join(" ");
const errBox = () => h("p.err", { role: "alert" });
async function guarded(btn, fn) { return ui.busy(btn, async () => { try { await fn(); } catch (e) { /* ctx.save แจ้งเองแล้ว */ } }); }

/** ตัวเลือกสเปก (ประเภท → ขนาด → คอขวด → รูปทรง → สี) เรียงตามที่เครื่องนี้ทำบ่อย */
function specPicker(sp, sel, onChange, opt) {
  const o = opt || {};
  const box = h("div.stack");
  const types = sp.types.filter(t => !o.types || o.types.indexOf(t.code) >= 0);
  if (!sel.type && types[0]) sel.type = types[0].code;
  const draw = () => {
    const t = types.find(x => x.code === sel.type) || types[0];
    const axes = t ? t.axes : [];
    const kids = [];
    if (sp.combos && sp.combos.length && !o.noCombos) {
      kids.push(chipGroup({ label: "ทำบ่อยที่เครื่องนี้", other: false, items: sp.combos.map(c => ({ value: [c.type, c.size, c.neck, c.shape].join("|"), label: [c.type === "ขวด" ? "" : c.type, c.size, c.neck, c.shape].filter(Boolean).join(" "), sub: c.n + " รอบ" })),
        value: [sel.type, sel.size, sel.neck, sel.shape].join("|"), onChange: v => { const [a, b, c, d] = v.split("|"); Object.assign(sel, { type: a, size: b, neck: c, shape: d }); draw(); onChange(); } }).el);
    }
    if (types.length > 1) kids.push(chipGroup({ label: "ประเภท", other: false, items: types.map(x => ({ value: x.code })), value: sel.type, onChange: v => { sel.type = v; sel.size = ""; sel.neck = ""; sel.shape = ""; draw(); onChange(); } }).el);
    kids.push(chipGroup({ label: "ขนาด", items: (sp.sizes[sel.type] || []).map(s => ({ value: s.size })), value: sel.size, onChange: v => { sel.size = v; onChange(); } }).el);
    if (axes.indexOf("คอขวด") >= 0) kids.push(chipGroup({ label: "คอขวด", items: sp.values["คอขวด"].map(v => ({ value: v.value })), value: sel.neck, toggle: true, onChange: v => { sel.neck = v; onChange(); } }).el);
    else sel.neck = "";
    if (axes.indexOf("รูปทรง") >= 0) kids.push(chipGroup({ label: "รูปทรง", items: sp.values["รูปทรง"].map(v => ({ value: v.value })), value: sel.shape, toggle: true, onChange: v => { sel.shape = v; onChange(); } }).el);
    else sel.shape = "";
    if (!o.noColor) kids.push(chipGroup({ label: "สี", items: sp.values["สี"].map(v => ({ value: v.value, swatch: true })), value: sel.color, onChange: v => { sel.color = v; onChange(); } }).el);
    put(box, ...kids);
  };
  draw();
  return { el: box, axes: () => ((types.find(x => x.code === sel.type) || {}).axes || []) };
}

// ── หน้า: แผนผัง ──────────────────────────────────────────────────────
function floorPage(ctx, view) {
  return floorView(ctx, view, {
    onMachine: m => (m.runnable ? machineSheet(ctx, m) : infoSheet(ctx, m)),
    afterRender: d => {
      lastFloor = d;
      if (d.sweep && Date.now() - swept > 10 * 60000) { swept = Date.now(); ctx.api.write("prod.sweep", {}).catch(() => { swept = 0; }); }   // ยกธงรอบค้าง (ไม่ต้องใส่ PIN)
    },
  });
}

// ── แผ่นเครื่อง: สถานะ + ปุ่มงาน + รายละเอียด ─────────────────────────────────
function machineSheet(ctx, m) {
  ensureCss();
  const [, word, tone, ic] = STATE[m.state] || STATE["ว่าง"];
  const sh = ui.sheet({ title: m.name, foot: true });
  const done = () => { sh.close(); ctx.refresh(); };
  const now = Date.now();
  const head = [h("div.row", ui.pill(word, tone, ic), m.plant ? h("span.muted.small", m.plant) : h("span.muted.small", "ยังไม่ได้วางในผัง"))];
  if (m.run) head.push(h("div.pf-now", h("div.spec", swatch(m.run.color), m.run.label),
    h("div.small.muted", "เริ่ม " + ui.thTime(m.run.started_at) + (ui.thDayOf(m.run.started_at) !== ui.thDay(thaiToday()) ? " (" + ui.thDayOf(m.run.started_at) + ")" : "") + " · เดินมา " + durText(now - Date.parse(m.run.started_at)) + " · " + (m.run.crew || "ไม่ระบุคน")),
    m.run.job_id ? h("div.small", icon("list", "sm"), " ผูกกับงานรอผลิต") : h("div.small.muted", "ผลิตเข้าสต๊อก"),
    m.run.legacy ? h("div.small", { style: { color: "var(--warn-ink)" } }, icon("alert", "sm"), " รอบนี้ลงในแอปเดิม — ปิดในแอปเดิมได้ ระบบจะตามเองรอบซิงก์ถัดไป") : null));
  if (m.stop) head.push(h("div.pf-warn", h("b", "จอดอยู่ · " + [m.stop.reason || "ไม่ระบุ", m.stop.part].filter(Boolean).join(" · ")), h("span", "ตั้งแต่ " + ui.thTime(m.stop.started_at) + " (" + durText(now - Date.parse(m.stop.started_at)) + ")"),
    m.stop.share ? shareBtn(m.stop.share) : null));
  if (m.moldEv) head.push(h("div.pf-warn", h("b", (m.moldEv.stage === "จะเปลี่ยน" ? "จะเปลี่ยนโมลด์" : "กำลังเปลี่ยนโมลด์") + (m.moldEv.mold_to ? " → " + m.moldEv.mold_to : "")), h("span", "แจ้งเมื่อ " + ui.thTime(m.moldEv.started_at))));
  if (m.state === "ค้างปิด") head.push(h("div.pf-warn", h("b", "เปิดรอบไว้นาน " + durText(now - Date.parse(m.run.started_at)) + " — ลืมกดปิดไหม"), h("span", "ปิดย้อนหลังได้ เลือกเวลาที่ปิดจริง + เหตุผล (ระบบขึ้นธงให้ประธานเห็น)")));
  add(sh.body, ...head);
  const detail = h("div.stack", ui.skeleton(2));
  const report = h("button.btn.ghost.block", { type: "button", onclick: () => ctx.save("flag.raise", { title: "แจ้งปัญหา " + m.name, kind: "อื่น ๆ", entity: "machines", entity_id: m.id }, { label: "แจ้งปัญหา " + m.name,
    confirm: { title: "แจ้งปัญหา " + m.name, detail: "ประธานจะเห็นเรื่องนี้ในหน้า \"เรื่องที่ต้องตัดสินใจ\"", reasons: ctx.reasons("machine_stop"), need: "required", okText: "แจ้งปัญหา" } }).catch(() => {}) }, icon("flag", "sm"), "แจ้งปัญหาเครื่องนี้ (ถึงประธาน)");
  add(sh.body, detail, report, h("p.ref", "รหัสอ้างอิง " + m.id));
  // ปุ่มงานตามสถานะ
  const B = (label, iconName, fn, pri) => h("button.btn" + (pri ? ".pri.block" : ""), { type: "button", onclick: fn }, icon(iconName, "sm"), label);
  const open = () => openRunSheet(ctx, m, {}, done);
  const close = late => closeRunSheet(ctx, m.run.id, { machine: m.name, late }, done);
  const color = () => colorSheet(ctx, m, done);
  // จอด = สาเหตุ (บังคับ) + ชิ้นส่วน (ไม่บังคับ) · เดินต่อ = ซ่อมเสร็จ (คนใส่ PIN = คนแก้) → ปุ่มแชร์ลงไลน์ในแถบบันทึกแล้ว
  const stop = () => stopSheet(ctx, { action: "run.stop", machine: m.id, name: m.name, reasonKind: "machine_stop", partKind: "machine", after: done });
  const resume = () => resumeSheet(ctx, { action: "run.resume", name: m.name, stop: m.stop, partKind: "machine", after: done });
  const mold = () => moldSheet(ctx, m, done);
  let pri = null, more = [];
  const legacyRun = m.run && m.run.legacy;
  if (m.state === "โมลด์") { pri = B("เปลี่ยนโมลด์เสร็จ", "check", mold, true); }
  else if (m.state === "จอด") { pri = m.run ? B("ซ่อมเสร็จ · เดินต่อ", "play", resume, true) : B("เปิดรอบ (เดินเครื่องต่อ)", "play", open, true); more = [m.run && !legacyRun ? B("ปิดรอบ", "stop", () => close(false)) : null, !m.run ? B("ซ่อมเสร็จ (ยังไม่เปิดรอบ)", "play", resume) : null, B("เปลี่ยนโมลด์", "gear", mold)]; }
  else if (m.state === "ค้างปิด") { pri = B("ปิดรอบย้อนหลัง", "stop", () => close(true), true); more = [legacyRun ? null : B("เปลี่ยนสี", "swap", color), B("จอดเครื่อง", "pause", stop)]; }
  else if (m.state === "เดิน" && legacyRun) { pri = B("เปิดรอบในแอปใหม่", "play", open, true); more = [B("ปิดรอบนี้", "stop", () => close(true)), B("จอดเครื่อง", "pause", stop)]; }
  else if (m.state === "เดิน") { pri = B("ปิดรอบ", "stop", () => close(false), true); more = [B("เปลี่ยนสี", "swap", color), B("จอดเครื่อง", "pause", stop), B("เปลี่ยนโมลด์", "gear", mold)]; }
  else { pri = B("เปิดรอบ", "play", open, true); more = [B("จอดเครื่อง", "pause", stop), B("เปลี่ยนโมลด์", "gear", mold)]; }
  if (m.moldEv && m.moldEv.stage === "จะเปลี่ยน" && m.state !== "โมลด์") more.push(B("เริ่มเปลี่ยนโมลด์", "gear", mold));
  add(sh.foot, h("div.pf-acts", pri, h("div.row2", more.filter(Boolean))));
  // รายละเอียด
  ctx.api.read("prod.machine", { id: m.id }).then(d => {
    const stuck = d.stuck.filter(r => !m.run || r.id !== m.run.id);
    put(detail, 
      stuck.length ? h("div.pf-warn", h("b", "รอบค้างไม่ได้ปิด " + stuck.length + " รอบ"), stuck.slice(0, 5).map(r => h("div.row", h("span.grow", ui.thDayOf(r.started_at) + " " + ui.thTime(r.started_at) + " · " + r.label + (r.legacy ? " (แอปเดิม)" : "")),
        h("button.btn", { type: "button", onclick: () => closeRunSheet(ctx, r.id, { machine: m.name, late: true }, done) }, "ปิดย้อนหลัง")))) : null,
      ...machineSections(ctx, d, { onRun: r => runSheet(ctx, r.id, done) }),
      ctx.role === "prod" && ctx.me && (ctx.me.roles || []).indexOf("exec") >= 0 && !d.machine.placed && d.slots.length ? placeBox(ctx, d, done) : null);
  }).catch(e => put(detail, ui.errorBox("โหลดรายละเอียดไม่สำเร็จ: " + e.message)));
  return sh;
}
/** ประธาน: วางเครื่องจากถาดลงช่อง K ในผัง */
function placeBox(ctx, d, done) {
  return h("div.pf-missing", h("b", "วางเครื่องนี้ในผัง (ประธาน)"), h("p.small", "เลือกช่องในผังที่เป็นเครื่องนี้ — ช่องเดิมจะถูกรวมเข้ามา ประวัติอยู่ครบ"),
    h("div.chips", d.slots.map(s => h("button.chip", { type: "button", onclick: () => ctx.save("machine.set", { id: d.machine.id, version: d.machine.version, take_slot: s.id }, { label: "วาง " + d.machine.name + " ที่ " + s.name, after: done,
      confirm: { title: "วาง " + d.machine.name + " ที่ " + s.name + "?", detail: s.name + " (" + s.plant + ") จะกลายเป็น " + d.machine.name + " ในผัง", okText: "วางที่นี่" } }).catch(() => {}) }, s.name))));
}

// ── เปิดรอบ ─────────────────────────────────────────────────────────────
async function openRunSheet(ctx, m, preset, done) {
  ensureCss();
  const sh = ui.sheet({ title: "เปิดรอบ · " + m.name, foot: true });
  add(sh.body, ui.skeleton(3));
  let sp;
  try { sp = await ctx.api.read("prod.specs", { machine: m.id }); }
  catch (e) { put(sh.body, ui.errorBox("โหลดตัวเลือกไม่สำเร็จ: " + e.message)); return; }
  const p = preset || {};
  const sel = { type: p.type || "", size: p.size || "", neck: p.neck || "", shape: p.shape || "", color: p.color || "" };
  if (!sel.type && sp.combos[0]) Object.assign(sel, { type: sp.combos[0].type, size: sp.combos[0].size, neck: sp.combos[0].neck, shape: sp.combos[0].shape });
  let job = p.job ? (p.job.job ? { job: p.job.job } : { item: p.job.item }) : null;
  const summary = h("p.pf-picked"), msg = errBox(), banner = h("div");
  const jobsBox = h("div");
  const drawSummary = () => { put(summary, swatch(sel.color), specText(sel) || "ยังไม่ได้เลือกสินค้า", h("br"), h("span.small.muted", (crew.value().join(" , ") || "ยังไม่ได้เลือกคน") + " · " + (job ? "ผูกกับงาน" : "ผลิตเข้าสต๊อก"))); };
  const drawJobs = () => {
    const key = specKeyOf(sel, picker.axes());
    const match = sp.jobs.filter(j => j.spec_key === key);
    if (job && !match.some(j => (job.job && j.job === job.job) || (job.item && !j.job && j.item === job.item))) job = null;
    const items = [{ value: "", label: "ผลิตเข้าสต๊อก" }, ...match.map(j => ({ value: j.job ? "job:" + j.job : "item:" + j.item, label: j.customer || "ไม่ระบุร้าน", sub: [bagsText(Math.max(0, j.target_pcs - j.made_pcs), j.per_bag), j.due_day ? "ส่ง " + ui.thDay(j.due_day) : ""].filter(Boolean).join(" · ") }))];
    const g = chipGroup({ label: "งาน", hint: match.length ? "มีงานรอผลิตสเปกนี้ " + match.length + " งาน" : sp.jobs.length ? "ยังไม่มีงานรอผลิตสเปกนี้" : "", other: false, items,
      value: job ? (job.job ? "job:" + job.job : "item:" + job.item) : "", onChange: v => { job = !v ? null : v.startsWith("job:") ? { job: v.slice(4) } : { item: v.slice(5) }; drawSummary(); } });
    put(jobsBox, g.el);
    drawSummary();
  };
  const picker = specPicker(sp, sel, () => { drawJobs(); });
  const crew = chipGroup({ label: "ผู้ปฏิบัติงาน", hint: "เลือกได้หลายคน", multi: true, items: sp.people.map(x => ({ value: x.nick })), value: p.crew || [], onChange: drawSummary, max: 40, placeholder: "พิมพ์ชื่อเล่นแล้วกด Enter" });
  const startChips = chipGroup({ label: "เริ่มเมื่อ", other: false, items: [["0", "ตอนนี้"], ["15", "15 นาทีที่แล้ว"], ["30", "30 นาทีที่แล้ว"], ["60", "1 ชม.ที่แล้ว"], ["120", "2 ชม.ที่แล้ว"]].map(([v, l]) => ({ value: v, label: l })), value: "0" });
  const note = h("input", { type: "text", maxlength: 300, placeholder: "หมายเหตุ (ถ้ามี)", "aria-label": "หมายเหตุ" });
  put(sh.body, h("div.pf-form", banner, picker.el, crew.el, jobsBox,
    h("details", h("summary.btn.ghost", "ตัวเลือกเพิ่มเติม (เวลาเริ่ม · หมายเหตุ)"), h("div.pf-form", startChips.el, h("div.field", note)))));
  drawJobs();
  const ok = h("button.btn.pri.block", { type: "button" }, icon("play", "sm"), "เปิดรอบ");
  add(sh.foot, summary, msg, ok);
  ok.addEventListener("click", () => guarded(ok, async () => {
    msg.textContent = "";
    const names = crew.value();
    if (!sel.type || !sel.size) { msg.textContent = "เลือกสินค้าและขนาดก่อน"; return; }
    if (!names.length) { msg.textContent = "เลือกผู้ปฏิบัติงานอย่างน้อย 1 คน"; return; }
    const back = Number(startChips.value() || 0);
    const input = { machine: m.id, ...sel, crew: names, note: note.value.trim(), ...(job || {}) };
    if (back) input.started_at = new Date(Date.now() - back * 60000).toISOString();
    try {
      const r = await ctx.save("run.open", input, { label: "เปิดรอบ " + m.name });
      if (r) { sh.close(); (done || ctx.refresh)(); }
    } catch (e) {
      const d = e.detail || {};
      if (d.open) put(banner, h("div.pf-warn", h("b", m.name + " มีรอบเปิดอยู่แล้ว"), h("span", d.open.label + " · เริ่ม " + ui.thTime(d.open.started_at) + (d.open.crew ? " · " + d.open.crew : "")),
        h("button.btn", { type: "button", onclick: () => { sh.close(); closeRunSheet(ctx, d.open.id, { machine: m.name }, done); } }, icon("stop", "sm"), "ไปปิดรอบนั้น")));
      else if (d.mold) put(banner, h("div.pf-warn", h("b", "กำลังเปลี่ยนโมลด์อยู่"), h("button.btn", { type: "button", onclick: () => { sh.close(); moldSheet(ctx, m, done); } }, "ไปกดเปลี่ยนโมลด์เสร็จ")));
      else msg.textContent = e.message;
      sh.body.scrollTop = 0;
      throw e;
    }
  }));
}

// ── ปิดรอบ (รวมปิดย้อนหลัง) ─────────────────────────────────────────────────
async function closeRunSheet(ctx, runId, opt, done) {
  ensureCss();
  const o = opt || {};
  const sh = ui.sheet({ title: "ปิดรอบ · " + (o.machine || ""), foot: true });
  sh.el.dataset.formDirty = "1";
  add(sh.body, ui.skeleton(2));
  let d;
  try { d = await ctx.api.read("prod.run", { id: runId }); } catch (e) { put(sh.body, ui.errorBox("โหลดรอบไม่สำเร็จ: " + e.message)); return; }
  const r = d.run;
  if (r.status !== "กำลังผลิต" && r.status !== "ค้างจากระบบเดิม") { put(sh.body, ui.empty("รอบนี้ปิดไปแล้ว", "โหลดใหม่เพื่อดูสถานะล่าสุด")); return; }
  const staleH = (lastFloor && lastFloor.staleHours) || 14;
  const late = o.late || r.status === "ค้างจากระบบเดิม" || Date.now() - Date.parse(r.started_at) > staleH * 3600000;
  const startDay = new Date(Date.parse(r.started_at) + 7 * 3600000).toISOString().slice(0, 10);
  let endDay = late ? startDay : thaiToday(), endHm = "";
  const msg = errBox();
  const ok = h("button.btn.pri.block", { type: "button" }, icon("stop", "sm"), "ปิดรอบ");
  const pad = countPad({ perBag: r.per_bag, onChange: c => put(ok, icon("stop", "sm"), c.good === null ? "ปิดรอบ" : "ปิดรอบ · ดี " + fmt(c.good) + " ใบ") });
  const waste = chipGroup({ label: "สาเหตุของเสีย (ถ้ามี)", items: ctx.reasons("waste").map(v => ({ value: v })), toggle: true });
  const lateWhy = chipGroup({ label: "ทำไมปิดย้อนหลัง (ต้องเลือก)", items: ctx.reasons("late_close").map(v => ({ value: v })) });
  const timeBtn = h("button.btn", { type: "button" });
  const drawTime = () => { put(timeBtn, icon("clock", "sm"), endHm ? "ปิดเวลา " + endHm.slice(0, 2) + ":" + endHm.slice(2) : "แตะเพื่อใส่เวลาปิดจริง"); };
  timeBtn.addEventListener("click", async () => {
    const v = await ui.numpadSheet({ title: "เวลาปิดจริง (ชั่วโมง นาที)", label: "เช่น 1630 = 16:30", maxLen: 4, okText: "ตกลง" });
    if (v === null) return;
    const s = String(v).padStart(4, "0");
    if (Number(s.slice(0, 2)) > 23 || Number(s.slice(2)) > 59) { msg.textContent = "เวลาไม่ถูกต้อง (" + s + ")"; return; }
    endHm = s; msg.textContent = ""; drawTime();
  });
  drawTime();
  const days = [...new Set([startDay, addDay(startDay, 1), thaiToday()])].filter(x => x <= thaiToday());
  const dayChips = chipGroup({ label: "วันที่ปิด", other: false, items: days.map(x => ({ value: x, label: ui.thDay(x) })), value: endDay, onChange: v => { endDay = v; } });
  const note = h("input", { type: "text", maxlength: 300, placeholder: "หมายเหตุ (ถ้ามี)", "aria-label": "หมายเหตุ" });
  const info = h("div.pf-now", h("div.spec", swatch(r.color), r.label), h("div.small.muted", "เริ่ม " + ui.thDayOf(r.started_at) + " " + ui.thTime(r.started_at) + " · " + (r.crew || "ไม่ระบุคน") + (r.legacy ? " · จากแอปเดิม (ไม่แตะสต๊อก)" : "")));
  const lateBox = h("div.pf-form", h("div.pf-warn", h("b", "ปิดย้อนหลัง"), h("span", "ใส่เวลาที่ปิดจริง ระบบจะขึ้นธงให้ประธานเห็น")), dayChips.el, timeBtn, lateWhy.el);
  const moreBox = h("details", h("summary.btn.ghost", "ตัวเลือกเพิ่มเติม (ปิดย้อนหลัง · หมายเหตุ)"), h("div.pf-form", late ? null : h("div.stack", h("p.small.muted", "ถ้าลืมกดตอนปิดจริง ใส่เวลาปิดตรงนี้"), dayChips.el, timeBtn), h("div.field", note)));
  put(sh.body, h("div.pf-form", info, pad.el, waste.el, late ? lateBox : null, moreBox));
  add(sh.foot, msg, ok);
  ok.addEventListener("click", () => guarded(ok, async () => {
    msg.textContent = "";
    const c = pad.get();
    if (c.good === null) { msg.textContent = "ใส่จำนวนดี (ใบ) ก่อน — ไม่ได้ผลิตเลยให้ใส่ 0"; return; }
    let ended_at;
    if (endHm) {
      ended_at = isoOf(endDay, endHm);
      if (ended_at < r.started_at) { msg.textContent = "เวลาปิดอยู่ก่อนเวลาเริ่ม (" + ui.thTime(r.started_at) + ")"; return; }
      if (Date.parse(ended_at) > Date.now() + 60000) { msg.textContent = "เวลาปิดอยู่ในอนาคต"; return; }
    } else if (late) { msg.textContent = "ใส่เวลาปิดจริงก่อน"; return; }
    let reason = late ? lateWhy.value() : "";
    if (late && !reason) { msg.textContent = "เลือกเหตุผลที่ปิดย้อนหลัง"; return; }
    if (c.good + c.b + c.waste === 0 && !note.value.trim() && !reason) {
      const z = await ui.confirmSheet({ title: "ยอดเป็น 0 ทั้งหมด", detail: "ดี 0 · เกรด B 0 · เสีย 0 — บอกเหตุผล", reasons: ["เปิดผิดเครื่อง", "เครื่องมีปัญหาทั้งรอบ"], need: "required", okText: "ปิดรอบ" });
      if (!z) return;
      reason = z.reason;
    } else if (c.waste > c.good && c.good > 0) {
      const z = await ui.confirmSheet({ title: "เสียมากกว่าดี — ถูกต้องไหม?", detail: "ดี " + fmt(c.good) + " ใบ · เสีย " + fmt(c.waste) + " ใบ", reasons: false, okText: "ถูกต้อง บันทึก" });
      if (!z) return;
    }
    const input = { run: r.id, version: r.version, good: c.good, b: c.b, waste: c.waste, waste_reason: c.waste ? waste.value() : "", note: note.value.trim() };
    if (ended_at) input.ended_at = ended_at;
    const res = await ctx.save("run.close", input, { reason, label: "ปิดรอบ " + (o.machine || "") + " · ดี " + fmt(c.good) + " ใบ" });
    if (res) { sh.close(); (done || ctx.refresh)(); }
  }));
}

// ── เปลี่ยนสี (ปิดช่วงสีเดิมพร้อมยอด + เปิดช่วงสีใหม่) ──────────────────────────────
async function colorSheet(ctx, m, done) {
  ensureCss();
  const sh = ui.sheet({ title: "เปลี่ยนสี · " + m.name, foot: true });
  sh.el.dataset.formDirty = "1";
  add(sh.body, ui.skeleton(2));
  let d, sp;
  try { [d, sp] = await Promise.all([ctx.api.read("prod.run", { id: m.run.id }), ctx.api.read("prod.specs", { machine: m.id })]); }
  catch (e) { put(sh.body, ui.errorBox("โหลดไม่สำเร็จ: " + e.message)); return; }
  const r = d.run;
  const msg = errBox();
  const color = chipGroup({ label: "สีใหม่", items: sp.values["สี"].filter(v => v.value !== r.color).map(v => ({ value: v.value, swatch: true })) });
  const pad = countPad({ perBag: r.per_bag });
  put(sh.body, h("div.pf-form", h("div.pf-now", h("div.spec", swatch(r.color), "ตอนนี้: " + r.label), h("div.small.muted", "เริ่ม " + ui.thTime(r.started_at) + " · " + (r.crew || ""))),
    color.el, h("div.lbl", "ยอดของสี" + (r.color || "เดิม") + " (ช่วงที่กำลังปิด)"), pad.el));
  const ok = h("button.btn.pri.block", { type: "button" }, icon("swap", "sm"), "เปลี่ยนสี");
  add(sh.foot, msg, ok);
  ok.addEventListener("click", () => guarded(ok, async () => {
    msg.textContent = "";
    const c = pad.get(), nc = color.value();
    if (!nc) { msg.textContent = "เลือกสีใหม่ก่อน"; return; }
    if (c.good === null) { msg.textContent = "ใส่จำนวนดีของสี" + (r.color || "เดิม") + " ก่อน (ไม่มีให้ใส่ 0)"; return; }
    const res = await ctx.save("run.color", { run: r.id, version: r.version, color: nc, good: c.good, b: c.b, waste: c.waste }, { label: "เปลี่ยนสี " + m.name + " " + (r.color || "") + " → " + nc });
    if (res) { sh.close(); (done || ctx.refresh)(); }
  }));
}

// ── เปลี่ยนโมลด์ (จะเปลี่ยน → กำลังเปลี่ยน → เสร็จ) ────────────────────────────────
function moldSheet(ctx, m, done) {
  ensureCss();
  const ev = m.moldEv;
  const sh = ui.sheet({ title: "เปลี่ยนโมลด์ · " + m.name, foot: true });
  const msg = errBox(), banner = h("div");
  const to = h("input", { type: "text", maxlength: 120, placeholder: "เช่น 600 ml เรียบ คอสั้น", "aria-label": "โมลด์ใหม่", value: ev ? ev.mold_to || "" : "" });
  add(sh.body, banner, h("div.pf-form",
    h("p", ev ? "ตอนนี้: " + (ev.stage === "จะเปลี่ยน" ? "แจ้งไว้ว่าจะเปลี่ยน" : "กำลังเปลี่ยน (เครื่องหยุด)") + " · แจ้งเมื่อ " + ui.thTime(ev.started_at) : "โมลด์ที่ติดอยู่: " + (m.mold || "ยังไม่ได้จดไว้")),
    h("div.field", h("label.lbl", "โมลด์ใหม่"), to),
    h("p.small.muted", "ขั้น: จะเปลี่ยน → กำลังเปลี่ยน (เครื่องหยุด ต้องปิดรอบก่อน) → เสร็จ (ระบบจำโมลด์ใหม่ของเครื่อง)")));
  const step = (stage, label, pri) => {
    const b = h("button.btn" + (pri ? ".pri.block" : ""), { type: "button" }, label);
    b.addEventListener("click", () => guarded(b, async () => {
      msg.textContent = "";
      try {
        const res = await ctx.save("mold.step", { machine: m.id, stage, event: ev ? ev.id : "", version: ev ? ev.version : "", mold_to: to.value.trim() }, { label: label + " · " + m.name,
          confirm: stage === "ยกเลิก" ? { title: "ยกเลิกการเปลี่ยนโมลด์?", reasons: false, okText: "ยกเลิกการเปลี่ยน" } : null });
        if (res) { sh.close(); (done || ctx.refresh)(); shareSnack(res.data && res.data.share); }
      } catch (e) {
        if (e.detail && e.detail.open) put(banner, h("div.pf-warn", h("b", "ต้องปิดรอบที่เดินอยู่ก่อน"), h("span", e.detail.open.label), h("button.btn", { type: "button", onclick: () => { sh.close(); closeRunSheet(ctx, e.detail.open.id, { machine: m.name }, done); } }, "ไปปิดรอบ")));
        throw e;
      }
    }));
    return b;
  };
  if (!ev) add(sh.foot, msg, h("div.pf-acts", step("กำลังเปลี่ยน", "เริ่มเปลี่ยนเลย", true), h("div.row2", step("จะเปลี่ยน", "แจ้งไว้ก่อนว่าจะเปลี่ยน"))));
  else if (ev.stage === "จะเปลี่ยน") add(sh.foot, msg, h("div.pf-acts", step("กำลังเปลี่ยน", "เริ่มเปลี่ยน", true), h("div.row2", step("เสร็จ", "เปลี่ยนเสร็จแล้ว"), step("ยกเลิก", "ยกเลิก"))));
  else add(sh.foot, msg, h("div.pf-acts", step("เสร็จ", "เปลี่ยนโมลด์เสร็จ", true), h("div.row2", step("ยกเลิก", "ยกเลิก"))));
}

// ── รายละเอียดรอบ (ประวัติ): แก้ยอด · ผูกงาน · ปิด ───────────────────────────────
async function runSheet(ctx, id, done) {
  ensureCss();
  const sh = ui.sheet({ title: "รายละเอียดรอบ", foot: true });
  add(sh.body, ui.skeleton(2));
  let d;
  try { d = await ctx.api.read("prod.run", { id }); } catch (e) { put(sh.body, ui.errorBox(e.message)); return; }
  const r = d.run;
  sh.title = r.machine + " · " + ui.thDayOf(r.started_at);
  const kv = [["สินค้า", h("span", swatch(r.color), r.label)], ["เวลา", ui.thDayOf(r.started_at) + " " + ui.thTime(r.started_at) + " – " + (r.ended_at ? ui.thDayOf(r.ended_at) + " " + ui.thTime(r.ended_at) : r.status === "ปิดแล้ว" ? "ไม่มีเวลาปิด" : "ยังเดินอยู่") + (r.hours ? " (" + durText(r.hours * 3600000) + ")" : "")],
    ["ผู้ปฏิบัติงาน", r.crew || "ไม่ระบุ"], ["สถานะ", ui.statusPill(ctx.vocab, "machine_runs.status", r.status)]];
  if (r.status === "ปิดแล้ว") kv.push(["ดี", bagsText(r.good, r.per_bag) + (r.per_bag ? " (" + fmt(r.good) + " ใบ)" : "")], ["เกรด B / เสีย", fmt(r.b || 0) + " / " + fmt(r.waste || 0) + (r.waste_reason ? " · " + r.waste_reason : "")]);
  if (d.job) kv.push(["งาน", (d.job.customer || "") + (d.job.brand ? " · " + d.job.brand : "") + " · " + d.job.status]);
  else kv.push(["งาน", "ผลิตเข้าสต๊อก"]);
  if (r.opened_by) kv.push(["เปิดโดย", r.opened_by]); if (r.closed_by) kv.push(["ปิดโดย", r.closed_by]);
  if (r.note) kv.push(["หมายเหตุ", r.note]);
  if (r.time_issue) kv.push(["เวลา", h("span", { style: { color: "var(--warn-ink)" } }, r.time_issue)]);
  put(sh.body, h("dl.pf-kv", kv.flatMap(([k, v]) => [h("dt", k), h("dd", v)])),
    d.moves.length ? h("div.stack", h("div.lbl", "ลงสต๊อก"), d.moves.map(x => h("p.small", ui.thDayOf(x.at) + " " + ui.thTime(x.at) + " · " + x.move_type + " " + (x.qty_pcs > 0 ? "+" : "") + fmt(x.qty_pcs) + " ใบ (เกรด " + x.grade + ")" + (x.reason ? " · " + x.reason : "")))) : (r.legacy ? h("p.small.muted", "รอบจากแอปเดิม — เป็นประวัติ ไม่แตะสต๊อก") : null),
    h("p.ref", "รหัสอ้างอิง " + r.id));
  const fin = () => { sh.close(); (done || ctx.refresh)(); };
  const acts = [];
  if (r.status === "กำลังผลิต" || r.status === "ค้างจากระบบเดิม") acts.push(h("button.btn.pri.block", { type: "button", onclick: () => { sh.close(); closeRunSheet(ctx, r.id, { machine: r.machine }, done); } }, icon("stop", "sm"), "ปิดรอบ"));
  if (r.status === "ปิดแล้ว") acts.push(h("button.btn", { type: "button", onclick: () => { sh.close(); fixSheet(ctx, r, fin); } }, icon("refresh", "sm"), "แก้ยอด"));
  if (r.status === "ปิดแล้ว" || r.status === "กำลังผลิต") acts.push(h("button.btn", { type: "button", onclick: () => { sh.close(); linkSheet(ctx, r, fin); } }, icon("list", "sm"), d.job ? "เปลี่ยนงานที่ผูก" : "ผูกกับงาน"));
  if (acts.length) add(sh.foot, h("div.pf-acts", acts.length > 1 ? h("div.row2", acts) : acts));
  else sh.foot.remove();
}
function fixSheet(ctx, r, done) {
  const sh = ui.sheet({ title: "แก้ยอดรอบ · " + r.machine, foot: true });
  sh.el.dataset.formDirty = "1";
  const pad = countPad({ perBag: r.per_bag, values: { good: String(r.good || 0), b: String(r.b || 0), waste: String(r.waste || 0) } });
  const msg = errBox();
  add(sh.body, h("div.pf-form", h("p.small.muted", "ยอดเดิม: ดี " + fmt(r.good || 0) + " · B " + fmt(r.b || 0) + " · เสีย " + fmt(r.waste || 0) + " — ส่วนต่างลงสต๊อกให้เอง"), pad.el));
  const ok = h("button.btn.pri.block", { type: "button" }, "บันทึกยอดใหม่");
  add(sh.foot, msg, ok);
  ok.addEventListener("click", () => guarded(ok, async () => {
    const c = pad.get();
    if (c.good === null) { msg.textContent = "ใส่จำนวนดีก่อน"; return; }
    const res = await ctx.save("run.fix", { run: r.id, version: r.version, good: c.good, b: c.b, waste: c.waste }, { label: "แก้ยอด " + r.machine,
      confirm: { title: "แก้ยอดรอบนี้?", detail: "ดี " + fmt(r.good || 0) + " → " + fmt(c.good) + " · B " + fmt(r.b || 0) + " → " + fmt(c.b) + " · เสีย " + fmt(r.waste || 0) + " → " + fmt(c.waste), reasons: ctx.reasons("run_fix"), need: "required", okText: "แก้ยอด" } });
    if (res) { sh.close(); done(); }
  }));
}
async function linkSheet(ctx, r, done) {
  const sh = ui.sheet({ title: "ผูกรอบกับงาน · " + r.machine });
  add(sh.body, ui.skeleton(2));
  let jobs;
  try { jobs = (await ctx.api.read("prod.jobs")).jobs.filter(j => j.status !== "เสร็จ"); } catch (e) { put(sh.body, ui.errorBox(e.message)); return; }
  const key = [r.type, r.size, r.neck, r.shape, r.color].join("|");
  const match = jobs.filter(j => j.spec_key === key);
  const go = (input, label) => ctx.save("run.link", { run: r.id, version: r.version, ...input }, { label }).then(x => { if (x) { sh.close(); done(); } }).catch(() => {});
  put(sh.body, h("p", swatch(r.color), r.label),
    match.length ? h("div.stack", match.map(j => h("button.card", { type: "button", onclick: () => go(j.job ? { job: j.job } : { item: j.item }, "ผูกกับงาน " + (j.customer || "")) },
      h("div.row", h("b.grow", j.customer || "ไม่ระบุร้าน"), j.due_day ? ui.pill("ส่ง " + ui.thDay(j.due_day), j.late ? "bad" : "mute", "calendar") : null),
      h("span.small.muted", "สั่ง " + bagsText(j.target_pcs, j.per_bag) + " · ทำแล้ว " + bagsText(j.made_pcs, j.per_bag))))) : ui.empty("ไม่มีงานรอผลิตสเปกนี้", "รอบนี้ผลิตเข้าสต๊อกได้ตามเดิม"),
    r.job_id ? h("button.btn.block", { type: "button", onclick: () => go({}, "ผลิตเข้าสต๊อก") }, "เลิกผูก (ผลิตเข้าสต๊อก)") : null);
}

// ── หน้า: งานรอผลิต ────────────────────────────────────────────────────
let jobFilter = "open";
function jobsPage(ctx, view) {
  ensureCss();
  return ctx.load(view, "jobs", "prod.jobs", (box, d) => {
    const today = d.today;
    const F = [["open", "ต้องทำ"], ["late", "ด่วน/เลยกำหนด"], ["doing", "กำลังทำ"], ["done", "ทำครบแล้ว"]];
    const pass = j => (jobFilter === "done" ? j.status === "เสร็จ" : j.status !== "เสร็จ" && (jobFilter === "open" || (jobFilter === "late" ? j.urgent || j.late || j.due_day === today : j.running.length || j.status === "กำลังผลิต")));
    const list = d.jobs.filter(pass);
    const n = k => d.jobs.filter(j => { const s = jobFilter; jobFilter = k; const r = pass(j); jobFilter = s; return r; }).length;
    const cards = h("div.stack.pf-cols");
    ui.renderList(cards, list, j => j.key, j => jobCard(ctx, j, today), ui.empty(jobFilter === "done" ? "ยังไม่มีงานที่ทำครบใน 3 วัน" : "ไม่มีงานค้าง", jobFilter === "done" ? "" : "งานจากออเดอร์ที่ต้องผลิตจะขึ้นที่นี่ เรียงตามวันส่ง"));
    put(box, h("div.chips", { role: "group", "aria-label": "กรองงาน" }, F.map(([k, l]) => h("button.chip", { type: "button", "aria-pressed": String(jobFilter === k), onclick: () => { jobFilter = k; ctx.refresh(); } }, l, h("small", String(n(k)))))), cards);
  });
}
function jobCard(ctx, j, today) {
  const due = !j.due_day ? ui.pill("ยังไม่กำหนดส่ง", "mute") : j.late ? ui.pill("เลยกำหนด " + ui.thDay(j.due_day), "bad", "alert") : j.due_day === today ? ui.pill("ส่งวันนี้", "warn") : ui.pill("ส่ง " + ui.thDay(j.due_day), "mute", "calendar");
  const pct = j.target_pcs ? Math.min(100, Math.round(j.made_pcs / j.target_pcs * 100)) : 0;
  return h("button.card", { type: "button", onclick: () => jobSheet(ctx, j) },
    h("div.row", h("span.name.grow", j.customer || "ผลิตเข้าสต๊อก"), j.urgent ? ui.pill("ด่วน", "bad", "bolt") : null),
    h("div.row", swatch(j.color), h("span", j.label), h("span.r", ui.qty("", j.per_bag ? Math.round(j.target_pcs / j.per_bag) : j.target_pcs, j.per_bag ? "ถุง" : "ใบ"))),
    h("div.pf-prog", { role: "img", "aria-label": "ทำแล้ว " + pct + "%" }, h("i", { style: { width: pct + "%" } })),
    h("div.row.small", h("span.grow.muted", "ทำแล้ว " + bagsText(j.made_pcs, j.per_bag) + (j.status === "เสร็จ" ? "" : " · เหลือ " + bagsText(Math.max(0, j.target_pcs - j.made_pcs), j.per_bag))),
      j.running.length ? ui.pill(j.running.join(", ") + " กำลังทำ", "ok", "play") : null),
    h("div.row", due, j.pending_reason ? ui.pill("ค้าง: " + j.pending_reason, "warn", "alert") : null, j.status === "เสร็จ" ? ui.pill("ทำครบแล้ว", "ok") : null, j.brand ? h("span.small.muted", "งาน " + j.brand) : null));
}
function jobSheet(ctx, j) {
  const sh = ui.sheet({ title: j.customer || "งานผลิต", foot: true });
  const fin = () => { sh.close(); ctx.refresh(); };
  const left = Math.max(0, j.target_pcs - j.made_pcs);
  add(sh.body, h("div.pf-now", h("div.spec", swatch(j.color), j.label), h("div.small.muted", "สั่ง " + bagsText(j.target_pcs, j.per_bag) + " · ทำแล้ว " + bagsText(j.made_pcs, j.per_bag) + (j.made_b ? " · เกรด B " + fmt(j.made_b) + " ใบ" : ""))),
    h("dl.pf-kv", [["ส่ง", j.due_day ? ui.thDay(j.due_day) : "ยังไม่กำหนด"], ["งาน/แบรนด์", j.brand || "—"], ["เครื่องที่กำลังทำ", j.running.length ? j.running.join(", ") : "ยังไม่มี"], ["ค้าง", j.pending_reason || "—"], ["หมายเหตุ", j.note || "—"]].flatMap(([k, v]) => [h("dt", k), h("dd", v)])),
    h("p.ref", "รหัสอ้างอิง " + (j.job || j.item)));
  if (j.status === "เสร็จ") { sh.foot.remove(); return; }
  const ref = j.job ? { job: j.job, version: j.version } : { item: j.item };
  const startBtn = h("button.btn.pri.block", { type: "button", onclick: () => { sh.close(); pickMachine(ctx, j); } }, icon("play", "sm"), "เริ่มผลิตงานนี้");
  const pend = h("button.btn", { type: "button", onclick: async () => {
    let bags = j.per_bag ? Math.ceil(left / j.per_bag) : null;
    const f = h("button.btn", { type: "button", onclick: async () => { const v = await ui.numpadSheet({ title: "ค้างกี่ถุง", value: bags, unit: "ถุง" }); if (v !== null) { bags = v; f.textContent = "ค้าง " + fmt(bags) + " ถุง (แตะเพื่อแก้)"; } } }, bags === null ? "ไม่ระบุจำนวนถุง" : "ค้าง " + fmt(bags) + " ถุง (แตะเพื่อแก้)");
    await ctx.save("job.pending", { ...ref, bags: j.per_bag ? bags : "" }, { label: "แจ้งค้าง · " + (j.customer || ""), after: fin,
      confirm: { title: "งานนี้ค้าง — เพราะอะไร?", detail: h("div.stack", h("p", j.label), j.per_bag ? f : null), reasons: ctx.reasons("pending"), need: "required", okText: "แจ้งค้าง" } }).catch(() => {});
  } }, icon("alert", "sm"), "ค้าง + สาเหตุ");
  const short = j.made_pcs < j.target_pcs;
  const doneBtn = h("button.btn", { type: "button", onclick: () => ctx.save("job.done", ref, { label: "ทำครบแล้ว · " + (j.customer || ""), after: fin,
    confirm: { title: "ทำงานนี้ครบแล้ว?", detail: "ทำได้ " + bagsText(j.made_pcs, j.per_bag) + " จาก " + bagsText(j.target_pcs, j.per_bag) + (short ? " — ยังไม่ครบ เลือกเหตุผล" : ""), reasons: short ? ctx.reasons("job_done") : false, need: short ? "required" : false, okText: "ทำครบแล้ว" } }).catch(() => {}) }, icon("check", "sm"), "ทำครบแล้ว");
  const clear = j.pending_reason ? h("button.btn", { type: "button", onclick: () => ctx.save("job.pending", { ...ref, clear: true }, { label: "เลิกค้าง", after: fin }).catch(() => {}) }, "เลิกค้าง") : null;
  add(sh.foot, h("div.pf-acts", startBtn, h("div.row2", pend, doneBtn, clear)));
}
async function pickMachine(ctx, j) {
  ensureCss();
  const sh = ui.sheet({ title: "เริ่มที่เครื่องไหน" });
  add(sh.body, h("p", swatch(j.color), j.label), ui.skeleton(2));
  let d;
  try { d = await ctx.api.read("prod.floor"); } catch (e) { put(sh.body, ui.errorBox(e.message)); return; }
  const kind = j.type === "พรีฟอร์ม" ? "ฉีด" : "เป่า";
  const free = d.machines.filter(m => m.runnable && m.kind === kind && (m.state === "ว่าง" || m.state === "จอด"));
  const busy = d.machines.filter(m => m.runnable && m.kind === kind && !(m.state === "ว่าง" || m.state === "จอด"));
  const pick = m => { sh.close(); openRunSheet(ctx, m, { ...j, job: j }, () => ctx.refresh()); };
  put(sh.body, h("p", swatch(j.color), j.label),
    free.length ? h("div.pf-tiles", free.map(m => machineTile(m, pick))) : ui.empty("ไม่มีเครื่องว่างตอนนี้", "ปิดรอบเครื่องที่เดินอยู่ก่อน หรือผูกงานจากหน้าประวัติภายหลัง"),
    busy.length ? h("details", h("summary.btn.ghost", "เครื่องที่ไม่ว่าง (" + busy.length + ")"), h("div.pf-tiles", busy.map(m => machineTile(m, x => { sh.close(); machineSheet(ctx, x); })))) : null);
}

// ── หน้า: สต๊อก ────────────────────────────────────────────────────────
let stockFilter = "";
function stockPage(ctx, view) {
  ensureCss();
  return ctx.load(view, "stock", "prod.stock", (box, d, st) => {
    const kinds = [...new Set(d.items.filter(x => x.kind === "spec").map(x => x.type))];
    const F = [["", "ทั้งหมด"], ...kinds.map(k => [k, k]), ["mat", "วัตถุดิบ"]];
    const list = d.items.filter(x => !stockFilter || (stockFilter === "mat" ? x.kind === "mat" : x.type === stockFilter));
    const cards = h("div.stack.pf-cols");
    ui.renderList(cards, list, x => x.key, x => stockRow(ctx, x), ui.empty("ยังไม่มีของในสต๊อก", "ปิดรอบผลิต หรือกด \"รับเข้า\" แล้วยอดจะขึ้นที่นี่"));
    const neg = d.items.filter(x => x.neg).length;
    put(box, 
      h("div.row", h("button.btn.pri", { type: "button", onclick: () => receiveSheet(ctx, d) }, icon("plus", "sm"), "รับเข้า (พรีฟอร์ม/วัตถุดิบ)"), neg ? ui.pill("ติดลบ " + neg + " รายการ", "bad", "alert") : null),
      h("p.small.muted", "เกรด A = ของดีพร้อมขาย · เกรด B แยกบัญชี ไม่บวกเข้าของดี · " + (st.fresh ? "ยอด ณ ตอนนี้" : "ข้อมูลเมื่อ " + ui.thTime(st.at))),
      h("div.chips", { role: "group", "aria-label": "กรอง" }, F.map(([k, l]) => h("button.chip", { type: "button", "aria-pressed": String(stockFilter === k), onclick: () => { stockFilter = k; ctx.refresh(); } }, l))),
      cards,
      h("details", h("summary.btn.ghost", "ความเคลื่อนไหวล่าสุด"), h("div.pf-runs", d.moves.map(m => h("div.r", h("span.tm", ui.thDayOf(m.at) + " " + ui.thTime(m.at)), h("span", m.label || m.item_key, h("br"), h("small.muted", [m.move_type, m.grade === "B" ? "เกรด B" : "", m.by_nick, m.reason].filter(Boolean).join(" · "))), h("span.q", (m.qty_pcs > 0 ? "+" : "") + fmt(m.qty_pcs)))))));
  });
}
function stockRow(ctx, x) {
  return h("button.card.pf-stock", { type: "button", onclick: () => stockSheet(ctx, x) },
    h("div.row", h("span.name.grow", x.kind === "spec" ? swatch(x.color) : null, x.label), x.neg ? ui.pill("ติดลบ", "bad", "alert") : null),
    h("div.row", h("span.q.grow", h("b", x.kind === "spec" && x.per_bag ? bagsText(x.a, x.per_bag, x.unit) : fmt(x.a) + " " + (x.unit || "")), x.kind === "spec" && x.per_bag ? h("span.small.muted", " (" + fmt(x.a) + " " + x.unit + ")") : null),
      x.b ? ui.pill("เกรด B " + fmt(x.b), "warn") : null));
}
function stockSheet(ctx, x) {
  const sh = ui.sheet({ title: x.label, foot: true });
  const fin = () => { sh.close(); ctx.refresh(); };
  add(sh.body, h("dl.pf-kv", [["เกรด A (ของดี)", fmt(x.a) + " " + (x.unit || "") + (x.per_bag ? " = " + bagsText(x.a, x.per_bag, x.unit) : "")], ["เกรด B", x.kind === "spec" ? fmt(x.b) + " " + (x.unit || "") : "—"], ["ขยับล่าสุด", x.at ? ui.thDayOf(x.at) + " " + ui.thTime(x.at) : "—"]].flatMap(([k, v]) => [h("dt", k), h("dd", v)])),
    x.neg ? h("div.pf-warn", h("b", "ยอดติดลบ"), h("span", "มีของออกมากกว่าที่ลงเข้า — ตรวจนับแล้วกด \"นับปรับ\" (ระบบขึ้นธงให้ประธานแล้ว)")) : null, h("p.ref", "รหัสอ้างอิง " + x.key));
  const count = g => async () => {
    const seen = g === "B" ? x.b : x.a;
    const v = await ui.numpadSheet({ title: "นับได้จริง (เกรด " + g + ")", label: x.label, unit: x.unit || "", okText: "ถัดไป" });
    if (v === null) return;
    await ctx.save("stock.count", { item_key: x.key, grade: g, counted: v, seen }, { label: "นับปรับ " + x.label, after: fin,
      confirm: { title: "นับปรับ " + x.label + (g === "B" ? " (เกรด B)" : ""), detail: "ในระบบ " + fmt(seen) + " → นับได้ " + fmt(v) + " (" + (v - seen >= 0 ? "+" : "") + fmt(v - seen) + ")", reasons: ctx.reasons("count"), need: "required", okText: "บันทึกยอดที่นับ" } }).catch(() => {});
  };
  add(sh.foot, h("div.row2", { class: "pf-acts" }, h("button.btn", { type: "button", onclick: count("A") }, "นับปรับเกรด A"), x.kind === "spec" ? h("button.btn", { type: "button", onclick: count("B") }, "นับปรับเกรด B") : null));
}
async function receiveSheet(ctx, stock) {
  ensureCss();
  const sh = ui.sheet({ title: "รับเข้าคลัง", foot: true });
  sh.el.dataset.formDirty = "1";
  add(sh.body, ui.skeleton(2));
  let sp;
  try { sp = await ctx.api.read("prod.specs", {}); } catch (e) { put(sh.body, ui.errorBox(e.message)); return; }
  let kind = "พรีฟอร์ม", qty = null;
  const sel = { type: "พรีฟอร์ม", size: "", neck: "", shape: "", color: "" };
  const msg = errBox();
  const area = h("div.stack");
  let mat = null, newUnit = null;
  const qtyBtn = h("button.btn", { type: "button" });
  const unitOf = () => (kind === "วัตถุดิบ" ? (mat && mat.unit) || (newUnit && newUnit.value()) || "" : (sp.types.find(t => t.code === sel.type) || {}).unit || "ชิ้น");
  const drawQty = () => { put(qtyBtn, icon("plus", "sm"), qty === null ? "แตะเพื่อใส่จำนวน" : "จำนวน " + fmt(qty) + " " + unitOf()); };
  qtyBtn.addEventListener("click", async () => { const v = await ui.numpadSheet({ title: "จำนวนที่รับเข้า", unit: unitOf(), value: qty }); if (v !== null) { qty = v; drawQty(); } });
  const drawArea = () => {
    if (kind === "วัตถุดิบ") {
      const g = chipGroup({ label: "วัตถุดิบ", items: stock.materials.map(m => ({ value: m.id, label: m.name, sub: m.unit })), placeholder: "ชื่อวัตถุดิบใหม่", onChange: v => { mat = stock.materials.find(m => m.id === v) || null; area.dataset.newName = mat ? "" : v; newBox.hidden = !!mat; drawQty(); } });
      newUnit = chipGroup({ label: "หน่วยของวัตถุดิบใหม่", items: ["กก.", "ชิ้น", "ม้วน", "ถุง", "กระสอบ"].map(v => ({ value: v })), onChange: drawQty });
      const newBox = h("div", { hidden: true }, newUnit.el);
      put(area, g.el, newBox);
    } else {
      sel.type = kind;
      put(area, specPicker(sp, sel, drawQty, { types: [kind], noCombos: true }).el);
    }
    drawQty();
  };
  const kinds = chipGroup({ label: "รับอะไรเข้า", other: false, items: ["พรีฟอร์ม", "วัตถุดิบ", "ขวด", "ถัง"].map(v => ({ value: v })), value: kind, onChange: v => { kind = v || "พรีฟอร์ม"; mat = null; drawArea(); } });
  const why = chipGroup({ label: "เหตุผล (ต้องเลือก)", items: ctx.reasons("receive").map(v => ({ value: v })) });
  const note = h("input", { type: "text", maxlength: 300, placeholder: "หมายเหตุ เช่น ซื้อจากใคร เลขบิล", "aria-label": "หมายเหตุ" });
  put(sh.body, h("div.pf-form", kinds.el, area, qtyBtn, why.el, h("div.field", note)));
  drawArea();
  const ok = h("button.btn.pri.block", { type: "button" }, icon("plus", "sm"), "รับเข้า");
  add(sh.foot, msg, ok);
  ok.addEventListener("click", () => guarded(ok, async () => {
    msg.textContent = "";
    const reason = why.value();
    if (!qty) { msg.textContent = "ใส่จำนวนก่อน"; return; }
    if (!reason) { msg.textContent = "เลือกเหตุผลก่อน"; return; }
    let input;
    if (kind === "วัตถุดิบ") {
      const nn = area.dataset.newName || "";
      if (!mat && !nn) { msg.textContent = "เลือกวัตถุดิบ หรือพิมพ์ชื่อใหม่"; return; }
      if (!mat && !newUnit.value()) { msg.textContent = "เลือกหน่วยของวัตถุดิบใหม่"; return; }
      input = mat ? { kind: "mat", material: mat.id, qty } : { kind: "mat", new_name: nn, new_unit: newUnit.value(), qty };
    } else {
      if (!sel.size) { msg.textContent = "เลือกขนาดก่อน"; return; }
      input = { kind: "spec", ...sel, qty };
    }
    input.note = note.value.trim();
    const res = await ctx.save("stock.receive", input, { reason, label: "รับเข้า " + fmt(qty) + " " + unitOf() });
    if (res) { sh.close(); ctx.refresh(); }
  }));
}

// ── หน้า: ประวัติ ──────────────────────────────────────────────────────
let histDay = "";
function historyPage(ctx, view) {
  ensureCss();
  return ctx.load(view, "hist:" + (histDay || "today"), "prod.history", (box, d) => {
    const fin = () => ctx.refresh();
    const byM = new Map();
    d.runs.forEach(r => { if (!byM.has(r.machine)) byM.set(r.machine, { runs: [], evs: [] }); byM.get(r.machine).runs.push(r); });
    d.events.forEach(e => { if (!byM.has(e.machine)) byM.set(e.machine, { runs: [], evs: [] }); byM.get(e.machine).evs.push(e); });
    const T = d.totals;
    put(box, 
      h("div.pf-days", { role: "group", "aria-label": "เลือกวัน" }, d.days.map((x, i) => h("button.chip", { type: "button", "aria-pressed": String(x === d.day), onclick: () => { histDay = x === d.today ? "" : x; ctx.refresh(); } }, i === 0 ? "วันนี้" : i === 1 ? "เมื่อวาน" : ui.thDay(x)))),
      d.stuckTotal ? h("section.pf-warn", { "aria-label": "รอบค้าง" }, h("b", "รอบค้างที่ต้องปิด " + d.stuckTotal + " รอบ"), h("span.small", "ปิดย้อนหลัง: ใส่เวลาปิดจริง + เหตุผล (รอบจากแอปเดิมไม่แตะสต๊อก)"),
        d.stuck.slice(0, 20).map(r => h("div.row", h("span.grow", h("b", r.machine), " · " + ui.thDayOf(r.started_at) + " " + ui.thTime(r.started_at) + " · " + r.label + (r.legacy ? " (แอปเดิม)" : "")),
          h("button.btn", { type: "button", onclick: () => closeRunSheet(ctx, r.id, { machine: r.machine, late: true }, fin) }, "ปิดย้อนหลัง")))) : null,
      h("div.card", h("div.row", h("span.big.md", fmt(T.good)), h("span.muted", "ใบดี · " + T.runs + " รอบที่ปิดวันที่ " + ui.thDay(d.day))), h("span.small.muted", "เกรด B " + fmt(T.b) + " · เสีย " + fmt(T.waste))),
      byM.size ? h("div.stack.pf-cols", [...byM.entries()].map(([name, g]) => h("section.card.pf-sec", h("h3", name, h("small", g.runs.length + " รอบ")),
        h("div.pf-runs", g.runs.map(r => runRow(r, x => runSheet(ctx, x.id, fin)))),
        g.evs.length ? h("div.stack", g.evs.map(eventRow)) : null))) : ui.empty("ไม่มีรอบในวันนี้", "เลือกวันอื่นด้านบน"));
  }, histDay ? { day: histDay } : {});
}

export default {
  code: "prod", title: "ทีมผลิต",
  nav: [
    { key: "floor", label: "แผนผัง", icon: "map", title: "แผนผังโรงงาน" },
    { key: "jobs", label: "งานรอผลิต", icon: "list" },
    { key: "stock", label: "สต๊อก", icon: "box" },
    { key: "history", label: "ประวัติ", icon: "clock" },
  ],
  views: { floor: floorPage, jobs: jobsPage, stock: stockPage, history: historyPage },
};
export { machineSheet, closeRunSheet, openRunSheet };
