# แอปโรงขวด v2 — คู่มือนักพัฒนา (แชทโมดูลอ่านไฟล์นี้แล้วลงมือได้ทันที)

> สเปกกลาง (บังคับ): `docs/app-v2/README.md` · สถานะ: `docs/app-v2/STATUS.md` · กติกาบริษัท: `CLAUDE.md` · `PALM-WAY.md`
> branch ทำงาน: **`pk-app-v2` เท่านั้น** (ห้ามแตะ `main` = ของจริง) · ไม่มี dependency ตอนรันจริง · Node ≥ 22 (ใช้ `node:sqlite` แทน D1 ในเครื่อง)

## โครงโฟลเดอร์

```
v2/
├── web/                     หน้าเว็บ (Cloudflare Pages เสิร์ฟโฟลเดอร์นี้) — JS โมดูลล้วน ไม่มีขั้น build
│   ├── index.html · config.js (ลิงก์ GAS — ไม่ใช่ความลับ) · version.json · manifest.webmanifest
│   ├── assets/  app.js (เปลือกแอป) · ui.js (ชิ้นส่วนกลาง) · api.js (คุยหลังบ้าน) · app.css · tokens.css (สร้างอัตโนมัติ) · icons.svg
│   └── roles/   office.js · prod.js · screen.js · deliver.js · account.js · exec.js · shared.js   ← แชทโมดูลเติมที่นี่
├── functions/api/[[path]].js  ประตูของ Pages Functions (บางมาก — เรียก server/)
├── server/                  หลังบ้าน (ไม่ผูก Cloudflare · เทสต์ใน Node ได้ · ห้าม import โมดูล Node)
│   ├── app.mjs   ประตูเดียว: ตรวจตั๋ว · สิทธิ์บทบาท · ท่อเขียนกลาง (audit · กันซ้ำ · version · ย้อน · ธง)
│   ├── db.mjs    ตัวแปลง ops → SQL batch · ทะเบียนตาราง (TABLES) · แปลง error ฐาน → ข้อความไทย
│   ├── core.mjs  เวลาไทย · ตรวจค่า (text/need/int/day/oneOf) · specKey · newId · Fail
│   ├── ticket.mjs ตรวจตั๋ว HMAC (ออกที่ GAS เท่านั้น) · bridge.mjs ขอข้อมูลชีตจาก GAS (ลงชื่อ)
│   ├── actions/  index.mjs (รวมทะเบียน) · foundation.mjs · home.mjs · import.mjs   ← แชทโมดูลเพิ่มไฟล์ของตัวเอง
│   └── import/   ตัวนำเข้าชีตเดิม (importers.mjs · legacy.mjs · reference.generated.mjs)
├── db/  migrations/NNNN_*.sql · SCHEMA.md (ทำไมทุกตาราง) · reference/factory.json (ทะเบียนเครื่อง+ผัง)
├── design/  gen_tokens.py → tokens.css (ตรวจคอนทราสต์ AA ทุกคู่) · README.md
├── tests/   *.test.mjs (หลังบ้าน · node:test) · ui/run.mjs (Playwright) · gas/harness.mjs (รัน gas/Code.gs จริง) · helpers/ · fixtures/ (ข้อมูลสมมติ)
└── tools/   dev-server.mjs · seed-demo.mjs · shots.mjs · check.mjs · gen-*.mjs · deploy-cf.sh
```

## รัน / เทสต์ในเครื่อง (ไม่ต้องมีกุญแจ Cloudflare/Google)

```bash
cd v2
node --no-warnings tools/dev-server.mjs --fresh   # http://127.0.0.1:8787/?app=office  (แตะชื่อไหนก็ได้ PIN 1234 · ข้อมูลสมมติ)
node --no-warnings --test tests/*.test.mjs        # หลังบ้าน + สคีมา + สะพาน GAS + ตัวนำเข้า (~2 วิ)
node --no-warnings --test tests/ui/run.mjs        # หน้าจอจริง Playwright (ใช้ Chromium ที่ติดตั้งในเครื่อง — ห้าม playwright install ใหม่)
node tools/check.mjs                               # ไวยากรณ์ · ไม่มี DELETE · ไม่มีอีโมจิ · ไม่มีความลับ · ไฟล์สร้างอัตโนมัติตรง
node --no-warnings tools/shots.mjs /ที่เก็บภาพ      # ภาพหน้าจอทุกบทบาท 390 + 1366
node tools/build-demo.mjs && node --no-warnings tools/demo/smoke.mjs   # เดโมทั้งระบบเป็นไฟล์ HTML เดียว (dist/demo/ · ดู STATUS › เดโมทั้งระบบ)
```

