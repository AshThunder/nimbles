import subprocess, pathlib, random
from common import *
ASSET=str(A)
def im(rel,w=None,h=None,style='',x=None,y=None,rot=0):
    st=''
    if w: st+=f'width:{w}px;'
    if h: st+=f'height:{h}px;'
    if x is not None: st+=f'position:absolute;left:{x}px;top:{y}px;'
    if rot: st+=f'transform:rotate({rot}deg);'
    return f'<img src="{ASSET}/{rel}" style="{st}{style}">'
CSS=f'''*{{box-sizing:border-box}}body{{margin:0;background:{CREAM};font-family:'Bricolage Grotesque',sans-serif;color:{NAVY};padding:28px 32px;width:1400px}}
@font-face{{font-family:'Bricolage Grotesque';src:url('{ASSET}/fonts/BricolageGrotesque-Variable.ttf');font-weight:200 800}}
@font-face{{font-family:'DM Mono';src:url('{ASSET}/fonts/DMMono-Medium.ttf')}}
h1{{font-size:34px;font-weight:800;margin:0 0 4px}}h2{{font-size:20px;font-weight:800;margin:26px 0 10px;display:flex;gap:10px;align-items:center}}
h2 span{{background:{NAVY};color:{CREAM};border-radius:999px;font-size:12px;padding:3px 10px;font-family:'DM Mono'}}
.row{{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}}.sub{{font-family:'DM Mono';font-size:12px;opacity:.7;margin:0 0 6px}}
.panel{{background:{CARD};border:2px solid {NAVY};border-radius:14px;padding:14px}}.dark{{background:{NAVY}}}
.swatch{{width:92px;height:56px;border:2px solid {NAVY};border-radius:10px;font:11px 'DM Mono';padding:6px;display:flex;align-items:flex-end}}
.snd{{font:12px 'DM Mono';background:{CARD};border:2px solid {NAVY};border-radius:999px;padding:4px 10px}}'''
def page(title,body,name,w=1400):
    h=pathlib.Path(f'/tmp/{name}.html'); h.write_text(f'<html><head><style>{CSS}body{{width:{w+64}px}}</style></head><body><h1>{title}</h1>{body}</body></html>'); return h
def shot(html,png,w=1464,scale=1.5):
    r=subprocess.run(['node',str(ROOT/'tools/shot.js'),str(html),str(png),str(w),str(scale)],capture_output=True,text=True)
    if r.returncode: print(r.stderr)
import re
RK={'a':1,'j':11,'q':12,'k':13}
def _nk(p):
    out=[]
    for t in re.split(r'(\d+)',p):
        out.append((0,int(t)) if t.isdigit() else (1,t))
    m=re.search(r'/faces/(\w+)-(\w+)\.svg$',p)
    if m: r=m.group(2); return [(1,m.group(1)),(0,RK.get(r) or int(r))]
    return out
def ls(pat): return sorted((p.relative_to(A).as_posix() for p in A.glob(pat)),key=_nk)
def row(items,w=None,h=None,style=''): return '<div class="row">'+''.join(im(i,w,h,style) for i in items)+'</div>'
def sec(t,n,b,u='files'): return f'<h2>{t}<span>{n} {u}</span></h2>{b}'
# ---------- sheets
def sheet_cards():
    b=''; faces=ls('cards/faces/*.svg')
    for s in ['spades','hearts','diamonds','clubs']:
        fs=[f for f in faces if f'/{s}-' in f]; b+=sec(s.title(),len(fs),row(fs,80,112))
    b+=sec('Backs and slot',4,row(ls('cards/backs/*.svg')+ls('cards/slot-empty.svg'),80,112))
    return page('Cards: faces, backs, slot',b,'s_cards')
