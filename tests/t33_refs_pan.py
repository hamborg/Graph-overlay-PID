import asyncio, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=add-graph]')
        await (await fc.value).set_files(f'{FX}/product.ttl'); await pg.wait_for_timeout(1500)
        print('graphs', await pg.evaluate('window.__kgov.graphs.map(g => g.name)'))
        await pg.fill('#search', 'VI-TT01'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(600)
        props = pg.locator('#insp .insp-sec', has_text='Properties')
        print('props', (await props.inner_text()).replace('\n', ' | '))
        await props.locator('button', has_text='prod:NV72-2415').click(); await pg.wait_for_timeout(300)
        print('resource card', (await pg.inner_text('#modalBody'))[:400].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/330_resource.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        # wheel-button pan in box mode
        await pg.keyboard.press('Escape'); await pg.mouse.click(5, 300); await pg.wait_for_timeout(300)
        await pg.click('#zBox')
        v0 = await pg.evaluate('({...window.__kgov.view})')
        await pg.mouse.move(700, 500); await pg.mouse.down(button='middle'); await pg.mouse.move(800, 560, steps=6); await pg.mouse.up(button='middle'); await pg.wait_for_timeout(300)
        v1 = await pg.evaluate('({...window.__kgov.view})')
        print('pan', round(v1['tx'] - v0['tx']), round(v1['ty'] - v0['ty']), 'selected', await pg.evaluate('window.__kgov.selection.length'))
        await pg.mouse.move(340, 200); await pg.mouse.down(); await pg.mouse.move(1000, 800, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(300)
        print('box still selects', await pg.evaluate('window.__kgov.selection.length'))
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
