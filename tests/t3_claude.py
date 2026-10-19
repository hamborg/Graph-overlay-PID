import asyncio, json, sys, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; DEMO = sys.argv[3]
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        # typechip width check on demo
        await pg.fill('#search', 'AHU_HTRK-VEN03_SupplyFan'); await pg.wait_for_timeout(150); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        print('chip widths', await pg.evaluate('[...document.querySelectorAll("#insp .typechips span")].map(s=>[s.textContent, Math.round(s.getBoundingClientRect().width)])'))
        await pg.keyboard.press('Escape')
        # open graph + drawing without layout
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=open-graph]')
        await (await fc.value).set_files(f'{DEMO}/HTRK-VEN03_knowledge_graph.ttl')
        await pg.wait_for_timeout(800)
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=open-drawing]')
        await (await fc.value).set_files(f'{DEMO}/01_diagram.png')
        await pg.wait_for_function('document.querySelector("#busy").hidden')
        await pg.wait_for_timeout(600)
        st = await pg.evaluate('() => { const S = window.__kgov; return { demo: S.isDemo, anchors: S.anchors.size, off: S.off.size, vis: S.vis.size, banner: document.querySelector("#banner").innerText, key: S.key }; }')
        print('fresh load:', st)
        await pg.screenshot(path=f'{OUT}/12_fresh_partial.png')
        await pg.click('label:has(input[name=scope][value=full])'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{OUT}/13_full_with_margin.png')
        await pg.click('#btnAnchor'); await pg.wait_for_timeout(400)
        print('modal:', (await pg.inner_text('#modal'))[:900].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/14_anchor_modal.png')
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot .btn.ghost").textContent === "Close"', timeout=60000)
        print('run log:', await pg.inner_text('.runlog'))
        await pg.screenshot(path=f'{OUT}/15_anchor_done.png')
        m = await pg.evaluate('() => ({ opts: window.__mock.opts, nPrompts: window.__mock.prompts.length, plen: window.__mock.prompts[0].length })')
        print('mock:', m)
        prompt = await pg.evaluate('window.__mock.prompts[0]')
        open(f'{OUT}/prompt_tiles.txt', 'w').write(prompt)
        imgs = await pg.evaluate('window.__mock.images')
        for i, d in enumerate(imgs[:20]):
            open(f'{OUT}/tile_{i:02d}.png', 'wb').write(base64.b64decode(d.split(',')[1]))
        print('images', len(imgs))
        st = await pg.evaluate('''() => { const S = window.__kgov; const srcs = {}; for (const a of S.anchors.values()) srcs[a.source]=(srcs[a.source]||0)+1; return { anchors: S.anchors.size, off: [...S.off], srcs, runs: S.runs, low: [...S.anchors.values()].filter(a=>a.conf<0.6).length, banner: !document.querySelector('#banner').hidden }; }''')
        print('after claude:', st)
        await pg.click('#modalFoot .btn.ghost')
        await pg.screenshot(path=f'{OUT}/16_after_anchor.png')
        # export layout via mocked downloads
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-layout]'); await pg.wait_for_timeout(300)
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-qa]'); await pg.wait_for_timeout(300)
        saved = await pg.evaluate('window.__mock.saved')
        for s in saved: print('saved', s['filename'], len(s['data']))
        lay = json.loads(saved[0]['data']); open(f'{OUT}/exported.overlay.json', 'w').write(saved[0]['data'])
        print('export keys', list(lay.keys()), len(lay['anchors']), lay['offDrawing'], lay['artifact'])
        print(saved[1]['data'][:300])
        # copy-prompt modal
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=copy-prompt]'); await pg.wait_for_timeout(300)
        ext = await pg.input_value('#modal textarea')
        open(f'{OUT}/prompt_external.txt', 'w').write(ext)
        print('external prompt len', len(ext), 'norm' in ext)
        await pg.keyboard.press('Escape')
        # import the exported layout with a moved anchor
        k = 'https://example.org/htrk-ven03/id/Duct_VI_04'
        lay['anchors'][k]['x'] = 100; lay['anchors'][k]['y'] = 100
        open(f'{OUT}/import_test.json', 'w').write(json.dumps(lay))
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=import-layout]')
        await (await fc.value).set_files(f'{OUT}/import_test.json')
        await pg.wait_for_timeout(500)
        print('after import', await pg.evaluate('(k) => window.__kgov.anchors.get(k)', k))
        print('LOGS', logs[:20])
        await b.close()
asyncio.run(main())
