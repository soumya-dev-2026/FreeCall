"""FreeCall PWA icons: rounded-square indigo gradient tile + white handset glyph."""
import math, zlib, struct

def png(w, h, px):
    raw = b"".join(b"\x00" + bytes(px[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t+d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

R    = 0.60    # arc radius of the handset shaft
SH   = 0.125   # shaft half-thickness
CAP  = 0.235   # earpiece radius
ROT  = math.radians(-8)   # slight tilt

# caps sit at the two ends of the arc: 45deg (bottom-right) and 225deg (top-left)
CAPS = [(R*math.cos(math.radians(a)), R*math.sin(math.radians(a))) for a in (45, 225)]

def handset(nx, ny):
    """True inside the handset glyph. Space is normalized so |n| ~ 1 at edges."""
    x =  nx*math.cos(ROT) - ny*math.sin(ROT)
    y =  nx*math.sin(ROT) + ny*math.cos(ROT)
    # round earpieces
    for ex, ey in CAPS:
        if math.hypot(x-ex, y-ey) <= CAP:
            return True
    # curved shaft: thick arc spanning 45deg -> 225deg (bulging bottom-left)
    d = abs(math.hypot(x, y) - R)
    if d <= SH:
        ang = math.degrees(math.atan2(y, x)) % 360
        if 45.0 <= ang <= 225.0:
            return True
    return False

def make(size, path, ss=3):
    """ss = supersampling factor for smooth edges."""
    px = bytearray(size*size*4)
    rad = size*0.235
    scale = size*0.30           # glyph size
    for yy in range(size):
        for xx in range(size):
            i = (yy*size+xx)*4
            # anti-aliased rounded-rect mask + glyph coverage
            tile_hits = 0; glyph_hits = 0; total = ss*ss
            for sy in range(ss):
                for sx in range(ss):
                    px_x = xx + (sx+0.5)/ss
                    px_y = yy + (sy+0.5)/ss
                    cx = min(max(px_x, rad), size-rad)
                    cy = min(max(px_y, rad), size-rad)
                    if math.hypot(px_x-cx, px_y-cy) <= rad:
                        tile_hits += 1
                        if handset((px_x-size/2)/scale, (px_y-size/2)/scale):
                            glyph_hits += 1
            if tile_hits == 0:
                px[i:i+4] = bytes((0,0,0,0)); continue
            t = (xx/size*0.45 + yy/size*0.55)
            br = 69 + (124-69)*t; bg = 96 + (156-96)*t; bb = 224 + (255-224)*t
            g = glyph_hits/total
            cr = int(br*(1-g) + 255*g); cg = int(bg*(1-g) + 255*g); cb = int(bb*(1-g) + 255*g)
            px[i:i+4] = bytes((cr, cg, cb, int(255*tile_hits/total)))
    open(path,"wb").write(png(size,size,px)); print("wrote", path, size)

make(192, "icon-192.png")
make(512, "icon-512.png")
