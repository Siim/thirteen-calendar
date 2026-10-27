#!/usr/bin/env python3
"""Thirteen "Page 13" app icon: builds every SVG master and every raster export.

    python3 design/icon/build.py --fonts /path/to/geist-font            # SVGs + every export
    python3 design/icon/build.py --fonts /path/to/geist-font --svg-only # SVG masters only

--fonts is the unzipped official Geist release (github.com/vercel/geist-font/releases, the folder
that holds Geist/ttf and GeistMono/ttf). Fonts are not committed: the "13" and the wordmark are
converted to outlines, so nothing downstream needs them.

Requires Python 3.9+, fontTools and Pillow (pip install fonttools pillow), rsvg-convert (librsvg,
brew install librsvg) and hb-shape (HarfBuzz, brew install harfbuzz) for the wordmark kerning.
The Apple asset catalog is rendered separately by apple/scripts/make-icons.sh from the SVGs here.

One icon everywhere (design/DECISIONS.md): every platform export is the same 1024 master artwork
at the same crop; only the platform's mask differs. The one exception is the 32 x 32 favicon,
which is pixel-snapped for browser tabs. Geometry lives in the constants below and is described in
design/icon/README.md.
"""
from __future__ import annotations

import argparse
import json
import shutil
import struct
import subprocess
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent

# ---- Colours (Almanac theme, packages/ui/src/styles/tokens.css) ---------------------------------
PAPER = "#f4efe4"
INK = "#1b1813"
ACCENT = "#ea580c"
RULE = "#d5cab6"  # perforation on paper
INK_2 = "#4a4339"
DARK_PAGE = INK  # dark variant: the page is ink, the "13" is paper
DARK_HOLE = "#0d0b08"
DARK_RULE = "#3b352c"

# ---- Master geometry (1024 x 1024, full bleed) --------------------------------------------------
N = 1024
BAND = 300  # accent binding band, 0..300 (29.3 % of the height)
HOLE_R = 42
HOLE_Y = 150  # centred in the band
HOLE_X = (312, 712)  # symmetric about the centre, 400 apart
PERF_Y = 340  # perforation: a row of small dots just under the band
PERF_R = 5.5
PERF_STEP = 32
CAP = 452  # cap height of the "13" in px (Geist Black, cap height 710 units)
TRACK = -64  # extra space between "1" and "3", font units (-0.064 em)
GLYPH_CX = 512  # ink box centre
GLYPH_CY = 654  # cap-height centre: 8 px above the page area's centre (662), optical
ONE = "one"  # Geist's default flagged "1" without a foot ("one.ss09" has the foot serif)

# ---- Favicon geometry (32 x 32 grid, pixel-snapped for 16 and 32 px) ----------------------------
F = 32
F_RADIUS = 7
F_BAND = 10  # 5 px at 16
F_HOLE_R = 2  # 2 x 2 px at 16
F_HOLE_Y = 4  # rows 1..2 at 16 (a hair above the band centre, so the dots stay crisp)
F_HOLE_X = (10, 22)
F_CAP = 16  # rows 7..14 at 16
F_TRACK = 10  # looser than the master so the "1" and "3" stay apart at 16 px
F_GLYPH_CY = 22
F_EDGE = 0.18  # ink opacity of the hairline page edge (separates the page from light tab bars)

# ---- Platform shapes and safe zones ----------------------------------------------------------------
# One artwork everywhere (design/DECISIONS.md): only the mask differs. Rounded squares use Apple's
# continuous-corner curve (SwiftUI RoundedRectangle(style: .continuous), coefficients below) with
# the iOS icon corner radius, so Windows, the web "any" icons and the repo mark match iOS exactly.
ICON_CORNER = 0.2237  # corner radius / side (iOS app icon mask)
ANDROID_VIEW = 108  # adaptive icon layer, 108 x 108 dp; the launcher shows the central 72 dp
ANDROID_ART = 72  # the 1024 master fills the visible 72 dp (same crop as iOS); its content reaches
#                   455.6 / 1024 of the side from the centre (the ring holes) = 32.0 dp, inside the
#                   66 dp safe-zone circle. Page, band and perforation bleed to the 108 dp edges.
MASKABLE_SCALE = 0.88  # PWA maskable: content (radius 0.445 of the side at 1:1) must fit the
#                        central 80 % circle (radius 0.4), so the art is scaled to 88 % there only.


