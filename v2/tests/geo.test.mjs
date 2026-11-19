// เทสต์หมุดลูกค้า 0310: แกะพิกัดจากลิงก์ (รวมลิงก์ย่อ — ตามด้วย fetch จำลอง ไม่ออกเน็ต) · อ่านไม่ได้ = เก็บลิงก์ + ธง
//   · ปักหมุด GPS ตอนส่งของ (ความแม่น · แก้หมุดเดิม = เหตุผล + ธง) · แนะนำสายจากอำเภอ (ไม่เขียนทับ) · ชื่อสายที่ทีมเรียก (เดา + ธง → ประธานยืนยัน)
//   ทุก action: ถูก / ผิดสิทธิ์ / กดซ้ำ / ย้อน / ชนกัน — ข้อมูลสมมติล้วน (พิกัดสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, T0 } from "./helpers/world.mjs";
import { parseMapLink, resolveMapLink, learnRoutes, guessAreaName, e6 } from "../server/actions/geo-lib.mjs";

const AT = new Date(T0).toISOString();
// ลิงก์ย่อจำลอง → ทางต่อไป Google Maps (ไม่มีการออกเน็ตจริงในเทสต์)
const FAKE = {
  "https://maps.app.goo.gl/abcDEF": { status: 302, location: "https://www.google.com/maps/place/x/data=!3d18.2888!4d99.4908?entry=tts" },
  "https://maps.app.goo.gl/twoHop": { status: 301, location: "https://goo.gl/maps/next" },
  "https://goo.gl/maps/next": { status: 302, location: "https://www.google.com/maps/@18.1,99.2,15z" },
  "https://maps.app.goo.gl/noGeo": { status: 302, location: "https://www.google.com/maps/search/%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99" },
  "https://www.google.com/maps/search/%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99": { status: 200, body: "<html>ไม่มีพิกัด</html>" },
  "https://maps.app.goo.gl/evil": { status: 302, location: "https://evil.example/steal" },
};
const calls = [];
const fakeFetch = async (url) => {
  calls.push(url);
  const f = FAKE[url];
  if (!f) throw new Error("ปิดเน็ตในเทสต์: " + url);
  return { status: f.status, headers: { get: k => (k === "location" ? f.location || null : null) }, text: async () => f.body || "" };
};

async function setup() {
  const W = world({ fetch: fakeFetch });
  const T = { off: await W.staff("S1", "แอน", ["office"]), drv: await W.staff("S5", "ต่อ", ["deliver"]), prod: await W.staff("S3", "บอส", ["prod"]), boss: await W.staff("S9", "หัวหน้า", ["exec"]), acc: await W.staff("S4", "ฝ้าย", ["account"]) };
  const ex = (sql, ...a) => W.d1.raw.prepare(sql).run(...a);
  for (const c of ["115", "212", "119"]) ex("INSERT INTO routes(code, name, area, created_at, updated_at) VALUES (?, ?, '', ?, ?)", c, "สาย " + c, AT, AT);
  const cust = (id, name, district, route) => ex("INSERT INTO customers(id, name, name_key, district, route_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", id, name, name.replace(/\s/g, ""), district, route || null, AT, AT);
  cust("C1", "ร้านทดสอบ 1", "เถิน", "212"); cust("C2", "ร้านทดสอบ 2", "เถิน", "212"); cust("C3", "ร้านทดสอบ 3", "เถิน", "115");
  cust("C4", "ร้านทดสอบ 4", "เถิน"); cust("C5", "ร้านทดสอบ 5", "แม่ทะ"); cust("C6", "ร้านทดสอบ 6", "แม่ทะ", "119"); cust("C7", "ร้านทดสอบ 7", "");
  cust("C8", "ร้านทดสอบ 8", "เมืองลำปาง", "115"); cust("C9", "ร้านทดสอบ 9", "เมืองลำปาง", "115");
  const call = (who, action, input, more) => W.call(T[who], action, input, more);
  const ok = async (who, action, input, more) => { const r = await call(who, action, input, more); assert.equal(r.status, 200, action + ": " + JSON.stringify(r.error)); return r; };
  const c = id => W.one("SELECT * FROM customers WHERE id = ?", id);
  return { W, T, call, ok, c, ex };
}

