window.__mock = { prompts: [], images: [], saved: [], opts: [] };
(function () {
  let layoutP = null;
  const getLayout = () => (layoutP = layoutP || fetch('demo/layout.json').then(r => r.json()));
  async function sample(input, opts) {
    opts = opts || {};
    window.__mock.prompts.push(input);
    window.__mock.opts.push({ model: opts.model, modelTier: opts.modelTier, cache: opts.cache, nImages: opts.images ? opts.images.length : 0 });
    const imgs = opts.images || [];
    window.__mock.images = await Promise.all(Array.from(imgs).map(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })));
    if (input.includes('=== Area ')) return recheckAnswer(input, opts);
    if (input.includes('=== I1 ·')) return resolveAnswer(input, opts);
    const layout = await getLayout();
    const lines = input.split('\n');
    const start = lines.findIndex(l => l.startsWith('Instances to place'));
    const ids = [];
    for (let i = start + 1; i < lines.length; i++) { if (!lines[i].includes(' | ')) break; ids.push(lines[i].split(' | ')[0]); }
    const anchors = [], off = [];
    for (const id of ids) {
      const iri = 'https://example.org/htrk-ven03/id/' + id;
      const a = layout.anchors[iri];
      if (a) anchors.push({ id, x: a.x + 3, y: a.y - 2, conf: id.startsWith('System_') ? 0.45 : 0.85, why: 'mock' });
      else off.push(id);
    }
    const text = '```json\n' + JSON.stringify({ anchors, notOnDrawing: off }) + '\n```';
    for (let k = 1; k <= 4; k++) { await new Promise(r => setTimeout(r, 60)); if (opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: 'x' }; opts.onText && opts.onText({ text: text.slice(0, Math.floor(text.length * k / 4)), delta: '' }); }
    return { text, truncated: false, modelTierApplied: 'complex', modelApplied: opts.model };
  }
  async function recheckAnswer(input, opts) {
    const secs = input.split('=== Area ').slice(1);
    const areas = [];
    for (const sec of secs) {
      const id = sec.split(':')[0].trim();
      const lines = sec.split('\n');
      const inst = lines.filter(l => /^\d+ \| /.test(l) && !l.includes('| context')).map(l => l.split(' | '));
      const links = lines.filter(l => / (fso|brick|bot):\w+ /.test(l) && !l.includes(' | ')).map(l => l.trim().split(/\s+/).slice(0, 3));
      const m = /x (\d+)–(\d+), y (\d+)–(\d+)/.exec(sec);
      const cx = (+m[1] + +m[2]) / 2, cy = (+m[3] + +m[4]) / 2;
      const f = [];
      if (areas.length === 0) {
        f.push({ type: 'missing_instance', proposedId: 'Damper_TEST_01', proposedTypes: ['brick:Damper', 'fso:FlowController'], label: 'Test damper', x: cx, y: cy, links: inst[0] ? [{ from: inst[0][1], predicate: 'fso:suppliesFluidTo', to: 'Damper_TEST_01' }] : [], conf: 0.7, evidence: 'Damper symbol with no tag next to the silencer' });
        if (inst[0]) { const xy = inst[0][4].split(','); f.push({ type: 'misplaced_anchor', id: inst[0][1], x: +xy[0] + 40, y: +xy[1], conf: 0.8, evidence: 'Tag sits left of the symbol' }); }
        if (inst[1]) f.push({ type: 'wrong_type', id: inst[1][1], addTypes: ['brick:Fire_Damper'], removeTypes: [inst[1][2].split(', ')[0]], conf: 0.6, evidence: 'Symbol is a fire damper per legend' });
      } else if (areas.length === 1) {
        if (links[0]) f.push({ type: 'wrong_link', from: links[0][0], predicate: links[0][1], to: links[0][2], conf: 0.65, evidence: 'No drawn line between them' });
        if (links[1]) f.push({ type: 'wrong_direction', from: links[1][0], predicate: links[1][1], to: links[1][2], conf: 0.55, evidence: 'Arrow on the line points the other way' });
      } else {
        if (inst.length >= 2) f.push({ type: 'missing_link', from: inst[0][1], predicate: 'fso:suppliesFluidTo', to: inst[inst.length - 1][1], conf: 0.5, evidence: 'Drawn duct joins them' });
        if (inst.length) f.push({ type: 'extra_instance', id: inst[inst.length - 1][1], conf: 0.4, evidence: 'Nothing drawn at the tag' });
      }
      areas.push({ area: id, summary: f.length ? `${f.length} differences found` : 'Matches the graph.', findings: f });
    }
    const text = JSON.stringify({ areas });
    await new Promise(r => setTimeout(r, 80));
    opts.onText && opts.onText({ text, delta: text });
    return { text, truncated: false, modelTierApplied: 'complex', modelApplied: opts.model };
  }
  async function resolveAnswer(input, opts) {
    const secs = input.split('\n=== ').slice(1).filter(x => /^I\d+ ·/.test(x));
    const items = [];
    for (const sec of secs) {
      const id = sec.split(' ')[0];
      const lines = sec.split('\n');
      const f = [];
      if (sec.includes('flagged link')) {
        const t = lines.find(l => /^  \S+ \S+:\S+ \S+$/.test(l));
        if (t) { const [s1, p, o] = t.trim().split(/\s+/); f.push({ type: 'replace_link', from: s1, predicate: p, to: o, newTo: 'LYD_VI_RK1-03', conf: 0.7, evidence: 'Line continues to the silencer' }); }
      } else if (sec.includes('flagged instance')) {
        const m = /Instance: (\S+)/.exec(sec);
        if (m) f.push({ type: 'wrong_type', id: m[1], addTypes: ['brick:Fire_Damper'], removeTypes: [], conf: 0.6, evidence: 'Legend symbol is a fire damper' });
      } else if (sec.includes('· rule')) {
        const v = lines.filter(l => /^  \S+ \S+:\S+ \S+   \[/.test(l)).slice(0, 2);
        for (const l of v) { const [s1, p, o] = l.trim().split(/\s+/); f.push({ type: 'wrong_link', from: s1, predicate: p, to: o, conf: 0.8, evidence: 'Breaks the rule' }); }
      } else f.push({ type: 'other', text: 'Checked the whole graph; nothing to change for this note.', conf: 0.5 });
      items.push({ item: id, summary: f.length ? `${f.length} fix(es) proposed` : 'Nothing to change.', findings: f });
    }
    const text = JSON.stringify({ items });
    opts.onText && opts.onText({ text, delta: text });
    return { text, truncated: false, modelTierApplied: 'complex', modelApplied: opts.model };
  }
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 20, maxInputBytes: 10 * 1024 * 1024, mediaTypes: ['image/png', 'image/jpeg'] } });
  sample.json = async (i, o) => JSON.parse((await sample(i, o)).text.replace(/```json|```/g, ''));
  const downloads = { save: async ({ filename, data }) => { window.__mock.saved.push({ filename, data: typeof data === 'string' ? data : '[binary]' }); return { status: 'saved' }; } };
  window.claude = { use: async name => (name === 'sample' ? sample : name === 'downloads' ? downloads : null) };
})();