@dataclass(frozen=True)
class T:
    """Uniform scale then translate, master units to output units."""

    s: float = 1.0
    tx: float = 0.0
    ty: float = 0.0

    def x(self, v: float) -> float:
        return self.s * v + self.tx

    def y(self, v: float) -> float:
        return self.s * v + self.ty

    def d(self, v: float) -> float:
        return self.s * v


def n(v: float) -> str:
    """Compact number: at most 2 decimals, no trailing zeros."""
    out = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if out in ("-0", "") else out


def rect_d(x: float, y: float, w: float, h: float, t: T = T()) -> str:
    return f"M{n(t.x(x))} {n(t.y(y))}H{n(t.x(x + w))}V{n(t.y(y + h))}H{n(t.x(x))}Z"


def circle_d(cx: float, cy: float, r: float, t: T = T()) -> str:
    x, y, rr = t.x(cx), t.y(cy), t.d(r)
    return (
        f"M{n(x - rr)} {n(y)}A{n(rr)} {n(rr)} 0 1 0 {n(x + rr)} {n(y)}"
        f"A{n(rr)} {n(rr)} 0 1 0 {n(x - rr)} {n(y)}Z"
    )


# Apple's continuous ("squircle") corner, in units of the corner radius, measured from the corner:
# the curve leaves each edge 1.528665 r from the corner. Values from SwiftUI's
# RoundedRectangle(cornerRadius: r, style: .continuous).path(in:) (macOS 27), top-left corner,
# going from the left edge to the top edge.
_CORNER = (
    ((0, 1.088490), (0, 0.868407), (0.074911, 0.631494)),
    ((0.169060, 0.372824), (0.372824, 0.169060), (0.631494, 0.074911)),
    ((0.868407, 0), (1.088490, 0), (1.528665, 0)),
)
_CORNER_START = (0, 1.528665)


def squircle_d(x: float, y: float, w: float, h: float, r: float) -> str:
    """Rounded rectangle with Apple's continuous corners (iOS and macOS app icon shape)."""
    r = min(r, min(w, h) / 2 / _CORNER_START[1])

    def corner(cx: float, cy: float, sx: int, sy: int, swap: bool) -> str:
        # Map corner-local (u, v) to page coordinates; swap walks the curve in reverse order.
        def pt(u: float, v: float) -> str:
            if swap:
                u, v = v, u
            return f"{n(cx + sx * u * r)} {n(cy + sy * v * r)}"
        out = []
        for c1, c2, end in _CORNER:
            out.append(f"C{pt(*c1)} {pt(*c2)} {pt(*end)}")
        return "".join(out)

    # Walk clockwise from the top edge. Each corner is the top-left template mirrored and, for the
    # top-right and bottom-left corners, traversed from the other edge (swap).
    e = _CORNER_START[1] * r
    return (
        f"M{n(x + e)} {n(y)}H{n(x + w - e)}"
        + corner(x + w, y, -1, 1, True)
        + f"V{n(y + h - e)}"
        + corner(x + w, y + h, -1, -1, False)
        + f"H{n(x + e)}"
        + corner(x, y + h, 1, -1, True)
        + f"V{n(y + e)}"
        + corner(x, y, 1, 1, False)
        + "Z"
    )


def rrect_d(x: float, y: float, w: float, h: float, r: float, top_only: bool = False) -> str:
    """Rounded rectangle (or one rounded only at the top) as a path."""
    if top_only:
        return (
            f"M{n(x)} {n(y + h)}V{n(y + r)}A{n(r)} {n(r)} 0 0 1 {n(x + r)} {n(y)}"
            f"H{n(x + w - r)}A{n(r)} {n(r)} 0 0 1 {n(x + w)} {n(y + r)}V{n(y + h)}Z"
        )
    return (
        f"M{n(x + r)} {n(y)}H{n(x + w - r)}A{n(r)} {n(r)} 0 0 1 {n(x + w)} {n(y + r)}"
        f"V{n(y + h - r)}A{n(r)} {n(r)} 0 0 1 {n(x + w - r)} {n(y + h)}H{n(x + r)}"
        f"A{n(r)} {n(r)} 0 0 1 {n(x)} {n(y + h - r)}V{n(y + r)}A{n(r)} {n(r)} 0 0 1 {n(x + r)} {n(y)}Z"
    )


