from common import *
from gen_games import lucide_inner
INK=NAVY
# ---------------- Pip
def pip(ex):
    E={'happy':f'<circle cx="17.5" cy="25" r="2.6" fill="{INK}"/><circle cx="30.5" cy="25" r="2.6" fill="{INK}"/><circle cx="18.3" cy="24" r=".9" fill="#fff"/><circle cx="31.3" cy="24" r=".9" fill="#fff"/>',
     'cheer':f'<path d="M14.5 26q3-5 6 0M27.5 26q3-5 6 0" fill="none" stroke="{INK}" stroke-width="2.4" stroke-linecap="round"/>',
     'think':f'<circle cx="18" cy="24" r="2.6" fill="{INK}"/><circle cx="31" cy="24" r="2.6" fill="{INK}"/><path d="M14 19.5l7-1.8M27 17.7l7 1.8" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>',
     'wow':f'<circle cx="17.5" cy="24.5" r="3.4" fill="#fff" stroke="{INK}" stroke-width="1.6"/><circle cx="30.5" cy="24.5" r="3.4" fill="#fff" stroke="{INK}" stroke-width="1.6"/><circle cx="17.5" cy="25" r="1.5" fill="{INK}"/><circle cx="30.5" cy="25" r="1.5" fill="{INK}"/>',
     'sad':f'<circle cx="17.5" cy="26" r="2.6" fill="{INK}"/><circle cx="30.5" cy="26" r="2.6" fill="{INK}"/><path d="M13.5 20.5l7 2M34.5 20.5l-7 2" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>',
     'wink':f'<circle cx="17.5" cy="25" r="2.6" fill="{INK}"/><path d="M27.5 25.5q3-4 6 0" fill="none" stroke="{INK}" stroke-width="2.4" stroke-linecap="round"/>',
     'sleepy':f'<path d="M14.5 25q3 3 6 0M27.5 25q3 3 6 0" fill="none" stroke="{INK}" stroke-width="2.4" stroke-linecap="round"/>',
     'cool':f'<rect x="11" y="21" width="12" height="9" rx="3" fill="{INK}"/><rect x="25" y="21" width="12" height="9" rx="3" fill="{INK}"/><path d="M23 24h2" stroke="{INK}" stroke-width="2"/>',
     'love':f'<path d="M17.5 29c-5-3.5-5-7.500-2-8a2.6 2.600 0 0 1 2 1a2.6 2.600 0 0 1 2-1c3 .5 3 4.500-2 8zM30.500 29c-5-3.500-5-7.500-2-8a2.600 2.600 0 0 1 2 1a2.600 2.600 0 0 1 2-1c3 .5 3 4.500-2 8z" fill="{CORAL}" stroke="{INK}" stroke-width="1.400" stroke-linejoin="round"/>',
     'angry':f'<circle cx="17.5" cy="26" r="2.6" fill="{INK}"/><circle cx="30.5" cy="26" r="2.6" fill="{INK}"/><path d="M13 20l8 3.5M35 20l-8 3.5" stroke="{INK}" stroke-width="2.4" stroke-linecap="round"/>'}[ex]
    M={'happy':f'<path d="M18.5 32q5.5 5 11 0" fill="none" stroke="{INK}" stroke-width="2.2" stroke-linecap="round"/>',
     'cheer':f'<path d="M16.5 31h15q-1 8-7.5 8t-7.5-8z" fill="{INK}"/><path d="M20 36.5q4-2.5 8 0q-1 2-4 2t-4-2z" fill="{CORAL}"/>',
     'think':f'<path d="M20 33.5h8" stroke="{INK}" stroke-width="2.2" stroke-linecap="round"/>',
     'wow':f'<ellipse cx="24" cy="34" rx="3.2" ry="4" fill="{INK}"/>',
     'sad':f'<path d="M19 36q5-5 10 0" fill="none" stroke="{INK}" stroke-width="2.2" stroke-linecap="round"/>',
     'wink':f'<path d="M18 31q6 6.500 12 0" fill="none" stroke="{INK}" stroke-width="2.2" stroke-linecap="round"/>',
     'sleepy':f'<ellipse cx="24" cy="34" rx="2.6" ry="2.2" fill="{INK}"/>',
     'cool':f'<path d="M17.5 32q6.500 6.500 13 0z" fill="{INK}" stroke="{INK}" stroke-width="1.800" stroke-linejoin="round"/>',
     'love':f'<path d="M18 31q6 7 12 0" fill="none" stroke="{INK}" stroke-width="2.2" stroke-linecap="round"/>',
     'angry':f'<path d="M19 36q5-4.500 10 0" fill="none" stroke="{INK}" stroke-width="2.2" stroke-linecap="round"/>'}[ex]
    X={'cheer':f'<path d="M6 14l-3-3M42 14l3-3" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>','think':f'<circle cx="41" cy="12" r="1.600" fill="{INK}"/><circle cx="44" cy="7" r="2.400" fill="{INK}"/>','wow':f'<path d="M6 12l-3-2M42 12l3-2" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>',
       'sad':f'<path d="M36 33q2 3 0 5q-2-2 0-5z" fill="{BLUE}" stroke="{INK}" stroke-width="1.200" stroke-linejoin="round"/>','sleepy':tpath('z',40,12,9,INK)+tpath('Z',44,6,6,INK),'angry':f'<path d="M38 8l3 3M42 8l-3 3" stroke="{CORAL}" stroke-width="2.400" stroke-linecap="round"/>','love':star(40,10,4,CORAL,0,.5),'happy':'','wink':'','cool':''}[ex]
    cheeks='' if ex in('cool',) else f'<circle cx="12" cy="31" r="3" fill="{PINK}"/><circle cx="36" cy="31" r="3" fill="{PINK}"/>'
    return svg(48,52,f'<g transform="translate(0 2)"><rect x="22.800" y="4" width="2.400" height="6" fill="{INK}"/><circle cx="24" cy="5" r="3.200" fill="{CORAL}" stroke="{INK}" stroke-width="1.600"/><circle cx="24" cy="27" r="19" fill="{GOLD}" stroke="{INK}" stroke-width="2.200"/>{cheeks}{E}{M}{X}</g>')
