// ═══════════════════════════════════════════════════════════════════════
//  ประธาน › ทีม — ชื่อสายส่งที่ทีมเรียก (แพร่ · วังชิ้น · เถิน · ลำพูน · แจ้ห่ม–เมืองปาน · เมือง) ↔ รหัสสายในทะเบียน        v2/web/roles/exec-routes.js
//  ค่าตั้งต้น = เดาจากอำเภอที่พบบ่อยในสายนั้น (ป้าย "รอยืนยันชื่อสาย" + ธง) → ถามหัวหน้าทีมสกรีนแล้วยืนยัน/แก้ที่นี่
//  ชื่อสายขึ้นคู่รหัสในหน้าเส้นทางส่งของ · ทะเบียนแก้จากจอ ไม่แก้โค้ด
// ═══════════════════════════════════════════════════════════════════════
export async function routeAreasBox(ctx, box) {
  const { h, ui, api } = ctx;
  let d;
  try { d = await api.read("route_area.list"); } catch (e) { box.append(ui.errorBox(e.message)); return; }
  const unnamed = d.rows.filter(r => !r.area && r.guess).length;
  if (unnamed) box.append(h("button.btn", { type: "button", onclick: e => ui.busy(e.currentTarget, () => ctx.save("route_area.guess", {}, { label: "เดาชื่อสายจากอำเภอ", after: () => ctx.refresh() }).catch(() => {})) },
    ctx.icon("route", "sm"), "เดาชื่อสายจากอำเภอ (" + unnamed + " สาย)"));
  for (const r of d.rows) {
    const a = r.area;
    box.append(h("button.card", { type: "button", onclick: () => {
      const sh = ui.sheet({ title: "สาย " + r.code, foot: true });
      const inp = h("input", { type: "text", maxlength: 60, value: a ? a.name : r.guess ? r.guess.name : "", "aria-label": "ชื่อสายที่ทีมเรียก" });
      sh.body.append(h("p.small.muted", "ชื่อที่หัวหน้าทีมสกรีนใช้ในปฏิทินสายส่ง" + (r.guess ? " · เดาจาก " + r.guess.from : "")), h("label.field", h("span.lbl", "ชื่อสาย"), inp), h("p.ref", "ลูกค้าในสาย " + r.customers + " ราย"));
      sh.foot.append(h("button.btn.pri.block", { type: "button", onclick: e => ui.busy(e.currentTarget, () => ctx.save("route_area.set", { code: r.code, name: inp.value.trim(), version: a ? a.version : undefined },
        { label: "สาย " + r.code + " = " + inp.value.trim(), after: () => { sh.close(); ctx.refresh(); } }).catch(() => {})) }, a && !a.confirmed ? "ยืนยันชื่อนี้" : "บันทึก"));
    } }, h("div.row", h("b", { style: { minWidth: "3.5em" } }, r.code), h("span.grow", a ? a.name : r.guess ? r.guess.name + " (เดา)" : "ยังไม่มีชื่อ"),
      a && a.confirmed ? ui.pill("ยืนยันแล้ว", "ok", "check") : ui.pill("รอยืนยันชื่อสาย", "warn", "flag"))));
  }
  if (!d.rows.length) box.append(ui.empty("ยังไม่มีสายในทะเบียน"));
}
