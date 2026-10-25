import asyncio, sys, json, os
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'
PANEL = '() => document.querySelector(".tv2-panel").innerText.replace(/\\n+/g, " | ").slice(0, 600)'
CHIPS = '() => document.querySelector(".tv2-chips").innerText.replace(/\\n/g, " ")'
ROWINST = '(r) => { const tr = document.querySelector(`.tv2-row[data-row="${r}"]`); return tr ? tr.querySelector(".tv-inst").innerText : null; }'
async def row(pg, r, mod=None):
    loc = pg.locator(f'.tv2-row[data-row="{r}"] td.rn')
    if mod: await loc.click(modifiers=[mod])
    else: await loc.click()
    await pg.wait_for_timeout(150)
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.locator('.sb-tab.table').first.click(); await pg.wait_for_timeout(400)
        print('chips', await pg.evaluate(CHIPS))
        print('empty panel', await pg.evaluate(PANEL))
        await row(pg, 0)
        print('row1 panel', await pg.evaluate(PANEL))
        await pg.screenshot(path=f'{OUT}/300_row.png')
        # unlink the match, undo, redo
        await pg.locator('.tv2-panel .tv2-link', has_text='VI-TT01').first.get_by_role('button', name='Unlink').click(); await pg.wait_for_timeout(200)
        print('after unlink', await pg.evaluate(ROWINST, 0), '| unlinks', await pg.evaluate('window.__kgov.tables[0].unlinks'))
        await pg.get_by_role('button', name='↶ Undo').click(); await pg.wait_for_timeout(300)
        print('after undo', await pg.evaluate(ROWINST, 0))
        await pg.get_by_role('button', name='↷ Redo').click(); await pg.wait_for_timeout(300)
        print('after redo', await pg.evaluate(ROWINST, 0))
        # link it again via search
        await pg.fill('.tv2-pick input[type=search]', 'VI-TT'); await pg.wait_for_timeout(150)
        print('search', await pg.evaluate('[...document.querySelectorAll(".tv2-pick .tv2-res .tv2-hit")].slice(0,4).map(b => b.innerText)'))
        await pg.locator('.tv2-pick .tv2-res .tv2-hit').first.click(); await pg.wait_for_timeout(200)
        print('relinked', await pg.evaluate(ROWINST, 0), await pg.evaluate('window.__kgov.tables[0].links'))
        # time series from the row
        ts = pg.locator('.tv2-panel .tv2-ts select').first
        print('ts options', await ts.evaluate('s => [...s.options].map(o => o.text)'), 'chosen', await ts.evaluate('s => s.options[s.selectedIndex].text'))
        await pg.locator('.tv2-panel .tv2-ts button').first.click(); await pg.wait_for_timeout(400)
        print('ts after', await pg.evaluate(PANEL))
        # several rows: shift-click, one report
        await row(pg, 1); await row(pg, 2, 'Shift')
        print('multi panel', await pg.evaluate(PANEL))
        await pg.fill('.tv2-panel textarea', 'Both belong to the exhaust side'); await pg.get_by_role('button', name='Report issue').click(); await pg.wait_for_timeout(300)
        print('rules', await pg.evaluate('window.__kgov.rules.map(r => [r.kind, (r.members||[]).length, r.text.slice(0, 70)])'))
        print('chips', await pg.evaluate(CHIPS))
        # ignore one, filter
        await row(pg, 8)
        await pg.get_by_role('button', name='Ignore this row').click(); await pg.wait_for_timeout(200)
        print('ignored', await pg.evaluate('window.__kgov.tables[0].ignore'), await pg.evaluate(CHIPS))
        await pg.screenshot(path=f'{OUT}/301_multi.png')
        await pg.click('#modalFoot .btn.primary')
        # a noisy list: comment rows are found and ignored
        await pg.evaluate('''async (txt) => { const dt = new DataTransfer(); dt.items.add(new File([txt], 'noisy_points.csv', { type: 'text/csv' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }''', open(f'{FX}/noisy_points.csv').read())
        await pg.wait_for_timeout(800)
        await pg.locator('.sb-tab.table', has_text='noisy').click(); await pg.wait_for_timeout(400)
        print('junk', await pg.inner_text('.tv2-junk'))
        await pg.locator('.tv2-junk button', has_text='Ignore').click(); await pg.wait_for_timeout(200)
        print('noisy chips', await pg.evaluate(CHIPS))
        unl = await pg.evaluate('''() => [...document.querySelectorAll('.tv2-row')].filter(tr => !tr.classList.contains('ign') && !tr.querySelector('.tv2-inst')).map(tr => tr.dataset.row)''')
        print('unlinked rows', unl)
        await row(pg, int(unl[0]))
        print('unlinked panel', await pg.evaluate(PANEL))
        await pg.screenshot(path=f'{OUT}/302_noisy.png')
        await pg.click('#modalFoot .btn.primary')
        # instance card: time series under Connections for a point without one
        await pg.evaluate('(i) => { const S = window.__kgov; S.selection = [i]; S.selected = i; }', I + 'VI-PT01')
        await pg.fill('#search', 'VI-PT01'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        print('ts block', (await pg.inner_text('#insp .ts-block')).replace('\n', ' | '))
        await pg.locator('#insp .ts-block button', has_text='Add').click(); await pg.wait_for_timeout(500)
        print('ts block after', (await pg.inner_text('#insp .ts-block')).replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/303_ts.png')
        print('changes', await pg.evaluate('window.__kgov.changes.map(c => [c.id, c.type, c.title, c.ins.length])'))
        await pg.evaluate('[...document.querySelectorAll("button")].find(x => /Corrections from the change log/.test(x.textContent)).click()'); await pg.wait_for_timeout(300)
        txt = await pg.input_value('#modalBody textarea.out')
        print('sparql', [l.strip() for l in txt.split('\n') if 'ts' in l and ('_:' in l)][:4])
        await pg.keyboard.press('Escape')
        # SPARQL sees the new reference
        await pg.click('#btnSparql'); await pg.wait_for_timeout(200)
        await pg.fill('#sqEditor', 'PREFIX ref: <https://brickschema.org/schema/Brick/ref#> SELECT ?p ?id WHERE { ?p ref:hasExternalReference ?r . ?r ref:hasTimeseriesId ?id }')
        await pg.focus('#sqEditor'); await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(700)
        print('sparql result', (await pg.inner_text('#sqResults')).replace('\n', ' ')[-160:])
        # reload: list edits kept
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(800)
        print('after reload', await pg.evaluate('window.__kgov.tables.map(t => [t.name, Object.keys(t.links).length, Object.keys(t.unlinks).length, t.ignore.length, Object.keys(t.flags).length])'))
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
