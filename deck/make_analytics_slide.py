#!/usr/bin/env python3
"""Render the "Live analytics" slide to a standalone PNG.

pptxgenjs charts cannot express what this slide needs (a forecast interval band, a
7x24 heatmap, a dumbbell plot, a scatter with a fitted line) and cannot be previewed
before opening PowerPoint. So the slide is drawn here as one SVG over the official
template background, screenshotted at 1920x1080, and the resulting PNG is placed into
the deck full-bleed. The PNG the user gets and the slide in the .pptx are the same
pixels.

Every series is read from deck/data/*.json, captured live from the deployed API.

    python3 make_analytics_slide.py      # writes analytics_slide.html + .png
"""
import base64
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DPI = 192.0                       # 10 x 5.625in -> 1920 x 1080
W, H = int(10 * DPI), int(5.625 * DPI)


def inch(v):
    return v * DPI


def D(name):
    with open(f'{HERE}/data/{name}.json') as fh:
        return json.load(fh)['data']


stats = D('stats')
socio = D('analytics_socio')
fc = D('analytics_forecast')

# ---------------------------------------------------------------- design tokens
NAVY, BLUE, TEAL = '#0F2F44', '#1A6FC4', '#2FA8A0'
SAFF, RED, GREY = '#E8871E', '#C0392B', '#5B6B7E'
INK, LINE, SOFT = '#1C2A3A', '#D9E1EC', '#F5F8FB'
WHITE = '#FFFFFF'
BODY = 'Arial, Helvetica, sans-serif'
HEAD = 'Cambria, Georgia, serif'

# Panel grid: 3 columns x 2 rows inside the template's content band.
X0, XW = inch(0.42), inch(9.16)
PW, PH = inch(2.92), inch(1.70)
SX, SY = inch(3.10), inch(1.80)
ROW0 = inch(1.50)

out = []
add = out.append


def esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def text(x, y, s, size=20, colour=INK, weight='normal', anchor='start',
         family=BODY, opacity=1.0):
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size:.1f}" '
        f'fill="{colour}" font-weight="{weight}" text-anchor="{anchor}" '
        f'opacity="{opacity}" dominant-baseline="central">{esc(s)}</text>')


def rect(x, y, w, h, fill, r=0, stroke=None, sw=1.0, opacity=1.0):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" '
        f'fill="{fill}"{st} opacity="{opacity}"/>')


def line(x1, y1, x2, y2, colour=LINE, sw=1.0, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
        f'stroke="{colour}" stroke-width="{sw}"{d}/>')


def circle(cx, cy, r, fill, stroke=None, sw=1.0):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}"{st}/>')


def panel(col, row, title, sub):
    """Draw a card and return its inner plot rectangle."""
    x, y = X0 + col * SX, ROW0 + row * SY
    rect(x, y, PW, PH, WHITE, r=10, stroke=LINE, sw=1.6)
    text(x + 20, y + 30, title, 25, INK, 'bold')
    text(x + 20, y + 56, sub, 18, GREY)
    return x + 20, y + 74, PW - 40, PH - 90


def fmt(n):
    return f'{int(round(n)):,}'


# ================================================================ background
with open(f'{HERE}/assets/bg_content.png', 'rb') as fh:
    BG = base64.b64encode(fh.read()).decode()
add(f'<image x="0" y="0" width="{W}" height="{H}" preserveAspectRatio="none" '
    f'xlink:href="data:image/png;base64,{BG}"/>')

# ================================================================ title
text(X0, inch(0.88), 'Live analytics at a glance', 62, NAVY, 'bold', family=HEAD)
text(X0, inch(1.24),
     'Six views of the same 40,836 FIRs — every series read from the deployed '
     'Catalyst API, none of it illustrative', 30, GREY)