# ---------------- avatars
AVS=[('me',BLUE,SKINS[1],'short',NAVY,GOLD,0),('ada',PINK,SKINS[2],'afro',NAVY,NAVY,0),('kemi',GREEN,SKINS[0],'bun','#5E3B26',CARD,0),('tobi',CORAL,SKINS[2],'cap',GOLD,CARD,0),
('ife','#EBD6A0',SKINS[1],'long',NAVY,BLUE,0),('sam','#1F7F73',SKINS[0],'short','#5E3B26',CARD,1),('bisi',PINK,SKINS[1],'bun',NAVY,GREEN,0),('leo',GOLD,SKINS[0],'mohawk',CORAL,NAVY,0),
('zoe',BLUET,SKINS[2],'braids',NAVY,CORAL,0),('max',ORANGE,SKINS[1],'beanie',BLUE,CARD,1),('ivy',GREENT,SKINS[0],'long',BROWN,PURPLE,0),('kai',PURPLE,SKINS[1],'bald',NAVY,GOLD,1),
('mia',CORALT,SKINS[0],'afro','#5E3B26',BLUE,0),('dee',BLUE,SKINS[2],'short',NAVY,CARD,1),('rue',GOLDT,SKINS[0],'braids',CORAL,GREEN,0),('jay',GREEN,SKINS[1],'cap',BLUE,GOLD,0)]
def avatar(bg,skin,hs,hc,sh,gl):
    back=front=''
    if hs=='afro': back=f'<circle cx="24" cy="17" r="13.5" fill="{hc}"/>'
    if hs=='long': back=f'<path d="M12.5 38V20Q12.5 9.5 24 9.5Q35.5 9.5 35.5 20V38Z" fill="{hc}"/>'
    if hs=='braids': back=f'<rect x="11.500" y="20" width="5" height="17" rx="2.500" fill="{hc}"/><rect x="31.500" y="20" width="5" height="17" rx="2.500" fill="{hc}"/>'
    if hs in('short','bun','long','braids','afro'): front=f'<path d="M14.3 21.5Q13.8 11.5 24 11.5Q34.2 11.5 33.7 21.5Q31 16.5 24 16.5Q17 16.5 14.3 21.5Z" fill="{hc}"/>'
    if hs=='bun': front+=f'<circle cx="24" cy="9" r="4" fill="{hc}"/>'
    if hs=='mohawk': front=f'<path d="M21 14L22 5L26 5L27 14Z" fill="{hc}" stroke="{INK}" stroke-width="1.200" stroke-linejoin="round"/>'
    if hs=='beanie': front=f'<path d="M14 19Q14 9 24 9Q34 9 34 19Z" fill="{hc}" stroke="{INK}" stroke-width="1.200"/><rect x="13" y="17" width="22" height="4" rx="2" fill="{CARD}" stroke="{INK}" stroke-width="1.200"/><circle cx="24" cy="8" r="2.500" fill="{CARD}" stroke="{INK}" stroke-width="1.200"/>'
    if hs=='cap': front=f'<path d="M14.3 19.5Q14.3 10.5 24 10.5Q33.7 10.5 33.7 19.5Z" fill="{hc}" stroke="{INK}" stroke-width="1.200"/><rect x="13" y="18" width="22" height="3.200" rx="1.600" fill="{hc}" stroke="{INK}" stroke-width="1.200"/>'
    g=f'<circle cx="20.4" cy="23.2" r="4" fill="none" stroke="{INK}" stroke-width="1.200"/><circle cx="27.6" cy="23.2" r="4" fill="none" stroke="{INK}" stroke-width="1.200"/><path d="M24.4 23h-.8" stroke="{INK}" stroke-width="1.200"/>' if gl else ''
    return svg(48,48,f'<circle cx="24" cy="24" r="24" fill="{bg}"/>{back}<path d="M7.1 41Q10 33 24 33Q38 33 40.9 41A24 24 0 0 1 7.1 41Z" fill="{sh}"/><circle cx="24" cy="23" r="9.5" fill="{skin}"/>{front}<circle cx="20.4" cy="23.2" r="1.3" fill="{INK}"/><circle cx="27.6" cy="23.2" r="1.3" fill="{INK}"/>{g}<path d="M20.500 27Q24 29.600 27.500 27" fill="none" stroke="{INK}" stroke-width="1.400" stroke-linecap="round"/><circle cx="24" cy="24" r="23" fill="none" stroke="{INK}" stroke-width="2"/>')
