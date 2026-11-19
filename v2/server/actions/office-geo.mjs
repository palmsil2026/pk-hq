// ============================================================
//  หมุดลูกค้า · แนะนำสายจากอำเภอ · ชื่อสายที่ทีมเรียก                                                v2/server/actions/office-geo.mjs
//
//  office.customer_geo   วางลิงก์แผนที่ (ลิงก์ที่ลูกค้าส่งในไลน์) → แกะพิกัด/ตามลิงก์ย่อ · อ่านไม่ได้ = เก็บลิงก์ + ธง (ไม่เดาพิกัด)
//  deliver.geo           ปักหมุดด้วย GPS มือถือตอนส่งของ (ไม่บังคับ · เก็บความแม่น) — อยู่ใน deliver-geo.mjs
//  หมุดที่มีอยู่แล้ว แก้ได้ แต่ต้องมีเหตุผล + ธง "แก้หมุดลูกค้า" (ประวัติอยู่ใน audit_log)
//  office.route_suggest  ตาราง อำเภอ → สาย ที่เรียนจากทะเบียน + รายที่มีแค่อำเภอที่แนะนำได้
//  office.route_apply    ยืนยันสายที่แนะนำ (คนกด — ไม่เขียนทับรายที่มีสายแล้ว)
//  route_area.list/guess/set  ชื่อสายที่ทีมเรียก ↔ รหัสสาย (ประธานแก้ · ค่าเดาติดธง "รอยืนยันชื่อสาย")
// ============================================================
import { Fail, bad, conflict, notFound, need, text, int, iso, thaiDay } from "../core.mjs";
import { registerTable } from "../db.mjs";
import { ROLES_OFFICE } from "./office-orders.mjs";
import { resolveMapLink, learnRoutes, guessAreaName, districtKey, mapsUrl, validGeo } from "./geo-lib.mjs";

registerTable("route_areas", { pk: "route_code", void: { status: "ยกเลิก" } });
const locked = (msg, extra) => new Fail(409, "locked", msg, extra);
const needReason = why => new Fail(400, "need_reason", "ต้องใส่เหตุผล: " + why.join(" · "), { needReason: true, why, kind: "geo_fix" });

/** ops ตั้งหมุด (ทุกทางใช้ตัวนี้) — มีหมุดเดิมแล้ว = ต้องมีเหตุผล + ธง */
export function geoOps(X, c, geo, src, acc, extraSet) {
  const had = c.geo_lat_e6 !== null && c.geo_lat_e6 !== undefined;
  const same = had && c.geo_lat_e6 === geo.lat_e6 && c.geo_lng_e6 === geo.lng_e6;
  if (same && !extraSet) throw bad("หมุดนี้ตรงกับที่มีอยู่แล้ว");
  if (had && !same && !X.reason) throw needReason(["ร้านนี้มีหมุดอยู่แล้ว (" + c.geo_src + ") — จะแก้ต้องบอกเหตุผล"]);
  const set = { ...(extraSet || {}) };
  if (!same) Object.assign(set, { geo_lat_e6: geo.lat_e6, geo_lng_e6: geo.lng_e6, geo_acc_m: acc === undefined ? null : acc, geo_src: src, geo_at: iso(X.now), geo_by: X.staff.id, geo_unread: 0 });
  const ops = [{ op: "update", table: "customers", id: c.id, expect: c.version, before: c, set }];
  if (had && !same) ops.push({ op: "flag", kind: "แก้หมุดลูกค้า", team: "office", entity: "customers", entity_id: c.id, title: c.name + ": แก้หมุดร้าน (" + src + ")", detail: "เหตุผล: " + X.reason + " · หมุดเดิมจาก " + c.geo_src });
  return ops;
}

