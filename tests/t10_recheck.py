import asyncio, sys, json, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
async def screen_world(pg, x, y):
    return await pg.evaluate('([x, y]) => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(); return [x * S.view.s + S.view.tx + r.left, y * S.view.s + S.view.ty + r.top]; }', [x, y])
MIX = '() => [window.__kgov.settings.mix, document.querySelector("#ov").style.opacity, document.querySelector("#drawing").style.opacity, document.querySelector("#mixD").textContent, document.querySelector("#mixG").textContent]'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        # ---- fader
        print('mix start', await pg.evaluate(MIX))
        for v in [-40, 5, -6, 60, -100]:
            await pg.evaluate("(v) => { const r = document.querySelector('#mix'); r.value = v; r.dispatchEvent(new Event('input')); }", v)
            print(f'mix set {v}:', await pg.evaluate(MIX))
        await pg.dblclick('#mix'); print('dblclick', await pg.evaluate(MIX))
        await pg.click('#mixGraphBtn'); print('graph-only btn', await pg.evaluate(MIX))
        await pg.screenshot(path=f'{OUT}/90_graph_only.png')
        await pg.click('#mixGraphBtn'); print('graph btn again', await pg.evaluate(MIX))
        # ---- area mode
        await pg.click('#btnRecheck'); await pg.wait_for_timeout(250)
        print('area mode', await pg.evaluate('[window.__kgov.areaMode, window.__kgov.settings.mix, Math.round(window.__kgov._unit), document.querySelector("#areabar").innerText.replace(/\\n/g, " | ")]'))
        for (x, y) in [(3560, 330), (4560, 4150), (1900, 2900), (6000, 2000)]:
            pt = await screen_world(pg, x, y); await pg.mouse.click(*pt); await pg.wait_for_timeout(120)
        pt = await screen_world(pg, 6000, 2000); await pg.mouse.click(*pt); await pg.wait_for_timeout(120)   # toggles the 4th off
        await pg.mouse.move(*(await screen_world(pg, 5200, 1200))); await pg.wait_for_timeout(150)
        print('areas', await pg.evaluate('window.__kgov.areas.map(a => [a.id, a.x, a.y, a.s])'))
        await pg.screenshot(path=f'{OUT}/91_area_mode.png')
        await pg.click('.areabar .ab-size button[aria-label="Larger areas"]'); await pg.wait_for_timeout(100)
        print('size+', await pg.evaluate('[window.__kgov.areaFactor, window.__kgov.areas[0].s]'))
        await pg.click('.areabar .ab-size button[aria-label="Smaller areas"]')
        # zoom in on A1 to show torch effect
        await pg.mouse.move(*(await screen_world(pg, 3560, 330)))
        for _ in range(3): await pg.mouse.wheel(0, -400); await pg.wait_for_timeout(80)
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/92_area_zoom.png')
        await pg.click('#zFit'); await pg.wait_for_timeout(200)
        # ---- run
        await pg.click('.areabar .btn.primary'); await pg.wait_for_timeout(300)
        print('modal:', (await pg.inner_text('#modalBody'))[:500].replace('\n', ' | '))
        await pg.fill('#modalBody textarea', 'Check the dampers in RK1.03')
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot").innerText.includes("Show findings")', timeout=30000)
        print('run log:', await pg.inner_text('.runlog'))
        m = await pg.evaluate('() => ({ opts: window.__mock.opts.at(-1), plen: window.__mock.prompts.at(-1).length })')
        print('mock call', m)
        open(f'{OUT}/prompt_recheck.txt', 'w').write(await pg.evaluate('window.__mock.prompts.at(-1)'))
        imgs = await pg.evaluate('window.__mock.images')
        for i, d in enumerate(imgs): open(f'{OUT}/rc_{i:02d}.png', 'wb').write(base64.b64decode(d.split(',')[1]))
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(400)
        print('after run', await pg.evaluate('[window.__kgov.areaMode, window.__kgov.settings.mix, window.__kgov.findings.length, window.__kgov.findings.map(f => f.type + ":" + (f.iri||f.fromIri||f.proposedId||"").split("/").pop())]'))
        await pg.screenshot(path=f'{OUT}/93_findings.png')
        # accept each finding type
        snapq = '() => { const S = window.__kgov; return { st: S.findings.map(f => f.type[0] + f.type.split("_")[1][0] + ":" + f.status), qaN: Object.keys(S.qa.nodes).length, qaE: Object.keys(S.qa.edges).length, undo: S.undo.length }; }'
        await accept_open_findings(pg)
        print('after accepting all', await pg.evaluate(snapq))
        fid = await pg.evaluate('window.__kgov.findings.find(f => f.type === "misplaced_anchor")')
        print('moved anchor', await pg.evaluate('(iri) => window.__kgov.anchors.get(iri)', fid['iri']), 'proposed', fid['x'], fid['y'])
        await pg.click('#btnUndo'); await pg.wait_for_timeout(200)
        print('undo last accept', await pg.evaluate(snapq))
        await pg.click('#btnRedo'); await pg.wait_for_timeout(200)
        print('redo', await pg.evaluate(snapq))
        # dismiss + reopen one via undo chain
        await pg.screenshot(path=f'{OUT}/94_findings_accepted.png')
        # show a finding
        fid0 = await pg.evaluate('window.__kgov.findings[0].id')
        await pg.click('#issues >> text=Open'); await open_card(pg, 'f:' + fid0); await pg.wait_for_timeout(500)
        print('card focus', await pg.evaluate('[window.__kgov.issueSel, window.__kgov.focus && window.__kgov.focus.kind, window.__kgov.focus && window.__kgov.focus.set.size]'))
        await pg.screenshot(path=f'{OUT}/95_show_finding.png')
        # corrections
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-corrections]'); await pg.wait_for_timeout(300)
        if (await pg.inner_text('#modalTitle')) == 'Nothing applied yet': await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(500)
        sp = await pg.input_value('#modal textarea')
        open(f'{OUT}/corrections.txt', 'w').write(sp)
        print('sparql head:\n' + sp[:1800])
        await pg.keyboard.press('Escape')
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-layout]'); await pg.wait_for_timeout(300)
        lay = json.loads((await pg.evaluate('window.__mock.saved.at(-1)'))['data'])
        print('layout has findings', len(lay.get('findings', [])), len(lay.get('recheckRuns', [])))
        # undo the whole run
        while await pg.evaluate('window.__kgov.undo.length'):
            await pg.click('#btnUndo'); await pg.wait_for_timeout(80)
        print('all undone', await pg.evaluate('[window.__kgov.findings.length, window.__kgov.recheckRuns.length, Object.keys(window.__kgov.qa.nodes).length]'))
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l][:8])
        await b.close()
        # ---- phone
        b, pg, logs = await open_page(p, vw=360, vh=780, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        print('phone mixer', await pg.evaluate('(() => { const r = document.querySelector("#mixer").getBoundingClientRect(); const z = document.querySelector(".zoombar").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(z.left)]; })()'))
        await pg.click('#btnMore'); await pg.click('#mRecheck'); await pg.wait_for_timeout(250)
        for (x, y) in [(3560, 330), (1900, 2900)]:
            pt = await screen_world(pg, x, y); await pg.mouse.click(*pt); await pg.wait_for_timeout(120)
        await pg.screenshot(path=f'{OUT}/96_phone_area.png')
        print('phone areabar', await pg.evaluate('(() => { const r = document.querySelector("#areabar").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; })()'), await pg.evaluate('window.__kgov.areas.length'))
        await pg.click('.areabar .btn.primary'); await pg.wait_for_timeout(200)
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot").innerText.includes("Show findings")', timeout=30000)
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{OUT}/97_phone_findings.png')
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l][:8])
        await b.close()
asyncio.run(main())