# ---------------- badges
SILVER='#CBD0DD'; SILVEREDGE='#9AA0B8'; BRONZE='#C77B45'; BRONZEEDGE='#8A4F26'
TIERS={'gold':(GOLD,GOLDEDGE),'silver':(SILVER,SILVEREDGE),'bronze':(BRONZE,BRONZEEDGE)}
def medal(n,t):
    f,e=TIERS[t]
    o=f'<path d="M18 4h12l8 26H26zM46 4H34l-8 26h12z" fill="{CORAL if t!="silver" else BLUE}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/>'
    o=f'<path d="M14 2h14l10 32H24z" fill="{CORAL}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><path d="M50 2H36L26 34h14z" fill="{BLUE}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/>'
    o+=f'<circle cx="32" cy="50" r="22" fill="{f}" stroke="{NAVY}" stroke-width="2.500"/><circle cx="32" cy="50" r="15" fill="none" stroke="{e}" stroke-width="3"/>'+tpath(str(n),32,58,22,NAVY)
    return svg(64,76,o)
def trophy(t):
    f,e=TIERS[t]
    o=f'<path d="M17 14H8v6a10 10 0 0 0 10 10M47 14h9v6a10 10 0 0 1-10 10" fill="none" stroke="{NAVY}" stroke-width="9" stroke-linecap="round"/><path d="M17 14H8v6a10 10 0 0 0 10 10M47 14h9v6a10 10 0 0 1-10 10" fill="none" stroke="{f}" stroke-width="4.500" stroke-linecap="round"/>'
    o+=f'<path d="M16 6h32v20a16 16 0 0 1-32 0z" fill="{f}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><rect x="28" y="40" width="8" height="10" fill="{e}" stroke="{NAVY}" stroke-width="2.500"/><rect x="18" y="50" width="28" height="9" rx="3" fill="{CARD}" stroke="{NAVY}" stroke-width="2.500"/>'+star(32,22,8,NAVY)
    return svg(64,64,o)
