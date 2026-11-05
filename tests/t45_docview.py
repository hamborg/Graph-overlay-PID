import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
GEO = '''() => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect();
  const pages = S.frames.filter(f => f.cell.page);
  const right = Math.max(S.sheets[S.sheetIdx].drawing.w, ...pages.map(f => f.dx + f.w));
  const onPages = [...S.sideNodes].filter(([i, f]) => f.cell.page).length;
  return { act: S.sheets[S.sheetIdx].drawing.page, pages: pages.length, pageNodes: onPages, scrPage: [...S.sideNodes].filter(([i, f]) => f.cell.page && S.scr.has(i)).length,
    margin: S.margin ? [Math.round(S.margin.x0), Math.round(right)] : null, view: [Math.round(S.view.tx), Math.round(S.view.ty), +S.view.s.toFixed(4)] }; }'''
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#sheetbar .sb-add >> nth=0')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuAddArt [data-act=add-artifacts]')
        await (await fc.value).set_files(f'{FX}/functional_description.pdf')
        await pg.wait_for_timeout(1500)
        if await pg.locator('#modal:not([hidden])').count(): await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(2500)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=30000)
        await pg.locator('#sheetbar .sb-tab:has-text("functional")').first.click(); await pg.wait_for_timeout(1200)
        await pg.click('.pagebar .pb-mode:has-text("12 at a time")'); await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=90000); await pg.wait_for_timeout(1200)
        # put instances on pages 3 and 4 (anchoring per page)
        await pg.click('#btnAnchor'); await pg.wait_for_timeout(500)
        await pg.click('#modalBody label.opt:has-text("All ")')
        await pg.evaluate('() => [...document.querySelectorAll(".pick-sheets label.check")].forEach(l => { l.querySelector("input").checked = /p\\. (3|4)\\b/.test(l.innerText); })')
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_selector('.as-tbl', timeout=30000)
        await pg.click('#modalFoot .btn.ghost'); await pg.wait_for_timeout(800)
        st = await pg.evaluate(GEO); print('grid, page 1 worked on', st)
        assert st['act'] == 1 and st['pages'] == 11 and st['pageNodes'] >= 28 and st['scrPage'] == st['pageNodes'], st
        await pg.screenshot(path=f'{OUT}/450_docview.png')
        # neighbours: the margin is right of every page
        await pg.locator('input[name=scope][value=neighbours]').first.check(force=True)
        await pg.wait_for_timeout(800)
        st = await pg.evaluate(GEO); print('neighbours', st)
        assert st['margin'] and st['margin'][0] >= st['margin'][1], st
        await pg.screenshot(path=f'{OUT}/451_neighbours_right.png')
        # click on page 6: it becomes the page worked on, nothing moves on screen
        pos = await pg.evaluate('''() => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(); const f = S.frames.find(f => f.cell.page && f.sh.drawing.page === 6); const { s, tx, ty } = S.view; return [ (f.dx + f.w * 0.8) * s + tx + r.left, (f.dy + f.h * 0.9) * s + ty + r.top, Math.round(f.dx * s + tx), Math.round(f.dy * s + ty)]; }''')
        await pg.mouse.click(pos[0], pos[1]); await pg.wait_for_timeout(1200)
        after = await pg.evaluate('''() => { const S = window.__kgov, a = S.sheets[S.sheetIdx]; const { s, tx, ty } = S.view; return [a.drawing.page, Math.round(tx), Math.round(ty)]; }''')
        print('clicked page 6', pos[2:], '->', after)
        assert after[0] == 6 and abs(after[1] - pos[2]) <= 2 and abs(after[2] - pos[3]) <= 2
        st = await pg.evaluate(GEO); print('page 6 worked on', st); assert st['pageNodes'] >= 28 and st['margin'][0] >= st['margin'][1]
        await pg.screenshot(path=f'{OUT}/452_page6.png')
        # drag a node on page 3 (an ordinary node now) — it moves on page 3
        w = await pg.evaluate('''() => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(); for (const [iri, f] of S.sideNodes) { if (!f.cell.page || f.sh.drawing.page !== 3) continue; const p = S.scr.get(iri); if (p && p[0] > 60 && p[1] > 200 && p[0] < r.width - 60 && p[1] < r.height - 60) return [p[0] + r.left, p[1] + r.top, iri, {...f.sh.anchors.get(iri)}]; } return null; }''')
        print('node on p3', w and w[2].split('/')[-1])
        if w:
            await pg.mouse.move(w[0], w[1]); await pg.mouse.down(); await pg.mouse.move(w[0] + 6, w[1] + 4, steps=3); await pg.mouse.move(w[0] + 10, w[1] + 8, steps=3); await pg.mouse.up(); await pg.wait_for_timeout(600)
            a2 = await pg.evaluate('(iri) => { const sh = window.__kgov.sheets.find(s => s.drawing.page === 3 && /functional/.test(s.drawing.name)); return {...sh.anchors.get(iri)}; }', w[2])
            print('moved on p3', w[3], '->', a2); assert a2['source'] == 'manual'
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