test("แกะพิกัด: ?q= · /@ · !3d!4d (หมุดสถานที่ชนะกลางจอ) · ?query= · พิมพ์พิกัดตรง ๆ · ไม่มีพิกัด = null", () => {
  assert.deepEqual(parseMapLink("https://maps.google.com/?q=18.288800,99.490800"), { lat_e6: 18288800, lng_e6: 99490800 });
  assert.deepEqual(parseMapLink("https://www.google.com/maps/@18.2888,99.4908,17z"), { lat_e6: 18288800, lng_e6: 99490800 });
  assert.deepEqual(parseMapLink("https://www.google.com/maps/place/ร้าน/@18.0,99.0,15z/data=!3d18.2888!4d99.4908"), { lat_e6: 18288800, lng_e6: 99490800 });
  assert.deepEqual(parseMapLink("https://www.google.com/maps/search/?api=1&query=18.2888%2C99.4908"), { lat_e6: 18288800, lng_e6: 99490800 });
  assert.deepEqual(parseMapLink(" 18.2888, 99.4908 "), { lat_e6: 18288800, lng_e6: 99490800 });
  assert.equal(parseMapLink("https://www.google.com/maps/search/ร้านขวด"), null);
  assert.equal(parseMapLink("https://maps.google.com/?q=0,0"), null, "0,0 = ไม่ใช่พิกัดจริง");
  assert.equal(parseMapLink("https://maps.google.com/?q=95.1,99.1"), null);
  assert.equal(e6("18.12345678"), 18123456, "ตัดหลักที่ 7 (ไม่ใช้ทศนิยมลอย)");
});

test("ลิงก์ย่อ: ตามทางต่อ (≤5 ทอด เฉพาะ Google) · ไม่มีพิกัด/ออกนอก Google = null + เหตุ", async () => {
  assert.deepEqual((await resolveMapLink(fakeFetch, "https://maps.app.goo.gl/abcDEF")).geo, { lat_e6: 18288800, lng_e6: 99490800 });
  assert.deepEqual((await resolveMapLink(fakeFetch, "https://maps.app.goo.gl/twoHop")).geo, { lat_e6: 18100000, lng_e6: 99200000 });
  const no = await resolveMapLink(fakeFetch, "https://maps.app.goo.gl/noGeo");
  assert.equal(no.geo, null); assert.match(no.why, /ไม่มีพิกัด/);
  const evil = await resolveMapLink(fakeFetch, "https://maps.app.goo.gl/evil");
  assert.equal(evil.geo, null); assert.ok(!calls.includes("https://evil.example/steal"), "ไม่ตามลิงก์ออกนอก Google");
  const other = await resolveMapLink(fakeFetch, "https://example.com/map");
  assert.equal(other.geo, null); assert.ok(!calls.includes("https://example.com/map"), "ลิงก์ที่ไม่ใช่ Google ไม่ยิงเลย");
  const down = await resolveMapLink(fakeFetch, "https://maps.app.goo.gl/unknown");
  assert.equal(down.geo, null); assert.match(down.why, /เปิดลิงก์ไม่ได้/);
});

