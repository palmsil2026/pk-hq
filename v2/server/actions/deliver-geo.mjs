// ============================================================
//  ส่งของ — ปักหมุดร้านด้วย GPS มือถือตอนกด "ส่งแล้ว" (ไม่บังคับ · แตะเดียว)                       v2/server/actions/deliver-geo.mjs
//  ส่ง 2–4 สัปดาห์ ลูกค้าที่ซื้อประจำจะมีหมุดครบเอง (PLANNING.md › หมุดลูกค้า ข้อ 2)
//  เก็บความแม่น (เมตร) · แม่นน้อยกว่า 200 ม. = ไม่รับ (ให้ลองใหม่กลางแจ้ง — หมุดผิดร้านแย่กว่าไม่มีหมุด)
//  ร้านที่มีหมุดแล้ว: แก้ได้ แต่ต้องมีเหตุผล + ธง (geoOps ของ office-geo.mjs กติกาเดียวกัน)
// ============================================================
import { bad, conflict, notFound, need, int } from "../core.mjs";
import { geoOps } from "./office-geo.mjs";
import { validGeo, mapsUrl } from "./geo-lib.mjs";

export const GPS_MAX_ACC_M = 200;

export function defineDeliverGeo(R) {
  R.define({
    name: "deliver.geo", roles: ["deliver", "office"], write: true,
    input: raw => ({
      customer: need(raw.customer, "ลูกค้า", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }),
      lat_e6: int(raw.lat_e6, "พิกัด (ละติจูด)", { min: -90000000, max: 90000000 }), lng_e6: int(raw.lng_e6, "พิกัด (ลองจิจูด)", { min: -180000000, max: 180000000 }),
      acc_m: int(raw.acc_m, "ความแม่น (เมตร)", { min: 0, max: 100000 }),
    }),
    async load(X, input) {
      const c = await X.db.first("SELECT * FROM customers WHERE id = ?", input.customer);
      if (!c) throw notFound("ไม่พบร้านนี้ในทะเบียน");
      return { c };
    },
    async run(X, input, ctx) {
      if (!validGeo(input.lat_e6, input.lng_e6)) throw bad("พิกัดไม่ถูกต้อง — ลองกดอีกครั้ง");
      if (input.acc_m > GPS_MAX_ACC_M) throw bad("GPS ยังไม่แม่น (คลาด ~" + input.acc_m + " ม.) — ออกไปที่โล่ง รอสักครู่ แล้วกดใหม่");
      if (ctx.c.version !== input.version) throw conflict("ข้อมูลร้านนี้เพิ่งถูกแก้ — โหลดใหม่");
      const ops = geoOps(X, ctx.c, { lat_e6: input.lat_e6, lng_e6: input.lng_e6 }, "GPS ตอนส่งของ", input.acc_m);
      return { label: "ปักหมุด " + ctx.c.name, ops, result: { customer: ctx.c.id, open: mapsUrl(input.lat_e6, input.lng_e6) } };
    },
  });
}
