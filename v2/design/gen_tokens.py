# -*- coding: utf-8 -*-
# ════════════════════════════════════════════════════════════════════
#  ระบบดีไซน์ โรงขวด P&K v2 — สร้าง tokens.css + ตรวจคอนทราสต์ทุกคู่ (WCAG AA)
#  วิธีเดียวกับระบบดีไซน์ "ละกอน" ของโรงน้ำ (origin-hq/design-system/gen_tokens.py):
#    tone ramp 10–99 คำนวณใน OKLCh แล้วตรึงเป็น hex (ไม่พึ่ง oklch() ของเบราว์เซอร์)
#  ต่างกันแค่ "สีประจำบริษัท" = แดงอิฐ #B24A4F (สีเดิมของแอปโรงขวด index.html :root --brand)
#  + ตั้งชื่อสีตามหน้าที่ (semantic) ทั้งโหมดสว่างและโหมดมืด แล้วตรวจทุกคู่ที่ใช้จริง
#
#  ใช้:  python3 gen_tokens.py          → เขียน tokens.css + พิมพ์ผลตรวจ (ไม่ผ่าน = exit 1)
#        python3 gen_tokens.py --check  → ตรวจอย่างเดียวว่า tokens.css ตรงกับสคริปต์ (CI ใช้)
#  ห้ามแก้ tokens.css ด้วยมือ — แก้ที่ไฟล์นี้แล้วรันใหม่
# ════════════════════════════════════════════════════════════════════
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_color_math.py'), encoding='utf-8').read().split('# Material 3 ใช้')[0])

TONES = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 94, 96, 98]

def Lstar(h):
    Y = lum(h)
    return 116 * (Y ** (1 / 3)) - 16 if Y > 0.008856 else 903.3 * Y

def build(seed, neutral=False):
    """ramp จากสีเมล็ด — สีเมล็ดถูกตรึงไว้ที่ tone ที่มันอยู่จริง (สีที่ใช้อยู่แล้ว = สมาชิกของ ramp)"""
    _, C, H = hex2oklch(seed)
    pin = min(TONES, key=lambda t: abs(t - Lstar(seed)))
    ramp = {}
    for t in TONES:
        L = (t + 16) / 116
        if neutral:
            c = 0.014
        else:
            c = max(C * (1 - abs(L - 0.60) / 0.68) ** 1.1, 0.014)
        ramp[t] = oklch2hex(L, c, H)
    ramp[pin] = seed.upper()
    return ramp, pin

FAMILIES = [
    ('brick',   '#B24A4F', 'แดงอิฐ — สีประจำโรงขวด (ปุ่มหลัก · เมนูที่เลือก · ลิงก์)', False),
    ('neutral', '#6B645E', 'เทาอุ่น — ตัวหนังสือรอง · เส้น · พื้น', True),
    ('green',   '#15803D', 'เขียว — สถานะ "สำเร็จ/เดินอยู่" เท่านั้น (ความหมายเดียวกับโรงน้ำ)', False),
    ('amber',   '#B45309', 'อำพัน — สถานะ "ต้องดู/ค้าง/ใกล้กำหนด"', False),
    ('red',     '#B91C1C', 'แดงเข้ม — สถานะ "ผิดปกติ/เลยกำหนด/ยอดไม่ตรง"', False),
]
R = {}
PINS = {}
for name, seed, label, neu in FAMILIES:
    R[name], PINS[name] = build(seed, neu)

