from common import *
SUITS={'spades':NAVY,'hearts':CORAL,'diamonds':BLUE,'clubs':GREEN}
TINT={'spades':'#D9DAE6','hearts':CORALT,'diamonds':BLUET,'clubs':GREENT}
SP={'hearts':'M12 21.5C5 15.5 2 11.5 2 8A5 5 0 0 1 12 6.2A5 5 0 0 1 22 8C22 11.5 19 15.5 12 21.5Z',
'diamonds':'M12 1.5L21 12L12 22.5L3 12Z',
'spades':'M12 1.5C12 1.5 3 9 3 14.2A4.8 4.8 0 0 0 11 17.8C11 20 10.4 21 9 22.5H15C13.6 21 13 20 13 17.8A4.8 4.8 0 0 0 21 14.2C21 9 12 1.5 12 1.5Z',
'clubs':'M12 2.5A4.6 4.6 0 0 0 9.2 10.8A4.6 4.6 0 1 0 11 16.6C11 19 10.4 21 9 22.5H15C13.6 21 13 19 13 16.6A4.6 4.6 0 1 0 14.8 10.8A4.6 4.6 0 0 0 12 2.5Z'}
def pip(suit,cx,cy,s,flip=False):
    sc=s/24; t=f'translate({cx-s/2:.1f} {cy-s/2:.1f}) scale({sc:.3f})'
    if flip: t=f'translate({cx+s/2:.1f} {cy+s/2:.1f}) scale({-sc:.3f})'
    return f'<path d="{SP[suit]}" fill="{SUITS[suit]}" transform="{t}"/>'
L,C,R=35,50,65
LAY={1:[(C,70)],2:[(C,28),(C,112)],3:[(C,28),(C,70),(C,112)],4:[(L,28),(R,28),(L,112),(R,112)],
5:[(L,28),(R,28),(C,70),(L,112),(R,112)],6:[(L,28),(R,28),(L,70),(R,70),(L,112),(R,112)],
7:[(L,28),(R,28),(C,49),(L,70),(R,70),(L,112),(R,112)],8:[(L,28),(R,28),(C,49),(L,70),(R,70),(C,91),(L,112),(R,112)],
9:[(L,28),(R,28),(L,49),(R,49),(C,70),(L,91),(R,91),(L,112),(R,112)],
10:[(L,28),(R,28),(C,39),(L,49),(R,49),(L,91),(R,91),(C,101),(L,112),(R,112)]}
def face_fig(rank,suit):
    col=SUITS[suit]; t=TINT[suit]
    o=f'<rect x="27" y="22" width="46" height="96" rx="6" fill="{t}" stroke="{NAVY}" stroke-width="2"/>'
    # bust (upper half) mirrored to lower half for classic look
    def bust(flip):
        g=''
        g+=f'<path d="M31 70V62Q31 53 50 53Q69 53 69 62V70Z" fill="{col}" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"/>'
        g+=f'<circle cx="50" cy="42" r="8.5" fill="{SKINS[0]}" stroke="{NAVY}" stroke-width="2"/>'
        g+=f'<circle cx="46.8" cy="42" r="1.2" fill="{NAVY}"/><circle cx="53.2" cy="42" r="1.2" fill="{NAVY}"/>'
        if rank=='K': g+=f'<path d="M40 36L38 24L45 29L50 22L55 29L62 24L60 36Z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"/><path d="M42 47q8 6 16 0" fill="{NAVY}"/>'
        if rank=='Q': g+=f'<path d="M40 35L40 27L45 31L50 25L55 31L60 27L60 35Z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"/><path d="M41 38Q41 33 50 33Q59 33 59 38Q55 36 50 36Q45 36 41 38Z" fill="{NAVY}"/><path d="M41 38V50M59 38V50" stroke="{NAVY}" stroke-width="3" stroke-linecap="round"/>'
        if rank=='J': g+=f'<path d="M40 38Q40 28 50 28Q60 28 60 38Q56 33 50 33Q44 33 40 38Z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"/><path d="M60 30L68 26" stroke="{NAVY}" stroke-width="2.5" stroke-linecap="round"/><circle cx="68" cy="26" r="2.5" fill="{CORAL}" stroke="{NAVY}" stroke-width="1.5"/>'
        g+=f'<path d="M50 62l-4 6h8z" fill="{CARD}"/>'
        tr=f'translate(0 140) scale(1 -1) translate(100 0) scale(-1 1)' if flip else ''
        return f'<g transform="{tr}">{g}</g>' if flip else g
    # clip: top half figure region 22..70, bottom mirrored (rotate 180 about centre)
    o+=bust(False)+f'<g transform="rotate(180 50 70)">{bust(False)}</g>'
    o+=f'<path d="M27 70H73" stroke="{NAVY}" stroke-width="2"/>'
    return o