def chest(open_=False):
    o=''
    if open_:
        o+=f'<path d="M10 30V18Q10 4 32 4Q54 4 54 18V30Z" fill="{BROWNL}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><path d="M16 30V19Q16 10 32 10Q48 10 48 19V30Z" fill="{NAVY2}"/>'
        o+=f'<rect x="8" y="30" width="48" height="28" rx="4" fill="{BROWN}" stroke="{NAVY}" stroke-width="2.500"/><ellipse cx="32" cy="31" rx="21" ry="4.500" fill="{NAVY}"/>'
        for x,y in [(22,27),(34,24),(44,28),(28,30)]: o+=f'<circle cx="{x}" cy="{y}" r="6.500" fill="{GOLD}" stroke="{NAVY}" stroke-width="2"/>'
        o+=f'<path d="M8 38H56V54a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z" fill="{BROWN}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><rect x="27" y="40" width="10" height="9" rx="2" fill="{GOLD}" stroke="{NAVY}" stroke-width="2"/>'
        o+=star(58,6,4,GOLD)+star(5,10,4,PINK)
        return svg(64,64,o)
    o+=star(54,8,5,GOLD)+star(8,10,4,PINK)
    o+=f'<rect x="8" y="30" width="48" height="26" rx="4" fill="{BROWN}" stroke="{NAVY}" stroke-width="2.500"/><path d="M8 32V26Q8 14 32 14Q56 14 56 26V32Z" fill="{BROWNL}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/>'
    o+=f'<rect x="24" y="14" width="16" height="42" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500"/><rect x="28" y="28" width="8" height="10" rx="2" fill="{NAVY}"/><circle cx="32" cy="32" r="1.600" fill="{GOLD}"/>'
    return svg(64,64,o)
def coin():
    return svg(48,48,f'<path d="M24 3l18.200 10.500v21L24 45 5.800 34.500v-21z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><path d="M24 11l11.200 6.500v13L24 37 12.800 30.500v-13z" fill="none" stroke="{GOLDEDGE}" stroke-width="3" stroke-linejoin="round"/>')
def coin_stack(n):
    o=''
    for i in range(n):
        y=34-i*10
        o+=f'<path d="M6 {y}v8c0 3 8 5 18 5s18-2 18-5v-8z" fill="{GOLDEDGE}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><ellipse cx="24" cy="{y}" rx="18" ry="5.500" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500"/>'
    return svg(48,56,o)
def gem(col,edge):
    return svg(48,48,f'<path d="M12 6h24l10 12-22 26L2 18z" fill="{col}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><path d="M2 18h44M17 6l-5 12 12 26 12-26-5-12" fill="none" stroke="{edge}" stroke-width="2.500" stroke-linejoin="round"/>')
def flame(state):
    if state=='lit': a,b=GOLD,CARD
    elif state=='hot': a,b=CORAL,GOLD
    else: a,b=RAISED,SAND
    return svg(48,56,f'<path d="M24 3c1.600 11 17 15 17 31a17 17 0 0 1-34 0c0-9 6.500-12.500 9-20 3 3.600 3.800 5.400 6.200 5.400C23 19 20 12 24 3z" fill="{a}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><path d="M24 30c1.300 6 8 8 8 14a8 8 0 0 1-16 0c0-4.500 3.500-6 5-10 1.200 1.800 1.600 2.600 3 2.600z" fill="{b}"/>')
