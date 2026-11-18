#!/usr/bin/env python3
"""生成 README 用的三张配图（纯 PIL 绘制，不依赖网络与浏览器）。

    python3 scripts/readme-images.py

产出：
    docs/assets/readme-hero.png      1200×560  首图：标题 + 说明 + 面板实样
    docs/assets/readme-pipeline.png  1200×360  数据链路：两个来源 → catalog.json → 面板 → 对话
    docs/assets/readme-steps.png     1200×260  三步上手

风格沿用上游清单站（openfcp/awesome-financial-skills）的纸感浅底 + 深绿点缀，
保证两份 README 放在一起像同一套东西。所有坐标按 1x 写，统一 2x 超采样后缩回，
所以文字边缘不会发毛。
"""

import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SCALE = 2
W, H = 1200, 560

# —— 色板：与上游清单站的纸感浅底 + 深绿一致 ——
PAPER = "#F7F5EF"
PAPER_2 = "#EFEDE3"
CARD = "#FFFFFF"
INK = "#1B221E"
BODY = "#4E5A53"
MUTED = "#8B929A"
LINE = "#E3DFD2"
GREEN = "#0F5C4A"
GREEN_2 = "#3D8A76"
GREEN_3 = "#8FB3A5"
GREEN_4 = "#CFE0D8"
RED = "#A63A28"
RED_BG = "#FBEDEA"
RED_LINE = "#E4B7AE"

FONT_CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"
FONT_MONO = "/System/Library/Fonts/Menlo.ttc"

_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT_DIR = os.path.join(_root, "docs", "assets")


def f_cjk(size, bold=False):
    return ImageFont.truetype(FONT_CJK, int(size * SCALE), index=1 if bold else 0)


def f_mono(size):
    return ImageFont.truetype(FONT_MONO, int(size * SCALE), index=0)


def px(v):
    return int(round(v * SCALE))


def canvas(w, h):
    img = Image.new("RGB", (px(w), px(h)), PAPER)
    return img, ImageDraw.Draw(img)


def dots(draw, w, h, step=26, color="#E8E3D5"):
    """纸面细点阵，给纯色底一点质感。"""
    for y in range(px(12), px(h), px(step)):
        for x in range(px(12), px(w), px(step)):
            r = px(0.85)
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def shadowed_round(img, box, radius, fill=CARD, outline=LINE, blur=10, alpha=26, offset=6, ow=1):
    """带柔和投影的圆角卡片。"""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    b = [px(box[0]), px(box[1] + offset), px(box[2]), px(box[3] + offset)]
    d.rounded_rectangle(b, radius=px(radius), fill=(30, 40, 34, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(px(blur)))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))
    d2 = ImageDraw.Draw(img)
    d2.rounded_rectangle([px(v) for v in box], radius=px(radius), fill=fill,
                         outline=outline, width=px(ow))


def text(draw, xy, s, font, fill=BODY, anchor="la"):
    draw.text((px(xy[0]), px(xy[1])), s, font=font, fill=fill, anchor=anchor)


def tracked(draw, xy, s, font, fill=MUTED, spacing=2.4, anchor="la"):
    """字距加宽的小号全大写。"""
    x, y = xy
    for ch in s:
        draw.text((px(x), px(y)), ch, font=font, fill=fill, anchor=anchor)
        x += font.getlength(ch) / SCALE + spacing


def track_width(s, font, spacing):
    return sum(font.getlength(ch) / SCALE for ch in s) + spacing * max(0, len(s) - 1)


def pill(draw, x, y, label, font, fg=BODY, bg=CARD, line=LINE, padx=6, h=16):
    w = font.getlength(label) / SCALE + padx * 2
    draw.rounded_rectangle([px(x), px(y), px(x + w), px(y + h)], radius=px(h / 2),
                           fill=bg, outline=line, width=px(1))
    text(draw, (x + padx, y + h / 2), label, font, fg, anchor="lm")
    return w


def solid_pill(draw, x, y, label, font, fg, bg, line, padx=7, h=17):
    w = font.getlength(label) / SCALE + padx * 2
    draw.rounded_rectangle([px(x), px(y), px(x + w), px(y + h)], radius=px(h / 2),
                           fill=bg, outline=line, width=px(1))
    text(draw, (x + padx, y + h / 2), label, font, fg, anchor="lm")
    return w


