import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'
ST = '''() => { const S = window.__kgov; return { demo: S.isDemo, sheets: S.sheets.map(s => [s.title || s.drawing.name, s.role, s.anchors.size]), tables: S.tables.map(t => t.name), doors: S.doors.length, graphs: S.graphs.map(g => g.name) }; }'''
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=open-project]')
        await (await fc.value).set_files(f'{FX}/t17.project.json'); await pg.wait_for_timeout(2500)
        print('opened', await pg.evaluate(ST))
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1500)
        print('after reload', await pg.evaluate(ST))
        # add a sheet and a list by hand
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=add-artifacts]')
        await (await fc.value).set_files(f'{FX}/03_title_block.png'); await pg.wait_for_timeout(600)
        await pg.locator('#modalBody .imgrow button', has_text='P&ID / diagram').click()
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(1500)
        print('added sheet', await pg.evaluate(ST))
        await pg.click('.sb-tab >> nth=3'); await pg.wait_for_timeout(1200)
        print('on new sheet', await pg.evaluate('[window.__kgov.sheetIdx, window.__kgov.anchors.size, document.querySelector("#banner").innerText]'))
        await pg.screenshot(path=f'{OUT}/180_new_sheet.png')
        # manage: rename + remove
        await pg.click('.sb-add[aria-label="Manage all artifacts"]'); await pg.wait_for_timeout(300)
        await pg.locator('#modalBody .imgrow', has_text='03_title_block.png').locator('input.ititle').fill('Title block test')
        await pg.screenshot(path=f'{OUT}/181_manage.png')
        await pg.locator('#modalBody .imgrow', has_text='03_title_block.png').locator('.x-btn').click()
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(1200)
        print('after remove', await pg.evaluate(ST), await pg.evaluate('window.__kgov.sheetIdx'))
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
