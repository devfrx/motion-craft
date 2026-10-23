#!/usr/bin/env python3
"""Strumenti per le composizioni di motion-craft (Playwright + Chromium, ffmpeg).

Sottocomandi:
  init    nuova composizione dal template, con il motore (e l'audio) già incorporati
  sync    reincorpora motore e audio aggiornati in una composizione esistente, senza toccare il resto
  fonts   incorpora un carattere in base64: file locale, o famiglia del repo google/fonts (sottoinsieme latino)
  frames  fotogrammi agli istanti scelti, foglio di contatto, onion skin e filmstrip per giudicare il movimento
  check   controllo automatico: determinismo, font, risorse, aree sicure, testo tagliato o sovrapposto,
          contrasto, tempi di lettura, lampeggi (WCAG 2.3.1), immagine ferma, finale, giunzione del loop
  audio   rendering offline del suono: WAV, picchi, loudness, livelli per cue, spettrogramma con i cue segnati
  export  MP4 / WebM / MOV (ProRes, anche con alfa) / GIF / PNG, con audio e motion blur facoltativi,
          verificato con ffprobe, confronto dei fotogrammi e sincronia dell'audio

La composizione è aperta in modalità export: il tempo lo decide lo strumento, fotogramma per fotogramma.

Dipendenze: pip install playwright pillow numpy fonttools && playwright install chromium; ffmpeg nel PATH
(oppure pip install imageio-ffmpeg). Installarle modifica l'ambiente: chiedi prima all'utente.
"""
import argparse
import base64
import html as htmllib
import io
import json
import math
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SKILL_DIR = pathlib.Path(__file__).resolve().parent.parent
ASSETS = SKILL_DIR / 'assets'
CHROME_ARGS = ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none', '--hide-scrollbars']
SIZES = {'16:9': (1920, 1080, 'broadcast'), '9:16': (1080, 1920, 'social'), '1:1': (1080, 1080, 'social'),
         '4:5': (1080, 1350, 'social'), '4k': (3840, 2160, 'broadcast')}
LOUDNESS = {'web': (-14.0, -1.5), 'streaming': (-18.0, -1.0), 'broadcast': (-23.0, -1.0)}
READING_CPS = 17.0          # Netflix Timed Text Style Guide, adulti: fino a 17 caratteri al secondo
READING_MIN = 5 / 6         # durata minima di un sottotitolo (5/6 di secondo)


# ------------------------------------------------------------------------------------------------ helpers
def die(msg, code=2):
    print(f'errore: {msg}', file=sys.stderr)
    sys.exit(code)


def num(v, d=2):
    if v is None:
        return '—'
    if isinstance(v, float) and math.isinf(v):
        return '−∞' if v < 0 else '∞'
    return f'{v:.{d}f}'.replace('.', ',').replace('-', '−')


def pct(x):
    return '<0,01%' if 0 < x < 0.0001 else f'{num(100 * x, 2)}%'


def span(t0, t1):
    return f'a {num(t0)} s' if abs(t1 - t0) < 1e-9 else f'da {num(t0)} a {num(t1)} s'


def runs(indices):
    """[0, 1, 2, 5, 6, 9] -> [(0, 2), (5, 6), (9, 9)]."""
    out = []
    for i in sorted(set(indices)):
        if out and i == out[-1][1] + 1:
            out[-1][1] = i
        else:
            out.append([i, i])
    return [tuple(r) for r in out]


def parse_size(text):
    t = text.lower().strip()
    if t in SIZES:
        return SIZES[t]
    m = re.fullmatch(r'(\d+)\s*[x×]\s*(\d+)', t)
    if not m:
        raise ValueError(f'formato "{text}" non valido: usa LxA (es. 1920x1080) o 16:9, 9:16, 1:1, 4:5, 4k')
    w, h = int(m[1]), int(m[2])
    return w, h, 'social' if h > w else 'broadcast'


def parse_span(text, default_n):
    parts = [p for p in text.split(':') if p.strip()]
    if len(parts) < 2:
        raise ValueError(f'intervallo "{text}" non valido: usa INIZIO:FINE[:N]')
    t0, t1 = float(parts[0]), float(parts[1])
    n = int(parts[2]) if len(parts) > 2 else default_n
    return t0, t1, max(2, n)


def inline_block(html, name, content):
    pat = re.compile(r'/\*MC-%s:BEGIN\*/.*?/\*MC-%s:END\*/' % (name, name), re.S)
    if not pat.search(html):
        return html, False
    body = content.replace('</script', '<\\/script')
    return pat.sub(lambda _m: f'/*MC-{name}:BEGIN*/\n{body}\n/*MC-{name}:END*/', html, count=1), True


def block_content(html, name):
    m = re.search(r'/\*MC-%s:BEGIN\*/(.*?)/\*MC-%s:END\*/' % (name, name), html, re.S)
    return m.group(1) if m else None


def version_of(text, what):
    m = re.search(r'motion-craft %s (\S+)' % what, text or '')
    return m.group(1) if m else None


# ---- colour and luminance
def srgb_to_linear(a):
    import numpy as np
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    import numpy as np
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.maximum(a, 0), 1 / 2.4) - 0.055)


def rel_lum(rgb255):
    lin = srgb_to_linear(rgb255 / 255.0)
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def contrast(l1, l2):
    import numpy as np
    hi, lo = np.maximum(l1, l2), np.minimum(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def hexcol(rgb):
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in rgb[:3])


# ---- flashes (WCAG 2.3.1): opposing transitions per window of the frame
def turning_points(s, thr):
    """Indices where the series turns after a move of at least thr; smaller wiggles are ignored (hysteresis).
    A slow fade is therefore one change, not many."""
    pts, trend, ext, lo, hi = [0], 0, 0, 0, 0
    for i in range(1, len(s)):
        if trend == 0:
            if s[i] > s[hi]:
                hi = i
            if s[i] < s[lo]:
                lo = i
            if s[hi] - s[lo] >= thr:
                if hi > lo:
                    pts, trend, ext = [lo], 1, hi
                else:
                    pts, trend, ext = [hi], -1, lo
            continue
        if trend == 1:
            if s[i] > s[ext]:
                ext = i
            elif s[ext] - s[i] >= thr:
                pts.append(ext)
                trend, ext = -1, i
        else:
            if s[i] < s[ext]:
                ext = i
            elif s[i] - s[ext] >= thr:
                pts.append(ext)
                trend, ext = 1, i
    if trend != 0:
        pts.append(ext)
    return pts


def flash_events(lum, red, fps):
    """lum, red: (frames, windows). Events where any one-second span holds more than 6 opposing transitions,
    i.e. more than three flashes: [(t0, t1, transitions, kind, window)]."""
    events = []
    for kind, data, thr, dark in (('luminanza', lum, 0.1, 0.8), ('rosso saturo', red, 20.0, None)):
        for w in range(data.shape[1]):
            s = data[:, w]
            if float(s.max() - s.min()) < thr:
                continue
            pts = turning_points(s, thr)
            ends = [pts[k + 1] for k in range(len(pts) - 1) if dark is None or min(s[pts[k]], s[pts[k + 1]]) < dark]
            j = 0
            for i in range(len(ends)):
                while ends[i] - ends[j] >= fps:
                    j += 1
                if i - j + 1 >= 7:
                    events.append((ends[j] / fps, ends[i] / fps, i - j + 1, kind, w))
    events.sort()
    merged = []
    for e in events:
        if merged and e[3] == merged[-1][3] and e[0] <= merged[-1][1] + 0.05:
            last = merged[-1]
            merged[-1] = (last[0], max(last[1], e[1]), max(last[2], e[2]), last[3], last[4])
        else:
            merged.append(e)
    return merged


def window_means(img2d, grid=12):
    """Mean of each window of 2x2 cells on a grid x grid partition: a window is 1/36 of the frame, about the
    flashing area WCAG allows in a 10-degree field (25% of 341x256 on a 1024x768 screen)."""
    import numpy as np
    from PIL import Image
    b = np.asarray(Image.fromarray(img2d.astype(np.float32), mode='F').resize((grid, grid), Image.BOX), np.float32)
    return ((b[:-1, :-1] + b[1:, :-1] + b[:-1, 1:] + b[1:, 1:]) / 4).reshape(-1)


def where(w, grid=11):
    r, c = divmod(w, grid)
    v = 'in alto' if r < grid / 3 else ('al centro' if r < 2 * grid / 3 else 'in basso')
    h = 'a sinistra' if c < grid / 3 else ('al centro' if c < 2 * grid / 3 else 'a destra')
    return 'al centro' if v == h == 'al centro' else f'{v} {h}'


