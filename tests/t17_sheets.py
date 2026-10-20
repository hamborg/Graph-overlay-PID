import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'
ST = '''() => { const S = window.__kgov; return { sheets: S.sheets.map(s => [s.title || s.drawing.name, s.role, s.anchors.size]), idx: S.sheetIdx, tables: S.tables.map(t => [t.name, t.rows.length]),
  doors: S.doors.map(d => d.a.split('/').pop() + '→' + (d.sheet.title || d.sheet.drawing.name) + ':' + d.targets.map(t => t.split('/').pop()).join(',')), trail: S.trail.length, arrival: S.arrival && S.arrival.iri.split('/').pop() }; }'''
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.wait_for_timeout(500)
        print('start', await pg.evaluate(ST))
        print('sheetbar', (await pg.inner_text('#sheetbar')).replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/170_start.png')
        # click a door
        r = await pg.evaluate('() => { const S = window.__kgov, v = document.querySelector("#viewport").getBoundingClientRect(); const d = S.doorRects[0]; return d ? [d.x + d.w / 2 + v.left, d.y + d.h / 2 + v.top, d.door.a.split("/").pop()] : null; }')
        print('door rect', r)
        if not r:
            await pg.evaluate('() => window.__kgov')
        else:
            await pg.mouse.move(r[0], r[1]); await pg.wait_for_timeout(200)
            print('door tip', (await pg.inner_text('#tip')).replace('\n', ' | ')[:200])
            await pg.mouse.click(r[0], r[1]); await pg.wait_for_timeout(1500)
            print('after hop', await pg.evaluate(ST))
            print('sheetbar', (await pg.inner_text('#sheetbar')).replace('\n', ' | '))
            await pg.screenshot(path=f'{OUT}/171_hop.png')
            # evidence
            await pg.click('#btnEvidence'); await pg.wait_for_timeout(800)
            print('evidence', (await pg.inner_text('#evidence')).replace('\n', ' | ')[:500])
            await pg.screenshot(path=f'{OUT}/172_evidence.png')
            # back
            await pg.click('.sb-back'); await pg.wait_for_timeout(1500)
            print('after back', await pg.evaluate(ST))
            await pg.screenshot(path=f'{OUT}/173_back.png')
        # select supply fan and see evidence
        await pg.fill('#search', 'AHU_HTRK-VEN03_SupplyFan'); await pg.wait_for_timeout(150); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(1200)
        print('fan evidence', (await pg.inner_text('#evidence')).replace('\n', ' | ')[:600])
        await pg.screenshot(path=f'{OUT}/174_fan.png')
        await pg.fill('#search', 'AHU_HTRK-VEN03_Rotor'); await pg.wait_for_timeout(150); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(1000)
        print('rotor evidence', (await pg.inner_text('#evidence .ev-grid')).replace('\n', ' | ')[:600])
        # go to catalog via evidence card of fan
        await pg.fill('#search', 'AHU_HTRK-VEN03_HeatingCoil'); await pg.wait_for_timeout(150); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(1000)
        print('coil evidence', (await pg.inner_text('#evidence .ev-grid')).replace('\n', ' | ')[:600])
        await pg.screenshot(path=f'{OUT}/175_coil.png')
        # table viewer
        await pg.evaluate('document.querySelector("#search").blur()'); await pg.wait_for_timeout(300)
        await pg.click('.sb-tab.table'); await pg.wait_for_timeout(300)
        print('table', (await pg.inner_text('#modalBody'))[:400].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/176_table.png')
        await pg.keyboard.press('Escape')
        # undo across sheets: move a node on detail sheet, hop back, undo
        await pg.click('.sb-tab >> nth=1'); await pg.wait_for_timeout(1200)
        before = await pg.evaluate('(I) => ({...window.__kgov.anchors.get(I + "VI-TT01")})', I)
        xy = await screen_of(pg, I + 'VI-TT01')
        await pg.mouse.move(*xy); await pg.mouse.down(); await pg.mouse.move(xy[0] + 40, xy[1] + 30, steps=5); await pg.mouse.up(); await pg.wait_for_timeout(300)
        moved = await pg.evaluate('(I) => ({...window.__kgov.anchors.get(I + "VI-TT01")})', I)
        await pg.click('.sb-tab >> nth=0'); await pg.wait_for_timeout(1200)
        await pg.click('#btnUndo'); await pg.wait_for_timeout(300)
        after = await pg.evaluate('(I) => { const sh = window.__kgov.sheets[1]; return {...sh.anchors.get(I + "VI-TT01")}; }', I)
        print('undo across sheets', before['x'], moved['x'], after['x'], 'active', await pg.evaluate('window.__kgov.sheetIdx'))
        # project round trip
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-project]'); await pg.wait_for_timeout(1500)
        sv = await pg.evaluate('window.__mock.saved.at(-1)')
        proj = json.loads(sv['data'])
        print('project', sv['filename'], len(sv['data']), [s['name'] for s in proj.get('sheets', [])], [t['name'] for t in proj.get('tables', [])], bool(proj['drawing'].get('dataUrl')))
        open(f'{FX}/t17.project.json', 'w').write(sv['data'])
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