def sheet_boards():
    b=sec('Chess pieces',12,row(ls('chess/pieces/*.svg'),56,56,f'background:{CARD};border:2px solid {NAVY};border-radius:10px;padding:2px'))
    b+=f'<div class="row" style="align-items:flex-start;margin-top:10px">'+im('chess/board.svg',260)+''.join(im(i,56,56,f'background:{CARD};border:2px solid {NAVY};border-radius:8px') for i in ls('chess/hl-*.svg'))+'</div>'
    pool=ls('pool/balls/*.svg'); b+=sec('Pool balls',len(pool),row(pool,52,52))
    b+='<div class="row" style="align-items:flex-start">'+im('pool/table.svg',560)+''.join(im(i,h=60) for i in ['pool/rack.svg'])+im('pool/cue.svg',300)+im('pool/aim-line.svg',200)+im('pool/power-meter.svg',174)+'</div>'
    b+=sec('Sudoku',len(ls('sudoku/**/*.svg')),'<div class="row" style="align-items:flex-start">'+im('sudoku/board-blank.svg',200)+im('sudoku/board-sample.svg',200)+row(ls('sudoku/keys/*.svg'),44,50)+'</div>')
    bub=ls('bubbles/*.svg'); b+=sec('Bubble shooter',len(bub),row(bub,56,56))
    return page('Board games: chess, pool, sudoku, bubbles',b,'s_boards')
def sheet_words():
    b=''
    for st in ['tile','selected','correct','present','absent']:
        fs=ls(f'words/{st}/*.svg'); b+=sec(f'Word tiles: {st}',len(fs),row(fs,44,50))
    b+=sec('Trivia',len(ls('trivia/*.svg'))+len(ls('trivia/categories/*.svg')),row(ls('trivia/categories/*.svg'),64,64)+'<div class="row" style="margin-top:10px;align-items:flex-start">'+im('trivia/question-card.svg',340)+'<div style="display:grid;gap:8px">'+''.join(im(f'trivia/answer-{s}.svg',320) for s in ['default','selected','correct','wrong','locked'])+'</div>'+row(ls('trivia/chip-*.svg')+ls('trivia/timer-*.svg')+ls('trivia/lifeline-*.svg'),52,52)+'</div>')
    lb=ls('lastbite/*.svg'); b+=sec('Last Bite',len(lb),'<div class="row" style="align-items:flex-start">'+im('lastbite/receipt.svg',190)+im('lastbite/receipt-paid.svg',190)+row([x for x in lb if 'receipt' not in x],90,90)+'</div>')
    return page('Words, trivia, Last Bite',b,'s_words')
def sheet_chars():
    pip=ls('pip/*.svg'); av=ls('avatars/*.svg')
    b=sec('Nimo',len(pip),row(pip,80,86))+sec('Avatars',len(av),row(av,72,72))
    bd=[x for x in ls('badges/*.svg')]; b+=sec('Badges, medals, rewards',len(bd),row(bd,80,80))
    lv=ls('badges/levels/*.svg'); b+=sec('Levels',len(lv),row(lv,44,50)); lg=ls('badges/leagues/*.svg'); b+=sec('Leagues',len(lg),row(lg,80,80))
    fx=ls('effects/*.svg'); b+=sec('Effects',len(fx),row(fx,160,160))
    ui=ls('ui/*.svg'); b+=sec('UI: XP bars and buttons',len(ui),'<div class="row">'+''.join(im(i,200) for i in ui)+'</div>')
    return page('Characters, badges, effects, UI',b,'s_chars')
def sheet_misc():
    ic=ls('icons/*.svg'); b=sec('Icons (Lucide, navy)',len(ic),row(ic,40,40,f'background:{CARD};border:2px solid {NAVY};border-radius:10px;padding:6px'))
    sn=ls('sounds/*/*.ogg'); b+=sec('Sounds (ogg + mp3)',len(sn),'<div class="row">'+''.join(f'<span class="snd">{s[7:-4]}</span>' for s in sn)+'</div>')
    mu=ls('music/*.ogg'); b+=sec('Music loops',len(mu),'<div class="row">'+''.join(f'<span class="snd">{s[6:-4]}</span>' for s in mu)+'</div>')
    b+=sec('Fonts',3,f'<div style="font:800 54px Bricolage Grotesque">Nimbles Aa Bb 0123</div><div style="font:30px DM Mono">DM Mono Medium · 12:45 · $4.20</div>')
    pal=[('CREAM',CREAM),('CARD',CARD),('SAND',SAND),('NAVY',NAVY),('GOLD',GOLD),('BLUE',BLUE),('CORAL',CORAL),('GREEN',GREEN),('PINK',PINK),('PURPLE',PURPLE),('ORANGE',ORANGE),('BROWN',BROWN),('CHESS',"#A9CBE8")]
    b+=sec('Palette',len(pal),'<div class="row">'+''.join(f'<div class="swatch" style="background:{c};color:{CREAM if n in ("NAVY","BLUE","CORAL","GREEN","PURPLE","BROWN") else NAVY}">{n}<br>{c}</div>' for n,c in pal)+'</div>','colours')
    return page('Icons, sounds, fonts, palette',b,'s_misc')
