import math
# ── sRGB <-> OKLab (Björn Ottosson) ──────────────────────────────
def f_inv(x): return x/12.92 if x <= 0.04045 else ((x+0.055)/1.055)**2.4
def f_fwd(x): return 12.92*x if x <= 0.0031308 else 1.055*(x**(1/2.4))-0.055
def hex2lin(h):
    h=h.lstrip('#'); return [f_inv(int(h[i:i+2],16)/255) for i in (0,2,4)]
def lin2oklab(r,g,b):
    l=0.4122214708*r+0.5363325363*g+0.0514459929*b
    m=0.2119034982*r+0.6806995451*g+0.1073969566*b
    s=0.0883024619*r+0.2817188376*g+0.6299787005*b
    l_,m_,s_=l**(1/3) if l>0 else 0, m**(1/3) if m>0 else 0, s**(1/3) if s>0 else 0
    return (0.2104542553*l_+0.7936177850*m_-0.0040720468*s_,
            1.9779984951*l_-2.4285922050*m_+0.4505937099*s_,
            0.0259040371*l_+0.7827717662*m_-0.8086757660*s_)
def oklab2lin(L,a,b):
    l_=L+0.3963377774*a+0.2158037573*b
    m_=L-0.1055613458*a-0.0638541728*b
    s_=L-0.0894841775*a-1.2914855480*b
    l,m,s=l_**3,m_**3,s_**3
    return (+4.0767416621*l-3.3077115913*m+0.2309699292*s,
            -1.2684380046*l+2.6097574011*m-0.3413193965*s,
            -0.0041960863*l-0.7034186147*m+1.7076147010*s)
def oklch2hex(L,C,H):
    a,b=C*math.cos(math.radians(H)),C*math.sin(math.radians(H))
    # ลด chroma ลงจนกว่าจะอยู่ในขอบเขต sRGB (gamut clip แบบรักษาสีและความสว่าง)
    for _ in range(60):
        r,g,bl=oklab2lin(L,a,b)
        if min(r,g,bl)>=-0.0005 and max(r,g,bl)<=1.0005: break
        a*=0.97; b*=0.97
    return '#'+''.join(f'{max(0,min(255,round(f_fwd(max(0,min(1,v)))*255))):02X}' for v in oklab2lin(L,a,b))
def hex2oklch(h):
    L,a,b=lin2oklab(*hex2lin(h))
    return L, math.hypot(a,b), math.degrees(math.atan2(b,a))%360
# ── contrast ─────────────────────────────────────────────────────
def srgb(c):
    c/=255; return c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
def lum(h):
    h=h.lstrip('#'); r,g,b=(int(h[i:i+2],16) for i in (0,2,4))
    return .2126*srgb(r)+.7152*srgb(g)+.0722*srgb(b)
def ratio(x,y):
    a,b=lum(x),lum(y); hi,lo=max(a,b),min(a,b); return (hi+.05)/(lo+.05)

# Material 3 ใช้ "tone" 0-100 (0=ดำ 100=ขาว) — ที่นี่ map tone -> ค่า L ของ OKLCh
TONES = [10,20,30,40,50,60,70,80,90,95,99]
BRANDS = {
  'sales':      ('#0369A1', 'ฟ้า — เซลส์ + โรงงาน + เงินเดือน'),
  'warehouse':  ('#C2410C', 'ส้ม — คลัง + ทีมผลิต'),
  'stock':      ('#0F766E', 'มิ้นต์ — สต๊อก & ผลิต'),
  'green':      ('#15803D', 'เขียว — สถานะปกติ/สำเร็จ'),
  'amber':      ('#B45309', 'เหลือง — สถานะเตือน'),
  'red':        ('#B91C1C', 'แดง — สถานะผิดพลาด'),
  'neutral':    ('#6B645E', 'เทาอุ่น — ตัวหนังสือรอง/เส้น/พื้น'),
}
out={}
print("Tone ramp (Material 3 style · คำนวณใน OKLCh แล้วตรึงเป็น hex — ไม่พึ่ง oklch() ของเบราว์เซอร์)\n")
for key,(seed,label) in BRANDS.items():
    _,C,H = hex2oklch(seed)
    # neutral คุม chroma ต่ำคงที่ · สีแบรนด์ให้ chroma ลดลงที่ปลายสว่าง/มืด (เหมือน M3)
    ramp={}
    for t in TONES:
        L = (t + 16) / 116   # tone ของ M3 = CIE L* · สีเทา: OKLab L = (L*+16)/116
        if key=='neutral': c = 0.012
        else:
            # chroma สูงสุดช่วงกลาง ค่อย ๆ ลดที่ปลายทั้งสอง
            c = C * (1 - abs(L-0.55)/0.62)**1.15
            c = max(c, 0.012)
        ramp[t]=oklch2hex(L,c,H)
    out[key]=ramp
    print(f"── {key:<10} {label}")
    print("   " + "  ".join(f"{t}:{ramp[t]}" for t in TONES))
    if key!='neutral':
        print(f"   ตรวจคู่หลัก: ขาวบน tone40 = {ratio('#FFFFFF',ramp[40]):.2f} · "
              f"tone40 บนขาว = {ratio(ramp[40],'#FFFFFF'):.2f} · "
              f"tone30 บน tone95 = {ratio(ramp[30],ramp[95]):.2f}")
    print()
import json; json.dump(out, open('ramps.json','w'))