# ---- audio files and loudness
def read_wav(path):
    import numpy as np
    b = pathlib.Path(path).read_bytes()
    if b[:4] != b'RIFF' or b[8:12] != b'WAVE':
        raise ValueError('non è un WAV')
    pos, fmt = 12, None
    while pos + 8 <= len(b):
        cid = b[pos:pos + 4]
        size = struct.unpack('<I', b[pos + 4:pos + 8])[0]
        body = b[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            tag, ch, sr, _, _, bits = struct.unpack('<HHIIHH', body[:16])
            fmt = (tag, ch, sr, bits)
        elif cid == b'data' and fmt:
            tag, ch, sr, bits = fmt
            if tag == 3 and bits == 32:
                x = np.frombuffer(body, '<f4').astype(np.float32)
            elif tag == 1 and bits == 16:
                x = np.frombuffer(body, '<i2').astype(np.float32) / 32768
            else:
                raise ValueError(f'WAV non gestito (formato {tag}, {bits} bit)')
            return x.reshape(-1, ch), sr
        pos += 8 + size + (size & 1)
    raise ValueError('WAV senza dati')


def write_wav_float(path, data, sr):
    data = data.astype('<f4')
    n, ch = data.shape
    nbytes = n * ch * 4
    head = b'RIFF' + struct.pack('<I', 50 + nbytes) + b'WAVE'
    head += b'fmt ' + struct.pack('<IHHIIHHH', 18, 3, ch, sr, sr * ch * 4, ch * 4, 32, 0)
    head += b'fact' + struct.pack('<II', 4, n) + b'data' + struct.pack('<I', nbytes)
    pathlib.Path(path).write_bytes(head + data.tobytes())


def ffmpeg_exe():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        die('ffmpeg non trovato: installalo o `pip install imageio-ffmpeg` (chiedi prima all\'utente)')


def loudness(path):
    """Integrated loudness (LUFS), loudness range (LU) and true peak (dBTP) by ffmpeg's ebur128 (ITU-R BS.1770)."""
    r = subprocess.run([ffmpeg_exe(), '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True)
    s = r.stderr[r.stderr.rfind('Summary:'):]

    def grab(pat):
        m = re.search(pat, s)
        return float(m.group(1)) if m else None
    return {'I': grab(r'I:\s*(-?inf|-?[\d.]+) LUFS'), 'LRA': grab(r'LRA:\s*(-?[\d.]+) LU'), 'TP': grab(r'Peak:\s*(-?inf|-?[\d.]+) dBFS')}


def plan_gain(integrated, true_peak, target, ceiling):
    """Linear gain (dB) towards the target loudness, never pushing the true peak over the ceiling: no compression,
    no pumping. Returns (gain, limited_by_peak)."""
    if integrated is None or not math.isfinite(integrated):
        return 0.0, False
    g = target - integrated
    if true_peak is not None and math.isfinite(true_peak) and true_peak + g > ceiling:
        return ceiling - true_peak, True
    return g, False


# ---- fonts
LATIN = [(0x0000, 0x00FF), (0x0131, 0x0131), (0x0152, 0x0153), (0x02BB, 0x02BC), (0x02C6, 0x02C6), (0x02DA, 0x02DA),
         (0x02DC, 0x02DC), (0x0304, 0x0304), (0x0308, 0x0308), (0x0329, 0x0329), (0x2000, 0x206F), (0x20AC, 0x20AC),
         (0x2122, 0x2122), (0x2191, 0x2191), (0x2193, 0x2193), (0x2212, 0x2212), (0x2215, 0x2215), (0xFEFF, 0xFEFF),
         (0xFFFD, 0xFFFD)]
LATIN_EXT = LATIN + [(0x0100, 0x024F), (0x0259, 0x0259), (0x1E00, 0x1EFF), (0x2020, 0x2020), (0x20A0, 0x20C0),
                     (0x2113, 0x2113), (0x2C60, 0x2C7F), (0xA720, 0xA7FF)]


def parse_metadata_pb(text):
    name = re.search(r'^name:\s*"([^"]+)"', text, re.M)
    lic = re.search(r'^license:\s*"([^"]+)"', text, re.M)
    fonts = []
    for block in re.findall(r'fonts\s*\{(.*?)\}', text, re.S):
        def field(k, b=block):
            m = re.search(r'\b%s:\s*"?([^"\n]+)"?' % k, b)
            return m.group(1).strip() if m else None
        fonts.append({'style': field('style') or 'normal', 'weight': int(field('weight') or 400), 'filename': field('filename')})
    axes = {m[0]: (float(m[1]), float(m[2])) for m in
            re.findall(r'axes\s*\{\s*tag:\s*"(\w+)"\s*min_value:\s*([\d.]+)\s*max_value:\s*([\d.]+)', text)}
    return {'name': name.group(1) if name else None, 'license': lic.group(1) if lic else None, 'fonts': fonts, 'axes': axes}


def subset_font(data, subset):
    from fontTools import subset as fts
    from fontTools.ttLib import TTFont
    try:
        import brotli  # noqa: F401
        flavor = 'woff2'
    except ImportError:
        flavor = 'woff'
    font = TTFont(io.BytesIO(data))
    if subset != 'all':
        cps = set()
        for a, b in (LATIN if subset == 'latin' else LATIN_EXT):
            cps.update(range(a, b + 1))
        opts = fts.Options()
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.name_languages = ['*']
        opts.notdef_outline = True
        sub = fts.Subsetter(options=opts)
        sub.populate(unicodes=cps)
        sub.subset(font)
    font.flavor = flavor
    out = io.BytesIO()
    font.save(out)
    return out.getvalue(), flavor


def face_css(family, data, flavor, weight, style):
    mime = {'woff2': 'font/woff2', 'woff': 'font/woff'}.get(flavor, 'font/ttf')
    fmt = flavor or 'truetype'
    b64 = base64.b64encode(data).decode('ascii')
    return (f'@font-face {{ font-family: "{family}"; src: url(data:{mime};base64,{b64}) format("{fmt}"); '
            f'font-weight: {weight}; font-style: {style}; font-display: block; }}')


def put_fonts(html, family, css):
    pat = re.compile(r'/\*MC-FONTS:BEGIN\*/(.*?)/\*MC-FONTS:END\*/', re.S)
    m = pat.search(html)
    if not m:
        die('marcatori /*MC-FONTS:BEGIN*/ /*MC-FONTS:END*/ assenti nel <style>: aggiungili per incorporare i font')
    body = m.group(1)
    block = f'/* font: {family} */\n{css}\n/* fine font: {family} */\n'
    fam = re.compile(r'/\* font: %s \*/.*?/\* fine font: %s \*/\n?' % (re.escape(family), re.escape(family)), re.S)
    body = fam.sub(lambda _m: block, body) if fam.search(body) else body.rstrip('\n') + '\n' + block
    return html[:m.start(1)] + body + html[m.end(1):]


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'motion-craft'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def load_font(size):
    from PIL import ImageFont
    for f in ('DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'Arial.ttf',
              '/System/Library/Fonts/Supplemental/Arial.ttf', 'C:/Windows/Fonts/arial.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ------------------------------------------------------------------------------------------------ browser
META_JS = """() => { const m = window.__motion; return { error: m.error, version: m.version, width: m.width, height: m.height,
  fps: m.fps, duration: m.duration, loop: m.loop, poster: m.poster, safe: m.safe, safeAreas: m.safeAreas,
  transparent: m.transparent, labels: m.labels, scenes: m.scenes, warnings: m.warnings, hasAudio: m.hasAudio, cues: m.cues }; }"""
SEEK_JS = '(t) => { window.__motion.seek(t); return new Promise((r) => requestAnimationFrame(() => r())); }'


class Comp:
    """A composition open in Chromium, in export mode (no player, time driven from here)."""

    def __init__(self, page, scale=1.0):
        self.path = page
        self.scale = scale
        self.target = page if page.startswith(('http://', 'https://', 'file://')) else pathlib.Path(page).resolve().as_uri()
        if not page.startswith(('http://', 'https://', 'file://')) and not pathlib.Path(page).exists():
            die(f'{page} non esiste')

    def __enter__(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            die('manca Playwright: `pip install playwright && playwright install chromium` (chiedi prima all\'utente)')
        self._pw = sync_playwright().start()
        try:
            self.browser = self._pw.chromium.launch(args=CHROME_ARGS)
        except Exception as exc:  # noqa: BLE001
            self._pw.stop()
            die(f'Chromium non si avvia: {exc}\nServe `playwright install chromium` (chiedi prima all\'utente).')
        self.ctx = self.browser.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=self.scale)
        self.page = self.ctx.new_page()
        self.log, self.failed, self.remote = [], [], set()
        self.page.on('console', lambda m: self.log.append((m.type, m.text)) if m.type in ('error', 'warning') else None)
        self.page.on('pageerror', lambda e: self.log.append(('pageerror', str(e))))
        self.page.on('requestfailed', lambda r: self.failed.append(r.url))
        self.page.on('request', lambda r: self.remote.add(urllib.parse.urlsplit(r.url).netloc)
                     if r.url.startswith(('http://', 'https://')) else None)
        self.page.add_init_script('window.__MOTION_EXPORT__ = true;')
        self.page.goto(self.target)
        try:
            self.page.wait_for_function('window.__motion && (window.__motion.ready || window.__motion.error)', timeout=30000)
        except Exception:  # noqa: BLE001
            msgs = '\n'.join(f'  {k}: {t}' for k, t in self.log) or '  (console vuota)'
            self.__exit__()
            die(f'la composizione non è pronta dopo 30 s: c\'è Motion.create(...).build(...)?\n{msgs}')
        self.meta = self.page.evaluate(META_JS)
        if self.meta['error']:
            err = self.meta['error']
            self.__exit__()
            die(f'errore nella costruzione della composizione: {err}')
        self.page.set_viewport_size({'width': int(self.meta['width']), 'height': int(self.meta['height'])})
        self.cdp = self.ctx.new_cdp_session(self.page)
        self._fast = True
        return self

    def __exit__(self, *exc):
        try:
            self.browser.close()
        finally:
            self._pw.stop()

    def set_alpha(self):
        self.cdp.send('Emulation.setDefaultBackgroundColorOverride', {'color': {'r': 0, 'g': 0, 'b': 0, 'a': 0}})

    def seek(self, t):
        self.page.evaluate(SEEK_JS, float(t))

    def snap(self, t):
        fps = self.meta['fps']
        return round(round(min(max(t, 0.0), self.meta['duration']) * fps) / fps, 6)

    def png(self, t=None):
        if t is not None:
            self.seek(t)
        params = {'format': 'png', 'fromSurface': True}
        if self._fast:
            try:
                return base64.b64decode(self.cdp.send('Page.captureScreenshot', {**params, 'optimizeForSpeed': True})['data'])
            except Exception:  # noqa: BLE001  (older Chromium: no optimizeForSpeed)
                self._fast = False
        return base64.b64decode(self.cdp.send('Page.captureScreenshot', params)['data'])

    def png_blur(self, t, samples, shutter, fps, alpha):
        """Real motion blur: sub-frames across the shutter interval (centred on t), averaged in linear light."""
        import numpy as np
        from PIL import Image
        window = (shutter / 360.0) / fps
        acc = None
        for k in range(samples):
            st = min(max(t + (-0.5 + (k + 0.5) / samples) * window, 0.0), self.meta['duration'])
            im = np.asarray(Image.open(io.BytesIO(self.png(st))).convert('RGBA'), np.float32) / 255.0
            a = im[..., 3:4]
            layer = np.concatenate([srgb_to_linear(im[..., :3]) * a, a], axis=-1)
            acc = layer if acc is None else acc + layer
        acc /= samples
        a = acc[..., 3:4]
        rgb = linear_to_srgb(np.clip(np.where(a > 1e-6, acc[..., :3] / np.maximum(a, 1e-6), 0), 0, 1))
        out = np.concatenate([rgb, a], axis=-1) if alpha else rgb
        img = Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA' if alpha else 'RGB')
        buf = io.BytesIO()
        img.save(buf, 'PNG', compress_level=1)
        return buf.getvalue()

    def frames_lowres(self, fps, longest=200):
        """Every frame at low resolution (for flashes, stillness, ending and loop seam)."""
        import numpy as np
        from PIL import Image
        w, h = int(self.meta['width']), int(self.meta['height'])
        f = longest / max(w, h)
        size = (max(1, round(w * f)), max(1, round(h * f)))
        ctx = self.browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=f)
        page = ctx.new_page()
        page.add_init_script('window.__MOTION_EXPORT__ = true;')
        page.goto(self.target)
        page.wait_for_function('window.__motion && window.__motion.ready', timeout=30000)
        cdp = ctx.new_cdp_session(page)
        n = int(round(self.meta['duration'] * fps)) + 1
        out = []
        for i in range(n):
            page.evaluate('(t) => { window.__motion.seek(t); }', min(i / fps, self.meta['duration']))  # the capture itself waits for the new frame
            data = base64.b64decode(cdp.send('Page.captureScreenshot', {'format': 'png', 'fromSurface': True})['data'])
            im = Image.open(io.BytesIO(data)).convert('RGB')
            if im.size != size:
                im = im.resize(size, Image.BOX)
            out.append(np.asarray(im))
        ctx.close()
        return out

    def audio_wav(self, opts):
        info = self.page.evaluate('(o) => window.__motion.renderAudio(o)', opts)
        data = b''.join(base64.b64decode(self.page.evaluate('(i) => window.__motion.audioChunk(i)', i)) for i in range(info['chunks']))
        return data, info


# ------------------------------------------------------------------------------------------------ init / sync / fonts
def cmd_init(a):
    out = pathlib.Path(a.out)
    if out.exists() and not a.force:
        die(f'{out} esiste già: non lo sovrascrivo (potrebbe contenere modifiche). Usa --force o un altro nome.')
    try:
        w, h, safe = parse_size(a.size)
    except ValueError as exc:
        die(str(exc))
    safe = a.safe or safe
    html = (ASSETS / 'template.html').read_text(encoding='utf-8')
    fmt = f"  width: {w}, height: {h}, fps: {a.fps}, duration: {a.duration:g}, safe: '{safe}', /*MC-FORMAT*/"
    html = re.sub(r'^.*/\*MC-FORMAT\*/.*$', lambda _m: fmt, html, count=1, flags=re.M)
    html = html.replace('<title>Composizione</title>', f'<title>{htmllib.escape(a.title)}</title>')
    html, _ = inline_block(html, 'RUNTIME', (ASSETS / 'motion-runtime.js').read_text(encoding='utf-8'))
    if a.audio:
        html, _ = inline_block(html, 'AUDIO', (ASSETS / 'motion-audio.js').read_text(encoding='utf-8'))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print(f'creata {out}: {w}×{h}, {a.fps} fps, {num(a.duration)} s, aree sicure "{safe}", audio {"sì" if a.audio else "no"}')
    print('poi: sostituisci la SCENA DI ESEMPIO, incorpora il carattere (fonts), guarda i fotogrammi (frames), controlla (check)')
    return 0


def cmd_sync(a):
    p = pathlib.Path(a.page)
    html = p.read_text(encoding='utf-8')
    runtime = (ASSETS / 'motion-runtime.js').read_text(encoding='utf-8')
    before = version_of(block_content(html, 'RUNTIME'), 'runtime')
    html, ok = inline_block(html, 'RUNTIME', runtime)
    if not ok:
        die('marcatori MC-RUNTIME assenti: la composizione non viene dal template')
    audio_now = block_content(html, 'AUDIO')
    with_audio = a.audio or bool(audio_now and audio_now.strip())
    if with_audio:
        html, ok = inline_block(html, 'AUDIO', (ASSETS / 'motion-audio.js').read_text(encoding='utf-8'))
        if not ok:
            die('marcatori MC-AUDIO assenti: aggiungi <script>/*MC-AUDIO:BEGIN*/ /*MC-AUDIO:END*/</script> prima dello script della composizione')
    p.write_text(html, encoding='utf-8')
    print(f'{p}: motore {before or "?"} → {version_of(runtime, "runtime")}' + (', audio incorporato' if with_audio else ''))
    return 0


def cmd_fonts(a):
    p = pathlib.Path(a.page)
    html = p.read_text(encoding='utf-8')
    parts, total, files = [], 0, 0
    if a.google:
        slug = re.sub(r'[^a-z0-9]', '', a.google.lower())
        meta_txt, base = None, None
        for lic_dir in ('ofl', 'apache', 'ufl'):
            base = f'https://raw.githubusercontent.com/google/fonts/main/{lic_dir}/{slug}/'
            try:
                meta_txt = fetch(base + 'METADATA.pb').decode('utf-8')
                break
            except urllib.error.HTTPError:
                continue
            except urllib.error.URLError as exc:
                die(f'rete non raggiungibile ({exc.reason}): usa --file con un font locale')
        if meta_txt is None:
            die(f'famiglia "{a.google}" non trovata nel repo google/fonts (ofl, apache, ufl)')
        md = parse_metadata_pb(meta_txt)
        family = md['name'] or a.google
        styles = ['normal'] + (['italic'] if a.italic else [])
        variable = [f for f in md['fonts'] if '[' in (f['filename'] or '')]
        chosen = []
        if variable:
            for st in styles:
                f = next((x for x in variable if x['style'] == st), None)
                if f:
                    chosen.append((f, 'wght' in md['axes']))
        else:
            for st in styles:
                for wgt in [int(x) for x in a.weights.split(',')]:
                    f = next((x for x in md['fonts'] if x['style'] == st and x['weight'] == wgt), None)
                    if f:
                        chosen.append((f, False))
        if not chosen:
            die(f'nessun file adatto per "{family}" (pesi richiesti: {a.weights})')
        for f, var in chosen:
            data = fetch(base + urllib.parse.quote(f['filename']))
            sub, flavor = subset_font(data, a.subset)
            weight = f"{int(md['axes']['wght'][0])} {int(md['axes']['wght'][1])}" if var else str(f['weight'])
            parts.append(face_css(family, sub, flavor, weight, f['style']))
            total += len(sub)
            files += 1
        source = f'https://github.com/google/fonts/tree/main/{base.split("/main/")[1]}'
        lic = md['license'] or '?'
    else:
        if not a.file or not a.family:
            die('usa --google "Famiglia" oppure --file percorso --family "Nome"')
        data = pathlib.Path(a.file).read_bytes()
        family = a.family
        weight = a.weight
        if weight is None:
            from fontTools.ttLib import TTFont
            font = TTFont(io.BytesIO(data))
            axes = {ax.axisTag: ax for ax in font['fvar'].axes} if 'fvar' in font else {}
            weight = f"{int(axes['wght'].minValue)} {int(axes['wght'].maxValue)}" if 'wght' in axes else '400'
        sub, flavor = subset_font(data, a.subset)
        parts.append(face_css(family, sub, flavor, weight, a.style))
        total, files, source, lic = len(sub), 1, a.file, 'verifica la licenza del file prima di distribuirlo'
    p.write_text(put_fonts(html, family, '\n'.join(parts)), encoding='utf-8')
    print(f'incorporato "{family}" ({lic}) da {source}: {files} file, {total // 1024} kB, sottoinsieme {a.subset}')
    print(f'usa il nome esatto nei token, es. --font-display: "{family}", system-ui, sans-serif;')
    return 0


# ------------------------------------------------------------------------------------------------ frames
def sheet(items, out, portrait):
    from PIL import Image, ImageDraw
    imgs = [(Image.open(io.BytesIO(png)).convert('RGB'), cap) for png, cap in items]
    cols = 5 if portrait else 3
    cell_w = 300 if portrait else 520
    ar = imgs[0][0].height / imgs[0][0].width
    cell_h = int(cell_w * ar)
    pad, cap_h = 10, 22
    rows = math.ceil(len(imgs) / cols)
    canvas = Image.new('RGB', (cols * cell_w + (cols + 1) * pad, rows * (cell_h + cap_h + pad) + pad), (24, 24, 28))
    d = ImageDraw.Draw(canvas)
    font = load_font(14)
    for k, (im, cap) in enumerate(imgs):
        r, c = divmod(k, cols)
        x, y = pad + c * (cell_w + pad), pad + r * (cell_h + cap_h + pad)
        d.text((x + 2, y + 3), cap, fill=(232, 232, 238), font=font)
        canvas.paste(im.resize((cell_w, cell_h), Image.LANCZOS), (x, y + cap_h))  # proportions kept: circles stay round
    canvas.save(out)


def onion(pngs, out, caption):
    import numpy as np
    from PIL import Image, ImageDraw
    arrs = [np.asarray(Image.open(io.BytesIO(p)).convert('RGB'), np.float32) for p in pngs]
    corners = np.concatenate([a[:6, :6].reshape(-1, 3) for a in arrs] + [a[-6:, -6:].reshape(-1, 3) for a in arrs]
                             + [a[:6, -6:].reshape(-1, 3) for a in arrs] + [a[-6:, :6].reshape(-1, 3) for a in arrs])
    bg = np.median(corners, axis=0)
    dark = bg.mean() < 128
    acc = None
    n = len(arrs)
    for i, a in enumerate(arrs):  # older poses fainter, the latest at full strength
        g = bg + (a - bg) * (0.3 + 0.7 * i / max(1, n - 1))
        acc = g if acc is None else (np.maximum(acc, g) if dark else np.minimum(acc, g))
    img = Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8))
    scale = min(1.0, 1600 / img.width)
    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    canvas = Image.new('RGB', (img.width, img.height + 26), (24, 24, 28))
    canvas.paste(img, (0, 26))
    ImageDraw.Draw(canvas).text((6, 5), caption, fill=(232, 232, 238), font=load_font(15))
    canvas.save(out)


def filmstrip(items, out):
    from PIL import Image, ImageDraw
    imgs = [(Image.open(io.BytesIO(p)).convert('RGB'), cap) for p, cap in items]
    h = 220
    ws = [int(h * im.width / im.height) for im, _ in imgs]
    canvas = Image.new('RGB', (sum(ws) + 6 * (len(imgs) + 1), h + 32), (24, 24, 28))
    d = ImageDraw.Draw(canvas)
    font = load_font(13)
    x = 6
    for (im, cap), w in zip(imgs, ws):
        canvas.paste(im.resize((w, h), Image.LANCZOS), (x, 28))
        d.text((x + 2, 6), cap, fill=(232, 232, 238), font=font)
        x += w + 6
    canvas.save(out)


def cmd_frames(a):
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    with Comp(a.page, scale=a.scale) as c:
        m = c.meta
        dur, fps = m['duration'], m['fps']
        times = []
        if a.at:
            times += [float(x) for x in a.at.split(',') if x.strip()]
        if a.every:
            k = 0
            while k * a.every <= dur + 1e-9:
                times.append(k * a.every)
                k += 1
        if not a.at and not a.every:
            times += [dur * i / (a.n - 1) for i in range(a.n)] + [lab['time'] for lab in m['labels']] + [m['poster']]
        times = sorted({c.snap(t) for t in times})
        labels_at = {c.snap(lab['time']): lab['name'] for lab in m['labels']}
        poster = c.snap(m['poster'])
        items = []
        for t in times:
            png = c.png(t)
            (out / f'f_{int(round(t * 1000)):06d}.png').write_bytes(png)
            cap = f'{num(t)} s · f{round(t * fps)}' + (f' · {labels_at[t]}' if t in labels_at else '') + (' · poster' if t == poster else '')
            items.append((png, cap))
        sheet(items, out / 'foglio.png', m['height'] > m['width'])
        made = [str(out / 'foglio.png')]
        if a.onion:
            t0, t1, n = parse_span(a.onion, 6)
            ts = [c.snap(t0 + (t1 - t0) * i / (n - 1)) for i in range(n)]
            onion([c.png(t) for t in ts], out / 'onion.png', f'onion skin {num(t0)}→{num(t1)} s, {n} pose: la più recente è piena')
            made.append(str(out / 'onion.png'))
        if a.strip:
            t0, t1, n = parse_span(a.strip, 8)
            ts = [c.snap(t0 + (t1 - t0) * i / (n - 1)) for i in range(n)]
            filmstrip([(c.png(t), f'{num(t)} s') for t in ts], out / 'strip.png')
            made.append(str(out / 'strip.png'))
        warnings = m['warnings']
        log = [f'{k}: {t}' for k, t in c.log if '[motion]' not in t]
    print(f'{len(times)} fotogrammi in {out}/ · ' + ' · '.join(made))
    print('avvisi del motore: ' + ('; '.join(warnings) if warnings else 'nessuno'))
    print('console: ' + ('; '.join(log) if log else 'pulita'))
    return 0


# ------------------------------------------------------------------------------------------------ check
SCAN_INIT_JS = r"""() => {
  const stage = window.__motion.stageElement;
  const units = [];
  const walk = (el) => {
    if (!el || el.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) return;
    if (el.dataset && el.dataset.mcSplit) { units.push(el); return; }
    if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) { units.push(el); return; }
    for (const c of el.children) walk(c);
  };
  for (const c of stage.children) walk(c);
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const raw = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
    const cls = raw.split(/\s+/).filter((x) => x && !x.startsWith('mc-')).slice(0, 2);
    return cls.length ? s + '.' + cls.join('.') : s;
  };
  window.__mcUnits = units;
  return units.map((el, i) => {
    el.setAttribute('data-mc-id', String(i));
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    const allowEl = el.closest('[data-allow]');
    const cs = getComputedStyle(el);
    return { desc: desc(el), text: text.slice(0, 40), chars: text.length,
      allow: allowEl ? allowEl.getAttribute('data-allow').split(/\s+/).filter(Boolean) : [],
      deco: !!el.closest('[aria-hidden="true"]'), bold: (parseInt(cs.fontWeight, 10) || 400) >= 700 };
  });
}"""

SCAN_JS = r"""() => {
  const stage = window.__motion.stageElement;
  const units = window.__mcUnits || [];
  const S = stage.getBoundingClientRect();
  const SR = { l: S.left, t: S.top, r: S.right, b: S.bottom };
  const area = (a) => Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t);
  const inter = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const union = (a, b) => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) });
  const box = (q) => ({ l: q.left, t: q.top, r: q.right, b: q.bottom });
  const op = new Map();
  const eff = (el) => {
    if (!el || el === stage || el === document.body || el === document.documentElement) return 1;
    if (op.has(el)) return op.get(el);
    const cs = getComputedStyle(el);
    const v = cs.display === 'none' ? 0 : parseFloat(cs.opacity) * eff(el.parentElement);
    op.set(el, v);
    return v;
  };
  const INF = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
  const reg = new Map();
  const region = (node) => {  // clipping by the containers of node's children, the stage excluded
    if (!node || node === stage || node === document.body) return INF;
    if (reg.has(node)) return reg.get(node);
    let r = region(node.parentElement);
    const cs = getComputedStyle(node);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') r = inter(r, box(node.getBoundingClientRect()));
    reg.set(node, r);
    return r;
  };
  if (!window.__mcCx) { const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; window.__mcCx = cv.getContext('2d', { willReadFrequently: true }); }
  const cx = window.__mcCx;
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], Math.round((d[3] / 255) * 1000) / 1000]; };
  const r1 = (v) => Math.round(v * 10) / 10;
  return units.map((el, i) => {
    const cs = getComputedStyle(el);
    const split = !!(el.dataset && el.dataset.mcSplit);
    let parts = [el];
    if (split) { const ch = el.querySelectorAll('.mc-char'); parts = Array.from(ch.length ? ch : el.querySelectorAll('.mc-word')); }
    const svgEl = el instanceof SVGElement;
    const selfClip = !svgEl && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') ? box(el.getBoundingClientRect()) : null;
    let legibleParts = 0; let counted = 0; let visMax = 0; let U = null; let inS = 0; let tot = 0;
    for (const part of parts) {
      let b;
      if (!split) { const rg = document.createRange(); rg.selectNodeContents(el); b = box(rg.getBoundingClientRect()); if (area(b) < 0.5) b = box(el.getBoundingClientRect()); }
      else b = box(part.getBoundingClientRect());
      const a = area(b);
      if (a < 0.5) continue;
      counted += 1;
      const pcs = part === el ? cs : getComputedStyle(part);
      const o = pcs.visibility === 'visible' ? eff(part) : 0;
      let anc = region(part.parentElement);
      if (selfClip && part === el) anc = inter(anc, selfClip);
      const vin = inter(b, anc);            // what the containers leave visible
      const v = inter(vin, SR);             // ... and the frame
      const vf = area(v) / a;
      if (o > 0.05 && vf > 0.02) { U = U ? union(U, v) : v; visMax = Math.max(visMax, o); inS += area(v); tot += Math.max(area(vin), 1e-6); }
      if (o >= 0.85 && vf >= 0.95) legibleParts += 1;
    }
    const legible = counted > 0 && legibleParts / counted >= (counted > 1 ? 0.9 : 1);
    let fpx = parseFloat(cs.fontSize) || 0;
    const svg = el instanceof SVGElement;
    if (svg) { const m = el.getScreenCTM && el.getScreenCTM(); if (m) fpx *= Math.hypot(m.b, m.d); }
    else if (el.offsetHeight > 0) fpx *= el.getBoundingClientRect().height / el.offsetHeight;
    const clipsSelf = !svg && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.textOverflow === 'ellipsis');
    const overflow = clipsSelf && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    return [i, legible ? 1 : 0, Math.round(visMax * 1000) / 1000,
      U ? [r1(U.l - S.left), r1(U.t - S.top), r1(U.r - S.left), r1(U.b - S.top)] : null,
      tot ? Math.round((inS / tot) * 1000) / 1000 : 1, Math.round(fpx * 10) / 10, rgba(svg ? cs.fill : cs.color), overflow ? 1 : 0];
  });
}"""

HIDE_TEXT_JS = r"""(on) => {
  let s = document.getElementById('mc-hide-text');
  if (on && !s) {
    s = document.createElement('style');
    s.id = 'mc-hide-text';
    s.textContent = '[data-mc-id], [data-mc-id] * { color: transparent !important; -webkit-text-fill-color: transparent !important;'
      + ' text-shadow: none !important; text-decoration-color: transparent !important; -webkit-text-stroke-color: transparent !important; }'
      + ' svg [data-mc-id], svg [data-mc-id] * { fill: transparent !important; stroke: transparent !important; }';
    document.head.appendChild(s);
  }
  if (!on && s) s.remove();
  return new Promise((r) => requestAnimationFrame(() => r()));
}"""

FONTS_JS = r"""() => {
  const stage = window.__motion.stageElement;
  const fams = new Set();
  for (const el of [stage, ...stage.querySelectorAll('*')]) {
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    fams.add(getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''));
  }
  const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
    'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
  const faces = [];
  document.fonts.forEach((f) => faces.push({ family: f.family.replace(/^["']|["']$/g, ''), status: f.status }));
  const srcs = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (r.type !== CSSRule.FONT_FACE_RULE) continue;
      const fam = r.style.getPropertyValue('font-family').replace(/^["']|["']$/g, '').trim();
      const src = r.style.getPropertyValue('src');
      (srcs[fam] = srcs[fam] || []).push(/url\(\s*["']?data:/.test(src) ? 'incorporato' : /url\(\s*["']?https?:/.test(src) ? 'remoto' : 'file');
    }
  }
  const ctx = document.createElement('canvas').getContext('2d');
  const installed = (fam) => ['monospace', 'serif', 'sans-serif'].some((g) => {
    const s = 'mmmmmmmmmmlli0Oq@#WwQ'; ctx.font = `72px ${g}`; const a = ctx.measureText(s).width;
    ctx.font = `72px "${fam}", ${g}`; return ctx.measureText(s).width !== a; });
  return Array.from(fams).map((fam) => {
    if (generic.has(fam.toLowerCase())) return { family: fam, kind: 'generico', src: [] };
    const f = faces.filter((x) => x.family === fam);
    if (f.length) return { family: fam, kind: f.some((x) => x.status === 'loaded') ? 'caricato' : 'non caricato', src: srcs[fam] || [] };
    return { family: fam, kind: installed(fam) ? 'di sistema' : 'assente', src: [] };
  });
}"""


def cmd_check(a):
    import numpy as np
    from PIL import Image
    findings = []

    def add(sev, cat, msg):
        findings.append((sev, cat, msg))
    stats = []
    started = time.time()
    with Comp(a.page) as c:
        m = c.meta
        dur, fps, W, H = m['duration'], m['fps'], int(m['width']), int(m['height'])
        for w in m['warnings']:
            add('avviso', 'motore', w)
        # -- fonts
        for f in c.page.evaluate(FONTS_JS):
            fam, kind = f['family'], f['kind']
            if kind in ('assente', 'non caricato'):
                add('errore', 'font', f'"{fam}" non è disponibile: si vede un carattere di ripiego, diverso da macchina a macchina. Incorporalo con `fonts`')
            elif kind == 'di sistema':
                add('avviso', 'font', f'"{fam}" è installato qui ma non incorporato: altrove (e nell\'export su un\'altra macchina) si vedrà un ripiego')
            elif kind == 'generico':
                add('info', 'font', f'carattere generico "{fam}": l\'aspetto cambia da una macchina all\'altra; per un risultato stabile incorpora un font')
            elif 'remoto' in f['src']:
                add('avviso', 'font', f'"{fam}" arriva da un URL remoto: offline (export, CI) può mancare. Incorporalo con `fonts`')
        # -- determinism: the same instant reached by different paths must give the same pixels
        def arr(png):
            return np.asarray(Image.open(io.BytesIO(png)).convert('RGBA'), np.int16)
        ta, tb = c.snap(dur * 0.37), c.snap(dur * 0.71)
        a1 = arr(c.png(ta))
        c.seek(dur)
        c.seek(0)
        b1 = arr(c.png(tb))
        a2 = arr(c.png(ta))
        c.seek(dur * 0.05)
        b2 = arr(c.png(tb))
        for t, x, y in ((ta, a1, a2), (tb, b1, b2)):
            diff = np.abs(x - y)
            if diff.max() > 0:
                add('errore', 'determinismo', f'lo stesso istante ({num(t)} s) dà fotogrammi diversi secondo l\'ordine di ricerca: cambia il '
                    f'{pct(float((diff.max(axis=2) > 0).mean()))} dei pixel (fino a {int(diff.max())}/255). Stato nascosto: '
                    'Date.now(), performance.now(), casualità per fotogramma, accumuli in custom()/onFrame(), transizioni CSS o video')
        stats.append('determinismo: 2 istanti')
        # -- text layout sweep
        units = c.page.evaluate(SCAN_INIT_JS)
        dt = 1.0 / a.rate
        times = sorted({round(min(k * dt, dur), 4) for k in range(int(dur / dt) + 1)} | {round(dur, 4)})
        samples = []
        for t in times:
            c.seek(t)
            samples.append(c.page.evaluate(SCAN_JS))
        T, U = len(times), len(units)
        stats.append(f'campioni: {T} istanti ({a.rate:g}/s) · unità di testo: {U}')
        if U == 0:
            add('info', 'testo', 'nessun testo nella composizione: i controlli di leggibilità non si applicano')
        leg = np.zeros((T, U), bool)
        vis = np.zeros((T, U))
        sfrac = np.ones((T, U))
        fpx = np.zeros((T, U))
        ovf = np.zeros((T, U), bool)
        rects = [[None] * U for _ in range(T)]
        for k, rows in enumerate(samples):
            for r in rows:
                i = r[0]
                leg[k, i], vis[k, i], rects[k][i], sfrac[k, i], fpx[k, i], ovf[k, i] = bool(r[1]), r[2], r[3], r[4], r[5], bool(r[7])
        sa = m['safeAreas']['title']  # top, right, bottom, left
        safe_rect = (sa[3] * W, sa[0] * H, W - sa[1] * W, H - sa[2] * H)
        min_px = (0.035 * W) if H > W else (0.022 * H)

        def label(i):
            u = units[i]
            return f'{u["desc"]} «{u["text"]}»'

        structural = set()

        def emit(cat, i, mask, held_sev, transient_sev, what):
            for r0, r1 in runs(np.nonzero(mask)[0].tolist()):
                held = r1 - r0 >= 1
                sev = held_sev if held else transient_sev
                if sev == 'errore':
                    structural.add(i)
                if sev:
                    add(sev, cat, f'{label(i)} {what} {span(times[r0], times[r1])}' + ('' if held else ' (un solo campione: transitorio)'))

        def outside_safe(r):
            return r is not None and (r[0] < safe_rect[0] - 2 or r[1] < safe_rect[1] - 2 or r[2] > safe_rect[2] + 2 or r[3] > safe_rect[3] + 2)
        for i in range(U):
            u = units[i]
            allow = set(u['allow'])
            if not allow & {'frame', 'overflow'}:
                emit('fotogramma', i, (vis[:, i] >= 0.5) & (sfrac[:, i] < 0.98) & (sfrac[:, i] > 0.02), 'errore', 'info', 'è tagliato dal bordo del fotogramma')
            if 'overflow' not in allow:
                emit('taglio', i, ovf[:, i] & (vis[:, i] >= 0.5), 'errore', 'info', 'è tagliato dal suo contenitore (overflow)')
            if 'safe' not in allow and m['safe'] != 'none':
                emit('area sicura', i, leg[:, i] & np.array([outside_safe(rects[k][i]) for k in range(T)]), 'avviso', None,
                     f'esce dall\'area sicura dei titoli ({m["safe"]})')
            if not u['deco']:
                emit('dimensione', i, leg[:, i] & (fpx[:, i] < min_px), 'avviso', None, f'è piccolo per un video (< {num(min_px, 0)} px effettivi)')
            if u['deco'] or 'fast-text' in allow or i in structural:
                continue
            if vis[:, i].max() < 0.05:
                add('info', 'lettura', f'{label(i)} non è mai visibile')
                continue
            longest = max(((r1 - r0 + 1) * dt for r0, r1 in runs(np.nonzero(leg[:, i])[0].tolist())), default=0.0)
            need = max(READING_MIN, u['chars'] / READING_CPS)
            if longest + 1e-6 < need:
                add('avviso', 'lettura', f'{label(i)} resta leggibile al massimo {num(longest, 1)} s: per {u["chars"]} caratteri ne servono almeno '
                    f'{num(need, 1)} (17 car/s, minimo 5/6 s)')
        pairs = {}
        for k in range(T):
            live = [i for i in range(U) if leg[k, i] and rects[k][i] and 'overlap' not in units[i]['allow']]
            for x in range(len(live)):
                for y in range(x + 1, len(live)):
                    i, j = live[x], live[y]
                    ri, rj = rects[k][i], rects[k][j]
                    ov = max(0, min(ri[2], rj[2]) - max(ri[0], rj[0])) * max(0, min(ri[3], rj[3]) - max(ri[1], rj[1]))
                    small = min((ri[2] - ri[0]) * (ri[3] - ri[1]), (rj[2] - rj[0]) * (rj[3] - rj[1]))
                    if small > 0 and ov > 0.15 * small:
                        pairs.setdefault((i, j), []).append(k)
        for (i, j), ks in pairs.items():
            for r0, r1 in runs(ks):
                if r1 > r0:
                    add('avviso', 'sovrapposizione', f'{label(i)} e {label(j)} si sovrappongono {span(times[r0], times[r1])}')
        # -- contrast, against what is really behind the text (the text hidden, the frame captured)
        ctimes = [lab['time'] for lab in m['labels']] + [lab['time'] + 0.7 for lab in m['labels']] + [m['poster']]
        ctimes += [dur * q for q in (0.15, 0.3, 0.45, 0.6, 0.75, 0.9)]
        ctimes = sorted({c.snap(t) for t in ctimes})[:16]
        worst, measured, used, tally = {}, 0, 0, {}
        for t in ctimes:
            c.seek(t)
            rows = c.page.evaluate(SCAN_JS)
            cand = [r for r in rows if r[1] and r[3] and not units[r[0]]['deco'] and 'contrast' not in units[r[0]]['allow']]
            if not cand:
                continue
            used += 1
            c.page.evaluate(HIDE_TEXT_JS, True)
            bg = np.asarray(Image.open(io.BytesIO(c.png())).convert('RGB'), np.float32)
            c.page.evaluate(HIDE_TEXT_JS, False)
            for r in cand:
                i = r[0]
                x0, y0, x1, y1 = (int(round(v)) for v in r[3])
                crop = bg[max(0, y0):min(H, y1), max(0, x0):min(W, x1)]
                if crop.size == 0:
                    continue
                col = r[6]
                alpha = col[3] * r[2]
                if alpha < 0.05:
                    add('info', 'contrasto', f'{label(i)}: colore del testo trasparente (gradiente o maschera?), contrasto da giudicare a vista')
                    continue
                px = crop.reshape(-1, 3)
                comp_rgb = alpha * np.array(col[:3], np.float32) + (1 - alpha) * px
                ratios = contrast(rel_lum(comp_rgb), rel_lum(px))
                p10, med = float(np.percentile(ratios, 10)), float(np.median(ratios))
                need = 3.0 if (r[5] >= 24 or (units[i]['bold'] and r[5] >= 18.66)) else 4.5
                measured += 1
                seen, bad = tally.get(i, (0, 0))
                tally[i] = (seen + 1, bad + (med < need))
                if i not in worst or p10 < worst[i][0]:
                    worst[i] = (p10, med, t, hexcol(col), hexcol(np.median(px, axis=0)), need)
        stats.append(f'contrasto: {measured} misure in {used} istanti')
        for i, (p10, med, t, tc, bc, need) in worst.items():
            seen, bad = tally[i]
            if bad and 2 * bad >= seen:  # most of the time: a design problem, not a passing effect
                add('errore', 'contrasto', f'{label(i)}: {num(med, 1)}:1 a {num(t)} s (serve {num(need, 1)}:1), testo {tc} su {bc}; insufficiente '
                    f'in {bad} istanti su {seen}')
            elif bad:
                add('avviso', 'contrasto', f'{label(i)}: insufficiente in {bad} {"istante" if bad == 1 else "istanti"} su {seen}, il peggiore {num(med, 1)}:1 a {num(t)} s '
                    f'(serve {num(need, 1)}:1), testo {tc} su {bc}: un effetto di passaggio o uno sfondo che cambia?')
            elif p10 < need:
                add('avviso', 'contrasto', f'{label(i)}: sufficiente in media ({num(med, 1)}:1) ma {num(p10, 1)}:1 sulla parte peggiore dello sfondo '
                    f'a {num(t)} s (serve {num(need, 1)}:1)')
        # -- every frame at low resolution: flashes, stillness, ending, loop seam
        sweep_fps = min(int(round(fps)), a.sweep_fps)
        frames = c.frames_lowres(sweep_fps)
        stats.append(f'lampeggi e movimento: {len(frames)} fotogrammi a {sweep_fps} fps')
        log = list(c.log)
        failed = list(c.failed)
        remote = sorted(c.remote)
    stack = np.stack(frames).astype(np.float32) / 255.0
    lin = srgb_to_linear(stack)
    lum = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    tot = lin.sum(axis=-1) + 1e-9
    redv = np.where(lin[..., 0] / tot >= 0.8, np.maximum(0, lin[..., 0] - lin[..., 1] - lin[..., 2]) * 320, 0)
    for t0, t1, n, kind, w in flash_events(np.stack([window_means(x) for x in lum]), np.stack([window_means(x) for x in redv]), sweep_fps):
        add('errore', 'lampeggi', f'{n} transizioni di {kind} in un secondo {span(t0, t1)} ({where(w)}): oltre 3 lampeggi al secondo (WCAG 2.3.1). '
            'Rallenta il ritmo, riduci la differenza di luminosità o l\'area')
    d = (np.abs(np.diff(lum, axis=0)) > 0.01).mean(axis=(1, 2)) if len(lum) > 1 else np.zeros(1)  # share of pixels that change
    if dur >= 1.5 and float(d.max()) == 0.0:
        add('errore', 'movimento', 'nessun cambiamento in tutta la durata: la timeline non muove niente (build fallito, o tween su elementi inesistenti?)')
    else:
        for r0, r1 in runs(np.nonzero(d < 0.0002)[0].tolist()):
            length = (r1 - r0 + 1) / sweep_fps
            if length >= 2.5:
                add('info', 'movimento', f'immagine ferma per {num(length, 1)} s {span(r0 / sweep_fps, (r1 + 1) / sweep_fps)}: pausa voluta '
                    '(lettura, respiro)? Se no è una scena finita prima del tempo: accorciala o aggiungi racconto, non oscillazioni')
        if m['loop']:
            seam = float((np.abs(lum[-1] - lum[0]) > 0.01).mean())
            typical = float(np.median(d[d > 0])) if (d > 0).any() else 0.0
            if seam > 2 * typical + 0.0005:
                add('avviso', 'loop', f'giunzione del loop visibile: tra l\'ultimo fotogramma e il primo cambia il {pct(seam)} dei pixel, '
                    f'contro il {pct(typical)} di un passo normale')
        else:
            k = max(1, int(0.25 * sweep_fps))
            if len(d) >= k and float(d[-k:].mean()) > 0.0005:
                add('info', 'finale', 'negli ultimi 0,25 s il movimento è ancora in corso: il pezzo finisce a metà gesto. Se il taglio non è voluto, '
                    'lascia assestare l\'ultima posa')
    for kind, text in log:
        if '[motion]' in text:
            continue
        add('errore' if kind in ('error', 'pageerror') else 'avviso', 'console', f'{kind}: {text}')
    for url in failed:
        add('errore', 'risorse', f'richiesta fallita: {url}')
    if remote:
        add('avviso', 'risorse', 'la composizione carica risorse remote (' + ', '.join(remote) + '): offline e nell\'export possono mancare')
    order = {'errore': 0, 'avviso': 1, 'info': 2}
    findings.sort(key=lambda f: (order[f[0]], f[1]))
    n_err = sum(f[0] == 'errore' for f in findings)
    n_warn = sum(f[0] == 'avviso' for f in findings)
    n_info = len(findings) - n_err - n_warn
    print(f'check: {a.page} — {W}×{H}, {num(fps, 3).rstrip("0").rstrip(",")} fps, {num(dur)} s, aree sicure "{m["safe"]}", '
          f'{"loop" if m["loop"] else "non loop"} ({num(time.time() - started, 1)} s)')
    print(' · '.join(stats))
    for sev, title in (('errore', 'ERRORI'), ('avviso', 'AVVISI'), ('info', 'INFO')):
        items = [f for f in findings if f[0] == sev]
        if items:
            print(f'\n{title} ({len(items)})')
            for _, cat, msg in items:
                print(f'  - [{cat}] {msg}')
    failed_gate = n_err > 0 or (a.strict and n_warn > 0)
    print(f'\nesito: {"NON SUPERATO" if failed_gate else "SUPERATO"} — {n_err} errori, {n_warn} avvisi, {n_info} info')
    return 1 if failed_gate else 0


# ------------------------------------------------------------------------------------------------ audio
def spectrogram(x, sr, cues, out, duration):
    import numpy as np
    from PIL import Image, ImageDraw
    hop = max(1, int(sr * max(0.005, duration / 1600)))
    n = 2048
    padded = np.pad(x, (n // 2, n // 2))
    frames = np.lib.stride_tricks.sliding_window_view(padded, n)[::hop] * np.hanning(n)
    spec = 20 * np.log10(np.abs(np.fft.rfft(frames, axis=1)) + 1e-9)
    freqs = np.fft.rfftfreq(n, 1 / sr)
    H = 280
    bands = np.geomspace(40, min(16000, sr / 2 - 1), H)
    img = spec[:, np.clip(np.searchsorted(freqs, bands), 0, len(freqs) - 1)].T[::-1]
    img = np.clip((img - img.max() + 80) / 80, 0, 1)  # normalised to the loudest point, 80 dB of range
    rgb = np.stack([img ** 0.8 * 255, img ** 1.6 * 205, img ** 3 * 120 + (1 - img) * 16], -1).astype(np.uint8)
    pic = Image.fromarray(rgb)
    left = 56
    canvas = Image.new('RGB', (pic.width + left + 10, H + 128), (14, 14, 16))
    canvas.paste(pic, (left, 0))
    d = ImageDraw.Draw(canvas)
    font = load_font(11)
    rms = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, 'same')[::hop] + 1e-12)
    env = 20 * np.log10(rms)
    base = H + 110
    for db in (0, -20, -40, -60):
        y = base - (db + 60) * 1.6
        d.line([(left, y), (left + pic.width, y)], fill=(40, 40, 46))
        d.text((6, y - 6), f'{db} dB', fill=(150, 150, 160), font=font)
    for i in range(1, min(len(env), pic.width)):
        y0 = base - (max(env[i - 1], -60) + 60) * 1.6
        y1 = base - (max(env[i], -60) + 60) * 1.6
        d.line([(left + i - 1, y0), (left + i, y1)], fill=(240, 200, 120))
    for f in (100, 1000, 10000):
        y = H - 1 - int(np.searchsorted(bands, f))
        d.text((6, y - 6), f'{f // 1000} kHz' if f >= 1000 else f'{f} Hz', fill=(220, 220, 228), font=font)
    for k, cue in enumerate(cues):
        xx = left + int(cue['time'] * sr / hop)
        d.line([(xx, 0), (xx, base)], fill=(110, 190, 255))
        d.text((xx + 2, 2 + (k % 4) * 12), cue['type'], fill=(200, 230, 255), font=font)
    canvas.save(out)


def cmd_audio(a):
    import numpy as np
    with Comp(a.page) as c:
        if not c.meta['hasAudio']:
            die('la composizione non ha audio: aggiungi comp.audio(...) e incorpora il modulo (init --audio o sync --audio)')
        wav, info = c.audio_wav({'sampleRate': a.rate})
        cues, dur = c.meta['cues'], c.meta['duration']
        log = [f'{k}: {t}' for k, t in c.log if '[motion]' not in t]
    out = pathlib.Path(a.out)
    out.write_bytes(wav)
    data, sr = read_wav(out)
    mono = data.mean(axis=1)
    peak = float(np.abs(data).max())
    peak_db = 20 * math.log10(max(peak, 1e-9))
    rms_db = 20 * math.log10(max(float(np.sqrt((data ** 2).mean())), 1e-9))
    over = int((np.abs(data) >= 1.0).sum())
    loud = loudness(out)
    print(f'audio: {out} — {num(len(data) / sr)} s, {sr} Hz, stereo, float a 32 bit')
    print(f'picco {num(peak_db, 1)} dBFS · true peak {num(loud["TP"], 1)} dBTP · loudness integrata {num(loud["I"], 1)} LUFS · '
          f'LRA {num(loud["LRA"], 1)} LU · RMS {num(rms_db, 1)} dBFS · campioni oltre 0 dBFS: {over}')
    if peak_db < -60:
        print('errore: il rendering è silenzioso: i cue cadono fuori dalla durata o i livelli sono troppo bassi')
    for cue in cues:
        s0, s1 = int(max(0, cue['time']) * sr), int(min(cue['end'], cue['time'] + max(0.6, min(cue['end'] - cue['time'], 4.0)), dur) * sr)
        seg = data[s0:s1]
        if len(seg) == 0:
            print(f'  {cue["type"]:8s} a {num(cue["time"])} s: fuori dalla durata')
            continue
        p = 20 * math.log10(max(float(np.abs(seg).max()), 1e-9))
        r = 20 * math.log10(max(float(np.sqrt((seg ** 2).mean())), 1e-9))
        print(f'  {cue["type"]:8s} a {num(cue["time"])} s: picco {num(p, 1)} dBFS · media {num(r, 1)} dBFS')
    if a.png:
        spectrogram(mono, sr, cues, a.png, dur)
        print(f'spettrogramma: {a.png} (frequenze su scala logaritmica, cue segnati in azzurro, inviluppo sotto)')
    print('console: ' + ('; '.join(log) if log else 'pulita'))
    print('non puoi ascoltarlo: consegna il WAV all\'utente e chiedi quale momento non lo convince')
    return 0


# ------------------------------------------------------------------------------------------------ export
def ffmpeg_command(ff, fmt, fps, out, wav, alpha, a, width):
    cmd = [ff, '-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(fps), '-c:v', 'png', '-i', '-']
    if wav:
        cmd += ['-i', str(wav)]
    tags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
    if fmt == 'mp4':
        cmd += ['-c:v', 'libx264', '-preset', 'slow', '-crf', str(18 if a.crf is None else a.crf), '-tune', 'animation',
                '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', *tags, '-color_range', 'tv', '-movflags', '+faststart']
        if wav:
            cmd += ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
    elif fmt == 'webm':
        pix = 'yuva420p' if alpha else 'yuv420p'
        cmd += ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', str(30 if a.crf is None else a.crf), '-row-mt', '1', '-deadline', 'good',
                '-cpu-used', '2', '-vf', f'scale=out_color_matrix=bt709:out_range=tv,format={pix}', *tags, '-color_range', 'tv']
        if alpha:
            cmd += ['-auto-alt-ref', '0']
        if wav:
            cmd += ['-c:a', 'libopus', '-b:a', '160k', '-ar', '48000']
    elif fmt == 'mov':
        pix = 'yuva444p10le' if alpha else 'yuv422p10le'
        cmd += ['-c:v', 'prores_ks', '-profile:v', '4' if alpha else '3', '-vendor', 'apl0',
                '-vf', f'scale=out_color_matrix=bt709:out_range=tv,format={pix}', *tags]
        if wav:
            cmd += ['-c:a', 'pcm_s24le', '-ar', '48000']
    elif fmt == 'gif':
        gw = min(a.gif_width, width)
        cmd += ['-vf', f'scale={gw}:-1:flags=lanczos,split[x][y];[x]palettegen=stats_mode=diff[p];'
                       '[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0']
    if wav:
        cmd += ['-map', '0:v:0', '-map', '1:a:0', '-shortest']
    cmd.append(str(out))
    return cmd


def extract_frame(ff, path, idx):
    import numpy as np
    from PIL import Image
    r = subprocess.run([ff, '-v', 'error', '-i', str(path), '-vf', f'select=eq(n\\,{idx})', '-vframes', '1', '-f', 'image2pipe',
                        '-c:v', 'png', '-'], capture_output=True)
    if not r.stdout:
        return None
    return np.asarray(Image.open(io.BytesIO(r.stdout)).convert('RGB'), np.float32)


def cmd_export(a):
    import numpy as np
    from PIL import Image
    fmt = a.format
    ff = ffmpeg_exe() if fmt != 'png' else None
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='motion-export-'))
    with Comp(a.page, scale=a.scale) as c:
        m = c.meta
        dur = m['duration']
        fps = a.fps or (min(25, m['fps']) if fmt == 'gif' else m['fps'])
        t0, t1 = 0.0, dur
        if a.range:
            p = a.range.split(':')
            t0, t1 = max(0.0, float(p[0])), min(dur, float(p[1]))
            if t1 <= t0:
                die('--range: la fine deve venire dopo l\'inizio')
        n = max(1, int(round((t1 - t0) * fps)))
        W, H = int(round(m['width'] * a.scale)), int(round(m['height'] * a.scale))
        alpha = bool(m['transparent']) and fmt in ('mov', 'webm', 'png')
        if m['transparent'] and fmt in ('mp4', 'gif'):
            print('avviso: lo sfondo è trasparente, ma MP4 e GIF non hanno alfa: diventa nero. Per l\'alfa usa --format mov o webm')
        if fmt in ('mp4', 'webm') and (W % 2 or H % 2):
            die(f'{W}×{H}: H.264 e VP9 in 4:2:0 vogliono lati pari; cambia --scale o le dimensioni')
        if alpha:
            c.set_alpha()
        stem = pathlib.Path(a.page).stem
        out = pathlib.Path(a.out or (f'{stem}_png' if fmt == 'png' else f'{stem}.{fmt}'))
        wav, report = None, None
        if a.audio:
            if fmt in ('gif', 'png'):
                print('avviso: --audio ignorato: GIF e sequenze PNG non hanno audio')
            elif not m['hasAudio']:
                die('--audio richiesto, ma la composizione non ha comp.audio(...) o il modulo audio non è incorporato')
            else:
                raw_bytes, _ = c.audio_wav({'sampleRate': 48000, 'from': t0, 'to': t0 + n / fps})
                raw = tmp / 'grezzo.wav'
                raw.write_bytes(raw_bytes)
                data, sr = read_wav(raw)
                before = loudness(raw)
                gain, limited, mode = 0.0, False, 'lineare'
                wav = tmp / 'audio.wav'
                if a.loudness != 'none' and a.limiter and before['I'] is not None and math.isfinite(before['I']):
                    target, ceiling = LOUDNESS[a.loudness]
                    gain, mode = target - before['I'], 'limitatore'
                    lim = 10 ** ((ceiling - 0.5) / 20)  # sample-peak limiter, with margin for inter-sample peaks
                    for _ in range(4):  # limiting lowers the loudness: correct the gain and limit again from the raw mix
                        r = subprocess.run([ff, '-v', 'error', '-y', '-i', str(raw), '-af',
                                            f'volume={gain:.2f}dB,alimiter=limit={lim:.4f}:attack=5:release=60:level=disabled',
                                            '-c:a', 'pcm_f32le', str(wav)], capture_output=True, text=True)
                        if r.returncode != 0:
                            die('limitatore fallito: ' + r.stderr[-500:])
                        after = loudness(wav)
                        if after['I'] is None or abs(target - after['I']) < 0.3:
                            break
                        gain += target - after['I']
                    if after['TP'] is not None and math.isfinite(after['TP']) and after['TP'] > ceiling:
                        data2, _ = read_wav(wav)
                        write_wav_float(wav, data2 * (10 ** ((ceiling - after['TP']) / 20)), sr)
                else:
                    if a.loudness != 'none':
                        target, ceiling = LOUDNESS[a.loudness]
                        gain, limited = plan_gain(before['I'], before['TP'], target, ceiling)
                    write_wav_float(wav, data * (10 ** (gain / 20)), sr)
                report = {'before': before, 'gain': gain, 'limited': limited, 'mode': mode, 'after': loudness(wav)}
        if fmt == 'png':
            out.mkdir(parents=True, exist_ok=True)
            proc = None
        else:
            out.parent.mkdir(parents=True, exist_ok=True)
            proc = subprocess.Popen(ffmpeg_command(ff, fmt, fps, out, wav, alpha, a, W), stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        started = time.time()
        step = max(1, n // 10)
        for i in range(n):
            t = t0 + i / fps
            png = c.png_blur(t, a.motion_blur, a.shutter, fps, alpha) if a.motion_blur > 1 else c.png(t)
            if proc is None:
                (out / f'frame_{i:05d}.png').write_bytes(png)
            else:
                try:
                    proc.stdin.write(png)
                except BrokenPipeError:
                    break
            if (i + 1) % step == 0 or i + 1 == n:
                print(f'  fotogrammi {i + 1}/{n}', file=sys.stderr)
        if proc is not None:
            proc.stdin.close()
            err = proc.stderr.read().decode('utf-8', 'replace')
            if proc.wait() != 0:
                die(f'ffmpeg ha fallito:\n{err[-3000:]}')
        elapsed = time.time() - started
        print(f'export: {out} — {fmt}, cattura {W}×{H}, {num(fps, 3).rstrip("0").rstrip(",")} fps, {n} fotogrammi '
              f'({num(n / fps)} s da {num(t0)} s), alfa {"sì" if alpha else "no"}, '
              f'motion blur {f"{a.motion_blur} campioni a {a.shutter:g}°" if a.motion_blur > 1 else "no"} · {num(elapsed, 1)} s')
        # -- verification of what was written
        probe = shutil.which('ffprobe')
        if fmt == 'png':
            print(f'verifica: {len(list(out.glob("frame_*.png")))} file PNG in {out}/')
        elif not probe:
            print('verifica: ffprobe assente, controllo del file saltato')
        else:
            r = subprocess.run([probe, '-v', 'error', '-count_packets', '-print_format', 'json', '-show_streams', '-show_format', str(out)],
                               capture_output=True, text=True)
            info = json.loads(r.stdout or '{}')
            vs = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), None)
            au = next((s for s in info.get('streams', []) if s.get('codec_type') == 'audio'), None)
            if not vs:
                die('il file scritto non contiene video: ' + (r.stderr or '')[-500:])
            num_, den = (int(x) for x in vs.get('r_frame_rate', '0/1').split('/'))
            packets = int(vs.get('nb_read_packets', 0) or 0)
            print(f"verifica: {vs['codec_name']} {vs['width']}×{vs['height']} {vs.get('pix_fmt', '?')} · {num(num_ / max(den, 1), 3)} fps · "
                  f"{packets} fotogrammi (attesi {n}) · colore {vs.get('color_space', '—')}/{vs.get('color_transfer', '—')}/"
                  f"{vs.get('color_primaries', '—')} · {num(float(info['format'].get('duration', 0)))} s · "
                  f"{int(info['format'].get('size', 0)) // 1024} kB")
            if fmt != 'gif' and packets and packets != n:
                print(f'  avviso: {packets} fotogrammi invece di {n}')
            if au:
                print(f"  audio: {au['codec_name']} {au.get('sample_rate')} Hz, {au.get('channels')} canali")
            if fmt in ('mp4', 'webm') and not alpha and a.motion_blur <= 1:
                for idx in sorted({n // 3, (2 * n) // 3}):
                    ref = np.asarray(Image.open(io.BytesIO(c.png(t0 + idx / fps))).convert('RGB'), np.float32)
                    got = extract_frame(ff, out, idx)
                    if got is None or got.shape != ref.shape:
                        print(f'  fotogramma {idx}: non estraibile per il confronto')
                        continue
                    mse = float(((ref - got) ** 2).mean())
                    psnr = 10 * math.log10(255 ** 2 / mse) if mse > 0 else float('inf')
                    mad = float(np.abs(ref - got).mean())
                    shift = (got.reshape(-1, 3).mean(axis=0) - ref.reshape(-1, 3).mean(axis=0)).round(2).tolist()
                    flag = '  ← controlla colori e compressione' if psnr < 32 or mad > 2.5 else ''
                    print(f'  fotogramma {idx} contro la cattura diretta: PSNR {num(psnr, 1)} dB · scarto medio {num(mad, 2)}/255 · '
                          f'deriva media RGB {shift}{flag}')
        if report:
            b, f = report['before'], report['after']
            lim = ' (limitato dal true peak)' if report['limited'] else ''
            print(f"  loudness {a.loudness}: {num(b['I'], 1)} → {num(f['I'], 1)} LUFS, true peak {num(b['TP'], 1)} → {num(f['TP'], 1)} dBTP, "
                  f"guadagno {num(report['gain'], 1)} dB ({report['mode']}){lim}")
            if a.loudness != 'none' and report['limited']:
                print('  nota: obiettivo non raggiunto per non superare il true peak; --limiter lo raggiunge comprimendo i picchi (decidilo con l\'utente)')
            hits = [cu for cu in m['cues'] if cu['type'] in ('hit', 'tick', 'pop', 'sub') and t0 <= cu['time'] < t0 + n / fps - 0.1]
            if hits:
                ref, sr_ref = read_wav(wav)
                r = subprocess.run([ff, '-v', 'error', '-i', str(out), '-vn', '-ac', '2', '-ar', str(sr_ref), '-f', 'f32le', '-'], capture_output=True)
                got = np.frombuffer(r.stdout, '<f4').reshape(-1, 2).mean(axis=1)
                refm = ref.mean(axis=1)
                cue = next((h for h in hits if h['type'] == 'hit'), hits[0])
                tt = cue['time'] - t0
                dec, maxlag = 4, int(0.1 * sr_ref) // 4
                c0, c1 = max(0, int((tt - 0.15) * sr_ref)), int((tt + 0.35) * sr_ref)
                pattern = refm[c0:c1][: (c1 - c0) // dec * dec].reshape(-1, dec).mean(axis=1)
                g0 = c0 - maxlag * dec
                window = got[max(0, g0):c1 + maxlag * dec]
                window = window[: len(window) // dec * dec].reshape(-1, dec).mean(axis=1)
                if g0 >= 0 and len(window) > len(pattern) > 0 and np.abs(pattern).max() > 0:
                    corr = np.correlate(window, pattern, 'valid')
                    lag_ms = (int(np.argmax(corr)) - maxlag) * dec / sr_ref * 1000
                    print(f'  sincronia: audio nel file allineato al WAV di riferimento con scarto {"+" if lag_ms >= 0 else ""}{num(lag_ms, 1)} ms '
                          f'(correlazione intorno a {cue["type"]} a {num(tt, 3)} s; il cue è sul suo istante per costruzione)')
    shutil.rmtree(tmp, ignore_errors=True)
    return 0


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    i = sub.add_parser('init', help='nuova composizione dal template')
    i.add_argument('out')
    i.add_argument('--size', default='16:9', help='LxA o 16:9, 9:16, 1:1, 4:5, 4k (predefinito 16:9 = 1920x1080)')
    i.add_argument('--fps', type=int, default=60)
    i.add_argument('--duration', type=float, default=5.0)
    i.add_argument('--safe', choices=['broadcast', 'social', 'none'])
    i.add_argument('--audio', action='store_true', help='incorpora anche il modulo audio')
    i.add_argument('--title', default='Composizione')
    i.add_argument('--force', action='store_true')
    s = sub.add_parser('sync', help='reincorpora motore e audio aggiornati')
    s.add_argument('page')
    s.add_argument('--audio', action='store_true')
    f = sub.add_parser('fonts', help='incorpora un carattere in base64')
    f.add_argument('page')
    f.add_argument('--google', help='famiglia del repo google/fonts, es. "Inter" (scarica da raw.githubusercontent.com)')
    f.add_argument('--file', help='file di font locale (ttf, otf, woff, woff2)')
    f.add_argument('--family', help='nome della famiglia per --file')
    f.add_argument('--weight', help='per --file: peso o intervallo, es. 400 o "100 900"')
    f.add_argument('--style', default='normal', choices=['normal', 'italic'])
    f.add_argument('--weights', default='400,700', help='per famiglie non variabili: pesi da incorporare')
    f.add_argument('--italic', action='store_true', help='incorpora anche il corsivo')
    f.add_argument('--subset', default='latin', choices=['latin', 'latin-ext', 'all'])
    fr = sub.add_parser('frames', help='fotogrammi, foglio di contatto, onion skin, filmstrip')
    fr.add_argument('page')
    fr.add_argument('--at', help='istanti in secondi, separati da virgole')
    fr.add_argument('--every', type=float, help='un fotogramma ogni N secondi')
    fr.add_argument('--n', type=int, default=9, help='senza --at/--every: N istanti equidistanti + etichette + poster')
    fr.add_argument('--onion', help='INIZIO:FINE[:N] — pose sovrapposte per giudicare spaziatura, archi e sovrapposizioni')
    fr.add_argument('--strip', help='INIZIO:FINE[:N] — pose affiancate')
    fr.add_argument('--scale', type=float, default=1.0)
    fr.add_argument('--out', default='fotogrammi')
    c = sub.add_parser('check', help='controllo automatico di qualità')
    c.add_argument('page')
    c.add_argument('--rate', type=float, default=10.0, help='campioni al secondo per testo e layout')
    c.add_argument('--sweep-fps', type=int, default=60, help='fotogrammi al secondo (massimo) per lampeggi e movimento')
    c.add_argument('--strict', action='store_true', help='anche gli avvisi fanno fallire')
    au = sub.add_parser('audio', help='rendering offline del suono e misure')
    au.add_argument('page')
    au.add_argument('--out', default='suono.wav')
    au.add_argument('--png', default='spettrogramma.png', help='spettrogramma (stringa vuota per non farlo)')
    au.add_argument('--rate', type=int, default=48000)
    e = sub.add_parser('export', help='video, GIF o sequenza PNG')
    e.add_argument('page')
    e.add_argument('--format', default='mp4', choices=['mp4', 'webm', 'mov', 'gif', 'png'])
    e.add_argument('--out')
    e.add_argument('--fps', type=float, help='predefinito: quello della composizione (GIF: al massimo 25)')
    e.add_argument('--scale', type=float, default=1.0, help='2 = doppia risoluzione (es. 4K da 1080p)')
    e.add_argument('--range', help='INIZIO:FINE in secondi')
    e.add_argument('--audio', action='store_true', help='rende e unisce il suono della composizione')
    e.add_argument('--loudness', default='web', choices=['web', 'streaming', 'broadcast', 'none'])
    e.add_argument('--limiter', action='store_true', help='raggiunge la loudness comprimendo i picchi (senza: solo guadagno lineare)')
    e.add_argument('--motion-blur', type=int, default=0, help='campioni per fotogramma (8-16); 0 = spento')
    e.add_argument('--shutter', type=float, default=180.0, help='angolo dell\'otturatore in gradi (180 = convenzione cinema)')
    e.add_argument('--crf', type=int, help='qualità: MP4 18 (più basso = migliore), WebM 30')
    e.add_argument('--gif-width', type=int, default=960)
    args = ap.parse_args()
    handlers = {'init': cmd_init, 'sync': cmd_sync, 'fonts': cmd_fonts, 'frames': cmd_frames, 'check': cmd_check,
                'audio': cmd_audio, 'export': cmd_export}
    try:
        sys.exit(handlers[args.cmd](args) or 0)
    except ValueError as exc:
        die(str(exc))


if __name__ == '__main__':
    main()
