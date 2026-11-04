import asyncio, sys, json, os, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]; V2 = FX + '/repl/HTRK-VEN03_knowledge_graph.v2.ttl'
DROP = '''async ([names, datas]) => { const dt = new DataTransfer();
  for (let i = 0; i < names.length; i++) { const b = Uint8Array.from(atob(datas[i]), c => c.charCodeAt(0)); dt.items.add(new File([b], names[i], { type: 'text/turtle' })); }
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }'''
def enc(paths): return [[os.path.basename(p) for p in paths], [base64.b64encode(open(p, 'rb').read()).decode() for p in paths]]
ST = '() => { const S = window.__kgov; return { graphs: S.graphs.map(g => g.name), triples: S.parsed.reduce((m, p) => m + p.quads.length, 0), nodes: S.G.nodes.size, gone: S.G.nodes.has("https://example.org/htrk-ven03/id/Duct_VU_41"), newI: S.G.nodes.has("https://example.org/htrk-ven03/id/VI-TT99"), anchors: S.anchors.size }; }'
async def main():
    async with async_playwright() as p:
        for mode in ['replace', 'patch']:
            b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
            await wait_ready(pg)
            print(mode, 'before', await pg.evaluate(ST))
            await pg.evaluate(DROP, enc([V2])); await pg.wait_for_timeout(600)
            await pg.click('.gm-opt[data-choice=replace]'); await pg.wait_for_timeout(2500)
            txt = (await pg.inner_text('.gm.rg')).replace('\n', ' | ')
            print('compare', txt[:900])
            if mode == 'replace': await pg.screenshot(path=f'{OUT}/410_compare.png')
            await pg.click(f'.gm.rg .gm-opt[data-choice={mode}]'); await pg.wait_for_timeout(3000)
            print(mode, 'after', await pg.evaluate(ST))
            if mode == 'patch':
                print('kept source', (await pg.evaluate('window.__kgov.graphs.find(g => /kept-from/.test(g.name)).text'))[:400].replace('\n', ' | '))
                print('sources panel', (await pg.inner_text('#sources')).replace('\n', ' | ')[:200])
            print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l and '404' not in l) or 'PAGEERROR' in l][:6])
            await b.close()
asyncio.run(main())
