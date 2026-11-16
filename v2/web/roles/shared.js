// ของที่หลายบทบาทใช้ร่วม: แผนผังโรงงาน (ทีมผลิต + ประธาน) · แถวออเดอร์ · รายละเอียดออเดอร์ · ปุ่มที่ยังไม่เปิด
import * as ui from "../assets/ui.js";
const { h, icon } = ui;

const STATE = { "เดิน": ["s-run", "เดินอยู่", "ok"], "ค้างปิด": ["s-stale", "ค้างไม่ได้ปิด", "warn"], "จอด": ["s-stop", "จอดเครื่อง", "warn"], "ว่าง": ["", "ว่าง", "mute"] };
const MAIN_KINDS = ["เป่า", "ฉีด", "สกรีน"];

/** ปุ่มงานที่หน้าโมดูลจะเปิดใช้ — เห็นตำแหน่งปุ่มแล้ว แต่ยังกดบันทึกไม่ได้ (ไม่หลอกว่าบันทึก) */
export function soonBtn(label, iconName, cls) {
  return h("button.btn" + (cls || ""), { type: "button", "aria-disabled": "true", title: "ยังเปิดใช้ไม่ได้ในรุ่นนี้", onclick: () => ui.toast("ปุ่ม \"" + label + "\" ยังเปิดใช้ไม่ได้ในรุ่นนี้ — ใช้แอปเดิมไปก่อน", "warn") }, iconName ? icon(iconName, "sm") : null, label);
}

export function floorView(ctx, view, opt) {
  return ctx.load(view, "floor", "home.prod", (box, d, st) => {
    if (!box.dataset.built) {
      box.dataset.built = "1";
      box.append(h("div.card.sum"), h("div.legend", { "aria-label": "ความหมายของไฟ" },
        h("span", h("span.mc.s-run", { style: { minHeight: "0", padding: "0", border: "0", background: "none" } }, h("span.lamp")), "เดินอยู่"),
        h("span", h("span.mc.s-stop", { style: { minHeight: "0", padding: "0", border: "0", background: "none" } }, h("span.lamp")), "จอดเครื่อง"),
        h("span", icon("flag", "sm"), "ค้างไม่ได้ปิด"),
        h("span", h("span.mc", { style: { minHeight: "0", padding: "0", border: "0", background: "none" } }, h("span.lamp")), "ว่าง")), h("div.plants.stack"), h("details.other", h("summary.btn.ghost", "ระบบลม · น้ำเย็น · ไฟฟ้า · อื่น ๆ"), h("div.plants2.stack")));
    }
    box.querySelector(".sum").replaceChildren(h("div.row",
      h("span.big", { style: { color: "var(--ok)" } }, ui.fmt(d.running)), h("span.muted", "/ " + ui.fmt(d.total) + " เครื่องเดินอยู่"),
      d.stale ? h("span.r", ui.pill("ค้างไม่ได้ปิด " + d.stale, "warn", "flag")) : null), st.fresh ? "" : ui.stamp(st.at, st.updating));
    const draw = (sel, list) => {
      const plants = {};
      list.forEach(m => { (plants[m.plant || "ยังไม่ระบุโรง"] = plants[m.plant || "ยังไม่ระบุโรง"] || []).push(m); });
      const box2 = box.querySelector(sel);
      const order = Object.keys(plants).sort((a, b) => (a === "ยังไม่ระบุโรง") - (b === "ยังไม่ระบุโรง") || a.localeCompare(b, "th"));
      box2.replaceChildren(...order.map(p => h("section.plant", { "aria-label": p }, h("div.lbl", p),
        h("div.floor", { style: { "--cols": window.innerWidth >= 1100 ? 6 : window.innerWidth < 360 ? 2 : 3 } }, plants[p].map(m => machineTile(ctx, m, opt))))));
    };
    draw(".plants", d.machines.filter(m => MAIN_KINDS.includes(m.kind)));
    draw(".plants2", d.machines.filter(m => !MAIN_KINDS.includes(m.kind)));
  });
}
function machineTile(ctx, m, opt) {
  const [cls, word] = STATE[m.state] || STATE["ว่าง"];
  const sub = m.run ? [m.run.size, m.run.color].filter(Boolean).join(" ") : m.state === "จอด" ? (m.stop.reason || "จอด") : m.kind;
  return h("button.mc" + (cls ? "." + cls : ""), { type: "button", "aria-label": m.name + " · " + word + (sub ? " · " + sub : ""), onclick: () => machineSheet(ctx, m, opt) },
    h("span.lamp", { "aria-hidden": "true" }), h("span.t", m.name, h("small", sub)), m.state === "ค้างปิด" ? h("span.flagdot", icon("flag", "sm")) : null);
}
function machineSheet(ctx, m, opt) {
  const [, word, tone] = STATE[m.state] || STATE["ว่าง"];
  const sh = ui.sheet({ title: m.name, foot: true });
  sh.body.append(h("div.row", ui.pill(word, tone, m.state === "ค้างปิด" ? "flag" : null), m.run ? h("span.muted", "เดินมา " + ui.since(m.run.started_at) + " (เริ่ม " + ui.thTime(m.run.started_at) + ")") : null));
  if (m.run) sh.body.append(h("div.row", ui.qty([m.run.size, m.run.neck, m.run.shape].filter(Boolean).join(" ") || m.run.type, m.run.color || "—")));
  if (m.stop) sh.body.append(h("p", "จอดเพราะ: " + (m.stop.reason || "ไม่ระบุ") + " · ตั้งแต่ " + ui.thTime(m.stop.started_at)));
  if (m.makes) sh.body.append(h("div", h("div.lbl", "ทำอะไรได้ (ที่จดไว้)"), h("p", m.makes)));
  sh.body.append(h("p.ref", "รหัสอ้างอิง " + m.id + " · " + (m.plant || "ยังไม่ระบุโรง") + " · " + m.kind));
  const btns = m.run
    ? [soonBtn("เปลี่ยนสี", "swap"), soonBtn("จอดเครื่อง", "pause"), soonBtn("ปิดรอบ", "stop", ".pri")]
    : [soonBtn("เปิดรอบ", "play", ".pri")];
  sh.foot.append(h("div.btns", btns), h("button.btn.ghost.block", { type: "button", style: { marginTop: "8px" }, onclick: async () => {
    sh.close();
    await ctx.save("flag.raise", { title: "แจ้งปัญหา " + m.name, kind: "อื่น ๆ", entity: "machines", entity_id: m.id }, {
      label: "แจ้งปัญหา " + m.name,
      confirm: { title: "แจ้งปัญหา " + m.name, detail: "ประธานจะเห็นเรื่องนี้ในหน้า \"เรื่องที่ต้องตัดสินใจ\"", reasons: ctx.reasons("machine_stop"), need: "required", okText: "แจ้งปัญหา" },
    }).catch(() => {});
  } }, icon("flag", "sm"), "แจ้งปัญหาเครื่องนี้"));
}

