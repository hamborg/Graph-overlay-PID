import asyncio, json, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
PDFJS = '/opt/npm-tools/node_modules/pdfjs-dist/legacy/build/'
async def route_pdfjs(route):
    name = route.request.url.split('/build/')[-1]
    await route.fulfill(path=PDFJS + name, headers={'content-type': 'text/javascript', 'access-control-allow-origin': '*'})
async def pick(pg, act, files):
    await pg.click('#btnOpen')
    async with pg.expect_file_chooser() as fc:
        await pg.click(f'#menuOpen button[data-act={act}]')
    await (await fc.value).set_files(files)
    await pg.wait_for_timeout(300)
    await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000)
    await pg.wait_for_timeout(500)
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await pg.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/*', route_pdfjs)
        await wait_ready(pg)
        await pick(pg, 'open-graph', [f'{FX}/vent.ttl'])
        await pick(pg, 'open-drawing', [f'{FX}/diagram_copy.png'])
        st = await pg.evaluate('() => { const S = window.__kgov; return { demo: S.isDemo, anchors: S.anchors.size, vis: S.vis.size, banner: document.querySelector("#banner").innerText, via: S.coordVia }; }')
        print('partial:', st)
        await pg.screenshot(path=f'{OUT}/20_partial.png')
        await pg.click('#banner button:has-text("Show them")'); await pg.wait_for_timeout(400)
        print('full scope margin', await pg.evaluate('window.__kgov.margin'))
        await pg.screenshot(path=f'{OUT}/21_partial_full.png')
        await pg.click('#banner button:has-text("Anchor with Claude")'); await pg.wait_for_timeout(300)
        print('modal opts:', await pg.evaluate('[...document.querySelectorAll("#modalBody .opt b")].map(b=>b.textContent)'))
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot .btn.ghost").textContent === "Close"', timeout=60000)
        print('run:', await pg.inner_text('.runlog'))
        pr = await pg.evaluate('window.__mock.prompts.at(-1)')
        print('prompt known lines:', pr.count(' @ '), 'targets:', pr.split('Instances to place (')[1].split(')')[0])
        await pg.click('#modalFoot .btn.ghost')
        st = await pg.evaluate('() => { const S = window.__kgov; const srcs={}; for (const a of S.anchors.values()) srcs[a.source]=(srcs[a.source]||0)+1; return { anchors: S.anchors.size, off: S.off.size, srcs, lowconf: [...S.anchors.values()].filter(a => a.source === "claude" && a.conf < 0.6).length }; }')
        print('after:', st)
        await pg.click('label:has(input[name=scope][value=drawing])'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/22_after_anchor.png')
        # add synthetic heating graph
        await pick(pg, 'add-graph', [f'{FX}/heating_synthetic.ttl'])
        st = await pg.evaluate('() => { const S = window.__kgov; return { files: S.G.files, nodes: S.G.nodes.size, vis: S.vis.size, anchors: S.anchors.size, sources: document.querySelector("#sources").innerText.replace(/\\n/g," ") }; }')
        print('merged:', st)
        await pg.click('label:has(input[name=scope][value=neighbours])'); await pg.wait_for_timeout(400)
        nb = await pg.evaluate('() => { const S = window.__kgov; return [...S.vis].filter(i => !S.anchors.has(i)).map(i => S.G.nodes.get(i).local + "/" + S.G.nodes.get(i).kind); }')
        print('neighbours shown:', nb)
        await pg.click('#btnHelp'); await pg.keyboard.press('Escape')
        await pg.screenshot(path=f'{OUT}/23_neighbours_heating.png')
        # select radiator -> inspector shows properties & heat link
        await pg.fill('#search', 'Radiator_RK1-03'); await pg.wait_for_timeout(150); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(600)
        print('radiator insp:', (await pg.inner_text('#insp'))[:700].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/24_radiator.png')
        await pg.keyboard.press('Escape')
        # source toggle
        await pg.click('#sources label:nth-of-type(2) input'); await pg.wait_for_timeout(300)
        print('heating off vis', await pg.evaluate('window.__kgov.vis.size'))
        await pg.click('#sources label:nth-of-type(2) input')
        # PDF drawing
        await pick(pg, 'open-drawing', [f'{FX}/drawing2p.pdf'])
        st = await pg.evaluate('() => { const S = window.__kgov; return S.drawing ? { name: S.drawing.name, w: S.drawing.w, h: S.drawing.h, pages: S.drawing.pages, page: S.drawing.page, anchors: S.anchors.size, pageSel: !document.querySelector("#pdfPage").hidden } : null; }')
        print('pdf:', st)
        await pg.screenshot(path=f'{OUT}/25_pdf.png')
        await pg.select_option('#pdfPage', '2'); await pg.wait_for_timeout(300)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000); await pg.wait_for_timeout(400)
        print('pdf p2:', await pg.evaluate('() => { const d = window.__kgov.drawing; return [d.page, d.w, d.h]; }'))
        await pg.screenshot(path=f'{OUT}/26_pdf_p2.png')
        print('LOGS', [l for l in logs if 'fonts' not in l][:20])
        await b.close()
asyncio.run(main())
