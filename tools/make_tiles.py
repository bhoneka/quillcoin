"""Slice the whole-map render (6400 px = blocks -51,200..+51,200, 16 blocks per px) into an XYZ tile pyramid for Leaflet.
Canvas is 8192 px with the map centred, so block (0,0) sits at canvas pixel (4096,4096) at zoom 5. All-black tiles are skipped."""
import os, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA'); canvas = Image.new('RGB', (8192, 8192), (0, 0, 0)); canvas.paste(im, (896, 896), im)
n_written = 0
for z in range(5, -1, -1):
    size = 256 << z
    level = canvas if z == 5 else canvas.resize((size, size), Image.LANCZOS)
    n = size // 256
    for ty in range(n):
        for tx in range(n):
            tile = level.crop((tx * 256, ty * 256, tx * 256 + 256, ty * 256 + 256))
            if tile.getbbox() is None: continue
            d = os.path.join(out, str(z), str(tx)); os.makedirs(d, exist_ok=True)
            tile.save(os.path.join(d, f'{ty}.webp'), quality=82, method=4); n_written += 1
    print('zoom', z, 'done', flush=True)
Image.new('RGB', (256, 256), (0, 0, 0)).save(os.path.join(out, 'blank.webp'), quality=50)
print('tiles written:', n_written)