class Fonts:
    def __init__(self, root: Path):
        def find(name: str) -> Path:
            hits = sorted(root.rglob(name))
            hits = [h for h in hits if "/ttf/" in str(h)] or hits
            if not hits:
                sys.exit(f"build.py: {name} not found under {root}")
            return hits[0]

        self.black_path = find("Geist-Black.ttf")
        self.bold_path = find("Geist-Bold.ttf")
        self.regular_path = find("Geist-Regular.ttf")
        self.black = TTFont(self.black_path)
        self.bold = TTFont(self.bold_path)
        self.regular = TTFont(self.regular_path)


def numeral_d(font: TTFont, cap: float, cx: float, cy: float, track: float, t: T = T(),
              one: str | None = None, snap: float | None = None) -> str:
    """'13' in Geist Black as one path: ink box centred on cx, cap height centred on cy.
    snap: move the run horizontally (by at most half of it) so the left edge of the "1" stem lands
    on a multiple of snap, which keeps the stem crisp on a pixel grid."""
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    one, three = one or ONE, cmap[ord("3")]
    cap_units = font["OS/2"].sCapHeight
    k = cap / cap_units
    bounds = {}
    for g in (one, three):
        bp = BoundsPen(gs)
        gs[g].draw(bp)
        bounds[g] = bp.bounds
    x3 = font["hmtx"][one][0] + track
    ink_left = bounds[one][0]
    ink_right = x3 + bounds[three][2]
    origin_x = cx - k * (ink_left + ink_right) / 2
    if snap:
        rec = RecordingPen()
        gs[one].draw(rec)
        stem = min(pt[0] for _, pts in rec.value for pt in pts if pt[1] == 0)
        edge = origin_x + k * stem
        origin_x += round(edge / snap) * snap - edge
    baseline = cy + k * cap_units / 2
    parts = []
    for g, gx in ((one, 0.0), (three, x3)):
        pen = SVGPathPen(gs, ntos=n)
        sk = t.s * k
        gs[g].draw(TransformPen(pen, (sk, 0, 0, -sk, t.x(origin_x + k * gx), t.y(baseline))))
        parts.append(pen.getCommands())
    return "".join(parts)


def text_d(font_path: Path, font: TTFont, text: str, size: float, x: float, baseline: float,
           tracking_em: float = 0.0) -> tuple[str, float]:
    """Shaped (kerned) text as one path. Returns (d, advance width in px)."""
    gs = font.getGlyphSet()
    upm = font["head"].unitsPerEm
    k = size / upm
    try:
        out = subprocess.run(
            ["hb-shape", "--output-format=json", str(font_path), text],
            check=True, capture_output=True, text=True).stdout
        run = [(g["g"], g["ax"], g["dx"], g["dy"]) for g in json.loads(out)]
    except (OSError, subprocess.CalledProcessError):
        cmap = font.getBestCmap()
        run = [(cmap[ord(c)], font["hmtx"][cmap[ord(c)]][0], 0, 0) for c in text]
    pen = SVGPathPen(gs, ntos=n)
    pos = 0.0
    for i, (g, ax, dx, dy) in enumerate(run):
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x + k * (pos + dx), baseline - k * dy)))
        pos += ax + (tracking_em * upm if i < len(run) - 1 else 0)
    return pen.getCommands(), k * pos


def svg(view_w: float, view_h: float, body: str, title: str, desc: str | None = None) -> str:
    d = f"\n  <desc>{desc}</desc>" if desc else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(view_w)} {n(view_h)}" '
        f'width="{n(view_w)}" height="{n(view_h)}">\n  <title>{title}</title>{d}\n{body}</svg>\n'
    )


# ---- Master compositions --------------------------------------------------------------------------

