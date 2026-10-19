import asyncio, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#menuOpen button[data-act=add-graph]')
        await (await fc.value).set_files([f'{FX}/sameas.ttl']); await pg.wait_for_timeout(1200)
        await pg.click('#btnSparql'); await pg.wait_for_timeout(200)
        q = 'SELECT ?p ?o WHERE { <http://ex.org/SF01> ?p ?o . FILTER(?p IN (fso:suppliesFluidTo, brick:feeds, <http://ex.org/tag>)) }'
        await pg.fill('#sqEditor', q); await pg.click('#sqRun'); await pg.wait_for_timeout(600)
        print('on :', (await pg.inner_text('#sqResults')).replace('\n', ' | ')[:400])
        print('focus', await pg.evaluate('window.__kgov.focus && [...window.__kgov.focus.set].map(i => i.split("/").pop())'))
        await pg.screenshot(path=f'{OUT}/160_sameas.png')
        await pg.fill('#sqEditor', 'SELECT ?t WHERE { inst:AHU_HTRK-VEN03_SupplyFan <http://ex.org/tag> ?t }'); await pg.click('#sqRun'); await pg.wait_for_timeout(500)
        print('alias fact on original:', (await pg.inner_text('#sqResults')).replace('\n', ' | ')[:200])
        await pg.uncheck('#sqSameAs'); await pg.wait_for_timeout(600)
        print('off:', (await pg.inner_text('#sqResults')).replace('\n', ' | ')[:200])
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:5])
        await b.close()
asyncio.run(main())
