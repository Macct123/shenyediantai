# -*- coding: utf-8 -*-
"""把渲染好的 SVG 底图做成厚涂质感位图，并编码开篇 mp4。
输入：%TEMP%\\paint\\*.png
输出：assets/*.jpg, assets/closeups/*.jpg, assets/intro.mp4
"""
import os
import sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

SRC = os.path.join(os.environ.get('TEMP', '.'), 'paint')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

FONT_REG = 'C:/Windows/Fonts/msyh.ttc'
FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'

# 特写里的文字直接烧进图片，不再用 HTML 浮层（避免"字浮在实物上"）
CLOSEUP_TEXTS = {
    'chart': [
        {'text': '旧频道  100.0', 'x': 55, 'y': 46, 'size': 26, 'rot': -4, 'style': 'red'},
    ],
    'note': [
        {'text': '别在雾里关灯。', 'x': 28, 'y': 28, 'size': 26, 'rot': -2, 'style': 'pencil'},
        {'text': '他们认灯，不认声音。', 'x': 28, 'y': 37, 'size': 24, 'rot': -2, 'style': 'pencil'},
        {'text': '—— 没有名字', 'x': 30, 'y': 52, 'size': 18, 'rot': -2, 'style': 'pencil'},
    ],
    'plate': [
        {'text': '潮汐镇广播电台 · 夜班机', 'x': 24, 'y': 35, 'size': 23, 'rot': -4, 'style': 'engrave'},
        {'text': '本机刻度已按新标准下调 6.3MHz', 'x': 24, 'y': 44, 'size': 17, 'rot': -4, 'style': 'engrave'},
        {'text': '旧频道请自行换算', 'x': 26, 'y': 52, 'size': 16, 'rot': -4, 'style': 'engrave'},
    ],
    'letter': [
        {'text': '潮汐镇广播电台 · 夜班', 'x': 30, 'y': 60, 'size': 18, 'rot': -2, 'style': 'pencil'},
    ],
}


def bake_text(img, items, seed=5):
    """把刻字/铅笔字烧进图，保留一点纸面颗粒，避免像贴上去的。"""
    if not items:
        return img

    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    base = Image.fromarray(rgb).convert('RGBA')
    W, H = base.size
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    for it in items:
        size = int(round(it['size'] * 1.22))
        engrave = it.get('style') == 'engrave'
        try:
            font = ImageFont.truetype(FONT_BOLD if engrave else FONT_REG, size)
        except Exception:
            font = ImageFont.truetype(FONT_REG, size)
        text = it['text']

        try:
            l, t, r, b = draw.textbbox((0, 0), text, font=font)
            tw, th = r - l, b - t
            ox, oy = l, t
        except AttributeError:
            tw, th = draw.textsize(text, font=font)
            ox = oy = 0

        pad = 10
        tile = Image.new('RGBA', (int(tw) + pad * 2, int(th) + pad * 2), (0, 0, 0, 0))
        td = ImageDraw.Draw(tile)

        if engrave:
            # 刻字：凹槽暗线 + 下沿高光
            td.text((pad - ox, pad - oy + 1), text, font=font, fill=(232, 238, 242, 110))
            td.text((pad - ox, pad - oy), text, font=font, fill=(44, 60, 70, 232))
        elif it.get('style') == 'red':
            # 红铅笔批注：暗底海图上必须自己会亮
            td.text((pad - ox, pad - oy), text, font=font, fill=(172, 78, 62, 232))
        else:
            td.text((pad - ox, pad - oy), text, font=font, fill=(46, 44, 38, 234))

        tile = tile.rotate(-it.get('rot', 0), resample=Image.BICUBIC, expand=False)

        cx = it['x'] / 100.0 * W + tw / 2.0
        cy = it['y'] / 100.0 * H + th / 2.0
        layer.alpha_composite(tile, (int(round(cx - tile.width / 2.0)),
                                     int(round(cy - tile.height / 2.0))))

    # 用一层噪点啃掉一点墨色，让它和纸/金属的颗粒一致
    a = np.array(layer, dtype=np.float32)
    rng = np.random.RandomState(seed)
    n = rng.rand(H, W).astype(np.float32)
    n = cv2.GaussianBlur(n, (0, 0), 1.2)
    n = np.clip(n * 1.35 + 0.12, 0.55, 1.0)
    a[..., 3] *= n
    layer = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')

    out = Image.alpha_composite(base, layer).convert('RGB')
    return cv2.cvtColor(np.array(out), cv2.COLOR_RGB2BGR)


