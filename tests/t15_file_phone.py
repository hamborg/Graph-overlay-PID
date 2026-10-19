import asyncio, sys, json, pathlib
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
async def main():
    async with async_playwright() as p:
        # standalone copy opened from disk: no demo, no .env fetch, load the .env by hand and remember it
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 820})
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        url = pathlib.Path(sys.argv[2]).resolve().parent.joinpath('site/test.html').as_uri()
        await pg.goto(url); await pg.wait_for_timeout(1500)
        print('setup card:', (await pg.inner_text('#empty'))[:420].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/150_file_setup.png')
        await pg.get_by_role('button', name='Set up API key (.env)…').click(); await pg.wait_for_timeout(200)
        async with pg.expect_file_chooser() as fc:
            await pg.get_by_role('button', name='Load .env file…').click()
        envf = OUT + '/claude.env'; open(envf, 'w').write('ANTHROPIC_API_KEY=sk-ant-file-0000111122223333\nCLAUDE_MODEL=claude-haiku-5-5\n')   # a fake key, written at test time
        await (await fc.value).set_files(envf); await pg.wait_for_timeout(300)
        print('status:', await pg.inner_text('#modalBody .callout'), '| model', await pg.input_value('#modalBody select'))
        await pg.locator('#modalBody input[type=checkbox]').check()
        await pg.get_by_role('button', name='Use key').click(); await pg.wait_for_timeout(300)
        print('api', await pg.evaluate('window.__kgov.api && [window.__kgov.api.model, window.__kgov.api.source]'), 'stored', await pg.evaluate('!!localStorage.getItem("kgov:api")'))
        print('setup row:', (await pg.inner_text('#empty .srow >> nth=3')).replace('\n', ' | '))
        await pg.reload(); await pg.wait_for_timeout(1200)
        print('after reload api', await pg.evaluate('window.__kgov.api && [window.__kgov.api.model, window.__kgov.api.source]'))
        # several files at once through the drawing picker: drawing + legend
        async with pg.expect_file_chooser() as fc:
            await pg.get_by_role('button', name='Open drawing…').click()
        await (await fc.value).set_files([f'{FX}/01_diagram.png', f'{FX}/02_legend.png', f'{FX}/03_title_block.png'])
        await pg.wait_for_timeout(600)
        print('open dialog roles', await pg.evaluate('[...document.querySelectorAll("#modalBody .imgrow")].map(r => r.querySelector("b").textContent + ":" + (r.querySelector(".qa-seg button.on") || {}).textContent)'))
        await pg.screenshot(path=f'{OUT}/151_open_images.png')
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(1500)
        print('after open', await pg.evaluate('[window.__kgov.drawing && window.__kgov.drawing.name, window.__kgov.legend && window.__kgov.legend.name, window.__kgov.ctxImages.map(i => i.name + ":" + i.role)]'))
        print('setup now:', (await pg.inner_text('#empty'))[:300].replace('\n', ' | '))
        print('LOGS', logs[:6])
        await b.close()
        # phone: SPARQL from the More menu
        b, pg, logs = await open_page(p, vw=390, vh=820, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#btnMore'); await pg.click('#menuMore [data-act=sparql]'); await pg.wait_for_timeout(300)
        await pg.click('#sqRun'); await pg.wait_for_timeout(500)
        print('phone sparql', await pg.evaluate('(() => { const r = document.querySelector("#sparql").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), document.querySelectorAll("#sqResults tbody tr").length]; })()'))
        await pg.screenshot(path=f'{OUT}/152_phone_sparql.png')
        await pg.locator('#sqResults tbody tr').nth(0).click(); await pg.wait_for_timeout(600)
        print('phone row -> panel closed', await pg.evaluate('[window.__kgov.rightPanel, window.__kgov.focus && window.__kgov.focus.set.size]'))
        await pg.screenshot(path=f'{OUT}/153_phone_row.png')
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l][:6])
        await b.close()
asyncio.run(main())
