#!/usr/bin/env python3
"""
Genera la versión "todo en uno" de la app para servirla desde una
Supabase Edge Function.

- Junta index.html + styles.css + supabase-config.js + app.js en un solo HTML.
- Lo comprime (gzip) y lo codifica en base64 dentro de deploy/functions/cuenta/page.ts.

Uso:  python3 deploy/build_standalone.py
Luego redeployar la función 'cuenta' con esos archivos.
"""
import base64, gzip, os, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FN = ROOT / "deploy" / "functions" / "cuenta"
FN.mkdir(parents=True, exist_ok=True)

def read(p): return (ROOT / p).read_text(encoding="utf-8")

html = read("index.html")
html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{read('styles.css')}\n</style>")
html = html.replace('<script src="supabase-config.js"></script>', f"<script>\n{read('supabase-config.js')}\n</script>")
# La semilla del Excel se omite en la versión online (offline se cubre con la caché local)
html = html.replace('<script src="data.js"></script>', '<script>window.SEED_DATA={cuentas:{},proveedores:{}};</script>')
html = html.replace('<script src="app.js"></script>', f"<script>\n{read('app.js')}\n</script>")

(FN.parent.parent / "standalone.html").write_text(html, encoding="utf-8")
b64 = base64.b64encode(gzip.compress(html.encode("utf-8"), 9)).decode("ascii")
(FN / "page.ts").write_text(f'export const PAGE_GZ_B64 = "{b64}";\n', encoding="utf-8")
print(f"OK  html={len(html.encode())}B  page.ts={len(b64)}B (gzip+base64)")
