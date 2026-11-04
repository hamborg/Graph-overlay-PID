import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
ST = '''() => { const S = window.__kgov; return S.frames.map(f => ({ sheet: f.sh.drawing.name, win: f.win, collapsed: f.collapsed, hits: (S.winHits || []).filter(w => w.f === f).length, anchors: f.sh.anchors.size })); }'''
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        await pg.evaluate("document.activeElement && document.activeElement.blur()"); await pg.keyboard.press('f'); await pg.wait_for_timeout(700)
        if not await pg.evaluate('window.__kgov.frames.some(f => /ahu_detail/.test(f.sh.drawing.name))'):
            await pg.locator('.sb-chip', has_text='AHU-01 detail').locator('.sb-chip-main').click(); await pg.wait_for_timeout(1200)
        await pg.evaluate("document.activeElement && document.activeElement.blur()"); await pg.keyboard.press('f'); await pg.wait_for_timeout(700)
        print('frames', await pg.evaluate(ST))
        btn = pg.locator('.bchrome', has_text='AHU-01 detail').locator('.bc-win')
        if not await btn.count():   # expand it first
            await pg.locator('.bchrome', has_text='AHU-01 detail').locator('.bc-btn[aria-label=Expand]').click(); await pg.wait_for_timeout(600)
        await btn.click(); await pg.wait_for_timeout(600)
        st = await pg.evaluate(ST); print('window on', st)
        # positions are the sheet's own anchors, scaled into the frame
        chk = await pg.evaluate('''() => { const S = window.__kgov, f = S.frames.find(f => f.win), { s: k, tx, ty } = S.view; return S.winHits.filter(w => w.f === f).slice(0, 4).map(w => { const a = f.sh.anchors.get(w.iri); return [w.iri.split("/").pop(), Math.round(w.x - ((a.x * f.k + f.dx) * k + tx)), Math.round(w.y - ((a.y * f.k + f.dy) * k + ty)), S.anchors.has(w.iri) && !S.off.has(w.iri)]; }); }''')
        print('offsets (should be 0)', chk)
        await pg.screenshot(path=f'{OUT}/400_window.png')
        # hover and click an instance in the window
        w = await pg.evaluate('''() => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(); const h = S.winHits.find(w => w.x > 20 && w.y > 160 && w.x < r.width - 20 && w.y < r.height - 40); return h && [h.x + r.left, h.y + r.top, h.iri]; }''')
        await pg.mouse.move(w[0], w[1]); await pg.wait_for_timeout(300)
        print('tip', (await pg.inner_text('#tip'))[:160])
        await pg.mouse.click(w[0], w[1]); await pg.wait_for_timeout(600)
        print('chosen', await pg.evaluate('window.__kgov.selection.map(i => i.split("/").pop())'), 'expected', w[2].split('/')[-1])
        await pg.screenshot(path=f'{OUT}/401_window_chosen.png')
        # stays on after reload, and turns off
        await pg.reload(); await wait_ready(pg); await pg.wait_for_timeout(800)
        print('after reload', [x for x in await pg.evaluate(ST) if x['win']])
        await pg.locator('.bchrome', has_text='AHU-01 detail').locator('.bc-win').click(); await pg.wait_for_timeout(400)
        print('off again', [x['win'] for x in await pg.evaluate(ST)])
        print('LOGS', [l for l in logs if ('error' in l.lower() and 'ERR_' not in l and '404' not in l) or 'PAGEERROR' in l][:6])
        await b.close()
asyncio.run(main())
