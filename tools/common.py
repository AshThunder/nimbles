import pathlib, math, random, json
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
ROOT=pathlib.Path(__file__).resolve().parent.parent
A=ROOT/'assets'
GF=pathlib.Path('/usr/share/fonts/truetype/sand-box/google')
# palette
CREAM='#F5F0E6'; CARD='#FFFCF5'; RAISED='#ECE5D5'; SAND='#D9CFB4'; NAVY='#1F2348'; NAVY2='#2E3365'
GOLD='#F4B323'; GOLDEDGE='#C98E0A'; GOLDT='#FBE6AE'
BLUE='#1F78C4'; BLUET='#D7E9F8'; BLUEEDGE='#155A93'
CORAL='#D0432E'; CORALT='#F6D8D1'; CORALEDGE='#9E2F1E'
GREEN='#1F8A5B'; GREENT='#D3EBDD'; GREENEDGE='#146643'
PINK='#F29AAE'; PURPLE='#8E5CC0'; ORANGE='#E9822A'; BROWN='#8A5A3C'; BROWNL='#A9724A'; SKINS=['#F0C8A0','#C68B59','#8D5A3B']
_fonts={}
def font(name):
    if name in _fonts: return _fonts[name]
    if name.startswith('bric'):
        w=int(name[4:] or 800)
        f=TTFont(next((GF/'Bricolage Grotesque').glob('*.ttf')))
        f=instancer.instantiateVariableFont(f,{'wght':w,'opsz':36,'wdth':100})
    else:
        f=TTFont(GF/'DM Mono'/'DMMono-Medium.ttf')
    _fonts[name]=f; return f
def tw(txt,size,fn='bric800'):
    f=font(fn); cm=f.getBestCmap(); hm=f['hmtx']; s=size/f['head'].unitsPerEm
    return sum(hm[cm[ord(c)]][0] for c in txt)*s
def tpath(txt,x,y,size,fill=NAVY,anchor='middle',fn='bric800',extra=''):
    """text as path; (x,y)=baseline anchor"""
    f=font(fn); gs=f.getGlyphSet(); cm=f.getBestCmap(); hm=f['hmtx']; s=size/f['head'].unitsPerEm
    w=tw(txt,size,fn)
    x0=x-w/2 if anchor=='middle' else (x-w if anchor=='end' else x)
    d=''; cx=x0
    for c in txt:
        g=cm[ord(c)]; pen=SVGPathPen(gs)
        gs[g].draw(TransformPen(pen,(s,0,0,-s,cx,y))); d+=pen.getCommands()
        cx+=hm[g][0]*s
    return f'<path d="{d}" fill="{fill}" {extra}/>'
def svg(w,h,body,extra=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" {extra}>{body}</svg>\n'
FILES={}   # relpath -> (kind, desc)
def save(rel,content,kind='original',desc=''):
    p=A/rel; p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(content); FILES[rel]=(kind,desc)
def star(cx,cy,r,fill,rot=0,inner=.45,extra=''):
    pts=[]
    for i in range(10):
        a=math.pi/5*i-math.pi/2+math.radians(rot); rr=r if i%2==0 else r*inner
        pts.append(f'{cx+rr*math.cos(a):.1f},{cy+rr*math.sin(a):.1f}')
    return f'<polygon points="{" ".join(pts)}" fill="{fill}" {extra}/>'
def rr(x,y,w,h,r,fill,stroke=NAVY,sw=2,extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>'
