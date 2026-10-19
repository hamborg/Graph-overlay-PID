import asyncio, sys, time
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
async def pick(pg, act, files):
    await pg.click('#btnOpen')
    async with pg.expect_file_chooser() as fc:
        await pg.click(f'#menuOpen button[data-act={act}]')
    await (await fc.value).set_files(files)
    await pg.wait_for_timeout(200)
    await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000)
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p)
        await wait_ready(pg)
        t0 = time.time()
        await pick(pg, 'open-drawing', [f'{FX}/diagram_big.png'])
        await pick(pg, 'open-graph', [f'{FX}/big.ttl'])
        await pg.wait_for_function('window.__kgov.G.nodes.size > 2000')
        print('load+build s', round(time.time() - t0, 2), await pg.evaluate('[window.__kgov.G.nodes.size, window.__kgov.G.edges.length, window.__kgov.groups.length, window.__kgov.vis.size]'))
        ms = await pg.evaluate('''async () => { const r = document.querySelector('#viewport').getBoundingClientRect(); const times = [];
           for (let i = 0; i < 20; i++) { const t = performance.now(); document.querySelector('#viewport').dispatchEvent(new WheelEvent('wheel', {deltaY: i < 10 ? -120 : 120, clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles: true, cancelable: true}));
             await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))); times.push(performance.now() - t); }
           times.sort((a,b)=>a-b); return [times[0], times[10], times[19]]; }''')
        print('frame ms (min/med/max over 2 rAF):', [round(x, 1) for x in ms])
        t = await pg.evaluate('''async () => { const t = performance.now(); document.querySelector('label:has(input[value=full])').click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; }''')
        print('scope toggle rebuild ms', round(t, 1))
        await pg.screenshot(path=f'{OUT}/50_big.png')
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l][:5])
        await b.close()
asyncio.run(main())
