// ============================================================
//  ทีม (ประธาน): รายชื่อพนักงาน · ตั้ง/รีเซ็ต PIN · พักงาน/เปิดงาน · เปลี่ยนแผนก · เพิ่มคน · ยืนยันคนใหม่    v2/server/actions/exec-staff.mjs
//
//  PIN ห้ามขึ้น Cloudflare → การแก้ทะเบียนทำที่ Google (gas/Code.gs › pkV2Staff) โดยหน้าเว็บส่งตรงไป GAS:
//    หน้าเว็บ ──(ตั๋วประธาน + PIN ใหม่)──► GAS: ตรวจตั๋วเอง + แผนกในชีตต้องเป็น "บริหาร" → เขียนชีต Staff + ActivityLog → "ใบรับ" ลงชื่อ
//    หน้าเว็บ ──(ใบรับ)──► exec.staff_apply (ที่นี่): ตรวจลายเซ็น (PK_SYNC_KEY) · ใบรับต้องเป็นของคนที่ส่ง · ไม่เก่าเกิน 15 นาที
//                         → ขยับ D1 ทันที (พักงาน = ตั๋วตาย · PIN ใหม่ = ตั๋วเก่าตาย) + audit
//  ใบรับมีแค่ลายนิ้วมือ PIN (ถอดกลับไม่ได้) · ใบรับปลอม/ถูกแก้ = ลายเซ็นไม่ตรง · ใบรับเดิมส่งซ้ำ = ไม่เปลี่ยนอะไร
//  กันแอบเพิ่มคนผ่านชีต: คนที่เข้ารายชื่อโดยไม่ผ่านประธาน (นำเข้าจากชีต / ตั๋วจากชีต) ขึ้นเป็น "เรื่องที่ต้องตัดสินใจ" จนกว่าประธานยืนยัน
// ============================================================
import { Fail, bad, denied, notFound, need, iso, sameText } from "../core.mjs";
import { hmacB64u } from "../ticket.mjs";
import { rolesOfDept } from "../import/importers.mjs";

const EXEC = ["exec"];
const RECEIPT_MAX_AGE_MS = 15 * 60000;

