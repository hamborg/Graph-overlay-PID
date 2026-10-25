import asyncio, sys, json, os, io, zipfile, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        # an instance in two reports
        twin = await pg.evaluate('''() => { const S = window.__kgov, cnt = new Map();
            for (const c of S.checks || []) for (const it of c.items) if (it.iri) cnt.set(it.iri, (cnt.get(it.iri) || []).concat(c.title));
            const hit = [...cnt].find(([, t]) => t.length >= 2); return hit ? hit : null; }''')
        if not twin:
            # make one: low confidence + open end for a segment
            twin = await pg.evaluate('''() => { const S = window.__kgov; const c = S.checks.find(c => c.id === 'open'); const iri = c.items[0].iri; const a = S.anchors.get(iri); a.source = 'claude'; a.conf = 0.4; return [iri, []]; }''')
        iri = twin[0]
        await pg.evaluate('(i) => { const S = window.__kgov; S.selection = [i]; S.selected = i; }', iri)
        await pg.fill('#search', iri.split('/')[-1]); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(600)
        rows = pg.locator('#insp .iss-row', has=pg.locator('.sev'))
        n = await rows.count()
        print('instance', iri.split('/')[-1], 'report rows', n, [await rows.nth(k).locator('b').inner_text() for k in range(n)])
        await rows.nth(0).get_by_role('button', name='Correct').click(); await pg.wait_for_timeout(300)
        rows = pg.locator('#insp .iss-row', has=pg.locator('.sev'))
        await rows.nth(1).get_by_role('button', name='Issue').click(); await pg.wait_for_timeout(300)
        rows = pg.locator('#insp .iss-row', has=pg.locator('.sev'))
        st = [await rows.nth(k).locator('button.on').all_inner_texts() for k in range(n)]
        print('per-report decisions', st)
        print('qa.checks', await pg.evaluate('Object.entries(window.__kgov.qa.checks).map(([k, r]) => [k.split("|")[0], r.status])'))
        print('node flag', await pg.evaluate('(i) => { const r = window.__kgov.qa.nodes[i]; return r && [r.status, r.fromChecks, Object.values(r.checkNotes || {}).map(x => x.title)]; }', iri))
        await pg.screenshot(path=f'{OUT}/310_two_reports.png')
        # click the chosen one again: undecided
        rows = pg.locator('#insp .iss-row', has=pg.locator('.sev'))
        await rows.nth(1).get_by_role('button', name='Issue').click(); await pg.wait_for_timeout(300)
        rows = pg.locator('#insp .iss-row', has=pg.locator('.sev'))
        print('after toggle off', [await rows.nth(k).locator('button.on').all_inner_texts() for k in range(n)], '| node flag', await pg.evaluate('(i) => window.__kgov.qa.nodes[i] || null', iri))
        # review of this instance: click Correct twice -> undecided
        rb = pg.locator('#insp .insp-sec', has_text='Review of this instance')
        await rb.get_by_role('button', name='Correct').click(); await pg.wait_for_timeout(250)
        print('review on', await pg.evaluate('(i) => (window.__kgov.qa.nodes[i] || {}).status', iri))
        rb = pg.locator('#insp .insp-sec', has_text='Review of this instance')
        await rb.get_by_role('button', name='Correct').click(); await pg.wait_for_timeout(250)
        print('review toggled off', await pg.evaluate('(i) => (window.__kgov.qa.nodes[i] || {}).status || "undecided"', iri), await rb.locator('button.on').all_inner_texts())
        # undo brings it back
        await pg.keyboard.press('Escape'); await pg.click('#viewport', position={'x': 5, 'y': 5})
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(300)
        print('undo', await pg.evaluate('(i) => (window.__kgov.qa.nodes[i] || {}).status', iri))
        # point list without a header
        await pg.evaluate('''async (txt) => { const dt = new DataTransfer(); dt.items.add(new File([txt], 'F_Sensorpoints.txt', { type: 'text/plain' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }''', open(f'{FX}/F_Sensorpoints.txt').read())
        await pg.wait_for_timeout(800)
        print('table', await pg.evaluate('window.__kgov.tables.filter(t => t.name.startsWith("F_")).map(t => [t.hasHeader, t.headerMode, t.header, t.rows.length, t.rows[0]])'))
        await pg.locator('.sb-tab.table', has_text='F_Sensorpoints').click(); await pg.wait_for_timeout(400)
        print('first row', await pg.inner_text('.tv2-row[data-row="0"]'))
        await pg.locator('.tv2-pick').count()
        await pg.locator('.tv2-row[data-row="0"] td.rn').click(); await pg.wait_for_timeout(150)
        await pg.get_by_role('button', name='Ignore this row').click(); await pg.wait_for_timeout(150)
        await pg.locator('.tv2-hdr input').check(); await pg.wait_for_timeout(300)
        print('as header', await pg.evaluate('(() => { const t = window.__kgov.tables.find(t => t.name.startsWith("F_")); return [t.hasHeader, t.header, t.rows.length, t.ignore]; })()'))
        await pg.locator('.tv2-hdr input').uncheck(); await pg.wait_for_timeout(300)
        print('back', await pg.evaluate('(() => { const t = window.__kgov.tables.find(t => t.name.startsWith("F_")); return [t.hasHeader, t.header, t.rows.length, t.ignore]; })()'))
        await pg.screenshot(path=f'{OUT}/311_noheader.png')
        await pg.click('#modalFoot .btn.primary')
        # .ttl refused inside Claude: offered as zip
        await pg.evaluate('window.__mock.strictExt = true')
        await pg.click('#btnExport'); await pg.wait_for_timeout(200)
        btn = pg.locator('#menuExport button', has_text='Refined graph')
        if not await btn.count(): btn = pg.locator('[role=menu]:visible button', has_text='.ttl')
        await btn.first.click(); await pg.wait_for_timeout(600)
        print('dialog', (await pg.inner_text('#modalBody'))[:500].replace('\n', ' | '))
        print('buttons', await pg.evaluate('[...document.querySelectorAll("#modalFoot button")].map(b => b.textContent)'))
        async with pg.expect_download() as dlw:
            await pg.locator('#modalFoot button', has_text='Try direct').click()
        d = await dlw.value
        print('direct download', d.suggested_filename, open(await d.path(), 'rb').read()[:40])
        await pg.locator('#modalFoot button', has_text='Package (.zip)').click(); await pg.wait_for_timeout(1200)
        sv = await pg.evaluate('(async () => { const s = window.__mock.saved.at(-1); const buf = new Uint8Array(await s.blob.arrayBuffer()); let bin = ""; for (const x of buf) bin += String.fromCharCode(x); return [s.filename, btoa(bin)]; })()')
        z = zipfile.ZipFile(io.BytesIO(base64.b64decode(sv[1])))
        print('package', sv[0], z.namelist(), z.testzip())
        print('readme', z.read('README.txt').decode()[:200].replace('\n', ' | '))
        # resolve dialog: editable comments, bundles, total comment last
        await pg.evaluate('''() => { const S = window.__kgov, ks = [...S.G.nodes.keys()].filter(k => S.anchors.has(k)).slice(0, 3);
            ks.forEach((k, i) => { S.qa.nodes[k] = { status: 'issue', note: 'note ' + i, at: new Date().toISOString() }; }); }''')
        if not await pg.locator('#issues .itools >> text=Resolve with Claude').is_visible(): await pg.click('#btnIssues')
        await pg.wait_for_timeout(300)
        await pg.click('#issues .itools >> text=Resolve with Claude'); await pg.wait_for_timeout(400)
        tas = pg.locator('#modalBody .rs-note')
        print('editable comments', await tas.count())
        await tas.nth(0).fill('This is not a room but a title on the diagram. Delete it.'); await tas.nth(0).dispatch_event('change')
        sels = pg.locator('#modalBody .rs-bsel')
        await sels.nth(1).select_option('+'); await pg.wait_for_timeout(100)
        await pg.locator('#modalBody .rs-bsel').nth(2).select_option('A'); await pg.wait_for_timeout(100)
        await pg.locator('#modalBody .rs-bundle textarea').fill('One duct run drawn in pieces')
        await pg.locator('#modalBody textarea.note:not(.rs-note):not(.rs-bundle textarea)').last.fill('Be conservative')
        order = await pg.evaluate('[...document.querySelectorAll("#modalBody > *")].map(e => e.className || e.tagName)')
        print('order', order)
        await pg.screenshot(path=f'{OUT}/312_resolve.png')
        print('saved comment', await pg.evaluate('Object.values(window.__kgov.qa.nodes).map(r => r.note)'))
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot").innerText.includes("Review the fixes") || document.querySelector("#modalFoot").innerText.includes("Back to")', timeout=30000)
        pr = await pg.evaluate('window.__mock.prompts.at(-1)')
        print('prompt bundle', 'Bundle A (I2, I3): "One duct run drawn in pieces"' in pr, '| edited', 'title on the diagram' in pr, '| total', 'Be conservative' in pr)
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
