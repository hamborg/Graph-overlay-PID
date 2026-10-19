import asyncio, json, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
I = 'https://example.org/htrk-ven03/id/'
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p)
        await wait_ready(pg)
        r = await pg.evaluate('''() => { const S = window.__kgov; const G = S.G;
          return { kinds: [...G.nodes.values()].reduce((m,n)=>{m[n.kind]=(m[n.kind]||0)+1;return m},{}),
                   sysToo: [...G.nodes.values()].filter(n=>n.sysToo).map(n=>n.local),
                   cats: Object.fromEntries([...G.catPreds].map(([k,m])=>[k,[...m.values()].map(x=>x.p.split(/[#/]/).pop()+':'+x.n).join(' ')])),
                   dashComp: S.groups.filter(g=>g.cat==='composition'&&g.dash).length,
                   checks: [...document.querySelectorAll('.check-group > button')].map(b=>b.innerText.replace(/\\n/g,' ')),
                   systems: [...document.querySelectorAll('#systems .chip')].map(c=>c.innerText.replace(/\\n/g,' ')) }; }''')
        print(json.dumps(r, indent=1))
        # open long-flow check list
        n = await pg.locator('.check-group > button.cg-head').count()
        for i in range(n): await pg.locator('.check-group > button.cg-head').nth(i).click()
        print('check items:', await pg.evaluate('[...document.querySelectorAll(".check-group li button")].map(b=>b.textContent)'))
        await pg.screenshot(path=f'{OUT}/02_fit.png')
        # center on the AHU
        await pg.evaluate(f'() => {{ const S = window.__kgov; }}')
        await pg.fill('#search', 'AHU_HTRK')
        await pg.wait_for_timeout(200)
        await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=f'{OUT}/03_ahu_selected.png')
        print('inspector:', (await pg.inner_text('#insp'))[:1500].replace('\n', ' | '))
        # click on empty background to deselect, then zoom more on the AHU area
        await pg.keyboard.press('Escape')
        await pg.evaluate('''() => { const S = window.__kgov; const a = S.anchors.get('%sAHU_HTRK-VEN03'); }''' % I)
        for _ in range(2):
            await pg.mouse.move(*(await screen_of(pg, I + 'AHU_HTRK-VEN03_SupplyFan')))
            await pg.mouse.wheel(0, -500)
            await pg.wait_for_timeout(150)
        await pg.mouse.move(1300, 120)
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/04_ahu_zoom.png')
        print('zoom', await pg.inner_text('#stZoom'))
        # hover a node -> tooltip + highlight
        pt = await screen_of(pg, I + 'AHU_HTRK-VEN03_HeatingCoil')
        await pg.mouse.move(*pt)
        await pg.wait_for_timeout(250)
        print('tip:', (await pg.inner_text('#tip')).replace('\n', ' | '), 'focus:', await pg.evaluate('!!window.__kgov.focus'))
        await pg.screenshot(path=f'{OUT}/05_hover.png')
        # drag the heating coil 60px right
        await pg.mouse.down(); await pg.mouse.move(pt[0] + 30, pt[1] + 10, steps=5); await pg.mouse.move(pt[0] + 60, pt[1] + 20, steps=5); await pg.mouse.up()
        await pg.wait_for_timeout(250)
        a = await pg.evaluate('(iri) => window.__kgov.anchors.get(iri)', I + 'AHU_HTRK-VEN03_HeatingCoil')
        stored = await pg.evaluate('() => { const k = Object.keys(localStorage).find(k=>k.startsWith("kgov:ds:")); return JSON.parse(localStorage.getItem(k)).anchors["%sAHU_HTRK-VEN03_HeatingCoil"]; }' % I)
        print('after drag', a, 'stored', stored, 'undo:', await pg.get_attribute('#btnUndo', 'title'))
        await pg.keyboard.press('Control+z')
        await pg.wait_for_timeout(200)
        print('after undo', await pg.evaluate('(iri) => window.__kgov.anchors.get(iri)', I + 'AHU_HTRK-VEN03_HeatingCoil'))
        # click node -> inspector
        pt = await screen_of(pg, I + 'AHU_HTRK-VEN03_SupplyFan')
        await pg.mouse.click(*pt)
        await pg.wait_for_timeout(300)
        print('insp2:', (await pg.inner_text('#insp'))[:900].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/06_inspector.png')
        # mark issue
        await pg.click('#insp .qa-seg:not(.mini2) button[data-v=issue]')
        await pg.fill('#insp textarea.note', 'Fan should be upstream of the coil')
        await pg.wait_for_timeout(100)
        print('qa:', await pg.inner_text('#qaText'))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(700)   # deselect zooms back (animated)
        # edge click: find an edge group of category flow and click its midpoint
        mid = await pg.evaluate('''() => { const S = window.__kgov; const r = document.querySelector('#viewport').getBoundingClientRect();
           const vis = S.groups.filter(g => g.cat==='flow' && g.geo && !g.geo.curved);
           for (const g of vis) { const L = Math.hypot(g.geo.x2-g.geo.x1, g.geo.y2-g.geo.y1); if (L < 180) continue; const p = {x: (g.geo.x1+g.geo.x2)/2, y: (g.geo.y1+g.geo.y2)/2}; if (p.x>50 && p.y>80 && p.x < r.width-400 && p.y < r.height-60) return [p.x + r.left, p.y + r.top, g.key]; } return null; }''')
        print('edge mid', mid)
        await pg.mouse.move(mid[0], mid[1]); await pg.wait_for_timeout(200)
        print('edge tip:', (await pg.inner_text('#tip')).replace('\n', ' | '))
        await pg.mouse.click(mid[0], mid[1]); await pg.wait_for_timeout(250)
        print('edgepop:', (await pg.inner_text('#edgePop'))[:600].replace('\n', ' | '))
        await pg.click('#edgePop .qa-seg button[data-v=issue]')
        await pg.screenshot(path=f'{OUT}/07_edgepop.png')
        await pg.click('#edgePop .x-btn')
        # category toggle
        before = await pg.evaluate('window.__kgov.groups.length')
        await pg.click('#cats .cat >> nth=2 >> .cat-head input[type=checkbox]')
        after = await pg.evaluate('window.__kgov.groups.length')
        print('location off: groups', before, '->', after)
        await pg.click('#cats .cat >> nth=2 >> .cat-head input[type=checkbox]')
        # expand flow and untick brick:feeds
        await pg.click('#cats .cat >> nth=0 >> .caret')
        n0 = await pg.evaluate('window.__kgov.groups.filter(g=>g.cat==="flow").reduce((s,g)=>s+g.edges.length,0)')
        await pg.click('#cats .cat >> nth=0 >> .pred:nth-child(3) input[type=checkbox]')
        n1 = await pg.evaluate('window.__kgov.groups.filter(g=>g.cat==="flow").reduce((s,g)=>s+g.edges.length,0)')
        print('flow triples drawn', n0, '-> after unticking 3rd pred', n1, await pg.inner_text('#cats .cat >> nth=0 >> .preds'))
        await pg.click('#cats .cat >> nth=0 >> .pred:nth-child(3) input[type=checkbox]')
        # scope
        await pg.click('label:has(input[name=scope][value=neighbours])'); await pg.wait_for_timeout(300)
        print('neighbours vis', await pg.evaluate('window.__kgov.vis.size'), 'margin', await pg.evaluate('window.__kgov.margin && window.__kgov.margin.n'))
        await pg.screenshot(path=f'{OUT}/08_neighbours.png')
        await pg.click('label:has(input[name=scope][value=full])'); await pg.wait_for_timeout(300)
        print('full vis', await pg.evaluate('window.__kgov.vis.size'))
        await pg.click('label:has(input[name=scope][value=drawing])'); await pg.wait_for_timeout(300)
        # system chip
        await pg.click('#systems .chip:has-text("System_VU")'); await pg.wait_for_timeout(300)
        print('system focus members', await pg.evaluate('window.__kgov.sysMembers.size'))
        await pg.screenshot(path=f'{OUT}/09_system_vu.png')
        await pg.click('#systems .chip:has-text("System_VU")')
        # opacity
        await pg.evaluate("() => { const r = document.querySelector('#mix'); r.value = -60; r.dispatchEvent(new Event('input')); }")
        print('opacity', await pg.evaluate('[document.querySelector("#ov").style.opacity, document.querySelector("#drawing").style.opacity]'))
        await pg.screenshot(path=f'{OUT}/10_opacity.png')
        # flagged only
        await pg.evaluate("() => { const r = document.querySelector('#mix'); r.value = 0; r.dispatchEvent(new Event('input')); }")
        await pg.check('#optFlagged'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f'{OUT}/11_flagged.png')
        await pg.uncheck('#optFlagged')
        print('LOGS', logs[:20])
        await b.close()
asyncio.run(main())