def mark(draw, x, y, unit=20, gap=4, hi=GREEN, mid=GREEN_2, low=GREEN_3, faint=GREEN_4):
    """四块圆角方 + 半圆凸榫，和插件 banner 里的标识同构。"""
    r = unit * 0.3
    half = unit / 2
    blocks = [(x, y, hi, "r"), (x + unit + gap, y, mid, "d"),
              (x, y + unit + gap, low, "u"), (x + unit + gap, y + unit + gap, faint, "l")]
    for bx, by, color, knob in blocks:
        draw.rounded_rectangle([px(bx), px(by), px(bx + unit), px(by + unit)],
                               radius=px(r), fill=color)
        kr = unit * 0.2
        cx = bx + half + (half if knob == "r" else -half if knob == "l" else 0)
        cy = by + half + (half if knob == "d" else -half if knob == "u" else 0)
        draw.ellipse([px(cx - kr), px(cy - kr), px(cx + kr), px(cy + kr)], fill=color)


# ---------------------------------------------------------------- hero
def draw_panel(img, draw, x, y, w, h):
    shadowed_round(img, (x, y, x + w, y + h), 16, outline=LINE, blur=14, alpha=30, offset=8)
    d = draw
    pad = 16
    right = x + w - pad

    # banner：标识 + 标题 + 右侧统计胶囊
    mark(d, x + pad, y + 16, unit=13, gap=2.6)
    text(d, (x + pad + 32, y + 19), "金融行业skills精选", f_cjk(13.5, True), INK)
    badge = "9 个分类 · 171 个技能"
    bf = f_cjk(8.5)
    bw = bf.getlength(badge) / SCALE + 16
    d.rounded_rectangle([px(right - bw), px(y + 18), px(right), px(y + 18 + 17)],
                        radius=px(8.5), fill=CARD, outline=LINE, width=px(1))
    text(d, (right - bw + 8, y + 26.5), badge, bf, MUTED, anchor="lm")

    # meta 行：数据源 · 更新 ·「实时」+ 紧贴其右的红色「刷新」
    my = y + 46
    mf = f_cjk(8.2)
    text(d, (x + pad, my), "数据源 ", mf, "#A9AFA8")
    repo = "openfcp/awesome-financial-skills"
    text(d, (x + pad + 31, my), repo, mf, BODY)
    dot_x = x + pad + 31 + mf.getlength(repo) / SCALE + 8
    text(d, (dot_x, my), "·", mf, "#C9CCBE")
    text(d, (dot_x + 8, my), "更新 2026-11-18", mf, BODY)
    # 右对齐：从右往左先放刷新，再放实时
    refresh_w = f_cjk(8).getlength("刷新") / SCALE + 16
    solid_pill(d, right - refresh_w, my - 6, "刷新", f_cjk(8), RED, RED_BG, RED_LINE, padx=8, h=15)
    fresh_w = f_cjk(8).getlength("实时") / SCALE + 14
    solid_pill(d, right - refresh_w - 6 - fresh_w, my - 6, "实时", f_cjk(8),
               GREEN, "#EAF3EF", "#C9DED6", padx=7, h=15)

    # 搜索（左）+ 视图切换（右）
    sy = my + 22
    d.rounded_rectangle([px(x + pad), px(sy), px(x + pad + 196), px(sy + 21)],
                        radius=px(6), fill=PAPER, outline=LINE, width=px(1))
    d.ellipse([px(x + pad + 8), px(sy + 7), px(x + pad + 14), px(sy + 13)],
              outline="#9AA3A0", width=px(1))
    text(d, (x + pad + 20, sy + 10.5), "搜索名称、摘要、标签或作者", f_cjk(8), "#A9AFA8", anchor="lm")
    seg_x = right - 104
    d.rounded_rectangle([px(seg_x), px(sy), px(right), px(sy + 21)], radius=px(6), fill=PAPER_2)
    d.rounded_rectangle([px(seg_x + 2), px(sy + 2), px(seg_x + 54), px(sy + 19)],
                        radius=px(5), fill=CARD, outline="#E8E4D7", width=px(1))
    text(d, (seg_x + 9, sy + 10.5), "全部插件", f_cjk(7.6), INK, anchor="lm")
    text(d, (seg_x + 60, sy + 10.5), "已安装 (2)", f_cjk(7.6), MUTED, anchor="lm")

    # 分类胶囊
    cy = sy + 30
    cx = x + pad
    for label, active in (("全部 171", True), ("消费者保护 12", False), ("合规与法律 21", False)):
        cf = f_cjk(7.6)
        cw = cf.getlength(label) / SCALE + 14
        d.rounded_rectangle([px(cx), px(cy), px(cx + cw), px(cy + 17)], radius=px(8.5),
                            fill=PAPER_2 if active else CARD, outline=LINE, width=px(1))
        text(d, (cx + 7, cy + 8.5), label, cf, INK if active else MUTED, anchor="lm")
        cx += cw + 6

    # 三张长条卡：名称 + 英文名 / 右上角作者与核验日期 / 四枚胶囊 / 右侧定宽动作
    cards = [
        ("消保审查", "Consumer Protection Review", ["消费者保护", "SkillHub", "1.0.0", "专有"],
         "consumer-protection-review", True),
        ("公文写作", "Official Document", ["办公与设计", "GitHub", "0.3.2", "MIT"], "", False),
        ("深度研究", "Deep Research", ["研究与分析", "SkillHub", "2.1.0", "MIT"], "", False),
    ]
    cy += 26
    ch, gap = 90, 10
    for name, en, chips, invoke, installed in cards:
        d.rounded_rectangle([px(x + pad), px(cy), px(right), px(cy + ch)],
                            radius=px(10), fill=CARD,
                            outline=GREEN_2 if installed else LINE, width=px(1.2 if installed else 1))
        nf = f_cjk(9.6, True)
        text(d, (x + pad + 12, cy + 12), name, nf, INK)
        text(d, (x + pad + 12 + nf.getlength(name) / SCALE + 7, cy + 14), en, f_cjk(6.6), "#A9AFA8")

        # 右上角：作者 / 核验日期（定宽两列，跨卡对齐）
        fx = right - 158
        ff = f_cjk(6.6)
        text(d, (fx, cy + 13), "作者", ff, "#B3B8B0")
        text(d, (fx + 21, cy + 13), "八大权益", ff, BODY)
        text(d, (fx + 63, cy + 13), "核验日期", ff, "#B3B8B0")
        text(d, (fx + 99, cy + 13), "2026-11-18", ff, BODY)

        # 四枚胶囊
        chip_x = x + pad + 12
        for chip in chips:
            chip_x += pill(d, chip_x, cy + 31, chip, f_cjk(6.4), "#5B6660", CARD, "#DCD7C9",
                           padx=5, h=14) + 4

        # 调用名行（已安装）
        if installed:
            vw = f_cjk(6.4).getlength("已安装") / SCALE + 12
            solid_pill(d, x + pad + 12, cy + 60, "已安装", f_cjk(6.4), GREEN, "#EAF3EF", "#C9DED6",
                       padx=6, h=14)
            text(d, (x + pad + 12 + vw + 6, cy + 67), "调用名", f_cjk(6.4), GREEN, anchor="lm")
            text(d, (x + pad + 12 + vw + 30, cy + 67), invoke, f_mono(6.2), "#6C7A72", anchor="lm")

        # 动作：统一垂直居中
        bh = 17
        by = cy + ch / 2 - bh / 2
        if installed:
            d.rounded_rectangle([px(right - 12 - 44), px(by), px(right - 12), px(by + bh)],
                                radius=px(5), fill=CARD, outline="#CFCABA", width=px(1))
            text(d, (right - 12 - 34, by + bh / 2), "卸载", f_cjk(6.6), BODY, anchor="mm")
        else:
            d.rounded_rectangle([px(right - 12 - 84), px(by), px(right - 12 - 44), px(by + bh)],
                                radius=px(5), fill=CARD, outline="#CFCABA", width=px(1))
            text(d, (right - 12 - 64, by + bh / 2), "详情", f_cjk(6.6), BODY, anchor="mm")
            d.rounded_rectangle([px(right - 12 - 38), px(by), px(right - 12), px(by + bh)],
                                radius=px(5), fill=GREEN, outline=GREEN, width=px(1))
            text(d, (right - 12 - 19, by + bh / 2), "安装", f_cjk(6.6), "#FFFFFF", anchor="mm")
        cy += ch + gap

    # 页脚
    d.line([px(x + pad), px(cy + 2), px(right), px(cy + 2)], fill=LINE, width=px(1))
    text(d, (x + pad, cy + 10), "更新 2026-11-18 · 共 171 个 · 已安装 2 个", f_cjk(7), "#A9AFA8")


