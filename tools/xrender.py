"""Render Xaero World Map region files (region.xaero inside X_Z.zip) to images. Own implementation of the 7.x pixel stream."""
import struct, zipfile, sys, os, time

class R:
    __slots__ = ('d', 'p')
    def __init__(s, d): s.d = d; s.p = 0
    def i8(s): v = s.d[s.p]; s.p += 1; return v
    def i32(s): v = struct.unpack_from('>i', s.d, s.p)[0]; s.p += 4; return v
    def u16(s): v = struct.unpack_from('>H', s.d, s.p)[0]; s.p += 2; return v
    def utf(s):
        n = s.u16(); v = s.d[s.p:s.p+n].decode('utf-8', 'replace'); s.p += n; return v

def tag(r, k):
    if k == 1: return r.i8()
    if k == 2: v = struct.unpack_from('>h', r.d, r.p)[0]; r.p += 2; return v
    if k == 3: return r.i32()
    if k in (4, 6): r.p += 8; return None
    if k == 5: r.p += 4; return None
    if k == 7: r.p += r.i32(); return None
    if k == 8: return r.utf()
    if k == 9:
        it = r.i8(); n = r.i32(); return [tag(r, it) for _ in range(n)]
    if k == 10:
        out = {}
        while True:
            t = r.i8()
            if t == 0: return out
            name = r.utf(); out[name] = tag(r, t)
    if k == 11: r.p += r.i32() * 4; return None
    if k == 12: r.p += r.i32() * 8; return None
    if k == 0: return None
    raise ValueError('bad nbt tag %d at %d' % (k, r.p))

def nbt(r):
    k = r.i8()
    if k == 0: return None
    r.utf(); return tag(r, k)

# block name -> rgb (rough, the site shows this greyscale and dim anyway)
def color_of(name):
    n = name or ''
    if 'water' in n or n.endswith('kelp') or 'seagrass' in n: return (58, 88, 176)
    if 'ice' in n: return (150, 185, 235)
    if 'lava' in n or 'magma' in n: return (230, 110, 20)
    if n.endswith('grass_block') or 'moss' in n: return (98, 148, 62)
    if 'leaves' in n or 'azalea' in n or 'vine' in n: return (46, 104, 40)
    if 'snow' in n or 'powder' in n: return (238, 238, 244)
    if 'sand' in n: return (200, 110, 60) if 'red' in n else (214, 200, 150)
    if 'obsidian' in n: return (22, 18, 36)
    if 'bedrock' in n: return (52, 52, 52)
    if 'netherrack' in n or 'nether' in n: return (110, 40, 40)
    if 'dirt' in n or 'mud' in n or 'podzol' in n or 'mycelium' in n or 'farmland' in n: return (118, 84, 54)
    if 'log' in n or 'wood' in n or 'planks' in n or 'stem' in n: return (108, 78, 48)
    if 'terracotta' in n or 'clay' in n: return (158, 100, 70)
    if 'stone' in n or 'cobble' in n or 'andesite' in n or 'diorite' in n or 'granite' in n or 'gravel' in n or 'tuff' in n or 'deepslate' in n or 'blackstone' in n or 'basalt' in n or 'brick' in n: return (132, 132, 132)
    if 'glass' in n or 'wool' in n or 'concrete' in n: return (170, 170, 170)
    return (120, 120, 120)

def parse(path):
    """-> (colors: list of 512*512 rgb or None, heights: list of ints) in region-local x,z order (index = z*512 + x)."""
    with zipfile.ZipFile(path) as z:
        d = z.read('region.xaero')
    r = R(d); r.i8(); r.i32()
    palette, pcol = [], []
    biomes = []
    W = 512
    colors = [None] * (W * W); heights = [0] * (W * W)
    n = len(d)
    while r.p < n:
        head = r.i8(); chx, chz = (head >> 4) & 0xF, head & 0xF
        for tx in range(4):
            for tz in range(4):
                if struct.unpack_from('>i', d, r.p)[0] == -1: r.p += 4; continue
                cx, cz = chx * 4 + tx, chz * 4 + tz
                base_x, base_z = cx * 16, cz * 16
                for px in range(16):
                    for pz in range(16):
                        f = r.i32()
                        if f & 1:
                            if f & 0x200000:
                                t = nbt(r); name = t.get('Name') if isinstance(t, dict) else None
                                palette.append(name); pcol.append(color_of(name)); col = pcol[-1]
                            else:
                                i = r.i32(); col = pcol[i] if 0 <= i < len(pcol) else (120, 120, 120)
                        else:
                            col = (98, 148, 62)
                        if f & 0x40: h = r.i8()
                        else:
                            pk = ((f >> 12) & 0xFF) | (((f >> 25) & 0xF) << 8); h = (pk & 0x7FF) - (pk & 0x800)
                        if f & 0x1000000: r.i8()
                        if f & 2:
                            for _ in range(r.i8()):
                                ov = r.i32()
                                if ov & 1:
                                    if ov & 0x400:
                                        t = nbt(r); name = t.get('Name') if isinstance(t, dict) else None
                                        palette.append(name); pcol.append(color_of(name))
                                    else: r.i32()
                        if f & 0x100000:
                            if f & 0x400000: biomes.append(r.utf())
                            else: r.i32()
                        idx = (base_z + pz) * W + base_x + px
                        colors[idx] = col; heights[idx] = h
                r.i8(); r.i32(); r.i8()
    return colors, heights

def render(path, scale=1):
    """PIL image of the region at 512/scale px per side; empty pixels transparent."""
    from PIL import Image
    colors, heights = parse(path)
    W = 512
    out = Image.new('RGBA', (W, W), (0, 0, 0, 0)); px = out.load()
    for z in range(W):
        for x in range(W):
            c = colors[z * W + x]
            if c is None: continue
            h = heights[z * W + x]; hn = heights[(z - 1) * W + x] if z > 0 else h
            k = 1.14 if h > hn else (0.84 if h < hn else 1.0)
            px[x, z] = (min(255, int(c[0] * k)), min(255, int(c[1] * k)), min(255, int(c[2] * k)), 255)
    if scale > 1: out = out.resize((W // scale, W // scale), Image.BOX)
    return out

if __name__ == '__main__':
    t = time.time(); im = render(sys.argv[1]); print('parsed+rendered in %.1fs' % (time.time() - t)); im.save(sys.argv[2]); print('saved', sys.argv[2])
