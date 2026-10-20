import asyncio, sys, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
I = 'https://example.org/htrk-ven03/id/'
SSE_REQS = []
def sse(text, model='claude-sonnet-5-5'):
    ev = [('message_start', {'type': 'message_start', 'message': {'model': model}})]
    for k in range(0, len(text), 40): ev.append(('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text[k:k+40]}}))
    ev.append(('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}}))
    ev.append(('message_stop', {'type': 'message_stop'}))
    return ''.join(f'event: {e}\ndata: {json.dumps(d)}\n\n' for e, d in ev)
async def api_route(route):
    req = route.request
    body = json.loads(req.post_data)
    msg = body['messages'][-1]['content']
    text_part = [c for c in msg if c['type'] == 'text'][0]['text']
    SSE_REQS.append({'headers': {k: v for k, v in req.headers.items() if k in ('x-api-key', 'anthropic-version', 'anthropic-dangerous-direct-browser-access')}, 'model': body['model'], 'max_tokens': body['max_tokens'], 'stream': body['stream'], 'images': sum(1 for c in msg if c['type'] == 'image'), 'plen': len(text_part), 'has_title_note': 'Rev C' in text_part, 'text': text_part})
    if 'Reply with the single word OK' in text_part: out = 'OK'
    elif '=== Area ' in text_part: out = json.dumps({'areas': [{'area': 'A1', 'summary': 'Checked via the API', 'findings': [{'type': 'other', 'text': 'api test finding', 'conf': 0.5, 'evidence': 'mock'}]}]})
    else: out = '{}'
    await route.fulfill(status=200, headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'}, body=sse(out, body['model']))
async def main():
    async with async_playwright() as p:
        # ======== A. no Claude in this view; a .env next to the app gives a key
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        await pg.route('http://localhost:8765/.env', lambda r: r.fulfill(status=200, headers={'content-type': 'text/plain'}, body='# test\nANTHROPIC_API_KEY="sk-ant-test-123456789"\nCLAUDE_MODEL=claude-sonnet-5-5\nCLAUDE_MAX_TOKENS=8000\n'))
        await pg.route('https://api.anthropic.com/v1/messages', api_route)
        await pg.goto(BASE)
        await wait_ready(pg)
        await pg.wait_for_timeout(600)
        print('api from .env', await pg.evaluate('(() => { const S = window.__kgov; return S.api ? [S.api.model, S.api.maxTokens, S.api.source, S.api.key.slice(0, 10)] : null; })()'))
        print('open-in-claude hidden', await pg.is_hidden('#btnInClaude'), '| anchor title:', await pg.get_attribute('#btnAnchor', 'title'))
        # env dialog
        await pg.click('#btnOpen'); await pg.click('#mApiKey'); await pg.wait_for_timeout(200)
        print('env modal:', (await pg.inner_text('#modalBody'))[:300].replace('\n', ' | '))
        await pg.screenshot(path=f'{OUT}/140_env_modal.png')
        await pg.locator('#modalBody').get_by_role('button', name='Test', exact=True).click(); await pg.wait_for_timeout(900)
        print('test result:', await pg.inner_text('#modalBody .callout'))
        await pg.keyboard.press('Escape')
        # ======== B. several images at once: drawing + legend + title block with notes
        async with pg.expect_file_chooser() as fc:
            await pg.click('#btnOpen'); await pg.click('#menuOpen [data-act=add-images]')
        await (await fc.value).set_files([f'{FX}/03_title_block.png', f'{FX}/04_context_photo.jpg'])
        await pg.wait_for_timeout(500)
        print('images dialog:', (await pg.inner_text('#modalBody'))[:400].replace('\n', ' | '))
        notes = pg.locator('#modalBody textarea.inote')
        await notes.nth(0).fill('Drawing HTRK-VEN03, Rev C — use it to name new instances')
        await notes.nth(1).fill('Photo of the plant room')
        rows = pg.locator('#modalBody .imgrow')
        await rows.nth(1).locator('button', has_text='Context').click()
        await pg.screenshot(path=f'{OUT}/141_images_dialog.png')
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(500)
        print('ctx images', await pg.evaluate('window.__kgov.ctxImages.map(i => [i.name, i.role, i.comment])'), 'legend', await pg.evaluate('window.__kgov.legend && window.__kgov.legend.name'))
        await pg.click('#btnLegend'); await pg.wait_for_timeout(300)
        print('image window tabs', await pg.evaluate('[...document.querySelectorAll("#lgTabs .chip")].map(c => c.textContent)'))
        await pg.locator('#lgTabs .chip').nth(1).click(); await pg.wait_for_timeout(200)
        print('window shows', await pg.inner_text('#lgTitle'), '|', await pg.inner_text('#lgNote'))
        await pg.screenshot(path=f'{OUT}/142_image_window.png')
        await pg.click('#lgManage'); await pg.wait_for_timeout(300)
        print('manage rows', await pg.locator('#modalBody .imgrow').count())
        await pg.locator('#modalBody .imgrow').nth(0).locator('textarea').fill('Supply side on the left, extract on the right')
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(300)
        print('drawing note', await pg.evaluate('window.__kgov.drawing.comment'))
        await pg.click('#lgClose')
        # ======== C. re-check through the API, with reference images
        await pg.click('#btnRecheck'); await pg.wait_for_timeout(250)
        pt = await pg.evaluate('([x, y]) => { const S = window.__kgov, r = document.querySelector("#viewport").getBoundingClientRect(); return [x * S.view.s + S.view.tx + r.left, y * S.view.s + S.view.ty + r.top]; }', [3560, 330])
        await pg.mouse.click(*pt); await pg.wait_for_timeout(150)
        await pg.click('.areabar .btn.primary'); await pg.wait_for_timeout(300)
        print('recheck modal:', (await pg.inner_text('#modalBody'))[:420].replace('\n', ' | '))
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot").innerText.includes("Show findings")', timeout=30000)
        print('run log:', await pg.inner_text('.runlog'))
        r = SSE_REQS[-1]
        print('api request', {k: v for k, v in r.items() if k != 'text'})
        print('prompt image lines:', [l for l in r['text'].split('\n') if l.startswith('- Image') or 'reviewer' in l][:8])
        await pg.click('#modalFoot .btn.primary'); await pg.wait_for_timeout(300)
        print('findings', await pg.evaluate('window.__kgov.findings.map(f => [f.type, f.text, f.status])'), 'run model', await pg.evaluate('window.__kgov.recheckRuns.at(-1).model'))
        # ======== D. project file round trip keeps images and notes
        await pg.click('#btnExport'); await pg.click('#menuExport button[data-act=export-project]'); await pg.wait_for_timeout(800)
        print('LOGS A', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()

        # ======== E. inside Claude (mock): selection features, long hover, resolve picker
        b, pg, logs = await open_page(p, init=open(sys.argv[2] + '/mock_claude.js').read())
        await wait_ready(pg)
        print('setup has api row?', await pg.locator('#empty').is_visible())
        # long hover on a faded node shows its label and thickens lines
        await pg.click('#cats .cat-all >> text=Uncheck all'); await pg.wait_for_timeout(250)
        await pg.click('#cats .cat >> nth=0 >> .cat-head input[type=checkbox]'); await pg.wait_for_timeout(250)   # flow only
        faded = await pg.evaluate('[...window.__kgov.unlinked].filter(i => window.__kgov.scr.get(i)).slice(0, 3).map(i => i.split("/").pop())')
        print('faded sample', faded, await pg.evaluate('window.__kgov.unlinked.size'))
        xy = await screen_of(pg, I + faded[0]) if faded else None
        if xy:
            await pg.mouse.move(*xy); await pg.wait_for_timeout(250)
            print('short hover longHover', await pg.evaluate('window.__kgov.longHover'))
            await pg.wait_for_timeout(1000)
            print('long hover', await pg.evaluate('[window.__kgov.longHover && window.__kgov.longHover.split("/").pop(), window.__kgov.focus && window.__kgov.focus.kind]'))
            await pg.screenshot(path=f'{OUT}/143_long_hover.png')
            await pg.mouse.move(700, 120); await pg.wait_for_timeout(200)
        await pg.click('#cats .cat-all >> text=Check all'); await pg.wait_for_timeout(250)
        await pg.evaluate('() => { const S = window.__kgov; S.catOn.system = false; S.catOn.other = false; }')
        await pg.click('#cats .cat >> nth=0 >> .cat-head input[type=checkbox]'); await pg.click('#cats .cat >> nth=0 >> .cat-head input[type=checkbox]'); await pg.wait_for_timeout(200)
        # predicate row toggles the connection card; the card highlights subject and object
        await pg.fill('#search', 'AHU_HTRK-VEN03_SupplyFan'); await pg.wait_for_timeout(150); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(700)
        rows = pg.locator('#insp .rel.link')
        await rows.nth(0).locator('.p').click(); await pg.wait_for_timeout(300)
        print('edge pop open', await pg.evaluate('[window.__kgov.edgePopOpen, window.__kgov.focus && window.__kgov.focus.kind, window.__kgov.focus && [...window.__kgov.focus.set].map(i => i.split("/").pop())]'))
        await pg.screenshot(path=f'{OUT}/144_edge_pop.png')
        await rows.nth(0).locator('.p').click(); await pg.wait_for_timeout(300)
        print('edge pop after 2nd click', await pg.evaluate('window.__kgov.edgePopOpen'))
        print('issues section in inspector:', (await pg.inner_text('#insp'))[-420:].replace('\n', ' | '))
        await pg.mouse.click(345, 300); await pg.wait_for_timeout(600)
        print('after bg click', await pg.evaluate('[window.__kgov.selection.length, document.querySelector("#insp").hidden]'))
        # flag two items, then the resolve picker
        await pg.evaluate('''(I) => { const S = window.__kgov; S.qa.nodes[I + 'BRS_VI_RK1-03'] = { status: 'issue', note: 'Wrong class?', at: new Date().toISOString() };
             S.qa.nodes[I + 'Duct_VI_05'] = { status: 'unsure', note: '', at: new Date().toISOString() }; }''', I)
        await pg.click('#btnIssues'); await pg.wait_for_timeout(300)
        await pg.click('#issues .itools >> text=Resolve with Claude'); await pg.wait_for_timeout(300)
        await pg.click('#modalBody .pickitems > summary'); await pg.wait_for_timeout(150)
        print('picker:', (await pg.inner_text('#modalBody .pickitems'))[:300].replace('\n', ' | '))
        await pg.locator('#modalBody .pick-list input').nth(0).uncheck(); await pg.wait_for_timeout(100)
        print('run btn', await pg.inner_text('#modalFoot .btn.primary'))
        await pg.screenshot(path=f'{OUT}/145_resolve_picker.png')
        await pg.click('#modalFoot .btn.primary')
        await pg.wait_for_function('document.querySelector("#modalFoot").innerText.includes("Review the fixes")', timeout=30000)
        pr = await pg.evaluate('window.__mock.prompts.at(-1)')
        print('resolve prompt items', [l for l in pr.split('\n') if l.startswith('=== I')])
        await pg.keyboard.press('Escape')
        # SPARQL error and ASK
        await pg.click('#btnSparql'); await pg.wait_for_timeout(200)
        await pg.fill('#sqEditor', 'SELECT ?x WHERE { ?x a brick:Damper . FILTER( }')
        await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(400)
        print('sparql error:', await pg.inner_text('#sqResults'))
        await pg.fill('#sqEditor', 'ASK { ?f a brick:Supply_Fan }')
        await pg.click('#sqRun'); await pg.wait_for_timeout(400)
        print('ask:', (await pg.inner_text('#sqResults')).replace('\n', ' | '))
        await pg.fill('#sqEditor', 'CONSTRUCT { ?b brick:isFedBy ?a } WHERE { ?a fso:suppliesFluidTo ?b } LIMIT 20')
        await pg.click('#sqRun'); await pg.wait_for_timeout(400)
        print('construct:', (await pg.inner_text('#sqResults'))[:200].replace('\n', ' | '), await pg.evaluate('window.__kgov.focus && [window.__kgov.focus.kind, window.__kgov.focus.set.size, (window.__kgov.focus.groups || []).length]'))
        # hidden predicate highlighted from SPARQL (system topology is off)
        await pg.fill('#sqEditor', 'SELECT ?s ?p ?o WHERE { VALUES ?p { fso:hasComponent } ?s ?p ?o } LIMIT 30')
        await pg.click('#sqRun'); await pg.wait_for_timeout(500)
        print('hidden preds', await pg.evaluate('window.__kgov.focus && [window.__kgov.focus.set.size, (window.__kgov.focus.groups || []).length, (window.__kgov.focus.groups || []).filter(g => g.hidden).length]'))
        await pg.screenshot(path=f'{OUT}/146_sparql_hidden.png')
        # dark mode quick look
        await pg.emulate_media(color_scheme='dark'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/147_dark.png')
        print('LOGS E', [l for l in logs if 'ERR_FAILED' not in l and '404' not in l][:8])
        await b.close()
asyncio.run(main())
