// ═══════════════════════════════════════════════════════════════════════
//  ออฟฟิศ — ข้อมูลที่หลายหน้าใช้ (จำไว้ในเครื่อง เปิดแล้วขึ้นทันที) + ตัวช่วยบันทึก                    v2/web/roles/office-data.js
//  · office.form / office.customers: โชว์ของรอบก่อนทันที แล้วดึงใหม่เบื้องหลัง (ไม่ต้องรอหลังบ้านทุกครั้งที่เปิดฟอร์ม)
//  · write(): ยืนยัน (ถ้ามี) → บันทึก → หลังบ้านขอเหตุผล = แผ่นชิปเหตุผลแล้วส่งซ้ำ → ถูกกัน = แผ่นบอกเหตุ + ทางทำต่อ → แถบ "ย้อน"
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { withReason } from "../parts/kit.js";
const { h, icon } = ui;

const mem = {};
/** ข้อมูลอ่านที่จำไว้: คืนของในเครื่องทันที (ถ้ามี) + onFresh(data) เมื่อของใหม่มา */
export async function cached(ctx, action, onFresh) {
  const ck = "office." + action;
  const have = mem[ck] || (ctx.api.viewCache.get(ck) || {}).data;
  const fresh = ctx.api.read(action).then(d => { mem[ck] = d; ctx.api.viewCache.set(ck, d); if (onFresh) onFresh(d); return d; });
  if (have) { fresh.catch(() => {}); return have; }
  return fresh;
}
export function forget(action) { delete mem["office." + action]; }

/** แผ่นบอกว่าทำไมบันทึกไม่ได้ (ข้อความจากหลังบ้านบอกเหตุ + ต้องทำอะไร) */
export function blockedSheet(message, title) {
  const S = ui.sheet({ title: title || "บันทึกไม่ได้", modal: true, foot: true });
  S.body.append(h("div.banner.t-warn", icon("lock"), h("span", message)));
  S.foot.append(h("button.btn.pri.block", { type: "button", onclick: () => S.close("ok") }, "เข้าใจแล้ว"));
  return S.done;
}

/**
 * write(ctx, action, input, { label, confirm, reasonKind, after(r) })
 *   คืนผล (r = { data, undo }) หรือ null (ยกเลิก/ไม่สำเร็จ — บอกผู้ใช้แล้ว)
 */
export async function write(ctx, action, input, o) {
  const opt = o || {};
  let reason = "";
  if (opt.confirm) {
    const c = await ui.confirmSheet(opt.confirm);
    if (!c) return null;
    reason = c.reason || "";
  }
  try {
    const r = await withReason(ctx, rs => ctx.api.write(action, input, { reason: rs || reason || undefined }), opt.reasonKind || "order_edit", opt.reasonTitle);
    if (!r) return null;
    if (r.undo) ui.undoBar(r.undo.label || opt.label || "บันทึกแล้ว", async () => { await ctx.api.write("undo.run", { id: r.undo.id }); if (opt.after) opt.after(null, true); });
    else ui.toast("บันทึกแล้ว" + (opt.label ? " · " + opt.label : ""));
    if (opt.after) opt.after(r);
    return r;
  } catch (e) {
    if (e.needLogin) { ui.toast(e.message, "bad"); setTimeout(() => location.reload(), 1500); return null; }
    if (e.status === 409 && (e.code === "locked" || e.code === "has_bill" || e.code === "already")) await blockedSheet(e.message);
    else if (e.status === 409) await blockedSheet(e.message, "มีคนแก้ไปก่อน");
    else ui.toast(e.message, "bad");
    return null;
  }
}

export const isWide = () => window.matchMedia("(min-width: 1100px)").matches;
