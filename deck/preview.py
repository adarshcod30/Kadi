#!/usr/bin/env python3
"""Render the built .pptx to a single scrollable HTML page for visual QA.

There is no LibreOffice on this machine, so the deck cannot be converted to PDF to
eyeball it. This reads the OOXML directly and lays every shape out as an absolutely
positioned div at the same coordinates pptxgenjs wrote. It is not a faithful renderer
(no gradients, no chart rendering, approximate text metrics) but it is exact about
geometry, so it catches the things that actually go wrong: boxes running off the
canvas, panels overlapping, text spilling out of its container, and dead white space.
"""
import base64
import html
import re
import zipfile
from xml.etree import ElementTree as ET

P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'p': P, 'a': A, 'r': R}
EMU = 914400.0
SCALE = 128.0                      # px per inch in the preview
W, H = 10.0, 5.625

PPTX = 'KADI_KSP_Datathon_2026_Submission.pptx'
OUT = 'preview.html'


def rels_for(z, slide_name):
    rp = slide_name.replace('slides/', 'slides/_rels/') + '.rels'
    out = {}
    if rp not in z.namelist():
        return out
    for rel in ET.fromstring(z.read(rp)):
        out[rel.get('Id')] = rel.get('Target').replace('../', 'ppt/')
    return out


def solid(node):
    """Return the hex fill of a <a:solidFill> parent, or None."""
    if node is None:
        return None
    sf = node.find('a:solidFill', NS)
    if sf is None:
        return None
    clr = sf.find('a:srgbClr', NS)
    return clr.get('val') if clr is not None else None


def render_shape(sp, prefix):
    xfrm = sp.find('p:spPr/a:xfrm', NS)
    if xfrm is None:
        return ''
    off, ext = xfrm.find('a:off', NS), xfrm.find('a:ext', NS)
    if off is None or ext is None:
        return ''
    x = int(off.get('x')) / EMU * SCALE
    y = int(off.get('y')) / EMU * SCALE
    w = int(ext.get('cx')) / EMU * SCALE
    h = int(ext.get('cy')) / EMU * SCALE

    spPr = sp.find('p:spPr', NS)
    geom = spPr.find('a:prstGeom', NS) if spPr is not None else None
    kind = geom.get('prst') if geom is not None else 'rect'
    fill = solid(spPr)
    ln = spPr.find('a:ln', NS) if spPr is not None else None
    stroke = solid(ln)
    dashed = ln is not None and ln.find('a:prstDash', NS) is not None

    style = [f'left:{x:.1f}px', f'top:{y:.1f}px', f'width:{w:.1f}px', f'height:{h:.1f}px']
    if fill:
        style.append(f'background:#{fill}')
    if stroke:
        style.append(f'border:1px {"dashed" if dashed else "solid"} #{stroke}')
    if kind == 'ellipse':
        style.append('border-radius:50%')
    elif kind == 'roundRect':
        style.append('border-radius:6px')
    elif kind in ('rightArrow', 'downArrow'):
        style.append('opacity:.85')
    cls = 'shape arrow' if 'Arrow' in kind else 'shape'
    out = f'<div class="{cls}" style="{";".join(style)}"></div>'

    # text body
    tx = sp.find('p:txBody', NS)
    if tx is None:
        return out
    paras = []
    align = 'left'
    for p in tx.findall('a:p', NS):
        pPr = p.find('a:pPr', NS)
        if pPr is not None and pPr.get('algn'):
            align = {'ctr': 'center', 'r': 'right'}.get(pPr.get('algn'), 'left')
        bullet = pPr is not None and pPr.find('a:buChar', NS) is not None
        runs = []
        for run in p.findall('a:r', NS):
            t = run.find('a:t', NS)
            if t is None or not t.text:
                continue
            rPr = run.find('a:rPr', NS)
            sz = (int(rPr.get('sz')) / 100.0) if rPr is not None and rPr.get('sz') else 12.0
            bold = rPr is not None and rPr.get('b') == '1'
            ital = rPr is not None and rPr.get('i') == '1'
            col = solid(rPr) or '000000'
            st = f'font-size:{sz / 72.0 * SCALE:.1f}px;color:#{col}'
            if bold:
                st += ';font-weight:700'
            if ital:
                st += ';font-style:italic'
            runs.append(f'<span style="{st}">{html.escape(t.text)}</span>')
        if runs:
            paras.append(f'<p class="{"bul" if bullet else ""}">{"".join(runs)}</p>')
    if not paras:
        return out

    bodyPr = tx.find('a:bodyPr', NS)
    anchor = bodyPr.get('anchor') if bodyPr is not None else None
    just = {'ctr': 'center', 'b': 'flex-end'}.get(anchor, 'flex-start')
    tstyle = (f'left:{x:.1f}px;top:{y:.1f}px;width:{w:.1f}px;height:{h:.1f}px;'
              f'justify-content:{just};text-align:{align}')
    return out + f'<div class="txt" style="{tstyle}">{"".join(paras)}</div>'


