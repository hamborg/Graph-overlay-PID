import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
ST = '''() => { const S = window.__kgov; const a = S.sheets[S.sheetIdx]; return { n: S.sheets.length, act: a.drawing.name + ' p' + a.drawing.page, frames: (S.frames || []).map(f => f.sh.drawing.page + (f.win ? 'w' : '')).join(','), pages: S.board && S.board.pages }; }'''
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#sheetbar .sb-add >> nth=0')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuAddArt [data-act=add-artifacts]')
        ch = await fc.value
        await ch.set_files(f'{FX}/functional_description.pdf')
        await pg.wait_for_timeout(1500)
        if await pg.locator('#modal:not([hidden])').count():
            print('dialog', (await pg.inner_text('#modalBody')).replace('\n', ' | ')[:300])
            await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(2500)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=30000)
        print('after add', await pg.evaluate(ST))
        tab = pg.locator('#sheetbar .sb-tab:has-text("functional")')
        print('tabs', await tab.count(), await tab.first.inner_text())
        await tab.first.click(); await pg.wait_for_timeout(1500)
        print('on doc', await pg.evaluate(ST))
        print('pagebar', (await pg.inner_text('.pagebar')).replace('\n', ' '))
        # one page: next
        await pg.click('.pagebar .pb-step[aria-label=Next]'); await pg.wait_for_function('document.querySelector("#busy").hidden'); await pg.wait_for_timeout(1200)
        st = await pg.evaluate(ST); print('next', st); assert st['act'].endswith('p2')
        await pg.screenshot(path=f'{OUT}/430_page2.png')
        # 12 at a time
        await pg.click('.pagebar .pb-mode:has-text("12 at a time")')
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000); await pg.wait_for_timeout(1500)
        st = await pg.evaluate(ST); print('grid', st)
        assert len(st['frames'].split(',')) == 11 and st['pages'], st
        print('pagebar', (await pg.inner_text('.pagebar')).replace('\n', ' '))
        await pg.screenshot(path=f'{OUT}/431_grid.png')
        await pg.click('.pagebar .pb-step[aria-label=Next]'); await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000); await pg.wait_for_timeout(1500)
        st = await pg.evaluate(ST); print('grid next', st)
        print('pagebar', (await pg.inner_text('.pagebar')).replace('\n', ' '))
        assert st['act'].endswith('p6') and len(st['frames'].split(',')) == 11, st
        await pg.screenshot(path=f'{OUT}/432_grid_next.png')
        # work on a page from the grid
        await pg.click('.bchrome.page:has(.bc-role:text-is("p. 9")) .bc-open'); await pg.wait_for_timeout(1500)
        st = await pg.evaluate(ST); print('work on 9', st); assert st['act'].endswith('p9') and st['pages']
        # all
        await pg.click('.pagebar .pb-mode:has-text("All 14")')
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000); await pg.wait_for_timeout(2000)
        st = await pg.evaluate(ST); print('all', st); assert len(st['frames'].split(',')) == 13
        await pg.screenshot(path=f'{OUT}/433_all.png')
        # anchor every page
        await pg.click('#btnAnchor'); await pg.wait_for_timeout(500)
        t = await pg.inner_text('#modalBody'); print('anchor modal', t.replace('\n', ' | ')[-700:])
        await pg.click('#modalBody label.opt:has-text("All ")')
        # untick all but two pages
        names = await pg.evaluate('() => [...document.querySelectorAll(".pick-sheets label.check")].map(l => l.innerText)')
        print('sheet list', len(names), names[:3])
        await pg.evaluate('() => [...document.querySelectorAll(".pick-sheets label.check")].forEach((l, i) => { const cb = l.querySelector("input"); cb.checked = /p\\. (3|4)\\b/.test(l.innerText); })')
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_selector('.as-tbl', timeout=30000)
        print('result', (await pg.inner_text('.runlog')).replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/434_anchored.png')
        await pg.click('#modalFoot .btn.ghost'); await pg.wait_for_timeout(400)
        # recently anchored on page 3, then show only those
        st = await pg.evaluate('() => ({ n: Object.values(window.__kgov.recent.bySheet).reduce((m, l) => m + l.length, 0) })'); print('recent', st)
        # project file: the PDF goes in once, later pages point at it; reopening keeps pages and placements
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-project]'); await pg.wait_for_timeout(2500)
        proj = await pg.evaluate('window.__mock.saved.at(-1)')
        obj = json.loads(proj['data'])
        sh = [x for x in obj['sheets'] if x['name'].startswith('functional')]
        print('project', len(proj['data']), 'pdf sheets', len(sh), 'with data', sum(1 for x in sh if 'dataUrl' in x), 'refs', sorted(set(str(x.get('dataRef')) for x in sh)), 'maxDim', sorted(set(str(x.get('maxDim')) for x in sh)))
        assert sum(1 for x in sh if 'dataUrl' in x) == 1
        open(f'{OUT}/pages.project.json', 'w').write(proj['data'])
        async with pg.expect_file_chooser() as fc:
            await pg.click('#btnOpen'); await pg.click('#menuOpen button[data-act=open-project]')
        await (await fc.value).set_files(f'{OUT}/pages.project.json')
        await pg.wait_for_timeout(1500)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=90000); await pg.wait_for_timeout(1000)
        st = await pg.evaluate('''() => { const S = window.__kgov; const l = S.sheets.filter(x => x.drawing.name.startsWith('functional')); return { n: l.length, p3: (l.find(x => x.drawing.page === 3) || {anchors: new Map()}).anchors.size, dims: [...new Set(l.map(x => x.drawing.w + 'x' + x.drawing.h))] }; }''')
        print('reopened', st)
        assert st['n'] == 14 and st['p3'] >= 28, st
        # persistence: reload
        await pg.wait_for_timeout(1500)
        size = await pg.evaluate('async () => { const r = await new Promise(res => { const q = indexedDB.open("kgov"); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); return r ? [...r.objectStoreNames] : null; }')
        print('idb stores', size)
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1500)
        print('after reload', await pg.evaluate('() => window.__kgov.sheets.length'))
        print('LOGS', [l for l in logs if 'favicon' not in l and 'ERR_FAILED' not in l][:8])
        await b.close()
asyncio.run(main())