def lvl(n):
    if n>=50: f,t,e=GOLD,NAVY,GOLDEDGE
    elif n>=25: f,t,e=CORAL,CARD,CARD
    elif n>=10: f,t,e=BLUE,CARD,CARD
    else: f,t,e=NAVY,GOLD,CARD
    fs=15 if n<10 else (13 if n<100 else 11)
    return svg(48,48,f'<path d="M24 3l19 11v20L24 45 5 34V14z" fill="{f}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><path d="M24 7l15.500 9v16L24 41 8.500 32V16z" fill="none" stroke="{e}" stroke-width="2" stroke-linejoin="round"/>'+tpath(str(n),24,29,fs+2,t))
def shield(f,e,stars):
    o=f'<path d="M32 3L58 12v20c0 14-11 24-26 29C17 56 6 46 6 32V12z" fill="{f}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><path d="M32 10L51 17v15c0 10-8 18-19 22C21 50 13 42 13 32V17z" fill="none" stroke="{e}" stroke-width="3" stroke-linejoin="round"/>'
    o+=star(32,31,11,NAVY if f not in(NAVY,) else GOLD)
    return svg(64,64,o)
def crown(): return svg(48,36,f'<path d="M4 31L2 10l11 8 11-14 11 14 11-8-2 21z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><circle cx="2" cy="9" r="0"/><circle cx="24" cy="4" r="0"/><rect x="5" y="26" width="38" height="5" fill="{GOLDEDGE}"/>')
def jar():
    return svg(72,88,f'<defs><clipPath id="jc"><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z"/></clipPath></defs><rect x="14" y="6" width="44" height="12" rx="4" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500"/><rect x="18" y="16" width="36" height="8" rx="2" fill="{GOLDEDGE}" stroke="{NAVY}" stroke-width="2.500"/><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z" fill="{BLUET}"/><g clip-path="url(#jc)"><rect x="12" y="46" width="48" height="40" fill="{GOLD}"/><ellipse cx="26" cy="62" rx="9" ry="3.600" fill="{GOLDEDGE}"/><ellipse cx="44" cy="70" rx="9" ry="3.600" fill="{GOLDEDGE}"/><ellipse cx="30" cy="76" rx="9" ry="3.600" fill="{GOLDEDGE}"/><ellipse cx="50" cy="55" rx="7" ry="3" fill="{GOLDEDGE}"/></g><path d="M12 24h48v50a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z" fill="none" stroke="{NAVY}" stroke-width="2.500"/>')
def heart(c=CORAL): return svg(48,44,f'<path d="M24 41C9 30 3 22 3 14a10 10 0 0 1 21-4 10 10 0 0 1 21 4c0 8-6 16-21 27z" fill="{c}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/>')
def bolt(): return svg(40,52,f'<path d="M24 3L5 29h13l-3 20 20-28H21z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/>')
def key(): return svg(56,40,f'<circle cx="14" cy="20" r="11" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500"/><circle cx="14" cy="20" r="4" fill="{NAVY}"/><path d="M25 20h26v9h-6v-5h-5v5h-6v-5H25z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/>')
def vs():
    return svg(72,64,f'<path d="M6 8L66 8 56 56 16 56z" fill="{NAVY}"/><path d="M4 4L64 4 54 52 14 52z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/>'+tpath('VS',34,40,30,NAVY))
def banner(txt,col,ink):
    w=170
    return svg(w,56,f'<path d="M2 12H24L16 28L24 44H2L10 28z" fill="{col}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round" opacity="0"/><path d="M4 8H{w-4}V46H4z" fill="{col}" stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"/><path d="M4 8H{w-4}V16H4z" fill="{NAVY}" opacity=".15"/>'+tpath(txt,w/2,38,26,ink))
