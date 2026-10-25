import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
I = 'https://example.org/htrk-ven03/id/'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        print('bg', await pg.evaluate('[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector("#stage")).backgroundColor]'))
        await pg.screenshot(path=f'{OUT}/s01_start.png')
        # select a node by clicking
        xy = await screen_of(pg, I + 'AHU_HTRK-VEN03_SupplyFan')
        print('fan xy', xy)
        v0 = await pg.evaluate('({...window.__kgov.view})')
        await pg.mouse.click(*xy); await pg.wait_for_timeout(700)
        st = await pg.evaluate('() => { const S = window.__kgov; return [S.selection.map(x => x.split("/").pop()), S.selGroups.length, S.selGroups.filter(g => g.hidden).length, !!S.viewSaved, S.view.s.toFixed(3)]; }')
        print('selected', st, 'view0', round(v0['s'], 3))
        await pg.screenshot(path=f'{OUT}/s02_selected.png')
        # ctrl-click a second node
        xy2 = await screen_of(pg, I + 'AHU_HTRK-VEN03_SupplyFilter') or await screen_of(pg, I + 'AHU_HTRK-VEN03_Rotor')
        print('xy2', xy2)
        if xy2:
            await pg.keyboard.down('Control'); await pg.mouse.click(*xy2); await pg.keyboard.up('Control'); await pg.wait_for_timeout(600)
        print('multi', await pg.evaluate('window.__kgov.selection.map(x => x.split("/").pop())'))
        print('insp text', (await pg.inner_text('#insp'))[:500].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/s03_multi.png')
        btn = pg.get_by_role('button', name='Show path')
        if await btn.count():
            await btn.first.click(); await pg.wait_for_timeout(700)
            print('path', await pg.evaluate('() => { const S = window.__kgov; return S.pathInfo ? [S.pathInfo.ok, S.pathInfo.legs ? S.pathInfo.legs.map(l => l.length) : null, S.pathInfo.shared] : null; }'))
            await pg.screenshot(path=f'{OUT}/s04_path.png')
        # background click -> deselect + zoom back
        await pg.mouse.click(1000, 240); await pg.wait_for_timeout(700)
        print('after bg', await pg.evaluate('() => { const S = window.__kgov; return [S.selection.length, S.view.s.toFixed(3), !!S.focus]; }'))
        # SPARQL
        await pg.click('#btnSparql'); await pg.wait_for_timeout(300)
        await pg.click('#sqRun'); await pg.wait_for_timeout(800)
        print('sparql', (await pg.inner_text('#sqResults'))[:300].replace('\n', ' | '))
        print('focus', await pg.evaluate('() => { const S = window.__kgov; return S.focus ? [S.focus.kind, S.focus.set.size, (S.focus.groups||[]).length] : null; }'))
        await pg.screenshot(path=f'{OUT}/s05_sparql.png')
        await pg.locator('#sqResults tbody tr').nth(2).click(); await pg.wait_for_timeout(600)
        print('row focus', await pg.evaluate('() => { const S = window.__kgov; return [S.sparqlSel, S.focus && S.focus.set.size, S.focus && (S.focus.groups||[]).length]; }'))
        await pg.screenshot(path=f'{OUT}/s06_sparql_row.png')
        await pg.get_by_role('button', name='Expand').click(); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/s07_sparql_table.png')
        await pg.get_by_role('button', name='Full screen').click(); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f'{OUT}/s08_sparql_full.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        # Issues panel
        await pg.click('#btnIssues'); await pg.wait_for_timeout(300)
        print('panels', await pg.evaluate('[window.__kgov.rightPanel, document.querySelector("#sparql").hidden, document.querySelector("#issues").hidden]'))
        await pg.screenshot(path=f'{OUT}/s09_issues.png')
        # reset view
        await pg.click('#zReset'); await pg.wait_for_timeout(600)
        print('modal', await pg.evaluate('document.querySelector("#modal").hidden ? null : document.querySelector("#modalTitle").textContent'))
        await pg.keyboard.press('Escape')
        # recheck rect mode
        await pg.click('#btnRecheck'); await pg.wait_for_timeout(300)
        await pg.get_by_role('button', name='Rectangle').click()
        await pg.mouse.click(580, 330); await pg.mouse.move(650, 420); await pg.wait_for_timeout(100)
        await pg.screenshot(path=f'{OUT}/s10_rect_band.png')
        await pg.mouse.click(700, 450); await pg.wait_for_timeout(200)
        await pg.mouse.click(850, 520); await pg.mouse.click(950, 600); await pg.wait_for_timeout(200)
        print('areas', await pg.evaluate('window.__kgov.areas.map(a => [a.id, a.w, a.h, a.shape])'))
        await pg.screenshot(path=f'{OUT}/s11_rects.png')
        await pg.get_by_role('button', name='Re-check 2 areas').click(); await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{OUT}/s12_recheck_modal.png')
        await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape')
        print('LOGS', logs[:20])
        await b.close()
asyncio.run(main())
