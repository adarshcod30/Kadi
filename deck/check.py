#!/usr/bin/env python3
"""Static layout QA for the built deck.

Two checks, both cheap and both catching things that are invisible until the deck is
opened in PowerPoint on someone else's machine:

  out-of-bounds  — any shape whose box runs past the 10 x 5.625in canvas
  text-overflow  — any text box whose content, at its own font size, needs more
                   vertical space than the box provides

The text estimate assumes Arial at ~0.50em average advance and 1.21 line height, which
is deliberately slightly pessimistic: a box that passes here has real slack.
"""
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS = {'p': P, 'a': A}
EMU = 914400.0
W, H = 10.0, 5.625
CHAR_EM, LINE_EM = 0.50, 1.21

PPTX = sys.argv[1] if len(sys.argv) > 1 else 'KADI_KSP_Datathon_2026_Submission.pptx'


def main():
    z = zipfile.ZipFile(PPTX)
    slides = sorted(
        [n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)],
        key=lambda n: int(re.search(r'(\d+)', n).group(1)),
    )
    oob = over = 0
    for n in slides:
        idx = int(re.search(r'(\d+)', n).group(1))
        root = ET.fromstring(z.read(n))
        for sp in root.iter(f'{{{P}}}sp'):
            xf = sp.find('p:spPr/a:xfrm', NS)
            if xf is None:
                continue
            o, e = xf.find('a:off', NS), xf.find('a:ext', NS)
            x, y = int(o.get('x')) / EMU, int(o.get('y')) / EMU
            w, h = int(e.get('cx')) / EMU, int(e.get('cy')) / EMU
            if x < -0.01 or y < -0.01 or x + w > W + 0.01 or y + h > H + 0.01:
                oob += 1
                print(f'  s{idx:<2} OOB   box ends {x + w:.2f} x {y + h:.2f}')

            tx = sp.find('p:txBody', NS)
            if tx is None:
                continue
            need, sample = 0.0, ''
            for para in tx.findall('a:p', NS):
                chars, sz = 0, 12.0
                for run in para.findall('a:r', NS):
                    t = run.find('a:t', NS)
                    if t is not None and t.text:
                        chars += len(t.text)
                        sample += t.text
                    rPr = run.find('a:rPr', NS)
                    if rPr is not None and rPr.get('sz'):
                        sz = int(rPr.get('sz')) / 100.0
                if not chars:
                    continue
                pt_in = sz / 72.0
                cpl = max(1, int((w - 0.10) / (pt_in * CHAR_EM)))
                need += max(1, -(-chars // cpl)) * pt_in * LINE_EM
            if need > h + 0.03:
                over += 1
                print(f'  s{idx:<2} TEXT  needs {need:.2f}in in a {h:.2f}in box  «{sample[:58]}»')

    print(f'\n{len(slides)} slides · out-of-bounds={oob} · text-overflow={over}')
    return 1 if (oob or over) else 0


if __name__ == '__main__':
    sys.exit(main())
