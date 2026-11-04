from common import *
import re
LUC=pathlib.Path('/workspace/nimbles-mockup/node_modules/lucide-static/icons')
def lucide_inner(n):
    s=(LUC/f'{n}.svg').read_text(); return re.search(r'<svg[^>]*>(.*)</svg>',s,re.S).group(1)
# ---------------- chess
GI=pathlib.Path('/tmp/dl/gi')
def chess():
    for n in ['pawn','rook','knight','bishop','queen','king']:
        s=(GI/f'chess-{n}.svg').read_text()
        d=re.findall(r'<path[^>]*? d="([^"]+)"',s)[-1]
        for side,fill in (('w',CARD),('b',NAVY)):
            extra=f'stroke="{NAVY}" stroke-width="26" stroke-linejoin="round" paint-order="stroke fill"'
            body=f'<g transform="translate(256 256) scale(.92) translate(-256 -256)"><path d="{d}" fill="{fill}" {extra}/></g>'
            if side=='b':  # cream inner rim so dark pieces keep the outline look
                body=f'<g transform="translate(256 256) scale(.92) translate(-256 -256)"><path d="{d}" fill="{NAVY}" stroke="{CARD}" stroke-width="40" stroke-linejoin="round" paint-order="stroke fill"/><path d="{d}" fill="{NAVY}" stroke="{NAVY}" stroke-width="14" stroke-linejoin="round"/></g>'
            save(f'chess/pieces/{side}-{n}.svg',svg(64,64,body).replace('width="64" height="64"','width="64" height="64"').replace('viewBox="0 0 64 64"','viewBox="0 0 512 512"'),
                 kind='gi-skoll',desc=f'{"white" if side=="w" else "black"} {n} (game-icons.net by Skoll, CC BY 3.0; restyled)')
    b=''
    for r in range(8):
        for c in range(8):
            b+=f'<rect x="{c*40}" y="{r*40}" width="40" height="40" fill="{CARD if (r+c)%2==0 else '#A9CBE8'}"/>'
    b=f'<g transform="translate(4 4)">{b}</g>'
    frame=f'<rect x="2" y="2" width="324" height="324" rx="6" fill="none" stroke="{NAVY}" stroke-width="4"/>'
    save('chess/board.svg',svg(328,328,b+frame),desc='8x8 board')
    for k,(fill,sh) in {'select':(GOLD,None),'lastmove':(GOLDT,None),'check':(CORAL,None)}.items():
        save(f'chess/hl-{k}.svg',svg(40,40,f'<rect width="40" height="40" fill="{fill}" opacity="{".85" if k=="select" else "1" if k=="lastmove" else ".9"}"/>'),desc='square highlight')
    save('chess/hl-move.svg',svg(40,40,f'<circle cx="20" cy="20" r="6" fill="{GREEN}" stroke="{NAVY}" stroke-width="2"/>'),desc='legal move dot')
    save('chess/hl-capture.svg',svg(40,40,f'<circle cx="20" cy="20" r="17" fill="none" stroke="{CORAL}" stroke-width="4"/>'),desc='capture ring')
# ---------------- pool
BALL={1:(GOLD,0),2:(BLUE,0),3:(CORAL,0),4:(PINK,0),5:(ORANGE,0),6:(PURPLE,0),7:(BROWN,0),8:(NAVY,0)}
def ball(n):
    if n==0: base=CARD; col=None
    else:
        col=BALL[(n-1)%8+1][0]
    o=''
    if n==0:
        o=f'<circle cx="16" cy="16" r="14.5" fill="{CARD}" stroke="{NAVY}" stroke-width="2"/><circle cx="16" cy="16" r="2.4" fill="{CORAL}"/>'
    elif n<=8:
        o=f'<circle cx="16" cy="16" r="14.5" fill="{col}" stroke="{NAVY}" stroke-width="2"/>'
    else:
        o=f'<defs><clipPath id="c{n}"><circle cx="16" cy="16" r="14.5"/></clipPath></defs><circle cx="16" cy="16" r="14.5" fill="{CARD}"/><rect x="0" y="7" width="32" height="18" fill="{col}" clip-path="url(#c{n})"/><circle cx="16" cy="16" r="14.5" fill="none" stroke="{NAVY}" stroke-width="2"/>'
    if n:
        o+=f'<circle cx="16" cy="16" r="6.4" fill="{CARD}" stroke="{NAVY}" stroke-width="1.4"/>'+tpath(str(n),16,19.4,9 if n<10 else 8,NAVY)
    return svg(32,32,o)
