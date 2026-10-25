import asyncio, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
CK = '() => { const S = window.__kgov; S.checkViewOnly = false; renderChecksHook && 0; return null; }'
SUM = '() => (window.__kgov.checks || []).map(c => c.id + ":" + c.items.length).join(" ")'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        # the whole-project reports: untick "only this view"
        cb = pg.locator('#checks .ck-tools input[type=checkbox]')
        if await cb.is_checked(): await cb.uncheck(); await pg.wait_for_timeout(300)
        a = await pg.evaluate(SUM)
        print('sheet 1', a)
        await pg.locator('.sb-tab', has_text='AHU-01 detail').click(); await pg.wait_for_timeout(1200)
        b2 = await pg.evaluate(SUM)
        print('sheet 2', b2, '| same', a == b2)
        # decide one low-confidence item on sheet 2, back to sheet 1: still decided
        it = await pg.evaluate('(() => { const c = window.__kgov.checks.find(c => c.id === "unplaced"); return c && c.items[0] ? c.items[0].iri : null; })()')
        print('unplaced item', it and it.split('/')[-1])
        await pg.evaluate('(i) => { const S = window.__kgov; S.qa.checks = S.qa.checks || {}; S.qa.checks["unplaced|" + i] = { status: "ok", title: "x", at: "" }; }', it)
        await pg.locator('.sb-tab', has_text='VEN03 overview').click(); await pg.wait_for_timeout(1200)
        print('still decided on sheet 1', await pg.evaluate('(i) => (window.__kgov.qa.checks["unplaced|" + i] || {}).status', it))
        # instances dialog: sheets can be ticked for instances marked "not on it"
        await pg.evaluate('(i) => { const S = window.__kgov; for (const sh of S.sheets) sh.off.add(i); }', it)
        await pg.click('#btnCoverage'); await pg.wait_for_timeout(400)
        await pg.locator('.tv2-tools .chips button', has_text='All').click(); await pg.wait_for_timeout(200)
        await pg.fill('.tv2-tools input[type=search]', it.split('/')[-1]); await pg.wait_for_timeout(200)
        await pg.locator('.cv-row').first.click(); await pg.wait_for_timeout(200)
        print('sheet boxes', (await pg.inner_text('.cv-sheets')).replace('\n', ' | '), '| disabled', await pg.evaluate('[...document.querySelectorAll(".cv-sheets input")].map(i => i.disabled)'))
        await pg.locator('.cv-sheets input').nth(1).check()
        print('ticked', await pg.locator('.cv-sheets input').nth(1).is_checked())
        # all its triples -> close -> back to the instances dialog with the same choice
        await pg.locator('.cv-panel button', has_text='All its triples').click(); await pg.wait_for_timeout(300)
        print('triples title', await pg.inner_text('#modalTitle'))
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(300)
        print('back to', await pg.inner_text('#modalTitle'), '| filter kept', await pg.input_value('.tv2-tools input[type=search]'), '| chosen', await pg.inner_text('.cv-panel .tv2-title'))
        await pg.locator('.cv-panel button', has_text='All its triples').click(); await pg.wait_for_timeout(300)
        await pg.click('#modalClose'); await pg.wait_for_timeout(300)
        print('x goes back too', await pg.inner_text('#modalTitle'), await pg.is_visible('#modal'))
        await pg.click('#modalClose'); await pg.wait_for_timeout(300)
        print('then closes', await pg.is_visible('#modal'))
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
