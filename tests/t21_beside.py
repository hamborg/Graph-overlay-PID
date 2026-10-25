import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'
ST = '''() => { const S = window.__kgov; return { idx: S.sheetIdx, frames: (S.frames || []).map(f => f.sh.title), side: [...(S.sideNodes || new Map()).keys()].map(i => i.split('/').pop()), guests0: Object.keys(S.sheets[0].guests || {}).map(i => i.split('/').pop()), tt: S.pos.get('%sVI-TT01') ? [Math.round(S.pos.get('%sVI-TT01').x), Math.round(S.pos.get('%sVI-TT01').y)] : null,
  ttOnMain: S.sheets[0].anchors.has('%sVI-TT01'), ttOnDetail: S.sheets[1].anchors.has('%sVI-TT01') && [S.sheets[1].anchors.get('%sVI-TT01').x, S.sheets[1].anchors.get('%sVI-TT01').y], doors: S.doors.length, vis: S.vis.size, margin: S.margin && S.margin.n }; }''' % ((I,)*7)
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg); await pg.wait_for_timeout(600)
        print('start', await pg.evaluate(ST))
        # hide beside, show neighbours: VI-TT01 goes to the margin
        await pg.click('label:has-text("+ Neighbours")'); await pg.wait_for_timeout(1000)
        print('neighbours', await pg.evaluate(ST))
        # drag VI-TT01 from the margin to just left of the drawing border (outside it)
        pt = await screen_of(pg, I + 'VI-TT01')
        dst = await pg.evaluate('([x, y]) => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(); return [x * S.view.s + S.view.tx + r.left, y * S.view.s + S.view.ty + r.top]; }', [-250, 2900])
        await pg.mouse.move(*pt); await pg.mouse.down(); await pg.mouse.move(*dst, steps=10); await pg.mouse.up(); await pg.wait_for_timeout(800)
        print('guest outside', await pg.evaluate(ST))
        await pg.click('label:has-text("This drawing")'); await pg.wait_for_timeout(800)
        print('scope this drawing', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/212_guest.png')
        # beside on again: the guest jumps to its real place; off again: back to the guest spot
        await pg.click('label:has-text("+ Neighbours")'); await pg.wait_for_timeout(600)
        await pg.locator('.sb-chip', has_text='AHU-01 detail').locator('.sb-chip-main').click(); await pg.wait_for_timeout(1200)
        print('beside left', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/213_beside_left.png')
        await pg.locator('.sb-chip', has_text='AHU-01 detail').locator('.sb-chip-main').click(); await pg.wait_for_timeout(1000)
        await pg.click('label:has-text("This drawing")'); await pg.wait_for_timeout(600)
        print('beside off', await pg.evaluate(ST))
        # inspector of the guest
        await pg.fill('#search', 'VI-TT01'); await pg.wait_for_timeout(200); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(900)
        print('insp', (await pg.inner_text('#insp')).replace('\n', ' | ')[-500:])
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(500)
        # undo the guest, redo it, reload keeps it
        await pg.click('#btnUndo'); await pg.wait_for_timeout(500)
        print('undo', await pg.evaluate(ST))
        await pg.click('#btnRedo'); await pg.wait_for_timeout(500)
        print('redo', await pg.evaluate(ST))
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1500)
        print('reload', await pg.evaluate(ST))
        # anchoring on all sheets
        await pg.click('#btnAnchor'); await pg.wait_for_timeout(400)
        print('anchor modal', (await pg.inner_text('#modalBody'))[:900].replace('\n', ' | '))
        await pg.click('#modalBody input[name=ascope][value=all]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f'{OUT}/214_anchor_all.png')
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector(".runlog") && /^(Done|Stopped)/.test(document.querySelector(".runlog").innerText)', timeout=60000)
        print('anchor log', await pg.inner_text('.runlog'))
        print('prompts', await pg.evaluate('window.__mock.prompts.length'), await pg.evaluate('window.__mock.prompts.map(p => (/This drawing is "([^"]+)"/.exec(p) || [])[1])'))
        print('after anchor', await pg.evaluate(ST))
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
