"""Test della logica pura di motion_tools.py (nessun browser): python -m unittest discover -s scripts -p "test_*.py"."""
import pathlib
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import motion_tools as mt  # noqa: E402


def square(hz, fps=60, dur=2.0, lo=0.05, hi=0.6):
    t = np.arange(int(dur * fps)) / fps
    return np.where((np.floor(t * hz * 2) % 2) == 0, lo, hi)


def events(series, red=False, fps=60):
    data = np.stack([series, np.full_like(series, 0.2)], axis=1)
    zero = np.zeros_like(data)
    return mt.flash_events(zero, data, fps) if red else mt.flash_events(data, zero, fps)


class Lampeggi(unittest.TestCase):
    def test_cinque_lampeggi_al_secondo_falliscono(self):
        ev = events(square(5))
        self.assertTrue(ev)
        self.assertEqual(ev[0][3], 'luminanza')

    def test_tre_lampeggi_al_secondo_passano(self):
        self.assertEqual(events(square(3)), [])

    def test_una_dissolvenza_lenta_e_un_solo_cambiamento(self):
        self.assertEqual(mt.turning_points(np.linspace(0, 1, 60), 0.1), [0, 59])
        self.assertEqual(events(np.linspace(0, 1, 120)), [])

    def test_sfarfallio_sotto_soglia_passa(self):
        self.assertEqual(events(square(10, lo=0.30, hi=0.34)), [])

    def test_lampi_tra_toni_chiari_non_contano(self):
        self.assertEqual(events(square(8, lo=0.85, hi=0.98)), [])

    def test_lampi_di_rosso_saturo(self):
        ev = events(square(5, lo=0.0, hi=50.0), red=True)
        self.assertTrue(ev)
        self.assertEqual(ev[0][3], 'rosso saturo')


class Supporto(unittest.TestCase):
    def test_runs(self):
        self.assertEqual(mt.runs([0, 1, 2, 5, 6, 9]), [(0, 2), (5, 6), (9, 9)])
        self.assertEqual(mt.runs([]), [])

    def test_contrasto_wcag(self):
        grey = mt.rel_lum(np.array([119.0, 119.0, 119.0]))
        white = mt.rel_lum(np.array([255.0, 255.0, 255.0]))
        self.assertAlmostEqual(float(mt.contrast(grey, white)), 4.48, places=2)
        self.assertAlmostEqual(float(mt.contrast(mt.rel_lum(np.zeros(3)), white)), 21.0, places=6)

    def test_guadagno_lineare_con_tetto(self):
        self.assertEqual(mt.plan_gain(-20.0, -9.0, -14.0, -1.5), (6.0, False))
        g, limited = mt.plan_gain(-20.0, -6.0, -14.0, -1.5)
        self.assertTrue(limited)
        self.assertAlmostEqual(g, 4.5)
        self.assertEqual(mt.plan_gain(float('-inf'), None, -14.0, -1.5), (0.0, False))

    def test_formati(self):
        self.assertEqual(mt.parse_size('9:16'), (1080, 1920, 'social'))
        self.assertEqual(mt.parse_size('1280x720'), (1280, 720, 'broadcast'))
        with self.assertRaises(ValueError):
            mt.parse_size('grande')

    def test_marcatori(self):
        html = '<script>/*MC-RUNTIME:BEGIN*/vecchio/*MC-RUNTIME:END*/</script>'
        out, ok = mt.inline_block(html, 'RUNTIME', 'nuovo </script> qui')
        self.assertTrue(ok)
        self.assertIn('nuovo <\\/script> qui', out)
        self.assertNotIn('vecchio', out)
        self.assertEqual(mt.inline_block('<p>niente</p>', 'RUNTIME', 'x'), ('<p>niente</p>', False))

    def test_metadata_google_fonts(self):
        text = '''name: "Inter"
license: "OFL"
fonts {
  name: "Inter"
  style: "normal"
  weight: 400
  filename: "Inter[opsz,wght].ttf"
}
fonts {
  name: "Inter"
  style: "italic"
  weight: 400
  filename: "Inter-Italic[opsz,wght].ttf"
}
axes {
  tag: "wght"
  min_value: 100.0
  max_value: 900.0
}'''
        md = mt.parse_metadata_pb(text)
        self.assertEqual((md['name'], md['license']), ('Inter', 'OFL'))
        self.assertEqual([f['style'] for f in md['fonts']], ['normal', 'italic'])
        self.assertEqual(md['axes']['wght'], (100.0, 900.0))

    def test_font_per_famiglia_sostituito(self):
        html = '<style>/*MC-FONTS:BEGIN*/\n/*MC-FONTS:END*/</style>'
        once = mt.put_fonts(html, 'Inter', 'A')
        twice = mt.put_fonts(once, 'Inter', 'B')
        self.assertIn('B', twice)
        self.assertEqual(twice.count('/* font: Inter */'), 1)

    def test_wav_float_andata_e_ritorno(self):
        data = np.stack([np.linspace(-0.5, 0.5, 480), np.zeros(480)], axis=1).astype(np.float32)
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / 'x.wav'
            mt.write_wav_float(p, data, 48000)
            back, sr = mt.read_wav(p)
        self.assertEqual(sr, 48000)
        np.testing.assert_allclose(back, data, atol=1e-7)


if __name__ == '__main__':
    unittest.main()
