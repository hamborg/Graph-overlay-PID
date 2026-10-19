import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
I = 'https://example.org/htrk-ven03/id/'
ST = '''(iri) => { const S = window.__kgov; return { a: S.anchors.get(iri) ? [S.anchors.get(iri).x, S.anchors.get(iri).y, S.anchors.get(iri).source] : null, off: S.off.has(iri), qa: (S.qa.nodes[iri]||{}).status || '', note: (S.qa.nodes[iri]||{}).note || '', undo: S.undo.length, redo: S.redo.length,
   ub: [document.querySelector('#btnUndo').disabled, document.querySelector('#btnUndo').title], rb: [document.querySelector('#btnRedo').disabled, document.querySelector('#btnRedo').title] }; }'''
async def main():
    async with async_playwright() as p:
        b, pg, logs = await open_page(p)
        await wait_ready(pg)
        coil = I + 'AHU_HTRK-VEN03_HeatingCoil'
        print('start', await pg.evaluate(ST, coil))
        await pg.fill('#search', 'AHU_HTRK-VEN03_HeatingCoil'); await pg.wait_for_timeout(150); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(600)
        pt = await screen_of(pg, coil)
        await pg.mouse.move(*pt); await pg.mouse.down(); await pg.mouse.move(pt[0] + 40, pt[1] + 25, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(250)
        print('1 moved', await pg.evaluate(ST, coil))
        await pg.click('#insp .qa-seg:not(.mini2) button[data-v=issue]'); await pg.wait_for_timeout(100)
        await pg.click('#insp textarea.note'); await pg.keyboard.type('Coil is drawn after the fan'); await pg.click('#insp h3'); await pg.wait_for_timeout(100)
        print('2 reviewed+note', await pg.evaluate(ST, coil))
        await pg.click('#insp button:has-text("Not on this drawing")'); await pg.wait_for_timeout(250)
        print('3 off drawing', await pg.evaluate(ST, coil))
        await pg.screenshot(path=f'{OUT}/80_history_desktop.png')
        for i in range(4):
            await pg.click('#btnUndo'); await pg.wait_for_timeout(200)
            print(f'undo {i+1}', await pg.evaluate(ST, coil))
        await pg.keyboard.press('Control+Shift+Z'); await pg.wait_for_timeout(200)
        print('redo (kbd)', await pg.evaluate(ST, coil))
        await pg.keyboard.press('Control+y'); await pg.wait_for_timeout(200)
        print('redo (ctrl+y)', await pg.evaluate(ST, coil))
        await pg.click('#btnRedo'); await pg.wait_for_timeout(200)
        await pg.click('#btnRedo'); await pg.wait_for_timeout(200)
        print('redo all', await pg.evaluate(ST, coil))
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(200)
        print('undo (kbd)', await pg.evaluate(ST, coil))
        # a new edit clears redo
        await pg.click('#insp .qa-seg:not(.mini2) button[data-v=ok]'); await pg.wait_for_timeout(150)
        print('new edit clears redo', await pg.evaluate(ST, coil))
        print('LOGS', [l for l in logs if 'ERR_FAILED' not in l][:5])
        await b.close()
        for vw, vh in [(360, 780), (412, 915)]:
            b, pg, logs = await open_page(p, vw=vw, vh=vh)
            await wait_ready(pg)
            tb = await pg.evaluate('(() => { const t = document.querySelector(".topbar"); return [t.scrollWidth, t.clientWidth, [...t.querySelectorAll("button")].filter(c => c.offsetParent && !c.closest(".menu")).map(c => (c.id||"?") + "@" + Math.round(c.getBoundingClientRect().right))]; })()')
            print(vw, 'topbar', tb)
            for btn, menu in [('#btnOpen', '#menuOpen'), ('#btnMore', '#menuMore')]:
                await pg.click(btn); await pg.wait_for_timeout(200)
                r = await pg.evaluate(f'(() => {{ const r = document.querySelector("{menu}").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; }})()')
                print(vw, menu, r)
                await pg.screenshot(path=f'{OUT}/81_{menu[1:]}_{vw}.png')
                await pg.click(btn); await pg.wait_for_timeout(100)
            await pg.click('#btnMore'); await pg.click('#mHelp'); await pg.wait_for_timeout(200)
            print(vw, 'help open via More:', await pg.is_visible('#modal'))
            await pg.keyboard.press('Escape')
            await pg.click('#btnPanel'); await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'{OUT}/82_drawer_{vw}.png')
            await pg.click('#sideClose'); await pg.wait_for_timeout(300)
            print(vw, 'drawer closed:', await pg.evaluate('!document.querySelector("#side").classList.contains("open") && !document.querySelector(".scrim")'))
            print('LOGS', [l for l in logs if 'ERR_FAILED' not in l][:5])
            await b.close()
asyncio.run(main())
