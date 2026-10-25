import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
PICK = '''() => { const S = window.__kgov; let best = null, bs = -1;
  for (const n of S.G.nodes.values()) { const sh = S.sheets.filter(s => s.anchors.has(n.iri)).length; const sc = sh * 1000 + n.out.length + n.in.length; if (sh && sc > bs) { bs = sc; best = n.iri; } }
  return best; }'''
INFO = '''(iri) => { const S = window.__kgov; const n = S.G.nodes.get(iri); return n ? { iri, label: n.label, out: n.out.length, in: n.in.length, sheets: S.sheets.filter(s => s.anchors.has(iri)).map(s => s.title || s.drawing.name), qa: !!S.qa.nodes[iri], sel: S.selection.includes(iri) } : { iri, missing: true, sheetsStill: S.sheets.filter(s => s.anchors.has(iri)).length, qa: !!S.qa.nodes[iri] }; }'''
async def count_uses(pg, iri):
    await pg.click('#btnSparql'); await pg.wait_for_timeout(200)
    await pg.fill('#sqEditor', f'SELECT (COUNT(*) AS ?n) WHERE {{ {{ <{iri}> ?p ?o }} UNION {{ ?s ?p <{iri}> }} UNION {{ ?s <{iri}> ?o }} }}')
    await pg.focus('#sqEditor'); await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(700)
    t = (await pg.inner_text('#sqResults')).replace('\n', ' ')
    await pg.click('#btnSparql'); await pg.wait_for_timeout(200)
    return t[-40:]
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        old = await pg.evaluate(PICK)
        await pg.evaluate('(i) => { const S = window.__kgov; S.qa.nodes[i] = { status: "issue", note: "check the tag", at: new Date().toISOString() }; }', old)
        print('before', await pg.evaluate(INFO, old), 'uses', await count_uses(pg, old))
        await pg.evaluate('(i) => window.__kgov', old)
        # select it and open the editor from the instance card
        await pg.fill('#search', old.split('/')[-1]); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        if not await pg.is_visible('#insp'):
            await pg.evaluate('(i) => { const S = window.__kgov; S.selection = [i]; S.selected = i; }', old)
        print('card shows', await pg.evaluate('document.querySelector("#insp h3") && document.querySelector("#insp h3").textContent'))
        await pg.locator('#insp .iri button', has_text='Edit…').click(); await pg.wait_for_timeout(400)
        print('modal', (await pg.inner_text('#modalBody'))[:500].replace('\n', ' | '))
        ok = pg.locator('#modalFoot .btn.primary')
        # an existing name is refused
        other = await pg.evaluate('(i) => [...window.__kgov.G.nodes.keys()].find(k => k !== i && k.startsWith(i.replace(/[^/#]*$/, "")))', old)
        await pg.fill('#modalBody input[aria-label="New name"]', other.split('/')[-1]); await pg.wait_for_timeout(150)
        print('existing ->', await pg.inner_text('#modalBody .callout.warn:not([hidden]) >> nth=1'), '| disabled', await ok.is_disabled())
        await pg.fill('#modalBody input[aria-label="New name"]', 'has space'); await pg.wait_for_timeout(150)
        print('space ->', await pg.inner_text('#modalBody .callout.warn:not([hidden]) >> nth=1'))
        new_local = 'Renamed_Unit_01'
        await pg.fill('#modalBody input[aria-label="New name"]', new_local); await pg.wait_for_timeout(150)
        # label edit too
        lab = pg.locator('#modalBody .ed-row input[aria-label="Label text"]').first
        if await lab.count(): await lab.fill('Renamed unit 01')
        else:
            await pg.locator('#modalBody button', has_text='+ Add label').click(); await pg.locator('#modalBody .ed-row input[aria-label="Label text"]').first.fill('Renamed unit 01')
        await pg.locator('#modalBody button', has_text='+ Add comment').click()
        await pg.locator('#modalBody .ed-row textarea').last.fill('Renamed after the site survey')
        await pg.wait_for_timeout(150)
        print('summary', (await pg.inner_text('#modalBody .ed-sum')).replace('\n', ' | ')[:500])
        print('guard', await pg.inner_text('#modalBody .ed-guard'), '| disabled before tick', await ok.is_disabled())
        await pg.screenshot(path=f'{OUT}/290_edit.png')
        await pg.locator('#modalBody .ed-guard input').check(); await pg.wait_for_timeout(100)
        print('button', await ok.inner_text(), '| disabled', await ok.is_disabled())
        await ok.click(); await pg.wait_for_timeout(800)
        new = old.rsplit('/', 1)[0] + '/' + new_local
        print('old after', await pg.evaluate(INFO, old))
        print('new after', await pg.evaluate(INFO, new))
        print('uses old', await count_uses(pg, old), '| uses new', await count_uses(pg, new))
        print('comment', await pg.evaluate('(i) => window.__kgov.G.nodes.get(i).lits.filter(l => l.p.endsWith("comment")).map(l => l.o.value)', new))
        print('changes', await pg.evaluate('window.__kgov.changes.map(c => [c.id, c.type, c.title, c.del.length, c.ins.length])'))
        # undo puts everything back (placements on every sheet too), redo again
        await pg.keyboard.press('Escape'); await pg.click('#viewport', position={'x': 5, 'y': 5}); await pg.wait_for_timeout(100)
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(700)
        print('undo old', await pg.evaluate(INFO, old), '| new', await pg.evaluate(INFO, new))
        await pg.keyboard.press('Control+y'); await pg.wait_for_timeout(700)
        print('redo new', await pg.evaluate(INFO, new))
        # SPARQL Update export carries the rename
        sp = await pg.evaluate('(() => { const b = [...document.querySelectorAll("button")].find(x => /SPARQL Update|Corrections/.test(x.textContent)); return b ? b.textContent : null; })()')
        print('export btn', sp)
        # revert from the change log
        await pg.click('#btnIssues'); await pg.wait_for_timeout(300)
        cid = await pg.evaluate('window.__kgov.changes.find(c => c.type === "rename_instance").id')
        card = await open_card(pg, key='c:' + cid)
        await card.get_by_role('button', name='Revert').click(); await pg.wait_for_timeout(700)
        print('reverted: old', await pg.evaluate(INFO, old), '| uses old', await count_uses(pg, old))
        # Claude: a flagged instance with a rename in the comment
        await pg.evaluate('(i) => { const S = window.__kgov; S.qa.nodes[i] = { status: "issue", note: "Tag on drawing is RENAME:AHU01_SupplyFan LABEL:Supply fan AHU-01", at: new Date().toISOString() }; }', old)
        await pg.evaluate('window.__kgov.qa.nodes')
        if not await pg.locator('#issues .itools >> text=Resolve with Claude').is_visible(): await pg.click('#btnIssues')
        await pg.wait_for_timeout(300)
        await pg.click('#issues .itools >> text=Resolve with Claude'); await pg.wait_for_timeout(300)
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot").innerText.includes("Review the fixes")', timeout=30000)
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(400)
        fs = await pg.evaluate('window.__kgov.findings.filter(f => f.type === "rename_instance" || f.type === "edit_text").map(f => [f.id, f.type, f.status])')
        print('claude findings', fs)
        for fid, _, _ in fs:
            card = await open_card(pg, key='f:' + fid); await pg.wait_for_timeout(500)
            if fid == fs[0][0]: print('preview', await pg.evaluate('(() => { const f = window.__kgov.issueFocus; return f && f.preview ? [f.preview.del.length, f.preview.ins.length] : null; })()'))
            await card.locator('text=Accept fix').click(); await pg.wait_for_timeout(300)
        await pg.click('#issues .applybar .btn.primary'); await pg.wait_for_timeout(800)
        new2 = old.rsplit('/', 1)[0] + '/AHU01_SupplyFan'
        print('claude rename', await pg.evaluate(INFO, new2), '| old', await pg.evaluate(INFO, old))
        print('uses old', await count_uses(pg, old), '| new', await count_uses(pg, new2))
        await pg.evaluate('[...document.querySelectorAll("button")].find(x => /Corrections from the change log/.test(x.textContent)).click()'); await pg.wait_for_timeout(400)
        txt = await pg.input_value('#modalBody textarea.out')
        print('sparql has rename', 'renamed instances' in txt, txt.count('DELETE {'), '| old IRI in INSERT DATA', 'INSERT DATA' in txt and 'AHU_HTRK-VEN03_ExhaustFan> ' in txt.split('INSERT DATA')[1].split('}')[0])
        await pg.keyboard.press('Escape')
        print('LOGS', [l for l in logs if 'error' in l.lower() and 'ERR_' not in l][:6])
        await b.close()
asyncio.run(main())