export function defineOfficeGeo(R) {
  R.define({
    name: "office.customer_geo", roles: ROLES_OFFICE, write: true,
    input: raw => ({ id: need(raw.id, "ลูกค้า", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), url: need(raw.url, "ลิงก์แผนที่", 600) }),
    async load(X, input) {
      const c = await X.db.first("SELECT * FROM customers WHERE id = ?", input.id);
      if (!c) throw notFound("ไม่พบลูกค้านี้");
      const r = await resolveMapLink(X.fetch, input.url);   // อ่านลิงก์ก่อนเปิดชุดเขียน (ตามลิงก์ย่ออาจใช้เวลา)
      return { c, r };
    },
    async run(X, input, ctx) {
      const c = ctx.c;
      if (c.version !== input.version) throw conflict();
      if (c.merged_into) throw conflict("ลูกค้ารายนี้ถูกรวมเข้ากับรายอื่นแล้ว — แก้ที่รายหลัก");
      const url = /^https?:\/\//i.test(input.url) ? input.url : c.map_url;
      if (ctx.r.geo) {
        const ops = geoOps(X, c, ctx.r.geo, "ลิงก์แผนที่", undefined, url !== c.map_url ? { map_url: url } : null);
        return { label: "ปักหมุดจากลิงก์ · " + c.name, ops, result: { id: c.id, ok: true, lat_e6: ctx.r.geo.lat_e6, lng_e6: ctx.r.geo.lng_e6, open: mapsUrl(ctx.r.geo.lat_e6, ctx.r.geo.lng_e6) } };
      }
      // อ่านพิกัดไม่ได้: เก็บลิงก์ไว้ให้เปิดดูเอง + ธง (หมุดเดิมไม่แตะ)
      if (!/^https?:\/\//i.test(input.url)) throw bad("อ่านพิกัดไม่ได้: " + ctx.r.why + " — วางลิงก์จาก Google Maps หรือพิมพ์พิกัดแบบ 18.2888, 99.4908");
      const set = { map_url: url, geo_unread: c.geo_lat_e6 === null || c.geo_lat_e6 === undefined ? 1 : 0 };
      for (const k of Object.keys(set)) if (String(set[k]) === String(c[k] ?? "")) delete set[k];
      const ops = Object.keys(set).length ? [{ op: "update", table: "customers", id: c.id, expect: c.version, before: c, set }] : [{ op: "guard", sql: "SELECT 1 FROM customers WHERE id = ? AND version = ?", args: [c.id, c.version] }];
      ops.push({ op: "flag", kind: "ลิงก์แผนที่อ่านไม่ได้", team: "office", entity: "customers", entity_id: c.id, dedupe_key: "geo-unread:" + c.id, title: c.name + ": เก็บลิงก์แผนที่แล้ว แต่อ่านพิกัดไม่ได้", detail: ctx.r.why + " · เปิดลิงก์ดูเอง หรือรอคนขับปักหมุดตอนส่งของ" });
      return { label: "เก็บลิงก์แผนที่ · " + c.name, ops, result: { id: c.id, ok: false, why: ctx.r.why } };
    },
  });

  // ── แนะนำสายจากอำเภอ (เรียนจากทะเบียนจริง ไม่ฝังค่าในโค้ด) ──
  R.define({
    name: "office.route_suggest", roles: ROLES_OFFICE,
    async run(X) {
      const [rows, routes] = await X.db.reads([
        ["SELECT id, name, district, subdistrict, route_code, version FROM customers WHERE merged_into IS NULL AND status = 'ใช้งาน'"],
        ["SELECT r.code, r.name, a.name AS area FROM routes r LEFT JOIN route_areas a ON a.route_code = r.code AND a.status = 'ใช้งาน' WHERE r.active = 1"],
      ]);
      const L = learnRoutes(rows);
      const A = new Map(routes.map(r => [r.code, r.area || ""]));
      const list = rows.filter(c => !c.route_code && districtKey(c.district)).map(c => {
        const s = L.get(districtKey(c.district));
        return { id: c.id, name: c.name, district: c.district, version: c.version, route: s && s.ok ? s.route : "", area: s && s.ok ? A.get(s.route) || "" : "",
          basis: s ? "อ." + s.district + ": สาย " + s.route + " " + s.n + " จาก " + s.total + " ราย" : "ยังไม่มีลูกค้าอำเภอนี้ที่มีสาย" };
      });
      return { asOf: iso(X.now), table: [...L.values()].sort((a, b) => b.total - a.total).map(s => ({ ...s, area: A.get(s.route) || "" })), list,
        counts: { no_route: rows.filter(c => !c.route_code).length, suggest: list.filter(x => x.route).length, nothing: rows.filter(c => !c.route_code && !districtKey(c.district)).length } };
    },
  });

  R.define({
    name: "office.route_apply", roles: ROLES_OFFICE, write: true,
    input: raw => {
      const list = Array.isArray(raw.items) ? raw.items : [];
      if (!list.length) throw bad("ยังไม่ได้เลือกลูกค้า");
      if (list.length > 60) throw bad("ยืนยันได้ครั้งละไม่เกิน 60 ราย");
      return { items: list.map(x => ({ id: need(x.id, "ลูกค้า", 40), version: int(x.version, "รุ่นของรายการ", { min: 1 }), route_code: need(x.route_code, "สาย", 10) })) };
    },
    async load(X, input) {
      const ids = input.items.map(x => x.id), codes = [...new Set(input.items.map(x => x.route_code))];
      const [cs, rs] = await X.db.reads([
        ["SELECT * FROM customers WHERE id IN (" + ids.map(() => "?").join(",") + ")", ...ids],
        ["SELECT code FROM routes WHERE active = 1 AND code IN (" + codes.map(() => "?").join(",") + ")", ...codes],
      ]);
      return { cs: new Map(cs.map(c => [c.id, c])), rs: new Set(rs.map(r => r.code)) };
    },
    async run(X, input, ctx) {
      if (new Set(input.items.map(x => x.id)).size !== input.items.length) throw bad("เลือกลูกค้าซ้ำ");
      const ops = [];
      for (const x of input.items) {
        const c = ctx.cs.get(x.id);
        if (!c) throw notFound("ไม่พบลูกค้าบางราย — โหลดใหม่");
        if (!ctx.rs.has(x.route_code)) throw bad("ไม่รู้จักสาย " + x.route_code);
        if (c.version !== x.version) throw conflict("มีคนแก้ " + c.name + " ไปก่อน — โหลดใหม่");
        if (c.route_code) throw locked(c.name + " มีสาย " + c.route_code + " อยู่แล้ว — ไม่เขียนทับ (แก้ในหน้าลูกค้าแทน)");
        ops.push({ op: "update", table: "customers", id: c.id, expect: c.version, before: c, set: { route_code: x.route_code } });
      }
      return { label: "ยืนยันสาย " + ops.length + " ราย", ops, result: { n: ops.length } };
    },
  });

  // ── ชื่อสายที่ทีมเรียก ↔ รหัสสาย ──
  R.define({
    name: "route_area.list", roles: ["exec", "office"],
    async run(X) {
      const [routes, areas, cust] = await X.db.reads([
        ["SELECT code, name, area, pos FROM routes WHERE active = 1 ORDER BY pos, code"],
        ["SELECT * FROM route_areas"],
        ["SELECT route_code, district FROM customers WHERE merged_into IS NULL AND route_code IS NOT NULL"],
      ]);
      const A = new Map(areas.map(a => [a.route_code, a]));
      return { asOf: iso(X.now), rows: routes.map(r => {
        const a = A.get(r.code), g = guessAreaName(cust, r.code);
        return { code: r.code, route_name: r.name, area: a && a.status === "ใช้งาน" ? a : null, guess: g, customers: cust.filter(c => c.route_code === r.code).length };
      }) };
    },
  });

  R.define({
    name: "route_area.guess", roles: ["exec"], write: true,
    async load(X) {
      const [routes, areas, cust] = await X.db.reads([["SELECT code FROM routes WHERE active = 1"], ["SELECT * FROM route_areas"], ["SELECT route_code, district FROM customers WHERE merged_into IS NULL AND route_code IS NOT NULL"]]);
      return { routes, areas: new Map(areas.map(a => [a.route_code, a])), cust };
    },
    async run(X, input, ctx) {
      const ops = [];
      const names = [];
      for (const r of ctx.routes) {
        const a = ctx.areas.get(r.code);
        if (a && a.status === "ใช้งาน") continue;   // มีชื่อแล้ว (เดาไว้หรือคนตั้ง) ไม่ทับ
        const g = guessAreaName(ctx.cust, r.code);
        if (!g) continue;
        if (a) ops.push({ op: "update", table: "route_areas", id: r.code, expect: a.version, before: a, set: { name: g.name, confirmed: 0, guess_from: g.from, status: "ใช้งาน" } });
        else ops.push({ op: "insert", table: "route_areas", row: { route_code: r.code, name: g.name, confirmed: 0, guess_from: g.from, status: "ใช้งาน", src: "v2" } });
        names.push(r.code + " = " + g.name);
      }
      if (!ops.length) throw bad("ไม่มีสายที่เดาชื่อได้ (ทุกสายมีชื่อแล้ว หรือยังไม่มีลูกค้าในสาย)");
      ops.push({ op: "flag", kind: "รอยืนยันชื่อสาย", team: "exec", entity: "route_areas", entity_id: "", dedupe_key: "route-area-guess", title: "ชื่อสายเดาจากอำเภอ " + names.length + " สาย — รอหัวหน้าทีมสกรีนยืนยัน",
        detail: names.join(" · ") + " · แก้/ยืนยันในหน้าประธาน › ทีม › ชื่อสายส่ง" });
      return { label: "เดาชื่อสาย " + names.length + " สาย", ops, result: { n: names.length } };
    },
  });

  R.define({
    name: "route_area.set", roles: ["exec"], write: true,
    input: raw => ({ code: need(raw.code, "รหัสสาย", 10), name: need(raw.name, "ชื่อสาย", 60), version: int(raw.version, "รุ่น", { optional: true, min: 1 }) }),
    async load(X, input) {
      const [r, a] = await X.db.reads([["SELECT code FROM routes WHERE code = ?", input.code], ["SELECT * FROM route_areas WHERE route_code = ?", input.code]]);
      if (!r[0]) throw notFound("ไม่รู้จักสาย " + input.code);
      return { a: a[0] || null };
    },
    async run(X, input, ctx) {
      const a = ctx.a;
      if (a && input.version !== a.version) throw conflict();
      if (a && a.status === "ใช้งาน" && a.confirmed && a.name === input.name) throw bad("ชื่อนี้ยืนยันไว้แล้ว");
      const ops = a ? [{ op: "update", table: "route_areas", id: input.code, expect: a.version, before: a, set: { name: input.name, confirmed: 1, status: "ใช้งาน" } }]
        : [{ op: "insert", table: "route_areas", row: { route_code: input.code, name: input.name, confirmed: 1, guess_from: "", status: "ใช้งาน", src: "v2" } }];
      return { label: "ชื่อสาย " + input.code + " = " + input.name, ops, result: { code: input.code } };
    },
  });
}
export { validGeo };
