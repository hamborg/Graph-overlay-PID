import asyncio, sys, json, os, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]; R = FX + '/repl'
DROP = '''async ([names, datas]) => { const dt = new DataTransfer();
  for (let i = 0; i < names.length; i++) { const b = Uint8Array.from(atob(datas[i]), c => c.charCodeAt(0)); dt.items.add(new File([b], names[i], { type: names[i].endsWith('.png') ? 'image/png' : names[i].endsWith('.csv') ? 'text/csv' : 'text/turtle' })); }
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }'''
def enc(paths): return [[os.path.basename(p) for p in paths], [base64.b64encode(open(p, 'rb').read()).decode() for p in paths]]
ST = '''() => { const S = window.__kgov, P = S.sheets[0]; const a = P.anchors.get("https://example.org/htrk-ven03/id/AHU_HTRK-VEN03_SupplyFan");
  const det = S.sheets.find(s => /ahu_detail/.test(s.drawing.name)); const t = S.tables[0];
  return { key: S.key, main: [P.drawing.name, P.drawing.w, P.drawing.h, P.anchors.size, a && [a.x, a.y]], ds: !!localStorage.getItem("kgov:ds:" + S.key),
    det: det && [det.drawing.name, det.id === det.drawing.hash + ":p1", det.anchors.size, !!localStorage.getItem("kgov:sheet:" + det.id)],
    imgs: S.ctxImages.map(i => i.name), table: t && [t.name, t.rows.length, t.rows[0][0], Object.keys(t.links).map(r => t.rows[r][0]), Object.keys(t.flags).map(r => t.rows[r][0])] }; }'''
async def manage(pg):
    await pg.click('#btnOpen'); await pg.click('#menuOpen button[data-act=manage-artifacts]'); await pg.wait_for_timeout(500)
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc: await pg.click('#menuOpen button[data-act=add-graph]')
        await (await fc.value).set_files(f'{FX}/product.ttl'); await answer_graph(pg, 'add'); await pg.wait_for_timeout(2000)
        # point list: link a row by hand and report another, so we can follow them
        await pg.evaluate('''() => { const S = window.__kgov, t = S.tables[0]; t.links[2] = ["https://example.org/htrk-ven03/id/AHU_HTRK-VEN03_SupplyFan"]; t.flags[3] = { note: "wrong", at: "x" }; }''')
        s0 = await pg.evaluate(ST); print('start', json.dumps(s0))
        # 1. replace the main drawing with a half-size version → asked → scale
        await manage(pg)
        print('replace buttons', await pg.locator('#modalBody .irepl').count())
        async with pg.expect_file_chooser() as fc: await pg.locator('#modalBody .imgrow', has_text='01_diagram.png').locator('.irepl').click()
        await (await fc.value).set_files(f'{R}/01_diagram_half.png'); await pg.wait_for_timeout(1500)
        print('size question', (await pg.inner_text('.gm')).replace('\n', ' | ')[:260])
        await pg.click('.gm-opt[data-choice=scale]'); await pg.wait_for_timeout(2500)
        print('dialog row now', await pg.locator('#modalBody .imgrow b.mono').first.inner_text())
        # 2. replace the detail sheet with an edited copy of the same size → no question
        async with pg.expect_file_chooser() as fc: await pg.locator('#modalBody .imgrow', has_text='03_ahu_detail.png').locator('.irepl').click()
        await (await fc.value).set_files(f'{R}/03_ahu_detail.png'); await pg.wait_for_timeout(2000)
        print('question shown', await pg.locator('.gm').count())
        # 3. replace the point list
        async with pg.expect_file_chooser() as fc: await pg.locator('#modalBody .imgrow', has_text='05_point_list').locator('.irepl').click()
        await (await fc.value).set_files(f'{R}/05_point_list.csv'); await pg.wait_for_timeout(1200)
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(1200)
        s1 = await pg.evaluate(ST); print('after replace', json.dumps(s1))
        await pg.screenshot(path=f'{OUT}/390_replaced.png')
        # 4. same name dropped: legend → rename and add; again → keep; point list → use the new one (already same content)
        await pg.evaluate(DROP, enc([f'{R}/02_legend.png'])); await pg.wait_for_timeout(700)
        print('clash prompt', (await pg.inner_text('.gm')).replace('\n', ' | ')[:300])
        await pg.screenshot(path=f'{OUT}/391_clash.png')
        await pg.fill('.gm-name', 'legend v2.png'); await pg.click('.gm-opt[data-choice=rename]'); await pg.wait_for_timeout(1200)
        if await pg.locator('#modal:not([hidden]) #modalFoot .btn.primary').count(): await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(1200)
        print('images after rename', await pg.evaluate('window.__kgov.ctxImages.map(i => i.name)'))
        await pg.evaluate(DROP, enc([f'{R}/02_legend.png'])); await pg.wait_for_timeout(700)
        await pg.click('.gm-opt[data-choice=keep]'); await pg.wait_for_timeout(800)
        print('images after keep', await pg.evaluate('window.__kgov.ctxImages.map(i => i.name)'), 'modal open', await pg.evaluate('!document.querySelector("#modal").hidden'))
        await pg.evaluate(DROP, enc([f'{R}/02_legend.png'])); await pg.wait_for_timeout(700)
        await pg.click('.gm-opt[data-choice=replace]'); await pg.wait_for_timeout(1200)
        print('images after replace', await pg.evaluate('window.__kgov.ctxImages.map(i => [i.name, i.role])'))
        # 5. reload: everything kept
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1500)
        s2 = await pg.evaluate(ST); print('after reload', json.dumps(s2))
        # 6. project file round trip keeps report decisions and guests
        await pg.evaluate('''() => { const S = window.__kgov; S.qa.checks = S.qa.checks || {}; S.qa.checks["open|https://example.org/htrk-ven03/id/X"] = { status: "ok", at: "t" }; S.sheets[0].guests = { "https://example.org/htrk-ven03/id/VI-TT01": { x: 100, y: 120 } }; }''')
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-project]'); await pg.wait_for_timeout(1500)
        proj = await pg.evaluate('window.__mock.saved.at(-1)'); open(f'{OUT}/p.project.json', 'w').write(proj['data'])
        await b.close()
        b, pg, logs2 = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc: await pg.click('#menuOpen button[data-act=open-project]')
        await (await fc.value).set_files(f'{OUT}/p.project.json'); await pg.wait_for_timeout(4000)
        print('project reopened', json.dumps(await pg.evaluate(ST)))
        print('decisions + guests', await pg.evaluate('[Object.keys(window.__kgov.qa.checks || {}).length, Object.keys(window.__kgov.sheets[0].guests || {}).map(i => i.split("/").pop())]'))
        print('LOGS', [l for l in logs + logs2 if ('error' in l.lower() and 'ERR_' not in l and '404' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
