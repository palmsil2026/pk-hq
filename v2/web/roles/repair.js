// ═══════════════════════════════════════════════════════════════════════
//  จอดเครื่อง · ซ่อมเสร็จ/เดินต่อ · แชร์ลงไลน์ · หยุดบ่อยเพราะอะไร — ใช้ทั้งแอปทีมผลิต (เครื่องเป่า) และทีมสกรีน (S1–S8)      v2/web/roles/repair.js
//  สาเหตุ = บังคับ (ชุดเดิม) · ชิ้นส่วน = ชิปเสริม ไม่บังคับ · ซ่อมเสร็จ = คนกด (ทีมผลิตใส่ PIN) คือคนแก้
//  ข้อความแชร์ทำที่หลังบ้าน (result.share) — หน้าเว็บแค่เปิดแผ่นแชร์ของเครื่อง (ไม่มี = คัดลอก) ผ่าน shareText ของ kit
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { shareText, useCss } from "../parts/kit.js";
const { h, icon } = ui;
useCss("../roles/repair.css");
const OTHER = "อื่น ๆ (พิมพ์เอง)";
const clean = k => k.flat(9).filter(x => x !== null && x !== undefined && x !== false && x !== "");

/** ปุ่ม "แชร์ลงไลน์" (ข้อความสั้น ไม่มีรหัสระบบ) */
export function shareBtn(text, cls) {
  return h("button.btn" + (cls || ""), { type: "button", "aria-label": "แชร์ลงไลน์: " + text, onclick: () => shareText(text) }, icon("share", "sm"), "แชร์ลงไลน์");
}
/** เติมปุ่มแชร์ลงในแถบ "บันทึกแล้ว · ย้อน" ที่เพิ่งขึ้น (แตะได้ช่วงที่แถบยังอยู่ — ที่แผ่นเครื่อง/ประวัติก็มีปุ่มแชร์ให้กดทีหลัง) */
export function shareSnack(text) {
  if (!text) return;
  const bar = document.querySelector(".snack.on") || document.querySelector(".snack");
  if (!bar || bar.querySelector(".share")) return;
  bar.append(h("button.share", { type: "button", onclick: () => shareText(text) }, icon("share", "sm"), " แชร์ลงไลน์"));
}

/** กลุ่มชิปเลือกได้อันเดียว (กดซ้ำ = ยกเลิก) · other = มี "อื่น ๆ (พิมพ์เอง)" */
function chips(list, value, opt) {
  const o = opt || {};
  let v = value || "", typed = false;
  const input = h("input", { type: "text", maxlength: 60, placeholder: o.placeholder || "พิมพ์เอง", "aria-label": (o.label || "") + " (พิมพ์เอง)" });
  const box = h("div.field", { hidden: true }, input);
  const el = h("div.chips", { role: "group", "aria-label": o.label || "" });
  const all = [...list, ...(o.other ? [OTHER] : [])];
  if (v && list.indexOf(v) < 0 && o.other) { typed = true; input.value = v; box.hidden = false; }
  const draw = () => el.replaceChildren(...all.map(x => h("button.chip", { type: "button", "aria-pressed": String(x === OTHER ? typed : !typed && v === x),
    onclick: () => { if (x === OTHER) { typed = !typed; box.hidden = !typed; if (typed) input.focus(); } else { typed = false; box.hidden = true; v = v === x && !o.need ? "" : x; } draw(); if (o.onChange) o.onChange(); } }, x)));
  draw();
  return { el: h("div.stack", el, box), get value() { return typed ? input.value.trim() : v; } };
}

/**
 * แผ่นจอดเครื่อง: สาเหตุ (บังคับ) + ชิ้นส่วน (ถ้ารู้) → บันทึก → ปุ่มแชร์ลงไลน์ในแถบบันทึกแล้ว
 * o = { action, machine (id), name, reasonKind, partKind, after }
 */
export function stopSheet(ctx, o) {
  const sh = ui.sheet({ title: "จอด " + o.name, foot: true, modal: true });
  const msg = h("p.err", { role: "alert" });
  const reason = chips(ctx.reasons(o.reasonKind), "", { label: "สาเหตุ", other: true, need: true, onChange: () => { msg.textContent = ""; } });
  const part = chips(((ctx.vocab["part." + o.partKind]) || []).map(x => x.value), "", { label: "ชิ้นส่วน" });
  sh.body.append(...clean([h("p.muted", "ไฟเครื่องจะเป็นสีเหลืองจนกว่าจะกด \"ซ่อมเสร็จ · เดินต่อ\""),
    h("div.lbl", "สาเหตุ (ต้องเลือก)"), reason.el,
    h("div.lbl", "ชิ้นส่วนที่เป็นปัญหา (ถ้ารู้ · ไม่บังคับ)"), part.el, msg]));
  const ok = h("button.btn.pri.block", { type: "button" }, icon("pause", "sm"), "จอดเครื่อง");
  ok.addEventListener("click", () => ui.busy(ok, async () => {
    const why = reason.value;
    if (!why) { msg.textContent = "เลือกสาเหตุก่อน"; return; }
    let r = null;
    try { r = await ctx.save(o.action, { machine: o.machine, part: part.value }, { reason: why, label: "จอด " + o.name }); } catch (e) { return; }
    if (!r) return;
    sh.close(); shareSnack(r.data && r.data.share); if (o.after) o.after(r);
  }));
  sh.foot.append(ok);
  return sh;
}