def tag(txt,col,ink):
    w=int(tw(txt,13))+22
    return svg(w,24,f'<rect x="1.500" y="1.500" width="{w-3}" height="21" rx="10.500" fill="{col}" stroke="{NAVY}" stroke-width="2"/>'+tpath(txt,w/2,17,13,ink))
def sparkle(): return svg(40,40,f'<path d="M20 2Q22 18 38 20Q22 22 20 38Q18 22 2 20Q18 18 20 2z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"/>')
def confetti_burst():
    random.seed(7); cols=[GOLD,CORAL,BLUE,PINK,CARD,GREEN]; o=''
    for i in range(34):
        a=random.uniform(0,2*math.pi); r=random.uniform(30,92); x=100+r*math.cos(a); y=100+r*math.sin(a); c=random.choice(cols); k=random.choice('rrcts'); rot=random.uniform(0,180)
        ex=f'stroke="{NAVY}" stroke-width="1.500" stroke-linejoin="round"'
        if k=='r': o+=f'<rect x="{x-5:.0f}" y="{y-2.5:.0f}" width="10" height="5" rx="1" fill="{c}" {ex} transform="rotate({rot:.0f} {x:.0f} {y:.0f})"/>'
        elif k=='c': o+=f'<circle cx="{x:.0f}" cy="{y:.0f}" r="3.500" fill="{c}" {ex}/>'
        elif k=='t': o+=f'<polygon points="{x:.0f},{y-5:.0f} {x+5:.0f},{y+4:.0f} {x-5:.0f},{y+4:.0f}" fill="{c}" {ex} transform="rotate({rot:.0f} {x:.0f} {y:.0f})"/>'
        else: o+=star(x,y,7,c,rot,extra=ex)
    return svg(200,200,o)
def burst_rays():
    o=''
    for i in range(16):
        a=i*22.5; o+=f'<path d="M100 100L{100+98*math.cos(math.radians(a-5)):.1f} {100+98*math.sin(math.radians(a-5)):.1f}L{100+98*math.cos(math.radians(a+5)):.1f} {100+98*math.sin(math.radians(a+5)):.1f}Z" fill="{GOLD if i%2==0 else GOLDT}"/>'
    return svg(200,200,o)
def xpbar(f):
    w=200; fw=max(0,(w-6)*f)
    o=f'<rect x="2" y="2" width="{w-4}" height="18" rx="9" fill="{RAISED}" stroke="{NAVY}" stroke-width="2.500"/>'
    if f>0: o+=f'<rect x="3.500" y="3.500" width="{max(14,(w-7)*f):.0f}" height="15" rx="7.500" fill="{GOLD}" stroke="{NAVY}" stroke-width="2"/>'
    return svg(w,22,o)
def button(col,edge,pressed):
    dy=4 if pressed else 0; ed=0 if pressed else 6
    o=f'<rect x="2" y="{2+ed+dy-0}" width="196" height="{52-ed if False else 50}" rx="16" fill="{edge}" stroke="{NAVY}" stroke-width="2.500"/>' if not pressed else f'<rect x="2" y="6" width="196" height="46" rx="16" fill="{edge}" stroke="{NAVY}" stroke-width="2.500"/>'
    o+=f'<rect x="2" y="{2+dy}" width="196" height="{46 if not pressed else 46}" rx="16" fill="{col}" stroke="{NAVY}" stroke-width="2.500"/>'
    return svg(200,58,o)
