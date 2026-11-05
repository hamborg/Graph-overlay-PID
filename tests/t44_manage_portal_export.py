import asyncio, sys, json, base64, io, zipfile
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'
async def pick(pg, act, files):
    await pg.click('#btnOpen')
    async with pg.expect_file_chooser() as fc:
        await pg.click(f'#menuOpen button[data-act={act}]')
    await (await fc.value).set_files(files)
    if any(str(f).endswith('.ttl') for f in files): await answer_graph(pg, 'add')
    await pg.wait_for_timeout(300)
    await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000)
    await pg.wait_for_timeout(500)
async def zipnames(pg):
    b64 = await pg.evaluate('async () => { const s = window.__mock.saved.at(-1); const b = new Uint8Array(await s.blob.arrayBuffer()); let t = ""; for (let i = 0; i < b.length; i += 32768) t += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return [s.filename, btoa(t)]; }')
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64[1])))
    return b64[0], z.namelist(), z
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        # 1. nothing in the triples is left out
        await pick(pg, 'add-graph', [f'{FX}/hidden_bits.ttl'])
        st = await pg.evaluate('''(I) => { const G = window.__kgov.G; const e = G.edges.filter(e => /seeAlso|monitoredBy/.test(e.p)).map(e => e.p.split(/[#/]/).pop() + ':' + e.cat);
          return { files: G.files, logger: G.nodes.has(I + 'Untyped_Logger_01'), lonely: G.nodes.has(I + 'Lonely_Thing'), edges: e }; }''', I)
        print('hidden bits', st)
        assert st['logger'] and st['lonely'] and 'seeAlso:annotation' in st['edges'] and any(x.startswith('monitoredBy:') for x in st['edges']), st
        cats = await pg.inner_text('#cats'); assert 'Annotation' in cats; print('cats has Annotation')
        # 2. manage graphs: remove one, put it back
        await pg.click('#sources .linkbtn'); await pg.wait_for_timeout(300)
        print('manager', (await pg.inner_text('#modalBody')).replace('\n', ' | ')[:400])
        await pg.locator('.gmg-row', has_text='hidden_bits.ttl').locator('.btn.danger').click(); await pg.wait_for_timeout(200)
        print('confirm', (await pg.inner_text('#modalBody')).replace('\n', ' | ')[:300])
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_function('document.querySelector("#busy").hidden'); await pg.wait_for_timeout(800)
        st = await pg.evaluate('(I) => ({ files: window.__kgov.G.files, logger: window.__kgov.G.nodes.has(I + "Untyped_Logger_01"), rows: document.querySelectorAll(".gmg-row").length })', I)
        print('after remove', st); assert len(st['files']) == 2 and not st['logger'] and st['rows'] == 2
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(200)
        await pg.click('#toasts .toast button:has-text("Put it back")'); await pg.wait_for_function('document.querySelector("#busy").hidden'); await pg.wait_for_timeout(800)
        st = await pg.evaluate('(I) => ({ files: window.__kgov.G.files, logger: window.__kgov.G.nodes.has(I + "Untyped_Logger_01") })', I)
        print('put back', st); assert len(st['files']) == 3 and st['logger']
        # 3. a side diagram works like the main one: drag an instance there, it moves on that sheet
        if not await pg.evaluate('window.__kgov.frames.some(f => /ahu_detail/.test(f.sh.drawing.name))'):
            await pg.locator('.sb-chip', has_text='AHU-01 detail').locator('.sb-chip-main').click(); await pg.wait_for_timeout(1200)
        if not await pg.evaluate('window.__kgov.frames.some(f => /ahu_detail/.test(f.sh.drawing.name) && f.win)'):
            await pg.locator('.bchrome', has_text='AHU-01 detail').locator('.bc-win').click(); await pg.wait_for_timeout(600)
        w = await pg.evaluate('''() => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(); const h = S.winHits.find(w => /ahu_detail/.test(w.f.sh.drawing.name) && w.x > 80 && w.y > 200 && w.x < r.width - 80 && w.y < r.height - 80); return h && [h.x + r.left, h.y + r.top, h.iri, {...h.f.sh.anchors.get(h.iri)}, S.anchors.get(h.iri) ? {...S.anchors.get(h.iri)} : null]; }''')
        print('window hit', w and [w[2].split('/')[-1], w[3]])
        assert w
        await pg.mouse.move(w[0], w[1]); await pg.mouse.down(); await pg.mouse.move(w[0] + 20, w[1] + 15, steps=4); await pg.mouse.move(w[0] + 40, w[1] + 30, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(500)
        after = await pg.evaluate('''(iri) => { const S = window.__kgov, sh = S.sheets.find(s => /ahu_detail/.test(s.drawing.name)); return [{...sh.anchors.get(iri)}, S.anchors.get(iri) ? {...S.anchors.get(iri)} : null]; }''', w[2])
        print('moved on that sheet', w[3], '->', after[0], '| main', after[1])
        assert after[0]['source'] == 'manual' and (after[0]['x'], after[0]['y']) != (w[3]['x'], w[3]['y']) and after[1] == w[4]
        await pg.screenshot(path=f'{OUT}/440_window_drag.png')
        await pg.click('#btnUndo'); await pg.wait_for_timeout(400)
        back = await pg.evaluate('''(iri) => { const sh = window.__kgov.sheets.find(s => /ahu_detail/.test(s.drawing.name)); return {...sh.anchors.get(iri)}; }''', w[2])
        print('undo', back); assert (back['x'], back['y']) == (w[3]['x'], w[3]['y'])
        # click a window instance chooses it
        await pg.mouse.click(w[0], w[1]); await pg.wait_for_timeout(400)
        sel = await pg.evaluate('window.__kgov.selection'); print('chosen', [x.split('/')[-1] for x in sel]); assert w[2] in sel
        await pg.keyboard.press('Escape')
        # 4. everything in one zip
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-package]'); await pg.wait_for_timeout(3000)
        name, names, z = await zipnames(pg)
        print('package', name, len(names)); print('\n'.join(sorted(names)))
        top = [n for n in names if '/' not in n]
        assert any(n.endswith('.refined.ttl') for n in top) and any(n.endswith('.project.json') for n in top) and 'README.txt' in top and len(top) == 3, top
        for need in ['graph/original/', 'graph/', 'review/', 'anchoring/', 'artifacts/']: assert any(n.startswith(need) for n in names), need
        assert any(n.endswith('.corrections.sparql') for n in names) and any(n.endswith('.changelog.csv') for n in names) and any(n.endswith('.review.csv') for n in names)
        proj = json.loads(z.read([n for n in top if n.endswith('.project.json')][0]))
        print('project file graphs', [g['name'] for g in proj['graphs']])
        # 5. artifacts only
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-artifacts]'); await pg.wait_for_timeout(2000)
        name, names, z = await zipnames(pg)
        print('artifacts', name, sorted(names))
        assert 'artifacts.csv' in names and any(n.endswith('.png') for n in names) and any(n.endswith('.csv') and 'point' in n for n in names)
        # 6. a PDF's pages are the main view; side diagrams go around the page grid
        await pg.click('#sheetbar .sb-add >> nth=0')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuAddArt [data-act=add-artifacts]')
        await (await fc.value).set_files(f'{FX}/functional_description.pdf')
        await pg.wait_for_timeout(1500)
        if await pg.locator('#modal:not([hidden])').count(): await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(2500)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=30000)
        await pg.locator('#sheetbar .sb-tab:has-text("functional")').first.click(); await pg.wait_for_timeout(1200)
        await pg.click('.pagebar .pb-mode:has-text("12 at a time")'); await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=90000); await pg.wait_for_timeout(1200)
        await pg.locator('.sb-chip', has_text='VEN03 overview').locator('.sb-chip-main').click(); await pg.wait_for_timeout(1200)
        GEO = '''() => { const S = window.__kgov; return S.board.cells.map(c => ({ id: c.id.split(':').pop() + (c.pvSide ? '/side' : ''), c: c.c, r: c.r, page: !!c.page })); }'''
        cells = await pg.evaluate(GEO); side = [c for c in cells if c['id'].endswith('/side')]; pages = [c for c in cells if c['page']]
        print('cells', len(pages), 'pages; side', side)
        assert len(side) == 1 and side[0]['c'] == 4 and not any(p['c'] == side[0]['c'] and p['r'] == side[0]['r'] for p in pages)
        await pg.screenshot(path=f'{OUT}/441_pages_side_right.png')
        await pg.locator('.bchrome', has_text='VEN03 overview').locator('button[aria-label="Which side of the pages"]').click(); await pg.wait_for_timeout(200)
        await pg.click('#menuPageSide button[aria-label="↓ Below the pages"]'); await pg.wait_for_timeout(1200)
        side = [c for c in await pg.evaluate(GEO) if c['id'].endswith('/side')]; print('moved below', side)
        assert side[0]['r'] == 3 and side[0]['c'] == 0
        await pg.screenshot(path=f'{OUT}/442_pages_side_below.png')
        # Next keeps the side diagram where it is
        await pg.click('.pagebar .pb-step[aria-label=Next]'); await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000); await pg.wait_for_timeout(1000)
        side = [c for c in await pg.evaluate(GEO) if c['id'].endswith('/side')]; print('after next', side); assert side and side[0]['r'] == 3
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and 'favicon' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
