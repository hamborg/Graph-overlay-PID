import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'; B = 'https://example.org/htrk-ven03/bms/'
ST = '''() => { const S = window.__kgov; const nm = i => i.split('/').pop(); return { idx: S.sheetIdx, scope: S.scope, cells: (S.board ? S.board.cells : []).map(c => [S.sheets.find(s => s.id === c.id).title || 'main', c.c, c.r, c.collapsed ? 'C' : '']),
  frames: (S.frames || []).map(f => [f.sh.title, f.nodes.size, f.reach, f.lit ? 'lit' : 'dim']), side: S.sideNodes ? [...S.sideNodes.keys()].map(nm) : [], sel: S.selection.map(nm), twins: (S.twinsVis || []).map(nm), away: (S.twinsAway || []).map(x => nm(x.iri)),
  imgs: document.querySelectorAll('#board img').length, chrome: [...document.querySelectorAll('#boardChrome .bchrome')].map(e => e.innerText.replace(/\\n/g, ' ')), margin: S.margin && S.margin.n, vis: S.vis.size, focus: S.focus && S.focus.kind }; }'''
async def worldClick(pg, x, y):
    pt = await pg.evaluate('([x, y]) => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(); return [x * S.view.s + S.view.tx + r.left, y * S.view.s + S.view.ty + r.top]; }', [x, y])
    return pt
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg); await pg.wait_for_timeout(800)
        print('start', await pg.evaluate(ST))
        print('sheetbar', (await pg.inner_text('#sheetbar')).replace('\n', ' | '))
        # show the BMS screenshot on the board (default: above the main sheet)
        await pg.locator('.sb-chip', has_text='BMS AHU-01').locator('.sb-chip-main').click(); await pg.wait_for_timeout(1200)
        print('bms on', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/220_bms_above.png')
        # choose the supply fan on the main sheet: its sameAs twin on the BMS appears and is marked
        await pg.fill('#search', 'AHU_HTRK-VEN03_SupplyFan'); await pg.wait_for_timeout(200); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(1500)
        print('fan chosen', await pg.evaluate(ST))
        print('insp same as', (await pg.inner_text('#insp .sameas')).replace('\n', ' | ') if await pg.locator('#insp .sameas').count() else None)
        await pg.screenshot(path=f'{OUT}/221_fan_twin.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(700)
        print('deselected', await pg.evaluate(ST))
        # + Neighbours and Full graph
        await pg.click('label:has-text("+ Neighbours")'); await pg.wait_for_timeout(900)
        print('neighbours', await pg.evaluate(ST))
        await pg.click('label:has-text("Full graph")'); await pg.wait_for_timeout(900)
        print('full', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/222_full.png')
        await pg.click('label:has-text("This drawing")'); await pg.wait_for_timeout(900)
        # the detail sheet to the right through a + zone
        g = await pg.evaluate('(() => { const g = window.__kgov.boardGeo; return [g.W, g.H, g.G]; })()')
        pt = await worldClick(pg, g[0] + g[2] * 0.5, g[1] * 0.5)
        await pg.mouse.move(*pt); await pg.wait_for_timeout(300)
        print('zone', await pg.evaluate('window.__kgov.plusZone && window.__kgov.plusZone.label'), (await pg.inner_text('#tip')))
        await pg.screenshot(path=f'{OUT}/223_zone.png')
        await pg.mouse.click(*pt); await pg.wait_for_timeout(300)
        print('zone menu', (await pg.inner_text('#menuZone')).replace('\n', ' | '))
        await pg.locator('#menuZone button', has_text='AHU-01 detail').click(); await pg.wait_for_timeout(1200)
        print('detail right', await pg.evaluate(ST))
        # collapse BMS, choose the fan: arrow to the thumbnail; click it: expands, twin marked
        await pg.locator('.sb-chip', has_text='BMS AHU-01').locator('.sb-chip-x').click(); await pg.wait_for_timeout(900)
        await pg.fill('#search', 'AHU_HTRK-VEN03_SupplyFan'); await pg.wait_for_timeout(200); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(1500)
        print('collapsed + fan', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/224_collapsed.png')
        await pg.mouse.move(700, 450); await pg.keyboard.press('f'); await pg.wait_for_timeout(900)
        print('after fit', await pg.evaluate('window.__kgov.selection.length'))
        th = await pg.evaluate('(() => { const S = window.__kgov, f = S.frames.find(f => f.collapsed), r = document.querySelector("#viewport").getBoundingClientRect(); return [(f.thumb.x + f.thumb.w / 2) * S.view.s + S.view.tx + r.left, (f.thumb.y + f.thumb.h / 2) * S.view.s + S.view.ty + r.top]; })()')
        print('under thumb', await pg.evaluate('([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.className); }', th))
        await pg.mouse.click(*th); await pg.wait_for_timeout(1200)
        print('expanded', await pg.evaluate(ST))
        # drag the BMS diagram below the main one
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(600); await pg.keyboard.press('f'); await pg.wait_for_timeout(900)
        grip = pg.locator('#boardChrome .bchrome', has_text='BMS AHU-01').locator('.bc-grip')
        gb = await grip.bounding_box()
        print('grip', gb, await pg.evaluate('(() => { const c = document.querySelector("#boardChrome .bchrome:nth-child(2)"); return c && [c.hidden, c.style.transform]; })()'))
        dst = await worldClick(pg, g[0] * 0.5, g[1] + g[2] * 0.5)
        await pg.mouse.move(gb['x'] + 5, gb['y'] + 8); await pg.mouse.down(); await pg.mouse.move(*dst, steps=12); await pg.wait_for_timeout(200)
        print('dragging', await pg.evaluate('JSON.stringify(window.__kgov.boardDrag && window.__kgov.boardDrag.target && (window.__kgov.boardDrag.target.zone || window.__kgov.boardDrag.target.cell))'))
        await pg.screenshot(path=f'{OUT}/225_dragging.png')
        await pg.mouse.up(); await pg.wait_for_timeout(1200)
        print('after drag', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/226_after_drag.png')
        # place the BMS-only valve on the main sheet
        await pg.fill('#search', 'AHU01_HC_Valve'); await pg.wait_for_timeout(200); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(1200)
        await pg.locator('#insp button', has_text='Place on another sheet').click(); await pg.wait_for_timeout(200)
        print('place menu', (await pg.inner_text('#menuPlace')).replace('\n', ' | '))
        await pg.locator('#menuPlace button', has_text='VEN03 overview').click(); await pg.wait_for_timeout(500)
        pt = await worldClick(pg, 2300, 3000)
        await pg.mouse.click(*pt); await pg.wait_for_timeout(900)
        print('valve placed', await pg.evaluate('[window.__kgov.anchors.get("%sAHU01_HC_Valve"), window.__kgov.sheets[3].anchors.has("%sAHU01_HC_Valve")]' % (B, B)))
        await pg.click('#btnUndo'); await pg.wait_for_timeout(500)
        print('undo place', await pg.evaluate('!!window.__kgov.anchors.get("%sAHU01_HC_Valve")' % B))
        # switch main to the BMS sheet via its tab: the board stays
        await pg.locator('.sb-tab', has_text='BMS AHU-01').click(); await pg.wait_for_timeout(1500)
        print('bms main', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/227_bms_main.png')
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1500)
        print('reload', await pg.evaluate(ST))
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
