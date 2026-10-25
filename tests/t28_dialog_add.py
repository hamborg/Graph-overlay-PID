import asyncio, sys, os
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
URL = 'file://' + os.path.abspath(sys.argv[2] + '/../site/test.html')
P2 = FX + '/proj2'
DROP = '''async ([names, datas]) => { const dt = new DataTransfer();
  for (let i = 0; i < names.length; i++) { const b = Uint8Array.from(atob(datas[i]), c => c.charCodeAt(0)); dt.items.add(new File([b], names[i], { type: names[i].endsWith('.png') ? 'image/png' : names[i].endsWith('.ttl') ? 'text/turtle' : names[i].endsWith('.csv') ? 'text/csv' : 'image/jpeg' })); }
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }'''
import base64
def enc(paths): return [[os.path.basename(p) for p in paths], [base64.b64encode(open(p, 'rb').read()).decode() for p in paths]]
ROWS = '[...document.querySelectorAll("#modalBody .imgrow .imgname b")].map(b => b.textContent)'
ST = '() => { const S = window.__kgov; return { G: !!S.G, sheets: S.sheets.map(s => [s.drawing.name, s.role, s.group]), imgs: S.ctxImages.map(i => [i.name, i.role]), tables: S.tables.map(t => t.name) }; }'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page()
        logs = []; pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(2000)
        # drop two drawings: the dialog opens
        await pg.evaluate(DROP, enc([f'{P2}/Ventilation/01_diagram.JPG', f'{P2}/BMS/bms_screen.jpeg']))
        await pg.wait_for_selector('#modalBody .imgrow'); await pg.wait_for_timeout(800)
        print('rows 1', await pg.evaluate(ROWS))
        # change a role, then drop more while the dialog is open: added, not replaced
        await pg.locator('#modalBody .imgrow', has_text='bms_screen').get_by_role('radio', name='Plan').click()
        await pg.evaluate(DROP, enc([f'{P2}/Ventilation/Legend.webp'.replace('Legend.webp', 'Details/detail_ahu.png'), f'{P2}/BMS/bms_screen.jpeg', '/tmp/claude-0/-home-claude/ef72ef37-554b-566b-909b-6ffe76c4fcf2/scratchpad/app/site/demo/02_legend.png', '/tmp/claude-0/-home-claude/ef72ef37-554b-566b-909b-6ffe76c4fcf2/scratchpad/app/site/demo/HTRK-VEN03_knowledge_graph.ttl']))
        await pg.wait_for_timeout(2500)
        print('rows 2', await pg.evaluate(ROWS))
        print('role kept', await pg.locator('#modalBody .imgrow', has_text='bms_screen').locator('[role=radio][aria-checked=true]').inner_text())
        print('graph loaded behind', await pg.evaluate('!!window.__kgov.G'), 'dialog open', await pg.is_visible('#modal'))
        print('toasts', await pg.evaluate('[...document.querySelectorAll(".toast")].map(t => t.innerText)'))
        await pg.screenshot(path=f'{OUT}/280_added.png')
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(2500)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000); await pg.wait_for_timeout(800)
        print('opened', await pg.evaluate(ST))
        # manage dialog: drop a file into it, save -> it becomes a sheet
        await pg.click('.sb-add[aria-label="Manage all artifacts"]'); await pg.wait_for_timeout(400)
        await pg.evaluate(DROP, enc([f'{P2}/Products/huge_plan.png']))
        await pg.wait_for_timeout(3000)
        print('manage rows', await pg.evaluate(ROWS))
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(2500)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000)
        print('after manage', await pg.evaluate(ST))
        print('LOGS', logs)
        await b.close()
os.makedirs(OUT, exist_ok=True)
asyncio.run(main())
