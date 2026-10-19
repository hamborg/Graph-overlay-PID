import asyncio, sys
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]
async def main():
    async with async_playwright() as p:
        for vw, vh in [(360, 780), (412, 915)]:
            b, pg, logs = await open_page(p, vw=vw, vh=vh)
            await wait_ready(pg)
            print(vw, 'topbar overflow:', await pg.evaluate('(() => { const t = document.querySelector(".topbar"); return [t.scrollWidth, t.clientWidth, [...t.children].filter(c => c.offsetParent).map(c => Math.round(c.getBoundingClientRect().right))]; })()'))
            await pg.click('#btnOpen'); await pg.wait_for_timeout(200)
            print(vw, 'open menu rect:', await pg.evaluate('(() => { const r = document.querySelector("#menuOpen").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; })()'))
            await pg.screenshot(path=f'{OUT}/70_menu_open_{vw}.png')
            await pg.click('#btnMore'); await pg.wait_for_timeout(200)
            print(vw, 'more menu rect:', await pg.evaluate('(() => { const r = document.querySelector("#menuMore").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.bottom)]; })()'), await pg.evaluate('[...document.querySelectorAll("#menuMore button")].filter(b => !b.hidden).map(b => b.textContent.trim()).join(" / ")'))
            await pg.screenshot(path=f'{OUT}/71_menu_export_{vw}.png')
            await b.close()
asyncio.run(main())