/**
 * แผ่นซ่อมเสร็จ/เดินต่อ: จอดมานานเท่าไร + สาเหตุ · ชิ้นส่วน (แก้ได้ถ้าเพิ่งรู้ตอนซ่อม) · แก้อะไรไป (ไม่บังคับ)
 * o = { action, name, stop: {id, version, reason, part, started_at}, partKind, after }
 */
export function resumeSheet(ctx, o) {
  const s = o.stop;
  const sh = ui.sheet({ title: "ซ่อมเสร็จ · " + o.name, foot: true, modal: true });
  const part = chips(((ctx.vocab["part." + o.partKind]) || []).map(x => x.value), s.part || "", { label: "ชิ้นส่วน" });
  const note = h("input", { type: "text", maxlength: 300, placeholder: "เช่น เปลี่ยนสปริง ขันน็อตราง", "aria-label": "แก้อะไรไป" });
  sh.body.append(...clean([h("div.rp-warn", h("b", "จอดมา " + durWords(Date.now() - Date.parse(s.started_at))), h("span", "ตั้งแต่ " + ui.thTime(s.started_at) + " · " + (s.reason || "ไม่ระบุ"))),
    h("div.lbl", "แก้ที่ชิ้นไหน (ไม่บังคับ)"), part.el,
    h("div.field", h("label.lbl", "แก้อะไรไป (ไม่บังคับ)"), note),
    ctx.role === "prod" ? h("p.small.muted", "คนที่ใส่ PIN = คนที่แก้ (ประวัติเครื่องจดชื่อไว้)") : null]));
  const ok = h("button.btn.pri.block", { type: "button" }, icon("play", "sm"), "ซ่อมเสร็จ · เดินเครื่องต่อ");
  ok.addEventListener("click", () => ui.busy(ok, async () => {
    let r = null;
    try { r = await ctx.save(o.action, { event: s.id, version: s.version, part: part.value, note: note.value.trim() }, { label: "เดินเครื่องต่อ " + o.name }); } catch (e) { return; }
    if (!r) return;
    sh.close(); shareSnack(r.data && r.data.share); if (o.after) o.after(r);
  }));
  sh.foot.append(ok);
  return sh;
}

export function durWords(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + " นาที";
  const hh = Math.floor(m / 60);
  return hh < 24 ? hh + " ชม." + (m % 60 ? " " + (m % 60) + " นาที" : "") : Math.floor(hh / 24) + " วัน" + (hh % 24 ? " " + (hh % 24) + " ชม." : "");
}

/** ส่วน "หยุดบ่อยเพราะอะไร" — stats = { d7, d30, t7, t30 } จากหลังบ้าน (ครั้ง + ชั่วโมงต่อชิ้นส่วน) */
export function stopStats(stats, opt) {
  const o = opt || {};
  let range = "d7";
  const body = h("div");
  const seg = h("div.rp-seg", { role: "group", "aria-label": "ช่วงเวลา" }, [["d7", "7 วัน"], ["d30", "30 วัน"]].map(([k, t]) => h("button", { type: "button", dataset: { r: k }, onclick: () => { range = k; draw(); } }, t)));
  const draw = () => {
    seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.r === range)));
    const list = stats[range], tot = stats[range === "d7" ? "t7" : "t30"];
    const max = Math.max(0.1, ...list.map(x => x.hours));
    body.replaceChildren(list.length
      ? h("div.stack", h("p.small.muted", "จอดรวม " + tot.n + " ครั้ง · " + tot.hours + " ชม."),
        h("div.stopbars", list.map(x => h("div.stoprow", h("span.nm", x.part, x.part === "ไม่ระบุชิ้นส่วน" && x.reason ? h("small.muted", " (" + x.reason + ")") : null),
          h("span.bar", { "aria-hidden": "true" }, h("i", { style: { width: Math.max(4, Math.round(x.hours / max * 100)) + "%" } })),
          h("span.v", x.n + " ครั้ง · " + x.hours + " ชม.")))))
      : h("p.muted", "ไม่ได้จอดในช่วงนี้"));
  };
  draw();
  return h("section.rp-sec.stopstats", h("h3", o.title || "หยุดบ่อยเพราะอะไร", h("small", "นับเรื่องจอด · ชั่วโมงที่หยุดต่อชิ้นส่วน")), seg, body);
}

/** แถวเรื่องจอด/โมลด์ในประวัติ: เวลา · สาเหตุ/ชิ้นส่วน · ใครจอด/ใครแก้ · ปุ่มแชร์ */
export function eventRow(e) {
  const stop = e.kind === "จอดเครื่อง";
  const t = ui.thTime(e.started_at) + "–" + (e.ended_at ? ui.thTime(e.ended_at) : "ตอนนี้");
  const what = stop ? [e.reason || "ไม่ระบุ", e.part].filter(Boolean).join(" · ") : (e.mold_to ? "โมลด์ → " + e.mold_to : "เปลี่ยนโมลด์");
  const who = [e.by ? "จอดโดย " + e.by : "", e.fixed_by ? "แก้โดย " + e.fixed_by : "", stop && e.minutes !== null ? "หยุด " + durWords(e.minutes * 60000) : "", e.fix_note].filter(Boolean).join(" · ");
  return h("div.evrow", h("span.tm", icon(stop ? "pause" : "gear", "sm"), " " + t), h("span", h("b", what), who ? h("br") : null, who ? h("small.muted", who) : null),
    e.share ? h("button.iconbtn", { type: "button", "aria-label": "แชร์ลงไลน์: " + e.share, onclick: () => shareText(e.share) }, icon("share", "sm")) : null);
}