test("วางลิงก์ในหน้าลูกค้า: ได้พิกัด = หมุด (ที่มา ลิงก์แผนที่) · อ่านไม่ได้ = เก็บลิงก์ + ธง · หมุดเดิมแก้ต้องมีเหตุผล + ธง · ย้อน · ผิดสิทธิ์ · ชนกัน", async () => {
  const { W, ok, call, c } = await setup();
  const r = await ok("off", "office.customer_geo", { id: "C1", version: c("C1").version, url: "https://maps.app.goo.gl/abcDEF" });
  assert.equal(r.data.ok, true);
  let x = c("C1");
  assert.equal(x.geo_lat_e6, 18288800); assert.equal(x.geo_src, "ลิงก์แผนที่"); assert.equal(x.map_url, "https://maps.app.goo.gl/abcDEF"); assert.equal(x.geo_by, "S1");
  // ลิงก์อ่านไม่ได้: ร้านที่ยังไม่มีหมุด
  const n = await ok("off", "office.customer_geo", { id: "C2", version: c("C2").version, url: "https://maps.app.goo.gl/noGeo" });
  assert.equal(n.data.ok, false);
  assert.equal(c("C2").map_url, "https://maps.app.goo.gl/noGeo"); assert.equal(c("C2").geo_unread, 1); assert.equal(c("C2").geo_lat_e6, null, "ไม่เดาพิกัด");
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'ลิงก์แผนที่อ่านไม่ได้' AND entity_id = 'C2'").length, 1);
  // ข้อความที่ไม่ใช่ลิงก์และไม่มีพิกัด = ไม่บันทึก
  assert.equal((await call("off", "office.customer_geo", { id: "C2", version: c("C2").version, url: "ร้านอยู่หลังวัด" })).status, 400);
  // แก้หมุดเดิม = เหตุผล
  const need = await call("off", "office.customer_geo", { id: "C1", version: c("C1").version, url: "18.3, 99.5" });
  assert.equal(need.error.code, "need_reason");
  const fix = await ok("off", "office.customer_geo", { id: "C1", version: c("C1").version, url: "18.3, 99.5" }, { reason: "หมุดเดิมผิดร้าน" });
  assert.equal(c("C1").geo_lat_e6, 18300000);
  assert.equal(c("C1").map_url, "https://maps.app.goo.gl/abcDEF", "พิมพ์พิกัดเอง = ลิงก์เดิมไม่หาย");
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'แก้หมุดลูกค้า'").length, 1);
  await ok("off", "undo.run", { id: fix.undo.id });
  assert.equal(c("C1").geo_lat_e6, 18288800, "ย้อน = หมุดเดิม");
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'แก้หมุดลูกค้า' AND status = 'เปิด'").length, 0, "ธงของคำขอที่ย้อนปิดเอง");
  assert.equal((await call("prod", "office.customer_geo", { id: "C1", version: c("C1").version, url: "18.3, 99.5" })).status, 403);
  assert.equal((await call("off", "office.customer_geo", { id: "C1", version: 1, url: "18.4, 99.5" }, { reason: "ร้านย้ายที่" })).status, 409);
});

test("ปักหมุดตอนส่งของ: GPS แตะเดียว · ความแม่นเกิน 200 ม. ไม่รับ · หมุดเดิมแก้ต้องมีเหตุผล · ส่งของเห็นแค่ว่ามีหมุด · ผิดสิทธิ์ · กดซ้ำ", async () => {
  const { W, ok, call, c } = await setup();
  const far = await call("drv", "deliver.geo", { customer: "C4", version: c("C4").version, lat_e6: 17600000, lng_e6: 99200000, acc_m: 850 });
  assert.equal(far.status, 400); assert.match(far.error.message, /ยังไม่แม่น/);
  const key = W.key();
  const g = await ok("drv", "deliver.geo", { customer: "C4", version: c("C4").version, lat_e6: 17600000, lng_e6: 99200000, acc_m: 12 }, { key });
  const again = await ok("drv", "deliver.geo", { customer: "C4", version: c("C4").version - 1, lat_e6: 17600000, lng_e6: 99200000, acc_m: 12 }, { key });
  assert.equal(again.replayed, true);
  const x = c("C4");
  assert.equal(x.geo_src, "GPS ตอนส่งของ"); assert.equal(x.geo_acc_m, 12); assert.equal(x.geo_by, "S5");
  assert.match(g.data.open, /query=17\.600000,99\.200000/);
  const again2 = await call("drv", "deliver.geo", { customer: "C4", version: c("C4").version, lat_e6: 17600500, lng_e6: 99200500, acc_m: 8 });
  assert.equal(again2.error.code, "need_reason", "มีหมุดแล้ว = ต้องบอกเหตุผล");
  await ok("drv", "deliver.geo", { customer: "C4", version: c("C4").version, lat_e6: 17600500, lng_e6: 99200500, acc_m: 8 }, { reason: "GPS เดิมคลาดเคลื่อน" });
  assert.equal(c("C4").geo_lat_e6, 17600500);
  assert.equal((await call("prod", "deliver.geo", { customer: "C5", version: 1, lat_e6: 17600000, lng_e6: 99200000, acc_m: 5 })).status, 403);
  assert.equal((await call("acc", "deliver.geo", { customer: "C5", version: 1, lat_e6: 17600000, lng_e6: 99200000, acc_m: 5 })).status, 403);
  assert.equal((await call("drv", "deliver.geo", { customer: "C5", version: 1, lat_e6: 0, lng_e6: 0, acc_m: 5 })).status, 400);
});

