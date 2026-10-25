import pathlib, sys
root = pathlib.Path(__file__).parent
head = (root/'src/head.html').read_text()
body = (root/'src/body.html').read_text()
n3 = (root/'n3bundle.js').read_text()
sparql = (root/'src/sparql.js').read_text()
utif = (root/'src/utif.js').read_text()
app = (root/'src/app.js').read_text()
for name, js in [('n3', n3), ('sparql', sparql), ('utif', utif), ('app', app)]:
    assert '</script' not in js.lower(), name + ' contains </script'
page = head + '\n' + body + '\n<script>\n' + n3 + '\n</script>\n<script>\n' + sparql + '\n</script>\n<script>\n' + utif + '\n</script>\n<script>\n' + app + '\n</script>\n'
(root/'site/index.html').write_text(page)
# local test wrapper mimicking the platform skeleton
wrap = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>html,body{margin:0;padding:0}</style></head><body>' + page + '</body></html>')
(root/'site/test.html').write_text(wrap)
print('index.html', len(page), 'bytes')
