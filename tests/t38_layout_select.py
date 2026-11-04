import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
MIDS = '''(n) => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(), out = [];
  for (const g of S.groups) { const geo = g.geo; if (!geo || g.hidden) continue;
    const x = geo.curved ? .25 * geo.x1 + .5 * geo.cx + .25 * geo.x2 : (geo.x1 + geo.x2) / 2, y = geo.curved ? .25 * geo.y1 + .5 * geo.cy + .25 * geo.y2 : (geo.y1 + geo.y2) / 2;
    if (x < 80 || y < 200 || x > r.width - 420 || y > r.height - 80) continue;
    if (Math.hypot(geo.x2 - geo.x1, geo.y2 - geo.y1) < 90) continue;
    out.push([x + r.left, y + r.top, g.key]); if (out.length >= n) break; }
  return out; }'''
ST = '() => { const S = window.__kgov; return { sel: S.selection.length, links: S.linkSel.map(l => l.key.split("|")[0]), insp: !document.querySelector("#insp").hidden, head: document.querySelector("#insp").hidden ? null : document.querySelector("#insp header").innerText.replace(/\\n/g, " · "), focus: S.focus && S.focus.kind, focusN: S.focus && S.focus.set.size, pop: S.edgePopOpen, back: !document.querySelector("#btnBack").disabled, hist: (S.viewHist || []).length }; }'
async def click_link(pg, mids, ctrl=False):
    for x, y, k in mids:
        before = await pg.evaluate('window.__kgov.linkSel.map(l => l.key).join(",")')
        if ctrl: await pg.keyboard.down('Control')
        await pg.mouse.click(x, y)
        if ctrl: await pg.keyboard.up('Control')
        await pg.wait_for_timeout(500)
        after = await pg.evaluate('window.__kgov.linkSel.map(l => l.key).join(",")')
        if after != before: return k
    return None
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        print('top groups', await pg.evaluate('[...document.querySelectorAll(".topbar .tb-group")].map(g => g.className.replace("tb-group ", "") + ": " + [...g.querySelectorAll(":scope button[id], :scope .menu-wrap > button[id]")].map(b => b.id).join(","))'))
        print('side order', await pg.evaluate('[...document.querySelectorAll("#side details[data-sec]")].map(d => d.dataset.sec + (d.open ? "" : " (folded)"))'))
        await pg.evaluate("window.__kgov.settings.zoomOnSelect = false")
        mids = await pg.evaluate(MIDS, 12)
        # 1. plain click on a line = choose that link
        k = await click_link(pg, mids)
        print('link clicked', k is not None, await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/380_one_link.png')
        # 2. ctrl-click another line → two links
        k2 = await click_link(pg, [m for m in mids if m[2] != k], ctrl=True)
        print('two links', await pg.evaluate(ST))
        await pg.screenshot(path=f'{OUT}/381_two_links.png')
        # 3. plain click on an instance replaces the choice (links go)
        iri = await pg.evaluate('[...window.__kgov.anchors.keys()].find(i => window.__kgov.scr.get(i) && window.__kgov.G.nodes.get(i).kind === "component")')
        pt = await screen_of(pg, iri)
        await pg.mouse.click(pt[0], pt[1]); await pg.wait_for_timeout(500)
        print('node', await pg.evaluate(ST))
        # 4. several instances: same actions as several links
        others = await pg.evaluate('(iri) => [...window.__kgov.anchors.keys()].filter(i => i !== iri && window.__kgov.scr.get(i)).slice(3, 5)', iri)
        for o in others:
            pt = await screen_of(pg, o); await pg.keyboard.down('Control'); await pg.mouse.click(pt[0], pt[1]); await pg.keyboard.up('Control'); await pg.wait_for_timeout(300)
        print('multi buttons', await pg.evaluate('[...document.querySelectorAll("#insp .multibar .btnrow button")].map(b => b.innerText)'))
        await pg.screenshot(path=f'{OUT}/382_multi.png')
        # 5. Back steps through the earlier choices
        print('before back', await pg.evaluate(ST))
        await pg.click('#btnBack'); await pg.wait_for_timeout(700)
        print('back 1', await pg.evaluate(ST))
        await pg.click('#btnBack'); await pg.wait_for_timeout(700)
        print('back 2', await pg.evaluate(ST))
        await pg.keyboard.press('Alt+ArrowLeft'); await pg.wait_for_timeout(700)
        print('back 3 (Alt+←)', await pg.evaluate(ST))
        # sheet hop and back
        await pg.locator('.sb-tab', has_text='AHU-01 detail').first.click(); await pg.wait_for_timeout(1500)
        print('on sheet', await pg.evaluate('window.__kgov.sheets[window.__kgov.sheetIdx].drawing.name'))
        await pg.click('#btnBack'); await pg.wait_for_timeout(1500)
        print('back to sheet', await pg.evaluate('window.__kgov.sheets[window.__kgov.sheetIdx].drawing.name'))
        # 6. All triples window
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.fill('#search', 'AHU_HTRK-VEN03_SupplyFan'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(700)
        await pg.click('#insp .iri button:has-text("Triples…")'); await pg.wait_for_timeout(500)
        print('tw head', (await pg.inner_text('#modalBody > p.hint'))[:300])
        print('tw sections', await pg.evaluate('[...document.querySelectorAll(".tw-sec, .tw-twin")].map(x => x.innerText.replace(/\\n/g, " "))'))
        rows = pg.locator('.tw-row')
        print('rows', await rows.count())
        await rows.nth(1).click(); await rows.nth(4).click(modifiers=['Shift']); await pg.wait_for_timeout(200)
        print('chosen', await pg.inner_text('.tw-count'))
        await pg.screenshot(path=f'{OUT}/383_triples.png')
        await pg.get_by_role('button', name='Suggest refinement…').click(); await pg.wait_for_timeout(200)
        await pg.fill('.tw-form textarea', 'use more specific Brick classes')
        await pg.get_by_role('button', name='Add refinement').click(); await pg.wait_for_timeout(400)
        print('done', await pg.inner_text('.tw-done'))
        # twin section: choose all of the twin's triples as subject → issue
        twin_cb = pg.locator('.tw-sec.twin input[type=checkbox]').first
        await twin_cb.check(); await pg.wait_for_timeout(200)
        print('chosen twin', await pg.inner_text('.tw-count'))
        await pg.get_by_role('button', name='Report issue…').click(); await pg.fill('.tw-form textarea', 'BMS label is wrong'); await pg.get_by_role('button', name='Report issue', exact=True).click(); await pg.wait_for_timeout(400)
        print('marked rows', await pg.evaluate('[...document.querySelectorAll(".tw-row .schip")].map(x => x.innerText)'))
        rules = await pg.evaluate('window.__kgov.rules.filter(r => r.triples).map(r => ({mode: r.mode, n: r.triples.length, members: r.members.map(m => m.split("/").pop()), links: r.links.length, text: r.text}))')
        print('rules', rules)
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(200)
        await pg.click('#btnIssues'); await pg.wait_for_timeout(500)
        print('issues', await pg.evaluate('[...document.querySelectorAll("#issues .icard")].filter(c => /Refine|Triples/.test(c.innerText)).map(c => c.innerText.replace(/\\n/g, " | ").slice(0, 160))'))
        await pg.screenshot(path=f'{OUT}/384_issues.png')
        # the prompt for Claude carries the triples
        await pg.click('#issues .itools >> text=Resolve with Claude'); await pg.wait_for_timeout(400)
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(2500)
        pr = await pg.evaluate('(window.__mock.prompts || []).slice(-1)[0] || ""')
        i = pr.find('suggested refinement'); print('prompt refine', pr[i-20:i+420].replace('\n', ' | ') if i >= 0 else 'NOT FOUND')
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l and '404' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
