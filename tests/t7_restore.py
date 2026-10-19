import asyncio, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
async def pick(pg, act, files):
    await pg.click('#btnOpen')
    async with pg.expect_file_chooser() as fc:
        await pg.click(f'#menuOpen button[data-act={act}]')
    await (await fc.value).set_files(files)
    await pg.wait_for_timeout(200)
    await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000)
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p)
        await wait_ready(pg)
        await pick(pg, 'open-graph', [f'{FX}/vent.ttl'])
        await pick(pg, 'open-drawing', [f'{FX}/diagram_copy.png'])
        # drag something to create manual state
        await pg.keyboard.press('t'); await pg.wait_for_timeout(150)
        print('types after T:', await pg.evaluate('window.__kgov.settings.showTypes'))
        await pg.keyboard.press('t')
        await pg.wait_for_timeout(500)
        await pg.reload()
        await pg.wait_for_timeout(4000)
        print('state', await pg.evaluate('[!!window.__kgov, window.__kgov && !!window.__kgov.G, document.querySelector("#busy").hidden]'))
        print('after reload:', await pg.evaluate('[window.__kgov.isDemo, window.__kgov.graphs.map(g=>g.name), window.__kgov.drawing.name, window.__kgov.anchors.size]'))
        print('toasts:', await pg.evaluate('[...document.querySelectorAll(".toast")].map(t=>t.innerText)'))
        await pg.click('.toast button'); await pg.wait_for_timeout(300)
        await pg.wait_for_function('document.querySelector("#busy").hidden && window.__kgov.isDemo', timeout=30000)
        print('demo again:', await pg.evaluate('[window.__kgov.isDemo, window.__kgov.drawing.name, window.__kgov.anchors.size]'))
        await pg.click('label:has(input[name=scope][value=neighbours])'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/60_demo_neighbours.png')
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l][:5])
        await b.close()
asyncio.run(main())