test("แนะนำสายจากอำเภอ: เรียนจากรายที่มีทั้งสองช่อง (≥60% และ ≥2 ราย) · ยืนยันทีละหลายราย · ไม่เขียนทับรายที่มีสาย · ย้อน · ผิดสิทธิ์", async () => {
  const { ok, call, c } = await setup();
  const L = learnRoutes([{ district: "เถิน", route_code: "212" }, { district: "อ.เถิน", route_code: "212" }, { district: "เถิน", route_code: "115" }]);
  assert.equal(L.get("เถิน").route, "212"); assert.equal(L.get("เถิน").ok, true);
  assert.equal(learnRoutes([{ district: "แม่ทะ", route_code: "119" }]).get("แม่ทะ").ok, false, "รายเดียว = ยังไม่พอแนะนำ");
  const s = await ok("off", "office.route_suggest", {});
  const c4 = s.data.list.find(x => x.id === "C4");
  assert.equal(c4.route, "212"); assert.match(c4.basis, /2 จาก 3/);
  assert.equal(s.data.list.find(x => x.id === "C5").route, "", "แม่ทะมีรายเดียว = ไม่แนะนำ");
  assert.ok(!s.data.list.some(x => x.id === "C7"), "ไม่มีอำเภอ = ไม่อยู่ในรายการ");
  assert.equal(s.data.counts.nothing, 1);
  const cust = await ok("off", "office.customer", { id: "C4" });
  assert.equal(cust.data.route_hint.route, "212");
  const a = await ok("off", "office.route_apply", { items: [{ id: "C4", version: c("C4").version, route_code: "212" }, { id: "C5", version: c("C5").version, route_code: "119" }] });
  assert.equal(c("C4").route_code, "212"); assert.equal(c("C5").route_code, "119");
  const over = await call("off", "office.route_apply", { items: [{ id: "C1", version: c("C1").version, route_code: "115" }] });
  assert.equal(over.status, 409); assert.equal(c("C1").route_code, "212", "ไม่เขียนทับ");
  await ok("off", "undo.run", { id: a.undo.id });
  assert.equal(c("C4").route_code, null);
  assert.equal((await call("drv", "office.route_apply", { items: [{ id: "C4", version: c("C4").version, route_code: "212" }] })).status, 403);
  assert.equal((await call("off", "office.route_apply", { items: [{ id: "C4", version: c("C4").version, route_code: "999" }] })).status, 400);
});

test("ชื่อสายที่ทีมเรียก: เดาจากอำเภอ (ติดธงรอยืนยัน · ไม่ทับชื่อที่มี) → ประธานยืนยัน/แก้ · ย้อน · เฉพาะประธาน · เส้นทางส่งของได้ชื่อสาย", async () => {
  const { W, ok, call } = await setup();
  assert.deepEqual(guessAreaName([{ route_code: "115", district: "เมืองลำปาง" }, { route_code: "115", district: "เมืองลำปาง" }, { route_code: "115", district: "เถิน" }], "115").name, "เมือง–เถิน");
  assert.equal((await call("off", "route_area.guess", {})).status, 403);
  const g = await ok("boss", "route_area.guess", {});
  assert.equal(g.data.n, 3);
  const a = W.one("SELECT * FROM route_areas WHERE route_code = '212'");
  assert.equal(a.name, "เถิน"); assert.equal(a.confirmed, 0); assert.match(a.guess_from, /อ\.เถิน 2/);
  assert.equal(W.one("SELECT * FROM route_areas WHERE route_code = '115'").name, "เมือง–เถิน");
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'รอยืนยันชื่อสาย'").length, 1);
  assert.equal((await call("boss", "route_area.guess", {})).status, 400, "เดาซ้ำไม่ทับของเดิม");
  const s = await ok("boss", "route_area.set", { code: "212", name: "เถิน–แม่พริก", version: a.version });
  const b = W.one("SELECT * FROM route_areas WHERE route_code = '212'");
  assert.equal(b.name, "เถิน–แม่พริก"); assert.equal(b.confirmed, 1);
  assert.equal((await call("boss", "route_area.set", { code: "212", name: "x", version: 1 })).status, 409);
  await ok("boss", "undo.run", { id: s.undo.id });
  assert.equal(W.one("SELECT confirmed FROM route_areas WHERE route_code = '212'").confirmed, 0);
  const list = await ok("off", "route_area.list", {});
  assert.equal(list.data.rows.find(r => r.code === "212").area.name, "เถิน");
  assert.equal((await call("drv", "route_area.set", { code: "212", name: "x" })).status, 403);
});
