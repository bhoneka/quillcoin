"""Whole-map render of a Xaero World Map folder at 16 blocks per pixel (one pixel per chunk, mean colour).
usage: render_map.py <mw$default folder> <out.png> <radius in regions>   (100 = ±51,200 blocks → 6400 px)"""
import os, sys, time, multiprocessing as mp
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xrender

D, OUT, R = sys.argv[1], sys.argv[2], int(sys.argv[3])

def work(rc):
    rx, rz = rc
    p = os.path.join(D, f'{rx}_{rz}.zip')
    if not os.path.exists(p): return rx, rz, None
    try: colors, _ = xrender.parse(p)
    except Exception: return rx, rz, None
    W = 512; tile = []
    for cz in range(32):
        for cx in range(32):
            rs = gs = bs = n = 0
            base = cz * 16 * W + cx * 16
            for pz in range(16):
                row = base + pz * W
                for px in range(16):
                    c = colors[row + px]
                    if c is None: continue
                    rs += c[0]; gs += c[1]; bs += c[2]; n += 1
            tile.append((rs // n, gs // n, bs // n, 255) if n else (0, 0, 0, 0))
    return rx, rz, tile

if __name__ == '__main__':
    from PIL import Image
    coords = [(x, z) for z in range(-R, R) for x in range(-R, R)]
    img = Image.new('RGBA', (2 * R * 32, 2 * R * 32), (0, 0, 0, 0))
    t = time.time(); done = 0
    with mp.Pool(max(2, os.cpu_count() - 2)) as pool:
        for rx, rz, tile in pool.imap_unordered(work, coords, chunksize=16):
            done += 1
            if tile:
                ti = Image.new('RGBA', (32, 32)); ti.putdata(tile); img.paste(ti, ((rx + R) * 32, (rz + R) * 32))
            if done % 2000 == 0: print(f'{done}/{len(coords)} regions {time.time() - t:.0f}s', flush=True)
    img.save(OUT); print('saved', OUT, img.size, f'{time.time() - t:.0f}s', flush=True)