# ---------- samples
def sample_solitaire():
    W,H=84,118; random.seed(4); suits=['spades','hearts','diamonds','clubs']; ranks=['a','2','3','4','5','6','7','8','9','10','j','q','k']
    deck=[(s,r) for s in suits for r in ranks]; random.shuffle(deck)
    o=''; x0=24; gap=18
    # stock + waste
    o+=im('cards/backs/back-navy.svg',W,H,x=x0,y=20)+im(f'cards/faces/{deck[0][0]}-{deck[0][1]}.svg',W,H,x=x0+W+gap,y=20)
    for i,s in enumerate(suits):
        o+=(im(f'cards/faces/{s}-{ranks[2-(i%2)]}.svg',W,H,x=x0+(3+i)*(W+gap),y=20) if i<2 else im('cards/slot-empty.svg',W,H,x=x0+(3+i)*(W+gap),y=20,style=f'border:2px dashed {CREAM};border-radius:10px;opacity:.7') if False else (im(f'cards/faces/{s}-{ranks[2-(i%2)]}.svg',W,H,x=x0+(3+i)*(W+gap),y=20) if i<2 else f'<div style="position:absolute;left:{x0+(3+i)*(W+gap)}px;top:20px;width:{W}px;height:{H}px;border:2px dashed {CREAM};border-radius:10px;opacity:.6"></div>'))
    k=1
    for c in range(7):
        for r in range(c+1):
            s,rk=deck[k]; k+=1
            y=170+r*26 if r<c else 170+c*26
            o+=im('cards/backs/back-navy.svg' if r<c else f'cards/faces/{s}-{rk}.svg',W,H,x=x0+c*(W+gap),y=170+r*(26 if r<c else 30))
    o+=im('cards/faces/hearts-q.svg',W,H,x=x0+6*(W+gap),y=170+6*26+30+34-4) if False else ''
    w=x0*2+7*W+6*gap
    return f'<div style="position:relative;width:{w}px;height:470px;background:{GREEN};border:3px solid {NAVY};border-radius:20px;box-shadow:0 6px 0 {GREENEDGE}">{o}</div>',w
def sample_pool():
    S=1.6; o=im('pool/table.svg',400*S,220*S,x=0,y=0)
    d=26*S/1; bs=26*S
    def ball(n,x,y): return im(f'pool/balls/ball-{n}.svg',bs,bs,x=x*S-bs/2,y=y*S-bs/2)
    order=[1,9,2,10,8,3,11,4,12,5,13,6,14,7,15]; i=0; rr=13.4
    for col in range(5):
        for r in range(col+1):
            x=290+col*rr*1.732; y=110+(r-col/2)*2*rr+0
            o+=ball(order[i],x,y); i+=1
    o+=ball('cue',110,110)
    o=f'<div style="position:absolute;left:130px;top:0">{o}</div>'
    o+=im('pool/cue.svg',280,16*280/300,x=4,y=110*S-7)
    o+=im('pool/aim-line.svg',w=170*S*0.6,h=8*0.6*S,x=130+(110+14)*S,y=110*S-2.5)
    return f'<div style="position:relative;width:{400*S+130}px;height:{220*S}px">{o}</div>',400*S+130
