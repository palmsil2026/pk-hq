-- ═══════════════════════════════════════════════════════════════════════════
--  0310_customer_geo — หมุดลูกค้า + ชื่อสายที่ทีมเรียก (ส่งของ · ต่อจาก 0002/0300 ไม่รื้อของเดิม)
--  จุดอ่อนข้อมูล (คุณปาล์มชี้ 19 พ.ย.): ทะเบียนเดิมช่องลิงก์แผนที่ว่างทั้งหมด · ราวครึ่งมีรหัสสาย · รายใหม่มีแค่อำเภอ
--  หมุดมาจาก: ลิงก์แผนที่ที่ลูกค้าส่ง (ออฟฟิศวาง แอปแกะพิกัด) · GPS มือถือตอนกด "ส่งแล้ว" ที่ร้าน (ไม่บังคับ)
--  พิกัด = จำนวนเต็มไมโครองศา (องศา × 1,000,000) ไม่ใช้ทศนิยม · ไม่มีหมุด = NULL (ไม่เดาเป็นจุดกลางอำเภอ)
--  ชื่อคอลัมน์ขึ้นต้น geo_ (ไม่ใช้ pin_ — คำว่า PIN สงวนไว้กันหลุดรหัสพนักงาน · schema.test)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE customers ADD COLUMN geo_lat_e6 INTEGER CHECK (geo_lat_e6 IS NULL OR (typeof(geo_lat_e6) = 'integer' AND geo_lat_e6 BETWEEN -90000000 AND 90000000));
ALTER TABLE customers ADD COLUMN geo_lng_e6 INTEGER CHECK (geo_lng_e6 IS NULL OR (typeof(geo_lng_e6) = 'integer' AND geo_lng_e6 BETWEEN -180000000 AND 180000000));
ALTER TABLE customers ADD COLUMN geo_acc_m INTEGER CHECK (geo_acc_m IS NULL OR (typeof(geo_acc_m) = 'integer' AND geo_acc_m >= 0));   -- ความแม่นของ GPS (เมตร) · ลิงก์ = NULL
ALTER TABLE customers ADD COLUMN geo_src TEXT NOT NULL DEFAULT '' CHECK (geo_src IN ('', 'ลิงก์แผนที่', 'GPS ตอนส่งของ', 'GPS หน้าออฟฟิศ'));
ALTER TABLE customers ADD COLUMN geo_at TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN geo_by TEXT NOT NULL DEFAULT '';
-- ลิงก์ที่แกะพิกัดไม่ได้ (เก็บลิงก์ไว้ + ธง ให้คนเปิดดูเอง) — 1 = map_url ยังไม่มีพิกัด
ALTER TABLE customers ADD COLUMN geo_unread INTEGER NOT NULL DEFAULT 0 CHECK (geo_unread IN (0, 1));

-- ชื่อสายที่ทีมเรียก (แพร่ · วังชิ้น · เถิน · ลำพูน · แจ้ห่ม–เมืองปาน · เมือง) ↔ รหัสสายในทะเบียน (111–121 · 211–215)
--   ค่าตั้งต้นเดาจากอำเภอที่พบบ่อยในสายนั้น (confirmed = 0 + ธง "รอยืนยันชื่อสาย") · ประธานแก้/ยืนยันในหน้าประธาน
CREATE TABLE route_areas (
  route_code TEXT PRIMARY KEY REFERENCES routes(code),
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  confirmed  INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  guess_from TEXT NOT NULL DEFAULT '',     -- เดาจากอะไร ("อ.เถิน 12 จาก 14 ราย") — ว่าง = คนตั้งเอง
  status     TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE TRIGGER no_delete_route_areas BEFORE DELETE ON route_areas BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (route_areas) — ใช้การเปลี่ยนสถานะแทน'); END;

INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('flags.kind', 'ลิงก์แผนที่อ่านไม่ได้', 24, '', 'warn'), ('flags.kind', 'รอยืนยันชื่อสาย', 25, '', 'warn'), ('flags.kind', 'แก้หมุดลูกค้า', 26, '', 'warn'),
  ('reason.geo_fix', 'หมุดเดิมผิดร้าน', 1, '', ''), ('reason.geo_fix', 'ร้านย้ายที่', 2, '', ''), ('reason.geo_fix', 'ลูกค้าส่งลิงก์ใหม่', 3, '', ''), ('reason.geo_fix', 'GPS เดิมคลาดเคลื่อน', 4, '', '');

CREATE INDEX customers_geo ON customers(geo_src);
