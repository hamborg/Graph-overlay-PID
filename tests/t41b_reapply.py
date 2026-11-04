import asyncio, sys, json, os, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]; V2 = FX + '/repl/HTRK-VEN03_knowledge_graph.v2.ttl'
DROP = '''async ([names, datas]) => { const dt = new DataTransfer();
  for (let i = 0; i < names.length; i++) { const b = Uint8Array.from(atob(datas[i]), c => c.charCodeAt(0)); dt.items.add(new File([b], names[i], { type: 'text/turtle' })); }
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }'''
def enc(paths): return [[os.path.basename(p) for p in paths], [base64.b64encode(open(p, 'rb').read()).decode() for p in paths]]
I = 'https://example.org/htrk-ven03/id/'
async def main():
    async with async_playwright() as p:
        for keep in [True, False]:
            b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
            await wait_ready(pg)
            await pg.evaluate('''(I) => { const S = window.__kgov; const c = { id: "c1", seq: 1, type: "add_link", title: "test", del: [], ins: [{ s: I + "AHU_HTRK-VEN03_SupplyFan", p: "https://brickschema.org/schema/Brick#feeds", o: I + "Duct_VU_40", ot: "iri" }], status: "applied" }; S.changes.push(c); S.changeSeq = 1; const k = "kgov:ds:" + S.key, rec = JSON.parse(localStorage.getItem(k) || "{}"); rec.changes = [c]; localStorage.setItem(k, JSON.stringify(rec)); }''', I)
            await pg.evaluate(DROP, enc([V2])); await pg.wait_for_timeout(600)
            await pg.click('.gm-opt[data-choice=replace]'); await pg.wait_for_timeout(2500)
            print('changes', (await pg.inner_text('.rg-sec')).replace('\n', ' | '))
            if not keep: await pg.uncheck('.rg-ch input'); await pg.wait_for_timeout(1500)
            print('replace text', await pg.inner_text('.gm.rg .gm-opt[data-choice=replace] small'))
            await pg.click('.gm.rg .gm-opt[data-choice=replace]'); await pg.wait_for_timeout(3000)
            print('keep' if keep else 'set aside', await pg.evaluate('(I) => { const S = window.__kgov; return [S.changes.map(c => c.status), S.G.edges.some(e => e.s === I + "AHU_HTRK-VEN03_SupplyFan" && e.o === I + "Duct_VU_40")]; }', I))
            print('LOGS', [l for l in logs if 'PAGEERROR' in l][:3])
            await b.close()
asyncio.run(main())