def sample_chess():
    o=im('chess/board.svg',328,328,x=0,y=0)
    pos={'r':'rook','n':'knight','b':'bishop','q':'queen','k':'king','p':'pawn'}
    rows=['rnbqkb.r','pppp.ppp','.....n..','....p...','..B.P...','.....N..','PPPP.PPP','RNBQK..R']
    for ri,rw in enumerate(rows):
        for ci,ch in enumerate(rw):
            if ch=='.':continue
            c='w' if ch.isupper() else 'b'; o+=im(f'chess/pieces/{c}-{pos[ch.lower()]}.svg',36,36,x=4+ci*40+2,y=4+ri*40+2)
    o+=im('chess/hl-select.svg',40,40,x=4+2*40,y=4+4*40)+im('chess/hl-move.svg',40,40,x=4+2*40,y=4+3*40)+im('chess/hl-capture.svg',40,40,x=4+5*40,y=4+2*40)
    return f'<div style="position:relative;width:328px;height:328px">{o}</div>',328
def sample_sudoku():
    o=im('sudoku/board-sample.svg',360,360,x=0,y=0)
    keys=''.join(im(f'sudoku/keys/key-{k}.svg',34,39,x=i*38,y=374) for i,k in enumerate([1,2,3,4,5,6,7,8,9]))
    o+=keys; o+=im('sudoku/keys/key-erase.svg',34,39,x=0,y=418)+im('sudoku/keys/key-notes.svg',34,39,x=38,y=418)
    return f'<div style="position:relative;width:360px;height:462px">{o}</div>',360
def sample_bubbles():
    cols=['gold','blue','coral','green','pink','purple','orange']; random.seed(7); o=''; D=40
    for r in range(7):
        n=8 if r%2==0 else 7
        for c in range(n):
            if r>=5 and (c+r)%3==0: continue
            o+=im(f'bubbles/bubble-{random.choice(cols[:5])}.svg',D,D,x=c*D+(D/2 if r%2 else 0)+6,y=r*35+8)
    o+=im('bubbles/special-bomb.svg',D,D,x=6+3*D,y=8+35*3)+im('bubbles/pop-2.svg',56,56,x=6+5*D-8,y=8+35*2-8)
    o+=im('bubbles/aim-dots.svg',8,150,x=6+4*D-4,y=300)+im('bubbles/shooter.svg',80,80,x=6+4*D-40+20-20,y=430)+im('bubbles/bubble-coral.svg',D,D,x=6+4*D-20+ 0,y=455)
    return f'<div style="position:relative;width:340px;height:520px;background:{CARD};border:3px solid {NAVY};border-radius:16px">{o}</div>',340
def sample_trivia():
    o=im('trivia/question-card.svg',340,184,x=0,y=0)+im('trivia/categories/science.svg',52,52,x=144,y=-26)
    for i,s in enumerate(['default','selected','correct','wrong']): o+=im(f'trivia/answer-{s}.svg',340,62,x=0,y=204+i*70)
    T=lambda t,x,y,w,sz,c=NAVY,al='left':f'<div style="position:absolute;left:{x}px;top:{y}px;width:{w}px;font:800 {sz}px/1.15 Bricolage Grotesque;color:{c};text-align:{al}">{t}</div>'
    o+=T('Which planet has the most moons?',24,60,292,24,NAVY,'center')
    for i,t in enumerate(['Mars','Saturn','Venus','Mercury']): o+=T(t,58,222+i*70,240,22)
    o+=im('trivia/chip-a.svg',28,28,x=16,y=221+0)+im('trivia/chip-b.svg',28,28,x=16,y=221+70)+im('trivia/chip-correct.svg',28,28,x=16,y=221+140)+im('trivia/chip-wrong.svg',28,28,x=16,y=221+210)
    o+=im('trivia/timer-75.svg',52,52,x=288,y=-34)+im('trivia/lifeline-fifty.svg',44,50,x=0,y=490)+im('trivia/lifeline-streak.svg',44,50,x=50,y=490)
    return f'<div style="position:relative;width:340px;height:548px;margin-top:40px">{o}</div>',340
