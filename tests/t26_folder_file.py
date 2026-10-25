import asyncio, sys, os
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
os.makedirs(OUT, exist_ok=True)
URL = 'file://' + os.path.abspath(sys.argv[2] + '/../site/test.html') + ('?' + sys.argv[4] if len(sys.argv) > 4 else '')
ST = '() => { const S = window.__kgov; return { G: !!S.G, sheets: S.sheets.map(s => [s.drawing.name, s.role, s.group, s.drawing.w, s.drawing.h]), pending: (S.pendingSheets||[]).map(x => x.file.name), imgs: S.ctxImages.map(i => [i.name, i.role, i.group]), tables: S.tables.map(t => t.name), desc: (S.projectDesc || "").slice(0, 30) }; }'
PDFJS = '/opt/npm-tools/node_modules/pdfjs-dist/legacy/build/'
async def route_pdfjs(route):
    await route.fulfill(path=PDFJS + route.request.url.split('/build/')[-1], headers={'content-type': 'text/javascript', 'access-control-allow-origin': '*'})
# the .env fixture holds a fake key; it is made at runtime and never committed
os.makedirs(os.path.dirname(f'{FX}/proj2/claude.env'), exist_ok=True)
if not os.path.exists(f'{FX}/proj2/claude.env'): open(f'{FX}/proj2/claude.env', 'w').write('ANTHROPIC_API_KEY=sk-ant-x\n')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1440, 'height': 900}); pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/*', route_pdfjs)
        await pg.add_init_script('window.__toasts = []; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains("toast")) window.__toasts.push(n.innerText); }).observe(document, { childList: true, subtree: true });')
        await pg.goto(URL); await pg.wait_for_timeout(2500)
        print('start', await pg.evaluate(ST))
        await pg.click('#btnOpen'); await pg.wait_for_timeout(100)
        await pg.set_input_files('#folderInput', f'{FX}/proj2'); await pg.wait_for_timeout(3000)
        await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=60000)
        print('toasts', await pg.evaluate('[...document.querySelectorAll(".toast")].map(t => t.innerText)'))
        print('dialog open', await pg.is_visible('#modal'))
        if await pg.is_visible('#modal'):
            print('dialog', (await pg.inner_text('#modalBody'))[:1500].replace('\n', ' | '))
            print('broken thumbs', await pg.evaluate('[...document.querySelectorAll("#modalBody img.ithumb")].filter(i => !i.naturalWidth).map(i => i.closest(".imgrow").querySelector(".imgname b").textContent)'))
            await pg.screenshot(path=f'{OUT}/260_dialog.png', full_page=True)
            await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(3000)
            await pg.wait_for_function('document.querySelector("#busy").hidden', timeout=120000); await pg.wait_for_timeout(2000)
        print('after', await pg.evaluate(ST))
        print('toasts', await pg.evaluate('[...document.querySelectorAll(".toast")].map(t => t.innerText)'))
        print('all toasts', await pg.evaluate('window.__toasts'))
        print('tabs', (await pg.inner_text('.sb-tabs')).replace('\n', ' | ') if await pg.locator('.sb-tabs').count() else None)
        await pg.screenshot(path=f'{OUT}/261_after.png')
        print('LOGS', logs[:12])
        await b.close()
asyncio.run(main())