def hero():
    img, d = canvas(W, H)
    dots(d, W, H)

    mark(d, 64, 52, unit=19, gap=4)
    text(d, (64, 132), "金融技能", f_cjk(44, True), INK)
    tracked(d, (66, 196), "FINANCIAL SKILLS FOR DSH", f_cjk(8.6), "#7E8B84", spacing=2.6)

    d.line([px(64), px(222), px(120), px(222)], fill=GREEN, width=px(2))

    text(d, (64, 250), "DSH 里的技能越来越多，", f_cjk(15.5), INK)
    text(d, (64, 278), "能直接上手的却没几个。", f_cjk(15.5), INK)
    text(d, (64, 322), "我们把散在 GitHub 与 SkillHub 上、被真实用过、下载量高的金融技能挑出来，", f_cjk(10.2), BODY)
    text(d, (64, 342), "按 9 类业务场景摆进一页——从海量 skill 里迅速挑到能上手的那一个。", f_cjk(10.2), BODY)

    stats = [("171", "项精选技能"), ("9", "类业务场景"), ("2", "个可信来源"), ("1", "键装进对话")]
    sx = 64
    for i, (num, label) in enumerate(stats):
        text(d, (sx, 400), num, f_cjk(26, True), GREEN)
        text(d, (sx, 440), label, f_cjk(9.6), "#8B929A")
        if i < len(stats) - 1:
            d.line([px(sx + 74), px(402), px(sx + 74), px(442)], fill="#E1DDD0", width=px(1))
        sx += 96

    text(d, (64, 500), "清单来自 openfcp/awesome-financial-skills · 只存坐标，不搬运正文", f_cjk(8.4), "#A9AFA8")

    draw_panel(img, d, 596, 36, 556, 456)
    return img