def main():
    z = zipfile.ZipFile(PPTX)
    slides = sorted(
        [n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)],
        key=lambda n: int(re.search(r'(\d+)', n).group(1)),
    )
    cards = []
    for n in slides:
        idx = int(re.search(r'(\d+)', n).group(1))
        root = ET.fromstring(z.read(n))
        rels = rels_for(z, n)

        # slide background picture, inlined so the file is self-contained
        bgimg = ''
        bp = root.find('.//p:bg//a:blip', NS)
        if bp is not None:
            tgt = rels.get(bp.get(f'{{{R}}}embed'))
            if tgt and tgt in z.namelist():
                b64 = base64.b64encode(z.read(tgt)).decode()
                bgimg = f'background-image:url(data:image/png;base64,{b64});background-size:100% 100%'

        body = ''.join(render_shape(sp, idx) for sp in root.iter(f'{{{P}}}sp'))
        # graphicFrame = a chart; pptxgenjs charts are not rendered here, mark the box
        for gf in root.iter(f'{{{P}}}graphicFrame'):
            xf = gf.find('.//a:xfrm', NS)
            if xf is None:
                continue
            o, e = xf.find('a:off', NS), xf.find('a:ext', NS)
            body += ('<div class="chart" style="left:%.1fpx;top:%.1fpx;width:%.1fpx;height:%.1fpx">CHART</div>'
                     % (int(o.get('x')) / EMU * SCALE, int(o.get('y')) / EMU * SCALE,
                        int(e.get('cx')) / EMU * SCALE, int(e.get('cy')) / EMU * SCALE))
        cards.append(f'<div class="wrap"><div class="no">Slide {idx}</div>'
                     f'<div class="slide" style="{bgimg}">{body}</div></div>')

    css = """
    body{margin:0;background:#20262e;font-family:Arial,Helvetica,sans-serif}
    .wrap{margin:18px auto;width:%dpx}
    .no{color:#9fb0c2;font-size:13px;margin:0 0 5px 2px;font-weight:700}
    .slide{position:relative;width:%dpx;height:%dpx;background:#fff;overflow:hidden;
           box-shadow:0 3px 14px rgba(0,0,0,.5)}
    .shape{position:absolute;box-sizing:border-box}
    .arrow{background:#a9bccf!important;border:0!important}
    .txt{position:absolute;display:flex;flex-direction:column;overflow:visible;
         padding:0 2px;box-sizing:border-box;line-height:1.21}
    .txt p{margin:0}
    .txt p.bul{padding-left:11px;text-indent:-11px}
    .txt p.bul:before{content:"\\2022  "}
    .chart{position:absolute;border:1px dashed #7f93a8;color:#7f93a8;font-size:11px;
           display:flex;align-items:center;justify-content:center;letter-spacing:2px}
    """ % (int(W * SCALE), int(W * SCALE), int(H * SCALE))
    open(OUT, 'w').write(
        f'<!doctype html><meta charset="utf-8"><style>{css}</style>{"".join(cards)}')
    print(f'wrote {OUT} — {len(slides)} slides')


if __name__ == '__main__':
    main()
