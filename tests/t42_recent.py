import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
I = 'https://example.org/htrk-ven03/id/'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        import re
        await pg.click('#btnAnchor'); await pg.wait_for_timeout(500)
        t0 = await pg.inner_text('#modalBody')
        m = re.search(r'not placed on this drawing \((\d+)\)', t0); n0 = int(m.group(1))
        m = re.search(r'(\d+) never placed · (\d+) an earlier', t0); f0, o0 = (int(m.group(1)), int(m.group(2))) if m else (n0, 0)
        print('baseline', n0, f0, o0)
        await pg.click('#modalFoot .btn.ghost'); await pg.wait_for_timeout(200)
        # take 12 placed instances off this drawing: 8 unplaced, 4 marked "not on this drawing"
        picked = await pg.evaluate('''() => { const S = window.__kgov; const l = [...S.anchors.keys()].filter(i => !S.off.has(i) && S.G.nodes.get(i) && S.G.nodes.get(i).kind === 'component').slice(0, 12);
          l.forEach((i, k) => { S.anchors.delete(i); if (k >= 8) S.off.add(i); }); return l.map(i => i.split('/').pop()); }''')
        print('picked', picked)
        await pg.click('#btnAnchor'); await pg.wait_for_timeout(500)
        t = await pg.inner_text('#modalBody')
        print('modal', t.replace('\n', ' | ')[:700])
        assert f'not placed on this drawing ({n0 + 12})' in t, t
        assert f'{f0 + 8} never placed' in t and f'{o0 + 4} an earlier run' in t
        # untick the retry: 8
        await pg.click('#modalBody label.check:has-text("Look again")')
        t2 = await pg.inner_text('#modalBody')
        assert f'not placed on this drawing ({f0 + 8})' in t2
        await pg.click('#modalBody label.check:has-text("Look again")')
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_selector('.as-tbl', timeout=15000)
        log = await pg.inner_text('.runlog')
        print('result', log.replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/420_result.png')
        rec = await pg.evaluate('() => { const r = window.__kgov.recent; return Object.fromEntries(Object.entries(r.bySheet).map(([k, v]) => [k.split(":").pop(), v.length])); }')
        print('recent', rec)
        here = list(rec.values())[0]
        assert here >= 12, rec
        await pg.click('.as-foot .btn'); await pg.wait_for_timeout(800)
        st = await pg.evaluate('() => { const S = window.__kgov; return { on: S.recentOnly, vis: S.vis.size, lines: S.groups.filter(g => g.geo).length }; }')
        print('recent view', st)
        assert st['on'] and st['vis'] == here and st['lines'] == 0, st
        print('bar', await pg.inner_text('#recentBar'))
        await pg.screenshot(path=f'{OUT}/421_recent.png')
        xy = await screen_of(pg, I + picked[0])
        await pg.mouse.click(xy[0], xy[1]); await pg.wait_for_timeout(700)
        st2 = await pg.evaluate('() => { const S = window.__kgov; return { sel: S.selection.length, vis: S.vis.size, lines: S.groups.filter(g => g.geo).length }; }')
        print('after click', st2)
        assert st2['sel'] == 1 and st2['vis'] > here and st2['lines'] > 0, st2
        await pg.screenshot(path=f'{OUT}/422_click.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        st3 = await pg.evaluate('() => { const S = window.__kgov; return { vis: S.vis.size, lines: S.groups.filter(g => g.geo).length }; }')
        print('after esc', st3)
        assert st3['lines'] == 0
        # list modal
        await pg.click('#recentBar .btn:has-text("List")'); await pg.wait_for_timeout(300)
        print('list', (await pg.inner_text('#modalBody')).replace('\n', ' | ')[:400])
        await pg.click('#modalFoot .btn.primary')
        await pg.click('#recentBar .btn:has-text("Show everything")'); await pg.wait_for_timeout(500)
        st4 = await pg.evaluate('() => { const S = window.__kgov; return { on: S.recentOnly, vis: S.vis.size, lines: S.groups.filter(g => g.geo).length }; }')
        print('everything', st4)
        assert not st4['on'] and st4['vis'] > here
        # survives a reload
        await pg.wait_for_timeout(800)
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(500)
        print('after reload bar', await pg.inner_text('#recentBar'))
        print('LOGS', [l for l in logs if 'favicon' not in l][:8])
        await b.close()
asyncio.run(main())
