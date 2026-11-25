-- ═══════════════════════════════════════════════════════════════════════════
--  0300_screen_delivery — โมดูลทีมสกรีนสี + ส่งของ (ต่อจาก 0006 · ไม่รื้อตารางเดิม เพิ่มคอลัมน์/คลังค่าเท่านั้น)
--
--  สต๊อก (เหตุผลอยู่ docs/app-v2/STATUS.md › สกรีน + ส่งของ):
--    · สกรีนเสร็จ   = ขวดเปล่า A ออก (เบิกสกรีน: ดี + เสีย) · ขวดสกรีนแล้วเข้า (สกรีนเข้า: ดี) ที่กุญแจ spec:<สเปก>|สกรีน <สี>
--    · ขึ้นรถ       = ออกจากคลัง (ขึ้นรถ) — ของบนรถ = แถว delivery_loads สถานะ บนรถ/ส่งไม่ได้ (ตารางนี้คือ "คลังบนรถ")
--    · ส่งแล้ว      = ไม่ขยับคลัง (ออกไปแล้วตอนขึ้นรถ) · เปลี่ยนสถานะ + นับส่งแล้วต่อรายการ
--    · เอาลงจากรถ   = กลับเข้าคลังที่กุญแจเดิมที่ตัดออกตอนขึ้น (คืนคลัง)
--  ติดลบไม่บล็อก — action ขึ้นธง "สต๊อกติดลบ" (ไม่เงียบ)
-- ═══════════════════════════════════════════════════════════════════════════

-- การส่ง 1 ครั้ง (ร้าน 1 ร้าน · 1 ครั้งกด "ส่งแล้ว") — ของหลายรายการที่ส่งพร้อมกันมี stop_id เดียวกัน
--   ใช้: พิมพ์/แชร์ใบส่งของซ้ำ · ย้อนทั้งการส่ง · (ภายหลัง) ผูกการรับเงินตอนส่งกับการส่งครั้งนี้
ALTER TABLE delivery_loads ADD COLUMN stop_id TEXT NOT NULL DEFAULT '';
-- ส่งบางส่วนจากของบนรถ: ส่วนที่เหลือแยกเป็นแถวใหม่ (ยังอยู่บนรถ) — split_from = แถวเดิม
ALTER TABLE delivery_loads ADD COLUMN split_from TEXT NOT NULL DEFAULT '';
-- กุญแจสต๊อกที่ตัดออกตอนขึ้นรถ (เอาลงคืนคลัง = คืนเข้ากุญแจเดิมเสมอ แม้สถานะสกรีนเปลี่ยนภายหลัง)
ALTER TABLE delivery_loads ADD COLUMN stock_key TEXT NOT NULL DEFAULT '';
CREATE INDEX delivery_loads_stop ON delivery_loads(stop_id);
CREATE INDEX delivery_loads_item ON delivery_loads(order_item_id, status);

-- ของบนรถตอนนี้ต่อรายการ (ขึ้นรถ +, ส่งแล้ว/เอาลง −) — ตัวนับนี้ทำให้ "สองคนขึ้นรถรายการเดียวกันพร้อมกัน" ชนกันที่ version
ALTER TABLE order_items ADD COLUMN onboard_pcs INTEGER NOT NULL DEFAULT 0 CHECK (typeof(onboard_pcs) = 'integer' AND onboard_pcs >= 0);

-- คลังค่าใหม่ (ค่าเดิมไม่แตะ)
INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('stock_moves.move_type', 'ขึ้นรถ', 20, '', ''),
  ('stock_moves.move_type', 'คืนคลัง', 21, '', 'warn'),
  ('stock_moves.move_type', 'เบิกสกรีน', 22, '', ''),
  ('stock_moves.move_type', 'สกรีนเข้า', 23, '', 'ok'),
  ('flags.kind', 'ส่งไม่ได้', 20, '', 'warn'),
  ('reason.unload', 'ส่งไม่ได้ เอากลับโรงงาน', 1, '', ''),
  ('reason.unload', 'ขึ้นผิดคัน/ผิดร้าน', 2, '', ''),
  ('reason.unload', 'ลูกค้ายกเลิก', 3, '', ''),
  ('reason.unload', 'ของเสีย/ไม่ผ่าน', 4, '', ''),
  ('reason.load_over', 'ลูกค้าขอเพิ่มหน้างาน', 1, '', ''),
  ('reason.load_over', 'ของแถม/เผื่อแตก', 2, '', ''),
  ('reason.load_early', 'ลูกค้ารีบ ใช้ขวดเปล่าไปก่อน', 1, '', ''),
  ('reason.load_early', 'สกรีนเสร็จแล้วแต่ยังไม่ได้กด', 2, '', ''),
  ('reason.screen_count', 'นับใหม่', 1, '', ''),
  ('reason.screen_count', 'สกรีนเพี้ยน', 2, '', ''),
  ('reason.screen_count', 'ขวดแตก/เสีย', 3, '', '');
