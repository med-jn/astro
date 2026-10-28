#!/usr/bin/env python3
"""
يولّد نسيج مرج قابلاً للتكرار (1 م × 1 م) لأرض «عين الراصد»: شفرات عشب مفردة (آلاف الأقواس المدبّبة بلون وطول واتجاه متفاوت)،
طبقة قش يابس، تربة تحتها، أزهار صغيرة، وظلال متبادلة (AO) من خريطة الارتفاع. المخرجات:
  public/textures/ground_albedo.jpg  (sRGB، 1024²)    public/textures/ground_normal.png (ناظم مماسي، 1024²)
تشغيل: python3 tools/make_ground_textures.py   (يحتاج numpy وPillow)
"""
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2048            # دقة الرسم (تُصغَّر إلى 1024 بتنعيم)
OUT = 1024
rng = np.random.default_rng(20260723)
OUTDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'textures')
os.makedirs(OUTDIR, exist_ok=True)

def tileable_noise(n, beta, seed):
    r = np.random.default_rng(seed)
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, f)
    amp = 1.0 / np.maximum(np.sqrt(fx * fx + fy * fy), 1.0 / n) ** beta
    amp[0, 0] = 0
    z = np.fft.ifft2(np.fft.fft2(r.standard_normal((n, n))) * amp).real
    z = (z - z.min()) / (z.max() - z.min())
    return z

# ---------- التربة والقش (الطبقة السفلى)
soil_lo = tileable_noise(S, 2.2, 1); soil_hi = tileable_noise(S, 1.0, 2)
base = np.zeros((S, S, 3), np.float32)
soil = np.array([88, 70, 50], np.float32)
base[:] = soil
base *= (0.55 + 0.9 * soil_lo[..., None]) * (0.85 + 0.3 * soil_hi[..., None])
albedo = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), 'RGB')
height = Image.new('L', (S, S), 18)
dA, dH = ImageDraw.Draw(albedo), ImageDraw.Draw(height)

def blade(x, y, theta, L, w0, curv, col, hmax, segs=7):
    dx, dy = math.cos(theta), math.sin(theta)
    px, py = -dy, dx
    pts = []
    for i in range(segs + 1):
        t = i / segs
        cx = x + dx * L * t + px * curv * L * t * t
        cy = y + dy * L * t + py * curv * L * t * t
        # مماس تقريبي
        tx = dx + 2 * px * curv * t; ty = dy + 2 * py * curv * t
        tl = math.hypot(tx, ty) or 1
        nx, ny = -ty / tl, tx / tl
        w = w0 * (1 - t) ** 0.75 + 0.35
        pts.append((cx, cy, nx * w * 0.5, ny * w * 0.5))
    for i in range(segs):
        a, b = pts[i], pts[i + 1]
        t = (i + 0.5) / segs
        shade = 0.42 + 0.62 * t ** 0.75
        c = tuple(int(max(0, min(255, v * shade))) for v in col)
        poly = [(a[0] + a[2], a[1] + a[3]), (b[0] + b[2], b[1] + b[3]), (b[0] - b[2], b[1] - b[3]), (a[0] - a[2], a[1] - a[3])]
        dA.polygon(poly, fill=c)
        hh = int(18 + (hmax - 18) * t)
        dH.polygon(poly, fill=hh)

def draw_wrapped(x, y, *args):
    xs = [x] + ([x - S] if x > S - 380 else []) + ([x + S] if x < 380 else [])
    ys = [y] + ([y - S] if y > S - 380 else []) + ([y + S] if y < 380 else [])
    for xx in xs:
        for yy in ys:
            blade(xx, yy, *args)

def gcol(kind):
    if kind == 0:   # أخضر عميق
        return (rng.uniform(52, 82), rng.uniform(96, 134), rng.uniform(26, 48))
    if kind == 1:   # أخضر مصفرّ
        return (rng.uniform(96, 128), rng.uniform(124, 150), rng.uniform(34, 56))
    if kind == 2:   # قش يابس
        return (rng.uniform(150, 182), rng.uniform(126, 154), rng.uniform(66, 92))
    return (rng.uniform(70, 96), rng.uniform(80, 104), rng.uniform(36, 56))  # بني ذابل

# ---------- قش يابس منبطح (طبقة وسطى)
for _ in range(9000):
    x, y = rng.uniform(0, S), rng.uniform(0, S)
    draw_wrapped(x, y, rng.uniform(0, 2 * math.pi), rng.uniform(70, 170), rng.uniform(3.0, 5.5), rng.uniform(-0.25, 0.25), gcol(2 if rng.random() < 0.7 else 3), 60, 5)

# ---------- شفرات العشب الخضراء
N = 38000
order = rng.permutation(N)
for k in order:
    x, y = rng.uniform(0, S), rng.uniform(0, S)
    kind = 0 if rng.random() < 0.62 else (1 if rng.random() < 0.7 else (2 if rng.random() < 0.6 else 3))
    L = rng.uniform(90, 300) * (0.8 if kind >= 2 else 1.0)
    draw_wrapped(x, y, rng.uniform(0, 2 * math.pi), L, rng.uniform(4.5, 9.0), rng.uniform(-0.55, 0.55), gcol(kind), rng.uniform(150, 255))

# ---------- أزهار برية صغيرة (بياض وأصفر) وبراعم
for _ in range(26):
    x, y = rng.uniform(40, S - 40), rng.uniform(40, S - 40)
    yellow = rng.random() < 0.55
    pc = (236, 206, 60) if yellow else (240, 238, 228)
    r = rng.uniform(7, 13)
    for a in np.linspace(0, 2 * math.pi, 6, endpoint=False) + rng.uniform(0, 1):
        ex, ey = x + math.cos(a) * r * 0.9, y + math.sin(a) * r * 0.9
        dA.ellipse([ex - r * 0.55, ey - r * 0.55, ex + r * 0.55, ey + r * 0.55], fill=pc)
        dH.ellipse([ex - r * 0.55, ey - r * 0.55, ex + r * 0.55, ey + r * 0.55], fill=200)
    dA.ellipse([x - r * 0.4, y - r * 0.4, x + r * 0.4, y + r * 0.4], fill=(214, 150, 30) if not yellow else (196, 120, 10))

# ---------- ظلال متبادلة من الارتفاع، ثم الخرج
h = np.asarray(height.filter(ImageFilter.GaussianBlur(10)), np.float32) / 255.0
ao = 0.50 + 0.50 * np.clip((h - 0.06) / 0.5, 0, 1) ** 0.8
arr = np.asarray(albedo, np.float32) * ao[..., None]
albedo = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB').resize((OUT, OUT), Image.LANCZOS)
albedo.save(os.path.join(OUTDIR, 'ground_albedo.jpg'), quality=91, subsampling=0)

hs = np.asarray(height.filter(ImageFilter.GaussianBlur(1.2)).resize((OUT, OUT), Image.LANCZOS), np.float32) / 255.0
gx = (np.roll(hs, -1, 1) - np.roll(hs, 1, 1)) * 0.5; gy = (np.roll(hs, -1, 0) - np.roll(hs, 1, 0)) * 0.5
k = 7.0
nrm = np.stack([-gx * k, -gy * k, np.ones_like(hs)], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8), 'RGB').save(os.path.join(OUTDIR, 'ground_normal.png'), optimize=True)

m = np.asarray(albedo, np.float32).reshape(-1, 3).mean(0)
print('mean sRGB albedo:', [round(float(v), 1) for v in m], 'mean linear:', [round(float((v / 255) ** 2.2), 4) for v in m])
