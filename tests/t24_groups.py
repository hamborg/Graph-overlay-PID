import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]; D = sys.argv[2] + '/../site/demo'
ST = '() => { const S = window.__kgov; return { key: S.key, sheets: S.sheets.map(s => [s.title || s.drawing.name, s.role, s.group, s.anchors.size]), imgs: S.ctxImages.map(i => [i.name, i.role, i.group]), tables: S.tables.map(t => [t.name, t.group]), desc: (S.projectDesc || "").slice(0, 40), idx: S.sheetIdx }; }'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p)
        await wait_ready(pg); await pg.wait_for_timeout(600)
        print('demo', await pg.evaluate(ST))
        print('tabs', (await pg.inner_text('.sb-tabs')).replace('\n', ' | '))
        # menu width: + zone menu and swap menu stay narrow
        await pg.locator('.sb-chip', has_text='BMS AHU-01').locator('.sb-chip-main').click(); await pg.wait_for_timeout(800)
        await pg.locator('#boardChrome .bchrome', has_text='BMS').locator('button[aria-label="Change diagram"]').click(); await pg.wait_for_timeout(300)
        print('swap menu box', await pg.evaluate('(() => { const r = document.querySelector("#menuSwap").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; })()'))
        await pg.screenshot(path=f'{OUT}/240_swap_menu.png')
        await pg.keyboard.press('Escape')
        print('no back button', await pg.locator('.sb-back').count())
        # open folders: each folder is a group, the .md is the project description
        await pg.click('#btnOpen'); await pg.wait_for_timeout(100)
        await pg.set_input_files('#folderInput', f'{FX}/proj'); await pg.wait_for_timeout(1500)
        print('dialog', (await pg.inner_text('#modalBody'))[:900].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/241_open_groups.png', full_page=True)
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(1500)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000)
        print('after open', await pg.evaluate(ST))
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=open-graph]')
        await (await fc.value).set_files([f'{D}/HTRK-VEN03_knowledge_graph.ttl', f'{D}/ahu_points.ttl'])
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000); await pg.wait_for_timeout(1500)
        print('with graph', await pg.evaluate(ST))
        print('tabs', (await pg.inner_text('.sb-tabs')).replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/242_grouped_tabs.png')
        # legend of the Ventilation group goes with Ventilation drawings only
        print('refs on first', await pg.evaluate('(() => { const S = window.__kgov; return S.sheets.map(s => s.group); })()'))
        # manage: rename a group, remove the first sheet (no main sheet any more)
        await pg.click('.sb-add[aria-label="Manage all artifacts"]'); await pg.wait_for_timeout(400)
        g = pg.locator('#modalBody .grp-name').first
        print('first group', await g.input_value())
        await g.fill('Air'); await g.press('Tab'); await pg.wait_for_timeout(200)
        first = await pg.evaluate('window.__kgov.sheets[0].drawing.name')
        await pg.locator('#modalBody .imgrow', has_text=first).locator('.x-btn').click(); await pg.wait_for_timeout(200)
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(1500)
        print('after manage', await pg.evaluate(ST))
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1500)
        print('reload', await pg.evaluate(ST))
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
