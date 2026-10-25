import asyncio, json, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        await pg.goto('http://localhost:8765/test.html')
        await pg.wait_for_function('window.__kgov && window.__kgov.G && window.__kgov.groups.length > 0', timeout=20000)
        await pg.wait_for_timeout(600)
        info = await pg.evaluate('''() => { const S = window.__kgov; return {
            nodes: S.G.nodes.size, edges: S.G.edges.length, vis: S.vis.size, groups: S.groups.length,
            anchors: S.anchors.size, off: [...S.off], kinds: Object.entries([...S.G.nodes.values()].reduce((m,n)=>{m[n.kind]=(m[n.kind]||0)+1;return m},{})),
            cats: Object.fromEntries([...S.G.catPreds].map(([k,m])=>[k,[...m.values()].map(x=>x.p.split(/[#/]/).pop()+':'+x.n)])),
            labelsShown: [...S.labEls.values()].filter(e=>e.style.display!=='none').length,
            dashed: S.groups.filter(g=>g.dash).length, merged: S.groups.filter(g=>g.edges.length>1).length,
            stats: document.querySelector('#stats').innerText, scopeHint: document.querySelector('#scopeHint').innerText,
            checks: [...document.querySelectorAll('.check-group > button')].map(b=>b.innerText.replace(/\\n/g,' ')),
            banner: !document.querySelector('#banner').hidden,
        }; }''')
        print(json.dumps(info, indent=1))
        await pg.screenshot(path=f'{OUT}/01_demo_fit.png')
        # zoom into AHU area
        await pg.evaluate('''() => { const S = window.__kgov; }''')
        print('\n'.join(logs[:30]))
        await b.close()
asyncio.run(main())
