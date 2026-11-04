import asyncio, sys, os, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
DROP = '''async ([names, datas]) => { const dt = new DataTransfer();
  for (let i = 0; i < names.length; i++) { const b = Uint8Array.from(atob(datas[i]), c => c.charCodeAt(0)); dt.items.add(new File([b], names[i], { type: names[i].endsWith('.png') ? 'image/png' : 'text/turtle' })); }
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }'''
def enc(paths): return [[os.path.basename(p) for p in paths], [base64.b64encode(open(p, 'rb').read()).decode() for p in paths]]
ST = '() => { const S = window.__kgov; return { graphs: S.graphs.map(g => g.name), nodes: S.G ? S.G.nodes.size : 0, sheets: S.sheets.length, tables: S.tables.length, demo: S.isDemo }; }'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        print('start', await pg.evaluate(ST))
        # 1. drop a ttl → prompt; Enter = add (default)
        await pg.evaluate(DROP, enc([FX + '/product.ttl'])); await pg.wait_for_timeout(500)
        print('prompt', (await pg.inner_text('.gm')).replace('\n', ' | ')[:400])
        print('focused', await pg.evaluate('document.activeElement.dataset.choice'))
        await pg.screenshot(path=f'{OUT}/370_prompt.png')
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(2000)
        print('after add', await pg.evaluate(ST))
        # 2. Open graph… from the menu → prompt; Escape cancels
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=open-graph]')
        await (await fc.value).set_files(f'{FX}/sameas.ttl'); await pg.wait_for_timeout(500)
        print('prompt shown', await pg.locator('.gm').count())
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(500)
        print('after cancel', await pg.evaluate(ST), 'prompt gone', await pg.locator('.gm').count() == 0)
        # 3. replace keeps sheets and lists
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=add-graph]')
        await (await fc.value).set_files(f'{FX}/vent.ttl'); await pg.wait_for_timeout(500)
        await pg.click('.gm-opt[data-choice=replace]'); await pg.wait_for_timeout(2500)
        await pg.click('.gm.rg .gm-opt[data-choice=replace]'); await pg.wait_for_timeout(2500)
        print('after replace', await pg.evaluate(ST))
        # 4. new project
        await pg.evaluate(DROP, enc([FX + '/product.ttl'])); await pg.wait_for_timeout(500)
        await pg.click('.gm-opt[data-choice=new]'); await pg.wait_for_timeout(2500)
        print('after new', await pg.evaluate(ST))
        # 5. no graph loaded → no prompt
        print('no prompt on fresh', await pg.locator('.gm').count())
        await pg.screenshot(path=f'{OUT}/371_new.png')
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l and '404' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