def pool():
    for n in range(16): save(f'pool/balls/ball-{"cue" if n==0 else n}.svg',ball(n),desc='cue ball' if n==0 else f'ball {n}')
    W,H=400,220
    t=f'<rect x="2" y="2" width="{W-4}" height="{H-4}" rx="22" fill="{BROWN}" stroke="{NAVY}" stroke-width="3"/>'
    t+=f'<rect x="20" y="20" width="{W-40}" height="{H-40}" rx="8" fill="{GREENEDGE}" stroke="{NAVY}" stroke-width="2"/>'
    t+=f'<rect x="28" y="28" width="{W-56}" height="{H-56}" rx="4" fill="{GREEN}"/>'
    for x in (80,140,200,260,320):
        for y in (11,H-11): t+=f'<path d="M{x} {y-3.5}l3.5 3.5-3.5 3.5-3.5-3.5z" fill="{CARD}"/>'
    for y in (60,110,160):
        for x in (11,W-11): t+=f'<path d="M{x} {y-3.5}l3.5 3.5-3.5 3.5-3.5-3.5z" fill="{CARD}"/>'
    t+=f'<path d="M110 30V{H-30}" stroke="{CARD}" stroke-width="1.6" stroke-dasharray="4 5" opacity=".7"/><circle cx="290" cy="{H/2}" r="2.4" fill="{CARD}" opacity=".8"/>'
    for (x,y) in [(24,24),(W/2,18),(W-24,24),(24,H-24),(W/2,H-18),(W-24,H-24)]:
        t+=f'<circle cx="{x}" cy="{y}" r="12" fill="{NAVY}"/>'
    save('pool/table.svg',svg(W,H,t),desc='table with pockets')
    # rack triangle
    save('pool/rack.svg',svg(120,110,f'<path d="M60 6L114 100H6Z" fill="none" stroke="{GOLD}" stroke-width="6" stroke-linejoin="round"/><path d="M60 6L114 100H6Z" fill="none" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round" transform="translate(0 0)"/>'),desc='rack outline')
    cue=f'<rect x="2" y="2" width="296" height="10" rx="5" fill="{BROWNL}" stroke="{NAVY}" stroke-width="2"/><path d="M180 2H294Q298 2 298 7T294 12H180Z" fill="{NAVY}"/><rect x="2" y="2" width="38" height="10" rx="5" fill="{GOLD}" stroke="{NAVY}" stroke-width="2"/><rect x="40" y="2" width="8" height="10" fill="{CARD}" stroke="{NAVY}" stroke-width="2"/><rect x="48" y="2" width="22" height="10" fill="{CARD}" stroke="{NAVY}" stroke-width="2" opacity="0"/>'
    cue=f'<rect x="3" y="3" width="294" height="10" rx="5" fill="{BROWNL}" stroke="{NAVY}" stroke-width="2"/><rect x="150" y="3" width="147" height="10" rx="5" fill="{NAVY2}" stroke="{NAVY}" stroke-width="2"/><rect x="3" y="3" width="26" height="10" rx="5" fill="{BLUE}" stroke="{NAVY}" stroke-width="2"/><rect x="29" y="3" width="7" height="10" fill="{CARD}" stroke="{NAVY}" stroke-width="2"/>'
    save('pool/cue.svg',svg(300,16,cue),desc='cue stick (tip at left)')
    save('pool/aim-line.svg',svg(200,8,f'<path d="M4 4H196" stroke="{CARD}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>'),desc='aim dots')
    pm=''
    for i,c in enumerate([GREEN,GREEN,GOLD,GOLD,CORAL]): pm+=f'<rect x="{2+i*34}" y="2" width="30" height="16" rx="4" fill="{c}" stroke="{NAVY}" stroke-width="2"/>'
    save('pool/power-meter.svg',svg(174,20,pm),desc='power meter')