# ── สีตามหน้าที่ (semantic) — ทุกหน้าใช้ชื่อพวกนี้ ไม่อ้าง ramp ตรง ─────────────
#   ink = ตัวหนังสือหลัก · ink-2 = ตัวหนังสือรอง · line = เส้นแบ่ง (ตกแต่ง) · edge = ขอบของที่กดได้ (≥3:1)
LIGHT = {
    'bg':         R['neutral'][98],
    'surface':    '#FFFFFF',
    'surface-2':  R['neutral'][96],
    'sunken':     R['neutral'][94],
    'ink':        R['neutral'][10],
    'ink-2':      R['neutral'][40],
    'line':       R['neutral'][90],
    'edge':       R['neutral'][50],
    'brand':      R['brick'][PINS['brick']],
    'on-brand':   '#FFFFFF',
    'brand-ink':  R['brick'][30],
    'brand-soft': R['brick'][94],
    'brand-tint': R['brick'][98],
    'ok':         R['green'][40],
    'ok-ink':     R['green'][25],
    'ok-soft':    R['green'][94],
    'warn':       R['amber'][PINS['amber']],
    'warn-ink':   R['amber'][25],
    'warn-soft':  R['amber'][94],
    'bad':        R['red'][40],
    'bad-ink':    R['red'][25],
    'bad-soft':   R['red'][94],
    'focus':      R['brick'][40],
    'scrim':      'rgba(26,18,18,.40)',
}
DARK = {
    'bg':         R['neutral'][10],
    'surface':    R['neutral'][15],
    'surface-2':  R['neutral'][20],
    'sunken':     R['neutral'][10],
    'ink':        R['neutral'][96],
    'ink-2':      R['neutral'][80],
    'line':       R['neutral'][25],
    'edge':       R['neutral'][60],
    'brand':      R['brick'][80],
    'on-brand':   R['brick'][15],
    'brand-ink':  R['brick'][90],
    'brand-soft': R['brick'][25],
    'brand-tint': R['brick'][20],
    'ok':         R['green'][80],
    'ok-ink':     R['green'][90],
    'ok-soft':    R['green'][20],
    'warn':       R['amber'][80],
    'warn-ink':   R['amber'][90],
    'warn-soft':  R['amber'][20],
    'bad':        R['red'][80],
    'bad-ink':    R['red'][90],
    'bad-soft':   R['red'][20],
    'focus':      R['brick'][80],
    'scrim':      'rgba(0,0,0,.55)',
}
# คู่ที่ใช้จริงบนจอ: (ตัวหน้า, พื้น, เกณฑ์, ใช้ที่ไหน)
PAIRS = [
    ('ink', 'bg', 4.5, 'ตัวหนังสือหลักบนพื้นแอป'),
    ('ink', 'surface', 4.5, 'ตัวหนังสือหลักบนการ์ด'),
    ('ink', 'surface-2', 4.5, 'ตัวหนังสือบนพื้นรอง'),
    ('ink', 'sunken', 4.5, 'ตัวหนังสือในช่องกรอก/พื้นยุบ'),
    ('ink-2', 'surface', 4.5, 'ตัวหนังสือรองบนการ์ด'),
    ('ink-2', 'bg', 4.5, 'ตัวหนังสือรองบนพื้นแอป'),
    ('ink-2', 'surface-2', 4.5, 'ตัวหนังสือรองบนพื้นรอง'),
    ('brand', 'surface', 4.5, 'ตัวหนังสือสีแบรนด์/ลิงก์บนการ์ด'),
    ('brand', 'bg', 4.5, 'ตัวหนังสือสีแบรนด์บนพื้นแอป'),
    ('on-brand', 'brand', 4.5, 'ตัวหนังสือบนปุ่มหลัก'),
    ('brand-ink', 'brand-soft', 4.5, 'ตัวหนังสือบนป้าย/เมนูที่เลือก'),
    ('brand-ink', 'brand-tint', 4.5, 'ตัวหนังสือบนพื้นแบรนด์อ่อน'),
    ('ok-ink', 'ok-soft', 4.5, 'ป้ายสถานะสำเร็จ'),
    ('warn-ink', 'warn-soft', 4.5, 'ป้ายสถานะต้องดู'),
    ('bad-ink', 'bad-soft', 4.5, 'ป้ายสถานะผิดปกติ'),
    ('ok', 'surface', 3.0, 'ไอคอน/ขอบสถานะสำเร็จ'),
    ('warn', 'surface', 3.0, 'ไอคอน/ขอบสถานะต้องดู'),
    ('bad', 'surface', 3.0, 'ไอคอน/ขอบสถานะผิดปกติ'),
    ('bad', 'surface', 4.5, 'ตัวหนังสือแดง (ยอดไม่ตรง) บนการ์ด'),
    ('edge', 'surface', 3.0, 'ขอบปุ่มรอง/ช่องกรอก'),
    ('edge', 'bg', 3.0, 'ขอบบนพื้นแอป'),
    ('focus', 'surface', 3.0, 'วงโฟกัสคีย์บอร์ด'),
    ('focus', 'bg', 3.0, 'วงโฟกัสบนพื้นแอป'),
    ('brand', 'surface', 3.0, 'ขอบ/ไอคอนแบรนด์'),
]