- dev server ใช้ **หลังบ้านตัวจริง** (`server/`) บน SQLite + **สะพาน PIN ตัวจริง** (`gas/Code.gs` รันใน Node กับชีตจำลอง) — โปรโตคอลเดียวกับของจริงทุกอย่าง
- `.dev/pk.sqlite` = ฐานในเครื่อง (ไม่ commit) · `--mem` = ในหน่วยความจำ · `--fresh` = เริ่มใหม่
- เทสต์เทียบ `gas/Code.gs` กับรุ่นใน `main` ต้องมี `origin/main` ในเครื่อง: `git fetch --depth=1 origin main`

## สถาปัตยกรรมสั้น ๆ

```
มือถือ/คอม ──(PIN ตรงไป Google)──► GAS P&K System (pkV2Ticket) ── ตั๋ว pk1.… (HMAC · ลายนิ้วมือ PIN · 30 วัน / 5 นาทีสำหรับทีมผลิต)
     │
     └──(ตั๋ว)──► Cloudflare Pages Functions /api/call ──► D1 pk-v2 (ตัวจริงของข้อมูล v2)
                                    └──(ลงชื่อ PK_SYNC_KEY)──► GAS pkV2Export (อ่านชีตอย่างเดียว ทีละหน้า) ── นำเข้า/ซิงก์ช่วงเปลี่ยนผ่าน
```

- **PIN ไม่เคยถึง Cloudflare** — ตรวจที่ GAS ครั้งเดียว · Cloudflare เก็บได้แค่ลายนิ้วมือ (เดา PIN กลับไม่ได้เพราะกุญแจลายนิ้วมืออยู่ใน Google)
- เปลี่ยน PIN ในชีต = ตั๋วเก่าตาย (ตั๋วใหม่กว่าที่ลายนิ้วมือต่าง = หลักฐานว่า PIN เปลี่ยน → ระบบจำของใหม่ · หรือรอบนำเข้าพนักงานถัดไป) · พักงาน = ตั๋วตายหลังนำเข้าพนักงานรอบถัดไป
- คนใหม่ในชีตที่ยังไม่นำเข้า = ตั๋วจาก GAS ลงทะเบียนให้เอง (+audit)
- ผู้กระทำ = จากตั๋ว + ตาราง staff เสมอ — ชื่อ/รหัสที่หน้าเว็บส่งมาไม่ถูกใช้

## API (ประตูเดียว)

| เส้นทาง | ตั๋ว | ทำอะไร |
|---|---|---|
| `GET /api/health` | ไม่ต้อง | สุขภาพ + รุ่น + มีกุญแจ/ฐานไหม (smoke test หลัง deploy) |
| `GET /api/public/staff?role=prod` | ไม่ต้อง | การ์ดชื่อหน้าเข้าระบบ (ชื่อเล่น + บทบาท — ไม่มี PIN/ลายนิ้วมือ) |
| `POST /api/call` | `Authorization: Bearer <ตั๋ว>` | `{ action, input, as, key, reason }` → `{ ok, data, undo }` หรือ `{ ok:false, error:{code,message}, needLogin? }` |

- `as` = บทบาท (แอปที่เปิด) ต้องเป็นบทบาทของคนนั้น · **ประธาน (exec) ใช้ได้ทุกบทบาท** (audit จดว่าใช้บทบาทไหน)
- `key` = รหัสกันกดซ้ำ **บังคับทุก action เขียน** (หน้าเว็บสร้างให้ 1 ตัวต่อการกด · เน็ตหลุด `api.js` ส่งซ้ำด้วยตัวเดิมเอง)
- error: `400 bad_input` · `401 need_login`/`need_pin` · `403 forbidden` · `404` · `409 conflict` (มีคนแก้ก่อน/ซ้ำ) · `410 gone` (เลยเวลาย้อน) · `502 bridge` · `503 not_configured` · `500 server` — ข้อความไทยบอกสาเหตุจริงเสมอ

### action ที่มีแล้ว (Foundation)

| action | บทบาท | |
|---|---|---|
| `system.me` | ทุกบทบาท | ตัวฉัน + คลังค่า (ป้ายสถานะ/ชิปเหตุผล) + สาย + ทีมสกรีน + รุ่นเว็บขั้นต่ำ |
| `home.office` `home.prod` `home.screen` `home.deliver` `home.account` `home.exec` | บทบาทนั้น + exec | หน้าแรก "งานที่รอ" (1 รอบคุยกับฐาน) |
| `undo.run` `undo.mine` | ทุกบทบาท | ย้อนของกลาง · รายการที่ฉันย้อนได้ |
| `flag.raise` (เหตุผลบังคับ) · `flag.list` · `flag.resolve` (exec) | | ธง/ข้อยกเว้น |
| `setting.list` `setting.set` | exec | ค่าตั้ง |
| `import.sources` `import.run` | exec | นำเข้าจากชีตเดิมทีละหน้า (รันซ้ำได้ไม่เบิ้ล) |

