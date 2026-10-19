import asyncio, json, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
async def main():
    async with async_playwright() as p:
        # no window.claude: anchor modal must explain absence
        b, pg, logs = await open_page(p, vw=1280, vh=800, color_scheme='dark')
        await wait_ready(pg)
        await pg.screenshot(path=f'{OUT}/30_dark.png')
        await pg.click('#btnAnchor'); await pg.wait_for_timeout(400)
        print('modal no-claude:', (await pg.inner_text('#modalBody'))[-330:].replace('\n', ' | '), 'run disabled:', await pg.is_disabled('#modalFoot .btn.primary'))
        await pg.screenshot(path=f'{OUT}/31_modal_noclaude.png')
        await pg.keyboard.press('Escape')
        await pg.click('#btnHelp'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f'{OUT}/32_help.png')
        await pg.keyboard.press('Escape')
        await pg.click('#btnLegend'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/33_legend.png')
        # export without downloads capability -> text modal fallback
        await pg.click('#lgClose')
        async with pg.expect_download() as dl:
            await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-qa]')
        print('direct download outside Claude:', (await dl.value).suggested_filename)
        # invert drawing
        await pg.check('#optInvert'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f'{OUT}/34_dark_inverted.png')
        await pg.uncheck('#optInvert')
        await b.close()
        # mobile
        b, pg, logs2 = await open_page(p, vw=390, vh=844)
        await wait_ready(pg)
        sw = await pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]')
        print('mobile scrollWidth/clientWidth', sw)
        await pg.screenshot(path=f'{OUT}/40_mobile.png')
        await pg.click('#btnPanel'); await pg.wait_for_timeout(350)
        await pg.screenshot(path=f'{OUT}/41_mobile_panel.png')
        await pg.click('.scrim', position={'x': 370, 'y': 400}); await pg.wait_for_timeout(300)
        # tap a node
        pt = await screen_of(pg, 'https://example.org/htrk-ven03/id/AHU_HTRK-VEN03')
        await pg.mouse.click(*pt); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f'{OUT}/42_mobile_inspector.png')
        print('mobile insp visible', await pg.is_visible('#insp'))
        print('LOGS', [l for l in logs + logs2 if 'ERR_FAILED' not in l][:10])
        await b.close()
asyncio.run(main())