# ---------------- sudoku
SOL='534678912672195348198342567859761423426853791713924856961537284287419635345286179'
MASK='1 1 0 0 1 0 0 0 0|1 0 0 1 1 1 0 0 0|0 1 1 0 0 0 0 1 0|1 0 0 0 1 0 0 0 1|1 0 0 1 0 1 0 0 1|1 0 0 0 1 0 0 0 1|0 1 0 0 0 0 1 1 0|0 0 0 4 1 9 0 0 5|0 0 0 0 1 0 0 7 9'
def sud_board(sample=True):
    g=SOL; S=40
    rows=[[int(x) for x in r.split()] for r in MASK.split('|')]
    # givens: use mask ones (4,5,7,9 -> treat nonzero as given except custom); simple: given if value !=0
    o=f'<rect x="0" y="0" width="360" height="360" fill="{CARD}"/>'
    sel=(4,4)
    def val(r,c): return int(g[r*9+c])
    if sample:
        # selection highlight: row/col/box tints
        sr,sc=sel
        for r in range(9):
            for c in range(9):
                if r==sr or c==sc or (r//3==sr//3 and c//3==sc//3): o+=f'<rect x="{c*S}" y="{r*S}" width="{S}" height="{S}" fill="{RAISED}"/>'
        for r in range(9):
            for c in range(9):
                if val(r,c)==val(sr,sc) and (r,c)!=sel and rows[r][c]: o+=f'<rect x="{c*S}" y="{r*S}" width="{S}" height="{S}" fill="{BLUET}"/>'
        o+=f'<rect x="{sc*S}" y="{sr*S}" width="{S}" height="{S}" fill="{GOLD}"/>'
    for i in range(1,9):
        o+=f'<path d="M{i*S} 0V360M0 {i*S}H360" stroke="{NAVY}" stroke-width="{3 if i%3==0 else 1}" opacity="{1 if i%3==0 else .35}"/>'
    if sample:
        for r in range(9):
            for c in range(9):
                v=val(r,c)
                if rows[r][c]: o+=tpath(str(v),c*S+20,r*S+29,25,NAVY)
                elif (r,c) in ((0,2),(1,1),(2,3),(5,6),(8,0)): o+=tpath(str(v),c*S+20,r*S+29,25,BLUE)
        o+=tpath('9',2*S+20,6*S+29,25,CORAL)  # conflict sample
        o+=f'<rect x="{2*S+1}" y="{6*S+1}" width="{S-2}" height="{S-2}" fill="none" stroke="{CORAL}" stroke-width="2.5"/>'
        # pencil notes
        for k,(r,c) in enumerate([(0,3),(0,5)]):
            for n in (1,4,8):
                dx=((n-1)%3)*12+8; dy=((n-1)//3)*12+13
                o+=tpath(str(n),c*S+dx,r*S+dy+3,9,NAVY2,extra='opacity=".7"')
    o+=f'<rect x="1.5" y="1.5" width="357" height="357" rx="3" fill="none" stroke="{NAVY}" stroke-width="3"/>'
    return svg(360,360,o)
def sudoku():
    save('sudoku/board-blank.svg',sud_board(False),desc='9x9 grid')
    save('sudoku/board-sample.svg',sud_board(True),desc='sample state: given / entered / selected / conflict / notes')
    for n in range(1,10):
        t=f'<rect x="2" y="6" width="52" height="56" rx="10" fill="{RAISED}" stroke="{NAVY}" stroke-width="2"/><rect x="2" y="2" width="52" height="54" rx="10" fill="{CARD}" stroke="{NAVY}" stroke-width="2"/>'+tpath(str(n),28,40,30,NAVY)
        save(f'sudoku/keys/key-{n}.svg',svg(56,64,t),desc=f'number pad key {n}')
    save('sudoku/keys/key-erase.svg',svg(56,64,f'<rect x="2" y="6" width="52" height="56" rx="10" fill="{CORALEDGE}" stroke="{NAVY}" stroke-width="2"/><rect x="2" y="2" width="52" height="54" rx="10" fill="{CORAL}" stroke="{NAVY}" stroke-width="2"/><g transform="translate(16 14) scale(1.0)" fill="none" stroke="{CARD}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">{lucide_inner("eraser")}</g>'),kind='lucide',desc='erase key (Lucide eraser glyph, ISC)')
    save('sudoku/keys/key-notes.svg',svg(56,64,f'<rect x="2" y="6" width="52" height="56" rx="10" fill="{BLUEEDGE}" stroke="{NAVY}" stroke-width="2"/><rect x="2" y="2" width="52" height="54" rx="10" fill="{BLUE}" stroke="{NAVY}" stroke-width="2"/><g transform="translate(16 14)" fill="none" stroke="{CARD}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">{lucide_inner("pencil")}</g>'),kind='lucide',desc='notes key (Lucide pencil glyph, ISC)')
# ---------------- bubbles
BUB={'gold':GOLD,'blue':BLUE,'coral':CORAL,'green':GREEN,'pink':PINK,'purple':PURPLE,'orange':ORANGE}
def bubble(col,special=None):
    o=f'<circle cx="20" cy="20" r="17.5" fill="{col}" stroke="{NAVY}" stroke-width="2.5"/><path d="M10.5 17Q11.5 10.5 18 9.5" fill="none" stroke="{CARD}" stroke-width="3" stroke-linecap="round" opacity=".75"/>'
    if special=='bomb': o=f'<circle cx="20" cy="22" r="16" fill="{NAVY}" stroke="{NAVY}" stroke-width="2.5"/><path d="M11 20Q12 14 18 13" fill="none" stroke="{CARD}" stroke-width="3" stroke-linecap="round" opacity=".6"/><path d="M26 8Q30 4 33 6" fill="none" stroke="{BROWN}" stroke-width="3" stroke-linecap="round"/>'+star(34,5,5,GOLD,extra=f'stroke="{NAVY}" stroke-width="1" stroke-linejoin="round"')
    if special=='star': o=f'<circle cx="20" cy="20" r="17.5" fill="{CARD}" stroke="{NAVY}" stroke-width="2.5"/>'+star(20,20.5,11,GOLD,extra=f'stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"')
    if special=='bolt': o=f'<circle cx="20" cy="20" r="17.5" fill="{BLUE}" stroke="{NAVY}" stroke-width="2.5"/><path d="M22 6L11 23h8l-2 11 12-18h-8z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"/>'
    return svg(40,40,o)
def bubbles():
    for k,c in BUB.items(): save(f'bubbles/bubble-{k}.svg',bubble(c),desc=f'{k} bubble')
    for k in ('bomb','star','bolt'): save(f'bubbles/special-{k}.svg',bubble(CARD,k),desc=f'{k} power bubble')
    for i,(r,w) in enumerate([(8,5),(14,4),(19,2.5)]):
        o=f'<circle cx="28" cy="28" r="{r}" fill="none" stroke="{GOLD}" stroke-width="{w}"/>'
        for a in range(0,360,45):
            x=28+(r+6)*math.cos(math.radians(a)); y=28+(r+6)*math.sin(math.radians(a)); o+=f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{2.4-i*.5:.1f}" fill="{CARD}" stroke="{NAVY}" stroke-width="1.5"/>'
        save(f'bubbles/pop-{i+1}.svg',svg(56,56,o),desc=f'pop burst frame {i+1}')
    sh=f'<rect x="30" y="4" width="20" height="46" rx="7" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.5"/><rect x="26" y="2" width="28" height="12" rx="5" fill="{GOLDEDGE}" stroke="{NAVY}" stroke-width="2.5"/><circle cx="40" cy="58" r="19" fill="{NAVY2}" stroke="{NAVY}" stroke-width="2.5"/><circle cx="40" cy="58" r="8" fill="{CARD}" stroke="{NAVY}" stroke-width="2.5"/><rect x="6" y="70" width="68" height="8" rx="4" fill="{BLUE}" stroke="{NAVY}" stroke-width="2.5"/>'
    save('bubbles/shooter.svg',svg(80,80,sh),desc='shooter')
    save('bubbles/aim-dots.svg',svg(8,160,f'<path d="M4 156V4" stroke="{NAVY}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 12" opacity=".7"/>'),desc='aim dots')
# ---------------- word tiles
PTS=dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ',[1,3,3,2,1,4,2,4,1,8,5,1,3,1,1,3,10,1,1,1,1,4,4,8,4,10]))
STATES={'tile':(CARD,SAND,NAVY),'selected':(BLUE,BLUEEDGE,CARD),'correct':(GREEN,GREENEDGE,CARD),'present':(GOLD,GOLDEDGE,NAVY),'absent':(RAISED,SAND,'#7A7D99')}
def wtile(ch,st):
    fill,edge,ink=STATES[st]
    o=f'<rect x="2" y="7" width="52" height="53" rx="10" fill="{edge}" stroke="{NAVY}" stroke-width="2"/><rect x="2" y="2" width="52" height="53" rx="10" fill="{fill}" stroke="{NAVY}" stroke-width="2"/>'
    if ch: o+=tpath(ch,28,41,32,ink)+(tpath(str(PTS[ch]),47,17,10,ink,anchor='end',fn='dm') if st!='absent' else '')
    return svg(56,64,o)
def words():
    for st in STATES:
        save(f'words/{st}-blank.svg',wtile('',st),desc=f'empty {st} tile')
        for ch in PTS: save(f'words/{st}/{ch}.svg',wtile(ch,st),desc=f'{ch} tile ({st})')
# ---------------- trivia
CATS={'science':('flask-conical',BLUE),'history':('landmark',BROWN),'geography':('globe',GREEN),'sports':('medal',ORANGE),'music':('music',PURPLE),'movies':('clapperboard',CORAL),'food':('utensils',GOLDEDGE),'tech':('cpu',NAVY2),'nature':('leaf',GREEN),'art':('palette',PINK),'general':('brain',BLUE),'ai':('sparkles',GOLDEDGE)}
def trivia():
    for k,(ic,col) in CATS.items():
        save(f'trivia/categories/{k}.svg',svg(64,64,f'<rect x="2" y="6" width="60" height="56" rx="14" fill="{NAVY}" opacity=".18"/><rect x="2" y="2" width="60" height="56" rx="14" fill="{col}" stroke="{NAVY}" stroke-width="2.5"/><g transform="translate(14 12) scale(1.5)" fill="none" stroke="{CARD}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{lucide_inner(ic)}</g>'),kind='lucide',desc=f'{k} category tile (Lucide {ic} glyph, ISC)')
    # answer frames
    for st,(fill,edge,txt) in {'default':(CARD,SAND,NAVY),'selected':(BLUET,BLUE,NAVY),'correct':(GREENT,GREEN,NAVY),'wrong':(CORALT,CORAL,NAVY),'locked':(RAISED,SAND,NAVY)}.items():
        o=f'<rect x="2" y="6" width="316" height="50" rx="14" fill="{edge}" stroke="{NAVY}" stroke-width="2"/><rect x="2" y="2" width="316" height="50" rx="14" fill="{fill}" stroke="{NAVY}" stroke-width="2"/>'
        save(f'trivia/answer-{st}.svg',svg(320,58,o),desc=f'answer option frame ({st})')
    chips={'a':BLUE,'b':GOLD,'c':CORAL,'d':GREEN}
    for k,c in chips.items():
        ink=NAVY if c==GOLD else CARD
        save(f'trivia/chip-{k}.svg',svg(36,36,f'<circle cx="18" cy="18" r="16" fill="{c}" stroke="{NAVY}" stroke-width="2.5"/>'+tpath(k.upper(),18,25,19,ink)),desc=f'option letter {k.upper()}')
    save('trivia/chip-correct.svg',svg(36,36,f'<circle cx="18" cy="18" r="16" fill="{GREEN}" stroke="{NAVY}" stroke-width="2.5"/><path d="M10.5 18.5l5 5 10-11" fill="none" stroke="{CARD}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'),desc='correct check')
    save('trivia/chip-wrong.svg',svg(36,36,f'<circle cx="18" cy="18" r="16" fill="{CORAL}" stroke="{NAVY}" stroke-width="2.5"/><path d="M12 12l12 12M24 12L12 24" stroke="{CARD}" stroke-width="4" stroke-linecap="round"/>'),desc='wrong cross')
    q=f'<rect x="2" y="8" width="336" height="168" rx="22" fill="{NAVY}"/><rect x="2" y="2" width="336" height="168" rx="22" fill="{CARD}" stroke="{NAVY}" stroke-width="2.5"/><rect x="18" y="-6" width="100" height="26" rx="13" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.5"/>'
    q=f'<rect x="2" y="12" width="336" height="168" rx="22" fill="{NAVY}"/><rect x="2" y="6" width="336" height="168" rx="22" fill="{CARD}" stroke="{NAVY}" stroke-width="2.5"/><rect x="20" y="2" width="96" height="26" rx="13" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.5"/>'
    save('trivia/question-card.svg',svg(340,184,q),desc='question card frame (category tag slot top-left)')
    for i,f in enumerate([1,.75,.5,.25,0]):
        C=2*math.pi*26; col=GREEN if f>.5 else (GOLD if f>.25 else CORAL)
        o=f'<circle cx="32" cy="32" r="26" fill="{CARD}" stroke="{NAVY}" stroke-width="2.5"/><circle cx="32" cy="32" r="19" fill="none" stroke="{RAISED}" stroke-width="8"/>'
        if f>0: o+=f'<circle cx="32" cy="32" r="19" fill="none" stroke="{col}" stroke-width="8" stroke-linecap="butt" stroke-dasharray="{2*math.pi*19*f:.1f} 200" transform="rotate(-90 32 32)"/>'
        o+=tpath(str(int(round(f*15))),32,39,20,NAVY)
        save(f'trivia/timer-{int(f*100)}.svg',svg(64,64,o),desc=f'timer ring {int(f*100)}%')
    for k,(col,txt) in {'streak':(GOLD,'x2'),'fifty':(BLUE,'50')}.items():
        save(f'trivia/lifeline-{k}.svg',svg(56,64,f'<rect x="2" y="6" width="52" height="56" rx="14" fill="{col}" stroke="{NAVY}" stroke-width="2.5"/><rect x="2" y="2" width="52" height="54" rx="14" fill="{col}" stroke="{NAVY}" stroke-width="2.5"/>'+tpath(txt,28,38,24,NAVY if col==GOLD else CARD)),desc='lifeline button')
# ---------------- last bite
def receipt(paid=False):
    W,H=240,340
    zz=''
    n=12; step=(W-4)/n
    top='M2 8'+''.join(f'l{step/2:.1f} -6 l{step/2:.1f} 6' for _ in range(n))
    bot=''.join(f'l{-step/2:.1f} 6 l{-step/2:.1f} -6' for _ in range(n))
    path=f'{top}V{H-14}'+f'L{W-2} {H-8}'.replace(f'L{W-2} {H-8}','')+f'l0 0'+bot+'Z'
    path=f'M2 8'+''.join(f'l{step/2:.1f} -6l{step/2:.1f} 6' for _ in range(n))+f'V{H-8}'+''.join(f'l{-step/2:.1f} 6l{-step/2:.1f} -6' for _ in range(n))+'Z'
    o=f'<path d="{path}" fill="{NAVY}" transform="translate(4 6)"/><path d="{path}" fill="{CARD}" stroke="{NAVY}" stroke-width="2.5" stroke-linejoin="round"/>'
    o+=tpath('LAST BITE',W/2,52,26,NAVY)+tpath('TABLE 7 · 4 GUESTS',W/2,72,11,NAVY2,fn='dm')
    o+=f'<path d="M20 86H{W-20}" stroke="{NAVY}" stroke-width="2" stroke-dasharray="5 5"/>'
    items=[('2 x Margherita','24.00'),('1 x Wings','9.50'),('3 x Lemonade','10.50'),('1 x Tiramisu','7.00')]
    for i,(a,b) in enumerate(items):
        y=110+i*24; o+=tpath(a,22,y,12,NAVY,'start','dm')+tpath(b,W-22,y,12,NAVY,'end','dm')
    o+=f'<path d="M20 214H{W-20}" stroke="{NAVY}" stroke-width="2" stroke-dasharray="5 5"/>'
    o+=tpath('TOTAL',22,244,16,NAVY,'start')+tpath('51.00',W-22,244,20,NAVY,'end')
    if not paid: o+=f'<rect x="22" y="262" width="{W-44}" height="32" rx="8" fill="{GOLDT}" stroke="{NAVY}" stroke-width="2"/>'+tpath('Last to bite pays',W/2,283,14,NAVY)
    for i in range(18): o+=f'<rect x="{26+i*10}" y="{H-34}" width="{3+(i*7)%4}" height="14" fill="{NAVY}"/>'
    if paid: o+=f'<g transform="rotate(-8 {W/2} 276)"><rect x="52" y="254" width="136" height="46" rx="8" fill="none" stroke="{CORAL}" stroke-width="5"/>'+tpath('PAID',W/2,289,36,CORAL)+'</g>'
    return svg(W+8,H+8,o)
def lastbite():
    save('lastbite/receipt.svg',receipt(False),desc='receipt')
    save('lastbite/receipt-paid.svg',receipt(True),desc='receipt, PAID stamp')
    # cookie with bite
    ck=f'<path d="M32 4A28 28 0 1 0 60 32A10 10 0 0 1 50 22A10 10 0 0 1 40 12A10 10 0 0 1 32 4Z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.5" stroke-linejoin="round"/>'
    for (x,y) in [(22,24),(30,44),(16,40),(40,34),(44,48),(26,14)]: ck+=f'<ellipse cx="{x}" cy="{y}" rx="4" ry="3.4" fill="{BROWN}" stroke="{NAVY}" stroke-width="1.5"/>'
    save('lastbite/cookie-bite.svg',svg(64,64,ck),desc='cookie with a bite')
    pz=f'<path d="M32 60L6 14Q32 0 58 14Z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.5" stroke-linejoin="round"/><path d="M6 14Q32 0 58 14" fill="none" stroke="{GOLDEDGE}" stroke-width="7"/><path d="M6 14Q32 0 58 14" fill="none" stroke="{NAVY}" stroke-width="2.5"/>'
    for (x,y,r) in [(24,24,4.5),(38,22,4.5),(32,38,4.5)]: pz+=f'<circle cx="{x}" cy="{y}" r="{r}" fill="{CORAL}" stroke="{NAVY}" stroke-width="1.8"/>'
    save('lastbite/pizza-slice.svg',svg(64,64,pz),desc='pizza slice')
    cc=''
    for i,c in enumerate([GOLD,BLUE,CORAL,GREEN]):
        cc+=f'<circle cx="{14+i*0}" cy="{14}" r="0"/>'
    for k,n in {'split-2':2,'split-3':3,'split-4':4}.items():
        o=f'<circle cx="32" cy="32" r="28" fill="{CARD}" stroke="{NAVY}" stroke-width="2.5"/>'
        cols=[GOLD,BLUE,CORAL,GREEN]
        for i in range(n):
            a0=-90+360/n*i; a1=-90+360/n*(i+1)
            x0=32+25*math.cos(math.radians(a0)); y0=32+25*math.sin(math.radians(a0)); x1=32+25*math.cos(math.radians(a1)); y1=32+25*math.sin(math.radians(a1))
            o+=f'<path d="M32 32L{x0:.1f} {y0:.1f}A25 25 0 0 1 {x1:.1f} {y1:.1f}Z" fill="{cols[i]}" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"/>'
        save(f'lastbite/{k}.svg',svg(64,64,o),desc=f'split bill {n} ways')
    tip=f'<rect x="4" y="10" width="56" height="48" rx="10" fill="{GREEN}" stroke="{NAVY}" stroke-width="2.5"/><circle cx="32" cy="34" r="12" fill="{GOLD}" stroke="{NAVY}" stroke-width="2.5"/>'+tpath('%',32,40,16,NAVY)
    save('lastbite/tip.svg',svg(64,64,tip),desc='tip bundle')
def run():
    chess(); pool(); sudoku(); bubbles(); words(); trivia(); lastbite()