## วิธีเพิ่ม action (หลังบ้าน)

1. สร้าง `server/actions/<โมดูล>.mjs` → `export function defineXxx(R) { R.define({...}) }` แล้วเพิ่ม 1 บรรทัดใน `server/actions/index.mjs` (ต่อท้าย ไม่แก้บรรทัดคนอื่น)
2. ชื่อ `กลุ่ม.คำสั่ง` (เช่น `run.open`, `order.create`) · `roles: [...]` · อ่าน = `write:false` คืนข้อมูล · เขียน = `write:true` คืน `{ result, ops, label }`:

```js
R.define({
  name: "run.close", roles: ["prod"], write: true, gate: true,   // gate = ทีมผลิตต้องใช้ตั๋วจาก PIN ตอนกด
  reason: "optional",                                              // 'required' = ต้องมีเหตุผล
  input: raw => ({ id: need(raw.id, "รอบ"), good: int(raw.good, "ดี", { min: 0 }), version: int(raw.version, "รุ่น", { min: 1 }) }),
  async load(X, input) {                                           // อ่านก่อนเขียน — รวบเป็นรอบเดียวด้วย X.db.reads([...])
    const [[run]] = await X.db.reads([["SELECT * FROM machine_runs WHERE id = ?", input.id]]);
    if (!run) throw notFound("ไม่พบรอบนี้");
    return { run };
  },
  async run(X, input, ctx) {
    if (ctx.run.version !== input.version) throw conflict();
    return {
      label: "ปิดรอบ " + ctx.run.machine_id, result: { id: input.id },
      ops: [
        { op: "update", table: "machine_runs", id: input.id, expect: input.version, before: ctx.run, set: { good_pcs: input.good, status: "ปิดแล้ว", ended_at: iso(X.now), ended_day: thaiDay(X.now), closed_by: X.staff.id } },
        { op: "move", item_key: "spec:" + ctx.run.spec_key, grade: "A", qty_pcs: input.good, move_type: "ผลิตเข้า", ref_entity: "machine_runs", ref_id: input.id },
        // { op: "flag", kind: "รอบค้าง", title: "…", dedupe_key: "…" }   ← ข้อยกเว้นให้คนตัดสิน (ไม่บล็อกงาน)
      ],
    };
  },
  undo: { guard: async (X, u) => { /* throw conflict("…") ถ้าขั้นถัดไปรับแล้วแบบที่ version ไม่ฟ้อง */ } },
});
```

- ท่อกลางทำให้เอง: ด่าน version (สองคนแก้พร้อมกัน → คนหลัง 409) · แถว `audit_log` ทุก op (ก่อน/หลัง/เหตุผล/คนจากตั๋ว) · กันกดซ้ำ · คำสั่ง "ย้อน" (insert → พลิกสถานะ · update → คืนค่าเดิม · move → แถวกลับทิศ) · ธงที่ยกในคำขอนี้ปิดเองเมื่อย้อน — **ทั้งหมดอยู่ใน D1 batch เดียว**
- ops: `insert` · `update` (ต้องมี `expect` + `before`) · `move` (สมุดสต๊อก) · `flag` · `raw` (UPSERT เฉพาะงานนำเข้า — ทำให้ย้อนไม่ได้) · `note` (audit อย่างเดียว) — **ไม่มี delete**
- ตารางใหม่: `registerTable("ชื่อ", { pk: "id", void: { status: "ยกเลิก" } })` (void = ค่าที่ใช้ย้อนการเพิ่มแถว)
- ห้ามเขียน SQL เขียนข้อมูลเองนอก ops · ห้าม `LIKE ?` · ตัวแปร ≤ 100 ต่อคำสั่ง · เงิน = สตางค์ (`int`) · จำนวน = ใบ/ชิ้น
- เทสต์: ใช้ `tests/helpers/world.mjs` (`W.staff()` ได้ตั๋ว · `W.call()` · `W.tick()` คุมเวลา · `W.q()` อ่านฐาน) — ทุก action ต้องมีเทสต์ ถูก/ผิดสิทธิ์/ซ้ำ/ย้อน/ชนกัน

## วิธีเพิ่ม migration

`v2/db/migrations/NNNN_<ชื่อ>.sql` ในช่วงเลขของตัวเอง (0100 ผลิต · 0200 ออฟฟิศ · 0300 สกรีน+ส่งของ · 0400 ประธาน+บัญชี) — รายละเอียด/กติกาใน `db/SCHEMA.md`
(คอลัมน์ใหม่ต้องมี DEFAULT · ตารางใหม่ต้องมี trigger กันลบ · ค่าสถานะใหม่ = `INSERT INTO vocab` · ห้ามแก้ไฟล์ที่ขึ้นจริงแล้ว)