def check(mode, S):
    bad = []
    for fg, bg, need, use in PAIRS:
        r = ratio(S[fg], S[bg])
        if r < need:
            bad.append(f'  ✗ [{mode}] {fg} บน {bg} = {r:.2f} (ต้อง ≥ {need}) — {use}')
    return bad

def css():
    L = []
    A = L.append
    A('/* ═══════════════════════════════════════════════════════════════════════')
    A('   ระบบดีไซน์ โรงขวด P&K v2 · v2/design/tokens.css')
    A('   ⚠️ ไฟล์นี้สร้างโดย gen_tokens.py — ห้ามแก้มือ (CI ตรวจว่าตรงกับสคริปต์)')
    A('   กลไกเดียวกับระบบดีไซน์ "ละกอน" ของโรงน้ำ: tone ramp (Material 3) · spacing/type (Carbon) · แตะ ≥44px (HIG)')
    A('   ทุกคู่สีที่ใช้จริงผ่าน WCAG AA ทั้งโหมดสว่าง/มืด (ดูผลตรวจตอนรันสคริปต์)')
    A('   หน้าเว็บใช้ "สีตามหน้าที่" (--bg --ink --brand --ok …) · ramp (--brick-40 …) ไว้สำหรับกรณีพิเศษ')
    A('   ═══════════════════════════════════════════════════════════════════════ */')
    A(':root {')
    for name, seed, label, neu in FAMILIES:
        A(f'  /* {label} · ★ tone {PINS[name]} = {seed} */')
        A('  ' + ' '.join(f'--{name}-{t}: {R[name][t]};' for t in TONES))
    A('')
    A('  /* ── สีตามหน้าที่ · โหมดสว่าง ── */')
    for k, v in LIGHT.items():
        A(f'  --{k}: {v};')
    A('  color-scheme: light;')
    A('')
    A('  /* ── ระยะห่าง 8pt (Carbon) ── */')
    A('  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;')
    A('  /* ── ตัวอักษร: หัว/ตัวเลข = Anuphan · เนื้อ = Sarabun · ไทยต้อง line-height 1.5–1.7 ── */')
    A('  --font-display: "Anuphan", "Noto Sans Thai", system-ui, sans-serif;')
    A('  --font-body: "Sarabun", "Noto Sans Thai", system-ui, sans-serif;')
    A('  --fs-label: 13px; --fs-caption: 14px; --fs-body: 16px; --fs-h3: 18px; --fs-h2: 21px; --fs-h1: 26px; --fs-num: 20px; --fs-num-lg: 32px;')
    A('  --lh-tight: 1.25; --lh-head: 1.4; --lh-body: 1.65;')
    A('  /* ── รูปทรง · การแตะ · โฟกัส ── */')
    A('  --r-sm: 6px; --r-md: 10px; --r-lg: 16px; --r-xl: 22px; --r-full: 999px;')
    A('  --tap: 44px; --tap-lg: 56px; --focus-w: 3px;')
    A('  /* ── เงา (elevation · Material 3) ── */')
    A('  --elev-1: 0 1px 2px rgba(32,22,22,.06), 0 1px 3px rgba(32,22,22,.08);')
    A('  --elev-2: 0 1px 2px rgba(32,22,22,.06), 0 3px 8px rgba(32,22,22,.10);')
    A('  --elev-3: 0 2px 4px rgba(32,22,22,.08), 0 10px 24px rgba(32,22,22,.16);')
    A('  /* ── จังหวะเคลื่อนไหว (ปิดเองเมื่อ prefers-reduced-motion) ── */')
    A('  --ease: cubic-bezier(.2, 0, 0, 1); --ease-out: cubic-bezier(.05, .7, .1, 1);')
    A('  --dur-1: 120ms; --dur-2: 200ms; --dur-3: 320ms;')
    A('  --rail-w: 232px; --nav-h: 64px;')
    A('}')
    block = '\n'.join(f'  --{k}: {v};' for k, v in DARK.items())
    A('/* ── โหมดมืด: ตามเครื่อง (เว้นแต่ผู้ใช้เลือกสว่าง) หรือเลือกมืดเอง ── */')
    A('@media (prefers-color-scheme: dark) {')
    A('  :root:not([data-theme="light"]) {')
    A('\n'.join('  ' + l for l in block.split('\n')))
    A('    color-scheme: dark;')
    A('    --elev-1: 0 1px 2px rgba(0,0,0,.4); --elev-2: 0 2px 8px rgba(0,0,0,.45); --elev-3: 0 10px 28px rgba(0,0,0,.55);')
    A('  }')
    A('}')
    A(':root[data-theme="dark"] {')
    A(block)
    A('  color-scheme: dark;')
    A('  --elev-1: 0 1px 2px rgba(0,0,0,.4); --elev-2: 0 2px 8px rgba(0,0,0,.45); --elev-3: 0 10px 28px rgba(0,0,0,.55);')
    A('}')
    A('@media (prefers-reduced-motion: reduce) {')
    A('  :root { --dur-1: 0ms; --dur-2: 0ms; --dur-3: 0ms; }')
    A('}')
    return '\n'.join(L) + '\n'