def sample_words():
    rows=[('CRANE','absent absent present absent correct'),('SLOTH','absent absent absent present absent'),('PIANO','correct correct correct correct correct')]
    o=''
    for r,(w,st) in enumerate(rows):
        for c,(ch,s) in enumerate(zip(w,st.split())): o+=im(f'words/{s}/{ch}.svg',56,64,x=c*62,y=r*70)
    for c,ch in enumerate('MA'): o+=im(f'words/selected/{ch}.svg',56,64,x=c*62,y=210)
    for c in range(3): o+=im('words/tile-blank.svg' if False else 'words/tile/A.svg',56,64,x=(c+2)*62,y=210,style='opacity:.0')
    return f'<div style="position:relative;width:310px;height:274px">{o}</div>',310
def sample_blackjack():
    o=''
    o+=im('cards/backs/back-coral.svg',90,126,x=20,y=14)+im('cards/faces/clubs-a.svg',90,126,x=72,y=14)
    o+=im('cards/faces/spades-k.svg',90,126,x=20,y=180)+im('cards/faces/hearts-7.svg',90,126,x=72,y=180)+im('cards/faces/diamonds-4.svg',90,126,x=124,y=180)
    for i,b in enumerate(['badges/coins-stack-1.svg','badges/coins-stack-2.svg','badges/coins-stack-3.svg']): o+=im(b,50,50,x=190+i*46,y=20+i*0 )
    o+=f'<div style="position:absolute;left:190px;top:100px;font:800 22px Bricolage Grotesque;color:{CREAM}">Dealer 21?</div>'
    o+=f'<div style="position:absolute;left:222px;top:250px;font:800 22px Bricolage Grotesque;color:{CREAM}">You: 21</div>'
    return f'<div style="position:relative;width:340px;height:330px;background:{GREEN};border:3px solid {NAVY};border-radius:20px">{o}</div>',340
def sample_hud():
    o=f'<div style="display:flex;gap:10px;align-items:center">'+im('avatars/me.svg',56,56)+im('badges/vs.svg',48,48)+im('avatars/ada.svg',56,56)+'</div>'
    o+='<div style="display:flex;gap:10px;margin-top:12px;align-items:center">'+im('pip/pip-cheer.svg',70,76)+im('badges/flame-hot.svg',48,48)+im('badges/coin.svg',40,40)+im('badges/chest-open.svg',64,64)+im('badges/trophy-gold.svg',64,64)+'</div>'
    o+='<div style="margin-top:12px">'+im('ui/xp-bar-75.svg',200)+'</div><div style="margin-top:10px">'+im('ui/button-gold.svg',200)+f'<div style="margin-top:-46px;height:46px;width:200px;text-align:center;font:800 22px/40px Bricolage Grotesque">PLAY</div></div><div style="margin-top:10px">'+im('badges/banner-victory.svg',200)+'</div>'
    return f'<div class="panel" style="width:340px">{o}</div>',340
def sheets():
    out={}
    for fn,name in [(sheet_cards,'sheet-1-cards'),(sheet_boards,'sheet-2-boards'),(sheet_words,'sheet-3-words-trivia-lastbite'),(sheet_chars,'sheet-4-characters-badges-ui'),(sheet_misc,'sheet-5-icons-sounds-fonts-palette')]:
        h=fn(); p=ROOT/'sheets'/f'{name}.png'; p.parent.mkdir(exist_ok=True); shot(h,p); out[name]=p
    parts=[('Solitaire',*sample_solitaire()),('8-ball pool',*sample_pool()),('Chess',*sample_chess()),('Sudoku',*sample_sudoku()),('Bubble shooter',*sample_bubbles()),('Trivia',*sample_trivia()),('Word tiles',*sample_words()),('21',*sample_blackjack()),('Match HUD',*sample_hud())]
    cell=lambda t,h,w:f'<div style="width:{w}px"><div class="sub">{t}</div>{h}</div>'
    body='<div style="display:flex;flex-wrap:wrap;gap:34px;align-items:flex-start">'+''.join(cell(t,h,w) for t,h,w in parts)+'</div>'
    h=page('Sample boards assembled from the assets',body,'s_samples',1400); p=ROOT/'sheets'/'samples.png'; shot(h,p); out['samples']=p
    return out
if __name__=='__main__': print(sheets())
