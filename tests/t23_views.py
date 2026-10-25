import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
ST = '''() => { const S = window.__kgov; return { main: (S.sheets[S.sheetIdx].title || 'overview'), cells: (S.board ? S.board.cells : []).map(c => [S.sheets.find(s => s.id === c.id).title || 'overview', c.c, c.r, c.collapsed ? 'C' : '']),
  margin: S.margin && [Math.round(S.margin.x0), Math.round(S.margin.x1)], frames: (S.frames || []).map(f => [f.sh.title, Math.round(f.x0), f.collapsed ? 'C' : '']) }; }'''
async def chrome_btn(pg, name, label):
    el = pg.locator('#boardChrome .bchrome', has_text=name).locator(f'button[aria-label="{label}"]')
    await el.click(); await pg.wait_for_timeout(700)
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p)
        await wait_ready(pg); await pg.wait_for_timeout(700)
        # clockwise: top, right, bottom
        for t in ['BMS AHU-01', 'AHU-01 detail', 'Catalog p. 37']:
            await pg.locator('.sb-chip', has_text=t).locator('.sb-chip-main').click(); await pg.wait_for_timeout(700)
        print('clockwise', await pg.evaluate(ST))
        await pg.click('label:has-text("Full graph")'); await pg.wait_for_timeout(900)
        print('full: margin then right column', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/230_full_margin.png')
        await pg.click('label:has-text("This drawing")'); await pg.wait_for_timeout(700)
        await pg.keyboard.press('f'); await pg.wait_for_timeout(700)
        # chrome buttons
        await chrome_btn(pg, 'Catalog p. 37', 'Collapse'); print('collapse', await pg.evaluate(ST))
        await chrome_btn(pg, 'Catalog p. 37', 'Expand'); print('expand', await pg.evaluate(ST))
        await chrome_btn(pg, 'Catalog p. 37', 'Hide'); print('hide', await pg.evaluate(ST))
        await pg.locator('#boardChrome .bchrome', has_text='AHU-01 detail').locator('button[aria-label="Change diagram"]').click(); await pg.wait_for_timeout(300)
        print('swap menu', (await pg.inner_text('#menuSwap')).replace('\n', ' | '))
        await pg.locator('#menuSwap button', has_text='Catalog p. 37').click(); await pg.wait_for_timeout(700)
        print('swapped', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/231_chrome.png')
        # reset collapses all side diagrams of this view
        await pg.click('#zReset'); await pg.wait_for_timeout(700)
        if await pg.locator('#modal:not([hidden])').count(): await pg.keyboard.press('Escape')
        print('reset', await pg.evaluate(ST))
        # open the BMS view: its own (empty) set of side diagrams
        await pg.locator('#boardChrome .bchrome', has_text='BMS AHU-01').locator('button[aria-label="Open its view"]').click(); await pg.wait_for_timeout(1500)
        print('bms view', await pg.evaluate(ST))
        await pg.locator('.sb-chip', has_text='Catalog p. 37').locator('.sb-chip-main').click(); await pg.wait_for_timeout(700)
        await pg.locator('.sb-chip', has_text='05_point_list').count()
        print('bms view + catalog', await pg.evaluate(ST))
        await pg.locator('.sb-tab', has_text='VEN03 overview').click(); await pg.wait_for_timeout(1500)
        print('back to overview', await pg.evaluate(ST))
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1200)
        print('reload', await pg.evaluate(ST))
        # sparql sorting
        await pg.click('#btnSparql'); await pg.wait_for_timeout(300)
        await pg.locator('#sparql').get_by_role('button', name='Classes & predicates').click(); await pg.wait_for_timeout(300)
        for srt in ['Prefix (ontology)', 'Name', 'Count']:
            await pg.locator('#modalBody button', has_text=srt).click(); await pg.wait_for_timeout(200)
            print(srt, (await pg.inner_text('.vb-list'))[:220].replace('\n', ' | '))
            if srt == 'Prefix (ontology)': await pg.screenshot(path=f'{OUT}/232_vocab_prefix.png')
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
