import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'
SEC = '() => [...document.querySelectorAll("#issues [data-sec]")].map(s => s.dataset.sec + ":" + [...s.querySelectorAll(".icard")].map(c => c.dataset.key.split(":")[0]).join(",")).join("  ")'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.evaluate('''(I) => { const S = window.__kgov; const g = S.groups.find(g => g.cat === 'flow' && (g.a === I + 'Duct_VI_05' || g.b === I + 'Duct_VI_05'));
            S.qa.edges[g.qaKey] = { status: 'issue', note: 'Should go to the silencer', at: new Date().toISOString() };
            S.qa.nodes[I + 'BRS_VI_RK1-03'] = { status: 'issue', note: 'NOFIX something looks odd', at: new Date().toISOString() }; }''', I)
        await pg.click('#btnIssues'); await pg.wait_for_timeout(300)
        print('before', await pg.evaluate(SEC))
        await pg.click('#issues .itools >> text=Resolve with Claude'); await pg.wait_for_timeout(300)
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot").innerText.includes("Review the fixes")', timeout=30000)
        print('log', await pg.inner_text('.runlog'))
        print('callout', (await pg.inner_text('.nofix-callout')).replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/190_nofix_modal.png')
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(400)
        print('after resolve', await pg.evaluate(SEC))
        card = await open_card(pg, key='n:' + I + 'BRS_VI_RK1-03')
        print('node card', (await card.inner_text()).replace('\n', ' | ')[:400])
        await pg.screenshot(path=f'{OUT}/191_claude_note.png')
        ek = await pg.evaluate('"e:" + Object.keys(window.__kgov.qa.edges)[0]')
        card = await open_card(pg, key=ek); await pg.wait_for_timeout(900)
        print('flag preview', await pg.evaluate('(() => { const f = window.__kgov.issueFocus; return f && f.preview ? [f.preview.del.length, f.preview.ins.length, f.preview.combined, f.preview.n] : null; })()'))
        print('flag card', (await card.inner_text()).replace('\n', ' | ')[:500])
        await pg.screenshot(path=f'{OUT}/191b_flag_preview.png')
        fid = await pg.evaluate('window.__kgov.findings.find(f => f.type === "replace_link").id')
        card = await open_card(pg, key='f:' + fid); await pg.wait_for_timeout(900)
        print('preview', await pg.evaluate('(() => { const f = window.__kgov.issueFocus; return f && f.preview ? [f.preview.del.length, f.preview.ins.length, f.strong, f.set.size] : null; })()'))
        print('card', (await card.inner_text()).replace('\n', ' | ')[:500])
        print('pill', await pg.inner_text('#focusPill'))
        await pg.screenshot(path=f'{OUT}/192_preview.png')
        await card.locator('text=Accept fix').click(); await pg.wait_for_timeout(300)
        print('after accept', await pg.evaluate(SEC))
        await pg.click('#issues .applybar .btn.primary'); await pg.wait_for_timeout(600)
        print('after apply', await pg.evaluate(SEC))
        print('edge flag', await pg.evaluate('Object.values(window.__kgov.qa.edges).map(r => r.status + ":" + r.resolvedHow)'))
        print('changes text', (await pg.inner_text('#issues [data-sec=changes]')).replace('\n', ' | ')[:700])
        ck = await pg.evaluate('"c:" + window.__kgov.changes.at(-1).id')
        await open_card(pg, key=ck); await pg.wait_for_timeout(900)
        print('change preview', await pg.evaluate('(() => { const f = window.__kgov.issueFocus; return f && f.preview ? [f.preview.del.length, f.preview.ins.length, f.preview.applied] : null; })()'))
        await pg.screenshot(path=f'{OUT}/193_change_preview.png')
        # a fix that changes nothing: a missing_link that is already there
        r = await pg.evaluate('''(() => { const S = window.__kgov, e = S.G.edges.find(e => e.cat === 'flow');
            S.findings.push({ id: 'zz1', run: S.recheckRuns.at(-1).id, area: 'I1', seq: 99, type: 'missing_link', status: 'accepted', from: e.s, fromIri: e.s, predicate: e.p, to: e.o, toIri: e.o, conf: 0.5, evidence: 'test' });
            return e.p; })()''')
        await pg.click('#btnIssues'); await pg.wait_for_timeout(100); await pg.click('#btnIssues'); await pg.wait_for_timeout(300)
        await pg.click('#issues .applybar .btn.primary'); await pg.wait_for_timeout(400)
        print('noop toast', [t for t in await pg.evaluate('[...document.querySelectorAll("#toasts .toast")].map(t => t.innerText)')])
        print('noop change', await pg.evaluate('window.__kgov.changes.at(-1).noop'))
        await pg.screenshot(path=f'{OUT}/194_noop.png')
        print('LOGS', [l for l in logs if 'error' in l.lower()][:5])
        await b.close()
asyncio.run(main())
