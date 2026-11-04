import asyncio, sys, json, os, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]; V5 = FX + '/repl/HTRK-VEN03_knowledge_graph.v5.ttl'
X, Y = map(int, open(FX + '/repl/v5_xy.txt').read().split())
DROP = '''async ([names, datas]) => { const dt = new DataTransfer();
  for (let i = 0; i < names.length; i++) { const b = Uint8Array.from(atob(datas[i]), c => c.charCodeAt(0)); dt.items.add(new File([b], names[i], { type: 'text/turtle' })); }
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }'''
def enc(paths): return [[os.path.basename(p) for p in paths], [base64.b64encode(open(p, 'rb').read()).decode() for p in paths]]
I = 'https://example.org/htrk-ven03/id/'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc: await pg.click('#menuOpen button[data-act=add-graph]')
        await (await fc.value).set_files(f'{FX}/product.ttl'); await answer_graph(pg, 'add'); await pg.wait_for_timeout(2000)
        await pg.evaluate('([I, X, Y]) => { const S = window.__kgov, k = "kgov:ds:" + S.key, rec = JSON.parse(localStorage.getItem(k)); rec.anchors[I + "AHU_HTRK-VEN03_ExhaustFan"] = { x: X, y: Y, source: "kg", conf: 1, why: "graph" }; localStorage.setItem(k, JSON.stringify(rec)); }', [I, X, Y])
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1200)
        A = '(I) => { const S = window.__kgov; return ["AHU_HTRK-VEN03_ExhaustFan", "AHU_HTRK-VEN03_Rotor"].map(i => { const a = S.anchors.get(I + i); return [i, a.x, a.y, a.source]; }); }'
        print('before', await pg.evaluate(A, I))
        await pg.evaluate(DROP, enc([V5])); await pg.wait_for_timeout(600)
        await pg.click('.gm-opt[data-choice=replace]'); await pg.wait_for_timeout(3000)
        await pg.click('.gm.rg .gm-opt[data-choice=replace]'); await pg.wait_for_timeout(3500)
        print('toast', await pg.evaluate('[...document.querySelectorAll(".toast")].map(t => t.innerText).join(" / ")'))
        print('after (exhaust fan x should be +150, rotor unchanged)', await pg.evaluate(A, I))
        print('LOGS', [l for l in logs if 'PAGEERROR' in l][:3])
        await b.close()
asyncio.run(main())