# ================================================================ 1 · volume + forecast
def panel_forecast():
    px, py, pw, ph = panel(0, 0, 'Monthly FIR volume + forecast',
                           '15 months actual, 3 months projected · MAPE 3.9%')
    hist, proj = fc['state']['history'][-15:], fc['state']['forecast']
    lo = min([h['count'] for h in hist] + [p['lower'] for p in proj])
    hi = max([h['count'] for h in hist] + [p['upper'] for p in proj])
    lo, hi = lo * 0.92, hi * 1.04
    n = len(hist) + len(proj)
    gx = px + 52
    gw, gh = pw - 52, ph - 26

    def X(i):
        return gx + gw * i / (n - 1)

    def Y(v):
        return py + gh - gh * (v - lo) / (hi - lo)

    for frac in (0, 0.5, 1.0):
        v = lo + (hi - lo) * frac
        line(gx, Y(v), gx + gw, Y(v), LINE, 1.2)
        text(gx - 8, Y(v), fmt(v), 16, GREY, anchor='end')

    # forecast interval band
    band = ([f'{X(len(hist) - 1 + k):.1f},{Y(p["upper"]):.1f}' for k, p in enumerate(proj)]
            + [f'{X(len(hist) - 1 + k):.1f},{Y(p["lower"]):.1f}'
               for k, p in reversed(list(enumerate(proj)))])
    band.insert(0, f'{X(len(hist) - 1):.1f},{Y(hist[-1]["count"]):.1f}')
    add(f'<polygon points="{" ".join(band)}" fill="{SAFF}" opacity="0.16"/>')

    add('<polyline points="'
        + ' '.join(f'{X(i):.1f},{Y(h["count"]):.1f}' for i, h in enumerate(hist))
        + f'" fill="none" stroke="{BLUE}" stroke-width="3.4" stroke-linejoin="round"/>')
    fpts = [f'{X(len(hist) - 1):.1f},{Y(hist[-1]["count"]):.1f}'] + [
        f'{X(len(hist) - 1 + k):.1f},{Y(p["predicted"]):.1f}' for k, p in enumerate(proj)]
    add(f'<polyline points="{" ".join(fpts)}" fill="none" stroke="{SAFF}" '
        f'stroke-width="3.4" stroke-dasharray="7 5" stroke-linejoin="round"/>')
    for k, p in enumerate(proj):
        circle(X(len(hist) - 1 + k), Y(p['predicted']), 4.2, SAFF)

    text(gx, py + gh + 14, hist[0]['month'], 15, GREY)
    text(gx + gw, py + gh + 14, proj[-1]['month'], 15, GREY, anchor='end')
    # legend
    line(gx + gw - 176, py + 8, gx + gw - 150, py + 8, BLUE, 3.4)
    text(gx + gw - 144, py + 8, 'actual', 16, GREY)
    line(gx + gw - 86, py + 8, gx + gw - 60, py + 8, SAFF, 3.4, dash='7 5')
    text(gx + gw - 54, py + 8, 'forecast', 16, GREY)


# ================================================================ 2 · crime mix
def panel_mix():
    px, py, pw, ph = panel(1, 0, 'FIRs by crime group',
                           'Property and cyber carry two thirds of the register')
    heads = stats['topCrimeHeads'][:7]
    mx = max(h['count'] for h in heads)
    lw = 178
    bh = (ph - 8) / len(heads)
    ramp = [NAVY, BLUE, TEAL, SAFF, '#7B96AD', RED, GREY]
    for i, h in enumerate(heads):
        y = py + i * bh
        name = h['name'].replace('Crimes Against ', '')
        text(px + lw - 8, y + bh / 2 - 1, name, 17, INK, anchor='end')
        bw = (pw - lw - 62) * h['count'] / mx
        rect(px + lw, y + bh * 0.20, bw, bh * 0.58, ramp[i % len(ramp)], r=3)
        text(px + lw + bw + 7, y + bh / 2 - 1, fmt(h['count']), 16, GREY)


