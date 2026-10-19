import asyncio, json
from playwright.async_api import async_playwright
BASE = 'http://localhost:8765/test.html'
async def open_page(p, vw=1440, vh=900, init=None, color_scheme='light'):
    b = await p.chromium.launch()
    ctx = await b.new_context(viewport={'width': vw, 'height': vh}, color_scheme=color_scheme)
    pg = await ctx.new_page()
    logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    if init: await pg.add_init_script(init)
    await pg.goto(BASE)
    return b, pg, logs
async def wait_ready(pg):
    await pg.wait_for_function('window.__kgov && window.__kgov.G && window.__kgov.groups.length > 0 && document.querySelector("#busy").hidden', timeout=30000)
    await pg.wait_for_timeout(400)
async def screen_of(pg, iri):
    return await pg.evaluate('(iri) => { const p = window.__kgov.scr.get(iri); const r = document.querySelector("#viewport").getBoundingClientRect(); return p ? [p[0] + r.left, p[1] + r.top] : null; }', iri)
async def open_card(pg, key=None, nth=None, sec=None):
    """Issue cards are collapsed to their header unless chosen; open one (by data-key, or the nth card of a section)."""
    if key: sel = f'#issues .icard[data-key="{key}"]'
    else: sel = f'#issues [data-sec={sec}] .icard >> nth={nth}'
    loc = pg.locator(sel)
    cls = await loc.get_attribute('class')
    if 'expanded' not in (cls or '').split():
        await loc.locator('.ic-head').first.click(); await pg.wait_for_timeout(150)
        if key is None:
            loc = pg.locator(f'#issues [data-sec={sec}] .icard.expanded')
    return loc
async def accept_open_findings(pg, wait=150):
    for fid in await pg.evaluate('window.__kgov.findings.filter(f => f.status === "open").map(f => f.id)'):
        if not await pg.locator(f'#issues .icard[data-key="f:{fid}"]').count(): continue
        card = await open_card(pg, 'f:' + fid)
        btn = card.locator('.btn.primary')
        if await btn.count(): await btn.first.click(); await pg.wait_for_timeout(wait)