## วิธีเพิ่มหน้า (หน้าเว็บ)

- แต่ละบทบาท = `web/roles/<บทบาท>.js` → `export default { code, title, nav: [{key,label,icon,title}] (≤ 5), fab?, views: { key: (ctx, view) => … } }`
- `ctx.load(view, "ชื่อแคช", "action", (box, data, st) => …)` = โชว์ของรอบก่อนทันที → ดึงใหม่ → วาดใหม่ (ใช้ `ui.renderList` = ไม่กระพริบ) · `st.fresh=false` ⇒ เงินต้องโชว์ "—" (`ui.money(x, st.fresh)`)
- `ctx.save("action", input, { label, confirm: { title, reasons: ctx.reasons("waste"), need: "required" }, after })` = แผ่นยืนยัน+ชิปเหตุผล → (ทีมผลิต: ใครบันทึก+PIN) → บันทึก → แถบ "ย้อน"
- ชิ้นส่วนกลาง (`assets/ui.js` — ห้ามทำซ้ำ): `h()` · `icon()` · `sheet()` (แผ่นล่างลากได้ · จอกว้าง = แผงขวา) · `confirmSheet()` · `undoBar()` · `numpadSheet()`/`numpad()` · `pinPad()` · `qty()`/`itemQty()` (ป้าย `[ขนาด | ตัวเลขหนา หน่วย]`) · `pill()`/`statusPill()` (สี+คำ+สัญลักษณ์) · `empty()` ("ไม่มีงานค้าง") · `errorBox()` · `stamp()` · `busy()` (⏳ + กันกดซ้ำ) · `money()` · `thDay()`/`thTime()`/`since()`
- กติกาหน้าจอ: ไม่โชว์รหัสระบบ (มีแค่บรรทัด "รหัสอ้างอิง" ในรายละเอียด) · ไม่มีอีโมจิ · ไม่มี alert/confirm/prompt · ปุ่ม ≥ 44px · ไม่มีศัพท์นักพัฒนาบนจอ
- แก้หน้าเว็บ → ขยับ `WEB_VERSION` ใน `assets/app.js` **และ** `version.json` ให้ตรงกัน (check.mjs ตรวจ) · บังคับอัปเดต = ตั้ง `MIN_WEB_VERSION` ใน settings
- ทุกหน้าใหม่: เพิ่มเทสต์ใน `tests/ui/` ที่ 390 และ 1366

## นำเข้าข้อมูลเดิม (ประธานกดในแอป › ทีม)

| แหล่ง | มาจาก | กติกา |
|---|---|---|
| `ref:products` · `ref:machines` | ทะเบียนใน repo (`docs/products/…csv` · `db/reference/factory.json` → `tools/gen-reference-data.mjs`) | เติมช่องว่าง · ไม่ตั้งราคา |
| `staff` | ชีต Staff ผ่าน GAS | ไม่มี PIN (ลายนิ้วมือแทน) · ชีตเป็นตัวจริง |
| `legacy:customer` · `pk:Customers` | P&K_ลูกค้า · PKSystem | จับคู่ชื่อหลวม · เติมช่องว่างไม่ทับ |
| `legacy:order` | ชีต Order ของ AppSheet | ประวัติ · หมายเหตุมือ → ช่องจริง · จับคู่ไม่ได้ = ลูกค้า "รอตรวจ" + ธง |
| `legacy:stock:ProductionLog` | Stock Management (ต้องตั้ง Script Property `LEGACY_STOCK_SHEET_ID`) | ประวัติ · ข้ามเที่ยงคืน · รอบค้าง = สถานะแยก + ธง · หัวคอลัมน์ไม่ครบ = หยุด ไม่เดา |
| `acct` | ชีท "ระบบบัญชี" (อ่านอย่างเดียว) | ชีทบัญชีเป็นตัวจริง · บิล v2 ไม่แตะ · ห้ามเขียนกลับ |

## deploy (ยังไม่ขึ้นจริง)

- CI `.github/workflows/v2-ci.yml` รันทุก push `pk-app-v2`: test → ui (+ภาพหน้าจอ) → build (wrangler) → deploy-cloudflare (**ข้ามเองถ้ายังไม่มี secret**)
- `tools/deploy-cf.sh`: สร้าง/หา D1 `pk-v2` → migration → Pages `pk-v2` → ตั้ง secret → deploy เป็นพรีวิวของ branch → smoke `/api/health`
- ชื่อทุกอย่างขึ้นต้น `pk-` แยกจากโรงน้ำ · หน้าเว็บ/ระบบเดิม (GitHub Pages + GAS) ไม่ถูกแตะ