def main():
    out = css()
    path = os.path.join(HERE, 'tokens.css')
    web = os.path.join(HERE, '..', 'web', 'assets', 'tokens.css')   # สำเนาที่หน้าเว็บโหลด (Pages เสิร์ฟเฉพาะ v2/web)
    errs = check('สว่าง', LIGHT) + check('มืด', DARK)
    if '--check' in sys.argv:
        cur = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
        curw = open(web, encoding='utf-8').read() if os.path.exists(web) else ''
        if cur != out or curw != out:
            print('✗ tokens.css ไม่ตรงกับ gen_tokens.py — รัน python3 v2/design/gen_tokens.py แล้ว commit')
            sys.exit(1)
    else:
        open(path, 'w', encoding='utf-8').write(out)
        open(web, 'w', encoding='utf-8').write(out)
        print('เขียน tokens.css แล้ว (design/ + web/assets/)')
    print('ตรวจคอนทราสต์ %d คู่ × 2 โหมด' % len(PAIRS))
    for mode, S in (('สว่าง', LIGHT), ('มืด', DARK)):
        worst = min(PAIRS, key=lambda p: ratio(S[p[0]], S[p[1]]) / p[2])
        print(f'  [{mode}] คู่ที่เฉียดสุด: {worst[0]} บน {worst[1]} = {ratio(S[worst[0]], S[worst[1]]):.2f} (เกณฑ์ {worst[2]})')
    if errs:
        print('\n'.join(errs))
        print('❌ มีคู่สีไม่ผ่าน WCAG AA')
        sys.exit(1)
    print('✅ ทุกคู่ผ่าน WCAG AA')

if __name__ == '__main__':
    main()