def run():
    for e in ['happy','cheer','think','wow','sad','wink','sleepy','cool','love','angry']: save(f'pip/pip-{e}.svg',pip(e),desc=f'Pip mascot, {e}')
    for k,bg,skin,hs,hc,sh,gl in AVS: save(f'avatars/{k}.svg',avatar(bg,skin,hs,hc,sh,gl),desc=f'avatar {k}')
    for t in TIERS:
        for n in (1,2,3):
            if (t,n) in (('gold',1),('silver',2),('bronze',3)): save(f'badges/medal-{t}.svg',medal(n,t),desc=f'{t} medal')
        save(f'badges/trophy-{t}.svg',trophy(t),desc=f'{t} trophy')
    save('badges/chest-closed.svg',chest(False),desc='chest closed'); save('badges/chest-open.svg',chest(True),desc='chest open')
    save('badges/coin.svg',coin(),desc='coin (hex)')
    for n in (1,2,3): save(f'badges/coins-stack-{n}.svg',coin_stack(n),desc=f'coin stack x{n}')
    save('badges/gem-blue.svg',gem(BLUE,BLUEEDGE),desc='gem'); save('badges/gem-coral.svg',gem(CORAL,CORALEDGE),desc='gem'); save('badges/gem-green.svg',gem(GREEN,GREENEDGE),desc='gem')
    for s in ('lit','hot','off'): save(f'badges/flame-{s}.svg',flame(s),desc=f'streak flame {s}')
    for n in list(range(1,51)): save(f'badges/levels/level-{n}.svg',lvl(n),desc=f'level {n} hex')
    for k,(f,e) in {'bronze':(BRONZE,BRONZEEDGE),'silver':(SILVER,SILVEREDGE),'gold':(GOLD,GOLDEDGE),'platinum':(BLUET,BLUE),'diamond':(BLUE,BLUEEDGE),'champion':(CORAL,CORALEDGE)}.items(): save(f'badges/leagues/league-{k}.svg',shield(f,e,1),desc=f'{k} league shield')
    save('badges/crown.svg',crown(),desc='crown'); save('badges/jar.svg',jar(),desc='savings jar'); save('badges/heart.svg',heart(),desc='life'); save('badges/heart-empty.svg',heart(RAISED),desc='life empty')
    save('badges/bolt.svg',bolt(),desc='energy'); save('badges/key.svg',key(),desc='key'); save('badges/vs.svg',vs(),desc='VS emblem')
    save('badges/star-full.svg',svg(48,48,star(24,26,21,GOLD,extra=f'stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"').replace('.45','.45')),desc='star filled')
    save('badges/star-empty.svg',svg(48,48,star(24,26,21,RAISED,extra=f'stroke="{NAVY}" stroke-width="2.500" stroke-linejoin="round"')),desc='star empty')
    save('badges/sparkle.svg',sparkle(),desc='sparkle')
    save('badges/banner-victory.svg',banner('VICTORY',GOLD,NAVY),desc='victory banner'); save('badges/banner-defeat.svg',banner('DEFEAT',CORAL,CARD),desc='defeat banner'); save('badges/banner-draw.svg',banner('DRAW',BLUE,CARD),desc='draw banner')
    save('badges/tag-hot.svg',tag('HOT',CORAL,CARD),desc='tag'); save('badges/tag-new.svg',tag('NEW',GREEN,CARD),desc='tag'); save('badges/tag-pro.svg',tag('PRO',GOLD,NAVY),desc='tag'); save('badges/tag-live.svg',tag('LIVE',BLUE,CARD),desc='tag')
    save('effects/confetti-burst.svg',confetti_burst(),desc='confetti burst'); save('effects/sun-rays.svg',burst_rays(),desc='win rays')
    for f in (0,.25,.5,.75,1): save(f'ui/xp-bar-{int(f*100)}.svg',xpbar(f),desc=f'XP bar {int(f*100)}%')
    for k,(c,e) in {'gold':(GOLD,GOLDEDGE),'blue':(BLUE,BLUEEDGE),'green':(GREEN,GREENEDGE),'coral':(CORAL,CORALEDGE),'cream':(CARD,SAND)}.items():
        save(f'ui/button-{k}.svg',button(c,e,False),desc=f'chunky button frame ({k})'); save(f'ui/button-{k}-pressed.svg',button(c,e,True),desc=f'pressed ({k})')