def fbm(h, w, octaves=5, base=5, seed=0):
    rng = np.random.RandomState(seed)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        gw = max(2, base * (2 ** o))
        gh = max(2, int(round(gw * h / float(w))))
        g = rng.rand(gh, gw).astype(np.float32)
        g = cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)
        out += g * amp
        total += amp
        amp *= 0.55
    out /= max(total, 1e-6)
    return out


def warp(img, amp=6.0, seed=3):
    h, w = img.shape[:2]
    nx = fbm(h, w, 4, 3, seed) * 2.0 - 1.0
    ny = fbm(h, w, 4, 3, seed + 1) * 2.0 - 1.0
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    mapx = (xx + nx * amp).astype(np.float32)
    mapy = (yy + ny * amp).astype(np.float32)
    return cv2.remap(img, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def painterly(img, seed=1, texture=7.0, detail=0.5, sigma=2.0):
    h, w = img.shape[:2]
    base_img = warp(img, 6.0, seed)

    # 风格化 + 保边平滑：打散矢量直边，得到笔触团块
    styl = cv2.stylization(base_img, 52, 0.2)
    epf = cv2.edgePreservingFilter(base_img, cv2.RECURS_FILTER, 60, 0.38)
    base = cv2.addWeighted(styl, 0.62, epf, 0.38, 0)

    # 找回一些结构细节，避免糊成一片
    blur = cv2.GaussianBlur(base_img, (0, 0), sigma)
    f = base.astype(np.float32) + detail * (base_img.astype(np.float32) - blur.astype(np.float32))

    # 画布纹理 + 颗粒
    n = fbm(h, w, 5, 6, seed + 5)
    n = (n - n.mean()) * 2.0
    f = f * (1.0 + n[..., None] * 0.06) + n[..., None] * texture * 0.45
    return np.clip(f, 0, 255).astype(np.uint8)


def bloom(img, thresh=196, sigma=20, amount=0.34):
    f = img.astype(np.float32)
    lum = f.max(axis=2)
    mask = (lum > thresh).astype(np.float32)
    hi = f * mask[..., None]
    hi = cv2.GaussianBlur(hi, (0, 0), sigma)
    return np.clip(f + hi * amount, 0, 255).astype(np.uint8)


def grade(img):
    f = img.astype(np.float32) / 255.0
    b, g, r = cv2.split(f)
    r = np.clip(r * 1.035 + 0.010, 0, 1)
    g = np.clip(g * 1.005 + 0.003, 0, 1)
    b = np.clip(b * 1.06 + 0.018 * (1.0 - b), 0, 1)
    f = cv2.merge([b, g, r])
    f = np.clip((f - 0.5) * 1.06 + 0.5, 0, 1)
    return (f * 255).astype(np.uint8)


def chroma(img, shift=1.4):
    h, w = img.shape[:2]
    b, g, r = cv2.split(img)
    mb = np.float32([[1, 0, shift], [0, 1, 0]])
    mr = np.float32([[1, 0, -shift], [0, 1, 0]])
    b = cv2.warpAffine(b, mb, (w, h), borderMode=cv2.BORDER_REPLICATE)
    r = cv2.warpAffine(r, mr, (w, h), borderMode=cv2.BORDER_REPLICATE)
    return cv2.merge([b, g, r])


def grain(img, amount=3.6):
    n = np.random.normal(0, amount, img.shape[:2]).astype(np.float32)
    return np.clip(img.astype(np.float32) + n[..., None], 0, 255).astype(np.uint8)


def vignette(img, strength=0.55, power=2.0):
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = (xx - w / 2.0) / (w * 0.62)
    dy = (yy - h / 2.0) / (h * 0.62)
    d = np.clip(np.sqrt(dx * dx + dy * dy), 0, 2.0)
    v = np.clip(1.0 - strength * (d ** power), 0.12, 1.0)[..., None]
    return np.clip(img.astype(np.float32) * v, 0, 255).astype(np.uint8)


def process(name, dst, camera=False, seed=1, texture=7.0, detail=0.42,
            bloom_amount=0.34, vig=0.55, grain_amount=3.6, touch_warm=True,
            texts=None):
    src = os.path.join(SRC, name + '.png')
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        print('MISS', src)
        return False

    img = painterly(img, seed=seed, texture=texture, detail=detail)
    img = bloom(img, amount=bloom_amount)
    img = grade(img)
    if touch_warm:
        # 暖光提亮：把高光轻微偏琥珀
        f = img.astype(np.float32)
        lum = f.mean(axis=2, keepdims=True) / 255.0
        warm = np.array([0.90, 0.94, 1.06], np.float32)  # BGR
        f = f * (1.0 + (warm - 1.0) * (lum ** 2))
        img = np.clip(f, 0, 255).astype(np.uint8)
    img = chroma(img, 1.2)
    img = vignette(img, vig)
    img = grain(img, grain_amount)
    if texts:
        img = bake_text(img, texts, seed=seed + 40)

    out = os.path.join(ROOT, dst)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cv2.imwrite(out, img, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    print('OK', dst, img.shape[1], 'x', img.shape[0])
    return True


def add_rain(frame, i, strength=0.5):
    h, w = frame.shape[:2]
    rng = np.random.RandomState(1000 + i)
    layer = frame.copy()
    for _ in range(120):
        x = int(rng.rand() * w)
        y = int(rng.rand() * h)
        ln = int(30 + rng.rand() * 90)
        dx = int(4 + rng.rand() * 6)
        cv2.line(layer, (x, y), (x + dx, y + ln), (208, 224, 238), 1, cv2.LINE_AA)
    return cv2.addWeighted(layer, strength, frame, 1 - strength, 0)


def make_intro(seconds=8, fps=24):
    src = os.path.join(SRC, 'exterior.png')
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        img = cv2.imread(os.path.join(ROOT, 'assets', 'bg_intro.jpg'), cv2.IMREAD_COLOR)
    if img is None:
        print('MISS exterior')
        return False

    W, H = 960, 540
    # 只风格化一次；镜头运动用浮点仿射变换完成，避免逐帧重采样造成的抖动
    big = cv2.resize(img, (int(W * 2.4), int(H * 2.4)), interpolation=cv2.INTER_CUBIC)
    big = bloom(painterly(big, seed=7, texture=6.0, detail=0.4), amount=0.3)
    big = grade(big)

    bh, bw = big.shape[:2]
    out_dir = os.path.join(ROOT, 'assets', 'intro')
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.lower().endswith('.jpg'):
            os.remove(os.path.join(out_dir, f))

    base = W / float(bw)
    n = seconds * fps
    for i in range(n):
        t = i / float(n - 1)

        # 两次 smoothstep：起落都没有生硬的加速/刹车
        ease = t * t * (3.0 - 2.0 * t)
        ease = ease * ease * (3.0 - 2.0 * ease)

        zoom = 1.42 + 0.30 * ease
        cx = bw * (0.38 + 0.14 * ease)
        cy = bh * (0.648 - 0.188 * ease)

        s = base * zoom
        # 把相机中心夹在图内，杜绝边缘拉伸
        half_w = (W * 0.5) / s
        half_h = (H * 0.5) / s
        cx = float(np.clip(cx, half_w, bw - half_w))
        cy = float(np.clip(cy, half_h, bh - half_h))

        M = np.float32([[s, 0.0, W * 0.5 - cx * s],
                        [0.0, s, H * 0.5 - cy * s]])
        frame = cv2.warpAffine(big, M, (W, H), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REPLICATE)

        frame = np.clip(frame.astype(np.float32) * (0.64 + 0.40 * ease), 0, 255).astype(np.uint8)

        cv2.imwrite(os.path.join(out_dir, 'f%03d.jpg' % (i + 1)), frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), 86])
    print('OK intro frames', n)
    return True


def main():
    ok = True
    # 背景
    ok &= process('exterior', 'assets/bg_menu.jpg', seed=13, texture=7.5,
                  detail=0.45, bloom_amount=0.42, vig=0.5, grain_amount=3.6)
    ok &= process('exterior', 'assets/bg_intro.jpg', seed=17, texture=7.0,
                  detail=0.4, bloom_amount=0.34, vig=0.62, grain_amount=3.2)

    # 特写
    closeups = ['radio', 'denoise', 'phone', 'plate', 'chart', 'note', 'letter', 'cabinet']
    for idx, name in enumerate(closeups):
        ok &= process(name, 'assets/closeups/%s.jpg' % name, seed=21 + idx,
                      texture=5.5, detail=0.55, bloom_amount=0.26,
                      vig=0.5, grain_amount=3.2, texts=CLOSEUP_TEXTS.get(name))

    ok &= make_intro(8, 24)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