export function defineExecStaff(R) {
  R.define({
    name: "exec.staff_list", roles: EXEC,
    async run(X) {
      const [rows, last, imp] = await X.db.reads([
        [`SELECT s.id, s.name, s.nick, s.dept_th, s.status, s.src, s.exec_ok_at, s.created_at, s.updated_at, s.version, (s.pin_fp <> '') AS has_pin, group_concat(r.role) AS roles
           FROM staff s LEFT JOIN staff_roles r ON r.staff_id = s.id AND r.active = 1 GROUP BY s.id ORDER BY s.status = 'ทำงาน' DESC, s.dept_th, s.nick`],
        ["SELECT entity_id, max(at) AS at FROM audit_log WHERE action = 'exec.staff_apply' AND entity = 'staff' GROUP BY entity_id"],
        ["SELECT status, started_at, inserted, updated, error FROM sync_runs WHERE source = 'staff' ORDER BY started_at DESC LIMIT 1"],
      ]);
      const lastBy = new Map(last.map(r => [r.entity_id, r.at]));
      return {
        asOf: iso(X.now), me: X.staff.id,
        staff: rows.filter(r => r.id !== "system").map(r => ({ ...r, has_pin: !!r.has_pin, roles: String(r.roles || "").split(",").filter(Boolean), last_change: lastBy.get(r.id) || "", confirmed: !!r.exec_ok_at })),
        lastImport: imp[0] || null,
        depts: ["ออฟฟิศ", "ผลิต", "สกรีน", "ส่งของ", "บัญชี", "บริหาร"],
      };
    },
  });

  // ── ใบรับจาก GAS → D1 ─────────────────────────────────────────────────────────
  R.define({
    name: "exec.staff_apply", roles: EXEC, write: true, undo: false, label: "บันทึกทะเบียนพนักงาน",
    input: raw => {
      const r = raw.receipt || raw;
      const data = String(r && r.data || ""), sig = String(r && r.sig || "");
      if (!data || data.length > 4000 || !/^[A-Za-z0-9_-]{43}$/.test(sig)) throw bad("ใบรับจาก Google อ่านไม่ได้ — ทำรายการใหม่");
      return { data, sig };
    },
    async load(X, input) {
      if (!X.env.PK_SYNC_KEY) throw new Fail(503, "not_configured", "ยังไม่ได้ตั้งกุญแจสะพาน (PK_SYNC_KEY) — แจ้งผู้ดูแล");
      if (!sameText(await hmacB64u(X.env.PK_SYNC_KEY, "staff|" + input.data), input.sig)) throw new Fail(400, "bad_receipt", "ใบรับจาก Google ลายเซ็นไม่ตรง — ไม่บันทึก (กุญแจสองฝั่งไม่ตรงกัน หรือถูกแก้กลางทาง)");
      let r;
      try { r = JSON.parse(input.data); } catch (e) { throw bad("ใบรับจาก Google อ่านไม่ได้"); }
      if (!r || r.v !== 1 || !/^[A-Za-z0-9_-]{1,40}$/.test(String(r.sid || "")) || !r.nick || !["pin", "status", "dept", "create"].includes(r.op)) throw bad("ใบรับจาก Google ไม่ครบ");
      if (String(r.by) !== X.staff.id) throw denied("ใบรับนี้ไม่ใช่ของคุณ — ทำรายการใหม่");
      if (!(Math.abs(X.now - Number(r.at)) <= RECEIPT_MAX_AGE_MS)) throw new Fail(410, "gone", "ใบรับเก่าเกิน 15 นาที — ระบบไม่ใช้ (ชีตเปลี่ยนแล้ว — กด \"นำเข้าพนักงาน\" เพื่อให้ตรงกัน)");
      if (!["ทำงาน", "พัก", "ลาออก"].includes(r.status)) r.status = "พัก";   // ค่าแปลก = เข้าไม่ได้ (กันแอบเพิ่มคนผ่านชีต)
      if (r.pf && String(r.pf).length !== 22) throw bad("ใบรับจาก Google: ลายนิ้วมือ PIN ไม่ถูกแบบ");
      const [s, roles, last] = await X.db.reads([
        ["SELECT * FROM staff WHERE id = ?", r.sid],
        ["SELECT role, active FROM staff_roles WHERE staff_id = ?", r.sid],
        ["SELECT after_json FROM audit_log WHERE action = 'exec.staff_apply' AND entity = 'staff_receipt' AND entity_id = ? ORDER BY id DESC LIMIT 1", r.sid],
      ]);
      let prev = null;
      try { prev = last[0] ? JSON.parse(last[0].after_json) : null; } catch (e) { prev = null; }
      return { r, s: s[0] || null, roles, prev };
    },
    async run(X, input, ctx) {
      const { r, s, prev } = ctx;
      const note = { op: "note", entity: "staff_receipt", entity_id: r.sid, after: { rid: r.rid, op: r.op, at: Number(r.at), status: r.status, dept: r.dept } };
      if (prev && (prev.rid === r.rid || Number(prev.at) > Number(r.at))) {   // ใบรับเดิมซ้ำ / เก่ากว่าที่ใช้ไปแล้ว = ไม่เปลี่ยนอะไร
        return { label: "ทะเบียนพนักงานเป็นปัจจุบันแล้ว", result: { sid: r.sid, changed: false }, ops: [Object.assign(note, { after: Object.assign(note.after, { skipped: true }) })] };
      }
      const now = iso(X.now), at = Number(r.at);
      const want = { name: String(r.name || "").slice(0, 120), nick: String(r.nick).slice(0, 60), dept_th: String(r.dept || "").slice(0, 60), status: r.status };
      const ops = [];
      if (!s) {
        ops.push({ op: "insert", table: "staff", row: { id: r.sid, ...want, pin_fp: r.pf || "", pf_at: r.pf ? at : 0, src: "pk:Staff", exec_ok_at: now, exec_ok_by: X.staff.id } });
      } else {
        const set = {};
        for (const k of Object.keys(want)) if (s[k] !== want[k]) set[k] = want[k];
        if ((r.pf || "") !== s.pin_fp && at >= Number(s.pf_at)) { set.pin_fp = r.pf || ""; set.pf_at = at; }   // PIN ใหม่ = ตั๋วเก่าตายทันที
        if (!s.exec_ok_at) { set.exec_ok_at = now; set.exec_ok_by = X.staff.id; }
        if (Object.keys(set).length) ops.push({ op: "update", table: "staff", id: s.id, expect: s.version, before: s, set });
      }
      const wantRoles = rolesOfDept(want.dept_th);
      for (const role of wantRoles) if (!ctx.roles.some(x => x.role === role && x.active === 1)) ops.push({ op: "raw", sql: "INSERT INTO staff_roles(staff_id, role, active) VALUES (?,?,1) ON CONFLICT(staff_id, role) DO UPDATE SET active = 1", args: [r.sid, role] });
      for (const x of ctx.roles) if (x.active === 1 && !wantRoles.includes(x.role)) ops.push({ op: "raw", sql: "UPDATE staff_roles SET active = 0 WHERE staff_id = ? AND role = ?", args: [r.sid, x.role] });
      ops.push(note);
      const what = { pin: "ตั้ง PIN ใหม่", status: "สถานะ " + r.status, dept: "แผนก " + r.dept, create: "เพิ่มพนักงาน" }[r.op];
      return { label: what + " · " + r.nick, result: { sid: r.sid, changed: ops.length > 1, status: r.status, roles: wantRoles }, ops };
    },
  });

  // ── ยืนยันคนใหม่ในรายชื่อ (ที่ไม่ได้เพิ่มผ่านประธาน) ─────────────────────────────────────────
  R.define({
    name: "exec.staff_ack", roles: EXEC, write: true, label: "ยืนยันพนักงานใหม่",
    input: raw => {
      const ids = Array.isArray(raw.ids) ? [...new Set(raw.ids.map(x => need(x, "พนักงาน", 40)))] : [];
      if (!ids.length || ids.length > 90) throw bad("เลือกพนักงาน 1–90 คน");
      return { ids };
    },
    async load(X, input) {
      return { rows: await X.db.all(`SELECT * FROM staff WHERE id IN (${input.ids.map(() => "?").join(",")})`, ...input.ids) };
    },
    async run(X, input, ctx) {
      if (ctx.rows.length !== input.ids.length) throw notFound("ไม่พบพนักงานบางคน — โหลดใหม่");
      const todo = ctx.rows.filter(s => !s.exec_ok_at);
      if (!todo.length) throw bad("ยืนยันไปหมดแล้ว");
      return {
        label: "ยืนยัน " + (todo.length === 1 ? todo[0].nick : todo.length + " คน"), result: { n: todo.length },
        ops: todo.map(s => ({ op: "update", table: "staff", id: s.id, expect: s.version, before: s, set: { exec_ok_at: iso(X.now), exec_ok_by: X.staff.id } })),
      };
    },
  });
}
