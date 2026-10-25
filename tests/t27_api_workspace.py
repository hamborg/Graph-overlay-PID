import asyncio, sys, os, json
sys.path.insert(0, sys.argv[2])
from common import *
OUT = sys.argv[1]; FX = sys.argv[3]
URL = 'file://' + os.path.abspath(sys.argv[2] + '/../site/test.html')
seen = []
SSE = ('event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5-5"}}\n\n'
       'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\n'
       'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n')
async def api(route):
    hd = route.request.headers
    seen.append({k: hd.get(k) for k in ('x-api-key', 'anthropic-workspace-id')} | {'model': json.loads(route.request.post_data)['model']})
    if not hd.get('anthropic-workspace-id'):
        await route.fulfill(status=400, headers={'access-control-allow-origin': '*', 'content-type': 'application/json'}, body=json.dumps({'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.'}}))
    else:
        await route.fulfill(status=200, headers={'access-control-allow-origin': '*', 'content-type': 'text/event-stream'}, body=SSE)
# the .env fixture holds a fake key; it is made at runtime and never committed
os.makedirs(os.path.dirname(f'{FX}/envs/claude.env'), exist_ok=True)
if not os.path.exists(f'{FX}/envs/claude.env'): open(f'{FX}/envs/claude.env', 'w').write('# my settings\nANTHROPIC_API_KEY="sk-ant-test-123"\nCLAUDE_MODEL=claude-sonnet-5-5\nCLAUDE_MAX_TOKENS=16000\nANTHROPIC_WORKSPACE_ID=wrkspc_01ABC\n')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page()
        logs = []; pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.route('https://api.anthropic.com/**', api)
        await pg.goto(URL); await pg.wait_for_timeout(2000)
        async def open_env():
            await pg.click('#btnOpen'); await pg.wait_for_timeout(150)
            await pg.click('#mApiKey'); await pg.wait_for_timeout(300)
        await open_env()
        # without a workspace: the clear message
        await pg.fill('#envKeyIn', 'sk-ant-test-123')
        await pg.get_by_role('button', name='Test').click(); await pg.wait_for_timeout(800)
        print('no ws:', await pg.inner_text('#modalBody .callout:not([hidden])'))
        # load the .env with the workspace id
        async with pg.expect_file_chooser() as fc:
            await pg.get_by_role('button', name='Load .env file…').click()
        await (await fc.value).set_files(f'{FX}/envs/claude.env'); await pg.wait_for_timeout(400)
        print('ws field:', await pg.input_value('input[aria-label="Workspace ID"]'))
        await pg.get_by_role('button', name='Test').click(); await pg.wait_for_timeout(800)
        print('with ws:', await pg.inner_text('#modalBody .callout:not([hidden])'))
        await pg.screenshot(path=f'{OUT}/270_env.png')
        await pg.get_by_role('button', name='Use key').click(); await pg.wait_for_timeout(300)
        print('seen', seen)
        # saved .env includes the workspace
        await open_env()
        async with pg.expect_download() as dl:
            await pg.get_by_role('button', name='Save as .env file').click()
        print('saved env:', open(await (await dl.value).path()).read().replace('\n', ' | '))
        print('LOGS', logs)
        await b.close()
os.makedirs(OUT, exist_ok=True)
asyncio.run(main())