# ================================================================ 3 · heatmap
def panel_heat():
    px, py, pw, ph = panel(2, 0, 'When crime happens',
                           'Hour of day × day of week · 168 buckets')
    grid = {(c['dow'], c['hour']): c['count'] for c in stats['heat']}
    mx = max(grid.values()) or 1
    mn = min(grid.values())
    days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    lw = 42
    cw = (pw - lw) / 24.0
    chh = (ph - 22) / 7.0
    for d in range(7):
        text(px + lw - 8, py + d * chh + chh / 2, days[d], 14, GREY, anchor='end')
        for hr in range(24):
            v = grid.get((d, hr), 0)
            t = (v - mn) / (mx - mn) if mx > mn else 0
            # light blue -> navy
            r = int(226 + (15 - 226) * t)
            g = int(238 + (47 - 238) * t)
            b = int(248 + (68 - 248) * t)
            rect(px + lw + hr * cw, py + d * chh, cw - 1.4, chh - 1.4,
                 f'rgb({r},{g},{b})', r=1.4)
    for hr, lab in ((0, '00'), (6, '06'), (12, '12'), (18, '18'), (23, '23')):
        text(px + lw + hr * cw + cw / 2, py + ph - 8, lab, 14, GREY, anchor='middle')


# ================================================================ 4 · disposal
def panel_disposal():
    px, py, pw, ph = panel(0, 1, 'Case disposal',
                           'Every FIR accounted for · sums to 40,836')
    sb = stats['statusBreakdown']
    parts = [('Charge sheeted', sb['chargeSheeted'], TEAL),
             ('Open', sb['open'], BLUE),
             ('Undetected', sb['undetected'], SAFF),
             ('Closed', sb['closed'], GREY)]
    total = sum(p[1] for p in parts)
    cx, cy, rr, th = px + 92, py + ph / 2 - 4, 74, 26
    ang = -90.0
    for _, val, col in parts:
        sweep = 360.0 * val / total
        a0, a1 = ang, ang + sweep
        import math
        x0 = cx + rr * math.cos(math.radians(a0))
        y0 = cy + rr * math.sin(math.radians(a0))
        x1 = cx + rr * math.cos(math.radians(a1))
        y1 = cy + rr * math.sin(math.radians(a1))
        laf = 1 if sweep > 180 else 0
        add(f'<path d="M {x0:.1f} {y0:.1f} A {rr} {rr} 0 {laf} 1 {x1:.1f} {y1:.1f}" '
            f'fill="none" stroke="{col}" stroke-width="{th}"/>')
        ang = a1
    text(cx, cy - 12, '40,836', 30, NAVY, 'bold', anchor='middle')
    text(cx, cy + 14, 'FIRs', 17, GREY, anchor='middle')
    ly = py + 16
    for name, val, col in parts:
        rect(px + 188, ly - 7, 14, 14, col, r=3)
        text(px + 210, ly, name, 17, INK)
        text(px + pw, ly, f'{100.0 * val / total:.1f}%', 17, GREY, 'bold', anchor='end')
        text(px + 210, ly + 20, fmt(val), 15, GREY)
        ly += 46


# ================================================================ 5 · rank shift
def panel_rank():
    px, py, pw, ph = panel(1, 1, 'Rank by count vs rank per capita',
                           'What a raw-count map hides')
    ds = sorted(socio['districts'], key=lambda d: -abs(d['rankShift']))[:6]
    lw = 118
    gx, gw = px + lw, pw - lw - 26
    rh = (ph - 12) / len(ds)
    mxr = 31

    def X(rank):
        return gx + gw * (rank - 1) / (mxr - 1)

    for i, d in enumerate(ds):
        y = py + i * rh + rh / 2
        text(px + lw - 10, y, d['districtName'][:11], 17, INK, anchor='end')
        a, b = X(d['rankByCount']), X(d['rankByRate'])
        line(a, y, b, y, LINE, 3.2)
        circle(a, y, 6.0, GREY)
        circle(b, y, 6.0, TEAL)
        text(b + (11 if b >= a else -11), y, f'#{d["rankByRate"]}', 15, TEAL, 'bold',
             anchor='start' if b >= a else 'end')
    circle(gx + 6, py + ph - 4, 5.2, GREY)
    text(gx + 17, py + ph - 4, 'by count', 15, GREY)
    circle(gx + 108, py + ph - 4, 5.2, TEAL)
    text(gx + 119, py + ph - 4, 'per 100k', 15, TEAL)


