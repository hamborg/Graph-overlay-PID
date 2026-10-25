import asyncio, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        print('scope hint', await pg.inner_text('#scopeHint'))
        print('topbar fits', await pg.evaluate('(() => { const t = document.querySelector("header.top, .topbar, header"); return t ? t.scrollWidth <= t.clientWidth + 1 : null; })()'))
        await pg.click('#btnCoverage'); await pg.wait_for_timeout(500)
        print('summary', await pg.inner_text('.cv-sum'))
        print('chips', (await pg.inner_text('.tv2-tools .chips')).replace('\n', ' '))
        print('first rows', [ (await pg.locator('.cv-row').nth(k).inner_text()).replace('\t', ' | ').replace('\n', ' ') for k in range(min(3, await pg.locator('.cv-row').count()))])
        await pg.screenshot(path=f'{OUT}/340_coverage.png')
        # choose two with no artifact, ask Claude (mock) to suggest
        n = await pg.locator('.cv-row').count()
        if n:
            await pg.locator('.cv-row').nth(0).click(); await pg.wait_for_timeout(150)
            print('panel 1', (await pg.inner_text('.cv-panel'))[:400].replace('\n', ' | '))
            if n > 1: await pg.locator('.cv-row').nth(1).click(); await pg.wait_for_timeout(150)
            print('sheets', (await pg.inner_text('.cv-sheets')).replace('\n', ' | '))
            await pg.locator('.cv-sheets label', has_text='AHU-01 detail').locator('input').check()
            await pg.locator('.cv-panel button', has_text='Suggest placements with Claude').click()
            await pg.wait_for_function('document.querySelector(".cv-panel .runlog") && /Done|failed|available|Tick/.test(document.querySelector(".cv-panel .runlog").innerText)', timeout=60000)
            print('run log', await pg.inner_text('.cv-panel .runlog'))
            print('summary after', await pg.inner_text('.cv-sum'))
        # all filter + mark not on
        await pg.locator('.tv2-tools .chips button', has_text='All').click(); await pg.wait_for_timeout(200)
        print('all rows shown', await pg.locator('.cv-row').count())
        await pg.locator('.tv2-tools input[type=search]').fill('Duct_VI'); await pg.wait_for_timeout(200)
        print('filtered', await pg.locator('.cv-row').count())
        await pg.screenshot(path=f'{OUT}/341_all.png')
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