# ---------------------------------------------------------------- pipeline
def pipeline():
    w, h = 1200, 380
    img, d = canvas(w, h)
    dots(d, w, h)

    text(d, (64, 50), "一份清单，处处同源", f_cjk(26, True), INK)
    text(d, (64, 92), "名单只维护一次：网站、WorkBuddy、DSH 插件读到的都是同一批技能。", f_cjk(10.2), BODY)

    boxes = [
        ("两个来源", ["GitHub 117 条 · SkillHub 54 条", "热门仓库 / 上架即用"], GREEN),
        ("catalog.json", ["唯一真相源 · 只存坐标", "逐条核验，失效即移除"], GREEN_2),
        ("金融技能面板", ["搜索 · 分类 · 详情 · 一键装", "装完立刻能调用"], GREEN_3),
    ]
    bw, bh, gap = 320, 130, 56
    bx, by = 64, 148
    for i, (title, subs, color) in enumerate(boxes):
        x = bx + i * (bw + gap)
        shadowed_round(img, (x, by, x + bw, by + bh), 14, outline=LINE, blur=10, alpha=22)
        d.rounded_rectangle([px(x), px(by), px(x + 4), px(by + bh)], radius=px(2), fill=color)
        text(d, (x + 24, by + 24), title, f_cjk(15, True), INK)
        text(d, (x + 24, by + 62), subs[0], f_cjk(9.4), BODY)
        text(d, (x + 24, by + 86), subs[1], f_cjk(9.4), "#8B929A")
        if i < len(boxes) - 1:
            ax0 = x + bw + 14
            ax1 = x + bw + gap - 14
            ay = by + bh / 2
            d.line([px(ax0), px(ay), px(ax1 - 7), px(ay)], fill="#B3BDB2", width=px(1.6))
            d.polygon([(px(ax1), px(ay)), (px(ax1 - 8), px(ay - 4.5)), (px(ax1 - 8), px(ay + 4.5))],
                      fill="#B3BDB2")

    notes = [("只存坐标", "正文留在原作者处，作者更新你就装到新版"),
             ("逐条核验", "每次发版都真去上游取一次，失效即移除"),
             ("装完即用", "写进本机技能目录，当前对话直接调用")]
    nx = 64
    for head, body in notes:
        d.line([px(nx), px(324), px(nx + 14), px(324)], fill=GREEN, width=px(2))
        text(d, (nx + 22, 316), head, f_cjk(10, True), GREEN)
        text(d, (nx + 76, 316), body, f_cjk(9), "#8B929A")
        nx += 368
    return img


def steps():
    w, h = 1200, 250
    img, d = canvas(w, h)
    dots(d, w, h)

    text(d, (64, 38), "三步用起来", f_cjk(24, True), INK)
    text(d, (64, 76), "不用读文档，装完就能搜。", f_cjk(10.2), BODY)

    items = [("1", "填一个地址安装", "插件 → 安装插件 → Git 仓库，粘贴带 tag 的地址"),
             ("2", "打开侧栏「金融技能」", "彻底退出再开一次 DSH，入口就在左栏"),
             ("3", "搜 → 装 → 直接用", "点安装，回对话里说出技能名")]
    bw, gap = 336, 32
    by = 118
    for i, (num, head, body) in enumerate(items):
        x = 64 + i * (bw + gap)
        shadowed_round(img, (x, by, x + bw, by + 96), 12, outline=LINE, blur=8, alpha=18, offset=4)
        d.ellipse([px(x + 20), px(by + 22), px(x + 48), px(by + 50)], fill=GREEN)
        text(d, (x + 34, by + 36), num, f_cjk(12, True), "#FFFFFF", anchor="mm")
        text(d, (x + 60, by + 22), head, f_cjk(12.5, True), INK)
        text(d, (x + 60, by + 52), body, f_cjk(9.2), "#8B929A")
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, fn in (("readme-hero", hero), ("readme-pipeline", pipeline), ("readme-steps", steps)):
        img = fn()
        target_w = img.size[0] // SCALE
        img = img.resize((target_w, img.size[1] // SCALE), Image.LANCZOS)
        path = os.path.join(OUT_DIR, name + ".png")
        img.save(path, optimize=True)
        print("wrote", path, img.size)


if __name__ == "__main__":
    main()