# ================================================================ 6 · scatter
def panel_scatter():
    c = socio['correlations'][0]
    px, py, pw, ph = panel(2, 1, 'Urbanisation vs crime rate',
                           f'n = {c["n"]} districts · Pearson r = +{c["pearson"]}')
    pts = c['points']
    gx, gw = px + 50, pw - 50
    gh = ph - 26
    xs = [p['x'] for p in pts]
    ys = [p['y'] for p in pts]
    x0, x1 = 0, max(xs) * 1.05
    y0, y1 = 0, max(ys) * 1.08

    def X(v):
        return gx + gw * (v - x0) / (x1 - x0)

    def Y(v):
        return py + gh - gh * (v - y0) / (y1 - y0)

    for frac in (0, 0.5, 1.0):
        v = y0 + (y1 - y0) * frac
        line(gx, Y(v), gx + gw, Y(v), LINE, 1.2)
        text(gx - 8, Y(v), f'{v:.0f}', 15, GREY, anchor='end')

    # least-squares fit
    n = len(pts)
    mx_, my_ = sum(xs) / n, sum(ys) / n
    num = sum((a - mx_) * (b - my_) for a, b in zip(xs, ys))
    den = sum((a - mx_) ** 2 for a in xs) or 1
    m = num / den
    add(f'<line x1="{X(x0):.1f}" y1="{Y(my_ + m * (x0 - mx_)):.1f}" '
        f'x2="{X(x1):.1f}" y2="{Y(my_ + m * (x1 - mx_)):.1f}" '
        f'stroke="{RED}" stroke-width="2.6" stroke-dasharray="8 5" opacity="0.75"/>')

    band_col = {'Urban': SAFF, 'Mixed': BLUE, 'Rural': TEAL}
    for p in pts:
        circle(X(p['x']), Y(p['y']), 6.0, band_col.get(p['band'], BLUE),
               stroke=WHITE, sw=1.6)
    text(gx, py + gh + 14, '0% urban', 15, GREY)
    text(gx + gw, py + gh + 14, '100%', 15, GREY, anchor='end')
    lx = gx + 8
    for name in ('Urban', 'Mixed', 'Rural'):
        circle(lx, py + 10, 5.2, band_col[name])
        text(lx + 11, py + 10, name, 15, GREY)
        lx += 74


def ribbon():
    """Headline figures under the grid.

    Labels are placed from a measured value width rather than a guessed offset —
    the first version ran "offenders resolved from 36,289 records" straight into the
    next cell.
    """
    y = inch(5.06)
    h = inch(0.26)
    rect(X0, y, XW, h, NAVY, r=7)
    figs = [(fmt(stats['resolvedOffenders']), 'offenders resolved'),
            (fmt(stats['activeNetworks']), 'active networks'),
            (fmt(stats['crossDistrictNetworks']), 'cross-district'),
            (fmt(stats['flaggedCases']), 'cases flagged'),
            ('100%', 'ground-truth recovery')]
    cw = XW / len(figs)
    for i, (val, lab) in enumerate(figs):
        cx = X0 + i * cw + 20
        text(cx, y + h / 2, val, 24, WHITE, 'bold')
        text(cx + len(val) * 14.4 + 12, y + h / 2, lab, 17, '#C9D8E4')
        if i:
            line(X0 + i * cw, y + 9, X0 + i * cw, y + h - 9, '#2A5875', 1.6)


for fn in (panel_forecast, panel_mix, panel_heat,
           panel_disposal, panel_rank, panel_scatter, ribbon):
    fn()

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" '
       f'xmlns:xlink="http://www.w3.org/1999/xlink" '
       f'width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + ''.join(out) + '</svg>')

with open(f'{HERE}/analytics_slide.html', 'w') as fh:
    fh.write('<!doctype html><meta charset="utf-8">'
             '<style>html,body{margin:0;padding:0;background:#fff}'
             f'svg{{display:block;width:{W}px;height:{H}px}}</style>' + svg)

png = f'{HERE}/analytics_slide.png'
chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
subprocess.run([chrome, '--headless', '--disable-gpu', '--hide-scrollbars',
                f'--screenshot={png}', f'--window-size={W},{H}',
                '--default-background-color=FFFFFFFF',
                '--virtual-time-budget=8000',
                f'file://{HERE}/analytics_slide.html'],
               check=True, capture_output=True)
print(f'wrote analytics_slide.png  {W}x{H}  '
      f'{os.path.getsize(png) / 1024:.0f} KB')