def perforation_d(t: T = T(), x0: float = 0, x1: float = N) -> str:
    """A row of dots under the band, centred on the canvas so it is symmetric."""
    count = int((x1 - x0) // PERF_STEP)
    start = (x0 + x1) / 2 - (count - 1) * PERF_STEP / 2
    return "".join(circle_d(start + i * PERF_STEP, PERF_Y, PERF_R, t) for i in range(count))


def master_layers(fonts: Fonts, t: T = T(), bleed: tuple[float, float, float, float] | None = None):
    """The page as named path layers in output space. bleed = (x0, y0, x1, y1) of the canvas in
    master units when the canvas is larger than the art (safe-zone layouts)."""
    x0, y0, x1, y1 = bleed or (0, 0, N, N)
    return {
        "page": rect_d(x0, y0, x1 - x0, y1 - y0, t),
        "band": rect_d(x0, y0, x1 - x0, BAND - y0, t),
        "holes": "".join(circle_d(hx, HOLE_Y, HOLE_R, t) for hx in HOLE_X),
        "perf": perforation_d(t, x0, x1),
        "numeral": numeral_d(fonts.black, CAP, GLYPH_CX, GLYPH_CY, TRACK, t),
    }


def light_body(L: dict[str, str], perf: bool = True) -> str:
    return (
        f'  <path fill="{PAPER}" d="{L["page"]}"/>\n'
        f'  <path fill="{ACCENT}" d="{L["band"]}"/>\n'
        f'  <path fill="{INK}" d="{L["holes"]}"/>\n'
        + (f'  <path fill="{RULE}" d="{L["perf"]}"/>\n' if perf else "")
        + f'  <path fill="{INK}" d="{L["numeral"]}"/>\n'
    )


def dark_body(L: dict[str, str], perf: bool = True) -> str:
    return (
        f'  <path fill="{DARK_PAGE}" d="{L["page"]}"/>\n'
        f'  <path fill="{ACCENT}" d="{L["band"]}"/>\n'
        f'  <path fill="{DARK_HOLE}" d="{L["holes"]}"/>\n'
        + (f'  <path fill="{DARK_RULE}" d="{L["perf"]}"/>\n' if perf else "")
        + f'  <path fill="{PAPER}" d="{L["numeral"]}"/>\n'
    )


def mono_body(L: dict[str, str], color: str = "#000", band_opacity: float = 1.0) -> str:
    op = f' fill-opacity="{n(band_opacity)}"' if band_opacity < 1 else ""
    return (
        f'  <path fill="{color}"{op} fill-rule="evenodd" d="{L["band"]}{L["holes"]}"/>\n'
        f'  <path fill="{color}" d="{L["numeral"]}"/>\n'
    )


def favicon_svg(fonts: Fonts) -> str:
    holes = "".join(circle_d(hx, F_HOLE_Y, F_HOLE_R) for hx in F_HOLE_X)
    numeral = numeral_d(fonts.black, F_CAP, F / 2, F_GLYPH_CY, F_TRACK, snap=2)
    body = (
        f'  <path fill="{PAPER}" d="{rrect_d(0, 0, F, F, F_RADIUS)}"/>\n'
        f'  <path fill="{ACCENT}" d="{rrect_d(0, 0, F, F_BAND, F_RADIUS, top_only=True)}"/>\n'
        f'  <path fill="{INK}" d="{holes}"/>\n'
        f'  <path fill="{INK}" d="{numeral}"/>\n'
        f'  <path fill="none" stroke="{INK}" stroke-opacity="{F_EDGE}" stroke-width="1" '
        f'd="{rrect_d(0.5, 0.5, F - 1, F - 1, F_RADIUS - 0.5)}"/>\n'
    )
    return svg(F, F, body, "Thirteen",
               "Small-size Thirteen icon: a calendar page with an orange binding band and 13.")


def rounded_master_svg(fonts: Fonts, side: float = N) -> str:
    """The iOS artwork inside the iOS icon shape (continuous corners, radius ICON_CORNER), on a
    transparent canvas: the Windows icon, the web "any" icons and the repo mark."""
    t = T(side / N)
    L = master_layers(fonts, t)
    clip = squircle_d(0, 0, side, side, side * ICON_CORNER)
    body = (
        f'  <defs><clipPath id="page"><path d="{clip}"/></clipPath></defs>\n'
        f'  <g clip-path="url(#page)">\n'
        + light_body(L).replace("  <path", "    <path")
        + "  </g>\n"
    )
    return svg(side, side, body, "Thirteen",
               "Thirteen app icon: a tear-off calendar page with an orange binding band and 13.")


def safe_zone_layers(fonts: Fonts, view: float, art: float):
    """Master art mapped into a centred art x art square of a view x view canvas, with the page,
    band and perforation extended to the canvas edges."""
    s = art / N
    off = (view - art) / 2
    t = T(s, off, off)
    bleed = (-off / s, -off / s, N + off / s, N + off / s)
    return master_layers(fonts, t, bleed)


# ---- Rasterising ------------------------------------------------------------------------------------

def rsvg(svg_text: str, w: int, h: int | None = None) -> Image.Image:
    h = h or w
    res = subprocess.run(["rsvg-convert", "-w", str(w), "-h", str(h), "-f", "png"],
                         input=svg_text.encode(), check=True, capture_output=True)
    return Image.open(BytesIO(res.stdout)).convert("RGBA")


def save_png(img: Image.Image, path: Path, opaque: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    (img.convert("RGB") if opaque else img).save(path, optimize=True)


def write_ico(images: list[Image.Image], path: Path) -> None:
    """ICO with PNG-compressed entries (Windows Vista and later), smallest first."""
    blobs = []
    for im in images:
        buf = BytesIO()
        im.save(buf, format="PNG", optimize=True)
        blobs.append((im.width, im.height, buf.getvalue()))
    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    entries, data = b"", b""
    for w, h, blob in blobs:
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        data += blob
    path.write_bytes(header + entries + data)


def squircle_mask(size: int) -> Image.Image:
    """The iOS icon shape as an alpha mask (rendered by librsvg, anti-aliased)."""
    shape = squircle_d(0, 0, N, N, N * ICON_CORNER)
    return rsvg(svg(N, N, f'  <path d="{shape}"/>\n', "mask"), size).getchannel("A")


def circle_mask(size: int, ss: int = 4) -> Image.Image:
    big = size * ss
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).ellipse((0, 0, big - 1, big - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def masked(img: Image.Image, mask: Image.Image) -> Image.Image:
    out = img.copy()
    out.putalpha(Image.composite(img.getchannel("A"), Image.new("L", img.size, 0), mask))
    return out


# ---- Android VectorDrawables ------------------------------------------------------------------------

def vector(paths: list[tuple[str, str, bool]]) -> str:
    """paths: (fillColor, pathData, evenOdd)."""
    out = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<!-- Generated by design/icon/build.py (Thirteen "Page 13" icon). Do not edit by hand. -->',
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
        f'    android:width="{ANDROID_VIEW}dp"',
        f'    android:height="{ANDROID_VIEW}dp"',
        f'    android:viewportWidth="{ANDROID_VIEW}"',
        f'    android:viewportHeight="{ANDROID_VIEW}">',
    ]
    for color, data, even_odd in paths:
        out.append("    <path")
        out.append(f'        android:fillColor="{color}"')
        if even_odd:
            out.append('        android:fillType="evenOdd"')
        out.append(f'        android:pathData="{data}" />')
    out.append("</vector>")
    return "\n".join(out) + "\n"


ADAPTIVE = """<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by design/icon/build.py (Thirteen "Page 13" icon). Do not edit by hand. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
"""


# ---- Icon Composer document (Xcode 26+, iOS/iPadOS/macOS 26+) ------------------------------------------

def _srgb(hex_color: str) -> str:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return f"srgb:{r:.5f},{g:.5f},{b:.5f},1.00000"


def _solid(light: str, dark: str, tinted: float) -> list[dict]:
    """Fill for the default (light), dark and tinted appearances. Tinted is a grey level: the system
    maps luminance to the tint, as with thirteen-icon-tinted.svg (white "13", band at half)."""
    grey = f"srgb:{tinted:.5f},{tinted:.5f},{tinted:.5f},1.00000"
    return [{"value": {"solid": _srgb(light)}},
            {"appearance": "dark", "value": {"solid": _srgb(dark)}},
            {"appearance": "tinted", "value": {"solid": grey}}]


def icon_composer(fonts: Fonts, out: Path) -> list[Path]:
    """AppIcon.icon: the same artwork as an Icon Composer document, one source for iOS and macOS
    with light, dark and tinted fills (clear is derived from tinted by the system). The page is
    the document fill; band, perforation, ring holes and "13" are flat layers in one group, each a
    1024 x 1024 SVG so positions match the master exactly. Liquid Glass stays off on the layers so
    the artwork reads like the iOS asset catalog icon; the system adds the specular rim."""
    L = master_layers(fonts)
    assets = out / "Assets"
    assets.mkdir(parents=True, exist_ok=True)
    layers = [  # front to back: name, path, light, dark, tinted grey
        ("numeral", L["numeral"], INK, PAPER, 1.0),
        ("holes", L["holes"], INK, DARK_HOLE, 0.0),
        ("perforation", L["perf"], RULE, DARK_RULE, 0.25),
        ("band", L["band"], ACCENT, ACCENT, 0.5),
    ]
    written = []
    for name, d, color, _, _ in layers:
        p = assets / f"{name}.svg"
        p.write_text(svg(N, N, f'  <path fill="{color}" d="{d}"/>\n', name))
        written.append(p)
    doc = {
        "fill-specializations": _solid(PAPER, DARK_PAGE, 0.0),
        "groups": [{
            "name": "Page 13",
            "layers": [{
                "name": name,
                "image-name": f"{name}.svg",
                "glass": False,
                "fill-specializations": _solid(light, dark, tinted),
            } for name, _, light, dark, tinted in layers],
            "shadow": {"kind": "neutral", "opacity": 0.5},
            "translucency": {"enabled": False, "value": 0.5},
            "specular": True,
        }],
        "supported-platforms": {"squares": "shared"},
    }
    p = out / "icon.json"
    p.write_text(json.dumps(doc, indent=2) + "\n")
    written.append(p)
    return written


# ---- Builders ------------------------------------------------------------------------------------------

def build_svgs(fonts: Fonts) -> dict[str, str]:
    L = master_layers(fonts)
    return {
        "thirteen-icon.svg": svg(
            N, N, light_body(L), "Thirteen",
            "Thirteen app icon: a tear-off calendar page with an orange binding band, two ring holes "
            "and 13."),
        "thirteen-icon-dark.svg": svg(
            N, N, dark_body(L), "Thirteen",
            "Thirteen app icon, dark: an ink page with an orange binding band and 13 in paper."),
        "thirteen-icon-mono.svg": svg(
            N, N, mono_body(L), "Thirteen",
            "Thirteen app icon, one colour: binding band with ring holes and 13, on transparent."),
        "thirteen-icon-tinted.svg": svg(
            N, N, f'  <path fill="#000" d="{L["page"]}"/>\n' + mono_body(L, "#fff", 0.5),
            "Thirteen", "Thirteen app icon, iOS tinted source: greyscale on black."),
        "thirteen-icon-favicon.svg": favicon_svg(fonts),
    }


TAGLINE = "A 13-month calendar, side by side with the Gregorian one."


def card(fonts: Fonts, w: int, h: int) -> str:
    """Open Graph / GitHub social card: the icon, the wordmark in Geist, one plain line."""
    icon_side = round(h * 0.46)
    gap = round(h * 0.08)
    word_size = h * 0.2
    tag_size = h * 0.044
    track = -0.035
    _, word_w = text_d(fonts.bold_path, fonts.bold, "Thirteen", word_size, 0, 0, track)
    _, tag_w = text_d(fonts.regular_path, fonts.regular, TAGLINE, tag_size, 0, 0)
    block_w = icon_side + gap + max(word_w, tag_w)
    x0 = round((w - block_w) / 2)
    y_icon = round((h - icon_side) / 2)
    tx = x0 + icon_side + gap
    word_cap = word_size * 0.71
    tag_cap = tag_size * 0.71
    lead = h * 0.075
    top = h / 2 - (word_cap + lead + tag_cap) / 2
    word_base = top + word_cap
    tag_base = word_base + lead + tag_cap
    word_d, _ = text_d(fonts.bold_path, fonts.bold, "Thirteen", word_size, tx, word_base, track)
    tag_d, _ = text_d(fonts.regular_path, fonts.regular, TAGLINE, tag_size, tx + word_size * 0.03,
                      tag_base)
    L = master_layers(fonts, T(icon_side / N, x0, y_icon))
    clip = squircle_d(x0, y_icon, icon_side, icon_side, icon_side * ICON_CORNER)
    body = (
        f'  <rect width="{w}" height="{h}" fill="{PAPER}"/>\n'
        f'  <path fill="{INK}" fill-opacity="0.08" transform="translate(0 {n(h * 0.014)})" d="{clip}"/>\n'
        f'  <defs><clipPath id="i"><path d="{clip}"/></clipPath></defs>\n'
        f'  <g clip-path="url(#i)">\n{light_body(L)}  </g>\n'
        f'  <path fill="none" stroke="{INK}" stroke-opacity="0.14" stroke-width="1.5" d="{clip}"/>\n'
        f'  <path fill="{INK}" d="{word_d}"/>\n'
        f'  <path fill="{INK_2}" d="{tag_d}"/>\n'
    )
    return svg(w, h, body, "Thirteen", TAGLINE)


def build_exports(fonts: Fonts, svgs: dict[str, str]) -> list[Path]:
    written: list[Path] = []

    def put(img: Image.Image, path: Path, opaque: bool = False) -> None:
        save_png(img, path, opaque)
        written.append(path)

    def put_text(text: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        written.append(path)

    master = svgs["thirteen-icon.svg"]
    fav = svgs["thirteen-icon-favicon.svg"]
    shaped = rounded_master_svg(fonts)  # iOS artwork in the iOS shape, transparent corners

    # Web: favicon, touch icon, PWA icons ---------------------------------------------------------------
    web = REPO / "apps/web/public"
    put_text(fav, web / "favicon.svg")
    put(rsvg(master, 180), web / "apple-touch-icon.png", opaque=True)
    put(rsvg(shaped, 192), web / "icon-192.png")
    put(rsvg(shaped, 512), web / "icon-512.png")
    maskable = svg(N, N, light_body(safe_zone_layers(fonts, N, N * MASKABLE_SCALE)), "Thirteen",
                   "Thirteen maskable icon: the art scaled to fit the central 80 % circle.")
    put(rsvg(maskable, 512), web / "icon-maskable-512.png", opaque=True)

    # Repo mark ----------------------------------------------------------------------------------------
    put_text(shaped, REPO / "assets/icon.svg")

    # Android: adaptive icon layers, legacy mipmaps, store icon ------------------------------------------
    andr = HERE / "exports/android"
    La = safe_zone_layers(fonts, ANDROID_VIEW, ANDROID_ART)
    put_text(vector([(PAPER, La["page"], False), (ACCENT, La["band"], False),
                     (INK, La["holes"], False), (RULE, La["perf"], False)]),
             andr / "drawable/ic_launcher_background.xml")
    put_text(vector([(INK, La["numeral"], False)]), andr / "drawable/ic_launcher_foreground.xml")
    put_text(vector([("#FF000000", La["band"] + La["holes"], True),
                     ("#FF000000", La["numeral"], False)]),
             andr / "drawable/ic_launcher_monochrome.xml")
    put_text(ADAPTIVE, andr / "mipmap-anydpi-v26/ic_launcher.xml")
    put_text(ADAPTIVE, andr / "mipmap-anydpi-v26/ic_launcher_round.xml")
    composite = svg(ANDROID_VIEW, ANDROID_VIEW, light_body(La), "Thirteen")
    for density, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        # Legacy launcher icons (before API 26): the visible 72 dp of the adaptive icon (the iOS
        # crop) drawn at 44/48 of the canvas, in the iOS shape (ic_launcher) and a circle
        # (ic_launcher_round).
        inner_px = round(px * 44 / 48)
        full = rsvg(composite, round(inner_px * ANDROID_VIEW / 72))
        o = (full.width - inner_px) // 2
        inner = full.crop((o, o, o + inner_px, o + inner_px))
        pad = (px - inner_px) // 2
        for name, mask in (("ic_launcher", squircle_mask(inner_px)),
                           ("ic_launcher_round", circle_mask(inner_px))):
            canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
            canvas.paste(inner, (pad, pad), mask)
            put(canvas, andr / f"mipmap-{density}/{name}.png")
    put(rsvg(master, 512), andr / "play-store-512.png", opaque=True)

    # Windows: .ico and tiles --------------------------------------------------------------------------
    win = HERE / "exports/windows"
    win.mkdir(parents=True, exist_ok=True)
    # Every frame is the iOS artwork in the iOS shape, rendered at its own size (no small-size
    # redraw: one icon everywhere, design/DECISIONS.md).
    frames = [rsvg(shaped, px) for px in (16, 20, 24, 32, 40, 48, 64, 256)]
    write_ico(frames, win / "Thirteen.ico")
    written.append(win / "Thirteen.ico")
    for px, name in ((44, "Square44x44Logo.png"), (150, "Square150x150Logo.png"),
                     (310, "Square310x310Logo.png")):
        put(rsvg(shaped, px), win / name)

    # Apple: Icon Composer document (not wired into the Xcode project; see README.md) -------------------
    icon_doc = HERE / "exports/apple/AppIcon.icon"
    if icon_doc.exists():
        shutil.rmtree(icon_doc)
    written += icon_composer(fonts, icon_doc)

    # Social cards ----------------------------------------------------------------------------------
    put(rsvg(card(fonts, 1200, 630), 1200, 630), web / "og-image.png", opaque=True)
    put(rsvg(card(fonts, 1280, 640), 1280, 640), HERE / "social-preview.png", opaque=True)
    return written


def build_previews(svgs: dict[str, str], previews: Path) -> list[Path]:
    """Size ladder: each variant at 1024 (shown at 256), 180, 64, 32 and 16 px in the iOS shape,
    then 4x and 8x pixel zooms of the 32 and 16 px renders. One sheet on a light and one on a dark
    background."""
    rows = [
        ("light", svgs["thirteen-icon.svg"], True),
        ("dark", svgs["thirteen-icon-dark.svg"], True),
        ("tinted", svgs["thirteen-icon-tinted.svg"], True),
        ("favicon", svgs["thirteen-icon-favicon.svg"], False),
    ]
    pad = 24
    col_w = [256, 180, 64, 32, 16, 128, 128]
    row_h = 256
    width = pad + sum(c + pad for c in col_w)
    paths = []
    for bg_name, bg in (("light", (236, 236, 236, 255)), ("dark", (32, 33, 36, 255))):
        sheet = Image.new("RGBA", (width, pad + len(rows) * (row_h + pad)), bg)
        for ri, (_, text, mask) in enumerate(rows):
            y = pad + ri * (row_h + pad)
            r = {px: rsvg(text, px) for px in (1024, 180, 64, 32, 16)}
            if mask:
                r = {px: masked(im, squircle_mask(px)) for px, im in r.items()}
            show = [r[1024].resize((256, 256), Image.LANCZOS), r[180], r[64], r[32], r[16],
                    r[32].resize((128, 128), Image.NEAREST), r[16].resize((128, 128), Image.NEAREST)]
            x = pad
            for im, cw in zip(show, col_w):
                sheet.alpha_composite(im, (x, y + (row_h - im.height) // 2))
                x += cw + pad
        p = previews / f"size-ladder-{bg_name}.png"
        sheet.save(p)
        paths.append(p)
    return paths


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fonts", required=True, type=Path, help="unzipped Geist release folder")
    ap.add_argument("--svg-only", action="store_true", help="write the SVG masters only")
    ap.add_argument("--previews", type=Path, default=HERE / "previews",
                    help="where the size ladders go (default design/icon/previews)")
    args = ap.parse_args()
    fonts = Fonts(args.fonts.expanduser().resolve())
    svgs = build_svgs(fonts)
    for name, text in svgs.items():
        (HERE / name).write_text(text)
        print(f"wrote design/icon/{name}")
    if args.svg_only:
        return
    if not shutil.which("rsvg-convert"):
        sys.exit("build.py: rsvg-convert is required for the raster exports (brew install librsvg)")
    args.previews.mkdir(parents=True, exist_ok=True)
    for p in build_exports(fonts, svgs) + build_previews(svgs, args.previews):
        try:
            print(f"wrote {p.relative_to(REPO)}")
        except ValueError:
            print(f"wrote {p}")


if __name__ == "__main__":
    main()