def card_face(rank,suit):
    col=SUITS[suit]; label={1:'A'}.get(rank,str(rank)) if isinstance(rank,int) else rank
    sz=18 if len(label)==1 else 14
    b=f'<rect x="1.5" y="1.5" width="97" height="137" rx="10" fill="{CARD}" stroke="{NAVY}" stroke-width="2"/>'
    b+=f'<rect x="1.5" y="5.5" width="97" height="135" rx="10" fill="none"/>'
    idx=tpath(label,13.5,24,sz,col)+pip(suit,13.5,34,12)
    b+=idx+f'<g transform="rotate(180 50 70)">{idx}</g>'
    if isinstance(rank,int):
        if rank==1: b+=pip(suit,50,70,44)
        else:
            ps=20 if rank<=3 else (15 if rank==10 else 18)
            for i,(x,y) in enumerate(LAY[rank]): b+=pip(suit,x,y,ps,flip=y>70)
    else: b+=face_fig(rank,suit)
    return svg(100,140,b)
def card_back(kind):
    o=f'<rect x="1.5" y="1.5" width="97" height="137" rx="10" fill="{kind["bg"]}" stroke="{NAVY}" stroke-width="2"/>'
    o+=f'<rect x="9" y="9" width="82" height="122" rx="6" fill="none" stroke="{kind["fg"]}" stroke-width="2"/>'
    pat=kind['pat']; fg=kind['fg']; inner=''
    if pat=='diamonds':
        for r in range(7):
            for c in range(5):
                x=20+c*15+(7.5 if r%2 else 0); y=22+r*16
                if x<80 and (x-50)**2+(y-70)**2>900: inner+=f'<path d="M{x} {y-6}L{x+5} {y}L{x} {y+6}L{x-5} {y}Z" fill="{fg}"/>'
    elif pat=='dots':
        for r in range(8):
            for c in range(5):
                x=20+c*15+(7.5 if r%2 else 0); y=20+r*14
                if x<82 and (x-50)**2+(y-70)**2>900: inner+=f'<circle cx="{x}" cy="{y}" r="3.2" fill="{fg}"/>'
    else:
        for r in range(7):
            for c in range(5):
                x=20+c*15+(7.5 if r%2 else 0); y=22+r*16
                if x<80 and (x-50)**2+(y-70)**2>900: inner+=star(x,y,6,fg)
    o+=inner+f'<circle cx="50" cy="70" r="24" fill="{kind["bg"]}"/>'
    if pat=='diamonds' or pat=='stars':
        o+=f'<circle cx="50" cy="70" r="17" fill="{kind["bg"]}" stroke="{fg}" stroke-width="2"/>'+ star(50,70,11,GOLD if pat=='diamonds' else CARD)
    else:
        o+=f'<circle cx="50" cy="70" r="17" fill="{kind["bg"]}" stroke="{fg}" stroke-width="2"/><path d="M50 58l10.4 6v12L50 82l-10.4-6V64z" fill="{GOLD}" stroke="{NAVY}" stroke-width="2" stroke-linejoin="round"/>'
    return svg(100,140,o)
def card_blank():
    return svg(100,140,f'<rect x="1.5" y="1.5" width="97" height="137" rx="10" fill="none" stroke="{NAVY}" stroke-width="2" stroke-dasharray="6 5" opacity=".5"/><rect x="1.5" y="1.5" width="97" height="137" rx="10" fill="{NAVY}" opacity=".06"/>')
def run():
    names={1:'a',11:'j',12:'q',13:'k'}
    for s in SUITS:
        for r in range(1,14):
            rk=r if r<11 else {11:'J',12:'Q',13:'K'}[r]
            nm=names.get(r,str(r))
            save(f'cards/faces/{s}-{nm}.svg',card_face(rk,s),desc=f'{nm.upper()} of {s}')
    backs={'navy':dict(bg=NAVY,fg=GOLD,pat='diamonds'),'coral':dict(bg=CORAL,fg=CARD,pat='dots'),'blue':dict(bg=BLUE,fg=CARD,pat='stars')}
    for k,v in backs.items(): save(f'cards/backs/back-{k}.svg',card_back(v),desc='card back')
    save('cards/slot-empty.svg',card_blank(),desc='empty pile slot')
