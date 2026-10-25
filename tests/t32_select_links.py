import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
I = 'https://example.org/htrk-ven03/id/'
SEL = '() => { const S = window.__kgov; return { n: S.selection.length, links: S.linkSel.map(l => l.qaKey.split("|")[0]), view: Math.round(S.view.s * 1000) / 1000 }; }'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        # arrows: subject -> object by default; the two-way check uses the canonical direction
        print('arrows', await pg.evaluate('''(() => { const S = window.__kgov; const g = S.groups.find(g => g.edges.some(e => e.dir === -1)); if (!g) return null; const e = g.edges.find(e => e.dir === -1); return { p: e.p.split(/[#/]/).pop(), s: e.s.split('/').pop(), lo: g.a.split('/').pop(), ab: !!g.ab, ba: !!g.ba, cab: !!g.cab, cba: !!g.cba }; })()'''))
        print('legend', await pg.inner_text('#legArrow'))
        # click one instance: zooms; ctrl-click another: no zoom
        pts = await pg.evaluate('''(() => { const S = window.__kgov, r = document.querySelector('#viewport').getBoundingClientRect(); const out = []; for (const [i, p] of S.scr) { if (S.G.nodes.get(i).kind === 'component' && p[0] > 300 && p[0] < r.width - 450 && p[1] > 150 && p[1] < r.height - 150) out.push([i, p[0] + r.left, p[1] + r.top]); if (out.length > 3) break; } return out; })()''')
        v0 = await pg.evaluate(SEL)
        await pg.mouse.click(pts[0][1], pts[0][2]); await pg.wait_for_timeout(600)
        v1 = await pg.evaluate(SEL)
        pts2 = await pg.evaluate('''(i) => { const S = window.__kgov, r = document.querySelector('#viewport').getBoundingClientRect(); for (const [k, p] of S.scr) if (k !== i && S.G.nodes.get(k).kind === 'component' && p[0] > 250 && p[0] < r.width - 450 && p[1] > 120 && p[1] < r.height - 120) return [k, p[0] + r.left, p[1] + r.top]; }''', pts[0][0])
        await pg.keyboard.down('Control'); await pg.mouse.click(pts2[1], pts2[2]); await pg.keyboard.up('Control'); await pg.wait_for_timeout(600)
        v2 = await pg.evaluate(SEL)
        print('zoom: start', v0['view'], 'click', v1['view'], 'ctrl-click', v2['view'], 'sel', v2['n'])
        print('between', (await pg.inner_text('#insp .between'))[:300].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/320_two.png')
        # suggest a new relation as a proposal
        await pg.locator('#insp .between button', has_text='Suggest a new relation').click(); await pg.wait_for_timeout(300)
        await pg.fill('#modalBody input[aria-label="Predicate"]', 'brick:feeds'); await pg.wait_for_timeout(100)
        await pg.fill('#modalBody textarea', 'They are connected on the drawing')
        print('relation modal', (await pg.inner_text('#modalBody .ed-sum')).replace('\n', ' | '), '| now disabled', await pg.locator('#modalFoot button', has_text='Apply to the graph now').is_disabled())
        await pg.screenshot(path=f'{OUT}/321_relation.png')
        await pg.locator('#modalFoot button', has_text='Propose it').click(); await pg.wait_for_timeout(300)
        print('proposal', await pg.evaluate('window.__kgov.findings.filter(f => f.by === "reviewer").map(f => [f.type, f.predicate, f.status, !!f.fromIri, !!f.toIri])'))
        print('state', await pg.evaluate('[window.__kgov.selection.length, document.querySelector("#insp").hidden, !document.querySelector("#modal").hidden]'))
        await pg.screenshot(path=f'{OUT}/321b.png')
        # apply it now instead: add then check graph
        await pg.locator('#insp .between button', has_text='Suggest a new relation').click(); await pg.wait_for_timeout(300)
        await pg.fill('#modalBody input[aria-label="Predicate"]', 'brick:isFedBy')
        await pg.locator('#modalBody .ed-guard input').check()
        await pg.locator('#modalFoot button', has_text='Apply to the graph now').click(); await pg.wait_for_timeout(500)
        print('between after add', (await pg.inner_text('#insp .between'))[:200].replace('\n', ' | '))
        # flag a triple from the between section
        await pg.locator('#insp .between .bt-row').first.get_by_role('button', name='Issue…').click()
        await pg.fill('#insp .bt-flag textarea', 'Wrong part relation'); await pg.locator('#insp .bt-flag button', has_text='Flag as issue').click(); await pg.wait_for_timeout(300)
        print('edge flags', await pg.evaluate('Object.entries(window.__kgov.qa.edges).map(([k, r]) => [k.split("|")[0], r.status, r.note])'))
        # links: ctrl-click two lines, one issue
        await pg.keyboard.press('Escape'); await pg.mouse.click(5, 300); await pg.wait_for_timeout(400)
        await pg.evaluate('window.__kgov.selection.length && null')
        mids = await pg.evaluate('''(() => { const S = window.__kgov, r = document.querySelector('#viewport').getBoundingClientRect(); const out = [];
            const free = (x, y) => [...S.scr.values()].every(p => Math.hypot(p[0] - x, p[1] - y) > 22) && S.labRects.every(L => !(x >= L.x - 4 && x <= L.x + L.w + 4 && y >= L.y - 4 && y <= L.y + L.h + 4));
            for (const g of S.groups) { if (!g.geo || g.geo.curved || g.hidden) continue; const A = S.scr.get(g.a), B = S.scr.get(g.b); if (!A || !B || Math.hypot(A[0]-B[0], A[1]-B[1]) < 80) continue;
              for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) { const x = A[0] + (B[0]-A[0]) * t, y = A[1] + (B[1]-A[1]) * t; if (x < 250 || x > r.width - 450 || y < 120 || y > r.height - 120 || !free(x, y)) continue; out.push([x + r.left, y + r.top, g.key]); break; }
              if (out.length > 1) break; } return out; })()''')
        print('line spots', len(mids))
        for m in mids:
            await pg.keyboard.down('Control'); await pg.mouse.click(m[0], m[1]); await pg.keyboard.up('Control'); await pg.wait_for_timeout(300)
        print('link selection', await pg.evaluate(SEL), '| card', (await pg.inner_text('#insp'))[:260].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/322_links.png')
        await pg.locator('#insp button', has_text='One issue for these').click(); await pg.wait_for_timeout(200)
        await pg.fill('#modalBody textarea', 'Both lines are the same duct'); await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(300)
        print('cluster', await pg.evaluate('window.__kgov.rules.filter(r => r.kind === "cluster").map(r => [r.members.length, r.links.length, r.text])'))
        # rectangle: shift-drag
        await pg.mouse.click(5, 300); await pg.wait_for_timeout(300)
        r = await pg.evaluate('(() => { const r = document.querySelector("#viewport").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()')
        x0, y0 = r[0] + 330, r[1] + 200
        await pg.keyboard.down('Shift'); await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move(x0 + 150, y0 + 120, steps=5); await pg.mouse.move(x0 + 300, y0 + 260, steps=5)
        await pg.screenshot(path=f'{OUT}/323_box.png')
        await pg.mouse.up(); await pg.keyboard.up('Shift'); await pg.wait_for_timeout(400)
        print('rectangle', await pg.evaluate(SEL))
        # view settings menu: box mode and links in the rectangle
        await pg.click('#zView'); await pg.wait_for_timeout(200)
        print('view menu', (await pg.inner_text('#menuView'))[:400].replace('\n', ' | '))
        await pg.locator('#menuView label', has_text='also picks the links').locator('input').check(); await pg.wait_for_timeout(100)
        print('menu still open', await pg.is_visible('#menuView'))
        await pg.screenshot(path=f'{OUT}/324_view.png')
        await pg.keyboard.press('Escape'); await pg.mouse.click(5, 300); await pg.wait_for_timeout(300)
        await pg.click('#zBox'); await pg.wait_for_timeout(100)
        await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move(x0 + 300, y0 + 260, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(400)
        print('box mode + links', await pg.evaluate(SEL))
        await pg.click('#zBox')
        # owl:sameAs: choose a twin pair via the card, flag and remove it
        await pg.mouse.click(5, 300); await pg.wait_for_timeout(300)
        await pg.evaluate('''() => { const S = window.__kgov; S.selection = []; }''')
        await pg.fill('#search', 'AHU_HTRK-VEN03_SupplyFan'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(600)
        await pg.locator('#insp .sameas button', has_text='The link').first.click(); await pg.wait_for_timeout(400)
        print('sameAs pair', (await pg.inner_text('#insp .between'))[:200].replace('\n', ' | '))
        await pg.locator('#insp .bt-row.same').get_by_role('button', name='Remove…').click(); await pg.wait_for_timeout(300)
        await pg.locator('#modalBody .ed-guard input').check()
        await pg.locator('#modalFoot button', has_text='Remove from the graph now').click(); await pg.wait_for_timeout(500)
        print('after remove', (await pg.inner_text('#insp .between'))[:150].replace('\n', ' | '), await pg.evaluate('window.__kgov.changes.map(c => [c.type, c.title])'))
        await pg.keyboard.press('Escape'); await pg.mouse.click(5, 300)
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(400)
        print('undo', await pg.evaluate('window.__kgov.changes.length'))
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
