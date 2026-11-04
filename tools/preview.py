import subprocess, sys, pathlib
from common import A, ROOT
def shot(html,png,w,h,scale=2):
    subprocess.run(['google-chrome','--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars',f'--force-device-scale-factor={scale}',f'--window-size={w},{h}',f'--screenshot={png}','file://'+str(html)],capture_output=True,timeout=120)
def grid(rels,png,cols=8,cell=(100,140),bg='#F5F0E6',pad=10,scale=1.5):
    imgs=''.join(f'<img src="{A/r}" style="width:{cell[0]}px;height:{cell[1]}px">' for r in rels)
    rows=-(-len(rels)//cols); w=cols*(cell[0]+pad)+pad; h=rows*(cell[1]+pad)+pad
    html=pathlib.Path('/tmp/prev.html'); html.write_text(f'<body style="margin:0;background:{bg};padding:{pad}px;display:grid;grid-template-columns:repeat({cols},{cell[0]}px);gap:{pad}px;width:{w-2*pad}px">{imgs}</body>')
    shot(html,png,w,h,scale)