/** แถวออเดอร์: ชื่อร้าน + สาย · รายการเป็นป้าย (สูงสุด 3 + "อีก n") · วันส่ง/ด่วน/สถานะ — ไม่โชว์ยอดเงิน */
export function orderRow(ctx, o, onOpen, today) {
  const items = o.items || [];
  const due = !o.due_day ? ui.pill("ยังไม่กำหนดส่ง", "mute") : o.late ? ui.pill("เลยกำหนด " + ui.thDay(o.due_day), "bad", "alert") : o.due_day === today ? ui.pill("ส่งวันนี้", "warn") : ui.pill("ส่ง " + ui.thDay(o.due_day), "mute", "calendar");
  return h("button.card", { type: "button", onclick: () => onOpen(o) },
    h("div.row", h("span.name.grow", o.customer), o.urgent ? ui.pill("ด่วน", "bad", "bolt") : null),
    h("div.row.small.muted", [o.route_code ? "สาย " + o.route_code : "", o.district, o.brand ? "งาน " + o.brand : ""].filter(Boolean).join(" · ")),
    h("div.items", items.slice(0, 3).map(ui.itemQty), items.length > 3 ? h("span.muted.small", "อีก " + (items.length - 3) + " รายการ") : null),
    h("div.row", due, ui.statusPill(ctx.vocab, "orders.status", o.status)));
}
export function orderSheet(ctx, o) {
  const sh = ui.sheet({ title: o.customer });
  sh.body.append(h("div.row", ui.statusPill(ctx.vocab, "orders.status", o.status), o.urgent ? ui.pill("ด่วน", "bad", "bolt") : null, o.pay_status ? ui.statusPill(ctx.vocab, "orders.pay_status", o.pay_status) : null),
    h("div.stack", (o.items || []).map(it => h("div.card", h("div.row", h("b", it.label || it.type), h("span.r", ui.itemQty(it))),
      it.screen_color ? h("span.small.muted", "สกรีน " + it.screen_color) : null))),
    h("div.kv", h("div", h("div.lbl", "สั่งเมื่อ"), ui.thDay(o.order_day)), h("div", h("div.lbl", "กำหนดส่ง"), o.due_day ? ui.thDay(o.due_day) : "ยังไม่กำหนด"), o.brand ? h("div", h("div.lbl", "งาน/แบรนด์"), o.brand) : null),
    h("p.ref", "รหัสอ้างอิง " + o.id));
  return sh;
}
