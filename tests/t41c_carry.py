import asyncio, sys, json, os, base64
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]; V3 = FX + '/repl/HTRK-VEN03_knowledge_graph.v3.ttl'
DROP = '''async ([names, datas]) => { const dt = new DataTransfer();
  for (let i = 0; i < names.length; i++) { const b = Uint8Array.from(atob(datas[i]), c => c.charCodeAt(0)); dt.items.add(new File([b], names[i], { type: 'text/turtle' })); }
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }'''
def enc(paths): return [[os.path.basename(p) for p in paths], [base64.b64encode(open(p, 'rb').read()).decode() for p in paths]]
I = 'https://example.org/htrk-ven03/id/'
SETUP = '''(I) => { const S = window.__kgov, k = "kgov:ds:" + S.key, rec = JSON.parse(localStorage.getItem(k) || "{}");
  const B = "https://brickschema.org/schema/Brick#", F = "https://w3id.org/fso#", R = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", L = "http://www.w3.org/2000/01/rdf-schema#label";
  rec.changes = [
    { id: "c1", seq: 1, type: "add_instance", title: "Add the valve V-99 found in the re-check", del: [], ins: [{ s: I + "V99", p: R, o: B + "Valve", ot: "iri" }, { s: I + "V99", p: L, o: "Valve V-99", ot: "lit", lang: "en", dt: "" }, { s: I + "AHU_HTRK-VEN03_SupplyFan", p: F + "suppliesFluidTo", o: I + "V99", ot: "iri" }], status: "applied" },
    { id: "c2", seq: 2, type: "add_instance", title: "Add the fitting F-1", del: [], ins: [{ s: I + "FIT1", p: R, o: F + "Fitting", ot: "iri" }, { s: I + "FIT1", p: L, o: "Fitting F-1", ot: "lit", lang: "en", dt: "" }], status: "applied" } ];
  rec.anchors = rec.anchors || {};
  rec.anchors[I + "V99"] = { x: 1111, y: 2222, source: "manual", conf: 1, why: "moved by reviewer" };
  rec.anchors[I + "FIT1"] = { x: 1500, y: 2300, source: "manual", conf: 1, why: "moved by reviewer" };
  rec.anchors[I + "Duct_VU_40"] = { x: 3333, y: 1444, source: "manual", conf: 1, why: "moved by reviewer" };
  rec.qa = rec.qa || { nodes: {}, edges: {} }; rec.qa.nodes[I + "Duct_VU_40"] = { status: "ok", note: "checked", at: "t" };
  localStorage.setItem(k, JSON.stringify(rec)); }'''
ST = '''(I) => { const S = window.__kgov, a = i => { const x = S.anchors.get(I + i); return x ? [x.x, x.y, x.source] : null; };
  return { graphs: S.graphs.map(g => g.name), changes: S.changes.map(c => c.id + ":" + c.status), V99: [S.G.nodes.has(I + "V99"), a("V99")], Vnew: [S.G.nodes.has(I + "Valve_V99_new"), a("Valve_V99_new")], FIT1: [S.G.nodes.has(I + "FIT1"), a("FIT1")],
    duct: a("Duct_VU_40"), ductB: a("Duct_VU_40b"), ductQa: (S.qa.nodes[I + "Duct_VU_40b"] || {}).status || null }; }'''
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        # make it an own project (the demo always starts fresh), then seed a review record and reload
        await pg.click('#btnOpen')
        async with pg.expect_file_chooser() as fc: await pg.click('#menuOpen button[data-act=add-graph]')
        await (await fc.value).set_files(f'{FX}/product.ttl'); await answer_graph(pg, 'add'); await pg.wait_for_timeout(2000)
        await pg.evaluate(SETUP, I)
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1500)
        print('before', json.dumps(await pg.evaluate(ST, I)))
        await pg.evaluate(DROP, enc([V3])); await pg.wait_for_timeout(600)
        await pg.click('.gm-opt[data-choice=replace]'); await pg.wait_for_timeout(3000)
        print('dialog', (await pg.inner_text('.gm.rg')).replace('\n', ' | ')[:1400])
        await pg.screenshot(path=f'{OUT}/415_carry.png', full_page=True)
        await pg.click('.gm.rg .gm-opt[data-choice=replace]'); await pg.wait_for_timeout(3500)
        print('toast', await pg.evaluate('[...document.querySelectorAll(".toast")].map(t => t.innerText).join(" / ")'))
        print('after', json.dumps(await pg.evaluate(ST, I)))
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(1500)
        print('after reload', json.dumps(await pg.evaluate(ST, I)))
        print('LOGS', [l for l in logs if 'PAGEERROR' in l][:3])
        await b.close()
asyncio.run(main())
