import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]; D = sys.argv[2] + '/../site/demo'
ST = '() => { const S = window.__kgov; return { sheets: S.sheets.map(s => [s.drawing.name, s.role, s.title, s.note, s.anchors.size]), legend: S.legend && S.legend.name, ctx: S.ctxImages.map(i => [i.name, i.role, i.comment]), tables: S.tables.map(t => [t.name, t.rows.length, t.note]), G: !!S.G, demo: S.isDemo }; }'
async def pick(pg, act, files, menu='#menuOpen'):
    await pg.click('#btnOpen')
    async with pg.expect_file_chooser() as fc:
        await pg.click(f'{menu} button[data-act={act}]')
    await (await fc.value).set_files(files)
    await pg.wait_for_timeout(600)
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p)
        await wait_ready(pg)
        await pick(pg, 'open-drawing', [f'{D}/03_ahu_detail.png', f'{D}/02_legend.png', f'{D}/01_diagram.png', f'{D}/04_catalog_p37.png', f'{FX}/03_title_block.png'])
        print('dialog', (await pg.inner_text('#modalBody'))[:700].replace('\n', ' | '))
        rows = pg.locator('#modalBody .imgrow')
        n = await rows.count()
        for i in range(n):
            print(' row', i, (await rows.nth(i).locator('.imgname').inner_text()).replace('\n', ' '), '|', await rows.nth(i).locator('.qa-seg button.on').inner_text())
        await pg.screenshot(path=f'{OUT}/200_open_dialog.png')
        # name and note the detail sheet, mark the catalog page as BMS then back
        r0 = rows.filter(has_text='03_ahu_detail.png')
        await r0.locator('input.ititle').fill('AHU-01 detail')
        await r0.locator('textarea').fill('Detail of the air handling unit')
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(1500)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000)
        print('after open', await pg.evaluate(ST))
        await pick(pg, 'open-graph', [f'{D}/HTRK-VEN03_knowledge_graph.ttl', f'{D}/ahu_points.ttl', f'{D}/05_point_list.csv'])
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000); await pg.wait_for_timeout(1200)
        print('after graph', await pg.evaluate(ST))
        print('sheetbar', (await pg.inner_text('#sheetbar')).replace('\n', ' | '))
        await pg.click('.sb-add[aria-label="Manage all artifacts"]'); await pg.wait_for_timeout(400)
        print('manage', (await pg.inner_text('#modalBody'))[:900].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/201_manage.png')
        rows = pg.locator('#modalBody .imgrow')
        await rows.filter(has_text='05_point_list.csv').locator('textarea').fill('Integrator point list')
        await rows.filter(has_text='04_catalog_p37.png').locator('input.ititle').fill('Fan catalog')
        await rows.filter(has_text='03_title_block.png').locator('textarea').fill('Rev C')
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(600)
        print('after manage', await pg.evaluate(ST))
        # drop more onto the loaded project: goes to the add dialog
        await pick(pg, 'add-artifacts', [f'{FX}/04_context_photo.jpg'])
        print('add dialog', (await pg.inner_text('#modalBody'))[:300].replace('\n', ' | '))
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(600)
        print('after add', await pg.evaluate(ST))
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
