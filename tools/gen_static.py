from common import *
import shutil, subprocess, re
DL=pathlib.Path('/tmp/dl')
SRC={}  # rel -> (source, license, note)
KURL=lambda s:f'https://kenney.nl/assets/{s}'
def cp(src,rel,source,lic,note=''):
    d=A/rel; d.parent.mkdir(parents=True,exist_ok=True); shutil.copy(src,d); SRC[rel]=(source,lic,note)
def mp3(rel_ogg,source,lic,note=''):
    o=A/rel_ogg; m=o.with_suffix('.mp3')
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(o),'-codec:a','libmp3lame','-qscale:a','4',str(m)],check=True)
    SRC[str(m.relative_to(A))]=(source,lic,note+' (mp3 transcode)' if note else '(mp3 transcode)')
CC0='CC0 1.0'
SOUNDS={ # name: (pack, file)
'ui/tap':('interface-sounds','click_001'),'ui/select':('interface-sounds','select_003'),'ui/toggle':('interface-sounds','toggle_001'),'ui/back':('interface-sounds','back_001'),
'ui/open':('interface-sounds','open_001'),'ui/close':('interface-sounds','close_001'),'ui/confirm':('interface-sounds','confirmation_002'),'ui/error':('interface-sounds','error_004'),
'ui/correct':('interface-sounds','confirmation_001'),'ui/wrong':('interface-sounds','error_001'),'ui/tile':('ui-audio','click4'),
'ui/countdown-tick':('interface-sounds','tick_004'),'ui/countdown-last':('interface-sounds','drop_002'),'ui/countdown-go':('interface-sounds','bong_001'),
'reward/win':('music-jingles','NES12'),'reward/win-big':('music-jingles','STEEL02'),'reward/lose':('music-jingles','NES11'),'reward/draw':('music-jingles','PIZZI12'),
'reward/level-up':('music-jingles','SAX10'),'reward/chest-open':('music-jingles','HIT11'),'reward/coin':('digital-audio','phaserUp7'),'reward/xp':('digital-audio','powerUp10'),'reward/bonus':('digital-audio','powerUp4'),
'game/card-place':('casino-audio','card-place-1'),'game/card-slide':('casino-audio','card-slide-1'),'game/card-shuffle':('casino-audio','card-shuffle'),'game/card-fan':('casino-audio','card-fan-1'),
'game/chip-lay':('casino-audio','chip-lay-1'),'game/chips-stack':('casino-audio','chips-stack-1'),'game/chess-move':('impact-sounds','impactWood_light_000'),'game/chess-capture':('impact-sounds','impactWood_heavy_000'),
'game/pool-hit':('impact-sounds','impactMetal_light_000'),'game/pool-pocket':('impact-sounds','impactSoft_medium_000'),'game/bubble-pop':('digital-audio','pepSound3'),'game/bubble-shoot':('digital-audio','phaseJump1'),
}
def find(pack,name):
    for p in (DL/pack).rglob('*.ogg'):
        if p.stem.replace('jingles_','')==name or p.stem==name: return p
    raise SystemExit(f'missing {pack}/{name}')
def sounds():
    for rel,(pack,name) in SOUNDS.items():
        p=find(pack,name); r=f'sounds/{rel}.ogg'
        cp(p,r,f'{KURL(pack)} (original file: {p.relative_to(DL/pack)})',CC0); mp3(r,f'{KURL(pack)} (original file: {p.relative_to(DL/pack)})',CC0)
    # music
    cp(DL/'oga/dream.ogg','music/keep-your-dream-alive.ogg','https://opengameart.org/content/keep-your-dream-alive-seamless-loop (by congusbongus)',CC0,'upbeat chiptune, seamless loop, 1:13')
    cp(DL/"oga/children/Children's March Theme.ogg",'music/childrens-march-theme.ogg','https://opengameart.org/content/childrens-march-theme (by Cleyton Kauffman)',CC0,'upbeat march, seamless loop, 1:04')
    for f in ('music/keep-your-dream-alive.ogg','music/childrens-march-theme.ogg'):
        mp3(f,SRC[f][0],CC0,'')
    cp(DL/'ui-audio'/'License.txt','sounds/LICENSE-kenney-cc0.txt',KURL('ui-audio'),CC0,'licence text shipped in Kenney packs')
def fonts():
    cp(next((GF/'Bricolage Grotesque').glob('*.ttf')),'fonts/BricolageGrotesque-Variable.ttf','https://fonts.google.com/specimen/Bricolage+Grotesque (https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque)','SIL OFL 1.1')
    cp(DL/'bricolagegrotesque-OFL.txt','fonts/OFL-BricolageGrotesque.txt','https://github.com/google/fonts/blob/main/ofl/bricolagegrotesque/OFL.txt','SIL OFL 1.1')
    cp(GF/'DM Mono'/'DMMono-Medium.ttf','fonts/DMMono-Medium.ttf','https://fonts.google.com/specimen/DM+Mono (https://github.com/google/fonts/tree/main/ofl/dmmono)','SIL OFL 1.1')
    cp(GF/'DM Mono'/'DMMono-Regular.ttf','fonts/DMMono-Regular.ttf','https://fonts.google.com/specimen/DM+Mono','SIL OFL 1.1')
    cp(DL/'dmmono-OFL.txt','fonts/OFL-DMMono.txt','https://github.com/google/fonts/blob/main/ofl/dmmono/OFL.txt','SIL OFL 1.1')
ICONS="gamepad-2 piggy-bank trophy message-circle check x clock users qr-code flame lock receipt chevron-left chevron-right chevron-up chevron-down plus minus info send swords search shield-check zap timer scan-line star copy share-2 link wallet coins settings bell home user-plus arrow-left arrow-right refresh-cw volume-2 volume-x music heart gift crown medal target puzzle spade club diamond dices brain sparkles lightbulb flag eye eye-off circle-help circle-check circle-x triangle-alert external-link log-out menu ellipsis camera image pencil eraser play pause rotate-ccw bot ticket percent banknote utensils".split()
def icons():
    L=pathlib.Path('/workspace/nimbles-mockup/node_modules/lucide-static/icons')
    for n in ICONS:
        s=(L/f'{n}.svg').read_text()
        s=re.sub(r'<!--.*?-->\s*','',s,flags=re.S)
        s=s.replace('currentColor',NAVY).replace('stroke-width="2"','stroke-width="2.5"')
        d=A/f'icons/{n}.svg'; d.parent.mkdir(parents=True,exist_ok=True); d.write_text(s)
        SRC[f'icons/{n}.svg']=(f'https://lucide.dev/icons/{n} (lucide-static)','ISC','recoloured to navy, stroke 2.5')
    cp(L.parent/'LICENSE','icons/LICENSE-lucide.txt','https://github.com/lucide-icons/lucide/blob/main/LICENSE','ISC (some icons MIT, Feather-derived)')
def chess_src():
    for n in ['pawn','rook','knight','bishop','queen','king']:
        cp(DL/f'gi/chess-{n}.svg',f'chess/source-gameicons/chess-{n}.svg',f'https://game-icons.net/1x1/skoll/chess-{n}.html (https://github.com/game-icons/icons/blob/master/skoll/chess-{n}.svg)','CC BY 3.0','original, unmodified; credit: Skoll / game-icons.net')
    cp(DL/'gi/license.txt','chess/source-gameicons/LICENSE-game-icons.txt','https://github.com/game-icons/icons/blob/master/license.txt','CC BY 3.0')
def run():
    sounds(); fonts(); icons(); chess_src()
