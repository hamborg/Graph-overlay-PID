(() => {
'use strict';

/* =====================================================================
   1. Utilities
   ===================================================================== */
const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
  return e;
}
function sv(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtInt = n => Number(n).toLocaleString('en-US');
function fnv1a(str) {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 0x01000193); }
  return (h1 >>> 0).toString(16).padStart(8, '0');
}
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const IDB = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('kg-overlay-inspector', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        setTimeout(() => rej(new Error('idb timeout')), 2500);
      } catch (e) { rej(e); }
    });
    return this._db;
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    } catch { return undefined; }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch { /* storage unavailable */ }
  },
  async del(k) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch { /* storage unavailable */ }
  },
};
function toast(msg, action, ms = 4200, key) {
  const box = $('#toasts');
  if (key) $$('.toast', box).forEach(x => { if (x.dataset.key === key) x.remove(); });   /* one toast per kind: the newest replaces it */
  const t = h('div', { class: 'toast', role: 'status', 'data-key': key || null }, h('span', null, msg));
  if (action) t.append(h('button', { onclick: () => { action.fn(); t.remove(); } }, action.label));
  box.append(t);
  const all = $$('.toast', box);
  if (all.length > 3) all.slice(0, all.length - 3).forEach(x => x.remove());
  setTimeout(() => t.remove(), action ? ms + 2500 : ms);
}
function dropToast(key) { $$('#toasts .toast').forEach(x => { if (x.dataset.key === key) x.remove(); }); }
function pendingToast() {
  const n = pendingApply().length;
  if (!n) { dropToast('pending'); return; }
  toast(`${n} accepted fix${n === 1 ? '' : 'es'} not in the graph yet`, { label: n === 1 ? 'Apply now' : `Apply ${n}`, fn: () => applyFindings(pendingApply()) }, 6000, 'pending');
}
function busy(on, text) { $('#busy').hidden = !on; if (text) $('#busyText').textContent = text; }
async function copyText(text, fallbackInput) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); return true; }
  catch {
    if (fallbackInput) { fallbackInput.focus(); fallbackInput.select(); toast('Press Ctrl/⌘+C to copy the selected text'); }
    return false;
  }
}

/* =====================================================================
   2. Vocabulary knowledge (BOT, FSO, Brick, REC, 223P, SOSA …)
   ===================================================================== */
const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#', xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#', dcterms: 'http://purl.org/dc/terms/', dc: 'http://purl.org/dc/elements/1.1/',
  sh: 'http://www.w3.org/ns/shacl#', prov: 'http://www.w3.org/ns/prov#', vann: 'http://purl.org/vocab/vann/',
  bot: 'https://w3id.org/bot#', fso: 'https://w3id.org/fso#', brick: 'https://brickschema.org/schema/Brick#',
  rec: 'https://w3id.org/rec#', s223: 'http://data.ashrae.org/standard223#', sosa: 'http://www.w3.org/ns/sosa/',
  ssn: 'http://www.w3.org/ns/ssn/', saref: 'https://saref.etsi.org/core/', qudt: 'http://qudt.org/schema/qudt/',
  unit: 'http://qudt.org/vocab/unit/', quantitykind: 'http://qudt.org/vocab/quantitykind/', schema: 'https://schema.org/',
  tag: 'https://brickschema.org/schema/BrickTag#', props: 'https://w3id.org/props#', opm: 'https://w3id.org/opm#',
  ifc: 'https://standards.buildingsmart.org/IFC/DEV/IFC4/ADD2_TC1/OWL#',
};
const RDF_TYPE = NS.rdf + 'type';
const SUBCLASS = NS.rdfs + 'subClassOf', SUBPROP = NS.rdfs + 'subPropertyOf', INVERSE = NS.owl + 'inverseOf';
const LABEL_PREDS = [NS.rdfs + 'label', NS.skos + 'prefLabel', NS.skos + 'altLabel', NS.dcterms + 'title', NS.schema + 'name'];
const META_CLASSES = new Set([
  'owl:Class', 'rdfs:Class', 'owl:ObjectProperty', 'owl:DatatypeProperty', 'owl:AnnotationProperty', 'rdf:Property', 'owl:Ontology',
  'owl:TransitiveProperty', 'owl:SymmetricProperty', 'owl:FunctionalProperty', 'owl:InverseFunctionalProperty', 'owl:AsymmetricProperty',
  'owl:ReflexiveProperty', 'owl:IrreflexiveProperty', 'owl:Restriction', 'owl:AllDisjointClasses', 'owl:AllDifferent', 'rdfs:Datatype',
  'owl:DeprecatedClass', 'owl:DeprecatedProperty', 'sh:NodeShape', 'sh:PropertyShape', 'skos:ConceptScheme',
].map(q => NS[q.split(':')[0]] + q.split(':')[1]));
const SYMMETRIC = NS.owl + 'SymmetricProperty';
/* namespaces whose IRIs are vocabulary terms, never drawing instances */
const VOCAB_NS = ['rdf', 'rdfs', 'owl', 'xsd', 'skos', 'dcterms', 'dc', 'sh', 'prov', 'vann', 'bot', 'fso', 'brick', 'rec', 's223', 'sosa', 'ssn', 'saref', 'qudt', 'unit', 'quantitykind', 'schema', 'tag', 'props', 'opm', 'ifc'].map(p => NS[p]);
const isVocab = iri => VOCAB_NS.some(ns => iri.startsWith(ns));
/* predicates never drawn as graph lines (annotations, schema) */
const NO_EDGE_NS = ['rdf', 'rdfs', 'owl', 'skos', 'dcterms', 'dc', 'sh', 'prov', 'vann'].map(p => NS[p]);

/* Connection categories. dir: 1 = subject→object, -1 = object→subject, 0 = undirected (canonical drawing direction) */
const CATS = [
  { id: 'flow', name: 'Flow', color: '#2563eb', on: true, desc: 'Fluid / air flow between components (direction = flow direction)' },
  { id: 'sensing', name: 'Sensing & points', color: '#16a34a', on: true, desc: 'Sensors, points, meters and what they belong to' },
  { id: 'location', name: 'Location', color: '#d97706', on: true, desc: 'Containment in rooms, zones, storeys, buildings (container → contained)' },
  { id: 'system', name: 'System topology', color: '#7c3aed', on: false, desc: 'System membership and sub-systems (system → member)' },
  { id: 'composition', name: 'Parts & composition', color: '#db2777', on: true, desc: 'Whole → part (e.g. AHU → fan → motor)' },
  { id: 'heat', name: 'Heat transfer', color: '#dc2626', on: true, desc: 'Heat transfer between components' },
  { id: 'connection', name: 'Physical connection', color: '#0f766e', on: true, desc: 'Undirected physical connections' },
  { id: 'other', name: 'Other links', color: '#64748b', on: false, desc: 'Any other link between two instances' },
];
const CAT = Object.fromEntries(CATS.map((c, i) => [c.id, { ...c, order: i }]));
const REG = new Map();
function reg(cat, dir, rank, pfx, ...locals) { for (const l of locals) REG.set(NS[pfx] + l, { cat, dir, rank }); }
reg('flow', 1, 3, 'fso', 'suppliesFluidTo', 'returnsFluidTo');
reg('flow', -1, 3, 'fso', 'hasFluidSuppliedBy', 'hasFluidReturnedBy');
reg('flow', 1, 2, 'fso', 'feedsFluidTo');
reg('flow', -1, 2, 'fso', 'hasFluidFedBy');
reg('flow', 0, 0, 'fso', 'exchangesFluidWith');
reg('flow', 1, 1, 'brick', 'feeds'); reg('flow', -1, 1, 'brick', 'isFedBy');
reg('flow', 1, 1, 'rec', 'feeds'); reg('flow', -1, 1, 'rec', 'isFedBy');
reg('flow', 1, 1, 's223', 'connectedTo'); reg('flow', -1, 1, 's223', 'connectedFrom');
reg('heat', 1, 1, 'fso', 'transfersHeatTo'); reg('heat', -1, 1, 'fso', 'transfersHeatFrom'); reg('heat', 0, 0, 'fso', 'exchangesHeatWith');
reg('sensing', 1, 1, 'brick', 'hasPoint', 'meters', 'hasSubMeter'); reg('sensing', -1, 1, 'brick', 'isPointOf', 'isMeteredBy', 'isSubMeterOf');
reg('sensing', 1, 1, 'rec', 'hasPoint'); reg('sensing', -1, 1, 'rec', 'isPointOf');
reg('sensing', 1, 1, 'sosa', 'hosts', 'observes'); reg('sensing', -1, 1, 'sosa', 'isHostedBy', 'isObservedBy');
reg('sensing', 1, 1, 's223', 'observes', 'actuates', 'hasObservationLocation');
reg('location', 1, 1, 'bot', 'containsElement', 'hasSpace', 'hasStorey', 'hasBuilding', 'containsZone', 'intersectingElement', 'adjacentElement', 'hasElement', 'hostsElement');
reg('location', 0, 0, 'bot', 'adjacentZone', 'intersectsZone');
reg('location', 1, 1, 'brick', 'isLocationOf'); reg('location', -1, 1, 'brick', 'hasLocation');
reg('location', 1, 1, 'rec', 'isLocationOf', 'includes'); reg('location', -1, 1, 'rec', 'locatedIn', 'isIncludedIn');
reg('location', 1, 1, 's223', 'encloses'); reg('location', -1, 1, 's223', 'hasPhysicalLocation');
reg('system', 1, 1, 'fso', 'hasComponent', 'hasSubSystem', 'hasSupplySystem', 'hasReturnSystem', 'hasConsumerComponent', 'hasSourceComponent', 'hasConsumerSystem', 'hasSourceSystem');
reg('system', -1, 1, 'fso', 'isComponentOf', 'isSubSystemOf', 'isConsumerComponentOf', 'isSourceComponentOf');
reg('system', 1, 1, 's223', 'hasMember');
reg('composition', 1, 1, 'brick', 'hasPart'); reg('composition', -1, 1, 'brick', 'isPartOf');
reg('composition', 1, 1, 'rec', 'hasPart'); reg('composition', -1, 1, 'rec', 'isPartOf');
reg('composition', 1, 1, 'bot', 'hasSubElement', 'aggregates');
reg('composition', 1, 1, 's223', 'contains');
reg('connection', 0, 0, 'fso', 'connectedWith', 'exchangesElectricChargeWith');
reg('connection', 0, 0, 'brick', 'connectedTo'); reg('connection', 0, 0, 's223', 'cnx', 'connected');
reg('connection', 1, 1, 's223', 'hasConnectionPoint', 'connectsAt', 'connectsThrough'); reg('connection', -1, 1, 's223', 'isConnectionPointOf');
/* default per-predicate shades inside the flow family */
const PRED_SHADE = {
  [NS.fso + 'returnsFluidTo']: '#0891b2', [NS.fso + 'hasFluidReturnedBy']: '#0891b2',
  [NS.fso + 'feedsFluidTo']: '#3b82f6', [NS.fso + 'hasFluidFedBy']: '#3b82f6',
  [NS.brick + 'feeds']: '#3b82f6', [NS.brick + 'isFedBy']: '#3b82f6',
};
const GUESS = [
  ['flow', /(feed|fed[A-Z]|suppl|return|flow|upstream|downstream|discharg|outlet|inlet|exhaust|intake|serves|servedBy)/i],
  ['sensing', /(point|sensor|measur|monitor|observ|actuat|control|command|setpoint|signal|meter)/i],
  ['location', /(locat|contain|room|space|zone|storey|floor|building|site|placedIn|inside|within|hasElement|adjacent)/i],
  ['system', /(system|component|member|loop|network|circuit)/i],
  ['composition', /(part|subElement|assembl|consist|aggregat)/i],
  ['heat', /(heat|thermal)/i],
  ['connection', /(connect|link|attach|join|port)/i],
];
function guessPred(local) {
  let cat = 'other';
  for (const [c, re] of GUESS) if (re.test(local)) { cat = c; break; }
  let dir = 1;
  if (/^is[A-Z].*(Of|By)$/.test(local) || /(By|From)$/.test(local)) dir = -1;
  else if (cat === 'location' && /(^located|^isLocated|In$|^in[A-Z]|hasLocation|placedIn|within|inside)/i.test(local)) dir = -1;
  else if (cat === 'connection') dir = 0;
  return { cat, dir, rank: 0 };
}

/* node kinds */
const K = (pfx, ...l) => l.map(x => NS[pfx] + x);
const KIND_CLASSES = {
  location: new Set([...K('bot', 'Zone', 'Space', 'Storey', 'Building', 'Site'),
    ...K('brick', 'Location', 'Space', 'Room', 'Floor', 'Building', 'Zone', 'HVAC_Zone', 'Site', 'Storey', 'Wing', 'Outdoor_Area', 'Lighting_Zone', 'Fire_Zone'),
    ...K('rec', 'Space', 'Room', 'Building', 'Level', 'Zone', 'Site', 'Architecture'), ...K('s223', 'PhysicalSpace', 'DomainSpace', 'Zone', 'ZoneGroup'),
    ...K('ifc', 'IfcSpace', 'IfcBuildingStorey', 'IfcBuilding', 'IfcSite')]),
  system: new Set([...K('fso', 'System', 'SupplySystem', 'ReturnSystem', 'DistributionSystem'), ...K('brick', 'System', 'Loop'), ...K('s223', 'System')]),
  point: new Set([...K('brick', 'Point', 'Sensor', 'Setpoint', 'Status', 'Command', 'Alarm', 'Parameter'), ...K('sosa', 'Sensor', 'Actuator'), ...K('s223', 'Sensor')]),
  segment: new Set([...K('fso', 'Segment'), ...K('ifc', 'IfcDuctSegment', 'IfcPipeSegment'), ...K('s223', 'Duct', 'Pipe', 'Connection')]),
  fitting: new Set([...K('fso', 'Fitting'), ...K('ifc', 'IfcDuctFitting', 'IfcPipeFitting'), ...K('s223', 'Junction', 'ConnectionPoint', 'InletConnectionPoint', 'OutletConnectionPoint', 'BidirectionalConnectionPoint')]),
};
const KIND_RE = {
  location: /(^|_)(Room|Space|Zone|Storey|Floor|Level|Building|Site|Wing|Hallway|Corridor|Area|Location|Lobby|Stairwell)$|Room$/,
  system: /(System|Loop|Network|Circuit)$/,
  point: /(Sensor|Setpoint|Status|Command|Alarm|Parameter)$|(^|_)Point$/,
  segment: /(Duct|Pipe|Segment|Cable|Conduit|Tube|Hose)$/,
  fitting: /(Fitting|Junction|Tee|Elbow|Bend|Reducer|Transition|ConnectionPoint)$/,
};
const KIND_ORDER = ['location', 'system', 'point', 'segment', 'fitting'];
const KIND_LABEL = { component: 'Component', segment: 'Segment', fitting: 'Fitting', location: 'Location', system: 'System', point: 'Point' };
const KIND_COLOR = { component: '#1e293b', segment: '#475569', fitting: '#334155', location: '#b45309', system: '#6d28d9', point: '#15803d' };
const SHAPE_R = { component: 5.2, segment: 3.8, fitting: 4, location: 6.5, system: 7.5, point: 6 };
const GENERIC_TYPES = new Set([NS.bot + 'Element', NS.owl + 'NamedIndividual', NS.owl + 'Thing', NS.rdfs + 'Resource']);
const isGlobalKind = k => k === 'location' || k === 'system';

/* placement conventions — learned while tagging the HTRK-VEN03 drawing */
const CONVENTIONS = [
  '- Equipment, dampers, valves, fans, filters, coils, heat exchangers, silencers, terminals/diffusers and sensors: the centre of the symbol.',
  '- Motors / actuators that belong to a component: the motor or actuator symbol itself (usually drawn on or beside the component).',
  '- Ducts, pipes and other segments between two components: the midpoint of the drawn run between its two endpoints.',
  '- Junctions / tees / fittings: the point where the lines meet.',
  '- Rooms, spaces and zones: the room name / number text (its header label), not the middle of the box. A shared box listing two rooms: anchor each on its own number.',
  '- Storeys, buildings, plants: their title text if drawn; if there is none, list the instance in notOnDrawing.',
  '- Systems: a label naming the system, or a representative point on a line drawn in that system\'s line type (see the legend).',
  '- A unit drawn as a dashed boundary box (e.g. an air handling unit): its tag or the top edge of the box.',
];

/* =====================================================================
   3. State
   ===================================================================== */
const DEFAULT_SETTINGS = {
  graphOpacity: 92, drawingOpacity: 100, invert: false, showTypes: true, typePref: 'specific', nameMode: 'local',
  labelSize: 11, declutter: true, merge: true, flaggedOnly: false, mix: 0, showFindings: true, dimUnlinked: true, nodeScale: 3, lineScale: 2,
};
const S = {
  graphs: [],            // [{name, text}]
  drawing: null,         // {name, blob, url, w, h, kind, page, pages, pdf}
  legend: null,          // {name, blob, url}
  G: null,
  key: '',
  isDemo: false,
  anchors: new Map(),    // iri -> {x, y, source, conf, why}
  orig: new Map(),
  off: new Set(),
  qa: { nodes: {}, edges: {} },
  runs: [],
  view: { s: 1, tx: 0, ty: 0 },
  fitS: 1,
  scope: 'drawing',
  srcOff: new Set(),
  catOn: Object.fromEntries(CATS.map(c => [c.id, c.on])),
  catColor: Object.fromEntries(CATS.map(c => [c.id, c.color])),
  predOff: new Set(),
  predColor: {},
  openCats: new Set(),
  settings: { ...DEFAULT_SETTINGS },
  vis: new Set(),
  pos: new Map(),
  scr: new Map(),
  groups: [],
  labs: new Map(),
  labRects: [],
  nodeOrder: [],
  margin: null,
  selected: null, hovered: null, focusSystem: null, sysMembers: null,
  undo: [],
  redo: [],
  areaMode: false, areas: [], areaFactor: clamp(+LS.get('kgov:areaFactor', 4) || 4, 2, 8), areaHover: null,
  findings: [], recheckRuns: [], findingSeq: 0, selFinding: null, selArea: null,
  ctxImages: [], api: null, nativeSample: null, imgWinIdx: 0,
  rightPanel: null, sparql: null, sparqlSel: null, rectStart: null, areaShape: 'square',
  rules: [], issuesOpen: false, issuesShowAll: false, issueFocus: null,
  parsed: null,          // cached parse of S.graphs (source triples, never modified)
  changes: [],           // change log: applied graph changes, in order (see 12d)
  changeSeq: 0,
  unlinked: null,        // shown instances without any shown connection (drawn at 50 %)
  hlEdgeKey: null,       // connection highlighted from the inspector
  edgePopOpen: false,
  checkMarks: new Map(), // check id -> Set of item keys marked by the reviewer
  selection: [], selGroups: [], groupByKey: new Map(), pairCount: new Map(), inspTab: null, pathFocus: null, pathInfo: null, viewSaved: null, longHover: null, lhTimer: 0, issueSel: null,
  checkUndecided: new Set(),
  issueSecOpen: LS.get('kgov:issSec', null) || {},
  raf: 0,
  capSample: null, capDownloads: null,
  sampleFn: null,
  claudeCtl: null,
};
function loadSettings() {
  const st = LS.get('kgov:settings', null);
  if (!st) return;
  Object.assign(S.settings, st.settings || {});
  for (const c of CATS) {
    if (st.catOn && c.id in st.catOn) S.catOn[c.id] = !!st.catOn[c.id];
    if (st.catColor && st.catColor[c.id]) S.catColor[c.id] = st.catColor[c.id];
  }
  S.predOff = new Set(st.predOff || []);
  S.predColor = st.predColor || {};
}
function saveSettings() {
  LS.set('kgov:settings', { settings: S.settings, catOn: S.catOn, catColor: S.catColor, predOff: [...S.predOff], predColor: S.predColor });
}
function dsKey() { return 'kgov:ds:' + S.key; }
function persist() {
  if (!S.key) return;
  LS.set(dsKey(), {
    anchors: Object.fromEntries(S.anchors), orig: Object.fromEntries(S.orig), off: [...S.off], qa: S.qa, runs: S.runs,
    findings: S.findings, recheckRuns: S.recheckRuns, rules: S.rules, changes: S.changes,
  });
}

/* =====================================================================
   4. Graph model
   ===================================================================== */
const localName = iri => { const m = /[#/:]([^#/:]*)$/.exec(iri); return m && m[1] ? decodeURIComponent(m[1]) : iri; };
function makeQn(prefixes) {
  const list = Object.entries(prefixes).filter(([, ns]) => ns).sort((a, b) => b[1].length - a[1].length);
  const cache = new Map();
  return iri => {
    let q = cache.get(iri);
    if (q) return q;
    q = '<' + iri + '>';
    for (const [p, ns] of list) {
      if (iri.startsWith(ns)) { const l = iri.slice(ns.length); if (/^[A-Za-z0-9_\-.%]*$/.test(l)) { q = p + ':' + l; break; } }
    }
    cache.set(iri, q);
    return q;
  };
}
let qn = iri => iri;

function parseGraphText(text, name) {
  const lower = name.toLowerCase();
  const fmt = lower.endsWith('.nt') ? 'N-Triples' : lower.endsWith('.nq') ? 'N-Quads' : lower.endsWith('.trig') ? 'TriG' : lower.endsWith('.n3') ? 'text/n3' : undefined;
  const parser = new N3Parser(fmt ? { format: fmt, baseIRI: 'urn:x-file:' + encodeURIComponent(name) + '#' } : { baseIRI: 'urn:x-file:' + encodeURIComponent(name) + '#' });
  const prefixes = {};
  const quads = parser.parse(text, null, (p, iri) => { prefixes[p] = iri.value || iri; });
  return { quads, prefixes };
}

function buildGraph(parsed) {
  const prefixes = { rdf: NS.rdf, rdfs: NS.rdfs, owl: NS.owl, xsd: NS.xsd, bot: NS.bot, fso: NS.fso, brick: NS.brick, rec: NS.rec, s223: NS.s223, sosa: NS.sosa, skos: NS.skos, dcterms: NS.dcterms, qudt: NS.qudt, unit: NS.unit };
  for (const p of parsed) for (const [k, v] of Object.entries(p.prefixes)) if (v) prefixes[k] = v;
  qn = makeQn(prefixes);
  const all = [];
  parsed.forEach((p, fi) => { for (const q of p.quads) all.push([q, fi]); });

  const subClass = new Map(), subProp = new Map(), inverse = new Map();
  const symmetric = new Set(), schema = new Set(), classes = new Set(), predicates = new Set();
  const add = (m, k, v) => { let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(v); };
  for (const [q] of all) {
    const p = q.predicate.value, s = q.subject.value, o = q.object;
    predicates.add(p);
    if (p === RDF_TYPE) {
      if (o.termType === 'NamedNode') { classes.add(o.value); if (META_CLASSES.has(o.value)) schema.add(s); if (o.value === SYMMETRIC) symmetric.add(s); }
    } else if (p === SUBCLASS && o.termType === 'NamedNode') { add(subClass, s, o.value); classes.add(s); classes.add(o.value); }
    else if (p === SUBPROP && o.termType === 'NamedNode') { add(subProp, s, o.value); schema.add(s); }
    else if (p === INVERSE && o.termType === 'NamedNode') { inverse.set(s, o.value); if (!inverse.has(o.value)) inverse.set(o.value, s); schema.add(s); schema.add(o.value); }
    else if (p === NS.rdfs + 'domain' || p === NS.rdfs + 'range') schema.add(s);
  }
  const supCache = new Map();
  const closure = (m, c) => {
    let r = supCache.get(m === subClass ? 'c' + c : 'p' + c);
    if (r) return r;
    r = new Set();
    const stack = [c];
    while (stack.length) { const x = stack.pop(); for (const y of m.get(x) || []) if (!r.has(y)) { r.add(y); stack.push(y); } }
    supCache.set(m === subClass ? 'c' + c : 'p' + c, r);
    return r;
  };
  const supers = c => closure(subClass, c);
  const superProps = p => closure(subProp, p);

  const predInfoCache = new Map();
  function predInfo(p) {
    let r = predInfoCache.get(p);
    if (r) return r;
    if (REG.has(p)) r = { ...REG.get(p), known: true, via: null };
    else if (inverse.has(p) && REG.has(inverse.get(p))) { const b = REG.get(inverse.get(p)); r = { cat: b.cat, dir: -b.dir, rank: b.rank, known: true, via: 'owl:inverseOf ' + qn(inverse.get(p)) }; }
    else {
      for (const sp of superProps(p)) if (REG.has(sp)) { r = { ...REG.get(sp), known: true, via: 'rdfs:subPropertyOf ' + qn(sp) }; break; }
      if (!r) r = { ...guessPred(localName(p)), known: false, via: 'guessed from name' };
    }
    if (symmetric.has(p)) r.dir = 0;
    predInfoCache.set(p, r);
    return r;
  }
  const noEdge = p => NO_EDGE_NS.some(ns => p.startsWith(ns));
  const isInstanceCandidate = iri => !schema.has(iri) && !classes.has(iri) && !predicates.has(iri);

  const nodes = new Map();
  const ensure = iri => {
    let n = nodes.get(iri);
    if (!n) nodes.set(iri, n = { iri, types: new Set(), lits: [], refs: [], out: [], in: [], srcs: new Set(), kind: 'component' });
    return n;
  };
  for (const [q, fi] of all) {
    if (q.predicate.value !== RDF_TYPE || q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue;
    const s = q.subject.value;
    if (!isInstanceCandidate(s) || META_CLASSES.has(q.object.value)) continue;
    const n = ensure(s); n.types.add(q.object.value); n.srcs.add(fi);
  }
  for (const [q, fi] of all) {
    const p = q.predicate.value;
    if (p === RDF_TYPE || noEdge(p) || q.object.termType !== 'NamedNode' || q.subject.termType !== 'NamedNode') continue;
    if (!REG.has(p) && !(inverse.has(p) && REG.has(inverse.get(p))) && ![...superProps(p)].some(x => REG.has(x))) continue;
    for (const t of [q.subject.value, q.object.value]) if (isInstanceCandidate(t) && !isVocab(t)) ensure(t).srcs.add(fi);
  }
  const blanks = new Map();
  const edges = [];
  for (const [q, fi] of all) {
    const s = q.subject, p = q.predicate.value, o = q.object;
    if (s.termType === 'BlankNode') { let b = blanks.get(s.value); if (!b) blanks.set(s.value, b = []); b.push({ p, o }); continue; }
    const sn = nodes.get(s.value);
    if (!sn) continue;
    sn.srcs.add(fi);
    if (p === RDF_TYPE) continue;
    if (o.termType === 'Literal') { sn.lits.push({ p, o }); continue; }
    if (o.termType === 'BlankNode') { sn.lits.push({ p, o, blank: true }); continue; }
    const on = nodes.get(o.value);
    if (on && !noEdge(p) && on !== sn) {
      const idx = edges.length;
      edges.push({ s: s.value, p, o: o.value, fi, cat: 'other', dir: 1 });
      sn.out.push(idx); on.in.push(idx);
    } else sn.refs.push({ p, o: o.value });
  }
  const G = { nodes, edges, blanks, prefixes, supers, predInfo, files: parsed.map(p => p.name), triples: all.length };

  /* kinds: from classes (incl. graph-declared superclasses), then domain/range inference */
  const classKind = new Map();
  const kindOfClass = t => {
    if (classKind.has(t)) return classKind.get(t);
    let kind = null;
    const chain = [t, ...supers(t)];
    for (const k of KIND_ORDER) { if (chain.some(c => KIND_CLASSES[k].has(c) || KIND_RE[k].test(localName(c)))) { kind = k; break; } }
    classKind.set(t, kind);
    return kind;
  };
  for (const n of nodes.values()) {
    const kinds = new Set();
    let physical = false;
    for (const t of n.types) {
      const k = kindOfClass(t);
      if (k) kinds.add(k);
      else if (t !== NS.owl + 'NamedIndividual' && t !== NS.owl + 'Thing') { physical = true; if (isVocab(t)) n.knownPhysical = true; }
    }
    let kind = KIND_ORDER.find(k => kinds.has(k)) || 'component';
    /* typed both as a system and as a physical unit (e.g. an AHU that is fso:System + brick:Air_Handling_Unit):
       draw it as equipment, but keep it in the systems list */
    if (kind === 'system' && physical) { kind = kinds.has('segment') ? 'segment' : kinds.has('fitting') ? 'fitting' : 'component'; n.sysToo = true; }
    n.kind = kind;
  }
  const LOC_SUBJ = new Set(K('bot', 'containsElement', 'hasSpace', 'hasStorey', 'hasBuilding', 'containsZone', 'intersectingElement', 'adjacentElement', 'hasElement').concat(K('brick', 'isLocationOf'), K('rec', 'isLocationOf')));
  const LOC_OBJ = new Set(K('bot', 'hasSpace', 'hasStorey', 'hasBuilding', 'containsZone').concat(K('brick', 'hasLocation'), K('rec', 'locatedIn')));
  const SYS_SUBJ = new Set(K('fso', 'hasComponent', 'hasSubSystem', 'hasSupplySystem', 'hasReturnSystem'));
  const SYS_OBJ = new Set(K('fso', 'isComponentOf', 'isSubSystemOf', 'hasSubSystem', 'hasSupplySystem', 'hasReturnSystem'));
  const PT_OBJ = new Set(K('brick', 'hasPoint').concat(K('rec', 'hasPoint')));
  const PT_SUBJ = new Set(K('brick', 'isPointOf').concat(K('rec', 'isPointOf')));
  for (const e of edges) {
    const sn = nodes.get(e.s), on = nodes.get(e.o);
    const inferable = n => n.kind === 'component' && !n.knownPhysical && !n.sysToo;
    if (inferable(sn)) { if (SYS_SUBJ.has(e.p)) sn.kind = 'system'; else if (LOC_SUBJ.has(e.p)) sn.kind = 'location'; else if (PT_SUBJ.has(e.p)) sn.kind = 'point'; }
    if (inferable(on)) { if (SYS_OBJ.has(e.p)) on.kind = 'system'; else if (LOC_OBJ.has(e.p)) on.kind = 'location'; else if (PT_OBJ.has(e.p)) on.kind = 'point'; }
  }
  /* edge categories (brick:hasPart with a system end counts as system topology) */
  G.catPreds = new Map(CATS.map(c => [c.id, new Map()]));
  for (const e of edges) {
    const info = predInfo(e.p);
    let cat = info.cat;
    if (cat === 'composition' && (nodes.get(e.s).kind === 'system' || nodes.get(e.o).kind === 'system')) cat = 'system';
    e.cat = cat; e.dir = info.dir; e.rank = info.rank;
    const m = G.catPreds.get(cat);
    const rec = m.get(e.p) || { p: e.p, n: 0, info };
    rec.n++; m.set(e.p, rec);
  }
  /* display names (unique) */
  const byLocal = new Map();
  for (const n of nodes.values()) { const l = localName(n.iri); byLocal.set(l, (byLocal.get(l) || 0) + 1); }
  for (const n of nodes.values()) {
    const l = localName(n.iri);
    n.local = byLocal.get(l) > 1 ? qn(n.iri) : l;
    const lab = n.lits.find(x => LABEL_PREDS.includes(x.p) && (!x.o.language || x.o.language.startsWith('en'))) || n.lits.find(x => LABEL_PREDS.includes(x.p));
    n.label = lab ? lab.o.value : null;
  }
  /* type namespaces for the "class shown" selector */
  const tns = new Map();
  for (const n of nodes.values()) for (const t of n.types) { const q = qn(t); const pfx = q.startsWith('<') ? null : q.split(':')[0]; if (pfx != null) tns.set(pfx, prefixes[pfx]); }
  G.typeNamespaces = [...tns.entries()].sort();
  return G;
}

function displayName(n) { return S.settings.nameMode === 'label' && n.label ? n.label : n.local; }
function displayTypes(n) {
  const G = S.G;
  const types = [...n.types];
  if (!types.length) return [];
  const specific = types.filter(t => !types.some(u => u !== t && G.supers(u).has(t)));
  let pool = specific.filter(t => !GENERIC_TYPES.has(t));
  if (!pool.length) pool = specific.length ? specific : types;
  const pref = S.settings.typePref;
  if (pref && pref !== 'specific') {
    const ns = G.prefixes[pref];
    const inNs = types.filter(t => ns && t.startsWith(ns));
    if (inNs.length) pool = inNs.filter(t => !inNs.some(u => u !== t && G.supers(u).has(t)));
  }
  const rank = t => {
    if (!isVocab(t)) return 0;
    if (t.startsWith(NS.brick)) return 1; if (t.startsWith(NS.fso)) return 2; if (t.startsWith(NS.rec)) return 3;
    if (t.startsWith(NS.s223)) return 4; if (t.startsWith(NS.bot)) return 5; return 6;
  };
  pool.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const main = pool[0];
  return [main, ...types.filter(t => t !== main).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))];
}

/* coordinate predicates already in the graph (e.g. sig:drawingX / sig:drawingY) */
function coordAnchors(G, W, H) {
  const cand = new Map();
  for (const n of G.nodes.values()) for (const l of n.lits) {
    const ln = localName(l.p);
    if (!/x$/i.test(ln)) continue;
    const v = parseFloat(l.o.value);
    if (!isFinite(v)) continue;
    const yName = ln.slice(0, -1) + (ln.endsWith('X') ? 'Y' : 'y');
    const key = l.p + '|' + l.p.slice(0, -ln.length) + yName;
    cand.set(key, (cand.get(key) || 0) + 1);
  }
  let best = null;
  for (const [key, cnt] of cand) {
    const [px, py] = key.split('|');
    const pts = [];
    for (const n of G.nodes.values()) {
      const lx = n.lits.find(l => l.p === px), ly = n.lits.find(l => l.p === py);
      if (!lx || !ly) continue;
      const x = parseFloat(lx.o.value), y = parseFloat(ly.o.value);
      if (isFinite(x) && isFinite(y)) pts.push([n.iri, x, y]);
    }
    if (!pts.length) continue;
    const maxX = Math.max(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[2]));
    const norm = maxX <= 1.0001 && maxY <= 1.0001;
    const inside = pts.filter(([, x, y]) => norm || (x >= -2 && y >= -2 && x <= W * 1.02 && y <= H * 1.02)).length;
    const score = inside / pts.length >= 0.8 ? pts.length : 0;
    if (score && (!best || score > best.score)) best = { px, py, pts, norm, score };
  }
  const out = new Map();
  if (!best) return { anchors: out, via: null };
  for (const [iri, x, y] of best.pts) out.set(iri, { x: Math.round(best.norm ? x * W : x), y: Math.round(best.norm ? y * H : y), source: 'kg', conf: 1, why: qn(best.px) + ' / ' + qn(best.py) });
  return { anchors: out, via: qn(best.px) + ' / ' + qn(best.py) };
}

/* =====================================================================
   5. Loading: graphs, drawings (image / PDF), legend, layout
   ===================================================================== */
const GRAPH_EXT = /\.(ttl|turtle|nt|nq|n3|trig)$/i;
const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const PDF_EXT = /\.pdf$/i;

async function loadImageBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { url, w: img.naturalWidth, h: img.naturalHeight };
}
let pdfjsPromise = null;
const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
function ensurePdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      /* the worker module is loaded on the main thread (globalThis.pdfjsWorker), so no cross-origin Worker is needed */
      try {
        globalThis.pdfjsWorker = await import(PDFJS_BASE + 'pdf.worker.min.mjs');
        const lib = await import(PDFJS_BASE + 'pdf.min.mjs');
        lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
        return lib;
      } catch (e) {
        throw new Error('The PDF renderer could not be loaded (' + (e.message || e) + '). Export the page as PNG and open that instead.');
      }
    })();
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}
async function renderPdfPage(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(8000 / Math.max(vp1.width, vp1.height), Math.sqrt(36e6 / (vp1.width * vp1.height)));
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvas: cv, canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  return blob;
}
async function prepareDrawing(file, pageNo = 1) {
  const hash = await blobHash(file);
  const d = await prepareDrawingInner(file, pageNo);
  d.hash = hash;
  return d;
}
async function prepareDrawingInner(file, pageNo) {
  if (PDF_EXT.test(file.name) || file.type === 'application/pdf') {
    busy(true, 'Rendering PDF…');
    const lib = await ensurePdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
    const page = clamp(pageNo, 1, doc.numPages);
    const png = await renderPdfPage(doc, page);
    const im = await loadImageBlob(png);
    return { name: file.name, blob: png, source: file, url: im.url, w: im.w, h: im.h, kind: 'pdf', page, pages: doc.numPages, pdf: doc };
  }
  const im = await loadImageBlob(file);
  return { name: file.name, blob: file, source: file, url: im.url, w: im.w, h: im.h, kind: 'image', page: 1, pages: 1 };
}

async function openSession({ graphs, drawing, legend, images, layout, isDemo = false, keepGraph = false }) {
  busy(true, 'Loading…');
  try {
    if (graphs) {
      const parsed = [];
      for (const g of graphs) {
        try { parsed.push({ name: g.name, ...parseGraphText(g.text, g.name) }); }
        catch (e) { throw new Error(`Could not parse ${g.name}: ${e.message}`); }
      }
      S.graphs = graphs;
      busy(true, 'Building graph…');
      await new Promise(r => setTimeout(r, 0));
      S.parsed = parsed;
      S.G = buildGraph(parsed);
      S.gHasChanges = false;
      S.srcOff.clear();
    }
    if (drawing) {
      if (S.drawing && S.drawing.url && S.drawing.url !== drawing.url) URL.revokeObjectURL(S.drawing.url);
      S.drawing = drawing;
      const img = $('#drawing');
      img.src = drawing.url; img.hidden = false;
      try { await img.decode(); } catch { /* shown anyway */ }
    }
    if (legend !== undefined) setLegend(legend);
    if (images !== undefined) setCtxImages(images);
    if (!keepGraph || graphs || drawing) S.isDemo = isDemo;
    applyDataset(layout);
    renderAllPanels();
    rebuild();
    fitView();
    updateHeader();
    if (!S.isDemo) saveSessionToIdb();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e));
  } finally {
    busy(false);
  }
}

/* Placements are stored per drawing (content hash + page) and keyed by instance IRI, so they survive
   graph revisions and merging further graphs onto the same drawing. */
function applyDataset(layout) {
  const d = S.drawing;
  S.key = d && d.hash ? `${d.hash}:p${d.page}` : '';
  if (S.areaMode) exitAreaMode(false);
  S.anchors = new Map(); S.orig = new Map(); S.off = new Set(); S.qa = { nodes: {}, edges: {} }; S.runs = []; S.undo = []; S.redo = [];
  S.findings = []; S.recheckRuns = []; S.findingSeq = 0; S.selFinding = null; S.selArea = null; S.areas = []; S.rules = []; S.issueFocus = null;
  S.changes = []; S.changeSeq = 0; S.checkMarks = new Map(); S.hlEdgeKey = null;
  S.selected = null; S.selection = []; S.selGroups = []; S.pathFocus = null; S.pathInfo = null; S.viewSaved = null; S.hovered = null; S.longHover = null; S.focusSystem = null; S.sysMembers = null; S.coordVia = null;
  closeInspector(); closeEdgePop(); updateUndo();
  if (!S.G) return;
  const stored = S.key ? LS.get(dsKey(), null) : null;
  if (stored) {
    for (const [k, v] of Object.entries(stored.anchors || {})) S.anchors.set(k, v);
    for (const [k, v] of Object.entries(stored.orig || {})) S.orig.set(k, v);
    for (const k of stored.off || []) S.off.add(k);
    S.qa = stored.qa || S.qa; S.runs = stored.runs || [];
    S.findings = Array.isArray(stored.findings) ? stored.findings : [];
    S.recheckRuns = Array.isArray(stored.recheckRuns) ? stored.recheckRuns : [];
    S.findingSeq = S.findings.reduce((m, f) => Math.max(m, f.seq || 0), 0);
    S.rules = Array.isArray(stored.rules) ? stored.rules : [];
    S.changes = Array.isArray(stored.changes) ? stored.changes : [];
    S.changeSeq = S.changes.reduce((m, c) => Math.max(m, c.seq || 0), 0);
  }
  /* the graph on screen = source + this drawing's change log (e.g. after switching PDF pages) */
  const want = S.changes.some(c => c.status !== 'reverted');
  if ((want || S.gHasChanges) && S.parsed) { S.G = buildGraph(effectiveParsed()); S.gHasChanges = want; }
  if (d) {
    const ca = coordAnchors(S.G, d.w, d.h);
    for (const [k, v] of ca.anchors) if (!S.anchors.has(k) && !S.off.has(k)) { S.anchors.set(k, v); if (!S.orig.has(k)) S.orig.set(k, { ...v }); }
    if (ca.via) S.coordVia = ca.via;
  }
  if (layout && !stored) importLayoutObject(layout, { silent: true, asOriginal: true });
  for (const [k, v] of S.anchors) if (!S.orig.has(k)) S.orig.set(k, { ...v });
  persist();
}
async function blobHash(blob) {
  try {
    const dg = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(dg)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return 'n' + fnv1a(`${blob.size}:${blob.type}:${blob.name || ''}`); }
}

async function saveSessionToIdb() {
  if (!S.G || !S.drawing) return;
  await IDB.set('last', {
    graphs: S.graphs.map(g => ({ name: g.name, text: g.text })),
    drawing: { name: S.drawing.name, blob: S.drawing.source || S.drawing.blob, page: S.drawing.page, comment: S.drawing.comment || '' },
    legend: S.legend ? { name: S.legend.name, blob: S.legend.blob, comment: S.legend.comment || '' } : null,
    images: S.ctxImages.map(i => ({ name: i.name, blob: i.blob, role: i.role, comment: i.comment || '' })),
    at: Date.now(),
  });
}
async function restoreSession() {
  const last = await IDB.get('last');
  if (!last || !last.graphs || !last.drawing || !last.drawing.blob) return false;
  try {
    const file = new File([last.drawing.blob], last.drawing.name, { type: last.drawing.blob.type });
    const drawing = await prepareDrawing(file, last.drawing.page || 1);
    drawing.comment = last.drawing.comment || '';
    let legend = null;
    if (last.legend && last.legend.blob) { const im = await loadImageBlob(last.legend.blob); legend = { name: last.legend.name, blob: last.legend.blob, url: im.url, comment: last.legend.comment || '' }; }
    const images = [];
    for (const it of last.images || []) { try { const im = await loadImageBlob(it.blob); images.push({ id: 'im' + images.length, name: it.name, blob: it.blob, url: im.url, role: it.role === 'title' ? 'title' : 'context', comment: it.comment || '' }); } catch { /* skip a broken image */ } }
    await openSession({ graphs: last.graphs, drawing, legend, images });
    toast('Reopened your last session', { label: 'Load demo instead', fn: () => loadDemo(true) });
    return true;
  } catch (e) { console.warn('restore failed', e); return false; }
}

async function loadDemo(fromUser) {
  busy(true, 'Loading demo…');
  try {
    const [ttl, png, legendPng, layout] = await Promise.all([
      fetch('demo/HTRK-VEN03_knowledge_graph.ttl').then(r => { if (!r.ok) throw new Error('demo graph ' + r.status); return r.text(); }),
      fetch('demo/01_diagram.png').then(r => { if (!r.ok) throw new Error('demo drawing ' + r.status); return r.blob(); }),
      fetch('demo/02_legend.png').then(r => r.ok ? r.blob() : null).catch(() => null),
      fetch('demo/layout.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    const drawing = await prepareDrawing(new File([png], '01_diagram.png', { type: 'image/png' }));
    let legend = null;
    if (legendPng) { const im = await loadImageBlob(legendPng); legend = { name: '02_legend.png', blob: legendPng, url: im.url }; }
    await openSession({ graphs: [{ name: 'HTRK-VEN03_knowledge_graph.ttl', text: ttl }], drawing, legend, layout, isDemo: true });
    return true;
  } catch (e) {
    console.warn('demo unavailable', e);
    busy(false);
    showEmpty();
    /* a downloaded copy of the app has no demo files next to it */
    if (fromUser) toast('The demo isn\'t included in this copy of the app. Open the app in Claude to try it.', { label: 'Open in Claude', fn: openInClaudeModal }, 6000);
    return false;
  }
}

function setLegend(legend) {
  if (S.legend && S.legend.url && (!legend || S.legend.url !== legend.url)) URL.revokeObjectURL(S.legend.url);
  S.legend = legend;
  updateImagesBtn();
  if (!refCount()) $('#legendWin').hidden = true;
  else if (!$('#legendWin').hidden) showImagesWin(S.imgWinIdx || 0);
}

let pendingMode = null;
function pickFiles(mode) {
  pendingMode = mode;
  const fi = $('#fileInput');
  fi.accept = mode === 'open-graph' || mode === 'add-graph' ? '.ttl,.turtle,.nt,.nq,.n3,.trig,text/turtle'
    : mode === 'open-drawing' ? 'image/*,.pdf,application/pdf' : mode === 'open-legend' || mode === 'add-images' ? 'image/*' : mode === 'import-layout' || mode === 'open-project' ? '.json,application/json' : '';
  fi.multiple = mode === 'open-graph' || mode === 'add-graph' || mode === 'open-drawing' || mode === 'add-images';
  fi.value = '';
  fi.click();
}
async function handleFiles(files, mode) {
  files = Array.from(files || []);
  if (!files.length) return;
  const graphs = [], drawings = [], jsons = [], others = [];
  for (const f of files) {
    if (mode === 'open-legend' || mode === 'add-images') { if (IMG_EXT.test(f.name) || /^image\//.test(f.type)) drawings.push(f); else others.push(f); continue; }
    if (GRAPH_EXT.test(f.name)) graphs.push(f);
    else if (IMG_EXT.test(f.name) || PDF_EXT.test(f.name) || /^image\//.test(f.type) || f.type === 'application/pdf') drawings.push(f);
    else if (/\.json$/i.test(f.name)) jsons.push(f);
    else others.push(f);
  }
  if (others.length) toast(`Skipped ${others.map(f => f.name).join(', ')} — use Turtle (.ttl/.nt/.trig), PNG/JPG/PDF or .json`);
  try {
    if (mode === 'open-legend') {
      const f = drawings[0]; if (!f) return;
      const im = await loadImageBlob(f);
      setLegend({ name: f.name, blob: f, url: im.url });
      $('#legendWin').hidden = false;
      if (!S.isDemo) saveSessionToIdb();
      return;
    }
    if (mode === 'add-images') { if (drawings.length) await openImagesDialog(drawings, 'add'); return; }
    if (S.isDemo && mode !== 'add-graph' && (graphs.length || drawings.length)) newProject(true);   /* own files replace the demo entirely */
    let newGraphs = null;
    if (graphs.length) {
      const texts = await Promise.all(graphs.map(async f => ({ name: f.name, text: await f.text() })));
      newGraphs = mode === 'add-graph' && S.graphs.length && !S.isDemo ? [...S.graphs, ...texts] : (mode === 'add-graph' ? [...S.graphs, ...texts] : texts);
    }
    let drawing = null;
    const several = drawings.length > 1;
    if (drawings.length && !several) drawing = await prepareDrawing(drawings[0]);
    if (newGraphs || drawing) {
      await openSession({ graphs: newGraphs, drawing, keepGraph: true, isDemo: false });
      if (!S.G) toast('Now open the knowledge graph (.ttl)');
      else if (!S.drawing && !several) toast('Now open the drawing the graph was extracted from');
    }
    if (several) await openImagesDialog(drawings, S.drawing && mode === 'add-images' ? 'add' : 'open');
    for (const j of jsons) {
      const obj = JSON.parse(await j.text());
      if (obj && obj.format === 'kg-overlay-project/1') await openProjectObject(obj);
      else importLayoutObject(obj, {});
    }
    updateHeader();
  } catch (e) {
    console.error(e);
    busy(false);
    toast(e.message || String(e));
  }
}

/* =====================================================================
   6. Scope, margin layout, edge groups
   ===================================================================== */
const placed = iri => S.anchors.has(iri) && !S.off.has(iri);
const drawW = () => (S.drawing ? S.drawing.w : 0);
const drawH = () => (S.drawing ? S.drawing.h : 3000);
function srcOK(n) { return S.G.files.length < 2 || [...n.srcs].some(fi => !S.srcOff.has(fi)) || n.srcs.size === 0; }
function edgeOn(e) { return S.catOn[e.cat] && !S.predOff.has(e.cat + '|' + e.p); }

function computeVisible() {
  const G = S.G, vis = new Set();
  for (const n of G.nodes.values()) {
    if (!srcOK(n)) continue;
    if (S.scope === 'full' || placed(n.iri)) vis.add(n.iri);
  }
  if (S.scope === 'neighbours') {
    for (const e of G.edges) {
      if (!edgeOn(e)) continue;
      const a = placed(e.s), b = placed(e.o);
      if (a && !b && srcOK(G.nodes.get(e.o))) vis.add(e.o);
      if (b && !a && srcOK(G.nodes.get(e.s))) vis.add(e.s);
    }
  }
  return vis;
}

function layoutMargin() {
  S.pos = new Map();
  const W = drawW(), H = drawH();
  const un = [];
  for (const iri of S.vis) {
    if (placed(iri)) { const a = S.anchors.get(iri); S.pos.set(iri, { x: a.x, y: a.y }); }
    else un.push(iri);
  }
  S.margin = null;
  if (!un.length) return;
  const G = S.G;
  const rowH = Math.max(36, H / 52), rows = Math.max(1, Math.floor(H / rowH));
  const colW = Math.max(260, Math.min(560, (W || 4000) / 13));
  const gap = W ? Math.max(120, W * 0.03) : 0;
  const want = un.map(iri => {
    const n = G.nodes.get(iri);
    const ys = [];
    for (const idx of [...n.out, ...n.in]) { const e = G.edges[idx]; const m = e.s === iri ? e.o : e.s; if (placed(m)) ys.push(S.anchors.get(m).y); }
    return { iri, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null, kind: n.kind, name: n.local };
  });
  want.sort((a, b) => (a.y == null) - (b.y == null) || (a.y ?? 0) - (b.y ?? 0) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const occ = [];
  const take = (c, r) => { (occ[c] = occ[c] || new Set()).add(r); };
  const free = (c, r) => !(occ[c] && occ[c].has(r));
  let seq = 0, maxCol = 0;
  for (const w of want) {
    let col = -1, row = -1;
    if (w.y != null) {
      const r0 = clamp(Math.round(w.y / rowH), 0, rows - 1);
      outer: for (let c = 0; c < 60; c++) for (const dr of [0, 1, -1, 2, -2]) { const r = r0 + dr; if (r >= 0 && r < rows && free(c, r)) { col = c; row = r; break outer; } }
    }
    if (col < 0) { while (!free(Math.floor(seq / rows), seq % rows)) seq++; col = Math.floor(seq / rows); row = seq % rows; seq++; }
    take(col, row); maxCol = Math.max(maxCol, col);
    S.pos.set(w.iri, { x: W + gap + colW * 0.15 + col * colW, y: (row + 0.5) * rowH });
  }
  S.margin = { x0: W + gap * 0.45, y0: -rowH * 0.6, x1: W + gap + (maxCol + 1) * colW, y1: H + rowH * 0.3, n: un.length };
}

/* shown instances that have none of the switched-on connections (drawn at 50 %) */
function computeUnlinked() {
  if (S.settings.dimUnlinked === false || !S.G) return null;
  const G = S.G, has = new Set();
  for (const e of G.edges) {
    if (!edgeOn(e) || !srcOK(G.nodes.get(e.s)) || !srcOK(G.nodes.get(e.o))) continue;
    has.add(e.s); has.add(e.o);
  }
  const out = new Set();
  for (const iri of S.vis) if (!has.has(iri)) out.add(iri);
  return out.size ? out : null;
}
/* the line a connection is drawn as (the live group, or a stand-in when it is not drawn right now) */
function groupKeyOf(e) {
  let a = e.s, b = e.o;
  if (e.dir === -1) { a = e.o; b = e.s; }
  const lo = a < b ? a : b, hi = a < b ? b : a, qaKey = e.cat + '|' + lo + '|' + hi;
  return { key: qaKey + (S.settings.merge ? '' : '|' + e.p), qaKey, lo, hi };
}
function groupForEdge(e, cache) {
  const { key, qaKey, lo, hi } = groupKeyOf(e);
  const live = (S.groupByKey && S.groupByKey.get(key)) || S.groups.find(g => g.key === key);
  if (live) return live;
  if (cache && cache.has(key)) return cache.get(key);
  const G = S.G, g = { key, qaKey, cat: e.cat, a: lo, b: hi, ab: false, ba: false, und: false, edges: [], rank: -1, color: null, hidden: true };
  for (const x of G.edges) {
    if (groupKeyOf(x).key !== key) continue;
    const from = x.dir === -1 ? x.o : x.s;
    if (x.dir === 0) g.und = true; else if (from === lo) g.ab = true; else g.ba = true;
    g.edges.push(x);
    if (x.rank > g.rank) { g.rank = x.rank; g.color = predColor(x.cat, x.p); }
  }
  g.dash = isGlobalKind(G.nodes.get(lo).kind) || isGlobalKind(G.nodes.get(hi).kind);
  g.curv = S.pairCount && S.pairCount.has(lo + '|' + hi) ? 0.9 + 0.4 * S.pairCount.get(lo + '|' + hi) : 0;   /* bend away from lines already drawn between the same pair */
  if (cache) cache.set(key, g);
  return g;
}
function predColor(cat, p) { return S.predColor[cat + '|' + p] || (cat === 'flow' && PRED_SHADE[p]) || S.catColor[cat]; }
function computeGroups() {
  const G = S.G, groups = new Map(), merge = S.settings.merge;
  for (const e of G.edges) {
    if (!edgeOn(e) || !S.vis.has(e.s) || !S.vis.has(e.o)) continue;
    let a = e.s, b = e.o;
    if (e.dir === -1) { a = e.o; b = e.s; }
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const qaKey = e.cat + '|' + lo + '|' + hi;
    const key = qaKey + (merge ? '' : '|' + e.p);
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, qaKey, cat: e.cat, a: lo, b: hi, ab: false, ba: false, und: false, edges: [], rank: -1, color: null });
    if (e.dir === 0) g.und = true; else if (a === lo) g.ab = true; else g.ba = true;
    g.edges.push(e);
    const c = predColor(e.cat, e.p);
    if (e.rank > g.rank) { g.rank = e.rank; g.color = c; }
  }
  const list = [...groups.values()];
  const pairs = new Map();
  for (const g of list) { const k = g.a + '|' + g.b; let arr = pairs.get(k); if (!arr) pairs.set(k, arr = []); arr.push(g); }
  S.pairCount = new Map([...pairs].map(([k, arr]) => [k, arr.length]));
  for (const arr of pairs.values()) {
    arr.sort((x, y) => CAT[x.cat].order - CAT[y.cat].order || x.key.localeCompare(y.key));
    const n = arr.length;
    arr.forEach((g, i) => { g.curv = n === 1 ? 0 : i - (n - 1) / 2; });
  }
  for (const g of list) g.dash = isGlobalKind(G.nodes.get(g.a).kind) || isGlobalKind(G.nodes.get(g.b).kind);
  return list;
}

/* =====================================================================
   7. Rendering — one canvas for lines, nodes and labels (hit-testing in JS).
      Scales to thousands of instances; the drawing itself is an <img> underneath.
   ===================================================================== */
const ov = $('#ov');
const ctx = ov.getContext('2d');
const drawingEl = $('#drawing');
const vp = $('#viewport');
let DPR = 1, VW = 0, VH = 0, theme = null;
function sizeCanvas() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = vp.clientWidth; VH = vp.clientHeight;
  const w = Math.max(1, Math.round(VW * DPR)), hh = Math.max(1, Math.round(VH * DPR));
  if (ov.width !== w || ov.height !== hh) { ov.width = w; ov.height = hh; }
}
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  theme = { plate: v('--plate'), plateInk: v('--plate-ink'), plateMuted: v('--plate-muted'), plateLine: v('--plate-line'), marginFill: v('--margin-fill'), marginLine: v('--margin-line'), muted: v('--muted'), accent: v('--accent') };
}
const FONT = '"IBM Plex Sans", system-ui, sans-serif', MONO = '"IBM Plex Mono", ui-monospace, monospace';
const measureCtx = document.createElement('canvas').getContext('2d');
const measureCache = new Map();
function measure(text, font) {
  const k = font + '|' + text;
  let w = measureCache.get(k);
  if (w == null) { measureCtx.font = font; w = measureCtx.measureText(text).width; measureCache.set(k, w); }
  return w;
}
function rrect(x, y, w, hh, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, hh, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function rebuild() {
  if (!S.G) { S.groups = []; S.vis = new Set(); S.labs = new Map(); frame(); return; }
  S.vis = computeVisible();
  layoutMargin();
  S.groups = computeGroups();
  S.groupByKey = new Map(S.groups.map(g => [g.key, g]));
  S.dashCount = S.groups.reduce((n, g) => n + (g.dash ? 1 : 0), 0);
  S.unlinked = computeUnlinked();
  S.selection = S.selection.filter(i => S.G.nodes.has(i));
  computeSelGroups();
  if (S.pathFocus && S.pathFocus.groups) S.pathFocus.groups = S.pathFocus.groups.map(g => S.groupByKey.get(g.key) || g).filter(g => S.pos.has(g.a) && S.pos.has(g.b));
  buildLabels();
  renderChecks();
  if (S.issueFocus && S.issueFocus.compute) Object.assign(S.issueFocus, S.issueFocus.compute());
  applyFocus();
  renderFocusPill();
  updateCounts();
  updateBanner();
}
function buildLabels() {
  const G = S.G;
  const fs = S.settings.labelSize, fs2 = Math.max(7.5, fs - 1.6);
  const f1 = `600 ${fs}px ${FONT}`, f2 = `${fs2.toFixed(1)}px ${MONO}`;
  S.labs = new Map();
  for (const iri of S.vis) {
    const n = G.nodes.get(iri);
    const name = displayName(n);
    const types = displayTypes(n);
    const t2 = S.settings.showTypes ? (types.length ? qn(types[0]) + (types.length > 1 ? `  +${types.length - 1}` : '') : '(no rdf:type)') : null;
    const w = Math.ceil(Math.max(measure(name, f1), t2 ? measure(t2, f2) : 0) + 10);
    const hh = Math.ceil(6 + fs * 1.18 + (t2 ? fs2 * 1.25 : 0));
    S.labs.set(iri, { name, t2, w, h: hh, fs, fs2, f1, f2, r: rOf(n.kind) });
  }
  S.nodeOrder = [...S.vis].sort((a, b) => kindWeight(G.nodes.get(a).kind) - kindWeight(G.nodes.get(b).kind));
  S.labelOrder = [...S.vis].sort((a, b) => labelPriority(b) - labelPriority(a));
}
function kindWeight(k) { return { location: 0, system: 1, segment: 2, fitting: 3, component: 4, point: 5 }[k] ?? 4; }
function labelPriority(iri) {
  const n = S.G.nodes.get(iri);
  const base = { location: 600, system: 560, component: 400, point: 380, fitting: 120, segment: 80 }[n.kind] ?? 300;
  return base + Math.min(60, n.out.length + n.in.length) + (n.sysToo ? 100 : 0);
}
function refreshNodeClasses() { frame(); }
function frame() { if (!S.raf) S.raf = requestAnimationFrame(draw); }
/* while the view moves, large graphs draw dashed lines as faint solid lines (dashing thousands of long lines is slow) */
let fastTimer = 0;
function interacting() {
  S.fast = true;
  clearTimeout(fastTimer);
  fastTimer = setTimeout(() => { S.fast = false; frame(); }, 180);
}

/* sizes follow the Display settings: node size (× the original) and line width (×) */
const nodeScale = () => clamp(+S.settings.nodeScale || 3, 1, 5);
const lineScale = () => clamp(+S.settings.lineScale || 2, 1, 4);
/* zoomed far out the symbols shrink a little so the overview stays readable; from twice the fit zoom they have the full size */
const zoomDamp = () => (S.fitS ? clamp(Math.sqrt(S.view.s / (S.fitS * 2)), 0.6, 1) : 1);
const rOf = kind => SHAPE_R[kind] * nodeScale() * zoomDamp();
const headLen = () => 9 * (0.6 + 0.4 * lineScale());
const dashPat = () => { const f = 0.7 + 0.3 * lineScale(); return [7 * f, 5 * f]; };
const STRONG = '#f97316';   /* the issue in question: unmistakable on blue lines and a white drawing */
function edgeGeom(g) {
  const A = S.scr.get(g.a), B = S.scr.get(g.b);
  if (!A || !B) return null;
  const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
  const G = S.G;
  const ra = rOf(G.nodes.get(g.a).kind) + 2.5, rb = rOf(G.nodes.get(g.b).kind) + 2.5;
  if (L < ra + rb + 3) return null;
  const ux = dx / L, uy = dy / L;
  const geo = { x1: A[0] + ux * ra, y1: A[1] + uy * ra, x2: B[0] - ux * rb, y2: B[1] - uy * rb, curved: false };
  geo.cx = (geo.x1 + geo.x2) / 2; geo.cy = (geo.y1 + geo.y2) / 2;
  if (g.curv) { const off = g.curv * Math.min(30, L * 0.2); geo.cx -= uy * off; geo.cy += ux * off; geo.curved = true; }
  return geo;
}
function addGeo(geo, trimStart, trimEnd) {
  let { x1, y1, x2, y2 } = geo;
  if (trimEnd) { const tx = x2 - geo.cx, ty = y2 - geo.cy, l = Math.hypot(tx, ty) || 1; x2 -= tx / l * trimEnd; y2 -= ty / l * trimEnd; }
  if (trimStart) { const tx = x1 - geo.cx, ty = y1 - geo.cy, l = Math.hypot(tx, ty) || 1; x1 -= tx / l * trimStart; y1 -= ty / l * trimStart; }
  ctx.moveTo(x1, y1);
  if (geo.curved) ctx.quadraticCurveTo(geo.cx, geo.cy, x2, y2); else ctx.lineTo(x2, y2);
}
function addHead(x, y, fromX, fromY, scale = 1) {
  const dx = x - fromX, dy = y - fromY, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, len = headLen() * scale, wd = len * 0.47;
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * len - uy * wd, y - uy * len + ux * wd);
  ctx.lineTo(x - ux * len + uy * wd, y - uy * len - ux * wd);
  ctx.closePath();
}
function addHeads(g, geo, scale = 1) {
  if (g.ab) addHead(geo.x2, geo.y2, geo.curved ? geo.cx : geo.x1, geo.curved ? geo.cy : geo.y1, scale);
  if (g.ba) addHead(geo.x1, geo.y1, geo.curved ? geo.cx : geo.x2, geo.curved ? geo.cy : geo.y2, scale);
}
function addShape(kind, x, y, r) {
  if (kind === 'location' || kind === 'fitting') { ctx.moveTo(x - r, y - r); ctx.rect(x - r, y - r, 2 * r, 2 * r); }
  else if (kind === 'system') { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); }
  else if (kind === 'point') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
  else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
}
function haloFor(iri) {
  const a = S.anchors.get(iri), qa = (S.qa.nodes[iri] || {}).status;
  if (S.selection.includes(iri)) return { color: theme.accent, width: 3.5 };
  if (qa === 'issue') return { color: '#dc2626', width: 3.5 };
  if (qa === 'ok') return { color: '#16a34a', width: 3 };
  if (qa === 'unsure') return { color: '#d97706', width: 3 };
  if (a && placed(iri) && a.source === 'claude' && a.conf != null && a.conf < 0.6) return { color: '#d97706', width: 3, dash: [2.5, 2.5] };
  return null;
}
const NODE_STYLE = {
  component: { fill: '#1e293b', stroke: '#ffffff', lw: 1.6 }, fitting: { fill: '#1e293b', stroke: '#ffffff', lw: 1.6 },
  segment: { fill: '#ffffff', stroke: '#1e293b', lw: 1.8 }, location: { fill: '#fff7ed', stroke: '#b45309', lw: 2 },
  system: { fill: '#f5f3ff', stroke: '#6d28d9', lw: 2 }, point: { fill: '#16a34a', stroke: '#ffffff', lw: 1.6 },
};
const nodeLw = st => st.lw * (0.7 + 0.3 * nodeScale());
function shapePath(kind, x, y, r) {
  ctx.beginPath();
  if (kind === 'location') { if (ctx.roundRect) ctx.roundRect(x - r, y - r, 2 * r, 2 * r, 2.2 * nodeScale()); else ctx.rect(x - r, y - r, 2 * r, 2 * r); }
  else if (kind === 'fitting') ctx.rect(x - r, y - r, 2 * r, 2 * r);
  else if (kind === 'system') { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); }
  else if (kind === 'point') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
  else ctx.arc(x, y, r, 0, Math.PI * 2);
}
function drawNode(iri, x, y, alpha = 1) {
  const n = S.G.nodes.get(iri), r = rOf(n.kind), st = NODE_STYLE[n.kind];
  ctx.globalAlpha = alpha;
  const hs = haloFor(iri);
  if (hs) { ctx.beginPath(); ctx.arc(x, y, r + 3 + nodeScale(), 0, Math.PI * 2); ctx.strokeStyle = hs.color; ctx.lineWidth = hs.width * (0.8 + 0.2 * nodeScale()); ctx.setLineDash(hs.dash || []); ctx.stroke(); }
  if (iri === S.dragging) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; }
  shapePath(n.kind, x, y, r);
  ctx.fillStyle = st.fill; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.setLineDash(placed(iri) ? [] : [2, 2]);
  ctx.strokeStyle = st.stroke; ctx.lineWidth = nodeLw(st); ctx.stroke();
  ctx.setLineDash([]);
}
const onScreen = (p, m = 20) => p && p[0] > -m && p[1] > -m && p[0] < VW + m && p[1] < VH + m;
const geoOnScreen = geo => !(Math.max(geo.x1, geo.x2, geo.cx) < -20 || Math.min(geo.x1, geo.x2, geo.cx) > VW + 20 || Math.max(geo.y1, geo.y2, geo.cy) < -20 || Math.min(geo.y1, geo.y2, geo.cy) > VH + 20);
function draw() {
  S.raf = 0;
  const T0 = performance.now();
  sizeCanvas();
  if (!theme) readTheme();
  const { s: k, tx, ty } = S.view;
  drawingEl.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  $('#stZoom').textContent = Math.round(k * 100) + '%';
  S.scr.clear();
  S.labRects = [];
  if (!S.G) { drawVeil(); return; }
  for (const iri of S.vis) { const p = S.pos.get(iri); if (p) S.scr.set(iri, [p.x * k + tx, p.y * k + ty]); }
  drawMargin();
  const f = S.focus, LW = lineScale(), trim = headLen() * 0.66;
  const strong = !!(f && f.strong);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  drawFindingsUnder();
  /* batch strokes by style: a few dozen draw calls instead of one per line */
  const strokes = new Map(), heads = new Map(), under = [], glow = [];
  const bucket = (m, key, mk) => { let b = m.get(key); if (!b) m.set(key, b = mk()); return b; };
  for (const g of S.groups) {
    const geo = g.geo = edgeGeom(g);
    if (!geo || !geoOnScreen(geo)) continue;
    const hl = !!f && f.edgeKeys.has(g.key), dim = !!f && !hl;
    const alpha = dim ? 0.1 : 1, width = (hl ? (f.kind === 'hover' ? 3.6 : 3) : g.dash ? 1.6 : 2) * LW;
    if (!dim && ((S.qa.edges[g.qaKey] || {}).status) === 'issue') under.push(geo);
    if (hl && strong) glow.push(geo);
    const lvl = hl ? 2 : dim ? 0 : 1;
    bucket(strokes, `${lvl}|${g.color}|${g.dash ? 1 : 0}|${width}`, () => ({ order: lvl, color: g.color, dash: g.dash, width, alpha, items: [] })).items.push([geo, g.ba ? trim : 0, g.ab ? trim : 0]);
    if (g.ab || g.ba) bucket(heads, `${lvl}|${g.color}`, () => ({ order: lvl, color: g.color, alpha, scale: hl ? 1.2 : 1, items: [] })).items.push([g, geo]);
  }
  if (under.length) {
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.strokeStyle = 'rgba(220,38,38,0.38)'; ctx.lineWidth = 6 + 2.5 * LW; ctx.beginPath();
    for (const geo of under) addGeo(geo, 0, 0);
    ctx.stroke();
  }
  if (glow.length) {   /* the issue in question gets a wide orange glow under its lines */
    ctx.globalAlpha = 0.5; ctx.setLineDash([]); ctx.strokeStyle = STRONG; ctx.lineWidth = 10 + 4 * LW; ctx.beginPath();
    for (const geo of glow) addGeo(geo, 0, 0);
    ctx.stroke();
  }
  const byOrder = (a, b) => a.order - b.order;
  for (const b of [...strokes.values()].sort(byOrder)) {
    /* one stroke per line: a single combined path with many overlapping sub-paths rasterises far slower */
    const cheap = b.dash && S.fast && S.dashCount > 250;
    ctx.globalAlpha = cheap ? b.alpha * 0.45 : b.alpha; ctx.strokeStyle = b.color; ctx.lineWidth = b.width; ctx.setLineDash(b.dash && !cheap ? dashPat() : []);
    for (const [geo, t0, t1] of b.items) { ctx.beginPath(); addGeo(geo, t0, t1); ctx.stroke(); }
  }
  ctx.setLineDash([]);
  for (const b of [...heads.values()].sort(byOrder)) {
    ctx.globalAlpha = b.alpha; ctx.fillStyle = b.color; ctx.beginPath();
    for (const [g, geo] of b.items) addHeads(g, geo, b.scale);
    ctx.fill();
  }
  /* the connection pointed at in the details card */
  const hg = S._hlGroup = S.hlEdgeKey ? (S.groupByKey.get(S.hlEdgeKey) || S.selGroups.find(g => g.key === S.hlEdgeKey) || null) : null;
  if (hg && !hg.hidden && hg.geo) {
    const geo = hg.geo;
    ctx.globalAlpha = 0.3; ctx.strokeStyle = theme.accent; ctx.lineWidth = 9 + 3 * LW; ctx.setLineDash([]);
    ctx.beginPath(); addGeo(geo, 0, 0); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = hg.color; ctx.lineWidth = 3.6 * LW;
    ctx.beginPath(); addGeo(geo, hg.ba ? trim : 0, hg.ab ? trim : 0); ctx.stroke();
    ctx.fillStyle = hg.color; ctx.beginPath(); addHeads(hg, geo, 1.25); ctx.fill();
  }
  /* nodes: batched by kind / dimming / placement */
  const shapes = new Map(), halos = [], rings = [];
  for (const iri of S.nodeOrder) {
    const p = S.scr.get(iri);
    if (!onScreen(p)) continue;
    const n = S.G.nodes.get(iri), dim = !!f && !f.set.has(iri), fade = !dim && isFaded(iri, f);
    const al = dim ? 0.3 : fade ? 0.5 : 1;
    const halo = haloFor(iri);
    if (halo) halos.push([p, rOf(n.kind), halo, al]);
    if (strong && f.set.has(iri)) rings.push([p, rOf(n.kind)]);
    if (iri === S.dragging || S.selection.includes(iri)) continue;
    const lvl = dim ? 0 : fade ? 1 : 2;
    bucket(shapes, `${lvl}|${n.kind}|${placed(iri) ? 1 : 0}`, () => ({ order: lvl, kind: n.kind, alpha: al, placed: placed(iri), items: [] })).items.push(p);
  }
  for (const [p, r] of rings) {
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(p[0], p[1], r + 6 + nodeScale(), 0, Math.PI * 2);
    ctx.strokeStyle = STRONG; ctx.lineWidth = 4; ctx.setLineDash([]); ctx.stroke();
  }
  for (const [p, r, hs, al] of halos) {
    ctx.globalAlpha = al; ctx.beginPath(); ctx.arc(p[0], p[1], r + 3 + nodeScale(), 0, Math.PI * 2);
    ctx.strokeStyle = hs.color; ctx.lineWidth = hs.width * (0.8 + 0.2 * nodeScale()); ctx.setLineDash(hs.dash || []); ctx.stroke();
  }
  if (S.marked && S.marked.size) {   /* items marked in Review & checks */
    ctx.globalAlpha = 1; ctx.strokeStyle = theme.accent; ctx.lineWidth = 2; ctx.setLineDash([3, 2.5]);
    for (const iri of S.marked) {
      const p = S.scr.get(iri), n = S.G.nodes.get(iri);
      if (!n || !onScreen(p)) continue;
      ctx.beginPath(); ctx.arc(p[0], p[1], rOf(n.kind) + 7 + nodeScale(), 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  for (const b of [...shapes.values()].sort(byOrder)) {
    const st = NODE_STYLE[b.kind], r = rOf(b.kind);
    ctx.globalAlpha = b.alpha;
    ctx.beginPath();
    for (const p of b.items) addShape(b.kind, p[0], p[1], r);
    ctx.fillStyle = st.fill; ctx.fill();
    ctx.setLineDash(b.placed ? [] : [2, 2]); ctx.strokeStyle = st.stroke; ctx.lineWidth = nodeLw(st); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (S.dragging && S.scr.get(S.dragging) && !S.selection.includes(S.dragging)) { const p = S.scr.get(S.dragging); drawNode(S.dragging, p[0], p[1], 1); }
  ctx.globalAlpha = 1;
  drawFindingsOver();
  ctx.globalAlpha = 1;
  const T1 = performance.now();
  placeLabels(f);
  ctx.globalAlpha = 1;
  drawOverlay(f);
  ctx.globalAlpha = 1;
  drawVeil();
  S.perf = { edgesNodes: T1 - T0, labels: performance.now() - T1 };
}
/* a faded node: none of its connections are switched on (unless it is in focus or selected) */
function isFaded(iri, f) {
  return !!S.unlinked && S.unlinked.has(iri) && !S.selection.includes(iri) && iri !== S.longHover && !(f && f.kind !== 'all' && f.set.has(iri) && f.set.size < S.vis.size);
}
/* on top of everything: the selection's connections (hidden ones dimmed), a found path, then the selected nodes and their labels */
function drawOverlay(f) {
  const LW = lineScale(), trim = headLen() * 0.66;
  const layers = [];
  if (S.pathFocus && S.pathFocus.groups) for (const g of S.pathFocus.groups) layers.push([g, 'path']);
  else if (f && f.kind === 'issue' && f.groups) for (const g of f.groups) layers.push([g, 'path']);
  for (const g of S.selGroups) layers.push([g, 'sel']);
  if (!layers.length && !S.selection.length) return;
  for (const [g, kind] of layers) {
    const geo = g.ogeo = edgeGeom(g);
    if (!geo || !geoOnScreen(geo)) continue;
    const pop = S.edgePopOpen && S.edgePopKey === g.key, hov = S.hlEdgeKey === g.key;
    let alpha = g.hidden ? 0.4 : 1;
    if (kind === 'sel' && S.edgePopOpen && !pop) alpha *= 0.45;
    if (kind === 'path' || pop || hov) {
      ctx.globalAlpha = kind === 'path' ? 0.55 : 0.35; ctx.strokeStyle = kind === 'path' ? STRONG : theme.accent; ctx.lineWidth = 10 + 4 * LW; ctx.setLineDash([]);
      ctx.beginPath(); addGeo(geo, 0, 0); ctx.stroke();
      alpha = 1;
    }
    ctx.globalAlpha = alpha; ctx.strokeStyle = g.color; ctx.lineWidth = (g.hidden ? 1.8 : 2.6) * LW * (pop || hov ? 1.3 : 1);
    ctx.setLineDash(g.hidden ? [5 * LW, 4 * LW] : g.dash ? dashPat() : []);
    ctx.beginPath(); addGeo(geo, g.ba ? trim : 0, g.ab ? trim : 0); ctx.stroke();
    ctx.setLineDash([]);
    if (g.ab || g.ba) { ctx.fillStyle = g.color; ctx.beginPath(); addHeads(g, geo, pop || hov ? 1.3 : 1.1); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  for (const iri of S.selection) { const p = S.scr.get(iri); if (onScreen(p, 60)) drawNode(iri, p[0], p[1], 1); }
  for (const iri of S.selection) { const L = S.labRects.find(r => r.iri === iri); if (L) drawPlate(iri, L, 1); }
}
function drawMargin() {
  const m = S.margin;
  if (!m) return;
  const { s: k, tx, ty } = S.view;
  const x = m.x0 * k + tx, y = m.y0 * k + ty, w = (m.x1 - m.x0) * k, hh = (m.y1 - m.y0) * k;
  rrect(x, y, Math.max(0, w), Math.max(0, hh), 10);
  ctx.fillStyle = theme.marginFill; ctx.fill();
  ctx.setLineDash([6, 5]); ctx.strokeStyle = theme.marginLine; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = theme.muted; ctx.font = `600 12px ${FONT}`; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`NOT PLACED ON THIS DRAWING (${m.n})`, x + 12, y - 8);
}
function drawPlate(iri, rect, alpha) {
  const lab = S.labs.get(iri);
  if (!lab) return;
  ctx.globalAlpha = alpha;
  rrect(rect.x, rect.y, rect.w, rect.h, 3);
  ctx.fillStyle = theme.plate; ctx.fill();
  ctx.setLineDash(placed(iri) ? [] : [3, 2]); ctx.strokeStyle = S.selection.includes(iri) ? theme.accent : theme.plateLine; ctx.lineWidth = S.selection.includes(iri) ? 1.5 : 1; ctx.stroke(); ctx.setLineDash([]);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.plateInk; ctx.font = lab.f1;
  ctx.fillText(lab.name, rect.x + 4.5, rect.y + 2.5 + lab.fs * 0.93);
  if (lab.t2) { ctx.fillStyle = theme.plateMuted; ctx.font = lab.f2; ctx.fillText(lab.t2, rect.x + 4.5, rect.y + 2.5 + lab.fs * 1.18 + lab.fs2 * 0.98); }
}
function placeLabels(f) {
  const CELL = 40, grid = new Map();
  const cells = (r, fn) => {
    const c0 = Math.floor(r.x / CELL), c1 = Math.floor((r.x + r.w) / CELL), r0 = Math.floor(r.y / CELL), r1 = Math.floor((r.y + r.h) / CELL);
    for (let c = c0; c <= c1; c++) for (let rr = r0; rr <= r1; rr++) if (fn(c + ',' + rr) === false) return false;
    return true;
  };
  const hits = r => !cells(r, key => { const arr = grid.get(key); if (arr) for (const o of arr) if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) return false; });
  const occupy = r => cells(r, key => { let arr = grid.get(key); if (!arr) grid.set(key, arr = []); arr.push(r); });
  const declutter = S.settings.declutter;
  if (declutter) for (const [iri, p] of S.scr) if (onScreen(p)) { const r = rOf(S.G.nodes.get(iri).kind); occupy({ x: p[0] - r, y: p[1] - r, w: 2 * r, h: 2 * r }); }
  const forced = f ? f.set : new Set();
  const first = [...S.selection];
  if (S.longHover && !first.includes(S.longHover)) first.push(S.longHover);
  const hlEnds = S._hlGroup ? [S._hlGroup.a, S._hlGroup.b] : [];
  for (const iri of hlEnds) if (!first.includes(iri)) first.push(iri);
  const firstSet = new Set(first);
  const order = first.filter(i => S.labs.has(i));
  if (forced.size <= 400) for (const iri of forced) if (!firstSet.has(iri) && S.labs.has(iri)) order.push(iri);
  for (const iri of S.labelOrder || []) if (!(forced.size <= 400 && forced.has(iri)) && !firstSet.has(iri)) order.push(iri);
  const showAllForced = forced.size > 0 && forced.size <= 80;
  for (const iri of order) {
    const lab = S.labs.get(iri), p = S.scr.get(iri);
    if (!lab || !p) continue;
    if (p[0] < -300 || p[1] < -60 || p[0] > VW + 60 || p[1] > VH + 60) continue;
    const dim = !!f && !f.set.has(iri);
    if (!firstSet.has(iri) && isFaded(iri, f)) continue;   /* faded nodes show their label only on a long hover */
    const w = lab.w, hh = lab.h, r = rOf(S.G.nodes.get(iri).kind) + 4;
    const cands = [[r, -hh / 2], [-r - w, -hh / 2], [-w / 2, r], [-w / 2, -r - hh], [r, -hh - 2], [r, 2]];
    const must = !declutter || firstSet.has(iri) || (showAllForced && forced.has(iri));
    let rect = null;
    for (const [ox, oy] of cands) { const c = { x: Math.round(p[0] + ox) + 0.5, y: Math.round(p[1] + oy) + 0.5, w, h: hh }; if (!hits(c)) { rect = c; break; } }
    if (!rect && must) rect = { x: Math.round(p[0] + cands[0][0]) + 0.5, y: Math.round(p[1] + cands[0][1]) + 0.5, w, h: hh };
    if (!rect) continue;
    if (declutter) occupy(rect);
    drawPlate(iri, rect, dim ? 0.35 : 1);
    S.labRects.push({ iri, x: rect.x, y: rect.y, w, h: hh });
  }
}

/* hit-testing (viewport coordinates) */
function nodeAt(x, y) {
  let best = null, bd = Infinity;
  for (const [iri, p] of S.scr) {
    const r = Math.max(rOf(S.G.nodes.get(iri).kind) + 3, 9);
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d <= r && d < bd) { bd = d; best = iri; }
  }
  if (best) return best;
  for (let i = S.labRects.length - 1; i >= 0; i--) { const L = S.labRects[i]; if (x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h) return L.iri; }
  return null;
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function geoDist(geo, x, y) {
  if (!geo.curved) return segDist(x, y, geo.x1, geo.y1, geo.x2, geo.y2);
  let d = Infinity, px = geo.x1, py = geo.y1;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8, u = 1 - t;
    const qx = u * u * geo.x1 + 2 * u * t * geo.cx + t * t * geo.x2, qy = u * u * geo.y1 + 2 * u * t * geo.cy + t * t * geo.y2;
    d = Math.min(d, segDist(x, y, px, py, qx, qy)); px = qx; py = qy;
  }
  return d;
}
function edgeAt(x, y) {
  const tol = 4 + 1.5 * lineScale();
  /* the selection's connections lie on top, hidden ones included */
  let best = null, bd = tol;
  const extra = S.focus && S.focus.kind === 'issue' && S.focus.groups || [];
  for (const g of [...(S.pathFocus && S.pathFocus.groups || []), ...extra, ...S.selGroups]) { if (!g.ogeo) continue; const d = geoDist(g.ogeo, x, y); if (d < bd) { bd = d; best = g; } }
  if (best) return best;
  for (const g of S.groups) {
    if (!g.geo) continue;
    if (S.focus && !S.focus.edgeKeys.has(g.key) && S.selection.length) continue;   /* dimmed lines don't catch clicks while something is selected */
    const d = geoDist(g.geo, x, y);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

/* focus / highlight */
function neighbourhood(iris) {
  const set = new Set(iris), edges = new Set(), want = new Set(iris);
  for (const g of S.groups) if (want.has(g.a) || want.has(g.b)) { set.add(g.a); set.add(g.b); edges.add(g.key); }
  for (const g of S.selGroups) if (want.has(g.a) || want.has(g.b)) { set.add(g.a); set.add(g.b); edges.add(g.key); }
  return { set, edges };
}
function systemMembers(sysIri) {
  const G = S.G, members = new Set([sysIri]), stack = [sysIri];
  while (stack.length) {
    const x = stack.pop(), n = G.nodes.get(x);
    for (const idx of [...n.out, ...n.in]) {
      const e = G.edges[idx];
      if (e.cat !== 'system' && e.cat !== 'composition') continue;
      const from = e.dir === -1 ? e.o : e.s, to = e.dir === -1 ? e.s : e.o;
      if (from === x && !members.has(to)) { members.add(to); stack.push(to); }
    }
  }
  return members;
}
function flaggedSet() {
  const set = new Set(), edges = new Set();
  for (const [iri, v] of Object.entries(S.qa.nodes)) if (v.status === 'issue' || v.status === 'unsure') set.add(iri);
  for (const g of S.groups) { const st = (S.qa.edges[g.qaKey] || {}).status; if (st === 'issue' || st === 'unsure') { edges.add(g.key); set.add(g.a); set.add(g.b); } }
  return { set, edges };
}
/* what is in focus, most specific first: a long hover, an open connection card, a found path, the selection,
   an issue / report / query highlight, a system, flagged items only */
function applyFocus() {
  let f = null;
  if (S.longHover && S.vis.has(S.longHover)) f = { ...neighbourhood([S.longHover]), kind: 'hover' };
  else if (S.edgePopOpen && S._popGroup) f = { set: new Set([S._popGroup.a, S._popGroup.b]), edges: new Set([S._popGroup.key]), kind: 'edge' };
  else if (S.pathFocus) f = { ...S.pathFocus, kind: 'path' };
  else if (S.selection.length) f = { ...neighbourhood(S.selection), kind: 'sel' };
  else if (S.issueFocus) f = { ...S.issueFocus, kind: 'issue' };
  else if (S.focusSystem && S.sysMembers) f = { set: S.sysMembers, edges: new Set(S.groups.filter(g => S.sysMembers.has(g.a) && S.sysMembers.has(g.b)).map(g => g.key)), kind: 'system' };
  else if (S.settings.flaggedOnly) f = { ...flaggedSet(), kind: 'flagged' };
  if (f) f.edgeKeys = new Set([...(f.edges || [])].map(g => (typeof g === 'string' ? g : g.key)));
  S.focus = f;
  S.focusSet = f ? f.set : null;
  frame();
}

/* =====================================================================
   8. View & interaction
   ===================================================================== */
function contentBounds() {
  const W = drawW(), H = drawH();
  let x0 = 0, y0 = 0, x1 = W || 1000, y1 = H;
  if (S.margin) { x1 = Math.max(x1, S.margin.x1); y0 = Math.min(y0, S.margin.y0); x1 = Math.max(x1, S.margin.x1); }
  if (!W && S.margin) x0 = S.margin.x0;
  return { x0, y0, x1, y1 };
}
function fitTargetAll() {
  const vw = vp.clientWidth || 800, vh = vp.clientHeight || 600;
  const b = contentBounds();
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const padL = vw > 700 ? 70 : 16;   /* labels of nodes on the left edge flip outwards */
  const availW = vw - padL - 20 - (S.margin ? 150 : 0);   /* room for labels of the unplaced column */
  const s = Math.min(availW / bw, (vh - 90) / bh);
  S.fitS = s;
  return { s, tx: padL + (availW - bw * s) / 2 - b.x0 * s, ty: (vh - bh * s) / 2 - b.y0 * s + 18 };
}
function fitView(animate) {
  const t = fitTargetAll();
  if (animate) animateTo(t); else { cancelAnimationFrame(tween); S.view = t; frame(); }
}
function zoomAt(cx, cy, factor) {
  cancelAnimationFrame(tween);
  const k0 = S.view.s, k = clamp(k0 * factor, S.fitS * 0.3, 8);
  const f = k / k0;
  S.view.tx = cx - (cx - S.view.tx) * f; S.view.ty = cy - (cy - S.view.ty) * f; S.view.s = k;
  interacting(); frame();
}
function toWorld(clientX, clientY) {
  const r = vp.getBoundingClientRect();
  return { x: (clientX - r.left - S.view.tx) / S.view.s, y: (clientY - r.top - S.view.ty) / S.view.s };
}
let tween = 0;
function animateTo(target, dur = 420) {
  const from = { ...S.view }, t0 = performance.now();
  cancelAnimationFrame(tween);
  const step = now => {
    const t = Math.min(1, (now - t0) / dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    /* interpolate the scale geometrically so zooming feels even */
    const s = from.s * Math.pow(target.s / from.s, e);
    const cx0 = (vp.clientWidth / 2 - from.tx) / from.s, cy0 = (vp.clientHeight / 2 - from.ty) / from.s;
    const cx1 = (vp.clientWidth / 2 - target.tx) / target.s, cy1 = (vp.clientHeight / 2 - target.ty) / target.s;
    const cx = cx0 + (cx1 - cx0) * e, cy = cy0 + (cy1 - cy0) * e;
    S.view = t >= 1 ? { ...target } : { s, tx: vp.clientWidth / 2 - cx * s, ty: vp.clientHeight / 2 - cy * s };
    interacting(); frame();
    if (t < 1) tween = requestAnimationFrame(step);
  };
  tween = requestAnimationFrame(step);
}
/* the view that shows all points, leaving room for the details card (right) or the bottom sheet (phones) */
function fitTarget(points, opts = {}) {
  const vw = vp.clientWidth, vh = vp.clientHeight;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const phone = window.innerWidth <= 820;
  const padL = phone ? 24 : 80, padT = phone ? 70 : 80, padR = phone ? 24 : opts.card ? 420 : 80, padB = phone && opts.card ? vh * 0.62 + 16 : 90;
  const aw = Math.max(60, vw - padL - padR), ah = Math.max(60, vh - padT - padB);
  let s;
  if (x1 - x0 < 2 && y1 - y0 < 2) s = clamp(Math.max(S.view.s, Math.min(0.55, S.fitS * 4)), S.fitS * 0.5, 8);
  else s = clamp(Math.min(aw / (x1 - x0), ah / (y1 - y0)), S.fitS * 0.5, opts.maxS ?? Math.max(S.view.s, S.fitS * 5));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { s, tx: padL + aw / 2 - cx * s, ty: padT + ah / 2 - cy * s };
}
function centerOn(points, minScale) {
  if (!points.length) return;
  const t = fitTarget(points, { card: !$('#insp').hidden });
  if (points.length === 1 && minScale != null) t.s = Math.max(t.s, minScale);
  if (points.length === 1) { const p = points[0], vw = vp.clientWidth, vh = vp.clientHeight; const phone = window.innerWidth <= 820; t.tx = (phone ? vw / 2 : (vw - (!$('#insp').hidden ? 400 : 0)) / 2) - p.x * t.s; t.ty = (phone && !$('#insp').hidden ? vh * 0.22 : vh / 2) - p.y * t.s; }
  animateTo(t, 320);
}

const ptrs = new Map();
let gesture = null;
vp.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  hideTip(); cancelLongHover();
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { vp.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  if (ptrs.size === 2) {
    if (gesture && gesture.type === 'node' && gesture.moved) { S.pos.set(gesture.iri, gesture.p0); }
    const [p1, p2] = [...ptrs.values()];
    const r = vp.getBoundingClientRect();
    gesture = { type: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), view0: { ...S.view }, m0: { x: (p1.x + p2.x) / 2 - r.left, y: (p1.y + p2.y) / 2 - r.top } };
    return;
  }
  if (ptrs.size > 2) return;
  cancelAnimationFrame(tween);
  const r0 = vp.getBoundingClientRect();
  const hitIri = S.G && !S.areaMode ? nodeAt(e.clientX - r0.left, e.clientY - r0.top) : null;
  const hitG = S.G && !hitIri && !S.areaMode ? edgeAt(e.clientX - r0.left, e.clientY - r0.top) : null;
  gesture = { type: hitIri ? 'node' : 'pan', iri: hitIri, g: hitG, x0: e.clientX, y0: e.clientY, tx0: S.view.tx, ty0: S.view.ty, moved: false };
  if (gesture.type === 'node') {
    const p = S.pos.get(gesture.iri), w = toWorld(e.clientX, e.clientY);
    gesture.p0 = { ...p }; gesture.grab = { x: w.x - p.x, y: w.y - p.y };
  }
});
vp.addEventListener('pointermove', e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (S.drawing) { const w = toWorld(e.clientX, e.clientY); $('#stXY').textContent = `x ${Math.round(w.x)} · y ${Math.round(w.y)}`; }
  if (!gesture) { hoverAt(e); return; }
  if (gesture.type === 'pinch') {
    if (ptrs.size < 2) return;
    const [p1, p2] = [...ptrs.values()];
    const r = vp.getBoundingClientRect();
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y), m = { x: (p1.x + p2.x) / 2 - r.left, y: (p1.y + p2.y) / 2 - r.top };
    const v0 = gesture.view0, k = clamp(v0.s * d / gesture.d0, S.fitS * 0.3, 8);
    const wx = (gesture.m0.x - v0.tx) / v0.s, wy = (gesture.m0.y - v0.ty) / v0.s;
    S.view = { s: k, tx: m.x - wx * k, ty: m.y - wy * k };
    interacting(); frame();
    return;
  }
  const dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
  if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
  gesture.moved = true;
  if (gesture.type === 'pan') {
    vp.classList.add('panning');
    S.view.tx = gesture.tx0 + dx; S.view.ty = gesture.ty0 + dy;
    interacting(); frame();
  } else if (gesture.type === 'node') {
    const w = toWorld(e.clientX, e.clientY);
    S.pos.set(gesture.iri, { x: w.x - gesture.grab.x, y: w.y - gesture.grab.y });
    S.dragging = gesture.iri;
    interacting(); frame();
  }
});
function endGesture(e, cancelled) {
  ptrs.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.type === 'pinch') { if (ptrs.size === 0) gesture = null; return; }
  const g = gesture; gesture = null;
  vp.classList.remove('panning');
  if (g.type === 'node') {
    S.dragging = null;
    if (cancelled) { S.pos.set(g.iri, g.p0); frame(); return; }
    if (g.moved) commitMove(g.iri, S.pos.get(g.iri), g.p0);
    else select(g.iri, { add: e.ctrlKey || e.metaKey });
  } else if (!g.moved && !cancelled) {
    if (S.areaMode) areaClick(e.clientX, e.clientY);
    else if (g.g) { if (S.edgePopOpen && S.edgePopKey === g.g.key) closeEdgePop(); else openEdgePop(g.g, e.clientX, e.clientY); }
    else backgroundClick();
  }
}
/* clicking empty canvas: close what is open and return to the view before; with nothing chosen, clear every highlight */
function backgroundClick() {
  const had = S.selection.length || S.edgePopOpen;
  closeEdgePop();
  if (S.selection.length) { deselect(); return; }
  if (had) return;
  clearTransient();
}
function clearTransient() {
  let changed = false;
  if (S.selArea || S.selFinding) { S.selArea = null; S.selFinding = null; changed = true; }
  if (S.issueFocus) { clearIssueFocus(); changed = true; }
  if (S.pathFocus) { S.pathFocus = null; changed = true; }
  if (S.issueSel) { S.issueSel = null; renderIssues(); }
  if (S.sparqlSel != null) { S.sparqlSel = null; renderSparql(); }
  if (changed) { applyFocus(); frame(); }
}
vp.addEventListener('pointerup', e => endGesture(e, false));
vp.addEventListener('pointercancel', e => endGesture(e, true));
vp.addEventListener('pointerleave', () => { if (!gesture) { setHover(null); hideTip(); if (S.areaHover) { S.areaHover = null; frame(); } } });
vp.addEventListener('wheel', e => {
  e.preventDefault();
  const r = vp.getBoundingClientRect();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016)));
}, { passive: false });

function hoverAt(e) {
  if (S.areaMode) { if (e.pointerType === 'mouse') { S.areaHover = toWorld(e.clientX, e.clientY); vp.style.cursor = 'crosshair'; frame(); } return; }
  if (!S.G || e.target !== ov) { setHover(null); hideTip(); return; }
  const r = vp.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const iri = nodeAt(x, y);
  const g = iri ? null : edgeAt(x, y);
  setHover(iri);
  vp.style.cursor = iri || g ? 'pointer' : '';
  if (iri) showNodeTip(iri, e);
  else if (g) showEdgeTip(g, e);
  else hideTip();
}
/* a long hover (≈ 0.9 s) on a node shows its label and thickens all its lines */
const LONG_HOVER_MS = 900;
function cancelLongHover() {
  clearTimeout(S.lhTimer);
  if (S.longHover) { S.longHover = null; applyFocus(); }
}
function setHover(iri) {
  if (S.hovered === iri) return;
  S.hovered = iri;
  cancelLongHover();
  if (iri) S.lhTimer = setTimeout(() => { if (S.hovered === iri && !gesture) { S.longHover = iri; applyFocus(); } }, LONG_HOVER_MS);
  frame();
}
function stagePoint(e) { const r = $('#stage').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function placeTip(tip, e) {
  const st = $('#stage'), p = stagePoint(e);
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = p.x + 14, y = p.y + 14;
  if (x + tw > st.clientWidth - 8) x = p.x - tw - 14;
  if (y + th > st.clientHeight - 8) y = p.y - th - 14;
  tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
}
function showNodeTip(iri, e) {
  const n = S.G.nodes.get(iri), tip = $('#tip');
  const types = displayTypes(n);
  tip.textContent = '';
  tip.append(h('div', { style: { fontWeight: 600, fontFamily: 'var(--font)', color: 'var(--ink)' } }, displayName(n)));
  tip.append(h('div', null, types.map(qn).join(', ') || '(no rdf:type)'));
  const a = S.anchors.get(iri);
  tip.append(h('div', null, placed(iri) ? `placed · ${a.source}${a.conf != null && a.source === 'claude' ? ' · conf ' + a.conf : ''}` : S.off.has(iri) ? 'not on this drawing' : 'not placed yet'));
  if (S.selection.length && !S.selection.includes(iri)) tip.append(h('div', { style: { color: 'var(--muted)' } }, (navigator.platform || '').startsWith('Mac') ? '⌘-click to add to the selection' : 'Ctrl-click to add to the selection'));
  placeTip(tip, e);
}
function showEdgeTip(g, e) {
  const tip = $('#tip');
  tip.textContent = '';
  tip.append(h('div', { style: { fontWeight: 600, fontFamily: 'var(--font)', color: 'var(--ink)' } }, CAT[g.cat].name + (g.hidden ? ' · hidden under Connections' : '') + (g.dash ? ' · involves location/system' : '')));
  for (const ed of g.edges.slice(0, 6)) tip.append(h('div', null, `${S.G.nodes.get(ed.s).local}  ${qn(ed.p)}  ${S.G.nodes.get(ed.o).local}`));
  if (g.edges.length > 6) tip.append(h('div', null, `+${g.edges.length - 6} more`));
  placeTip(tip, e);
}
function hideTip() { $('#tip').hidden = true; }

/* ---------- undo / redo: every edit is recorded as a diff of placements, off-drawing marks and review records ---------- */
const HISTORY_MAX = 200;
function snapshot() {
  return { anchors: new Map(S.anchors), off: new Set(S.off), qn: JSON.parse(JSON.stringify(S.qa.nodes)), qe: JSON.parse(JSON.stringify(S.qa.edges)),
    fd: JSON.parse(JSON.stringify(S.findings)), runs: JSON.parse(JSON.stringify(S.recheckRuns)), rules: JSON.parse(JSON.stringify(S.rules)),
    changes: JSON.parse(JSON.stringify(S.changes)) };
}
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function commit(label, snap) {
  if (!snap) return;
  const ch = { label, anchors: [], off: [], qn: [], qe: [], fd: [], runs: null };
  const fb = new Map(snap.fd.map(f => [f.id, f])), fa = new Map(S.findings.map(f => [f.id, f]));
  for (const id of new Set([...fb.keys(), ...fa.keys()])) if (!sameJson(fb.get(id), fa.get(id))) ch.fd.push([id, fb.get(id) ? JSON.parse(JSON.stringify(fb.get(id))) : null, fa.get(id) ? JSON.parse(JSON.stringify(fa.get(id))) : null]);
  if (!sameJson(snap.runs, S.recheckRuns)) ch.runs = [snap.runs, JSON.parse(JSON.stringify(S.recheckRuns))];
  if (!sameJson(snap.rules, S.rules)) ch.rules = [snap.rules, JSON.parse(JSON.stringify(S.rules))];
  if (snap.changes && !sameJson(snap.changes, S.changes)) ch.changes = [snap.changes, JSON.parse(JSON.stringify(S.changes))];
  for (const k of new Set([...snap.anchors.keys(), ...S.anchors.keys()])) {
    const a = snap.anchors.get(k), b = S.anchors.get(k);
    if (!sameJson(a, b)) ch.anchors.push([k, a ? { ...a } : null, b ? { ...b } : null]);
  }
  for (const k of new Set([...snap.off, ...S.off])) { const a = snap.off.has(k), b = S.off.has(k); if (a !== b) ch.off.push([k, a, b]); }
  for (const [list, before, now] of [[ch.qn, snap.qn, S.qa.nodes], [ch.qe, snap.qe, S.qa.edges]]) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(now)])) {
      if (!sameJson(before[k], now[k])) list.push([k, before[k] ? JSON.parse(JSON.stringify(before[k])) : null, now[k] ? JSON.parse(JSON.stringify(now[k])) : null]);
    }
  }
  if (!ch.anchors.length && !ch.off.length && !ch.qn.length && !ch.qe.length && !ch.fd.length && !ch.runs && !ch.rules && !ch.changes) return;
  S.undo.push(ch);
  if (S.undo.length > HISTORY_MAX) S.undo.shift();
  S.redo = [];
  updateUndo();
}
function applyChange(ch, side) {
  for (const [k, a, b] of ch.anchors) { const v = side ? b : a; if (v) S.anchors.set(k, { ...v }); else S.anchors.delete(k); }
  for (const [k, a, b] of ch.off) { if (side ? b : a) S.off.add(k); else S.off.delete(k); }
  for (const [k, a, b] of ch.qn) { const v = side ? b : a; if (v) S.qa.nodes[k] = JSON.parse(JSON.stringify(v)); else delete S.qa.nodes[k]; }
  for (const [k, a, b] of ch.qe) { const v = side ? b : a; if (v) S.qa.edges[k] = JSON.parse(JSON.stringify(v)); else delete S.qa.edges[k]; }
  if (ch.fd && ch.fd.length) {
    const map = new Map(S.findings.map(f => [f.id, f]));
    for (const [id, a, b] of ch.fd) { const v = side ? b : a; if (v) map.set(id, JSON.parse(JSON.stringify(v))); else map.delete(id); }
    S.findings = [...map.values()].sort((x, y) => (x.seq || 0) - (y.seq || 0));
  }
  if (ch.runs) S.recheckRuns = JSON.parse(JSON.stringify(ch.runs[side ? 1 : 0]));
  if (ch.rules) S.rules = JSON.parse(JSON.stringify(ch.rules[side ? 1 : 0]));
  if (ch.changes) { S.changes = JSON.parse(JSON.stringify(ch.changes[side ? 1 : 0])); S.changeSeq = S.changes.reduce((m, c) => Math.max(m, c.seq || 0), S.changeSeq || 0); }
}
function undo() {
  const ch = S.undo.pop();
  if (!ch) return;
  applyChange(ch, 0); S.redo.push(ch); afterHistory(ch, 'Undone');
}
function redo() {
  const ch = S.redo.pop();
  if (!ch) return;
  applyChange(ch, 1); S.undo.push(ch); afterHistory(ch, 'Redone');
}
function afterHistory(ch, verb) {
  if (ch.changes) regraph();
  persist(); rebuild(); updateQaSummary(); updateUndo(); renderFindings();
  refreshInspector();
  if (!$('#edgePop').hidden && S.edgePopKey) {
    const g = S.groups.find(x => x.key === S.edgePopKey);
    if (g) openEdgePop(g, 0, 0, { keepPos: true }); else closeEdgePop();
  }
  toast(`${verb}: ${ch.label}`, null, 1800);
}
function updateUndo() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (!u || !r) return;
  u.disabled = !S.undo.length; r.disabled = !S.redo.length;
  u.title = S.undo.length ? `Undo: ${S.undo[S.undo.length - 1].label} (Ctrl/⌘+Z)` : 'Nothing to undo';
  r.title = S.redo.length ? `Redo: ${S.redo[S.redo.length - 1].label} (Ctrl/⌘+Shift+Z)` : 'Nothing to redo';
  u.setAttribute('aria-label', u.title); r.setAttribute('aria-label', r.title);
}

function commitMove(iri, p, p0) {
  const W = drawW(), H = drawH();
  const inside = S.drawing && p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
  const snap = snapshot();
  const name = S.G.nodes.get(iri).local;
  const wasPlaced = placed(iri);
  if (inside) {
    S.anchors.set(iri, { x: Math.round(p.x), y: Math.round(p.y), source: 'manual', conf: 1, why: 'moved by reviewer' });
    S.off.delete(iri);
  } else if (wasPlaced) {
    S.anchors.delete(iri); S.off.add(iri);
    toast(`${S.G.nodes.get(iri).local} marked as not on this drawing`, { label: 'Undo', fn: undo });
  } else {
    S.pos.set(iri, p0); frame(); return;
  }
  commit(inside ? `move ${name}` : `mark ${name} not on drawing`, snap);
  persist();
  if (wasPlaced !== placed(iri)) rebuild();
  else { S.pos.set(iri, { x: S.anchors.get(iri).x, y: S.anchors.get(iri).y }); renderChecks(); frame(); }
  if (S.selection.includes(iri)) refreshInspector();
}

/* ---------- selection: one or more instances (Ctrl/⌘-click adds or removes) ---------- */
function computeSelGroups() {
  S.selGroups = [];
  if (!S.selection.length || !S.G) return;
  const seen = new Map(), cache = new Map();
  for (const iri of S.selection) {
    const n = S.G.nodes.get(iri);
    if (!n || !S.pos.has(iri)) continue;
    for (const idx of [...n.out, ...n.in]) {
      const e = S.G.edges[idx], other = e.s === iri ? e.o : e.s;
      if (!S.pos.has(other) || !srcOK(S.G.nodes.get(other))) continue;
      const gk = groupKeyOf(e).key;
      if (seen.has(gk)) continue;
      seen.set(gk, S.groupByKey.get(gk) || groupForEdge(e, cache));
    }
  }
  S.selGroups = [...seen.values()];
}
function selectionSpanPoints() {
  const pts = [];
  for (const iri of S.selection) { const p = S.pos.get(iri); if (p) pts.push(p); }
  for (const g of S.selGroups) for (const x of [g.a, g.b]) { const p = S.pos.get(x); if (p) pts.push(p); }
  return pts;
}
function select(iri, opts = {}) {
  const n = S.G.nodes.get(iri);
  if (!n) return;
  if (!S.vis.has(iri)) {
    if (S.scope !== 'full') { setScope('full'); toast(`Switched to Full graph to show ${n.local}`); }
    else if (!srcOK(n)) { S.srcOff.clear(); renderSources(); rebuild(); }
  }
  let sel = S.selection.slice();
  if (opts.add) {
    const i = sel.indexOf(iri);
    if (i >= 0) { sel.splice(i, 1); if (!sel.length) { deselect(); return; } }
    else sel.push(iri);
  } else sel = [iri];
  S.selection = sel;
  S.selected = sel.includes(iri) ? iri : sel[sel.length - 1];
  S.inspTab = sel.length > 1 ? 'all' : S.selected;
  S.pathFocus = null; S.pathInfo = null;
  cancelLongHover();
  closeEdgePop(true);
  computeSelGroups();
  applyFocus();
  openInspector();
  if (opts.zoom !== false) {
    if (!S.viewSaved) S.viewSaved = { ...S.view };
    const pts = selectionSpanPoints();
    if (pts.length) animateTo(fitTarget(pts, { card: true }));
  }
}
function deselect(opts = {}) {
  if (!S.selection.length) return;
  S.selection = []; S.selected = null; S.selGroups = []; S.pathFocus = null; S.pathInfo = null;
  closeInspector(); closeEdgePop(true);
  applyFocus();
  if (S.viewSaved && opts.restore !== false) animateTo(S.viewSaved);
  S.viewSaved = null;
}
function refreshInspector() {
  if (!S.G) return;
  S.selection = S.selection.filter(i => S.G.nodes.has(i));
  if (!S.selection.length) { S.selected = null; closeInspector(); return; }
  if (!S.selection.includes(S.selected)) S.selected = S.selection[S.selection.length - 1];
  computeSelGroups();
  openInspector({ keepPos: true });
}

/* ---------- reset the whole view ---------- */
function resetView(ask = true) {
  if (S.areaMode) exitAreaMode(false);
  closeEdgePop(true);
  if (S.selection.length) deselect({ restore: false });
  S.viewSaved = null;
  S.issueFocus = null; S.selFinding = null; S.selArea = null; S.pathFocus = null; S.issueSel = null; S.sparqlSel = null;
  S.focusSystem = null; S.sysMembers = null;
  cancelLongHover();
  setMix(0);
  renderSystems(); renderFocusPill(); renderIssues(); renderSparql(); renderChecks();
  applyFocus();
  fitView(true);
  const n = S.G ? openIssueCount() : 0;
  if (!ask) return;
  if (!n) { toast('View reset — nothing is in question right now'); return; }
  openModal('View reset', [h('p', null, `Highlight the ${n} issue${n === 1 ? '' : 's'} still in question — flagged items, links that break open rules, and proposals not decided yet?`)],
    [h('button', { class: 'btn ghost', onclick: closeModal }, 'No'), h('button', { class: 'btn primary', onclick: () => { closeModal(); highlightOpenIssues(); } }, 'Yes, highlight them')]);
}
function openIssueTargets() {
  const set = new Set(), edges = new Set();
  for (const it of flagItems(false)) {
    if (it.kind === 'node') set.add(it.key);
    else { set.add(it.a); set.add(it.b); for (const g of S.groups) if (g.qaKey === it.key) edges.add(g.key); }
  }
  for (const r of S.rules) if (r.kind === 'rule' && r.status !== 'resolved') for (const e of ruleViolations(r)) { set.add(e.s); set.add(e.o); edges.add(groupKeyOf(e).key); }
  for (const f of S.findings) if (f.status === 'open') for (const i of [f.iri, f.fromIri, f.toIri]) if (i && S.G.nodes.has(i)) set.add(i);
  return { set, edges };
}
function highlightOpenIssues() {
  const t = openIssueTargets();
  if (!t.set.size) { toast('Nothing in question is on this view'); return; }
  setIssueFocus('Issues still in question', openIssueTargets, { strong: true });
  const pts = [...t.set].map(i => S.pos.get(i)).filter(Boolean);
  if (pts.length) animateTo(fitTarget(pts));
}

/* ---------- paths between the selected instances ---------- */
function adjacency(useAll) {
  const adj = new Map();
  const add = (a, b, idx) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push([b, idx]); };
  S.G.edges.forEach((e, idx) => {
    if (!useAll && !edgeOn(e)) return;
    if (!srcOK(S.G.nodes.get(e.s)) || !srcOK(S.G.nodes.get(e.o))) return;
    add(e.s, e.o, idx); add(e.o, e.s, idx);
  });
  return adj;
}
function shortestPath(adj, a, b) {
  if (a === b) return [];
  const prev = new Map([[a, null]]);
  let frontier = [a];
  while (frontier.length) {
    const nx = [];
    for (const x of frontier) for (const [y, idx] of adj.get(x) || []) {
      if (prev.has(y)) continue;
      prev.set(y, [x, idx]);
      if (y === b) { const path = []; let cur = b; while (prev.get(cur)) { const [p, i] = prev.get(cur); path.unshift(i); cur = p; } return path; }
      nx.push(y);
    }
    frontier = nx;
  }
  return null;
}
function sharedContext(iris) {
  const G = S.G, out = [];
  const common = (cat, side, label) => {
    const lists = iris.map(i => new Set(canonicalNeighbours(G.nodes.get(i), cat, side)));
    const both = [...lists[0]].filter(x => lists.every(l => l.has(x)));
    if (both.length) out.push(`${label} ${both.map(x => G.nodes.get(x).local).join(', ')}`);
  };
  common('location', 'in', iris.length > 2 ? 'All are located in' : 'Both are located in');
  common('system', 'in', iris.length > 2 ? 'All belong to' : 'Both belong to');
  common('composition', 'in', iris.length > 2 ? 'All are part of' : 'Both are part of');
  const types = iris.map(i => new Set(G.nodes.get(i).types));
  const ct = [...types[0]].filter(t => types.every(s => s.has(t)) && !GENERIC_TYPES.has(t));
  if (ct.length) out.push(`Shared class${ct.length > 1 ? 'es' : ''}: ${ct.slice(0, 4).map(qn).join(', ')}`);
  return out;
}
function showPath() {
  const sel = S.selection;
  if (sel.length < 2) return;
  const run = useAll => { const adj = adjacency(useAll), legs = []; for (let i = 1; i < sel.length; i++) { const p = shortestPath(adj, sel[i - 1], sel[i]); if (!p) return null; legs.push(p); } return legs; };
  let legs = run(false), viaHidden = false;
  if (!legs) { legs = run(true); viaHidden = !!legs; }
  const shared = sharedContext(sel);
  if (!legs) { S.pathFocus = null; S.pathInfo = { ok: false, shared }; }
  else {
    const edges = [...new Set(legs.flat())].map(i => S.G.edges[i]);
    const nodes = new Set(sel);
    for (const e of edges) { nodes.add(e.s); nodes.add(e.o); }
    const groups = new Map(), cache = new Map();
    for (const e of edges) { const gk = groupKeyOf(e).key; if (!groups.has(gk)) groups.set(gk, S.groupByKey.get(gk) || groupForEdge(e, cache)); }
    S.pathFocus = { set: nodes, edges: new Set(groups.keys()), groups: [...groups.values()].filter(g => S.pos.has(g.a) && S.pos.has(g.b)), strong: true };
    S.pathInfo = { ok: true, viaHidden, legs: legs.map(l => l.map(i => S.G.edges[i])), offView: [...nodes].filter(i => !S.vis.has(i)), shared };
    const pts = [...nodes].map(i => S.pos.get(i)).filter(Boolean);
    if (pts.length) animateTo(fitTarget(pts, { card: true }));
  }
  applyFocus();
  openInspector({ keepPos: true });
}

/* =====================================================================
   9. Inspector & edge popover
   ===================================================================== */
function makeDraggable(card, handle) {
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button,input,select,textarea')) return;
    if (window.innerWidth <= 820) return;
    const st = $('#stage').getBoundingClientRect(), r = card.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId);
    const mv = ev => {
      card.style.left = clamp(ev.clientX - st.left - ox, 4, st.width - 60) + 'px';
      card.style.top = clamp(ev.clientY - st.top - oy, 4, st.height - 40) + 'px';
    };
    const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); card._moved = true; };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
  });
}
function positionCard(card, anchorScreen) {
  const st = $('#stage');
  const W = st.clientWidth, H = st.clientHeight;
  const cw = card.offsetWidth || 360, ch = card.offsetHeight || 400;
  let x = W - cw - 14, y = 60;
  if (anchorScreen) {
    x = anchorScreen[0] + 24; y = anchorScreen[1] - 40;
    if (x + cw > W - 10) x = anchorScreen[0] - cw - 24;
    if (x < 10) x = W - cw - 14;
  }
  card.style.left = clamp(x, 8, Math.max(8, W - cw - 8)) + 'px';
  card.style.top = clamp(y, 56, Math.max(56, H - ch - 10)) + 'px';
}
function linkTo(iri, opts = {}) {
  const n = S.G.nodes.get(iri);
  return h('button', { class: 'linkbtn' + (opts.shared ? ' shared' : ''), title: n.iri + ((navigator.platform || '').startsWith('Mac') ? '\n⌘-click to add to the selection' : '\nCtrl-click to add to the selection'), onclick: ev => select(iri, { add: ev.ctrlKey || ev.metaKey }) }, displayName(n));
}
function canonicalNeighbours(n, cat, side) {
  const out = new Set();
  for (const idx of [...n.out, ...n.in]) {
    const e = S.G.edges[idx];
    if (e.cat !== cat || e.dir === 0) continue;
    const from = e.dir === -1 ? e.o : e.s, to = e.dir === -1 ? e.s : e.o;
    if (side === 'in' && to === n.iri) out.add(from);
    if (side === 'out' && from === n.iri) out.add(to);
  }
  return [...out];
}
function fmtLiteral(o) {
  const v = h('span', { class: 'v' }, o.value.length > 400 ? o.value.slice(0, 400) + '…' : o.value);
  if (o.language) v.append(h('span', { class: 'dt' }, '@' + o.language));
  else if (o.datatype && o.datatype.value !== NS.xsd + 'string' && o.datatype.value !== NS.rdf + 'langString') v.append(h('span', { class: 'dt' }, qn(o.datatype.value)));
  return v;
}
const appendAll = (el, ...kids) => el.append(...kids.flat(Infinity).filter(k => k != null && k !== false));
const MULTI = () => h('span', { class: 'multival' }, '(multiple values)');
function openInspector(opts = {}) {
  if (typeof opts === 'string') opts = {};
  const G = S.G, sel = S.selection;
  if (!sel.length) return;
  const box = $('#insp');
  const wasOpen = !box.hidden;
  const scroll = wasOpen && opts.keepPos ? (box.querySelector('.body') || {}).scrollTop || 0 : 0;
  box.textContent = '';
  S.hlEdgeKey = null;
  const multi = sel.length > 1;
  const tab = multi ? (S.inspTab === 'all' || !sel.includes(S.inspTab) ? 'all' : S.inspTab) : sel[0];
  const n = tab === 'all' ? null : G.nodes.get(tab);
  const header = h('header', null,
    n ? h('span', { class: 'badge', style: { color: KIND_COLOR[n.kind], borderColor: KIND_COLOR[n.kind] } }, KIND_LABEL[n.kind] + (n.sysToo ? ' · system' : '')) : h('span', { class: 'badge' }, `${sel.length} selected`),
    h('h3', { title: n ? n.iri : '' }, n ? displayName(n) : sel.map(i => G.nodes.get(i).local).join(', ')),
    h('button', { class: 'x-btn', 'aria-label': 'Close details', onclick: () => deselect() }, '✕'));
  box.append(header);
  if (multi) {
    const chip = (key, label, title) => h('button', { class: 'chip' + (tab === key ? ' on' : ''), title, onclick: () => { S.inspTab = key; if (key !== 'all') S.selected = key; openInspector({ keepPos: true }); } }, h('span', null, label));
    box.append(h('div', { class: 'multibar' },
      h('div', { class: 'chips' }, chip('all', `All ${sel.length}`, 'What the selected instances have in common'), sel.map(i => chip(i, G.nodes.get(i).local, G.nodes.get(i).iri))),
      h('div', { class: 'btnrow', style: { marginTop: '6px' } },
        h('button', { class: 'btn small primary', onclick: showPath, title: 'Highlight the connections that link the selected instances, through the connections shown now' }, 'Show path'),
        S.pathFocus ? h('button', { class: 'btn small ghost', onclick: () => { S.pathFocus = null; S.pathInfo = null; applyFocus(); openInspector({ keepPos: true }); } }, 'Clear path') : null,
        tab !== 'all' ? h('button', { class: 'btn small ghost', onclick: () => select(tab, { add: true }) }, 'Remove from selection') : null)));
  }
  const body = h('div', { class: 'body' });
  if (tab === 'all') commonBody(body, sel); else singleBody(body, tab);
  box.append(body);
  box.hidden = false;
  makeDraggable(box, header);
  if (!(opts.keepPos && wasOpen) && !box._moved) positionCard(box, null);
  if (!opts.keepPos) box._moved = false;
  body.scrollTop = scroll;
}
function singleBody(body, iri) {
  const G = S.G, n = G.nodes.get(iri);
  const types = displayTypes(n);
  const iriIn = h('input', { readonly: true, value: n.iri, 'aria-label': 'Instance IRI' });
  body.append(h('div', { class: 'iri' }, iriIn, h('button', { class: 'btn small', onclick: () => copyText(n.iri, iriIn) }, 'Copy')));
  const kv = h('dl', { class: 'kv' });
  const addKv = (k, v) => { if (v == null || (Array.isArray(v) && !v.length)) return; kv.append(h('dt', null, k), h('dd', null, v)); };
  addKv('Class', types.length ? h('div', { class: 'typechips' }, types.map((t, i) => h('span', { class: i === 0 ? 'ptype' : '', title: t }, qn(t)))) : h('span', { class: 'muted' }, 'no rdf:type'));
  const listLinks = arr => arr.length ? h('div', null, arr.slice(0, 12).flatMap((x, i) => [i ? ', ' : '', linkTo(x)]), arr.length > 12 ? ` +${arr.length - 12}` : '') : null;
  addKv('System', listLinks(canonicalNeighbours(n, 'system', 'in')));
  addKv('Location', listLinks(canonicalNeighbours(n, 'location', 'in')));
  addKv('Part of', listLinks(canonicalNeighbours(n, 'composition', 'in')));
  addKv('Label', n.label);
  if (G.files.length > 1) addKv('Graph', [...n.srcs].map(i => G.files[i]).join(', '));
  body.append(kv);
  /* connections, grouped by category; every asserted triple in its asserted direction.
     Point at one to light its line; click it for the connection card (click again to close). */
  const byCat = new Map();
  for (const idx of n.out) { const e = G.edges[idx]; (byCat.get(e.cat) || byCat.set(e.cat, []).get(e.cat)).push({ e, out: true }); }
  for (const idx of n.in) { const e = G.edges[idx]; (byCat.get(e.cat) || byCat.set(e.cat, []).get(e.cat)).push({ e, out: false }); }
  if (byCat.size) {
    const sec = h('div', { class: 'insp-sec' }, h('h4', null, 'Connections'));
    for (const c of CATS) {
      const rows = byCat.get(c.id);
      if (!rows) continue;
      const hiddenCat = !S.catOn[c.id];
      sec.append(h('h4', { style: { marginTop: '8px' } }, h('span', { class: 'dot', style: { background: S.catColor[c.id] } }), c.name, hiddenCat ? h('span', { class: 'off' }, '· hidden — shown dimmed while selected') : null));
      rows.sort((a, b) => (a.out === b.out ? 0 : a.out ? -1 : 1) || qn(a.e.p).localeCompare(qn(b.e.p)));
      for (const { e, out } of rows.slice(0, 60)) {
        const other = out ? e.o : e.s;
        const gk = groupKeyOf(e).key, drawn = S.groupByKey.has(gk), open = S.edgePopOpen && S.edgePopKey === gk;
        const row = h('div', { class: 'rel link' + (drawn ? '' : ' undrawn') + (open ? ' open' : ''), role: 'button', tabindex: '0', 'aria-pressed': open ? 'true' : 'false',
          title: (out ? `this ${qn(e.p)} ${G.nodes.get(other).local}` : `${G.nodes.get(other).local} ${qn(e.p)} this`) + (open ? '\nClick again to close the connection card' : '\nClick for the connection card') },
          h('span', { class: 'ar' }, out ? '→' : '←'),
          h('span', null, h('span', { class: 'p' + (S.predOff.has(e.cat + '|' + e.p) ? ' dim' : '') }, qn(e.p) + ' '), linkTo(other)));
        row.addEventListener('mouseenter', () => { S.hlEdgeKey = gk; frame(); });
        row.addEventListener('mouseleave', () => { if (S.hlEdgeKey === gk) { S.hlEdgeKey = null; frame(); } });
        const openIt = ev => { if (ev.target.closest('.linkbtn')) return; openEdgePopFromInspector(e); };
        row.addEventListener('click', openIt);
        row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openIt(ev); } });
        sec.append(row);
      }
      if (rows.length > 60) sec.append(h('div', { class: 'hint' }, `+${rows.length - 60} more`));
    }
    body.append(sec);
  }
  /* literal properties and other values */
  const props = n.lits.filter(l => !LABEL_PREDS.includes(l.p) || n.lits.filter(x => LABEL_PREDS.includes(x.p)).length > 1);
  if (props.length || n.refs.length) {
    const sec = h('div', { class: 'insp-sec' }, h('h4', null, 'Properties'));
    for (const l of props) {
      if (l.blank) {
        const inner = G.blanks.get(l.o.value) || [];
        const box2 = h('span', { class: 'v' }, inner.length ? inner.map(b => h('div', null, h('span', { class: 'dt', style: { marginLeft: 0, marginRight: '4px' } }, qn(b.p)), b.o.termType === 'Literal' ? fmtLiteral(b.o) : (b.o.termType === 'NamedNode' ? qn(b.o.value) : '[ … ]'))) : '[ ]');
        sec.append(h('div', { class: 'prop' }, h('span', { class: 'k' }, qn(l.p)), box2));
      } else sec.append(h('div', { class: 'prop' }, h('span', { class: 'k' }, qn(l.p)), fmtLiteral(l.o)));
    }
    for (const r of n.refs) sec.append(h('div', { class: 'prop' }, h('span', { class: 'k' }, qn(r.p)), h('span', { class: 'v mono', style: { fontSize: '11px' } }, qn(r.o))));
    body.append(sec);
  }
  /* placement */
  const a = S.anchors.get(iri), o = S.orig.get(iri);
  const psec = h('div', { class: 'insp-sec' }, h('h4', null, 'Placement on drawing'));
  const pkv = h('dl', { class: 'kv' });
  if (placed(iri)) {
    pkv.append(h('dt', null, 'Position'), h('dd', { class: 'mono' }, `x ${a.x} · y ${a.y}`));
    pkv.append(h('dt', null, 'Source'), h('dd', null, ({ kg: 'coordinates in the graph', claude: 'placed by Claude', manual: 'moved by reviewer', import: 'imported layout' }[a.source] || a.source) + (a.conf != null && a.source === 'claude' ? ` · confidence ${a.conf}` : '')));
    if (a.why) pkv.append(h('dt', null, 'Anchored on'), h('dd', null, a.why));
  } else pkv.append(h('dt', null, 'Status'), h('dd', null, S.off.has(iri) ? 'Not on this drawing' : 'Not placed yet — drag it onto the drawing, or run Anchor with Claude'));
  psec.append(pkv);
  const brow = h('div', { class: 'btnrow' });
  if (S.pos.get(iri)) brow.append(h('button', { class: 'btn small', onclick: () => centerOn([S.pos.get(iri)]) }, 'Center'));
  if (placed(iri)) brow.append(h('button', { class: 'btn small', onclick: () => setOffDrawing(iri, true) }, 'Not on this drawing'));
  if (S.off.has(iri)) brow.append(h('button', { class: 'btn small', onclick: () => setOffDrawing(iri, false) }, 'Is on this drawing'));
  if (o && a && (o.x !== a.x || o.y !== a.y || S.off.has(iri))) brow.append(h('button', { class: 'btn small', onclick: () => resetAnchor(iri) }, 'Reset position'));
  psec.append(brow);
  body.append(psec);
  body.append(issuesSection(iri));
  body.append(reviewBlock(S.qa.nodes, iri, () => { refreshNodeClasses(); applyFocus(); }, n.local, 'Review of this instance'));
}
/* everything in question about one instance: its links' flags, reports, rules, proposals and changes */
function issuesFor(iri) {
  const out = [];
  for (const [k, r] of Object.entries(S.qa.edges)) { if (!r.status) continue; const [cat, a, b] = k.split('|'); if (a === iri || b === iri) out.push({ kind: 'link', key: k, cat, a, b, rec: r }); }
  for (const c of S.checks || []) for (const it of c.items) if (it.iri === iri || (it.group && (it.group.a === iri || it.group.b === iri))) out.push({ kind: 'check', check: c, item: it });
  for (const r of S.rules) if (r.kind === 'rule' && r.status !== 'resolved') { const v = ruleViolations(r).filter(e => e.s === iri || e.o === iri); if (v.length) out.push({ kind: 'rule', rule: r, v }); }
  for (const f of S.findings) if (f.status !== 'dismissed' && [f.iri, f.fromIri, f.toIri, f.newFromIri, f.newToIri].includes(iri)) out.push({ kind: 'finding', f });
  for (const c of activeChanges()) if (changeNodes(c).includes(iri)) out.push({ kind: 'change', c });
  return out;
}
function decideItem(store, key, status, label, extra) {
  const snap = snapshot();
  const rec = store[key] || {};
  Object.assign(rec, { status, at: new Date().toISOString() }, extra || {});
  if (!rec.status && !rec.note) delete store[key]; else store[key] = rec;
  commit(label, snap);
  persist(); refreshNodeClasses(); applyFocus(); updateQaSummary(); renderChecks(); renderIssues(); refreshInspector();
}
function miniSeg(cur, onPick, opts = [['issue', 'Issue'], ['unsure', 'Unsure'], ['ok', 'Correct'], ['resolved', 'Resolved']]) {
  const seg = h('div', { class: 'qa-seg mini2', role: 'group' });
  for (const [v, l] of opts) seg.append(h('button', { 'data-v': v, class: cur === v ? 'on' : '', 'aria-pressed': cur === v ? 'true' : 'false', onclick: () => onPick(cur === v ? '' : v) }, l));
  return seg;
}
function issuesSection(iri) {
  const G = S.G, items = issuesFor(iri);
  const sec = h('div', { class: 'insp-sec' }, h('h4', null, 'Issues & checks', h('span', { class: 'off' }, items.length ? `· ${items.length}` : '')));
  if (!items.length) { sec.append(h('div', { class: 'hint', style: { marginTop: 0 } }, 'Nothing in question: no automatic report, rule, flagged link or proposal concerns this instance.')); return sec; }
  for (const it of items) {
    const row = h('div', { class: 'iss-row' });
    if (it.kind === 'check') {
      const isNode = !!it.item.iri, store = isNode ? S.qa.nodes : S.qa.edges, key = isNode ? it.item.iri : it.item.group.qaKey, rec = store[key] || {};
      appendAll(row, h('div', { class: 'iss-top' }, h('span', { class: 'sev', style: { background: it.check.sev } }), h('b', null, it.check.title)),
        isNode ? null : h('div', { class: 'mono iss-sub' }, it.item.text),
        h('div', { class: 'iss-act' }, h('span', { class: 'muted' }, 'Decision:'), miniSeg(rec.status || '', v => decideItem(store, key, v, `decide ${it.item.text}: ${v || 'undecided'}`, { check: it.check.title }))));
    } else if (it.kind === 'link') {
      const r = it.rec;
      appendAll(row, h('div', { class: 'iss-top' }, statusChip(r.status), h('span', null, `${CAT[it.cat] ? CAT[it.cat].name : it.cat} link with `, linkTo(it.a === iri ? it.b : it.a))),
        r.note ? h('div', { class: 'iss-note' }, r.note) : null,
        h('div', { class: 'iss-act' }, miniSeg(r.status, v => decideItem(S.qa.edges, it.key, v, `review link: ${v || 'unreviewed'}`)),
          h('button', { class: 'linkbtn', onclick: () => { const e = S.G.edges.find(x => x.cat === it.cat && ((x.s === it.a && x.o === it.b) || (x.s === it.b && x.o === it.a))); if (e) openEdgePopFromInspector(e); } }, 'Link card')));
    } else if (it.kind === 'rule') {
      appendAll(row, h('div', { class: 'iss-top' }, h('span', { class: 'schip rule' }, 'Rule'), h('span', null, ruleText(it.rule))),
        h('div', { class: 'mono iss-sub' }, it.v.slice(0, 4).map(e => `${G.nodes.get(e.s).local} ${qn(e.p)} ${G.nodes.get(e.o).local}`).join('\n')),
        h('div', { class: 'iss-act' }, h('button', { class: 'linkbtn', onclick: () => openIssueCard('rule:' + it.rule.id) }, 'Open in Issues')));
    } else if (it.kind === 'finding') {
      const f = it.f, meta = FT[f.type] || FT.other;
      const acts = h('div', { class: 'iss-act' });
      if (f.status === 'open') acts.append(h('button', { class: 'btn small primary', onclick: () => acceptFinding(f) }, f.issueRef ? 'Accept fix' : meta.accept), h('button', { class: 'btn small ghost', onclick: () => setFindingStatus(f, 'dismissed') }, 'Dismiss'));
      else if (f.status === 'accepted' && GRAPH_TYPES.has(f.type)) acts.append(h('button', { class: 'btn small primary', onclick: () => applyFindings([f]) }, 'Apply to graph'));
      acts.append(h('button', { class: 'linkbtn', onclick: () => openIssueCard('f:' + f.id) }, 'Open in Issues'));
      appendAll(row, h('div', { class: 'iss-top' }, h('span', { class: 'fchip', style: { color: meta.color, borderColor: meta.color } }, meta.label), h('span', { class: 'muted' }, f.status === 'open' ? 'proposed' : f.status)),
        h('div', { class: 'mono iss-sub' }, findingTitle(f)), f.evidence ? h('div', { class: 'iss-note' }, f.evidence) : null, acts);
    } else if (it.kind === 'change') {
      appendAll(row, h('div', { class: 'iss-top' }, h('span', { class: 'fchip', style: { color: CHANGE_COLOR[it.c.type] || '#64748b', borderColor: CHANGE_COLOR[it.c.type] || '#64748b' } }, CHANGE_LABEL[it.c.type] || it.c.type), h('span', { class: 'muted mono' }, it.c.id)),
        h('div', { class: 'mono iss-sub' }, it.c.title), h('div', { class: 'iss-act' }, h('button', { class: 'linkbtn', onclick: () => scrollToChange(it.c.id) }, 'In change log')));
    }
    sec.append(row);
  }
  return sec;
}
/* what several selected instances have in common; differing values read "(multiple values)" */
function commonBody(body, sel) {
  const G = S.G, nodes = sel.map(i => G.nodes.get(i));
  const kinds = new Map();
  for (const n of nodes) kinds.set(n.kind, (kinds.get(n.kind) || 0) + 1);
  body.append(h('p', { class: 'hint', style: { marginTop: 0 } }, `${sel.length} instances: ${[...kinds].map(([k, c]) => `${c} ${KIND_LABEL[k].toLowerCase()}${c === 1 ? '' : 's'}`).join(', ')}. Shared values are shown; differing ones read “multiple values”. ${(navigator.platform || '').startsWith('Mac') ? '⌘' : 'Ctrl'}-click nodes to add or remove.`));
  const kv = h('dl', { class: 'kv' });
  const row = (k, v) => kv.append(h('dt', null, k), h('dd', null, v));
  row('Kind', kinds.size === 1 ? KIND_LABEL[nodes[0].kind] : MULTI());
  const typeSets = nodes.map(n => new Set(n.types));
  const sharedT = [...typeSets[0]].filter(t => typeSets.every(s => s.has(t)));
  const allSameT = typeSets.every(s => s.size === sharedT.length);
  row('Class', h('div', { class: 'typechips' }, sharedT.map(t => h('span', { class: 'shared', title: t }, qn(t))), allSameT ? null : MULTI()));
  const commonLinks = (cat, label) => {
    const lists = nodes.map(n => canonicalNeighbours(n, cat, 'in'));
    if (lists.every(l => !l.length)) return;
    const shared = lists[0].filter(x => lists.every(l => l.includes(x)));
    const same = lists.every(l => l.length === shared.length);
    row(label, h('div', null, shared.flatMap((x, i) => [i ? ', ' : '', linkTo(x, { shared: true })]), same ? null : [shared.length ? ' ' : '', MULTI()]));
  };
  commonLinks('system', 'System'); commonLinks('location', 'Location'); commonLinks('composition', 'Part of');
  const labels = new Set(nodes.map(n => n.label || ''));
  if ([...labels].some(Boolean)) row('Label', labels.size === 1 ? nodes[0].label : MULTI());
  const plc = new Set(sel.map(i => (placed(i) ? 'placed' : S.off.has(i) ? 'off' : 'unplaced')));
  row('Placement', plc.size === 1 ? { placed: 'All placed on the drawing', off: 'None on this drawing', unplaced: 'None placed yet' }[[...plc][0]] : MULTI());
  if (G.files.length > 1) { const fs = new Set(nodes.map(n => [...n.srcs].sort().join(','))); row('Graph', fs.size === 1 ? [...nodes[0].srcs].map(i => G.files[i]).join(', ') : MULTI()); }
  body.append(kv);
  /* neighbours every selected instance links to (any predicate, also hidden ones) */
  const nb = n => { const m = new Map(); for (const idx of [...n.out, ...n.in]) { const e = G.edges[idx], o = e.s === n.iri ? e.o : e.s; if (!sel.includes(o)) { let s = m.get(o); if (!s) m.set(o, s = new Set()); s.add(qn(e.p)); } } return m; };
  const maps = nodes.map(nb);
  const sharedNb = [...maps[0].keys()].filter(o => maps.every(m => m.has(o)));
  const sec = h('div', { class: 'insp-sec' }, h('h4', null, 'In common', h('span', { class: 'off' }, sharedNb.length ? `· ${sharedNb.length} shared neighbour${sharedNb.length === 1 ? '' : 's'}` : '')));
  if (sharedNb.length) for (const o of sharedNb.slice(0, 20)) sec.append(h('div', { class: 'rel' }, h('span', { class: 'ar' }, '•'), h('span', null, linkTo(o, { shared: true }), ' ', h('span', { class: 'p' }, [...new Set(maps.flatMap(m => [...m.get(o)]))].join(', ')))));
  else sec.append(h('div', { class: 'hint', style: { marginTop: 0 } }, 'No neighbour is linked to all of them.'));
  const between = G.edges.filter(e => sel.includes(e.s) && sel.includes(e.o));
  if (between.length) {
    sec.append(h('h4', { style: { marginTop: '10px' } }, 'Linked to each other'));
    for (const e of between.slice(0, 20)) {
      const r = h('div', { class: 'rel link', role: 'button', tabindex: '0' }, h('span', { class: 'ar' }, '→'), h('span', null, `${G.nodes.get(e.s).local} `, h('span', { class: 'p' }, qn(e.p)), ` ${G.nodes.get(e.o).local}`));
      r.addEventListener('click', () => openEdgePopFromInspector(e));
      sec.append(r);
    }
  }
  body.append(sec);
  /* path */
  const psec = h('div', { class: 'insp-sec' }, h('h4', null, 'Path between them'));
  const pi = S.pathInfo;
  if (!pi) psec.append(h('div', { class: 'hint', style: { marginTop: 0 } }, 'Show path highlights the shortest chain of connections that links the selected instances (in the order you selected them), using the connections switched on now.'));
  else if (!pi.ok) psec.append(h('div', { class: 'callout warn', style: { marginTop: 0 } }, 'There are no visible connections between them, and no path through any other predicate either.'));
  else {
    if (pi.viaHidden) psec.append(h('div', { class: 'callout warn', style: { marginTop: 0 } }, 'There are no visible connections between them. Through predicates that are switched off now, they are linked like this:'));
    for (const leg of pi.legs) psec.append(h('div', { class: 'mono path-leg' }, leg.length ? leg.map(e => `${G.nodes.get(e.s).local} ${qn(e.p)} ${G.nodes.get(e.o).local}`).join('\n') : '(same instance)'));
    if (pi.offView.length) psec.append(h('div', { class: 'hint' }, `${pi.offView.length} instance${pi.offView.length === 1 ? ' on the path is' : 's on the path are'} not in this view. `, S.scope !== 'full' ? h('button', { class: 'linkbtn', onclick: () => { setScope('full'); showPath(); } }, 'Show Full graph') : null));
  }
  if (pi && pi.shared && pi.shared.length) psec.append(h('div', { class: 'hint' }, pi.shared.join(' · ')));
  else if (!pi) { const sc = sharedContext(sel); if (sc.length) psec.append(h('div', { class: 'hint' }, sc.join(' · '))); }
  body.append(psec);
  /* issues per instance */
  const isec = h('div', { class: 'insp-sec' }, h('h4', null, 'Issues & checks'));
  let any = false;
  for (const iri of sel) {
    const c = issuesFor(iri).length, st = (S.qa.nodes[iri] || {}).status;
    if (!c && !st) continue;
    any = true;
    isec.append(h('div', { class: 'rel' }, h('span', { class: 'ar' }, c || '·'), h('span', null, h('button', { class: 'linkbtn', onclick: () => { S.inspTab = iri; S.selected = iri; openInspector({ keepPos: true }); } }, G.nodes.get(iri).local), st ? [' ', statusChip(st)] : null, c ? h('span', { class: 'muted' }, ` · ${c} item${c === 1 ? '' : 's'}`) : null)));
  }
  if (!any) isec.append(h('div', { class: 'hint', style: { marginTop: 0 } }, 'Nothing in question for these instances.'));
  body.append(isec);
  /* one review for all of them */
  const rsec = h('div', { class: 'insp-sec' }, h('h4', null, `Review all ${sel.length}`));
  const sts = new Set(sel.map(i => (S.qa.nodes[i] || {}).status || ''));
  let pick = sts.size === 1 ? [...sts][0] : null;
  const seg = miniSeg(pick, v => { pick = v; $$('button', seg).forEach(b => { b.classList.toggle('on', b.dataset.v === v); }); }, [['ok', 'Correct'], ['issue', 'Issue'], ['unsure', 'Unsure'], ['resolved', 'Resolved']]);
  const notes = new Set(sel.map(i => (S.qa.nodes[i] || {}).note || ''));
  const ta = h('textarea', { class: 'note', placeholder: notes.size > 1 ? '(multiple values) — writing here replaces every comment' : 'One comment for all of them (Claude reads it in Resolve with Claude)' });
  ta.value = notes.size === 1 ? [...notes][0] : '';
  const apply = h('button', { class: 'btn small primary', onclick: () => {
    const snap = snapshot(), now = new Date().toISOString(), text = ta.value.trim();
    for (const i of sel) {
      const rec = S.qa.nodes[i] || {};
      if (pick != null && pick !== '') rec.status = pick;
      if (text || notes.size === 1) rec.note = text;
      rec.at = now;
      if (!rec.status && !rec.note) delete S.qa.nodes[i]; else S.qa.nodes[i] = rec;
    }
    commit(`review ${sel.length} instances`, snap);
    persist(); refreshNodeClasses(); applyFocus(); updateQaSummary(); renderChecks(); renderIssues(); openInspector({ keepPos: true });
    toast(`Saved for ${sel.length} instances`);
  } }, `Save for all ${sel.length}`);
  rsec.append(seg, ta, h('div', { class: 'btnrow' }, apply));
  body.append(rsec);
}
function reviewBlock(store, key, after, itemLabel, title) {
  const cur = store[key] || {};
  const sec = h('div', { class: 'insp-sec' }, h('h4', null, title || 'Review'));
  if (cur.check) sec.append(h('div', { class: 'hint', style: { marginTop: 0, marginBottom: '6px' } }, `Decided from the report “${cur.check}”`));
  const seg = h('div', { class: 'qa-seg', role: 'group', 'aria-label': 'Review status' });
  for (const [v, label] of [['', 'Unreviewed'], ['ok', 'Correct'], ['issue', 'Issue'], ['unsure', 'Unsure'], ['resolved', 'Resolved']]) {
    const b = h('button', { 'data-v': v, class: (cur.status || '') === v ? 'on' : '', 'aria-pressed': (cur.status || '') === v ? 'true' : 'false' }, label);
    b.addEventListener('click', () => {
      if ((store[key] || {}).status === v || (!store[key] && !v)) return;
      const snap = snapshot();
      const rec = store[key] || {};
      rec.status = v; rec.at = new Date().toISOString();
      if (!rec.status && !rec.note) delete store[key]; else store[key] = rec;
      commit(`review ${itemLabel}: ${v ? { ok: 'correct', issue: 'issue', unsure: 'unsure', resolved: 'resolved' }[v] : 'unreviewed'}`, snap);
      persist();
      $$('button', seg).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      after(); updateQaSummary(); renderIssues(); renderChecks();
    });
    seg.append(b);
  }
  const note = h('textarea', { class: 'note', placeholder: 'Note for the graph author (what is wrong, what it should be)…', 'aria-label': 'Review note' });
  note.value = cur.note || '';
  let noteSnap = null;
  note.addEventListener('focus', () => { noteSnap = snapshot(); });
  note.addEventListener('change', () => { commit(`note on ${itemLabel}`, noteSnap); noteSnap = snapshot(); });
  note.addEventListener('input', () => {
    const rec = store[key] || {};
    rec.note = note.value; rec.at = new Date().toISOString();
    if (!rec.status && !rec.note) delete store[key]; else store[key] = rec;
    persist();
  });
  sec.append(seg, note);
  return sec;
}
function closeInspector() { const b = $('#insp'); b.hidden = true; b._moved = false; if (S.hlEdgeKey) { S.hlEdgeKey = null; frame(); } }
function setOffDrawing(iri, off) {
  const snap = snapshot();
  if (off) S.off.add(iri);
  else { S.off.delete(iri); if (!S.anchors.has(iri)) { const p = S.pos.get(iri); if (p && S.drawing) S.anchors.set(iri, { x: clamp(Math.round(p.x), 0, drawW()), y: clamp(Math.round(p.y), 0, drawH()), source: 'manual', conf: 1, why: 'moved by reviewer' }); } }
  commit(`mark ${S.G.nodes.get(iri).local} ${off ? 'not ' : ''}on drawing`, snap);
  persist(); rebuild();
  if (S.selection.includes(iri)) refreshInspector();
}
function resetAnchor(iri) {
  const snap = snapshot();
  const o = S.orig.get(iri);
  if (o) S.anchors.set(iri, { ...o }); else S.anchors.delete(iri);
  S.off.delete(iri);
  commit(`reset ${S.G.nodes.get(iri).local}`, snap);
  persist(); rebuild();
  if (S.selection.includes(iri)) refreshInspector();
}

/* the connection card; clicking the same connection again closes it */
function openEdgePopFromInspector(e) {
  const g = groupForEdge(e);
  if (S.edgePopOpen && S.edgePopKey === g.key) { closeEdgePop(); return; }
  const ins = $('#insp'), st = $('#stage').getBoundingClientRect();
  openEdgePop(g, 0, 0, { beside: ins.hidden ? null : ins.getBoundingClientRect(), stage: st });
}
function openEdgePop(g, clientX, clientY, opts = {}) {
  const box = $('#edgePop'), G = S.G;
  box.textContent = '';
  const A = G.nodes.get(g.a), B = G.nodes.get(g.b);
  const header = h('header', null,
    h('span', { class: 'badge', style: { color: g.color, borderColor: g.color } }, CAT[g.cat].name),
    h('h3', null, `${displayName(A)} — ${displayName(B)}`),
    h('button', { class: 'x-btn', 'aria-label': 'Close', onclick: () => closeEdgePop() }, '✕'));
  const body = h('div', { class: 'body' });
  body.append(h('p', { class: 'hint', style: { marginTop: 0 } }, g.dash ? 'Dashed: one end is a location or a system.' : 'Solid: component-to-component.', ' ', g.und && !g.ab && !g.ba ? 'Undirected.' : 'Arrow shows the canonical direction.'));
  if (g.hidden) {
    const off = !S.catOn[g.cat] || g.edges.every(e => S.predOff.has(e.cat + '|' + e.p));
    body.append(h('div', { class: 'callout', style: { marginTop: 0 } }, off ? `Hidden under Connections (${CAT[g.cat].name} or its predicate is switched off). It shows dimmed while one of its ends is selected.` : 'Not drawn right now: the other end is outside the current scope.'));
  }
  body.append(h('div', { class: 'hint', style: { margin: '0 0 6px' } }, 'Subject and object: ', linkTo(g.a), ' · ', linkTo(g.b)));
  const list = h('div', { class: 'insp-sec' }, h('h4', null, `Asserted triples (${g.edges.length})`));
  for (const e of g.edges) {
    const info = G.predInfo(e.p);
    list.append(h('div', { class: 'trip' }, linkTo(e.s), ' ', h('i', null, qn(e.p)), ' ', linkTo(e.o), info.known ? '' : h('span', { class: 'dt', title: info.via }, ' (category guessed)'), G.files.length > 1 ? h('div', { class: 'hint', style: { margin: 0 } }, G.files[e.fi]) : null));
  }
  body.append(list, reviewBlock(S.qa.edges, g.qaKey, () => refreshNodeClasses(), `${A.local} – ${B.local}`));
  const wasOpen = !box.hidden;
  box.append(header, body);
  box.hidden = false;
  S.edgePopKey = g.key; S.edgePopOpen = true; S._popGroup = g;
  applyFocus();
  if (S.selection.length) openInspector({ keepPos: true });
  makeDraggable(box, header);
  if (opts.keepPos && wasOpen) return;
  const st = $('#stage').getBoundingClientRect();
  if (opts.beside && window.innerWidth > 820) {   /* next to the inspector, so both stay readable */
    const r = opts.beside, cw = box.offsetWidth || 380, chh = box.offsetHeight || 300, W = st.width, il = r.left - st.left, iw = r.width;
    let x;
    if (il - cw - 10 >= 8) x = il - cw - 10;
    else if (il + iw + 10 + cw <= W - 8) x = il + iw + 10;
    else if (iw + cw + 10 <= W - 16) { x = W - cw - 8; $('#insp').style.left = (x - 10 - iw) + 'px'; }   /* slide the inspector over to make room */
    else x = clamp(il + 24, 8, Math.max(8, W - cw - 8));
    box.style.left = x + 'px';
    box.style.top = clamp(r.top - st.top + 36, 56, Math.max(56, st.height - chh - 10)) + 'px';
    return;
  }
  positionCard(box, window.innerWidth > 820 ? [clientX - st.left, clientY - st.top] : null);
}
function closeEdgePop(quiet) {
  $('#edgePop').hidden = true;
  if (!S.edgePopOpen) return;
  S.edgePopOpen = false; S._popGroup = null;
  if (quiet) return;
  applyFocus();
  if (S.selection.length) openInspector({ keepPos: true });
}

/* =====================================================================
   10. Side panel
   ===================================================================== */
function setScope(v) {
  S.scope = v;
  const r = $(`input[name=scope][value=${v}]`);
  if (r) r.checked = true;
  const hadMargin = !!S.margin;
  rebuild();
  if (!!S.margin !== hadMargin) fitView(); else fitIfNeeded();
}
function fitIfNeeded() {
  const b = contentBounds(), { s, tx, ty } = S.view, vw = vp.clientWidth;
  if (b.x1 * s + tx < vw * 0.2 || b.x0 * s + tx > vw * 0.8 || b.y1 * s + ty < 0) fitView();
}
function renderSources() {
  const box = $('#sources');
  box.textContent = '';
  if (!S.G || S.G.files.length < 2) return;
  box.append(h('div', { class: 'hint', style: { margin: '10px 0 2px' } }, 'Graph sources'));
  S.G.files.forEach((f, i) => {
    const cnt = [...S.G.nodes.values()].filter(n => n.srcs.has(i)).length;
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !S.srcOff.has(i);
    cb.addEventListener('change', () => { if (cb.checked) S.srcOff.delete(i); else S.srcOff.add(i); rebuild(); });
    box.append(h('label', { class: 'check' }, cb, h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f }, f), h('span', { class: 'muted mono', style: { fontSize: '11px' } }, cnt)));
  });
}
const caretSvg = () => { const s = sv('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' }); s.append(sv('path', { d: 'M4 2.5 7.5 6 4 9.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' })); return s; };
function setAllConnections(on) {
  if (on) { for (const c of CATS) S.catOn[c.id] = true; S.predOff.clear(); }
  else {
    for (const c of CATS) S.catOn[c.id] = false;
    if (S.G) for (const c of CATS) for (const p of S.G.catPreds.get(c.id).keys()) S.predOff.add(c.id + '|' + p);
  }
  saveSettings(); renderCats(); if (S.G) rebuild();
}
function renderCats() {
  const box = $('#cats');
  box.textContent = '';
  const anyOn = CATS.some(c => S.catOn[c.id]);
  box.append(h('div', { class: 'cat-all' },
    h('button', { class: 'btn small', onclick: () => setAllConnections(true), title: 'Show every category and predicate' }, 'Check all'),
    h('button', { class: 'btn small', onclick: () => setAllConnections(false), disabled: !anyOn, title: 'Hide every connection, then tick only the ones you want' }, 'Uncheck all')));
  for (const c of CATS) {
    const preds = S.G ? [...S.G.catPreds.get(c.id).values()].sort((a, b) => b.n - a.n) : [];
    const total = preds.reduce((s, p) => s + p.n, 0);
    const offN = preds.filter(pr => S.predOff.has(c.id + '|' + pr.p)).length;
    const wrap = h('div', { class: 'cat' + (S.openCats.has(c.id) ? ' open' : '') });
    const cb = h('input', { type: 'checkbox', 'aria-label': 'Show ' + c.name });
    cb.checked = !!S.catOn[c.id] && (!preds.length || offN < preds.length);
    cb.indeterminate = cb.checked && offN > 0;
    cb.addEventListener('change', () => {
      S.catOn[c.id] = cb.checked;
      if (cb.checked && preds.length && offN === preds.length) for (const pr of preds) S.predOff.delete(c.id + '|' + pr.p);   /* ticking an emptied category brings its predicates back */
      saveSettings(); renderCats(); rebuild();
    });
    const sw = h('input', { type: 'color', class: 'swatch', value: S.catColor[c.id], 'aria-label': c.name + ' colour', title: 'Colour' });
    sw.addEventListener('input', () => { S.catColor[c.id] = sw.value; saveSettings(); rebuild(); });
    const caret = h('button', { class: 'caret', 'aria-label': 'Show predicates in ' + c.name, 'aria-expanded': S.openCats.has(c.id) ? 'true' : 'false', disabled: !preds.length }, caretSvg());
    caret.addEventListener('click', () => {
      if (S.openCats.has(c.id)) S.openCats.delete(c.id); else S.openCats.add(c.id);
      wrap.classList.toggle('open'); caret.setAttribute('aria-expanded', wrap.classList.contains('open') ? 'true' : 'false');
    });
    wrap.append(h('div', { class: 'cat-head', title: c.desc }, h('label', { class: 'check grow', style: { minWidth: 0 } }, cb, h('span', { class: 'name' }, c.name)), h('span', { class: 'n' }, total || '–'), sw, caret));
    const plist = h('div', { class: 'preds' });
    for (const pr of preds) {
      const k = c.id + '|' + pr.p;
      const pcb = h('input', { type: 'checkbox', 'aria-label': 'Show ' + qn(pr.p) });
      pcb.checked = !!S.catOn[c.id] && !S.predOff.has(k);
      pcb.addEventListener('change', () => {
        if (pcb.checked) { S.predOff.delete(k); S.catOn[c.id] = true; }   /* ticking one predicate switches its category on */
        else S.predOff.add(k);
        saveSettings(); renderCats(); rebuild();
      });
      const psw = h('input', { type: 'color', class: 'swatch', value: predColor(c.id, pr.p), 'aria-label': qn(pr.p) + ' colour' });
      psw.addEventListener('input', () => { S.predColor[k] = psw.value; saveSettings(); rebuild(); });
      const dirG = pr.info.dir === 0 ? '↔' : pr.info.dir === 1 ? '→' : '←';
      plist.append(h('div', { class: 'pred', title: `${pr.p}\n${pr.info.via ? 'Category: ' + pr.info.via : 'Known predicate'}\nDrawn ${pr.info.dir === 0 ? 'undirected' : pr.info.dir === 1 ? 'subject → object' : 'object → subject (inverse form)'}` },
        pcb, psw, h('span', { class: 'pn' }, qn(pr.p)), pr.info.known ? null : h('span', { class: 'guess' }, 'guess'), h('span', { class: 'pd' }, dirG), h('span', { class: 'n' }, pr.n)));
    }
    wrap.append(plist);
    box.append(wrap);
  }
}
function renderSystems() {
  const box = $('#systems');
  box.textContent = '';
  if (!S.G) return;
  const syss = [...S.G.nodes.values()].filter(n => n.kind === 'system' || n.sysToo).sort((a, b) => a.local.localeCompare(b.local));
  $('#sysCount').textContent = syss.length || '';
  if (!syss.length) { box.append(h('span', { class: 'hint' }, 'No system instances found.')); return; }
  for (const n of syss) {
    const members = systemMembers(n.iri);
    const chip = h('button', { class: 'chip' + (S.focusSystem === n.iri ? ' on' : ''), title: `${n.iri}\n${members.size - 1} members`, 'aria-pressed': S.focusSystem === n.iri ? 'true' : 'false' },
      h('span', { class: 'dot' }), h('span', null, displayName(n)), h('span', { class: 'muted', style: { fontSize: '11px' } }, members.size - 1));
    chip.addEventListener('click', () => {
      if (S.focusSystem === n.iri) { S.focusSystem = null; S.sysMembers = null; }
      else { S.focusSystem = n.iri; S.sysMembers = members; }
      renderSystems(); applyFocus();
    });
    box.append(chip);
  }
}
function renderTypePref() {
  const sel = $('#selTypePref');
  sel.textContent = '';
  sel.append(h('option', { value: 'specific' }, 'Most specific'));
  if (S.G) for (const [pfx] of S.G.typeNamespaces) sel.append(h('option', { value: pfx }, `Prefer ${pfx}: classes`));
  sel.value = [...sel.options].some(o => o.value === S.settings.typePref) ? S.settings.typePref : 'specific';
}
function renderAllPanels() {
  renderSources(); renderCats(); renderSystems(); renderTypePref(); updateQaSummary();
}
function updateCounts() {
  if (!S.G) return;
  const G = S.G;
  const total = G.nodes.size;
  let nPlaced = 0, nOff = 0;
  for (const iri of G.nodes.keys()) { if (placed(iri)) nPlaced++; else if (S.off.has(iri)) nOff++; }
  const shownTriples = S.groups.reduce((s, g) => s + g.edges.length, 0);
  $('#edgeCount').textContent = `${S.groups.length} lines`;
  $('#scopeHint').textContent = `${S.vis.size} of ${total} instances shown · ${nPlaced} placed on this drawing` + (nOff ? ` · ${nOff} not on it` : '');
  const st = $('#stats');
  st.textContent = '';
  st.append(h('div', null, h('b', null, fmtInt(G.triples)), ' triples · ', h('b', null, fmtInt(total)), ' instances · ', h('b', null, fmtInt(G.edges.length)), ' links between instances'));
  st.append(h('div', null, h('b', null, fmtInt(shownTriples)), ' links drawn as ', h('b', null, fmtInt(S.groups.length)), ' lines'));
  if (S.coordVia) st.append(h('div', null, 'Coordinates read from ', h('span', { class: 'mono' }, S.coordVia)));
  const nChg = activeChanges().length;
  if (nChg) st.append(h('div', null, h('b', null, nChg), ` change${nChg === 1 ? '' : 's'} from the change log applied · `, h('button', { class: 'linkbtn', onclick: () => openIssues('changes') }, 'Change log')));
  if (S.runs.length) { const r = S.runs[S.runs.length - 1]; st.append(h('div', null, `Last Claude anchoring: ${new Date(r.at).toLocaleString()} · ${r.placed} placed · ${r.model}`)); }
  if (S.isDemo) st.append(h('div', { style: { marginTop: '6px' } }, 'Demo: HTRK-VEN03 ventilation graph and drawing.'));
}
function updateQaSummary() {
  updateFindingsSummary();
  if (!S.G) { $('#qaText').textContent = ''; return; }
  const vals = Object.values(S.qa.nodes);
  const ok = vals.filter(v => v.status === 'ok').length, iss = vals.filter(v => v.status === 'issue').length, uns = vals.filter(v => v.status === 'unsure').length;
  const ev = Object.values(S.qa.edges), eIss = ev.filter(v => v.status === 'issue').length;
  const res = vals.filter(v => v.status === 'resolved').length;
  const total = S.G.nodes.size, reviewed = ok + iss + uns + res;
  $('#qaText').textContent = `Reviewed ${reviewed} / ${total} instances · ${iss} issue${iss === 1 ? '' : 's'} · ${uns} unsure` + (ev.length ? ` · ${eIss} link issue${eIss === 1 ? '' : 's'}` : '');
  $('#qaBar').style.width = (100 * reviewed / Math.max(1, total)).toFixed(1) + '%';
}

/* automatic checks — no LLM involved */
function computeChecks() {
  const G = S.G, out = [];
  const nodesOK = [...G.nodes.values()].filter(srcOK);
  const unplaced = nodesOK.filter(n => !placed(n.iri) && !S.off.has(n.iri));
  out.push({ id: 'unplaced', sev: '#c2410c', title: 'Not placed on the drawing yet', items: unplaced.map(n => ({ iri: n.iri, text: n.local })) });
  const low = nodesOK.filter(n => placed(n.iri) && S.anchors.get(n.iri).source === 'claude' && S.anchors.get(n.iri).conf < 0.6);
  out.push({ id: 'lowconf', sev: '#d97706', title: 'Low-confidence placements', items: low.map(n => ({ iri: n.iri, text: `${n.local} (${S.anchors.get(n.iri).conf})` })) });
  const flowDeg = new Map(), compo = new Set();
  for (const e of G.edges) {
    if (e.cat === 'flow') { if (!flowDeg.has(e.s)) flowDeg.set(e.s, new Set()); if (!flowDeg.has(e.o)) flowDeg.set(e.o, new Set()); flowDeg.get(e.s).add(e.o); flowDeg.get(e.o).add(e.s); }
    if (e.cat === 'composition') { compo.add(e.s); compo.add(e.o); }
  }
  const noFlow = nodesOK.filter(n => ['component', 'segment', 'fitting'].includes(n.kind) && !flowDeg.has(n.iri) && !compo.has(n.iri));
  out.push({ id: 'noflow', sev: '#b91c1c', title: 'Components without any flow link', items: noFlow.map(n => ({ iri: n.iri, text: n.local })) });
  const open = nodesOK.filter(n => n.kind === 'segment' && (flowDeg.get(n.iri)?.size || 0) === 1);
  out.push({ id: 'open', sev: '#d97706', title: 'Segments with one flow neighbour (open end)', items: open.map(n => ({ iri: n.iri, text: n.local })) });
  const fl = S.groups.filter(g => g.cat === 'flow' && placed(g.a) && placed(g.b));
  const lens = fl.map(g => { const a = S.anchors.get(g.a), b = S.anchors.get(g.b); return Math.hypot(a.x - b.x, a.y - b.y); });
  const sorted = [...lens].sort((a, b) => a - b), med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const diag = Math.hypot(drawW(), drawH());
  const thr = Math.max(med * 5, diag * 0.22);
  const longs = fl.map((g, i) => [g, lens[i]]).filter(([, L]) => L > thr).sort((a, b) => b[1] - a[1]);
  out.push({ id: 'long', sev: '#d97706', title: 'Long flow links (collapsed runs, wrong connection or misplaced anchor)', items: longs.map(([g, L]) => ({ group: g, text: `${G.nodes.get(g.a).local} – ${G.nodes.get(g.b).local} (${Math.round(L)} px)` })) });
  const two = S.groups.filter(g => g.cat === 'flow' && g.ab && g.ba);
  out.push({ id: 'twoway', sev: '#b91c1c', title: 'Flow asserted in both directions', items: two.map(g => ({ group: g, text: `${G.nodes.get(g.a).local} ⇄ ${G.nodes.get(g.b).local}` })) });
  const untyped = nodesOK.filter(n => !n.types.size);
  out.push({ id: 'untyped', sev: '#64748b', title: 'Instances without rdf:type', items: untyped.map(n => ({ iri: n.iri, text: n.local })) });
  if (S.drawing) {
    const outside = nodesOK.filter(n => S.anchors.has(n.iri) && !S.off.has(n.iri) && (() => { const a = S.anchors.get(n.iri); return a.x < 0 || a.y < 0 || a.x > drawW() || a.y > drawH(); })());
    out.push({ id: 'outside', sev: '#b91c1c', title: 'Anchors outside the drawing', items: outside.map(n => ({ iri: n.iri, text: n.local })) });
  }
  return out.filter(c => c.items.length);
}
const openChecks = new Set();
const checkItemKey = it => (it.iri ? it.iri : 'e:' + it.group.qaKey);
const checkItemRec = it => (it.iri ? S.qa.nodes[it.iri] : S.qa.edges[it.group.qaKey]) || null;
const checkItemStatus = it => (checkItemRec(it) || {}).status || '';
function updateMarked() {
  const set = new Set();
  for (const marks of S.checkMarks.values()) for (const k of marks) {
    if (!k.startsWith('e:')) set.add(k);
    else { const g = S.groups.find(x => x.qaKey === k.slice(2)); if (g) { set.add(g.a); set.add(g.b); } }
  }
  S.marked = set;
  frame();
}
function checkFocus(id) {
  const c = (S.checks || []).find(x => x.id === id), set = new Set(), edges = new Set();
  if (c) for (const it of c.items) {
    if (it.iri) set.add(it.iri);
    else { const g = S.groups.find(x => x.key === it.group.key) || S.groups.find(x => x.qaKey === it.group.qaKey); if (g) { edges.add(g); set.add(g.a); set.add(g.b); } }
  }
  return { set, edges };
}
function showCheck(id) {
  const c = (S.checks || []).find(x => x.id === id);
  if (!c) return;
  const iris = c.items.flatMap(it => (it.iri ? [it.iri] : [it.group.a, it.group.b]));
  if (S.scope !== 'full' && iris.some(i => !S.vis.has(i))) { setScope('full'); toast('Switched to Full graph so every item can be shown'); }
  setIssueFocus(c.title, () => checkFocus(id), { check: id });
  const pts = [...new Set(iris)].map(i => S.pos.get(i)).filter(Boolean);
  if (pts.length) centerOn(pts);
  renderChecks();
}
function goToCheckItem(it) {
  if (it.iri) { select(it.iri); return; }
  const g = S.groups.find(x => x.key === it.group.key) || it.group;
  const pa = S.pos.get(g.a), pb = S.pos.get(g.b);
  if (pa && pb) centerOn([pa, pb]);
  const st = $('#stage').getBoundingClientRect();
  setTimeout(() => openEdgePop(g, st.left + st.width / 2, st.top + st.height / 2), 280);
}
function renderChecks() {
  const box = $('#checks');
  const scrolls = new Map($$('.check-group', box).map(el => [el.dataset.id, (el.querySelector('ul') || {}).scrollTop || 0]));
  box.textContent = '';
  if (!S.G) { S.checks = []; return; }
  const checks = S.checks = computeChecks();
  if (!checks.length) box.append(h('p', { class: 'hint' }, 'No automatic findings.'));
  for (const c of checks) {
    const el = checkGroupEl(c);
    box.append(el);
    const ul = el.querySelector('ul');
    if (ul && scrolls.get(c.id)) ul.scrollTop = scrolls.get(c.id);
  }
  /* drop marks for reports that no longer have items */
  for (const id of [...S.checkMarks.keys()]) if (!checks.some(c => c.id === id)) S.checkMarks.delete(id);
  updateMarked();
}
function checkGroupEl(c) {
  let marks = S.checkMarks.get(c.id);
  if (!marks) S.checkMarks.set(c.id, marks = new Set());
  const keys = new Set(c.items.map(checkItemKey));
  for (const k of [...marks]) if (!keys.has(k)) marks.delete(k);
  const undec = c.items.filter(it => !checkItemStatus(it)).length;
  const isOpen = openChecks.has(c.id), focused = !!(S.issueFocus && S.issueFocus.check === c.id);
  const head = h('button', { class: 'cg-head', 'aria-expanded': isOpen ? 'true' : 'false', title: 'Options for this report' },
    h('span', { class: 'sev', style: { background: c.sev } }), h('span', { class: 'cg-title' }, c.title),
    undec ? h('span', { class: 'cg-undec', title: `${undec} of ${c.items.length} not decided yet` }, `${undec} open`) : h('span', { class: 'cg-done', title: 'Every item has a decision' }, '✓'),
    h('span', { class: 'n' }, c.items.length));
  head.addEventListener('click', () => { if (openChecks.has(c.id)) openChecks.delete(c.id); else openChecks.add(c.id); renderChecks(); });
  const wrap = h('div', { class: 'check-group' + (isOpen ? ' open' : '') + (focused ? ' focused' : ''), 'data-id': c.id }, head);
  if (!isOpen) return wrap;
  const onlyUndec = S.checkUndecided.has(c.id);
  const items = c.items.filter(it => !onlyUndec || !checkItemStatus(it));
  const unmarkBtn = h('button', { class: 'btn small ghost', disabled: !marks.size, onclick: () => { marks.clear(); renderChecks(); } }, 'Unmark all');
  const decideBtn = h('button', { class: 'btn small primary', disabled: !marks.size, onclick: () => openDecideModal(c) });
  const syncBtns = () => { decideBtn.textContent = marks.size ? `Decide for ${marks.size} marked…` : 'Decide for marked…'; decideBtn.disabled = unmarkBtn.disabled = !marks.size; };
  syncBtns();
  const undecCb = h('input', { type: 'checkbox' });
  undecCb.checked = onlyUndec;
  undecCb.addEventListener('change', () => { if (undecCb.checked) S.checkUndecided.add(c.id); else S.checkUndecided.delete(c.id); renderChecks(); });
  wrap.append(
    h('div', { class: 'cg-tools' },
      h('button', { class: 'btn small' + (focused ? ' on' : ''), 'aria-pressed': focused ? 'true' : 'false', title: 'Highlight every item of this report on the drawing and dim the rest',
        onclick: () => (focused ? clearIssueFocus() : showCheck(c.id)) }, focused ? 'Showing all ✕' : 'Show all'),
      h('button', { class: 'btn small ghost', onclick: () => { for (const it of items) marks.add(checkItemKey(it)); renderChecks(); } }, 'Mark all'),
      unmarkBtn),
    h('div', { class: 'cg-tools' }, decideBtn, h('label', { class: 'check', style: { minHeight: 0, fontSize: '12px', marginLeft: 'auto' } }, undecCb, 'Undecided only')));
  const ul = h('ul');
  for (const it of items.slice(0, 400)) {
    const k = checkItemKey(it), rec = checkItemRec(it), st = (rec || {}).status || '';
    const cb = h('input', { type: 'checkbox', 'aria-label': 'Mark ' + it.text });
    cb.checked = marks.has(k);
    cb.addEventListener('change', () => { if (cb.checked) marks.add(k); else marks.delete(k); syncBtns(); updateMarked(); });
    ul.append(h('li', { class: st ? 'decided' : '' }, cb,
      h('button', { class: 'cg-name', title: it.text + (rec && rec.note ? '\n— ' + rec.note : ''), onclick: () => goToCheckItem(it) }, it.text),
      st ? h('span', { class: 'schip mini ' + st, title: rec.note || '' }, STATUS_LABEL[st] || st) : h('span', { class: 'cg-dot', title: 'Not decided yet' })));
  }
  if (items.length > 400) ul.append(h('li', { class: 'hint' }, `+${items.length - 400} more (Mark all includes them)`));
  if (!items.length) ul.append(h('li', { class: 'hint', style: { padding: '4px 10px' } }, 'Every item has a decision.'));
  wrap.append(ul);
  return wrap;
}
function openDecideModal(c) {
  const marks = S.checkMarks.get(c.id);
  if (!marks || !marks.size) return;
  const items = c.items.filter(it => marks.has(checkItemKey(it)));
  let decision = 'issue';
  const DEC = [['issue', 'Issue — needs fixing'], ['unsure', 'Unsure'], ['ok', 'Correct — no change']];
  const hint = h('p', { class: 'hint', style: { marginTop: '6px' } });
  const syncHint = () => { hint.textContent = decision === 'ok' ? 'They count as decided and stay out of Resolve with Claude.' : 'They appear in the Issues panel with this comment and go to Claude together in Resolve with Claude.'; };
  const seg = h('div', { class: 'qa-seg', role: 'group', 'aria-label': 'Decision' });
  for (const [v, label] of DEC) {
    const b = h('button', { 'data-v': v, class: v === decision ? 'on' : '', 'aria-pressed': v === decision ? 'true' : 'false' }, label);
    b.addEventListener('click', () => { decision = v; $$('button', seg).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); syncHint(); });
    seg.append(b);
  }
  syncHint();
  const ta = h('textarea', { class: 'note', style: { minHeight: '90px' }, placeholder: 'One comment for all of them, e.g. "Drawn ducts without a flow link: connect each to the duct or fitting it touches on the drawing."' });
  const notes = [...new Set(items.map(it => (checkItemRec(it) || {}).note).filter(Boolean))];
  if (notes.length === 1) ta.value = notes[0];
  const keep = h('input', { type: 'checkbox' });
  keep.checked = notes.length > 1;
  const save = h('button', { class: 'btn primary' }, `Save for ${items.length}`);
  save.addEventListener('click', () => {
    const snap = snapshot(), now = new Date().toISOString(), text = ta.value.trim();
    for (const it of items) {
      const store = it.iri ? S.qa.nodes : S.qa.edges, key = it.iri || it.group.qaKey;
      const rec = store[key] || {};
      rec.status = decision; rec.at = now; rec.check = c.title;
      if (text) rec.note = keep.checked && rec.note && !rec.note.includes(text) ? rec.note + '\n' + text : text;
      store[key] = rec;
    }
    marks.clear();
    const label = DEC.find(d => d[0] === decision)[1].split(' —')[0].toLowerCase();
    commit(`decide ${items.length} × ${label}: ${c.title}`, snap);
    persist(); closeModal(); refreshNodeClasses(); applyFocus(); updateQaSummary(); renderChecks(); renderIssues();
    refreshInspector();
    toast(`${items.length} item${items.length === 1 ? '' : 's'} marked ${label}` + (decision !== 'ok' ? ' — listed in Issues for Resolve with Claude' : ''), decision !== 'ok' ? { label: 'Open Issues', fn: () => openIssues('flags') } : null);
  });
  openModal(`Decide for ${items.length} marked item${items.length === 1 ? '' : 's'}`, [
    h('p', null, 'From the report ', h('b', null, c.title), '. Every marked item gets the same decision and comment.'),
    h('div', { class: 'chips', style: { margin: '0 0 12px', maxHeight: '104px', overflow: 'auto' } }, items.slice(0, 60).map(it => h('span', { class: 'chip' }, h('span', null, it.text))), items.length > 60 ? h('span', { class: 'muted' }, `+${items.length - 60} more`) : null),
    h('h3', null, 'Decision'), seg, hint,
    h('h3', null, 'Comment for the refinement'), ta,
    notes.length ? h('label', { class: 'check', style: { marginTop: '6px', fontSize: '12px' } }, keep, `Keep the ${notes.length === 1 ? 'existing comment' : notes.length + ' different existing comments'} and add this one below`) : null,
  ], [h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'), save]);
  setTimeout(() => ta.focus(), 0);
}
/* one shared highlight: a check report, a rule, a flag or a change — everything else is dimmed */
function setIssueFocus(label, compute, extra = {}) {
  if (S.selection.length) deselect({ restore: false });
  S.hovered = null;
  S.issueFocus = { label, compute, ...extra, ...compute() };
  applyFocus(); renderFocusPill();
}
function clearIssueFocus() {
  if (!S.issueFocus) return;
  const wasCheck = !!S.issueFocus.check;
  S.issueFocus = null;
  applyFocus(); renderFocusPill();
  if (wasCheck) renderChecks();
}
function renderFocusPill() {
  const p = $('#focusPill');
  if (!p) return;
  const f = S.issueFocus;
  p.textContent = '';
  p.hidden = !f;
  if (!f) return;
  p.append(h('span', { class: 'fp-dot' }), h('span', { class: 'fp-text' }, h('b', null, f.set ? f.set.size : 0), ` highlighted · ${f.label}`),
    h('button', { class: 'x-btn', 'aria-label': 'Clear highlight', title: 'Clear highlight (Esc)', onclick: clearIssueFocus }, '✕'));
}
function updateBanner() {
  const b = $('#banner');
  b.textContent = '';
  if (!S.G || !S.drawing || S.areaMode) { b.hidden = true; return; }
  const un = [...S.G.nodes.values()].filter(n => srcOK(n) && !placed(n.iri) && !S.off.has(n.iri)).length;
  if (!un) { b.hidden = true; return; }
  b.append(h('span', null, `${un} instance${un === 1 ? ' is' : 's are'} not placed on the drawing yet.`));
  b.append(h('button', { class: 'btn small primary', onclick: openAnchorModal }, 'Anchor with Claude'));
  if (S.scope !== 'full') b.append(h('button', { class: 'btn small', onclick: () => setScope('full') }, 'Show them'));
  b.hidden = false;
}
function updateHeader() {
  const g = $('#dsGraph'), d = $('#dsDrawing');
  const nChg = S.G ? activeChanges().length : 0;
  g.textContent = S.graphs.length ? S.graphs.map(x => x.name).join(' + ') + (nChg ? ` · ${nChg} change${nChg === 1 ? '' : 's'}` : '') : 'No graph';
  g.title = g.textContent + (nChg ? ' applied from the change log (the files themselves are unchanged)' : '');
  d.textContent = S.drawing ? S.drawing.name : 'no drawing';
  d.title = S.drawing ? `${S.drawing.name} · ${S.drawing.w}×${S.drawing.h}px` : '';
  const sel = $('#pdfPage');
  if (S.drawing && S.drawing.kind === 'pdf' && S.drawing.pages > 1) {
    sel.textContent = '';
    for (let i = 1; i <= S.drawing.pages; i++) sel.append(h('option', { value: i }, `p. ${i}/${S.drawing.pages}`));
    sel.value = S.drawing.page; sel.hidden = false;
  } else sel.hidden = true;
  renderSetup();
}
function showEmpty() { renderSetup(); }

/* =====================================================================
   11. Search
   ===================================================================== */
let searchSel = 0;
function runSearch() {
  const q = $('#search').value.trim().toLowerCase();
  const box = $('#searchResults');
  box.textContent = '';
  if (!q || !S.G) { box.hidden = true; return; }
  const res = [];
  for (const n of S.G.nodes.values()) {
    const types = [...n.types].map(qn).join(' ');
    const hay = (n.local + ' ' + (n.label || '') + ' ' + n.iri + ' ' + types).toLowerCase();
    const i = hay.indexOf(q);
    if (i >= 0) res.push([n, (n.local.toLowerCase().startsWith(q) ? 0 : 1) + (i > 0 ? 0.5 : 0)]);
  }
  res.sort((a, b) => a[1] - b[1] || a[0].local.localeCompare(b[0].local));
  searchSel = 0;
  for (const [n] of res.slice(0, 40)) {
    const t = displayTypes(n)[0];
    box.append(h('button', { 'data-iri': n.iri, onclick: () => pickSearch(n.iri) }, h('span', { class: 'nm' }, displayName(n)), placed(n.iri) ? '' : h('span', { class: 'muted' }, S.off.has(n.iri) ? '  · not on drawing' : '  · unplaced'), h('span', { class: 't' }, t ? qn(t) : '(no type)')));
  }
  if (!res.length) box.append(h('div', { class: 'hint', style: { padding: '6px 8px', margin: 0 } }, 'No match'));
  if (res.length > 40) box.append(h('div', { class: 'hint', style: { padding: '4px 8px', margin: 0 } }, `${res.length - 40} more — refine the search`));
  box.hidden = false;
  markSearch();
}
function markSearch() { $$('#searchResults button').forEach((b, i) => b.classList.toggle('act', i === searchSel)); }
function pickSearch(iri) { $('#searchResults').hidden = true; $('#search').blur(); select(iri); }

/* =====================================================================
   12. One-time anchoring with Claude (+ prompt export / layout import)
   ===================================================================== */
const TARGET_PX = 1.15e6, MAX_SIDE = 1568;
function niceStep(raw) { const c = [25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000]; return c.find(x => x >= raw) || c[c.length - 1]; }
function chooseGrid(W, H, maxT) {
  let best = null;
  for (let c = 1; c <= 6; c++) for (let r = 1; r <= 6; r++) {
    const n = c * r;
    if (n > maxT || n < 2) continue;
    const tw = Math.min(W, (W / c) * 1.08), th = Math.min(H, (H / r) * 1.08);
    const sc = Math.min(1, Math.sqrt(TARGET_PX / (tw * th)), MAX_SIDE / Math.max(tw, th));
    const score = sc >= 0.6 ? 1000 - n : sc * 100;
    if (!best || score > best.score) best = { c, r, tw, th, sc, score };
  }
  return best;
}
async function renderTile(x0, y0, w, hgt, caption) {
  const sc = Math.min(1, Math.sqrt(TARGET_PX / (w * hgt)), MAX_SIDE / Math.max(w, hgt));
  const cw = Math.round(w * sc), ch = Math.round(hgt * sc);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawingEl, x0, y0, w, hgt, 0, 0, cw, ch);
  const step = niceStep(w / 11);
  ctx.save();
  ctx.strokeStyle = 'rgba(219,39,119,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  ctx.font = '600 12px Arial, sans-serif'; ctx.textBaseline = 'top';
  const tag = (t, x, y, align) => {
    const tw = ctx.measureText(t).width + 6;
    const bx = align === 'r' ? x - tw : align === 'c' ? x - tw / 2 : x;
    ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(bx, y, tw, 15);
    ctx.fillStyle = '#be185d'; ctx.fillText(t, bx + 3, y + 1.5); ctx.setLineDash([5, 4]);
  };
  for (let gx = Math.ceil(x0 / step) * step; gx <= x0 + w; gx += step) {
    const X = Math.round((gx - x0) * sc) + 0.5;
    ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, ch); ctx.stroke();
    tag('x=' + gx, X, 2, 'c'); tag('x=' + gx, X, ch - 17, 'c');
  }
  for (let gy = Math.ceil(y0 / step) * step; gy <= y0 + hgt; gy += step) {
    const Y = Math.round((gy - y0) * sc) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(cw, Y); ctx.stroke();
    tag('y=' + gy, 2, Y - 7, 'l'); tag('y=' + gy, cw - 2, Y - 7, 'r');
  }
  ctx.restore();
  ctx.font = '700 13px Arial, sans-serif';
  const capW = ctx.measureText(caption).width + 12;
  ctx.fillStyle = 'rgba(17,24,39,0.88)'; ctx.fillRect(22, 22, capW, 20);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.fillText(caption, 28, 25);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  return { blob, scale: sc };
}
async function makeImages(maxImages, withRefs) {
  const W = drawW(), H = drawH();
  const imgs = [], labels = [];
  const nRef = withRefs ? refBudget(maxImages, 1) : 0;
  const nTiles = Math.max(0, maxImages - 1 - nRef);
  const over = await renderTile(0, 0, W, H, `OVERVIEW — whole drawing ${W}×${H} px`);
  imgs.push(over.blob); labels.push(`overview of the whole drawing (scaled to ${Math.round(over.scale * 100)} %)`);
  let detail = over.scale;
  if (nTiles >= 2 && over.scale < 0.95) {
    const g = chooseGrid(W, H, nTiles);
    const tw = Math.round(g.tw), th = Math.round(g.th);
    for (let r = 0; r < g.r; r++) for (let c = 0; c < g.c; c++) {
      const x0 = clamp(Math.round(c * W / g.c - (tw - W / g.c) / 2), 0, W - tw);
      const y0 = clamp(Math.round(r * H / g.r - (th - H / g.r) / 2), 0, H - th);
      const t = await renderTile(x0, y0, tw, th, `TILE r${r + 1}c${c + 1} — x ${x0}–${x0 + tw}, y ${y0}–${y0 + th}`);
      imgs.push(t.blob); labels.push(`tile row ${r + 1}, column ${c + 1}: x ${x0}–${x0 + tw}, y ${y0}–${y0 + th} (scaled to ${Math.round(t.scale * 100)} %)`);
      detail = t.scale;
    }
  }
  for (const r of refImages().slice(0, nRef)) { imgs.push(r.blob); labels.push(r.label); }
  return { imgs, labels, detail, refSent: nRef };
}
function idMapFor(nodes) {
  const map = new Map(), rev = new Map();
  for (const n of nodes) {
    let id = n.local.replace(/\s+/g, '_');
    let k = 2;
    while (map.has(id)) id = n.local + '~' + k++;
    map.set(id, n.iri); rev.set(n.iri, id);
  }
  return { map, rev };
}
function describeForPrompt(n, rev) {
  const G = S.G;
  const types = displayTypes(n).slice(0, 4).map(qn).join(', ') || '-';
  const attrs = [];
  if (n.label) attrs.push(`label="${n.label}"`);
  for (const l of n.lits) {
    if (LABEL_PREDS.includes(l.p) || l.blank) continue;
    const ln = localName(l.p);
    if (/^(drawing)?[xy]$/i.test(ln) || /[XY]$/.test(ln) && /drawing|pos|coord/i.test(ln)) continue;
    const v = l.o.value.replace(/\s+/g, ' ');
    if (v.length > 60) continue;
    attrs.push(`${ln}="${v}"`);
    if (attrs.length >= 6) break;
  }
  const nm = iri => rev.get(iri) || G.nodes.get(iri).local;
  const rels = [];
  const list = (arr, max = 6) => arr.slice(0, max).map(nm).join(', ') + (arr.length > max ? ` +${arr.length - max}` : '');
  const fromF = canonicalNeighbours(n, 'flow', 'in'), toF = canonicalNeighbours(n, 'flow', 'out');
  if (fromF.length) rels.push('flow from ' + list(fromF));
  if (toF.length) rels.push('flow to ' + list(toF));
  const inLoc = canonicalNeighbours(n, 'location', 'in'), hasLoc = canonicalNeighbours(n, 'location', 'out');
  if (inLoc.length) rels.push('in ' + list(inLoc, 3));
  if (hasLoc.length) rels.push('contains ' + list(hasLoc, 6));
  const sys = canonicalNeighbours(n, 'system', 'in'), mem = canonicalNeighbours(n, 'system', 'out');
  if (sys.length) rels.push('system ' + list(sys, 3));
  if (mem.length) rels.push(`members: ${mem.length}`);
  const partOf = canonicalNeighbours(n, 'composition', 'in'), parts = canonicalNeighbours(n, 'composition', 'out');
  if (partOf.length) rels.push('part of ' + list(partOf, 3));
  if (parts.length) rels.push('parts ' + list(parts, 6));
  return `${rev.get(n.iri)} | ${types} | ${attrs.join('; ') || '-'} | ${rels.join('; ') || '-'}`;
}
function buildAnchorPrompt(targets, opts) {
  const W = drawW(), H = drawH();
  const { rev } = opts.ids;
  const L = [];
  L.push('You are helping quality-check a knowledge graph (RDF) that was extracted automatically from an engineering drawing (a P&ID / flow schematic). Anchor each listed graph instance on the drawing: find the symbol, line or text that represents it and report its position.');
  if (opts.mode === 'tiles') {
    L.push('', `The full drawing is ${W} × ${H} pixels. Images, in order:`);
    opts.labels.forEach((t, i) => L.push(`- Image ${i + 1}: ${t}`));
    L.push(...refNoteLines(opts.refSent || 0));
    L.push(`Magenta dashed grid lines are labelled with FULL-drawing pixel coordinates ("x=…" along the top and bottom edges, "y=…" along the left and right edges). Read positions off those labels and interpolate between lines. Report every position in FULL-drawing pixels (0 ≤ x ≤ ${W}, 0 ≤ y ≤ ${H}) — never in tile pixels. Use the overview to find your way and the tiles for precision.`);
  } else {
    L.push('', `Use the attached drawing image (the original is ${W} × ${H} px${opts.legend ? '; a symbol legend image may also be attached' : ''}). Report positions as normalised coordinates from 0 to 1000: x = 0 at the left edge and 1000 at the right edge, y = 0 at the top edge and 1000 at the bottom edge.`);
  }
  L.push('', 'Placement conventions:', ...CONVENTIONS);
  L.push('', 'Use each instance\'s classes, attributes and relations to tell repeated symbols apart: a duct/pipe segment lies on the line between its flow neighbours; a terminal or damper sits inside the room it is located in; parts sit inside or next to their parent unit. Do not invent positions for things that are not drawn.');
  if (opts.known.length) {
    L.push('', `Already placed (for orientation only — do not return these): id @ x,y${opts.mode === 'tiles' ? ' in full-drawing px' : ' in normalised 0–1000'}`);
    for (const k of opts.known) L.push(`${k.id} @ ${k.x},${k.y}`);
  }
  L.push('', `Instances to place (${targets.length}) — id | classes | attributes | relations:`);
  for (const n of targets) L.push(describeForPrompt(n, rev));
  L.push('', 'Reply with only this JSON object, no prose:');
  L.push(opts.mode === 'tiles'
    ? '{"anchors":[{"id":"<id>","x":<int>,"y":<int>,"conf":<0..1>,"why":"<what you anchored on, max 8 words>"}],"notOnDrawing":["<id>"]}'
    : '{"units":"norm1000","anchors":[{"id":"<id>","x":<0..1000>,"y":<0..1000>,"conf":<0..1>,"why":"<max 8 words>"}],"notOnDrawing":["<id>"]}');
  L.push('Every listed id must appear exactly once, either in "anchors" or in "notOnDrawing" (use that when nothing on this drawing represents the instance). Use conf below 0.5 when unsure.');
  return L.join('\n');
}
function parseLooseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(text.slice(i, j + 1)); } catch { /* fall through */ } }
  return null;
}
function resolveId(id, idMap) {
  if (id == null) return null;
  id = String(id);
  if (idMap && idMap.has(id)) return idMap.get(id);
  if (S.G.nodes.has(id)) return id;
  for (const n of S.G.nodes.values()) if (n.local === id || qn(n.iri) === id) return n.iri;
  return null;
}
function applyAnchorResult(obj, idMap, meta) {
  const W = drawW(), H = drawH();
  const res = { placed: 0, off: 0, unknown: [], outside: 0, skippedManual: 0 };
  const units = obj.units || meta.units || 'px';
  const fx = units === 'norm1000' ? W / 1000 : units === 'norm1' ? W : 1, fy = units === 'norm1000' ? H / 1000 : units === 'norm1' ? H : 1;
  const arr = Array.isArray(obj.anchors) ? obj.anchors : [];
  for (const a of arr) {
    const iri = resolveId(a.id ?? a.iri, idMap);
    if (!iri) { res.unknown.push(String(a.id ?? a.iri)); continue; }
    if (!meta.overrideManual && S.anchors.get(iri)?.source === 'manual') { res.skippedManual++; continue; }
    const x = Number(a.x) * fx, y = Number(a.y) * fy;
    if (!isFinite(x) || !isFinite(y)) { res.unknown.push(String(a.id)); continue; }
    if (x < -W * 0.02 || y < -H * 0.02 || x > W * 1.02 || y > H * 1.02) { res.outside++; continue; }
    S.anchors.set(iri, { x: Math.round(clamp(x, 0, W)), y: Math.round(clamp(y, 0, H)), source: meta.source, conf: a.conf != null ? Math.round(clamp(Number(a.conf), 0, 1) * 100) / 100 : null, why: a.why ? String(a.why).slice(0, 120) : null });
    S.off.delete(iri);
    if (meta.asOriginal || !S.orig.has(iri)) S.orig.set(iri, { ...S.anchors.get(iri) });
    res.placed++;
  }
  for (const id of Array.isArray(obj.notOnDrawing) ? obj.notOnDrawing : []) {
    const iri = resolveId(id, idMap);
    if (!iri) { res.unknown.push(String(id)); continue; }
    if (!meta.overrideManual && S.anchors.get(iri)?.source === 'manual') { res.skippedManual++; continue; }
    S.off.add(iri); res.off++;
  }
  return res;
}
function importLayoutObject(obj, { silent = false, asOriginal = false } = {}) {
  if (!S.G) { toast('Open a graph first, then import the layout'); return; }
  if (!obj || typeof obj !== 'object') { toast('Not a layout file'); return; }
  const snap = silent ? null : snapshot();
  let res;
  if (obj.format === 'kg-overlay-layout/1' || (obj.anchors && !Array.isArray(obj.anchors))) {
    res = { placed: 0, off: 0, unknown: [] };
    const units = obj.units || 'px';
    const W = drawW(), H = drawH();
    const fx = units === 'norm1000' ? W / 1000 : units === 'norm1' ? W : 1, fy = units === 'norm1000' ? H / 1000 : units === 'norm1' ? H : 1;
    if (obj.artifact && S.drawing && obj.artifact.width && obj.artifact.width !== W && units === 'px') {
      const sx = W / obj.artifact.width, sy = H / (obj.artifact.height || obj.artifact.width * H / W);
      for (const v of Object.values(obj.anchors || {})) { v.x *= sx; v.y *= sy; }
      if (!silent) toast('Layout was made for a different image size — positions were rescaled');
    }
    if (Array.isArray(obj.changes) && obj.changes.length) {   /* change log first: it can add instances the anchors refer to */
      const have = new Set(S.changes.map(c => c.id));
      let added = 0;
      for (const c of obj.changes) if (c && c.id && Array.isArray(c.del) && Array.isArray(c.ins) && !have.has(c.id)) { S.changes.push(c); added++; }
      S.changes.sort((x, y) => (x.seq || 0) - (y.seq || 0));
      S.changeSeq = S.changes.reduce((m, c) => Math.max(m, c.seq || 0), 0);
      if (added) regraph();
    }
    for (const [k, v] of Object.entries(obj.anchors || {})) {
      const iri = resolveId(k);
      if (!iri) { res.unknown.push(k); continue; }
      S.anchors.set(iri, { x: Math.round(v.x * fx), y: Math.round(v.y * fy), source: v.source || 'import', conf: v.conf ?? null, why: v.why || null });
      if (asOriginal || !S.orig.has(iri)) S.orig.set(iri, { ...S.anchors.get(iri) });
      res.placed++;
    }
    for (const k of obj.offDrawing || []) { const iri = resolveId(k); if (iri) { S.off.add(iri); S.anchors.delete(iri); res.off++; } else res.unknown.push(k); }
    if (obj.qa) {
      for (const [k, v] of Object.entries(obj.qa.nodes || {})) { const iri = resolveId(k); if (iri) S.qa.nodes[iri] = v; }
      Object.assign(S.qa.edges, obj.qa.edges || {});
    }
    if (Array.isArray(obj.findings)) {
      const have = new Set(S.findings.map(f => f.id));
      for (const f of obj.findings) if (f && f.id && !have.has(f.id)) { S.findings.push(f); S.findingSeq = Math.max(S.findingSeq, f.seq || 0); }
      const runs = new Set(S.recheckRuns.map(r => r.id));
      for (const r of obj.recheckRuns || []) if (r && r.id && !runs.has(r.id)) S.recheckRuns.push(r);
      updateFindingsSummary();
    }
    if (Array.isArray(obj.rules)) { const have = new Set(S.rules.map(r => r.id)); for (const r of obj.rules) if (r && r.id && !have.has(r.id)) S.rules.push(r); }
  } else {
    res = applyAnchorResult(obj, null, { source: 'import', overrideManual: true, asOriginal });
  }
  commit('import layout', snap);
  persist();
  if (!silent) {
    rebuild(); updateQaSummary();
    toast(`Imported ${res.placed} positions` + (res.off ? `, ${res.off} not on drawing` : '') + (res.unknown.length ? ` · ${res.unknown.length} unknown ids skipped` : ''));
  }
}

const SAMPLE_ERR = {
  not_granted: 'Claude access was not allowed for this page.',
  sampling_disabled: 'Claude isn\'t available for this account.',
  not_declared: 'This page can\'t call Claude.', capability_disabled: 'Claude isn\'t available in this view.', capability_removed: 'Claude isn\'t available in this view.',
  images_unavailable: 'This view can\'t send images to Claude.', image_rejected: 'A drawing image was rejected — try a smaller drawing.',
  rate_limited: 'Usage limit reached or too many requests — try again later.', session_expired: 'Your session expired — sign in again, then retry.',
  refused: 'Claude declined this request.', empty_completion: 'Claude returned an empty answer — try again.',
  prompt_too_large: 'The instance list is too large for one request.', upstream_error: 'Connection problem — try again.',
  invalid_request: 'The request was rejected as malformed.', transform_error: 'The images could not be prepared.', queue_overflow: 'Too many requests at once.',
};
function anchorTargets(mode) {
  return [...S.G.nodes.values()].filter(n => srcOK(n) && (mode === 'all' ? S.anchors.get(n.iri)?.source !== 'manual' : !placed(n.iri) && !S.off.has(n.iri)));
}
function knownForPrompt(exclude, units, ids) {
  const W = drawW(), H = drawH();
  const known = [];
  for (const [iri, a] of S.anchors) {
    if (exclude.has(iri) || S.off.has(iri)) continue;
    const n = S.G.nodes.get(iri);
    if (!n || !srcOK(n)) continue;
    known.push({ id: ids.rev.get(iri) || n.local, x: units === 'norm1000' ? Math.round(a.x / W * 1000) : a.x, y: units === 'norm1000' ? Math.round(a.y / H * 1000) : a.y, pri: a.source === 'manual' ? 0 : a.source === 'kg' ? 1 : 2 });
  }
  known.sort((a, b) => a.pri - b.pri);
  return known.slice(0, 260);
}

function openModal(title, bodyNodes, footNodes, opts = {}) {
  $('#modalTitle').textContent = title;
  $('#modal .modal').className = 'modal' + (opts.wide ? ' wide' : '');
  const b = $('#modalBody'), f = $('#modalFoot');
  b.textContent = ''; f.textContent = '';
  b.append(...[].concat(bodyNodes).filter(x => x != null && x !== false)); f.append(...[].concat(footNodes || []).filter(x => x != null && x !== false));
  $('#modal').hidden = false;
  setTimeout(() => { const first = f.querySelector('.btn.primary') || $('#modalClose'); first.focus(); }, 0);
}
function closeModal() {
  if (S.claudeCtl) return;
  $('#modal').hidden = true;
}

async function openAnchorModal() {
  if (!S.G || !S.drawing) { toast('Open a graph and its drawing first'); return; }
  const sample = await getSample();
  const unplaced = anchorTargets('unplaced'), all = anchorTargets('all');
  const body = [];
  body.push(h('p', null, 'Claude looks at the drawing once and places each graph instance on the symbol, line or label that represents it. Everything after that runs locally in this page. The result is saved in this browser and can be exported as a layout file, so you only need to do this once per graph and drawing.'));
  const optU = h('input', { type: 'radio', name: 'amode', value: 'unplaced' });
  const optA = h('input', { type: 'radio', name: 'amode', value: 'all' });
  (unplaced.length ? optU : optA).checked = true;
  body.push(h('label', { class: 'opt' }, optU, h('span', null, h('b', null, `Only instances not placed yet (${unplaced.length})`), h('small', null, 'Keeps every existing position, including coordinates read from the graph.'))));
  body.push(h('label', { class: 'opt' }, optA, h('span', null, h('b', null, `Re-place everything except your manual moves (${all.length})`), h('small', null, 'Overwrites positions from earlier runs and from graph coordinates.'))));
  const legendCb = h('input', { type: 'checkbox' });
  legendCb.checked = refCount() > 0;
  if (refCount()) body.push(h('label', { class: 'check' }, legendCb, refCount() === 1 && S.legend ? `Also send the legend image (${S.legend.name})` : `Also send the reference images (${refImages().map(r => r.name).join(', ')})`));
  const info = h('div', { class: 'callout' });
  body.push(info);
  const log = h('div', { class: 'runlog', 'aria-live': 'polite' });
  const bar = h('div', { class: 'bar', hidden: true }, h('div'));
  body.push(bar, log);
  let lim = null;
  if (sample) lim = await sample.limits().catch(() => null);
  const runBtn = h('button', { class: 'btn primary' }, 'Run anchoring');
  const copyBtn = h('button', { class: 'btn' }, 'Copy prompt instead');
  const cancelBtn = h('button', { class: 'btn ghost' }, 'Close');
  copyBtn.addEventListener('click', () => { closeModalForce(); openPromptModal(optA.checked ? 'all' : 'unplaced'); });
  cancelBtn.addEventListener('click', () => { if (S.claudeCtl) S.claudeCtl.abort(); else closeModal(); });
  if (!sample) {
    info.className = 'callout warn';
    info.textContent = 'Claude isn\'t available here. Open the app in Claude (your project comes along as a file), set your own Claude API key, or copy the anchoring prompt into any Claude chat with the drawing and import the JSON reply with Open → Import layout.';
    runBtn.disabled = true; runBtn.hidden = true;
  } else if (!lim || !lim.images) {
    info.className = 'callout warn';
    info.textContent = 'This view can\'t send images to Claude. Copy the prompt instead and run it in a Claude chat with the drawing attached.';
    runBtn.disabled = true;
  } else {
    const maxImgs = Math.max(1, Math.min(lim.images.maxCount || 1, 16));
    const W = drawW(), H = drawH();
    const nRef = refBudget(maxImgs, 1);
    const g = maxImgs - 1 - nRef >= 2 ? chooseGrid(W, H, maxImgs - 1 - nRef) : null;
    const nImgs = 1 + (g ? g.c * g.r : 0) + nRef;
    const detail = g ? g.sc : Math.min(1, Math.sqrt(TARGET_PX / (W * H)));
    info.textContent = `Sends ${nImgs} image${nImgs === 1 ? '' : 's'} (an overview${g ? ` and ${g.c * g.r} gridded tiles at ${Math.round(detail * 100)} % detail` : ''}${nRef ? (nRef === 1 && S.legend ? ', plus the legend' : `, plus ${nRef} reference image${nRef === 1 ? '' : 's'}`) : ''}) and the instance list to ${claudeName()}. ${usageNote()} and usually takes one to a few minutes.`;
  }
  runBtn.addEventListener('click', async () => {
    const mode = optA.checked ? 'all' : 'unplaced';
    const targets = mode === 'all' ? all : unplaced;
    if (!targets.length) { log.textContent = 'Nothing to place — every instance already has a position.'; return; }
    runBtn.disabled = true; copyBtn.disabled = true; cancelBtn.textContent = 'Stop';
    $$('input', $('#modalBody')).forEach(i => { i.disabled = true; });
    bar.hidden = false; bar.classList.add('indet');
    await runClaudeAnchoring(sample, lim, targets, { mode, legend: legendCb.checked && refCount() > 0 }, (msg, frac) => {
      log.textContent = msg;
      if (frac != null) { bar.classList.remove('indet'); bar.firstChild.style.width = (frac * 100).toFixed(1) + '%'; }
    });
    bar.classList.remove('indet');
    cancelBtn.textContent = 'Close'; copyBtn.disabled = false;
  });
  openModal('Anchor the graph on the drawing', body, sample ? [copyBtn, cancelBtn, runBtn] : [cancelBtn, copyBtn, ...noClaudeFoot()]);
}
function closeModalForce() { $('#modal').hidden = true; }

async function runClaudeAnchoring(sample, lim, targets, opts, report) {
  const ctl = new AbortController();
  S.claudeCtl = ctl;
  const total = { placed: 0, off: 0, unknown: 0, outside: 0, missing: 0 };
  let modelName = 'Claude';
  const snap = snapshot();
  try {
    report('Preparing gridded drawing tiles…');
    const maxImgs = Math.max(1, Math.min(lim.images.maxCount || 1, 16));
    const { imgs, labels, refSent } = await makeImages(maxImgs, opts.legend);
    if (lim.images.maxInputBytes && imgs.some(b => b.size > lim.images.maxInputBytes)) throw { code: 'image_rejected', message: 'tile too large' };
    const batches = [];
    for (let i = 0; i < targets.length; i += 170) batches.push(targets.slice(i, i + 170));
    const pending = new Set(targets.map(n => n.iri));
    const ids = idMapFor([...S.G.nodes.values()]);
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const known = knownForPrompt(pending, 'px', ids);
      const prompt = buildAnchorPrompt(batch, { mode: 'tiles', labels, legend: opts.legend, known, ids, refSent });
      const pre = batches.length > 1 ? `Batch ${bi + 1}/${batches.length}: ` : '';
      report(`${pre}Claude is studying the drawing (${batch.length} instances)…`);
      const res = await sample(prompt, {
        images: imgs, model: 'claude-opus-5-5', modelTier: 'complex', signal: ctl.signal, cache: { gcTime: 86400000 },
        onText: ({ text }) => { const k = (text.match(/"id"\s*:/g) || []).length; report(`${pre}Receiving positions… ${k} / ${batch.length}`, (bi + Math.min(1, k / batch.length)) / batches.length); },
      });
      modelName = modelLabel(res);
      const obj = parseLooseJson(res.text);
      if (!obj) throw { code: 'bad_json', message: 'Claude\'s answer could not be read as JSON.', text: res.text };
      const r = applyAnchorResult(obj, ids.map, { source: 'claude', overrideManual: false });
      const answered = new Set([...(obj.anchors || []).map(a => String(a.id)), ...(obj.notOnDrawing || []).map(String)]);
      total.placed += r.placed; total.off += r.off; total.unknown += r.unknown.length; total.outside += r.outside;
      total.missing += batch.filter(n => !answered.has(ids.rev.get(n.iri))).length;
      for (const n of batch) pending.delete(n.iri);
      if (res.truncated) total.truncated = true;
      persist();
    }
    S.runs.push({ at: new Date().toISOString(), model: modelName, placed: total.placed, off: total.off, targets: targets.length });
    persist();
    rebuild(); updateQaSummary();
    report(`Done with ${modelName}: ${total.placed} placed, ${total.off} not on this drawing` + (total.missing ? `, ${total.missing} not answered` : '') + (total.outside ? `, ${total.outside} outside the drawing ignored` : '') + (total.unknown ? `, ${total.unknown} unknown ids` : '') + (total.truncated ? ' — the answer was cut short; run again for the rest' : '') + '. Low-confidence positions get a dotted ring.', 1);
    toast(`Anchored ${total.placed} instances`);
  } catch (e) {
    if (e && e.code === 'cancelled') report('Stopped. Positions received so far were kept.');
    else if (e && e.code === 'bad_json') { report(e.message + ' Nothing was changed.'); console.warn(e.text); }
    else report((e && SAMPLE_ERR[e.code]) || ('Something went wrong: ' + ((e && (e.message || e.code)) || e)));
    rebuild();
  } finally {
    S.claudeCtl = null;
    commit('anchoring with Claude', snap);
  }
}

function openPromptModal(mode) {
  if (!S.G || !S.drawing) { toast('Open a graph and its drawing first'); return; }
  const targets = anchorTargets(mode || 'unplaced');
  const list = targets.length ? targets : anchorTargets('all');
  const ids = idMapFor([...S.G.nodes.values()]);
  const known = knownForPrompt(new Set(list.map(n => n.iri)), 'norm1000', ids);
  const prompt = buildAnchorPrompt(list, { mode: 'external', legend: !!S.legend, known, ids });
  const ta = h('textarea', { class: 'out', readonly: true, 'aria-label': 'Anchoring prompt' });
  ta.value = prompt;
  openModal('Anchoring prompt', [
    h('p', null, `Paste this into a Claude chat together with the drawing (${S.drawing.name})${S.legend ? ' and the legend' : ''}. Save Claude's JSON reply as a .json file and load it with Open → Import layout. Coordinates come back normalised (0–1000), so image scaling in the chat doesn't matter.`),
    ta,
  ], [h('button', { class: 'btn', onclick: () => saveFile('anchoring-prompt.txt', prompt) }, 'Save as .txt'), h('button', { class: 'btn primary', onclick: () => copyText(prompt, ta) }, 'Copy')]);
}

/* =====================================================================
   12b. Re-check marked areas with Claude — the reviewer marks areas on the
        drawing; all of them go to Claude in ONE call (overview, a clean and a
        tagged close-up per area, the legend, and the graph content of each area).
   ===================================================================== */
const AREA_MAX_DEFAULT = 12;
const FT = {
  missing_instance: { label: 'Missing component', color: '#c026d3', accept: 'Accept proposal' },
  extra_instance: { label: 'Not drawn here', color: '#dc2626', accept: 'Flag as issue' },
  misplaced_anchor: { label: 'Misplaced', color: '#d97706', accept: 'Move node' },
  wrong_type: { label: 'Wrong class', color: '#dc2626', accept: 'Flag as issue' },
  wrong_link: { label: 'Wrong link', color: '#dc2626', accept: 'Flag as issue' },
  missing_link: { label: 'Missing link', color: '#c026d3', accept: 'Accept proposal' },
  wrong_direction: { label: 'Reversed link', color: '#dc2626', accept: 'Flag as issue' },
  replace_link: { label: 'Re-point link', color: '#d97706', accept: 'Accept fix' },
  delete_instance: { label: 'Delete instance', color: '#dc2626', accept: 'Accept fix' },
  other: { label: 'Note', color: '#64748b', accept: 'Accept' },
};
const FCOL = '#c026d3';

function symbolUnit() {
  const key = S.key + ':' + S.anchors.size;
  if (S._unit && S._unitKey === key) return S._unit;
  const L = Math.max(drawW(), drawH());
  const pts = [];
  for (const [iri, a] of S.anchors) {
    const n = S.G && S.G.nodes.get(iri);
    if (n && !S.off.has(iri) && (n.kind === 'component' || n.kind === 'point' || n.kind === 'fitting')) pts.push(a);
  }
  let unit = L * 0.012;
  if (pts.length >= 6) {
    const step = Math.max(1, Math.ceil(pts.length / 500));
    const nn = [];
    for (let i = 0; i < pts.length; i += step) {
      let d = Infinity;
      for (const q of pts) { if (q === pts[i]) continue; const dd = Math.hypot(pts[i].x - q.x, pts[i].y - q.y); if (dd > 1 && dd < d) d = dd; }
      if (isFinite(d)) nn.push(d);
    }
    nn.sort((a, b) => a - b);
    if (nn.length) unit = nn[Math.floor(nn.length / 2)] / 1.45;   /* symbols sit roughly 1.5 symbol-widths apart */
  }
  S._unit = clamp(unit, L * 0.004, L * 0.04); S._unitKey = key;
  return S._unit;
}
const areaSide = () => Math.round(symbolUnit() * S.areaFactor);
const areaW = a => a.w ?? a.s, areaH = a => a.h ?? a.s;

function enterAreaMode() {
  if (!S.G || !S.drawing) { toast('Open a graph and its drawing first'); return; }
  if (S.areaMode) return;
  closeMenus(); deselect({ restore: false }); closeEdgePop(); hideTip(); if (window.innerWidth <= 820 && S.rightPanel) closeRightPanel();
  S.areaMode = true; S.areaHover = null; S.rectStart = null;
  S.areaShape = LS.get('kgov:areaShape', 'square') === 'rect' ? 'rect' : 'square';
  S.mixBeforeArea = S.settings.mix;
  setMix(-85, false);                       /* graph almost transparent; the fader still works */
  document.body.classList.add('area-mode');
  S.areaMax = AREA_MAX_DEFAULT;
  getSample().then(fn => fn && fn.limits()).then(l => {
    if (l && l.images) { S.areaMax = Math.max(1, Math.min(AREA_MAX_DEFAULT, (l.images.maxCount || 1) - 1 - (S.legend ? 1 : 0))); renderAreaBar(); }
  }).catch(() => { /* limits unknown */ });
  renderAreaBar(); frame();
}
function exitAreaMode(keepAreas) {
  if (!S.areaMode) return;
  S.areaMode = false; S.areaHover = null; S.rectStart = null;
  if (!keepAreas) S.areas = [];
  setMix(S.mixBeforeArea ?? 0, false);
  document.body.classList.remove('area-mode');
  $('#areabar').hidden = true;
  $('#btnRecheck').classList.remove('on');
  updateBanner(); frame();
}
function areaAt(w) { return S.areas.findIndex(a => Math.abs(w.x - a.x) <= areaW(a) / 2 && Math.abs(w.y - a.y) <= areaH(a) / 2); }
function renumberAreas() { S.areas.forEach((a, i) => { a.id = 'A' + (i + 1); }); }
/* square mode: a tap adds a square (or removes the one under it); rectangle mode: two clicks, corner to corner */
function areaClick(clientX, clientY) {
  const w = toWorld(clientX, clientY), W = drawW(), H = drawH();
  const inside = w.x >= 0 && w.y >= 0 && w.x <= W && w.y <= H;
  const max = S.areaMax || AREA_MAX_DEFAULT;
  if (S.areaShape === 'rect' && S.rectStart) {
    const a = S.rectStart, b = { x: clamp(w.x, 0, W), y: clamp(w.y, 0, H) };
    S.rectStart = null;
    const ww = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y), min = Math.max(8, symbolUnit() * 1.2);
    if (ww < min || hh < min) { toast('That rectangle is too small: click one corner, then the opposite corner'); renderAreaBar(); frame(); return; }
    S.areas.push({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), w: Math.round(ww), h: Math.round(hh), s: Math.round(Math.max(ww, hh)), shape: 'rect' });
    renumberAreas(); renderAreaBar(); frame();
    return;
  }
  const hit = areaAt(w);
  if (hit >= 0) { S.areas.splice(hit, 1); renumberAreas(); renderAreaBar(); frame(); return; }
  if (!inside) return;
  if (S.areas.length >= max) { toast(`At most ${max} areas per check — remove one first`); return; }
  if (S.areaShape === 'rect') { S.rectStart = { x: w.x, y: w.y }; renderAreaBar(); frame(); return; }
  const s = areaSide();
  S.areas.push({ x: Math.round(w.x), y: Math.round(w.y), s, w: s, h: s, shape: 'square' });
  renumberAreas(); renderAreaBar(); frame();
}
function setAreaFactor(f) {
  S.areaFactor = clamp(f, 2, 8);
  LS.set('kgov:areaFactor', S.areaFactor);
  const s = areaSide();
  for (const a of S.areas) if (a.shape !== 'rect') { a.s = a.w = a.h = s; }
  renderAreaBar(); frame();
}
function setAreaShape(sh) {
  S.areaShape = sh; S.rectStart = null;
  LS.set('kgov:areaShape', sh);
  renderAreaBar(); frame();
}
function renderAreaBar() {
  const bar = $('#areabar');
  bar.textContent = '';
  bar.hidden = !S.areaMode;
  if (!S.areaMode) return;
  $('#banner').hidden = true;
  $('#btnRecheck').classList.add('on');
  const n = S.areas.length, rect = S.areaShape === 'rect';
  const msg = rect ? (S.rectStart ? 'Now click the opposite corner' : n ? `${n} area${n === 1 ? '' : 's'} marked` : 'Click one corner, then the opposite corner')
    : n ? `${n} area${n === 1 ? '' : 's'} marked` : 'Tap the drawing to mark areas to re-check';
  const shapeSeg = h('div', { class: 'qa-seg mini', role: 'group', 'aria-label': 'Area shape' },
    h('button', { class: rect ? '' : 'on', 'aria-pressed': rect ? 'false' : 'true', onclick: () => setAreaShape('square'), title: 'Each tap marks a square around the point' }, 'Square'),
    h('button', { class: rect ? 'on' : '', 'aria-pressed': rect ? 'true' : 'false', onclick: () => setAreaShape('rect'), title: 'Click two opposite corners to mark a rectangle' }, 'Rectangle'));
  bar.append(...[
    h('div', { class: 'ab-text' }, h('b', null, msg),
      h('span', { class: 'muted' }, n ? ' · click an area again to remove it · all go to Claude in one check' : ' · mark as many as you like; they go to Claude together')),
    shapeSeg,
    rect ? null : h('div', { class: 'ab-size', title: 'Square size, in typical symbol sizes' },
      h('span', { class: 'muted' }, 'Size'),
      h('button', { class: 'x-btn', 'aria-label': 'Smaller areas', disabled: S.areaFactor <= 2, onclick: () => setAreaFactor(S.areaFactor - 1) }, '−'),
      h('span', { class: 'mono' }, `${S.areaFactor}×`),
      h('button', { class: 'x-btn', 'aria-label': 'Larger areas', disabled: S.areaFactor >= 8, onclick: () => setAreaFactor(S.areaFactor + 1) }, '+')),
    h('div', { class: 'ab-actions' },
      h('button', { class: 'btn small ghost', disabled: !n, onclick: () => { S.areas = []; S.rectStart = null; renderAreaBar(); frame(); } }, 'Clear'),
      h('button', { class: 'btn small', onclick: () => exitAreaMode(false) }, 'Cancel'),
      h('button', { class: 'btn small primary', disabled: !n, onclick: openRecheckModal }, n ? `Re-check ${n} area${n === 1 ? '' : 's'}` : 'Re-check'))].filter(Boolean));
}
function rrPath(c, x, y, w, hh, r) {
  c.beginPath();
  if (c.roundRect) { c.roundRect(x, y, w, hh, r); return; }
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function drawVeil() {
  const vc = $('#veil'), v = vc.getContext('2d');
  const w = Math.round(VW * DPR), hh = Math.round(VH * DPR);
  if (vc.width !== w || vc.height !== hh) { vc.width = w; vc.height = hh; }
  v.setTransform(DPR, 0, 0, DPR, 0, 0);
  v.clearRect(0, 0, VW, VH);
  if (!S.areaMode) return;
  const { s: k, tx, ty } = S.view;
  v.fillStyle = 'rgba(6, 10, 16, 0.58)';
  v.fillRect(0, 0, VW, VH);
  const rect = a => { const aw = areaW(a) * k, ah = areaH(a) * k; return { x: (a.x - areaW(a) / 2) * k + tx, y: (a.y - areaH(a) / 2) * k + ty, w: aw, h: ah, r: Math.min(18, Math.min(aw, ah) * 0.14) }; };
  v.globalCompositeOperation = 'destination-out';
  v.fillStyle = '#000';   /* opaque cut-out: the lit area shows at full brightness */
  for (const a of S.areas) { const r = rect(a); rrPath(v, r.x, r.y, r.w, r.h, r.r); v.fill(); }
  v.globalCompositeOperation = 'source-over';
  v.font = `600 12px ${FONT}`; v.textBaseline = 'middle';
  for (const a of S.areas) {
    const r = rect(a);
    rrPath(v, r.x, r.y, r.w, r.h, r.r); v.lineWidth = 2.5; v.strokeStyle = FCOL; v.stroke();
    const tw = v.measureText(a.id).width + 12;
    rrPath(v, r.x, r.y - 24, tw, 20, 10); v.fillStyle = FCOL; v.fill();
    v.fillStyle = '#fff'; v.fillText(a.id, r.x + 6, r.y - 14);
  }
  if (S.areaShape === 'rect' && S.rectStart) {
    const p = S.areaHover || S.rectStart;
    const x0 = Math.min(S.rectStart.x, p.x), y0 = Math.min(S.rectStart.y, p.y), x1 = Math.max(S.rectStart.x, p.x), y1 = Math.max(S.rectStart.y, p.y);
    const r = { x: x0 * k + tx, y: y0 * k + ty, w: (x1 - x0) * k, h: (y1 - y0) * k };
    v.globalCompositeOperation = 'destination-out'; v.fillStyle = 'rgba(0,0,0,0.75)'; v.fillRect(r.x, r.y, r.w, r.h); v.globalCompositeOperation = 'source-over';
    v.setLineDash([6, 5]); v.lineWidth = 2; v.strokeStyle = FCOL; v.strokeRect(r.x, r.y, r.w, r.h); v.setLineDash([]);
    v.beginPath(); v.arc(S.rectStart.x * k + tx, S.rectStart.y * k + ty, 4.5, 0, Math.PI * 2); v.fillStyle = FCOL; v.fill();
  } else if (S.areaHover && areaAt(S.areaHover) < 0) {
    if (S.areaShape === 'rect') {
      const x = S.areaHover.x * k + tx, y = S.areaHover.y * k + ty;
      v.strokeStyle = 'rgba(255,255,255,0.85)'; v.lineWidth = 1.5; v.beginPath(); v.moveTo(x - 10, y); v.lineTo(x + 10, y); v.moveTo(x, y - 10); v.lineTo(x, y + 10); v.stroke();
    } else {
      const s = areaSide();
      const r = rect({ x: S.areaHover.x, y: S.areaHover.y, s });
      rrPath(v, r.x, r.y, r.w, r.h, r.r); v.setLineDash([6, 5]); v.lineWidth = 1.5; v.strokeStyle = 'rgba(255,255,255,0.8)'; v.stroke(); v.setLineDash([]);
    }
  }
}

/* ---- what Claude gets for each area ---- */
function areaContext(a, ids) {
  const hw = areaW(a) / 2, hh = areaH(a) / 2, m = 0.4 * Math.max(areaW(a), areaH(a));
  const inside = [], context = [];
  for (const [iri, an] of S.anchors) {
    if (S.off.has(iri)) continue;
    const n = S.G.nodes.get(iri);
    if (!n || !srcOK(n)) continue;
    const dx = Math.abs(an.x - a.x), dy = Math.abs(an.y - a.y);
    if (dx <= hw && dy <= hh) inside.push(iri);
    else if (dx <= hw + m && dy <= hh + m) context.push(iri);
  }
  const byPos = (p, q) => S.anchors.get(p).y - S.anchors.get(q).y || S.anchors.get(p).x - S.anchors.get(q).x;
  inside.sort(byPos); context.sort(byPos);
  const tags = new Map();
  [...inside, ...context].forEach((iri, i) => tags.set(iri, i + 1));
  const idOf = iri => ids.rev.get(iri) || S.G.nodes.get(iri).local;
  const insideSet = new Set(inside);
  const instLines = [], links = [], seen = new Set();
  for (const iri of [...inside, ...context]) {
    const n = S.G.nodes.get(iri), an = S.anchors.get(iri);
    const loc = canonicalNeighbours(n, 'location', 'in').map(idOf).slice(0, 2);
    const sys = canonicalNeighbours(n, 'system', 'in').map(idOf).slice(0, 2);
    instLines.push(`${tags.get(iri)} | ${idOf(iri)} | ${displayTypes(n).slice(0, 3).map(qn).join(', ') || '-'} | ${n.label ? '"' + n.label.slice(0, 70) + '"' : '-'} | ${an.x},${an.y}` +
      (loc.length ? ` | in ${loc.join(', ')}` : '') + (sys.length ? ` | system ${sys.join(', ')}` : '') + (insideSet.has(iri) ? '' : ' | context'));
  }
  for (const iri of inside) {
    const n = S.G.nodes.get(iri);
    for (const idx of [...n.out, ...n.in]) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      const e = S.G.edges[idx];
      if (e.cat === 'system' || e.cat === 'location') continue;   /* summarised per instance above */
      const other = e.s === iri ? e.o : e.s;
      const where = insideSet.has(other) ? '' : tags.has(other) ? '   (other end in context)' : '   (other end outside)';
      links.push(`${idOf(e.s)} ${qn(e.p)} ${idOf(e.o)}${where}`);
    }
  }
  const markers = [...inside, ...context].map(iri => ({ tag: tags.get(iri), x: S.anchors.get(iri).x, y: S.anchors.get(iri).y }));
  return { inside, context, instLines, links: links.slice(0, 120), markers };
}
async function renderAreaImage(a, ctxInfo, marked) {
  const W = drawW(), H = drawH(), aw = areaW(a), ah = areaH(a), m = 0.4 * Math.max(aw, ah);
  const cw = Math.min(aw + 2 * m, W), ch = Math.min(ah + 2 * m, H);
  const x0 = clamp(a.x - aw / 2 - m, 0, W - cw), y0 = clamp(a.y - ah / 2 - m, 0, H - ch);
  const sc = clamp(900 / Math.max(cw, ch), 0.25, 3);
  const cv = document.createElement('canvas');
  cv.width = Math.round(cw * sc); cv.height = Math.round(ch * sc);
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(drawingEl, x0, y0, cw, ch, 0, 0, cv.width, cv.height);
  const step = niceStep(cw / 6);
  c.save();
  c.strokeStyle = 'rgba(219,39,119,0.45)'; c.lineWidth = 1; c.setLineDash([5, 4]);
  c.font = '600 12px Arial, sans-serif'; c.textBaseline = 'top';
  const tag = (t, x, y, align) => {
    const tw = c.measureText(t).width + 6, bx = align === 'r' ? x - tw : align === 'c' ? x - tw / 2 : x;
    c.setLineDash([]); c.fillStyle = 'rgba(255,255,255,0.92)'; c.fillRect(bx, y, tw, 15);
    c.fillStyle = '#be185d'; c.fillText(t, bx + 3, y + 1.5); c.setLineDash([5, 4]);
  };
  for (let gx = Math.ceil(x0 / step) * step; gx <= x0 + cw; gx += step) { const X = Math.round((gx - x0) * sc) + 0.5; c.beginPath(); c.moveTo(X, 0); c.lineTo(X, cv.height); c.stroke(); tag('x=' + gx, X, cv.height - 17, 'c'); }
  for (let gy = Math.ceil(y0 / step) * step; gy <= y0 + ch; gy += step) { const Y = Math.round((gy - y0) * sc) + 0.5; c.beginPath(); c.moveTo(0, Y); c.lineTo(cv.width, Y); c.stroke(); tag('y=' + gy, 2, Y - 7, 'l'); }
  c.restore();
  const ax = (a.x - aw / 2 - x0) * sc, ay = (a.y - ah / 2 - y0) * sc, asw = aw * sc, ash = ah * sc;
  rrPath(c, ax, ay, asw, ash, Math.min(18, Math.min(asw, ash) * 0.1)); c.lineWidth = 3; c.strokeStyle = FCOL; c.stroke();
  if (marked) {
    c.font = '700 12px Arial, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center';
    for (const mk of ctxInfo.markers) {
      const px = (mk.x - x0) * sc, py = (mk.y - y0) * sc;
      if (px < 0 || py < 0 || px > cv.width || py > cv.height) continue;
      const tx = clamp(px + 16, 11, cv.width - 11), ty = clamp(py - 16, 11, cv.height - 11);
      c.strokeStyle = 'rgba(17,24,39,0.85)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(px - 4, py); c.lineTo(px + 4, py); c.moveTo(px, py - 4); c.lineTo(px, py + 4); c.moveTo(px, py); c.lineTo(tx, ty); c.stroke();
      c.beginPath(); c.arc(tx, ty, 10, 0, Math.PI * 2); c.fillStyle = 'rgba(17,24,39,0.88)'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#fff'; c.fillText(String(mk.tag), tx, ty + 0.5);
    }
    c.textAlign = 'left';
  }
  const cap = `${a.id} — ${marked ? 'graph instances tagged' : 'clean'} · x ${Math.round(x0)}–${Math.round(x0 + cw)}, y ${Math.round(y0)}–${Math.round(y0 + ch)}`;
  c.font = '700 13px Arial, sans-serif'; c.textBaseline = 'top';
  const capW = c.measureText(cap).width + 12;
  c.fillStyle = 'rgba(17,24,39,0.88)'; c.fillRect(8, 8, capW, 20); c.fillStyle = '#fff'; c.fillText(cap, 14, 11);
  return { blob: await new Promise(r => cv.toBlob(r, 'image/png')), crop: { x0, y0, cw, ch } };
}
async function renderAreaOverview(areas) {
  const W = drawW(), H = drawH();
  const sc = Math.min(1, Math.sqrt(TARGET_PX / (W * H)), MAX_SIDE / Math.max(W, H));
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * sc); cv.height = Math.round(H * sc);
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(drawingEl, 0, 0, W, H, 0, 0, cv.width, cv.height);
  c.font = '700 14px Arial, sans-serif'; c.textBaseline = 'middle';
  for (const a of areas) {
    const x = (a.x - areaW(a) / 2) * sc, y = (a.y - areaH(a) / 2) * sc, sw = areaW(a) * sc, sh = areaH(a) * sc;
    rrPath(c, x, y, sw, sh, Math.min(8, Math.min(sw, sh) * 0.15)); c.lineWidth = 3; c.strokeStyle = FCOL; c.stroke();
    const tw = c.measureText(a.id).width + 10;
    c.fillStyle = FCOL; c.fillRect(x, Math.max(0, y - 20), tw, 18); c.fillStyle = '#fff'; c.fillText(a.id, x + 5, Math.max(0, y - 20) + 9);
  }
  return new Promise(r => cv.toBlob(r, 'image/png'));
}
function vocabularyLines() {
  const G = S.G, cls = new Map(), preds = new Map();
  for (const n of G.nodes.values()) for (const t of n.types) cls.set(t, (cls.get(t) || 0) + 1);
  for (const e of G.edges) { const k = e.p + '|' + e.cat + '|' + e.dir; preds.set(k, (preds.get(k) || 0) + 1); }
  const L = [];
  L.push('Classes used in this graph (most frequent first): ' + [...cls].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([t]) => qn(t)).join(', '));
  L.push('Link predicates used (category; drawing direction):');
  for (const [k] of [...preds].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    const [p, cat, dir] = k.split('|');
    L.push(`- ${qn(p)} — ${CAT[cat].name}; ${dir === '0' ? 'undirected' : dir === '1' ? 'subject → object' : 'object → subject (inverse form)'}`);
  }
  const ex = new Map();
  for (const n of G.nodes.values()) { const t = displayTypes(n)[0]; if (t && !ex.has(t) && ex.size < 16) ex.set(t, n.local); }
  L.push('Instance naming examples: ' + [...ex.values()].join(', '));
  L.push('Prefixes: ' + Object.entries(G.prefixes).filter(([, v]) => v).map(([k, v]) => `${k}: <${v}>`).join(' '));
  return L;
}
function buildRecheckPrompt(areas, info, opts) {
  const W = drawW(), H = drawH(), L = [];
  L.push('You are reviewing a knowledge graph (RDF using BOT, FSO and Brick plus local classes) that was extracted automatically from an engineering drawing (a P&ID / flow schematic). A human reviewer has marked areas of the drawing where the graph may be wrong or incomplete. For each marked area, compare what the drawing shows with what the graph says, and report the differences.');
  L.push('', `The full drawing is ${W} × ${H} pixels. Every coordinate below and in your answer is in full-drawing pixels. Images, in order:`);
  opts.labels.forEach((t, i) => L.push(`- Image ${i + 1}: ${t}`));
  L.push(...refNoteLines(opts.refSent || 0));
  L.push('In the close-ups the magenta rounded rectangle is the marked area; the rest is context. Dashed magenta grid lines are labelled with full-drawing coordinates. In the tagged close-ups each numbered tag has a leader ending in a small cross: the cross is where the graph places the instance with that tag number.');
  if (opts.note) L.push('', `The reviewer adds: "${opts.note}"`);
  if (opts.related && areas.length > 1) L.push('', `The reviewer marked these ${areas.length} areas together because they are related: the same kind of problem may repeat in several of them, or a connection may run from one area to another. Compare the areas with each other as well as with the graph — if a pattern (a missing component, a wrong class, a reversed flow) appears in one area, check whether it recurs in the others, report it in every area where it occurs, and use the same wording so the findings can be resolved together. Mention the shared pattern in each affected area's summary.`);
  L.push('', 'Check, inside the marked areas (follow lines into the context only to understand connections):',
    '1. Missing components: a drawn symbol (damper, fan, filter, coil, silencer, heat exchanger, terminal/diffuser, sensor, valve, junction, or a duct/pipe run between two components) with no tagged instance on it → missing_instance, with a proposed id that follows the naming pattern, proposed classes from the vocabulary, its position and the links it should have.',
    '2. A tag whose cross points at nothing that matches → extra_instance. A tag on the wrong symbol or clearly offset → misplaced_anchor with the correct position.',
    '3. A class that does not match the drawn symbol (use the legend) → wrong_type with addTypes / removeTypes.',
    '4. Links: flow links must follow the drawn lines in the drawn flow direction; parts must match the drawn units. A listed link the drawing does not support → wrong_link. A drawn connection the graph lacks → missing_link. Flow asserted against the drawn direction → wrong_direction.',
    '5. Be conservative and specific: report only what you can see. If an area agrees with the graph, say so in its summary and give it no findings.');
  L.push('', 'Graph vocabulary:', ...vocabularyLines());
  areas.forEach((a, i) => {
    const inf = info[i];
    L.push('', `=== Area ${a.id}: x ${Math.round(a.x - areaW(a) / 2)}–${Math.round(a.x + areaW(a) / 2)}, y ${Math.round(a.y - areaH(a) / 2)}–${Math.round(a.y + areaH(a) / 2)} ===`);
    if (inf.instLines.length) { L.push('Tagged instances (tag | id | classes | label | x,y | location / system | context = outside the area):'); L.push(...inf.instLines); }
    else L.push('The graph places no instances in or around this area.');
    if (inf.links.length) { L.push('Links of the instances inside the area (location and system membership are summarised above):'); L.push(...inf.links); }
  });
  L.push('', 'Reply with only this JSON, no prose:');
  L.push('{"areas":[{"area":"A1","summary":"<one sentence>","findings":[{"type":"<type>", ...fields..., "conf":<0..1>, "evidence":"<what you see, max 25 words>"}]}]}');
  L.push('Fields per type:',
    '- missing_instance: "proposedId", "proposedTypes":["prefix:Class",…], "label", "x", "y", "links":[{"from":"<id or proposedId>","predicate":"prefix:pred","to":"<id or proposedId>"}]',
    '- extra_instance: "id"',
    '- misplaced_anchor: "id", "x", "y"',
    '- wrong_type: "id", "addTypes":[…], "removeTypes":[…]',
    '- wrong_link and wrong_direction: "from", "predicate", "to" exactly as listed',
    '- missing_link: "from", "predicate", "to"',
    '- other: "id" (optional), "text"',
    'Use the ids exactly as listed (not tag numbers). Include every area, in order.');
  return L.join('\n');
}
function expandTerm(q) {
  if (!q) return null;
  q = String(q).trim();
  if (q === 'a') return RDF_TYPE;
  if (q.startsWith('<') && q.endsWith('>')) return q.slice(1, -1);
  if (/^https?:\/\//.test(q) || q.startsWith('urn:')) return q;
  const m = /^([A-Za-z][\w-]*)?:(.+)$/.exec(q);
  if (m && S.G.prefixes[m[1] || ''] != null) return S.G.prefixes[m[1] || ''] + m[2];
  return null;
}
function normaliseFinding(fd, area, run, idMap) {
  if (!fd || typeof fd !== 'object') return null;
  const str = (v, n) => (v == null ? null : String(v).slice(0, n));
  const type = FT[fd.type] ? fd.type : 'other';
  S.findingSeq = (S.findingSeq || 0) + 1;
  const f = { id: `f${S.findingSeq}_${run.id}`, seq: S.findingSeq, run: run.id, area: area.id, rect: area.s ? { x: area.x, y: area.y, s: area.s, w: areaW(area), h: areaH(area) } : null, type, status: 'open',
    conf: isFinite(+fd.conf) && fd.conf !== null ? Math.round(clamp(+fd.conf, 0, 1) * 100) / 100 : null, evidence: str(fd.evidence, 300) };
  const res = v => (v == null ? null : resolveId(String(v), idMap));
  if (fd.id != null) { f.ref = String(fd.id); f.iri = res(fd.id); }
  if (fd.from != null) { f.from = String(fd.from); f.fromIri = res(fd.from); }
  if (fd.to != null) { f.to = String(fd.to); f.toIri = res(fd.to); }
  if (fd.predicate) { f.predicate = String(fd.predicate); f.predIri = expandTerm(f.predicate); }
  if (fd.newFrom != null) { f.newFrom = String(fd.newFrom); f.newFromIri = res(fd.newFrom); }
  if (fd.newTo != null) { f.newTo = String(fd.newTo); f.newToIri = res(fd.newTo); }
  if (fd.newPredicate) { f.newPredicate = String(fd.newPredicate); f.newPredIri = expandTerm(f.newPredicate); }
  if (fd.x != null && fd.y != null && isFinite(+fd.x) && isFinite(+fd.y)) { f.x = Math.round(clamp(+fd.x, 0, drawW())); f.y = Math.round(clamp(+fd.y, 0, drawH())); }
  for (const k of ['proposedTypes', 'addTypes', 'removeTypes']) if (Array.isArray(fd[k])) f[k] = fd[k].map(String).slice(0, 8);
  if (fd.proposedId) f.proposedId = String(fd.proposedId).replace(/[^A-Za-z0-9_.\-]/g, '_').slice(0, 80);
  if (fd.label) f.label = str(fd.label, 120);
  if (Array.isArray(fd.links)) f.links = fd.links.slice(0, 12).filter(l => l && l.from && l.to && l.predicate).map(l => ({ from: String(l.from), predicate: String(l.predicate), to: String(l.to) }));
  if (fd.text) f.text = str(fd.text, 300);
  if (type === 'missing_instance' && (f.x == null || !f.proposedId)) { if (f.x == null) { f.x = area.s ? area.x : Math.round(drawW() / 2); f.y = area.s ? area.y : Math.round(drawH() / 2); } if (!f.proposedId) f.proposedId = 'Proposed_' + S.findingSeq; }
  return f;
}

async function openRecheckModal() {
  if (!S.areas.length) return;
  const sample = await getSample();
  const lim = sample ? await sample.limits().catch(() => null) : null;
  const n = S.areas.length;
  const body = [h('p', null, `${claudeName()} gets an overview with the ${n} marked area${n === 1 ? '' : 's'}, close-ups of each area (clean, and with the graph's instances tagged), ${refCount() > 1 ? 'the legend and the other reference images with your notes' : refCount() ? 'the legend' : 'the legend if there is one'} and the part of the graph inside each area. It reports missing or misplaced components, wrong classes, and missing, wrong or reversed links. Nothing in the graph changes until you accept a finding.`)];
  const note = h('textarea', { class: 'note', placeholder: 'Optional: what should Claude look for? e.g. "I think a damper is missing after the silencer"', 'aria-label': 'Note for Claude' });
  body.push(note);
  const related = h('input', { type: 'checkbox', checked: n > 1 });
  if (n > 1) body.push(h('label', { class: 'chk related-chk', title: 'Claude compares the areas with each other too, e.g. when the same problem shows up in several places' }, related,
    h('span', null, h('b', null, 'The areas are related'), h('span', { class: 'muted' }, ' — look for the same issue across all of them and compare them in one go'))));
  const info = h('div', { class: 'callout' });
  const log = h('div', { class: 'runlog', 'aria-live': 'polite' });
  const bar = h('div', { class: 'bar', hidden: true }, h('div'));
  body.push(info, bar, log);
  const runBtn = h('button', { class: 'btn primary' }, `Re-check ${n} area${n === 1 ? '' : 's'}`);
  const closeBtn = h('button', { class: 'btn ghost' }, 'Close');
  closeBtn.addEventListener('click', () => { if (S.claudeCtl) S.claudeCtl.abort(); else closeModal(); });
  let plan = null;
  if (!sample) { info.className = 'callout warn'; info.textContent = 'Claude isn\'t available here — open the app in Claude to re-check areas (your project comes along as a file), or set your own Claude API key.'; runBtn.disabled = true; runBtn.hidden = true; }
  else if (!lim || !lim.images) { info.className = 'callout warn'; info.textContent = 'This view can\'t send images to Claude, so areas can\'t be re-checked here.'; runBtn.disabled = true; }
  else {
    const max = Math.min(lim.images.maxCount || 1, 20);
    const nRefAll = refCount();
    const pairs = 1 + 2 * n + Math.min(1, nRefAll) <= max;
    const refs = Math.min(nRefAll, Math.max(0, max - 1 - (pairs ? 2 : 1) * n), Math.max(1, Math.floor((max - 1) / 4)));
    const legendFits = refs > 0;
    const count = 1 + (pairs ? 2 : 1) * n + refs;
    if (1 + n > max) { info.className = 'callout warn'; info.textContent = `This view can send at most ${max} images per call — remove areas until there are ${max - 1} or fewer.`; runBtn.disabled = true; }
    else {
      plan = { pairs, refs };
      info.textContent = `Sends ${count} images (an overview, ${pairs ? 'a clean and a tagged close-up' : 'a tagged close-up'} of each area${legendFits ? (refs === 1 && S.legend ? ' and the legend' : ` and ${refs} reference image${refs === 1 ? '' : 's'}`) : ''}) in one call. ${usageNote()} and usually takes a minute or two.`;
    }
  }
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true; closeBtn.textContent = 'Stop'; note.disabled = true; related.disabled = true;
    bar.hidden = false; bar.classList.add('indet');
    const out = await runRecheck(sample, { ...plan, note: note.value.trim(), related: n > 1 && related.checked }, (msg, frac) => {
      log.textContent = msg;
      if (frac != null) { bar.classList.remove('indet'); bar.firstChild.style.width = (frac * 100) + '%'; }
    });
    bar.classList.remove('indet');
    closeBtn.textContent = 'Close';
    if (out) {
      exitAreaMode(false);
      const show = h('button', { class: 'btn primary' }, 'Show findings');
      show.addEventListener('click', () => { closeModal(); openIssues('findings'); });
      $('#modalFoot').textContent = '';
      $('#modalFoot').append(closeBtn, show);
    } else { runBtn.disabled = false; note.disabled = false; related.disabled = false; }
  });
  openModal('Re-check marked areas', body, sample ? [closeBtn, runBtn] : [closeBtn, ...noClaudeFoot()]);
}
async function runRecheck(sample, opts, report) {
  const ctl = new AbortController();
  S.claudeCtl = ctl;
  const snap = snapshot();
  try {
    report('Preparing close-ups of the marked areas…');
    const ids = idMapFor([...S.G.nodes.values()]);
    const areas = S.areas.map(a => ({ ...a }));
    const info = areas.map(a => areaContext(a, ids));
    const imgs = [await renderAreaOverview(areas)], labels = ['overview of the whole drawing with the marked areas outlined and labelled'];
    for (let i = 0; i < areas.length; i++) {
      if (opts.pairs) { imgs.push((await renderAreaImage(areas[i], info[i], false)).blob); labels.push(`${areas[i].id} — clean close-up`); }
      imgs.push((await renderAreaImage(areas[i], info[i], true)).blob); labels.push(`${areas[i].id} — close-up with the graph's instances tagged`);
    }
    for (const r of refImages().slice(0, opts.refs || 0)) { imgs.push(r.blob); labels.push(r.label); }
    const prompt = buildRecheckPrompt(areas, info, { labels, note: opts.note, ids, related: opts.related, refSent: opts.refs || 0 });
    report(`Claude is re-checking ${areas.length} area${areas.length === 1 ? '' : 's'}…`);
    const res = await sample(prompt, {
      images: imgs, model: 'claude-opus-5-5', modelTier: 'complex', signal: ctl.signal, cache: false,
      onText: ({ text }) => { const k = (text.match(/"type"\s*:/g) || []).length; report(`Receiving findings… ${k}`); },
    });
    const model = modelLabel(res);
    const obj = parseLooseJson(res.text);
    if (!obj || !Array.isArray(obj.areas)) throw { code: 'bad_json', message: 'Claude\'s answer could not be read.', text: res.text };
    const run = { id: 'r' + Date.now().toString(36), at: new Date().toISOString(), model, note: opts.note || '', areas: areas.map(a => ({ id: a.id, x: a.x, y: a.y, s: a.s, w: areaW(a), h: areaH(a), shape: a.shape || 'square' })), related: !!opts.related, summaries: {} };
    let count = 0;
    for (const ar of obj.areas) {
      const a = areas.find(x => x.id === String(ar && ar.area));
      if (!a) continue;
      run.summaries[a.id] = String(ar.summary || '').slice(0, 300);
      for (const fd of Array.isArray(ar.findings) ? ar.findings : []) { const f = normaliseFinding(fd, a, run, ids.map); if (f) { S.findings.push(f); count++; } }
    }
    S.recheckRuns.push(run);
    persist(); frame(); updateFindingsSummary();
    report(`Done with ${model}: ${count} finding${count === 1 ? '' : 's'} in ${areas.length} area${areas.length === 1 ? '' : 's'}.` + (res.truncated ? ' The answer was cut short — re-check fewer areas at a time.' : ''), 1);
    return { count, run };
  } catch (e) {
    if (e && e.code === 'cancelled') report('Stopped.');
    else if (e && e.code === 'bad_json') { report(e.message + ' Nothing was changed.'); console.warn(e.text); }
    else report((e && SAMPLE_ERR[e.code]) || ('Something went wrong: ' + ((e && (e.message || e.code)) || e)));
    return null;
  } finally {
    S.claudeCtl = null;
    commit('re-check with Claude', snap);
  }
}

/* ---- findings: titles, actions, canvas markers ---- */
const nmOf = (iri, raw) => (iri && S.G.nodes.get(iri) ? S.G.nodes.get(iri).local : raw || '?');
function findingTitle(f) {
  const p = f.predicate || '';
  switch (f.type) {
    case 'missing_instance': return `${f.proposedId}${f.proposedTypes && f.proposedTypes.length ? ' (' + f.proposedTypes[0] + ')' : ''}`;
    case 'extra_instance': case 'misplaced_anchor': return nmOf(f.iri, f.ref);
    case 'delete_instance': return `delete ${nmOf(f.iri, f.ref)}`;
    case 'wrong_type': return `${nmOf(f.iri, f.ref)}${f.addTypes && f.addTypes.length ? ' → ' + f.addTypes.join(', ') : ''}${f.removeTypes && f.removeTypes.length ? ' (not ' + f.removeTypes.join(', ') + ')' : ''}`;
    case 'wrong_link': case 'missing_link': case 'wrong_direction': return `${nmOf(f.fromIri, f.from)} ${p} ${nmOf(f.toIri, f.to)}`;
    case 'replace_link': return `${nmOf(f.fromIri, f.from)} ${p} ${nmOf(f.toIri, f.to)}  →  ${nmOf(f.newFromIri || f.fromIri, f.newFrom || f.from)} ${f.newPredicate || p} ${nmOf(f.newToIri || f.toIri, f.newTo || f.to)}`;
    default: return f.text || nmOf(f.iri, f.ref);
  }
}
function findingPoints(f) {
  const pts = [];
  const an = iri => { const a = iri && S.anchors.get(iri); if (a && !S.off.has(iri)) pts.push({ x: a.x, y: a.y }); };
  an(f.iri); an(f.fromIri); an(f.toIri); an(f.newFromIri); an(f.newToIri);
  if (f.x != null) pts.push({ x: f.x, y: f.y });
  if (f.rect && f.rect.s) { const r = f.rect; pts.push({ x: r.x - areaW(r) / 2, y: r.y - areaH(r) / 2 }, { x: r.x + areaW(r) / 2, y: r.y + areaH(r) / 2 }); }
  return pts;
}
function showFinding(f) {
  S.selFinding = f.id; S.selArea = null;
  closeIssuesOnPhone();
  const pts = findingPoints(f);
  if (pts.length) centerOn(pts);
  renderIssues(); frame();
}
function flagNode(iri, text) {
  const rec = S.qa.nodes[iri] || {};
  rec.status = 'issue'; rec.note = rec.note ? (rec.note.includes(text) ? rec.note : rec.note + '\n' + text) : text; rec.at = new Date().toISOString();
  S.qa.nodes[iri] = rec;
}
function edgeKeyFor(f) {
  if (!f.fromIri || !f.toIri) return null;
  const e = S.G.edges.find(x => ((x.s === f.fromIri && x.o === f.toIri) || (x.s === f.toIri && x.o === f.fromIri)) && (!f.predIri || x.p === f.predIri))
    || S.G.edges.find(x => (x.s === f.fromIri && x.o === f.toIri) || (x.s === f.toIri && x.o === f.fromIri));
  if (!e) return null;
  const lo = e.s < e.o ? e.s : e.o, hi = e.s < e.o ? e.o : e.s;
  return e.cat + '|' + lo + '|' + hi;
}
function applyAccept(f) {
  const text = `${f.area}: ${FT[f.type].label.toLowerCase()} — ${findingTitle(f)}${f.evidence ? '. ' + f.evidence : ''}`;
  if (f.type === 'misplaced_anchor' && f.iri && f.x != null) {
    S.anchors.set(f.iri, { x: f.x, y: f.y, source: 'claude', conf: f.conf, why: 're-check ' + f.area });
    S.off.delete(f.iri);
  } else if (!f.issueRef) {          /* re-check findings become review flags; fixes for existing issues don't need one */
    if ((f.type === 'wrong_type' || f.type === 'extra_instance' || f.type === 'other' || f.type === 'delete_instance') && f.iri) flagNode(f.iri, text);
    else if (f.type === 'wrong_link' || f.type === 'wrong_direction' || f.type === 'replace_link') {
      const k = edgeKeyFor(f);
      if (k) { const rec = S.qa.edges[k] || {}; rec.status = 'issue'; rec.note = rec.note ? rec.note + '\n' + text : text; rec.at = new Date().toISOString(); S.qa.edges[k] = rec; }
      else if (f.fromIri) flagNode(f.fromIri, text);
    }
  }
  f.status = 'accepted';
}
function resolveSourceIfDone(f) {
  if (!f.issueRef) return;
  const sib = S.findings.filter(x => x.run === f.run && x.area === f.area);
  if (sib.some(x => x.status === 'open') || !sib.some(x => x.status === 'accepted' || x.status === 'applied')) return;
  const { kind, key } = f.issueRef, now = new Date().toISOString();
  if (kind === 'node' && S.qa.nodes[key]) Object.assign(S.qa.nodes[key], { status: 'resolved', at: now });
  else if (kind === 'edge' && S.qa.edges[key]) Object.assign(S.qa.edges[key], { status: 'resolved', at: now });
  else if (kind === 'rule' || kind === 'note') { const r = S.rules.find(x => x.id === key); if (r) { r.status = 'resolved'; r.at = now; } }
}
function afterFindingChange() { persist(); rebuild(); updateQaSummary(); renderIssues(); refreshInspector(); }
function acceptFinding(f) {
  const snap = snapshot();
  applyAccept(f); resolveSourceIfDone(f);
  commit(`accept: ${FT[f.type].label.toLowerCase()} ${findingTitle(f)}`, snap);
  afterFindingChange();
  if (GRAPH_TYPES.has(f.type)) pendingToast();
}
function acceptAll(list) {
  if (!list.length) return;
  const snap = snapshot();
  for (const f of list) applyAccept(f);
  for (const f of list) resolveSourceIfDone(f);
  commit(`accept ${list.length} proposals`, snap);
  afterFindingChange();
  if (list.some(f => GRAPH_TYPES.has(f.type))) pendingToast();
}
function setFindingStatus(f, status) {
  const snap = snapshot();
  f.status = status;
  if (status === 'dismissed') resolveSourceIfDone(f);
  commit(`${status === 'dismissed' ? 'dismiss' : 'reopen'}: ${findingTitle(f)}`, snap);
  persist(); renderIssues(); frame();
}
function proposedPoint(runId, id) {
  const f = S.findings.find(x => x.run === runId && x.type === 'missing_instance' && x.proposedId === id && x.status !== 'dismissed');
  return f ? { x: f.x, y: f.y } : null;
}
function endPoint(f, iri, raw) {
  const a = iri && S.anchors.get(iri);
  if (a && !S.off.has(iri)) return { x: a.x, y: a.y };
  return raw ? proposedPoint(f.run, raw) : null;
}
function drawFindingsUnder() {
  if (S.settings.showFindings === false || !S.findings.length) return;
  const { s: k, tx, ty } = S.view;
  ctx.save(); ctx.lineCap = 'round'; ctx.setLineDash([]);
  for (const f of S.findings) {
    if (f.status === 'dismissed' || f.status === 'applied' || !['wrong_link', 'wrong_direction', 'replace_link'].includes(f.type)) continue;
    const A = endPoint(f, f.fromIri), B = endPoint(f, f.toIri);
    if (!A || !B) continue;
    ctx.globalAlpha = f.status === 'accepted' ? 0.3 : 0.5;
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = f.id === S.selFinding ? 13 : 9;
    ctx.beginPath(); ctx.moveTo(A.x * k + tx, A.y * k + ty); ctx.lineTo(B.x * k + tx, B.y * k + ty); ctx.stroke();
  }
  ctx.restore();
}
function drawFindingsOver() {
  const { s: k, tx, ty } = S.view;
  const sp = p => [p.x * k + tx, p.y * k + ty];
  ctx.save();
  const area = S.selArea || (S.selFinding && (S.findings.find(f => f.id === S.selFinding) || {}).rect);
  if (area && area.s) {
    const x = (area.x - areaW(area) / 2) * k + tx, y = (area.y - areaH(area) / 2) * k + ty, sw = areaW(area) * k, sh = areaH(area) * k;
    rrPath(ctx, x, y, sw, sh, Math.min(18, Math.min(sw, sh) * 0.14)); ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = FCOL; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.settings.showFindings === false) { ctx.restore(); return; }
  ctx.font = `600 11px ${FONT}`; ctx.textBaseline = 'middle';
  const dashedArrow = (A, B, color) => {
    const [ax, ay] = sp(A), [bx, by] = sp(B), L = Math.hypot(bx - ax, by - ay);
    if (L < 20) return;
    const ux = (bx - ax) / L, uy = (by - ay) / L, ex = bx - ux * 10, ey = by - uy * 10;
    ctx.setLineDash([6, 4]); ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(ax + ux * 10, ay + uy * 10); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.beginPath(); addHead(ex, ey, ax, ay); ctx.fill();
  };
  for (const f of S.findings) {
    if (f.status === 'dismissed' || f.status === 'applied') continue;
    const sel = f.id === S.selFinding;
    ctx.globalAlpha = f.status === 'accepted' ? 0.55 : 1;
    ctx.lineWidth = sel ? 3 : 2;
    if (f.type === 'missing_instance' && f.x != null) {
      const [x, y] = sp(f);
      ctx.beginPath(); ctx.arc(x, y, sel ? 11 : 9, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
      ctx.setLineDash(f.status === 'accepted' ? [] : [3, 3]); ctx.strokeStyle = FCOL; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x - 4.5, y); ctx.lineTo(x + 4.5, y); ctx.moveTo(x, y - 4.5); ctx.lineTo(x, y + 4.5); ctx.stroke();
      const t = f.proposedId, tw = ctx.measureText(t).width + 10;
      rrPath(ctx, x + 13, y - 9, tw, 18, 9); ctx.fillStyle = FCOL; ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(t, x + 18, y);
    } else if (f.type === 'misplaced_anchor' && f.x != null) {
      const A = endPoint(f, f.iri), P = { x: f.x, y: f.y };
      if (A) dashedArrow(A, P, '#d97706');
      const [px, py] = sp(P);
      ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#d97706'; ctx.stroke(); ctx.setLineDash([]);
    } else if (f.type === 'missing_link') {
      const A = endPoint(f, f.fromIri, f.from), B = endPoint(f, f.toIri, f.to);
      if (A && B) dashedArrow(A, B, FCOL);
    } else if (f.type === 'replace_link') {
      const A = endPoint(f, f.newFromIri || f.fromIri, f.newFrom || f.from), B = endPoint(f, f.newToIri || f.toIri, f.newTo || f.to);
      if (A && B) dashedArrow(A, B, FCOL);
    }
    if (['wrong_type', 'extra_instance', 'other', 'misplaced_anchor', 'delete_instance'].includes(f.type) && f.iri) {
      const A = endPoint(f, f.iri);
      if (!A) continue;
      const [x, y] = sp(A);
      ctx.beginPath(); ctx.arc(x + 11, y - 11, sel ? 8 : 7, 0, Math.PI * 2); ctx.fillStyle = FT[f.type].color; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(f.type === 'delete_instance' ? '×' : '!', x + 11, y - 10.5); ctx.textAlign = 'left'; ctx.font = `600 11px ${FONT}`;
    }
  }
  ctx.restore();
}

/* =====================================================================
   12d. Putting accepted fixes into effect. The loaded files are never
        modified: each applied fix becomes an entry in the change log
        (triples removed / added), and the graph on screen is the source
        graph with the active log entries applied on top. Entries can be
        reverted. The log exports as CSV, as a SPARQL Update, or folded
        into a refined Turtle file.
   ===================================================================== */
const XSD_STRING = NS.xsd + 'string';
const GRAPH_TYPES = new Set(['missing_instance', 'missing_link', 'wrong_link', 'wrong_direction', 'replace_link', 'wrong_type', 'delete_instance']);
const CHANGE_LABEL = { missing_instance: 'Added instance', missing_link: 'Added link', wrong_link: 'Removed link', wrong_direction: 'Reversed link', replace_link: 'Re-pointed link', wrong_type: 'Changed class', delete_instance: 'Deleted instance' };
const CHANGE_COLOR = { missing_instance: '#16a34a', missing_link: '#16a34a', wrong_link: '#dc2626', wrong_direction: '#d97706', replace_link: '#d97706', wrong_type: '#7c3aed', delete_instance: '#dc2626' };

/* triples are stored as plain objects: {s, p, o, ot: 'iri' | 'lit' | 'blank', lang, dt}; a blank object matches any blank node */
const litKey = (v, lang, dt) => 'L' + v + '\u0002' + (lang || '') + '\u0002' + (lang ? '' : dt || XSD_STRING);
function tKey(t) { return t.s + '\u0001' + t.p + '\u0001' + (t.ot === 'iri' ? 'I' + t.o : t.ot === 'blank' ? '_:' : litKey(t.o, t.lang, t.dt)); }
function qKey(q) {
  const o = q.object;
  const ok = o.termType === 'NamedNode' ? 'I' + o.value : o.termType === 'BlankNode' ? '_:' : o.termType === 'Literal' ? litKey(o.value, o.language, o.datatype && o.datatype.value) : '?' + o.value;
  return (q.subject.termType === 'BlankNode' ? '_:' : '') + q.subject.value + '\u0001' + q.predicate.value + '\u0001' + ok;
}
function quadToT(q) {
  const o = q.object;
  if (o.termType === 'NamedNode') return { s: q.subject.value, p: q.predicate.value, o: o.value, ot: 'iri' };
  if (o.termType === 'BlankNode') return { s: q.subject.value, p: q.predicate.value, o: null, ot: 'blank' };
  return { s: q.subject.value, p: q.predicate.value, o: o.value, ot: 'lit', lang: o.language || '', dt: o.language ? '' : (o.datatype && o.datatype.value) || XSD_STRING };
}
function tToQuad(t) {
  const nn = v => ({ termType: 'NamedNode', value: v });
  const o = t.ot === 'iri' ? nn(t.o) : { termType: 'Literal', value: t.o, language: t.lang || '', datatype: nn(t.lang ? NS.rdf + 'langString' : t.dt || XSD_STRING) };
  return { subject: nn(t.s), predicate: nn(t.p), object: o, graph: { termType: 'DefaultGraph', value: '' } };
}
const T_IRI = (s, p, o) => ({ s, p, o, ot: 'iri' });
const activeChanges = () => S.changes.filter(c => c.status !== 'reverted');

/* the source quads with the active change log applied (last operation on a triple wins) */
function effectiveParsed() {
  const base = S.parsed || [];
  const act = activeChanges();
  if (!act.length) return base;
  const final = new Map();
  for (const c of act) { for (const t of c.del || []) final.set(tKey(t), { op: 'del', t }); for (const t of c.ins || []) final.set(tKey(t), { op: 'ins', t }); }
  const out = base.map(p => ({ ...p, quads: p.quads.filter(q => { const f = final.get(qKey(q)); return !(f && f.op === 'del'); }) }));
  /* drop blank-node descriptions that only the removed triples pointed to */
  const refs = list => { const r = new Set(); for (const p of list) for (const q of p.quads) if (q.object.termType === 'BlankNode') r.add(q.object.value); return r; };
  const refBase = refs(base);
  for (let pass = 0; pass < 4; pass++) {
    const refNow = refs(out);
    let removed = false;
    for (const p of out) {
      const n0 = p.quads.length;
      p.quads = p.quads.filter(q => q.subject.termType !== 'BlankNode' || refNow.has(q.subject.value) || !refBase.has(q.subject.value));
      if (p.quads.length !== n0) removed = true;
    }
    if (!removed) break;
  }
  const have = new Set(), fileOf = new Map();
  out.forEach((p, fi) => { for (const q of p.quads) { have.add(qKey(q)); if (!fileOf.has(q.subject.value)) fileOf.set(q.subject.value, fi); } });
  for (const { op, t } of final.values()) {
    if (op !== 'ins' || t.ot === 'blank') continue;
    const k = tKey(t);
    if (have.has(k)) continue;
    have.add(k);
    const fi = fileOf.get(t.s) ?? fileOf.get(t.o) ?? 0;
    if (out[fi]) out[fi].quads.push(tToQuad(t));
  }
  return out;
}
/* rebuild the graph model from source + change log, keeping placements, review and view */
function regraph() {
  if (!S.parsed) return;
  S.G = buildGraph(effectiveParsed());
  S.gHasChanges = activeChanges().length > 0;
  S.selection = S.selection.filter(i => S.G.nodes.has(i)); if (!S.selection.includes(S.selected)) S.selected = S.selection[S.selection.length - 1] || null; if (!S.selection.length) closeInspector();
  if (S.hovered && !S.G.nodes.has(S.hovered)) S.hovered = null;
  if (S.focusSystem) { if (S.G.nodes.has(S.focusSystem)) S.sysMembers = systemMembers(S.focusSystem); else { S.focusSystem = null; S.sysMembers = null; } }
  closeEdgePop();
  renderAllPanels();
  updateHeader();
}

function instanceNamespace() {
  const cnt = new Map();
  for (const iri of S.G.nodes.keys()) { const m = /^(.*[#/])[^#/]*$/.exec(iri); if (m) cnt.set(m[1], (cnt.get(m[1]) || 0) + 1); }
  return [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0] || 'urn:x-proposed:';
}
const pendingApply = () => S.findings.filter(f => f.status === 'accepted' && GRAPH_TYPES.has(f.type));

/* the triples one accepted finding removes and adds, worked out against the graph as it is now */
function changeForFinding(f, ns, eff) {
  const G = S.G, del = [], ins = [], notes = [];
  let anchor = null;
  const term = (raw, iri) => {
    if (iri && G.nodes.has(iri)) return iri;
    if (raw) {
      const p = S.findings.find(x => x.run === f.run && x.type === 'missing_instance' && x.proposedId === raw && (x.status === 'accepted' || x.status === 'applied'));
      if (p) return ns + p.proposedId;
      const r = resolveId(raw);
      if (r) return r;
    }
    return iri || null;
  };
  if (f.type === 'missing_instance') {
    const iri = ns + f.proposedId;
    if (G.nodes.has(iri)) notes.push(`${f.proposedId} already exists in the graph`);
    let typed = 0;
    for (const t of f.proposedTypes || []) { const ti = expandTerm(t); if (ti) { ins.push(T_IRI(iri, RDF_TYPE, ti)); typed++; } else notes.push(`unknown class ${t}`); }
    if (!typed) { ins.push(T_IRI(iri, RDF_TYPE, NS.owl + 'NamedIndividual')); notes.push('no known class proposed: typed owl:NamedIndividual for now'); }
    if (f.label) ins.push({ s: iri, p: NS.rdfs + 'label', o: f.label, ot: 'lit', lang: '', dt: XSD_STRING });
    for (const l of f.links || []) {
      const s = l.from === f.proposedId ? iri : term(l.from), p = expandTerm(l.predicate), o = l.to === f.proposedId ? iri : term(l.to);
      if (s && p && o) ins.push(T_IRI(s, p, o)); else notes.push(`could not resolve link ${l.from} ${l.predicate} ${l.to}`);
    }
    if (f.x != null) anchor = { iri, x: f.x, y: f.y };
  } else if (f.type === 'missing_link') {
    const s = term(f.from, f.fromIri), o = term(f.to, f.toIri), p = f.predIri;
    if (s && p && o) ins.push(T_IRI(s, p, o)); else notes.push(`could not resolve ${f.from} ${f.predicate} ${f.to}`);
  } else if (f.type === 'wrong_link' || f.type === 'wrong_direction' || f.type === 'replace_link') {
    let ex = G.edges.filter(e => e.s === f.fromIri && e.o === f.toIri && (!f.predIri || e.p === f.predIri));
    if (!ex.length && f.predIri) ex = G.edges.filter(e => e.s === f.toIri && e.o === f.fromIri && e.p === f.predIri);
    if (!ex.length) notes.push('the asserted triple is no longer in the graph');
    for (const e of ex) {
      del.push(T_IRI(e.s, e.p, e.o));
      if (f.type === 'wrong_direction') ins.push(T_IRI(e.o, e.p, e.s));
      if (f.type === 'replace_link') {
        const s = f.newFrom != null ? term(f.newFrom, f.newFromIri) : e.s, o = f.newTo != null ? term(f.newTo, f.newToIri) : e.o, p = f.newPredIri || e.p;
        if (s && p && o) ins.push(T_IRI(s, p, o)); else notes.push(`could not resolve the replacement ${f.newFrom || ''} ${f.newPredicate || ''} ${f.newTo || ''}`.replace(/\s+/g, ' '));
      }
    }
  } else if (f.type === 'wrong_type' && f.iri && G.nodes.has(f.iri)) {
    const n = G.nodes.get(f.iri);
    for (const t of f.removeTypes || []) { const ti = expandTerm(t); if (ti && n.types.has(ti)) del.push(T_IRI(f.iri, RDF_TYPE, ti)); }
    for (const t of f.addTypes || []) { const ti = expandTerm(t); if (ti && !n.types.has(ti)) ins.push(T_IRI(f.iri, RDF_TYPE, ti)); else if (!ti) notes.push(`unknown class ${t}`); }
  } else if (f.type === 'delete_instance' && f.iri) {
    for (const p of eff || effectiveParsed()) for (const q of p.quads) {
      if (q.subject.termType === 'NamedNode' && q.subject.value === f.iri) del.push(quadToT(q));
      else if (q.subject.termType === 'NamedNode' && q.object.termType === 'NamedNode' && q.object.value === f.iri) del.push(quadToT(q));
    }
    if (!del.length) notes.push('the instance is no longer in the graph');
  }
  const seen = new Set(), uniq = arr => arr.filter(t => { const k = tKey(t); if (seen.has(k)) return false; seen.add(k); return true; });
  return { del: uniq(del), ins: uniq(ins), notes, anchor };
}
function issueComment(f) {
  const ref = f.issueRef;
  if (!ref) return '';
  if (ref.kind === 'node') return (S.qa.nodes[ref.key] || {}).note || '';
  if (ref.kind === 'edge') return (S.qa.edges[ref.key] || {}).note || '';
  const r = S.rules.find(x => x.id === ref.key);
  if (!r) return '';
  return r.kind === 'rule' ? ruleText(r) + (r.comment ? ' — ' + r.comment : '') : r.text;
}
function originLabel(f) {
  const run = S.recheckRuns.find(x => x.id === f.run);
  if (!run) return '';
  const kind = run.kind === 'resolve' ? 'Resolve with Claude' : run.kind === 'rule' ? 'Rule check' : 'Re-check areas';
  const a = (run.areas || []).find(x => x.id === f.area);
  return `${kind} · ${run.model}${a ? ` · ${a.id}${a.label ? ' ' + a.label : ''}` : ''}`;
}
function applyFindings(list) {
  list = list.filter(f => f.status === 'accepted' && GRAPH_TYPES.has(f.type));
  if (!list.length || !S.G) return 0;
  const snap = snapshot();
  const ns = instanceNamespace(), batch = 'b' + Date.now().toString(36), at = new Date().toISOString();
  const eff = list.some(f => f.type === 'delete_instance') ? effectiveParsed() : null;
  let nDel = 0, nIns = 0;
  for (const f of list) {
    const r = changeForFinding(f, ns, eff);
    const resolved = [];
    const close = (kind, key) => {
      const store = kind === 'node' ? S.qa.nodes : S.qa.edges, rec = key && store[key];
      if (rec && (rec.status === 'issue' || rec.status === 'unsure')) { resolved.push({ kind, key, prev: { ...rec } }); rec.status = 'resolved'; rec.at = at; }
    };
    if (!f.issueRef) {   /* flags created when a re-check finding was accepted: the fix answers them */
      if ((f.type === 'wrong_type' || f.type === 'delete_instance') && f.iri) close('node', f.iri);
      if (f.type === 'wrong_link' || f.type === 'wrong_direction' || f.type === 'replace_link') close('edge', edgeKeyFor(f));
    }
    if (f.type === 'delete_instance' && f.iri) close('node', f.iri);
    S.changeSeq = (S.changeSeq || 0) + 1;
    const entry = { id: 'c' + S.changeSeq, seq: S.changeSeq, batch, at, status: 'applied', findingId: f.id, type: f.type, title: findingTitle(f),
      why: f.evidence || f.text || '', comment: issueComment(f), origin: originLabel(f), conf: f.conf, del: r.del, ins: r.ins, notes: r.notes, anchor: r.anchor, resolved };
    S.changes.push(entry);
    f.status = 'applied'; f.changeId = entry.id;
    if (r.anchor && !placed(r.anchor.iri)) {
      const a = { x: r.anchor.x, y: r.anchor.y, source: 'claude', conf: f.conf, why: 'proposed position (' + (entry.origin || 'Claude') + ')' };
      S.anchors.set(r.anchor.iri, a); S.off.delete(r.anchor.iri);
      if (!S.orig.has(r.anchor.iri)) S.orig.set(r.anchor.iri, { ...a });
    }
    nDel += r.del.length; nIns += r.ins.length;
  }
  for (const f of list) resolveSourceIfDone(f);
  dropToast('pending');
  commit(`apply ${list.length} fix${list.length === 1 ? '' : 'es'} to the graph`, snap);
  regraph(); persist(); rebuild(); updateQaSummary(); renderIssues();
  refreshInspector();
  toast(`Applied ${list.length} fix${list.length === 1 ? '' : 'es'}: ${nDel} triple${nDel === 1 ? '' : 's'} removed, ${nIns} added`, { label: 'Undo', fn: undo });
  return list.length;
}
function revertChange(c) {
  const snap = snapshot();
  c.status = 'reverted'; c.revertedAt = new Date().toISOString();
  const f = S.findings.find(x => x.id === c.findingId);
  if (f && f.status === 'applied') { f.status = 'accepted'; delete f.changeId; }
  for (const r of c.resolved || []) { const store = r.kind === 'node' ? S.qa.nodes : S.qa.edges; if (store[r.key] && store[r.key].status === 'resolved') store[r.key] = { ...r.prev }; }
  commit(`revert ${c.id} ${CHANGE_LABEL[c.type] ? CHANGE_LABEL[c.type].toLowerCase() : ''}`, snap);
  regraph(); persist(); rebuild(); updateQaSummary(); renderIssues();
  toast(`Reverted ${c.id}`, { label: 'Undo', fn: undo });
}
const nmT = iri => (S.G && S.G.nodes.get(iri) ? S.G.nodes.get(iri).local : localName(iri));
function tripleText(t) {
  const o = t.ot === 'iri' ? (t.p === RDF_TYPE ? qn(t.o) : nmT(t.o)) : t.ot === 'blank' ? '[ … ]' : JSON.stringify(t.o.length > 60 ? t.o.slice(0, 60) + '…' : t.o) + (t.lang ? '@' + t.lang : '');
  return `${nmT(t.s)} ${t.p === RDF_TYPE ? 'a' : qn(t.p)} ${o}`;
}
function changeNodes(c) {
  const set = new Set();
  for (const t of [...c.del, ...c.ins]) { set.add(t.s); if (t.ot === 'iri' && t.p !== RDF_TYPE) set.add(t.o); }
  return [...set].filter(i => S.G.nodes.has(i));
}
function showChange(c) {
  closeIssuesOnPhone();
  const nodes = changeNodes(c);
  if (!nodes.length) { toast('Nothing of this change is in the graph now'); return; }
  const set = new Set(nodes);
  setIssueFocus(`${c.id} · ${CHANGE_LABEL[c.type] || 'Change'}`, () => ({ set, edges: new Set(S.groups.filter(g => set.has(g.a) && set.has(g.b))) }), { src: 'issues' });
  const pts = nodes.filter(placed).map(i => S.anchors.get(i));
  if (pts.length) centerOn(pts);
}
/* ---- exports: corrections (SPARQL Update), refined Turtle, change log CSV ---- */
const sparqlLit = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
function netChanges() {
  /* net effect against the source graph, grouped by the change that set each triple's final state */
  const src = new Set();
  for (const p of S.parsed || []) for (const q of p.quads) src.add(qKey(q));
  const final = new Map();
  for (const c of activeChanges()) { for (const t of c.del) final.set(tKey(t), { op: 'del', t, c }); for (const t of c.ins) final.set(tKey(t), { op: 'ins', t, c }); }
  const by = new Map();
  for (const [k, v] of final) {
    if (v.op === 'del' ? !src.has(k) : src.has(k)) continue;
    let b = by.get(v.c.id); if (!b) by.set(v.c.id, b = { c: v.c, del: [], ins: [] });
    b[v.op === 'del' ? 'del' : 'ins'].push(v.t);
  }
  return [...by.values()].sort((a, b) => a.c.seq - b.c.seq);
}
function correctionsSparql() {
  const act = activeChanges(), net = netChanges(), T = iri => `<${iri}>`;
  const obj = t => (t.ot === 'iri' ? T(t.o) : sparqlLit(t.o) + (t.lang ? '@' + t.lang : t.dt && t.dt !== XSD_STRING ? '^^' + T(t.dt) : ''));
  const del = [], ins = [], blanks = [];
  for (const { c, del: d, ins: i } of net) {
    const tag = `# ${c.id} · ${CHANGE_LABEL[c.type] || c.type}: ${c.title}`;
    const dd = d.filter(t => t.ot !== 'blank');
    if (dd.length) del.push(tag, ...dd.map(t => `${T(t.s)} ${T(t.p)} ${obj(t)} .`));
    for (const t of d.filter(x => x.ot === 'blank')) blanks.push(`${tag}\nDELETE { ${T(t.s)} ${T(t.p)} ?b . ?b ?bp ?bo } WHERE { ${T(t.s)} ${T(t.p)} ?b . FILTER(isBlank(?b)) OPTIONAL { ?b ?bp ?bo } } ;`);
    if (i.length) ins.push(tag, ...i.map(t => `${T(t.s)} ${T(t.p)} ${obj(t)} .`));
  }
  const pend = pendingApply().length;
  const out = [`# Corrections from the change log: ${act.length} applied change${act.length === 1 ? '' : 's'} — Graph Overlay Inspector, ${new Date().toISOString()}`,
    `# Graph: ${S.graphs.map(g => g.name).join(' + ')} · drawing: ${S.drawing ? S.drawing.name : '-'}`,
    '# Running it on the source graph gives the refined graph shown in the app.' + (S.G ? ` New instances use the namespace <${instanceNamespace()}>.` : ''),
    pend ? `# ${pend} accepted fix${pend === 1 ? ' is' : 'es are'} not applied yet and not included.` : null, ''].filter(x => x != null);
  out.push(...blanks);
  if (del.length) out.push('DELETE DATA {', ...del.map(l => '  ' + l), '}' + (ins.length ? ' ;' : ''), '');
  if (ins.length) out.push('INSERT DATA {', ...ins.map(l => '  ' + l), '}', '');
  if (!del.length && !ins.length && !blanks.length) out.push('# The change log has no net effect on the source graph.', '');
  const notes = act.filter(c => c.notes && c.notes.length).map(c => `# ${c.id}: ${c.notes.join('; ')}`);
  if (notes.length) out.push('# --- notes ---', ...notes);
  return out.join('\n');
}
function openCorrections() {
  if (!S.G) return;
  const pend = pendingApply();
  if (!activeChanges().length) {
    if (pend.length) {
      openModal('Nothing applied yet', [h('p', null, `${pend.length} accepted fix${pend.length === 1 ? ' is' : 'es are'} waiting. The corrections file is built from the change log, so apply them to the graph first.`)],
        [h('button', { class: 'btn ghost', onclick: closeModal }, 'Close'), h('button', { class: 'btn primary', onclick: () => { applyFindings(pend); closeModal(); openCorrections(); } }, `Apply ${pend.length} and continue`)]);
    } else toast('Accept and apply some fixes first');
    return;
  }
  const text = correctionsSparql();
  const ta = h('textarea', { class: 'out', readonly: true, 'aria-label': 'SPARQL Update' });
  ta.value = text;
  openModal('Corrections (SPARQL Update)', [
    h('p', null, 'Every change in the change log, as one SPARQL Update: removed triples are DELETE DATA, added ones INSERT DATA. Run it against your graph store to get the same refined graph, or export the refined graph as Turtle instead.'),
    pend.length ? h('div', { class: 'callout warn' }, `${pend.length} accepted fix${pend.length === 1 ? ' is' : 'es are'} not applied yet and not included.`) : null, ta,
  ], [h('button', { class: 'btn', onclick: () => exportRefined() }, 'Refined graph (.ttl)'), h('button', { class: 'btn', onclick: () => saveFile(baseName() + '.corrections.sparql.txt', text) }, 'Save as .txt'), h('button', { class: 'btn primary', onclick: () => copyText(text, ta) }, 'Copy')]);
}
function turtleOf(parsed) {
  const pfx = Object.entries(S.G.prefixes).filter(([, ns]) => ns).sort((a, b) => b[1].length - a[1].length);
  const used = new Set();
  const name = iri => {
    for (const [p, ns] of pfx) {
      if (!iri.startsWith(ns)) continue;
      const l = iri.slice(ns.length);
      if (l === '' || /^[A-Za-z0-9_](?:[A-Za-z0-9_\-.]*[A-Za-z0-9_\-])?$/.test(l)) { used.add(p); return p + ':' + l; }
    }
    return '<' + iri.replace(/[\x00-\x20<>"{}|^`\\]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '>';
  };
  const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  const bn = v => '_:b' + String(v).replace(/[^A-Za-z0-9_-]/g, '_');
  const term = o => (o.termType === 'NamedNode' ? name(o.value) : o.termType === 'BlankNode' ? bn(o.value)
    : '"' + esc(o.value) + '"' + (o.language ? '@' + o.language : o.datatype && o.datatype.value !== XSD_STRING ? '^^' + name(o.datatype.value) : ''));
  const subj = new Map(), seen = new Set();
  for (const p of parsed) for (const q of p.quads) {
    const sk = (q.subject.termType === 'BlankNode' ? '_:' : '') + q.subject.value;
    const ok = q.object.termType === 'BlankNode' ? '_:' + q.object.value : qKey(q);
    const full = sk + '\u0001' + q.predicate.value + '\u0001' + ok;
    if (seen.has(full)) continue;
    seen.add(full);
    let s = subj.get(sk); if (!s) subj.set(sk, s = { t: q.subject, preds: new Map() });
    let arr = s.preds.get(q.predicate.value); if (!arr) s.preds.set(q.predicate.value, arr = []);
    arr.push(q.object);
  }
  const body = [];
  for (const s of subj.values()) {
    const preds = [...s.preds.entries()].sort((a, b) => (b[0] === RDF_TYPE) - (a[0] === RDF_TYPE));
    const parts = preds.map(([p, objs]) => `${p === RDF_TYPE ? 'a' : name(p)} ${objs.map(term).join(', ')}`);
    body.push(`${s.t.termType === 'BlankNode' ? bn(s.t.value) : name(s.t.value)} ${parts.join(' ;\n    ')} .`);
  }
  const head = [`# Refined graph — ${S.graphs.map(g => g.name).join(' + ')} with ${activeChanges().length} change${activeChanges().length === 1 ? '' : 's'} from the change log applied`,
    `# Written by Graph Overlay Inspector, ${new Date().toISOString()}`, ''];
  for (const p of [...used].sort()) head.push(`@prefix ${p}: <${S.G.prefixes[p]}> .`);
  return head.join('\n') + '\n\n' + body.join('\n\n') + '\n';
}
function exportRefined() {
  if (!S.G) return;
  let text;
  try {
    text = turtleOf(effectiveParsed());
    new N3Parser().parse(text);   /* never hand out a file that does not parse */
  } catch (e) { toast('Could not write the refined graph: ' + (e.message || e)); return; }
  saveFile(baseName() + '.refined.ttl', text);
}
function changesCsv() {
  const rows = [['change', 'status', 'applied_at', 'reverted_at', 'type', 'title', 'removed_triples', 'added_triples', 'why', 'reviewer_comment', 'origin', 'confidence', 'finding', 'batch', 'notes']];
  const tl = arr => arr.map(t => `${qn(t.s)} ${t.p === RDF_TYPE ? 'a' : qn(t.p)} ${t.ot === 'iri' ? qn(t.o) : t.ot === 'blank' ? '[]' : JSON.stringify(t.o)}`).join('\n');
  for (const c of S.changes) rows.push([c.id, c.status, c.at, c.revertedAt || '', CHANGE_LABEL[c.type] || c.type, c.title, tl(c.del), tl(c.ins), c.why || '', c.comment || '', c.origin || '', c.conf ?? '', c.findingId || '', c.batch || '', (c.notes || []).join('; ')]);
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}
function exportChangeLog() {
  if (!S.changes.length) { toast('The change log is empty — accept and apply some fixes first'); return; }
  saveFile(baseName() + '.changelog.csv', changesCsv());
}

/* =====================================================================
   12c. Issues panel — flags, rules, notes and Claude's proposals in one place;
        Resolve with Claude; project files; Open in Claude; setup card
   ===================================================================== */
const ARTIFACT_URL = 'https://claude.ai/artifact/8YhmdfPfZJrJiHpNsR8LF8';
let FRAMED = true;
try { FRAMED = window.top !== window.self; } catch { FRAMED = true; }
const KIND_OPTS = [
  ['kind:physical', 'Any physical element'], ['kind:component', 'Equipment / components'], ['kind:segment', 'Ducts / pipes (segments)'],
  ['kind:fitting', 'Fittings / junctions'], ['kind:location', 'Locations (rooms, zones, storeys)'], ['kind:system', 'Systems'], ['kind:point', 'Points / sensors'],
];
function classMatch(iri, list) {
  if (!list || !list.length) return true;
  const n = S.G.nodes.get(iri);
  if (!n) return false;
  return list.some(c => {
    if (c.startsWith('kind:')) { const k = c.slice(5); return k === 'physical' ? ['component', 'segment', 'fitting', 'point'].includes(n.kind) : n.kind === k || (k === 'system' && !!n.sysToo); }
    for (const t of n.types) if (t === c || S.G.supers(t).has(c)) return true;
    return false;
  });
}
function ruleViolations(rule) {
  if (!S.G || rule.kind !== 'rule' || !rule.predicate) return [];
  return S.G.edges.filter(e => e.p === rule.predicate && (!classMatch(e.s, rule.domain) || !classMatch(e.o, rule.range)));
}
const termLabel = c => (c.startsWith('kind:') ? (KIND_OPTS.find(k => k[0] === c) || [c, c.slice(5)])[1].toLowerCase() : qn(c));
function ruleText(r) {
  if (r.kind === 'note') return r.text || '';
  const d = r.domain && r.domain.length ? r.domain.map(termLabel).join(' or ') : 'anything';
  const g = r.range && r.range.length ? r.range.map(termLabel).join(' or ') : 'anything';
  return `${qn(r.predicate)} should only go from ${d} to ${g}`;
}
function edgeTriples(cat, a, b) { return S.G.edges.filter(e => e.cat === cat && ((e.s === a && e.o === b) || (e.s === b && e.o === a))); }
function flagItems(includeClosed) {
  const G = S.G, items = [];
  if (!G) return items;
  const want = st => st === 'issue' || st === 'unsure' || (includeClosed && st === 'resolved');
  for (const [iri, r] of Object.entries(S.qa.nodes)) if (G.nodes.has(iri) && want(r.status)) items.push({ kind: 'node', key: iri, rec: r });
  for (const [k, r] of Object.entries(S.qa.edges)) {
    const [cat, a, b] = k.split('|');
    if (G.nodes.has(a) && G.nodes.has(b) && want(r.status)) items.push({ kind: 'edge', key: k, cat, a, b, rec: r });
  }
  const order = { issue: 0, unsure: 1, resolved: 2 };
  return items.sort((x, y) => order[x.rec.status] - order[y.rec.status] || String(y.rec.at || '').localeCompare(String(x.rec.at || '')));
}
function openIssueCount() {
  if (!S.G) return 0;
  return flagItems(false).length + S.rules.filter(r => r.status !== 'resolved').length + S.findings.filter(f => f.status === 'open').length;
}
function updateFindingsSummary() {
  const n = openIssueCount();
  const c = $('#issCount');
  if (c) { c.textContent = n; c.hidden = !n; }
  const box = $('#findSummary');
  if (!box) return;
  box.textContent = '';
  box.append(h('span', { class: 'grow' }, n ? `${n} open issue${n === 1 ? '' : 's'}, rules and proposals` : 'No open issues.'), h('button', { class: 'btn small', onclick: () => openIssues() }, 'Issues panel'));
}
function ensureScrim(onClose) {
  let sc = $('.scrim');
  if (!sc) { sc = h('div', { class: 'scrim' }); document.body.append(sc); }
  sc.onclick = () => { onClose(); sc.remove(); };
}
function removeScrim() { const sc = $('.scrim'); if (sc && !$('#side').classList.contains('open')) sc.remove(); }
/* =====================================================================
   12f. Right-hand panels (Issues or SPARQL — one at a time)
   ===================================================================== */
function setRightPanel(which, keepFocus) {
  const prev = S.rightPanel || null;
  which = which || null;
  S.rightPanel = which;
  S.issuesOpen = which === 'issues';
  $('#issues').hidden = which !== 'issues';
  $('#sparql').hidden = which !== 'sparql';
  const main = $('.main');
  main.classList.toggle('with-issues', !!which);
  main.classList.toggle('with-sparql', which === 'sparql');
  $('#btnIssues').classList.toggle('on', which === 'issues');
  $('#btnSparql').classList.toggle('on', which === 'sparql');
  if (!keepFocus && prev && prev !== which && S.issueFocus && S.issueFocus.src === prev) clearIssueFocus();
  if (!keepFocus && prev === 'sparql' && which !== 'sparql') S.sparqlSel = null;
  if (which && window.innerWidth <= 820) ensureScrim(closeRightPanel);
  else if (!which) removeScrim();
  frame();
}
function closeRightPanel() { setRightPanel(null); }
function openIssues(section) {
  if (S.areaMode) exitAreaMode(true);
  setRightPanel('issues');
  renderIssues();
  if (section) { const el = $(`#issues [data-sec="${section}"]`); if (el) el.scrollIntoView({ block: 'start' }); }
}
function closeIssues() { if (S.rightPanel === 'issues') setRightPanel(null); }
function closeIssuesOnPhone() { if (window.innerWidth <= 820 && S.rightPanel) setRightPanel(null, true); }   /* phones: show the drawing, keep the highlight */

/* ---- SPARQL ---- */
const SPARQL_EXAMPLES = [
  { name: 'Count instances per class', q: 'SELECT ?class (COUNT(?s) AS ?n)\nWHERE { ?s a ?class }\nGROUP BY ?class\nORDER BY DESC(?n)' },
  { name: 'Flow links: subject, predicate, object', q: 'SELECT ?s ?p ?o\nWHERE {\n  VALUES ?p { fso:suppliesFluidTo fso:returnsFluidTo brick:feeds }\n  ?s ?p ?o .\n}\nLIMIT 300' },
  { name: 'Everything downstream of the air handling unit', q: 'SELECT DISTINCT ?x ?label\nWHERE {\n  ?ahu a brick:Air_Handling_Unit .\n  ?ahu (fso:suppliesFluidTo|brick:feeds)+ ?x .\n  OPTIONAL { ?x rdfs:label ?label }\n}' },
  { name: 'Components with no room or zone', q: 'SELECT ?el ?label\nWHERE {\n  ?el a bot:Element .\n  OPTIONAL { ?el rdfs:label ?label }\n  FILTER NOT EXISTS { ?space bot:containsElement ?el }\n  FILTER NOT EXISTS { ?el brick:hasLocation ?loc }\n}\nORDER BY ?el' },
  { name: 'Dampers and what supplies them', q: 'SELECT ?from ?damper\nWHERE {\n  ?damper a brick:Damper .\n  ?from fso:suppliesFluidTo ?damper .\n}' },
  { name: 'Parts of each unit', q: 'SELECT ?whole ?part\nWHERE {\n  { ?whole brick:hasPart ?part } UNION { ?whole bot:hasSubElement ?part }\n}\nORDER BY ?whole' },
  { name: 'Find instances by label text', q: 'SELECT ?s ?label\nWHERE {\n  ?s rdfs:label ?label .\n  FILTER(CONTAINS(LCASE(STR(?label)), "damper"))\n}' },
  { name: 'Components that supply nothing (dead ends)', q: 'SELECT ?x ?type\nWHERE {\n  ?any fso:suppliesFluidTo ?x .\n  ?x a ?type .\n  FILTER NOT EXISTS { ?x fso:suppliesFluidTo ?next }\n  FILTER(STRSTARTS(STR(?type), STR(sig:)))\n}' },
  { name: 'owl:sameAs groups (aliases of the same thing)', q: 'SELECT ?x (GROUP_CONCAT(DISTINCT STR(?alias); SEPARATOR=" = ") AS ?aliases)\nWHERE {\n  ?x owl:sameAs ?alias .\n  FILTER(?x != ?alias)\n}\nGROUP BY ?x' },
  { name: 'Is there a fan? (ASK)', q: 'ASK { ?f a brick:Fan }' },
  { name: 'Reverse flow as isFedBy (CONSTRUCT)', q: 'CONSTRUCT { ?b brick:isFedBy ?a }\nWHERE { ?a fso:suppliesFluidTo ?b }\nLIMIT 100' },
];
const SPARQL_PANEL_ROWS = 400;
function sparqlState() {
  if (!S.sparql) S.sparql = { q: LS.get('kgov:sparqlQ', null) || SPARQL_EXAMPLES[1].q, res: null, err: null, running: false, showInView: LS.get('kgov:sparqlView', true) !== false, sameAs: LS.get('kgov:sparqlSameAs', true) !== false, hist: LS.get('kgov:sparqlHist', []) || [] };
  return S.sparql;
}
function openSparql() {
  if (S.areaMode) exitAreaMode(true);
  setRightPanel('sparql');
  buildSparqlPanel();
  renderSparql();
  setTimeout(() => { const ta = $('#sqEditor'); if (ta && window.innerWidth > 820) ta.focus(); }, 30);
}
function closeSparql() { if (S.rightPanel === 'sparql') setRightPanel(null); }
function sparqlPrefixLine() {
  const P = (S.G && S.G.prefixes) || {};
  const ks = Object.keys(P).filter(k => P[k]).slice(0, 14);
  return ks.length ? ks.map(k => k + ':').join(' ') : 'none';
}
function buildSparqlPanel() {
  const box = $('#sparql');
  if (box.querySelector('#sqEditor')) { const pl = box.querySelector('.sq-prefixes'); if (pl) pl.textContent = 'Prefixes available without PREFIX lines: ' + sparqlPrefixLine(); return; }
  const st = sparqlState();
  box.textContent = '';
  const ta = h('textarea', { id: 'sqEditor', class: 'sq-editor mono', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'SPARQL query', placeholder: 'SELECT ?s WHERE { ?s a brick:Damper }' });
  ta.value = st.q;
  ta.addEventListener('input', () => { st.q = ta.value; LS.set('kgov:sparqlQ', st.q); });
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSparql(); return; }
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const a = ta.selectionStart, b = ta.selectionEnd; ta.setRangeText('  ', a, b, 'end'); st.q = ta.value; LS.set('kgov:sparqlQ', st.q); }
    if (e.key === 'Escape') { e.stopPropagation(); ta.blur(); }
  });
  const exSel = h('select', { class: 'sq-ex', 'aria-label': 'Example queries' }, h('option', { value: '' }, 'Examples…'), ...SPARQL_EXAMPLES.map((x, i) => h('option', { value: String(i) }, x.name)));
  exSel.addEventListener('change', () => { const x = SPARQL_EXAMPLES[+exSel.value]; if (x) { ta.value = st.q = x.q; LS.set('kgov:sparqlQ', st.q); } exSel.value = ''; ta.focus(); });
  const hiSel = h('select', { class: 'sq-ex', id: 'sqHist', 'aria-label': 'Query history' });
  const fillHist = () => { hiSel.textContent = ''; hiSel.append(h('option', { value: '' }, st.hist.length ? `History (${st.hist.length})…` : 'History')); st.hist.forEach((q, i) => hiSel.append(h('option', { value: String(i) }, q.replace(/\s+/g, ' ').slice(0, 70)))); hiSel.disabled = !st.hist.length; };
  fillHist(); S._sqFillHist = fillHist;
  hiSel.addEventListener('change', () => { const q = st.hist[+hiSel.value]; if (q != null) { ta.value = st.q = q; LS.set('kgov:sparqlQ', q); } hiSel.value = ''; ta.focus(); });
  const viewCb = h('input', { type: 'checkbox', id: 'sqView' });
  viewCb.checked = st.showInView;
  viewCb.addEventListener('change', () => { st.showInView = viewCb.checked; LS.set('kgov:sparqlView', st.showInView); S.sparqlSel = null; if (st.showInView) showSparqlInView(null, false); else if (S.issueFocus && S.issueFocus.src === 'sparql') clearIssueFocus(); renderSparqlResults(); });
  const sameCb = h('input', { type: 'checkbox', id: 'sqSameAs' });
  sameCb.checked = st.sameAs;
  sameCb.addEventListener('change', () => { st.sameAs = sameCb.checked; LS.set('kgov:sparqlSameAs', st.sameAs); if (st.res || st.err) runSparql(); });
  const runBtn = h('button', { class: 'btn small primary', id: 'sqRun', onclick: runSparql, title: 'Run (Ctrl/⌘ + Enter)' }, 'Run');
  box.append(
    h('header', null, h('h2', null, 'SPARQL'), h('span', { class: 'badge', id: 'sqBadge' }, 'query'),
      h('button', { class: 'x-btn', 'aria-label': 'Close SPARQL', onclick: closeSparql }, '✕')),
    h('div', { class: 'sq-top' },
      h('div', { class: 'sq-tools' }, exSel, hiSel),
      ta,
      h('div', { class: 'sq-prefixes hint' }, 'Prefixes available without PREFIX lines: ' + sparqlPrefixLine()),
      h('div', { class: 'sq-run' },
        h('label', { class: 'check', title: 'Highlight the entities and links found by the query on the drawing' }, viewCb, 'Show results in the view'),
        h('label', { class: 'check', title: 'Treat owl:sameAs as identity: everything said about one name holds for all its aliases (symmetric, transitive, and substituted in subject, predicate and object)' }, sameCb, 'owl:sameAs'),
        h('span', { class: 'grow' }),
        h('span', { class: 'muted sq-kbd' }, 'Ctrl/⌘ + Enter'), runBtn)),
    h('div', { class: 'sq-results', id: 'sqResults', 'aria-live': 'polite' }));
}
function renderSparql() {
  const box = $('#sparql');
  if (!box || box.hidden || !box.querySelector('#sqEditor')) return;
  renderSparqlResults();
}
function runSparql() {
  const st = sparqlState();
  if (st.running) return;
  const ta = $('#sqEditor');
  const src = (ta ? ta.value : st.q).trim();
  if (!src) return;
  if (!S.G) { st.err = 'Open a graph first.'; st.res = null; renderSparqlResults(); return; }
  st.q = src; LS.set('kgov:sparqlQ', src);
  st.hist = [src, ...st.hist.filter(q => q !== src)].slice(0, 25); LS.set('kgov:sparqlHist', st.hist);
  if (S._sqFillHist) S._sqFillHist();
  st.running = true; st.err = null; S.sparqlSel = null;
  renderSparqlResults();
  setTimeout(() => {
    try {
      const quads = effectiveParsed().flatMap(p => p.quads);
      st.res = SparqlEngine.run(src, quads, { prefixes: { ...SPARQL_DEFAULT_PREFIXES, ...S.G.prefixes }, sameAs: st.sameAs });
      st.err = null;
    } catch (e) {
      st.res = null;
      st.err = (e && e.message) || String(e);
    }
    st.running = false;
    if (S.issueFocus && S.issueFocus.src === 'sparql') { S.issueFocus = null; applyFocus(); renderFocusPill(); }
    if (st.res && st.showInView) showSparqlInView(null, true);
    renderSparqlResults();
  }, 20);
}
const SPARQL_DEFAULT_PREFIXES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#', bot: 'https://w3id.org/bot#', fso: 'https://w3id.org/fso#', brick: 'https://brickschema.org/schema/Brick#',
};
function sqTermText(t) {
  if (!t) return '';
  if (t.termType === 'NamedNode') return qn(t.value);
  if (t.termType === 'BlankNode') return '_:' + t.value;
  const dt = t.datatype && t.datatype.value;
  if (t.language) return `"${t.value}"@${t.language}`;
  if (!dt || dt === XSD_STRING) return t.value;
  if (/#(integer|decimal|double|float|int|long|boolean)$/.test(dt)) return t.value;
  return `"${t.value}"^^${qn(dt)}`;
}
function sqCell(t) {
  if (!t) return h('td', { class: 'muted' }, '');
  const txt = sqTermText(t);
  if (t.termType === 'NamedNode' && S.G && S.G.nodes.has(t.value)) {
    const placedHere = S.pos.has(t.value);
    return h('td', null, h('button', { class: 'linkbtn mono' + (placedHere ? '' : ' off'), title: placedHere ? 'Select on the drawing' : 'Not on this drawing — opens its details', onclick: e => { e.stopPropagation(); closeIssuesOnPhone(); select(t.value, { add: e.ctrlKey || e.metaKey }); } }, txt));
  }
  return h('td', { class: t.termType === 'Literal' ? 'lit' : 'mono', title: t.termType === 'NamedNode' ? t.value : null }, txt);
}
/* the entities and links a result (or one row of it) points at */
function sparqlTargets(only) {
  const st = sparqlState(), r = st.res, G = S.G;
  const set = new Set(), keys = new Map(), cache = new Map(), pts = [];
  if (!r || !G) return { set, edges: new Set(), groups: [], pts };
  /* with owl:sameAs, a result may name an alias: highlight the member of its sameAs group that is on the drawing */
  const onDrawing = iri => {
    if (S.pos.has(iri) || !r.sameMembers) return iri;
    const m = r.sameMembers.get('I' + iri);
    const hit = m && m.find(t => t.termType === 'NamedNode' && S.pos.has(t.value));
    return hit ? hit.value : iri;
  };
  const addNode = iri0 => { const iri = onDrawing(iri0); if (G.nodes.has(iri) && !set.has(iri)) { set.add(iri); const p = S.pos.get(iri); if (p) pts.push(p); } };
  const addEdge = e => { const g = groupForEdge(e, cache); if (S.pos.has(g.a) && S.pos.has(g.b)) keys.set(g.key, g); };
  if (r.type === 'select') {
    const rows = only != null ? [r.rows[only]].filter(Boolean) : r.rows;
    for (const row of rows) {
      const nodes = new Set(), preds = new Set();
      for (const v of r.vars) { const t = row[v]; if (!t || t.termType !== 'NamedNode') continue; const iri = onDrawing(t.value); if (G.nodes.has(iri)) nodes.add(iri); else preds.add(t.value); }
      nodes.forEach(addNode);
      if (nodes.size >= 2 && nodes.size <= 60) for (const a of nodes) for (const idx of G.nodes.get(a).out) { const e = G.edges[idx]; if (nodes.has(e.o) && (!preds.size || preds.has(e.p))) addEdge(e); }
    }
  } else if (r.type === 'construct' || r.type === 'describe') {
    const ts = only != null ? [r.triples[only]].filter(Boolean) : r.triples;
    for (const t of ts) {
      if (t.s.termType !== 'NamedNode') continue;
      const sI = onDrawing(t.s.value), oI = t.o.termType === 'NamedNode' ? onDrawing(t.o.value) : null;
      addNode(sI);
      if (oI) addNode(oI);
      const n = G.nodes.get(sI);
      if (n && oI) for (const idx of n.out) { const e = G.edges[idx]; if (e.o === oI && e.p === t.p.value) addEdge(e); }
    }
  }
  return { set, edges: new Set(keys.keys()), groups: [...keys.values()], pts };
}
function showSparqlInView(only, fit, leavePanel) {
  const t = sparqlTargets(only);
  if (!t.set.size && !t.groups.length) {
    if (S.issueFocus && S.issueFocus.src === 'sparql') clearIssueFocus();
    if (only != null) toast('This row has no entity on the drawing');
    return;
  }
  const st = sparqlState(), n = st.res && st.res.type === 'select' ? st.res.rows.length : st.res && st.res.triples ? st.res.triples.length : 0;
  const label = only != null ? `SPARQL row ${only + 1}` : `SPARQL · ${n} result${n === 1 ? '' : 's'}`;
  setIssueFocus(label, () => { const x = sparqlTargets(only); return { set: x.set, edges: x.edges, groups: x.groups }; }, { strong: true, src: 'sparql' });
  if (fit && t.pts.length) { if (leavePanel) closeIssuesOnPhone(); animateTo(fitTarget(t.pts, { maxS: Math.max(S.view.s, S.fitS * (only != null ? 5 : 2.5)) })); }
}
function sparqlRowClick(i) {
  if (S.sparqlSel === i) { S.sparqlSel = null; if (sparqlState().showInView) showSparqlInView(null, false); else clearIssueFocus(); renderSparqlResults(); return; }
  S.sparqlSel = i;
  showSparqlInView(i, true, true);
  renderSparqlResults();
}
function sparqlTable(r, { limit, onRow, selRow } = {}) {
  const head = r.type === 'select' ? r.vars : ['subject', 'predicate', 'object'];
  const list = r.type === 'select' ? r.rows : r.triples;
  const shown = limit ? list.slice(0, limit) : list;
  const tb = h('tbody');
  shown.forEach((row, i) => {
    const cells = r.type === 'select' ? r.vars.map(v => sqCell(row[v])) : [sqCell(row.s), sqCell(row.p), sqCell(row.o)];
    const tr = h('tr', { class: i === selRow ? 'sel' : '', tabindex: onRow ? '0' : null }, h('td', { class: 'rn' }, String(i + 1)), ...cells);
    if (onRow) { tr.addEventListener('click', () => onRow(i)); tr.addEventListener('keydown', e => { if (e.key === 'Enter') onRow(i); }); }
    tb.append(tr);
  });
  return h('table', { class: 'sq-table' }, h('thead', null, h('tr', null, h('th', { class: 'rn' }, '#'), ...head.map(v => h('th', null, r.type === 'select' ? '?' + v : v)))), tb);
}
function sparqlCsv(r) {
  const head = r.type === 'select' ? r.vars : ['subject', 'predicate', 'object'];
  const list = r.type === 'select' ? r.rows.map(row => r.vars.map(v => row[v])) : r.triples.map(t => [t.s, t.p, t.o]);
  const val = t => (!t ? '' : t.termType === 'Literal' ? t.value : t.termType === 'BlankNode' ? '_:' + t.value : t.value);
  return [head.join(','), ...list.map(cols => cols.map(t => csvCell(val(t))).join(','))].join('\r\n') + '\r\n';
}
function renderSparqlResults() {
  const box = $('#sqResults');
  if (!box) return;
  const st = sparqlState(), r = st.res;
  const run = $('#sqRun');
  if (run) { run.disabled = st.running; run.textContent = st.running ? 'Running…' : 'Run'; }
  box.textContent = '';
  const badge = $('#sqBadge');
  if (st.running) { box.append(h('p', { class: 'hint' }, 'Running…')); return; }
  if (st.err) { if (badge) badge.textContent = 'error'; box.append(h('div', { class: 'callout warn sq-err' }, h('b', null, 'The query could not run. '), st.err)); return; }
  if (!r) {
    if (badge) badge.textContent = 'query';
    box.append(h('p', { class: 'hint' }, 'Write a query and press Run. It runs here in the browser on the loaded graph with every applied change from the change log. Results list below; IRIs that are instances on the drawing are links — click one to select it, or click a row to highlight its entities and links.'));
    return;
  }
  if (r.type === 'ask') {
    if (badge) badge.textContent = 'ASK';
    box.append(h('div', { class: 'sq-ask ' + (r.value ? 'yes' : 'no') }, r.value ? 'true' : 'false'), h('p', { class: 'hint' }, `The pattern ${r.value ? 'matches' : 'does not match'} the graph · ${r.ms} ms`));
    return;
  }
  const list = r.type === 'select' ? r.rows : r.triples;
  if (badge) badge.textContent = `${list.length} ${r.type === 'select' ? 'row' : 'triple'}${list.length === 1 ? '' : 's'}`;
  const t = sparqlTargets(null);
  const onDrawing = [...t.set].filter(i => S.pos.has(i)).length;
  const expand = h('button', { class: 'btn small', onclick: openSparqlTable, disabled: !list.length, title: 'Open the results as a large table' }, 'Expand');
  const csv = h('button', { class: 'btn small ghost', disabled: !list.length, onclick: () => saveFile('sparql-results.csv', sparqlCsv(r)) }, 'CSV');
  const show = h('button', { class: 'btn small ghost', disabled: !t.set.size, onclick: () => { S.sparqlSel = null; showSparqlInView(null, true, true); renderSparqlResults(); } }, 'Show all in view');
  box.append(h('div', { class: 'sq-meta' },
    h('span', { class: 'grow' }, h('b', null, `${list.length} ${r.type === 'select' ? 'row' : 'triple'}${list.length === 1 ? '' : 's'}`), ` · ${r.ms} ms`,
      t.set.size ? ` · ${onDrawing} of ${t.set.size} entit${t.set.size === 1 ? 'y' : 'ies'} on the drawing` : '', t.groups.length ? ` · ${t.groups.length} link${t.groups.length === 1 ? '' : 's'}` : '',
      r.sameAs ? (r.sameAs.classes ? ` · owl:sameAs: ${r.sameAs.classes} group${r.sameAs.classes === 1 ? '' : 's'}, +${r.sameAs.inferred} inferred triple${r.sameAs.inferred === 1 ? '' : 's'}` : ' · no owl:sameAs links') : ''),
    show, csv, expand));
  if (!list.length) { box.append(h('p', { class: 'hint' }, 'No results.')); return; }
  const wrap = h('div', { class: 'sq-tablewrap' }, sparqlTable(r, { limit: SPARQL_PANEL_ROWS, onRow: sparqlRowClick, selRow: S.sparqlSel }));
  box.append(wrap);
  if (list.length > SPARQL_PANEL_ROWS) box.append(h('p', { class: 'hint' }, `Showing the first ${SPARQL_PANEL_ROWS} of ${list.length}. Expand shows them all.`));
}
function openSparqlTable() {
  const r = sparqlState().res;
  if (!r) return;
  const list = r.type === 'select' ? r.rows : r.triples;
  const filter = h('input', { type: 'search', class: 'sq-filter', placeholder: 'Filter rows…', 'aria-label': 'Filter rows' });
  const host = h('div', { class: 'sq-bigwrap' });
  let sortCol = -1, sortDir = 1;
  const rowsOf = () => {
    let idx = list.map((_, i) => i);
    const q = filter.value.trim().toLowerCase();
    const cellsOf = i => (r.type === 'select' ? r.vars.map(v => list[i][v]) : [list[i].s, list[i].p, list[i].o]);
    if (q) idx = idx.filter(i => cellsOf(i).some(t => t && (sqTermText(t).toLowerCase().includes(q) || t.value.toLowerCase().includes(q))));
    if (sortCol >= 0) idx.sort((a, b) => { const x = cellsOf(a)[sortCol], y = cellsOf(b)[sortCol]; const sx = x ? sqTermText(x) : '', sy = y ? sqTermText(y) : ''; const nx = +sx, ny = +sy; return (isFinite(nx) && isFinite(ny) && sx !== '' && sy !== '' ? nx - ny : sx.localeCompare(sy, undefined, { numeric: true })) * sortDir; });
    return idx;
  };
  const draw = () => {
    host.textContent = '';
    const idx = rowsOf();
    const head = r.type === 'select' ? r.vars.map(v => '?' + v) : ['subject', 'predicate', 'object'];
    const tb = h('tbody');
    for (const i of idx.slice(0, 5000)) {
      const cells = r.type === 'select' ? r.vars.map(v => sqCell(list[i][v])) : [sqCell(list[i].s), sqCell(list[i].p), sqCell(list[i].o)];
      const tr = h('tr', { title: 'Show this row in the view' }, h('td', { class: 'rn' }, String(i + 1)), ...cells);
      tr.addEventListener('click', () => { closeModal(); sparqlRowClick(i); });
      tb.append(tr);
    }
    const ths = head.map((v, c) => { const th = h('th', { class: 'sortable', 'aria-sort': sortCol === c ? (sortDir > 0 ? 'ascending' : 'descending') : 'none' }, v, sortCol === c ? (sortDir > 0 ? ' ▲' : ' ▼') : ''); th.addEventListener('click', () => { if (sortCol === c) sortDir = -sortDir; else { sortCol = c; sortDir = 1; } draw(); }); return th; });
    host.append(h('table', { class: 'sq-table big' }, h('thead', null, h('tr', null, h('th', { class: 'rn' }, '#'), ...ths)), tb));
    cnt.textContent = idx.length === list.length ? `${list.length} rows` : `${idx.length} of ${list.length} rows`;
    if (idx.length > 5000) host.append(h('p', { class: 'hint' }, 'The first 5000 rows are shown — narrow the filter or download the CSV.'));
  };
  const cnt = h('span', { class: 'muted' });
  filter.addEventListener('input', draw);
  const fsBtn = h('button', { class: 'btn small ghost', onclick: () => { const m = $('#modal .modal'); m.classList.toggle('full'); fsBtn.textContent = m.classList.contains('full') ? 'Exit full screen' : 'Full screen'; } }, 'Full screen');
  openModal('SPARQL results', [h('div', { class: 'sq-bigtools' }, filter, cnt, h('span', { class: 'grow' }), fsBtn), host],
    [h('button', { class: 'btn ghost', onclick: () => saveFile('sparql-results.csv', sparqlCsv(r)) }, 'Download CSV'), h('button', { class: 'btn primary', onclick: closeModal }, 'Close')], { wide: true });
  $('#modal .modal').classList.add('sq-modal');
  draw();
}

const openFindings = () => openIssues('findings');
const renderFindings = () => renderIssues();
const STATUS_LABEL = { issue: 'Issue', unsure: 'Unsure', resolved: 'Resolved', ok: 'Correct', open: 'Open' };
function statusChip(st) { return h('span', { class: 'schip ' + st }, STATUS_LABEL[st] || st); }
function commentBlock(note, onSave, placeholder) {
  const wrap = h('div', { class: 'ic-cwrap' });
  const show = () => {
    wrap.textContent = '';
    wrap.append(h('div', { class: 'ic-comment' + (note ? '' : ' is-empty') }, note || 'No comment yet'),
      h('button', { class: 'linkbtn', style: { fontSize: '12px' }, onclick: edit }, note ? 'Edit comment' : 'Add comment'));
  };
  const edit = () => {
    wrap.textContent = '';
    const ta = h('textarea', { class: 'note', placeholder: placeholder || 'What is wrong, and what should it be?', 'aria-label': 'Comment' });
    ta.value = note || '';
    const save = () => { note = ta.value.trim(); onSave(note); };
    wrap.append(ta, h('div', { class: 'btnrow' }, h('button', { class: 'btn small primary', onclick: save }, 'Save'), h('button', { class: 'btn small ghost', onclick: show }, 'Cancel')));
    setTimeout(() => ta.focus(), 0);
  };
  show();
  return wrap;
}
function setFlag(it, patch, label) {
  const store = it.kind === 'node' ? S.qa.nodes : S.qa.edges;
  const snap = snapshot();
  const rec = store[it.key] || {};
  Object.assign(rec, patch, { at: new Date().toISOString() });
  if (!rec.status && !rec.note) delete store[it.key]; else store[it.key] = rec;
  commit(label, snap);
  persist(); refreshNodeClasses(); applyFocus(); updateQaSummary(); renderIssues();
  refreshInspector();
}
function flagName(it) { return it.kind === 'node' ? S.G.nodes.get(it.key).local : `${S.G.nodes.get(it.a).local} – ${S.G.nodes.get(it.b).local}`; }
function showFlag(it) {
  closeIssuesOnPhone();
  if (it.kind === 'node') { select(it.key); return; }
  const pa = S.anchors.get(it.a), pb = S.anchors.get(it.b);
  const pts = [pa, pb].filter((p, i) => p && placed(i ? it.b : it.a));
  if (pts.length) centerOn(pts.map(p => ({ x: p.x, y: p.y })));
  const g = S.groups.find(x => x.qaKey === it.key);
  setIssueFocus(`${flagName(it)}`, () => ({ set: new Set([it.a, it.b]), edges: new Set(S.groups.filter(x => x.qaKey === it.key)) }), { src: 'issues' });
  if (g) { const st = $('#stage').getBoundingClientRect(); setTimeout(() => openEdgePop(g, st.left + st.width / 2, st.top + st.height / 2), 280); }
}
function setRule(r, patch, label) {
  const snap = snapshot();
  Object.assign(r, patch, { at: new Date().toISOString() });
  commit(label, snap);
  persist(); renderIssues();
}
function deleteRule(r) {
  const snap = snapshot();
  S.rules = S.rules.filter(x => x.id !== r.id);
  if (S.issueFocus && S.issueFocus.rule === r.id) clearIssueFocus();
  commit(`delete ${r.kind}`, snap);
  persist(); renderIssues();
}
function showRule(r) {
  const v = ruleViolations(r);
  if (!v.length) { toast('Nothing breaks this rule right now'); return; }
  const set = new Set(), edges = new Set(v);
  for (const e of v) { set.add(e.s); set.add(e.o); }
  const groups = new Set(S.groups.filter(g => g.edges.some(e => edges.has(e))));
  if (!groups.size) toast('The links breaking this rule are hidden — switch their category on or use Full graph');
  closeIssuesOnPhone();
  setIssueFocus('Rule: ' + ruleText(r), () => {
    const vv = new Set(ruleViolations(r)), st = new Set();
    for (const e of vv) { st.add(e.s); st.add(e.o); }
    return { set: st, edges: new Set(S.groups.filter(g => g.edges.some(e => vv.has(e)))) };
  }, { rule: r.id, src: 'issues' });
  const pts = [...set].filter(placed).map(i => S.anchors.get(i));
  if (pts.length) centerOn(pts);
}
function proposeRuleRemovals(r) {
  const v = ruleViolations(r);
  if (!v.length) { toast('Nothing breaks this rule'); return; }
  const snap = snapshot();
  const run = { id: 'q' + Date.now().toString(36), at: new Date().toISOString(), kind: 'rule', model: 'Rule check (no Claude)', note: '', areas: [{ id: 'R', label: ruleText(r) }], summaries: { R: `${v.length} triple${v.length === 1 ? '' : 's'} break the rule; removing them is proposed. Use Resolve with Claude to re-point them instead.` } };
  for (const e of v) {
    S.findingSeq = (S.findingSeq || 0) + 1;
    S.findings.push({ id: `f${S.findingSeq}_${run.id}`, seq: S.findingSeq, run: run.id, area: 'R', rect: null, type: 'wrong_link', status: 'open', conf: null,
      evidence: `Breaks rule: ${ruleText(r)}`, from: S.G.nodes.get(e.s).local, fromIri: e.s, to: S.G.nodes.get(e.o).local, toIri: e.o, predicate: qn(e.p), predIri: e.p, issueRef: { kind: 'rule', key: r.id } });
  }
  S.recheckRuns.push(run);
  commit(`propose removing ${v.length} triples`, snap);
  persist(); renderIssues(); frame();
  const el = $('#issues [data-sec="findings"]'); if (el) el.scrollIntoView({ block: 'start' });
}
function chipPicker(values, options, onChange) {
  const list = h('div', { class: 'chips', style: { margin: '6px 0' } });
  const sel = h('select', { 'aria-label': 'Add class or kind' }, h('option', { value: '' }, 'Add class or kind…'),
    h('optgroup', { label: 'Kinds' }, KIND_OPTS.map(([v, l]) => h('option', { value: v }, l))),
    h('optgroup', { label: 'Classes in this graph' }, options.map(([v, l]) => h('option', { value: v }, l))));
  const draw = () => {
    list.textContent = '';
    if (!values.length) list.append(h('span', { class: 'muted', style: { fontSize: '12px' } }, 'anything'));
    values.forEach(v => list.append(h('span', { class: 'chip on' }, h('span', null, termLabel(v)),
      h('button', { class: 'chip-x', 'aria-label': 'Remove ' + termLabel(v), onclick: () => { values.splice(values.indexOf(v), 1); draw(); onChange(); } }, '×'))));
  };
  sel.addEventListener('change', () => { if (sel.value && !values.includes(sel.value)) { values.push(sel.value); draw(); onChange(); } sel.value = ''; });
  draw();
  return h('div', null, list, sel);
}
function openRuleModal(existing) {
  if (!S.G) return;
  const G = S.G;
  const predCount = new Map();
  for (const e of G.edges) predCount.set(e.p, (predCount.get(e.p) || 0) + 1);
  const clsCount = new Map();
  for (const n of G.nodes.values()) for (const t of n.types) clsCount.set(t, (clsCount.get(t) || 0) + 1);
  const clsOpts = [...clsCount].sort((a, b) => qn(a[0]).localeCompare(qn(b[0]))).map(([t, c]) => [t, `${qn(t)} (${c})`]);
  const r = existing ? JSON.parse(JSON.stringify(existing)) : { kind: 'rule', predicate: [...predCount].sort((a, b) => b[1] - a[1])[0]?.[0] || '', domain: [], range: [], comment: '' };
  const psel = h('select', { 'aria-label': 'Predicate' }, [...predCount].sort((a, b) => qn(a[0]).localeCompare(qn(b[0]))).map(([p, c]) => h('option', { value: p }, `${qn(p)} (${c})`)));
  psel.value = r.predicate;
  const count = h('div', { class: 'callout' });
  const upd = () => { r.predicate = psel.value; const v = ruleViolations(r); count.textContent = `${v.length} of ${predCount.get(r.predicate) || 0} ${qn(r.predicate)} triples break this rule.`; };
  psel.addEventListener('change', upd);
  const com = h('textarea', { class: 'note', placeholder: 'Optional: why, or how the links should be made instead (Claude reads this when resolving)' });
  com.value = r.comment || '';
  const save = h('button', { class: 'btn primary' }, existing ? 'Save rule' : 'Add rule');
  save.addEventListener('click', () => {
    r.predicate = psel.value; r.comment = com.value.trim();
    const snap = snapshot();
    if (existing) Object.assign(existing, { predicate: r.predicate, domain: r.domain, range: r.range, comment: r.comment, at: new Date().toISOString() });
    else S.rules.push({ id: 'u' + Date.now().toString(36), kind: 'rule', predicate: r.predicate, domain: r.domain, range: r.range, comment: r.comment, status: 'open', at: new Date().toISOString() });
    commit(existing ? 'edit rule' : 'add rule', snap);
    persist(); closeModal(); openIssues('rules');
  });
  openModal(existing ? 'Edit rule' : 'Add a rule for a predicate', [
    h('p', null, 'Say which kinds of instances a predicate may connect, instead of flagging every wrong link one by one. Triples that break the rule are counted and highlighted at once. "Propose removals" or "Resolve with Claude" turns them into fixes.'),
    h('div', { class: 'row' }, h('label', { class: 'muted', style: { width: '86px', flex: 'none' } }, 'Predicate'), psel),
    h('h3', null, 'Subject must be (any of)'), chipPicker(r.domain, clsOpts, upd),
    h('h3', null, 'Object must be (any of)'), chipPicker(r.range, clsOpts, upd),
    h('h3', null, 'Comment'), com, count,
  ], [h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'), save]);
  upd();
}
function openNoteModal(existing) {
  const ta = h('textarea', { class: 'note', style: { minHeight: '120px' }, placeholder: 'A general instruction about the whole graph, e.g. "Rooms must never be fed by ducts directly — only terminals feed rooms."' });
  ta.value = existing ? existing.text : '';
  const save = h('button', { class: 'btn primary' }, existing ? 'Save note' : 'Add note');
  save.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const snap = snapshot();
    if (existing) Object.assign(existing, { text, at: new Date().toISOString() });
    else S.rules.push({ id: 'u' + Date.now().toString(36), kind: 'note', text, status: 'open', at: new Date().toISOString() });
    commit(existing ? 'edit note' : 'add note', snap);
    persist(); closeModal(); openIssues('rules');
  });
  openModal(existing ? 'Edit general note' : 'Add a general note', [h('p', null, 'Notes describe something to change across the graph. Claude reads them in Resolve with Claude and proposes the matching fixes for you to accept.'), ta],
    [h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'), save]);
  setTimeout(() => ta.focus(), 0);
}
/* ---- cards that collapse to their header; the chosen one opens and its entities light up on the drawing ---- */
function issueCard(key, cls, headNodes, bodyNodes) {
  const open = S.issueSel === key;
  const head = h('button', { class: 'ic-head', 'aria-expanded': open ? 'true' : 'false', title: open ? 'Close this card' : 'Open and highlight on the drawing' },
    h('span', { class: 'ic-headin' }, headNodes), h('span', { class: 'ic-caret', 'aria-hidden': 'true' }, caretSvg()));
  head.addEventListener('click', () => toggleIssueCard(key));
  return h('div', { class: `icard ${cls || ''}${open ? ' expanded sel' : ''}`, 'data-key': key }, head, open ? h('div', { class: 'ic-body' }, bodyNodes) : null);
}
function toggleIssueCard(key) {
  if (S.issueSel === key) {
    S.issueSel = null; S.selFinding = null; S.selArea = null;
    if (S.issueFocus && S.issueFocus.card) { S.issueFocus = null; applyFocus(); renderFocusPill(); }
    renderIssues(); frame();
    return;
  }
  S.issueSel = key;
  focusIssueCard(key);
  renderIssues();
}
function openIssueCard(key) {
  openIssues();
  S.issueSel = key;
  focusIssueCard(key);
  renderIssues();
  setTimeout(() => { const el = $(`#issues [data-key="${CSS.escape(key)}"]`); if (el) el.scrollIntoView({ block: 'center' }); }, 30);
}
function cardTargets(key) {
  const G = S.G, i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
  const set = new Set(), edges = new Set(), pts = [];
  const node = iri => { if (iri && G.nodes.has(iri)) { set.add(iri); const p = S.pos.get(iri); if (p) pts.push(p); } };
  const link = (a, b) => { for (const g of S.groups) if ((g.a === a && g.b === b) || (g.a === b && g.b === a)) edges.add(g.key); };
  let label = '';
  if (kind === 'n') { node(id); label = G.nodes.has(id) ? G.nodes.get(id).local : id; }
  else if (kind === 'e') { const [, a, b] = id.split('|'); node(a); node(b); for (const g of S.groups) if (g.qaKey === id) edges.add(g.key); label = `${nmOf(a)} – ${nmOf(b)}`; }
  else if (kind === 'rule') { const r = S.rules.find(x => x.id === id); if (r && r.kind === 'rule') { for (const e of ruleViolations(r)) { node(e.s); node(e.o); edges.add(groupKeyOf(e).key); } label = 'Rule: ' + ruleText(r); } }
  else if (kind === 'f') {
    const f = S.findings.find(x => x.id === id);
    if (f) {
      for (const iri of [f.iri, f.fromIri, f.toIri, f.newFromIri, f.newToIri]) node(iri);
      if (f.fromIri && f.toIri) link(f.fromIri, f.toIri);
      if ((f.newFromIri || f.fromIri) && (f.newToIri || f.toIri)) link(f.newFromIri || f.fromIri, f.newToIri || f.toIri);
      for (const p of findingPoints(f)) pts.push(p);
      label = `${(FT[f.type] || FT.other).label}: ${findingTitle(f)}`;
    }
  } else if (kind === 'c') { const c = S.changes.find(x => x.id === id); if (c) { for (const iri of changeNodes(c)) node(iri); for (const t of [...c.del, ...c.ins]) if (t.ot === 'iri') link(t.s, t.o); label = `${c.id} · ${CHANGE_LABEL[c.type] || c.type}`; } }
  return { set, edges, pts, label };
}
function focusIssueCard(key) {
  const t = cardTargets(key);
  S.selFinding = key.startsWith('f:') ? key.slice(2) : null; S.selArea = null;
  if (t.set.size || t.edges.size) setIssueFocus(t.label, () => { const x = cardTargets(key); return { set: x.set, edges: x.edges }; }, { strong: true, src: 'issues', card: key });
  else if (S.issueFocus && S.issueFocus.card) { S.issueFocus = null; applyFocus(); renderFocusPill(); }
  if (t.pts.length) { closeIssuesOnPhone(); animateTo(fitTarget(t.pts, { maxS: Math.max(S.view.s, S.fitS * 4) })); }
  frame();
}
function findingCard(f) {
  const meta = FT[f.type] || FT.other;
  const graphFix = GRAPH_TYPES.has(f.type);
  const statusText = f.status === 'accepted' ? (graphFix ? 'Accepted · not applied yet' : 'Accepted') : f.status === 'applied' ? `Applied · ${f.changeId || ''}` : f.status === 'dismissed' ? 'Dismissed' : '';
  const head = [h('span', { class: 'fchip', style: { color: meta.color, borderColor: meta.color } }, meta.label),
    h('span', { class: 'ic-name mono' }, findingTitle(f)),
    statusText ? h('span', { class: 'fstat' + (f.status === 'accepted' && graphFix ? ' pending' : '') }, statusText) : f.conf != null ? h('span', { class: 'fstat mono' }, `${Math.round(f.conf * 100)}%`) : null];
  const btns = h('div', { class: 'btnrow' });
  if (f.status === 'open') btns.append(h('button', { class: 'btn small primary', onclick: () => acceptFinding(f) }, f.issueRef ? 'Accept fix' : meta.accept), h('button', { class: 'btn small ghost', onclick: () => setFindingStatus(f, 'dismissed') }, 'Dismiss'));
  else if (f.status === 'applied') btns.append(h('button', { class: 'btn small ghost', onclick: () => scrollToChange(f.changeId) }, 'In change log'));
  else {
    if (f.status === 'accepted' && graphFix) btns.append(h('button', { class: 'btn small primary apply', onclick: () => applyFindings([f]), title: 'Put this fix into effect: the graph on screen changes and the change is logged' }, 'Apply to graph'));
    btns.append(h('button', { class: 'btn small ghost', onclick: () => setFindingStatus(f, 'open') }, 'Reopen'));
  }
  const body = [
    h('div', { class: 'fnd-title' }, findingTitle(f)),
    f.conf != null ? h('div', { class: 'muted', style: { fontSize: '11px' } }, `Confidence ${Math.round(f.conf * 100)} %`) : null,
    f.evidence ? h('div', { class: 'fnd-ev' }, f.evidence) : null,
    f.type === 'missing_instance' && f.links && f.links.length ? h('div', { class: 'fnd-ev mono' }, f.links.map(l => `${l.from} ${l.predicate} ${l.to}`).join('\n')) : null,
    btns];
  return issueCard('f:' + f.id, `fnd ${f.status}`, head, body);
}
function changeCard(c) {
  const rev = c.status === 'reverted';
  const lines = h('div', { class: 'chg-lines' },
    c.del.slice(0, 40).map(t => h('div', { class: 'chg-del' }, '− ' + tripleText(t))),
    c.ins.slice(0, 40).map(t => h('div', { class: 'chg-ins' }, '+ ' + tripleText(t))),
    c.del.length + c.ins.length > 80 ? h('div', { class: 'muted' }, `… ${c.del.length + c.ins.length} triples in all`) : null,
    !c.del.length && !c.ins.length ? h('div', { class: 'muted' }, 'No triple changes') : null);
  const meta = [];
  if (c.why) meta.push(h('div', null, h('span', { class: 'muted' }, 'Why: '), c.why));
  if (c.comment) meta.push(h('div', null, h('span', { class: 'muted' }, 'Reviewer: '), c.comment));
  if (c.notes && c.notes.length) meta.push(h('div', { class: 'muted' }, 'Note: ' + c.notes.join('; ')));
  meta.push(h('div', { class: 'muted' }, `${c.origin ? c.origin + ' · ' : ''}applied ${new Date(c.at).toLocaleString()}${rev ? ' · reverted ' + new Date(c.revertedAt).toLocaleString() : ''}`));
  const btns = h('div', { class: 'btnrow' });
  if (!rev) btns.append(h('button', { class: 'btn small ghost', onclick: () => revertChange(c), title: 'Take this change out of the graph (kept in the log as reverted)' }, 'Revert'));
  const card = issueCard('c:' + c.id, 'chg' + (rev ? ' reverted' : ''),
    [h('span', { class: 'fchip', style: { color: CHANGE_COLOR[c.type] || '#64748b', borderColor: CHANGE_COLOR[c.type] || '#64748b' } }, CHANGE_LABEL[c.type] || c.type),
      h('span', { class: 'ic-name mono' }, c.title), h('span', { class: 'fstat mono' }, c.id + (rev ? ' · reverted' : ''))],
    [lines, h('div', { class: 'chg-meta' }, meta), btns]);
  card.dataset.change = c.id;
  return card;
}
function scrollToChange(id) {
  S.issueSecOpen.changes = true;
  openIssueCard('c:' + id);
  setTimeout(() => { const el = $(`#issues [data-change="${id}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); } }, 40);
}
function flagCard(it) {
  const G = S.G, r = it.rec;
  const key = it.kind === 'node' ? 'n:' + it.key : 'e:' + it.key;
  const title = it.kind === 'node' ? linkTo(it.key) : h('span', null, linkTo(it.a), ' – ', linkTo(it.b));
  const sub = it.kind === 'node'
    ? displayTypes(G.nodes.get(it.key)).slice(0, 3).map(qn).join(', ')
    : edgeTriples(it.cat, it.a, it.b).map(e => `${G.nodes.get(e.s).local} ${qn(e.p)} ${G.nodes.get(e.o).local}`).join('\n') || 'This link is no longer in the graph (see the change log).';
  const btns = h('div', { class: 'btnrow' });
  if (it.kind === 'node') btns.append(h('button', { class: 'btn small', onclick: () => select(it.key) }, 'Details'));
  else { const e = edgeTriples(it.cat, it.a, it.b)[0]; if (e) btns.append(h('button', { class: 'btn small', onclick: () => openEdgePopFromInspector(e) }, 'Link card')); }
  if (r.status !== 'resolved') {
    btns.append(h('button', { class: 'btn small ghost', onclick: () => setFlag(it, { status: r.status === 'issue' ? 'unsure' : 'issue' }, `mark ${flagName(it)} ${r.status === 'issue' ? 'unsure' : 'issue'}`) }, r.status === 'issue' ? 'Make unsure' : 'Make issue'),
      h('button', { class: 'btn small ghost', onclick: () => setFlag(it, { status: 'resolved' }, `resolve ${flagName(it)}`) }, 'Resolved'),
      h('button', { class: 'btn small ghost', title: 'Not an issue after all: mark as correct', onclick: () => setFlag(it, { status: 'ok' }, `mark ${flagName(it)} correct`) }, 'Not an issue'));
  } else btns.append(h('button', { class: 'btn small ghost', onclick: () => setFlag(it, { status: 'issue' }, `reopen ${flagName(it)}`) }, 'Reopen'));
  return issueCard(key, r.status,
    [statusChip(r.status), h('span', { class: 'ic-name' }, flagName(it)), h('span', { class: 'fstat' }, it.kind === 'node' ? KIND_LABEL[G.nodes.get(it.key).kind] : CAT[it.cat].name + ' link'), r.note ? null : h('span', { class: 'fstat warn', title: 'No comment yet' }, '•')],
    [h('div', { class: 'ic-title' }, title),
      sub ? h('div', { class: 'fnd-ev mono', style: { fontSize: '11px', whiteSpace: 'pre-line' } }, sub) : null,
      r.check ? h('div', { class: 'hint', style: { margin: '3px 0 0' } }, `From the report “${r.check}”`) : null,
      commentBlock(r.note || '', note => setFlag(it, { note }, `comment on ${flagName(it)}`)),
      btns]);
}
function ruleCard(r) {
  const v = r.kind === 'rule' ? ruleViolations(r) : null;
  const btns = h('div', { class: 'btnrow' });
  if (r.kind === 'rule') btns.append(h('button', { class: 'btn small ghost', onclick: () => proposeRuleRemovals(r), disabled: !v.length, title: 'Propose removing every triple that breaks the rule (no Claude needed)' }, 'Propose removals'));
  btns.append(h('button', { class: 'btn small ghost', onclick: () => (r.kind === 'rule' ? openRuleModal(r) : openNoteModal(r)) }, 'Edit'),
    r.status === 'resolved' ? h('button', { class: 'btn small ghost', onclick: () => setRule(r, { status: 'open' }, `reopen ${r.kind}`) }, 'Reopen') : h('button', { class: 'btn small ghost', onclick: () => setRule(r, { status: 'resolved' }, `resolve ${r.kind}`) }, 'Resolved'),
    h('button', { class: 'btn small ghost danger', onclick: () => deleteRule(r) }, 'Delete'));
  return issueCard('rule:' + r.id, r.status === 'resolved' ? 'resolved' : '',
    [h('span', { class: 'schip ' + r.kind }, r.kind === 'rule' ? 'Rule' : 'Note'), h('span', { class: 'ic-name' }, ruleText(r)),
      v ? h('span', { class: 'fstat' }, v.length ? `${v.length} break it` : 'no violations') : r.status === 'resolved' ? h('span', { class: 'fstat' }, 'Resolved') : null],
    [h('div', { class: 'ic-title', style: { fontWeight: r.kind === 'note' ? 400 : 600 } }, ruleText(r)),
      v && v.length ? h('div', { class: 'fnd-ev mono', style: { fontSize: '11px', whiteSpace: 'pre-line' } }, v.slice(0, 6).map(e => `${S.G.nodes.get(e.s).local} ${qn(e.p)} ${S.G.nodes.get(e.o).local}`).join('\n') + (v.length > 6 ? `\n… ${v.length - 6} more` : '')) : null,
      r.kind === 'rule' ? commentBlock(r.comment || '', comment => setRule(r, { comment }, 'comment on rule'), 'Why, or how it should be fixed (Claude reads this)') : null,
      btns]);
}
/* sections fold away; their state is remembered in this browser */
function issueSection(id, title, count, tools, content) {
  const open = S.issueSecOpen[id] !== false;
  const head = h('button', { class: 'isec-head', 'aria-expanded': open ? 'true' : 'false' }, h('span', { class: 'ic-caret', 'aria-hidden': 'true' }, caretSvg()), h('span', { class: 'grow' }, title), count ? h('span', { class: 'cnt-muted' }, count) : null);
  head.addEventListener('click', () => { S.issueSecOpen[id] = !open; LS.set('kgov:issSec', S.issueSecOpen); renderIssues(); });
  return h('section', { class: 'isec' + (open ? ' open' : ''), 'data-sec': id }, head, open ? h('div', { class: 'isec-body' }, tools, content) : null);
}
function renderIssues() {
  updateFindingsSummary();
  const box = $('#issues');
  if (box.hidden) return;
  const old = box.querySelector('.ibody'), scroll = old ? old.scrollTop : 0;
  box.textContent = '';
  const all = !!S.issuesShowAll;
  const n = openIssueCount();
  const header = h('header', null, h('h2', null, 'Issues'), h('span', { class: 'badge' }, `${n} open`),
    h('button', { class: 'x-btn', 'aria-label': 'Close issues', onclick: closeIssues }, '✕'));
  const segOpen = h('button', { class: all ? '' : 'on', onclick: () => { S.issuesShowAll = false; renderIssues(); } }, 'Open');
  const segAll = h('button', { class: all ? 'on' : '', onclick: () => { S.issuesShowAll = true; renderIssues(); } }, 'All');
  const showCb = h('input', { type: 'checkbox', 'aria-label': 'Show proposals on the drawing' });
  showCb.checked = S.settings.showFindings !== false;
  showCb.addEventListener('change', () => { S.settings.showFindings = showCb.checked; saveSettings(); frame(); });
  const tools = h('div', { class: 'itools' },
    h('div', { class: 'qa-seg mini' }, segOpen, segAll),
    h('label', { class: 'check', style: { minHeight: 0, fontSize: '12px' } }, showCb, 'Proposals on drawing'),
    h('button', { class: 'btn small primary', style: { marginLeft: 'auto' }, onclick: openResolveModal }, 'Resolve with Claude'));
  const body = h('div', { class: 'ibody' });
  if (!S.G) body.append(h('p', { class: 'hint' }, 'Open a graph first.'));
  else {
    const pend = pendingApply();
    if (pend.length) body.append(h('div', { class: 'applybar' },
      h('div', { class: 'grow' }, h('b', null, `${pend.length} accepted fix${pend.length === 1 ? '' : 'es'}`), ' not in the graph yet. Applying changes the graph on screen and records each change in the change log.'),
      h('button', { class: 'btn small primary', onclick: () => applyFindings(pendingApply()) }, `Apply ${pend.length} to graph`)));
    body.append(h('p', { class: 'hint', style: { margin: '10px 0 0' } }, 'Click a card to open it and highlight what it is about on the drawing; click it again (or the empty drawing) to let go.'));
    /* rules & general notes */
    const rules = S.rules.filter(r => all || r.status !== 'resolved');
    body.append(issueSection('rules', 'Rules & general notes', rules.length,
      h('div', { class: 'btnrow', style: { marginTop: '2px' } }, h('button', { class: 'btn small', onclick: () => openRuleModal() }, '+ Rule for a predicate'), h('button', { class: 'btn small', onclick: () => openNoteModal() }, '+ General note')),
      rules.length ? rules.map(ruleCard) : h('p', { class: 'hint' }, 'Rules fix many links at once: "fso:suppliesFluidTo should only go from components to components". Notes are free-text instructions for Claude.')));
    /* flags */
    const flags = flagItems(all);
    body.append(issueSection('flags', 'Flagged instances & links', flags.length, null,
      flags.length ? flags.map(flagCard) : h('p', { class: 'hint' }, 'Flag an instance or a link as Issue or Unsure from its details (click it on the drawing), or decide for many at once in Review & checks; it shows up here with your comment.')));
    /* Claude's proposals and re-check findings */
    const shown = f => all || (f.status !== 'dismissed' && f.status !== 'applied');
    const fx = [];
    for (const run of [...S.recheckRuns].reverse()) {
      const runAll = S.findings.filter(f => f.run === run.id);
      const fs = runAll.filter(shown);
      if (!all && !fs.length && (runAll.length || (run.kind && run.kind !== 'recheck'))) continue;
      const kindLabel = run.kind === 'resolve' ? 'Resolve with Claude' : run.kind === 'rule' ? 'Rule check' : 'Re-check areas';
      fx.push(h('div', { class: 'run-head' }, h('b', null, kindLabel), ` · ${new Date(run.at).toLocaleString()} · ${run.model}`, run.note ? h('div', { class: 'hint', style: { margin: '2px 0 0' } }, `“${run.note}”`) : null));
      for (const a of run.areas) {
        const af = fs.filter(f => f.area === a.id).sort((x, y) => x.seq - y.seq);
        const open = af.filter(f => f.status === 'open');
        if (!af.length && !all && (run.kind === 'resolve' || runAll.some(f => f.area === a.id))) continue;
        fx.push(h('div', { class: 'area-head' },
          h('span', { class: 'apill' }, a.id),
          h('span', { class: 'grow' }, a.label ? h('b', { style: { display: 'block', fontWeight: 600 } }, a.label) : null, run.summaries[a.id] || (af.length ? '' : 'No differences reported.')),
          a.s ? h('button', { class: 'linkbtn', onclick: () => { closeIssuesOnPhone(); S.selFinding = null; S.selArea = { ...a }; animateTo(fitTarget([{ x: a.x - areaW(a) / 2, y: a.y - areaH(a) / 2 }, { x: a.x + areaW(a) / 2, y: a.y + areaH(a) / 2 }])); frame(); } }, 'Show') : null,
          open.length > 1 ? h('button', { class: 'linkbtn', onclick: () => acceptAll(open) }, `Accept all ${open.length}`) : null));
        for (const f of af) fx.push(findingCard(f));
      }
    }
    if (!fx.length) fx.push(h('p', { class: 'hint' }, S.findings.length ? 'Nothing open. Switch to All to see dismissed and applied proposals.' : 'Claude\'s proposals appear here after Resolve with Claude or Re-check areas. Accept or dismiss each one, then apply the accepted ones to the graph.'));
    body.append(issueSection('findings', 'Proposed fixes & re-check findings', S.findings.filter(f => f.status === 'open').length, null, fx));
    /* change log */
    const chg = S.changes.filter(c => all || c.status !== 'reverted');
    const nAct = activeChanges().length;
    body.append(issueSection('changes', 'Change log', nAct ? `${nAct} in the graph` : '',
      S.changes.length ? h('div', { class: 'btnrow', style: { marginTop: '2px' } },
        h('button', { class: 'btn small', onclick: exportRefined, disabled: !nAct }, 'Refined graph (.ttl)'),
        h('button', { class: 'btn small', onclick: openCorrections, disabled: !nAct }, 'SPARQL Update…'),
        h('button', { class: 'btn small ghost', onclick: exportChangeLog }, 'Log (.csv)')) : null,
      chg.length ? [...chg].reverse().map(changeCard) : h('p', { class: 'hint' }, S.changes.length ? 'All changes were reverted. Switch to All to see them.' : 'Every fix you apply is recorded here — what was removed and added, why, and who proposed it. Revert any entry; export the refined graph, a SPARQL Update or the log itself.')));
  }
  box.append(header, tools, body);
  body.scrollTop = scroll;
}

/* ---- Resolve with Claude: every open flag, rule and note in ONE call ---- */
function resolveItems() {
  const unit = symbolUnit(), items = [];
  for (const it of flagItems(false)) {
    let rect = null;
    if (it.kind === 'node') { if (placed(it.key)) { const a = S.anchors.get(it.key); rect = { x: a.x, y: a.y, s: Math.round(unit * 4) }; } }
    else {
      const A = placed(it.a) ? S.anchors.get(it.a) : null, B = placed(it.b) ? S.anchors.get(it.b) : null;
      if (A && B) { const d = Math.hypot(A.x - B.x, A.y - B.y); rect = { x: Math.round((A.x + B.x) / 2), y: Math.round((A.y + B.y) / 2), s: Math.round(clamp(d * 1.3, unit * 4, unit * 10)) }; }
      else if (A || B) { const P = A || B; rect = { x: P.x, y: P.y, s: Math.round(unit * 4) }; }
    }
    items.push({ ...it, rect });
  }
  for (const r of S.rules) if (r.status !== 'resolved') items.push({ kind: r.kind, key: r.id, rule: r, rect: null });
  items.forEach((it, i) => { it.id = 'I' + (i + 1); if (it.rect) it.rect.id = it.id; });
  return items;
}
function itemLabel(it) {
  if (it.kind === 'node') return `Instance ${S.G.nodes.get(it.key).local}`;
  if (it.kind === 'edge') return `Link ${S.G.nodes.get(it.a).local} – ${S.G.nodes.get(it.b).local}`;
  return it.kind === 'rule' ? `Rule: ${ruleText(it.rule)}` : `Note: ${it.rule.text.slice(0, 90)}`;
}
function predicateUsage() {
  const G = S.G, m = new Map();
  for (const e of G.edges) {
    let r = m.get(e.p); if (!r) m.set(e.p, r = { n: 0, pairs: new Map() });
    r.n++; const k = G.nodes.get(e.s).kind + ' → ' + G.nodes.get(e.o).kind; r.pairs.set(k, (r.pairs.get(k) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([p, r]) => `- ${qn(p)}: ${r.n} (${[...r.pairs].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k} ${c}`).join(', ')})`);
}
function buildResolvePrompt(items, infos, opts) {
  const G = S.G, W = drawW(), H = drawH(), L = [];
  const idOf = iri => opts.ids.rev.get(iri) || G.nodes.get(iri).local;
  L.push('You are helping a reviewer correct a knowledge graph (RDF using BOT, FSO and Brick plus local classes) that was extracted automatically from an engineering drawing (a P&ID / flow schematic). The reviewer has flagged instances and links, and may have written rules and general notes. For every item below, propose the concrete corrections to the graph that resolve it. Follow the reviewer\'s comments and check them against the drawing.');
  L.push('', `The full drawing is ${W} × ${H} pixels; every coordinate is in full-drawing pixels. Images, in order:`);
  opts.labels.forEach((t, i) => L.push(`- Image ${i + 1}: ${t}`));
  L.push(...refNoteLines(opts.refSent || 0));
  L.push('In the close-ups the magenta rounded square marks the flagged place. Dashed magenta grid lines are labelled with full-drawing coordinates. Each numbered tag has a leader ending in a small cross: the cross is where the graph places the instance with that tag number.');
  if (opts.note) L.push('', `The reviewer adds for this request: "${opts.note}"`);
  L.push('', 'Graph vocabulary:', ...vocabularyLines());
  L.push('How the predicates are used now (count; subject kind → object kind):', ...predicateUsage());
  for (const it of items) {
    L.push('');
    if (it.kind === 'node') {
      const n = G.nodes.get(it.key), a = S.anchors.get(it.key);
      L.push(`=== ${it.id} · flagged instance · ${STATUS_LABEL[it.rec.status]} ===`);
      L.push(`Instance: ${idOf(it.key)} | ${[...n.types].map(qn).join(', ') || 'no class'}${n.label ? ' | "' + n.label + '"' : ''}${a && placed(it.key) ? ` | at ${a.x},${a.y}` : ' | not placed on the drawing'}`);
      const trip = [...n.out, ...n.in].slice(0, 30).map(idx => { const e = G.edges[idx]; return `  ${idOf(e.s)} ${qn(e.p)} ${idOf(e.o)}`; });
      if (trip.length) L.push('Its links:', ...trip);
    } else if (it.kind === 'edge') {
      L.push(`=== ${it.id} · flagged link · ${STATUS_LABEL[it.rec.status]} ===`);
      L.push(`The ${CAT[it.cat].name.toLowerCase()} line between ${idOf(it.a)} and ${idOf(it.b)} stands for these triples:`);
      for (const e of edgeTriples(it.cat, it.a, it.b)) L.push(`  ${idOf(e.s)} ${qn(e.p)} ${idOf(e.o)}`);
    } else if (it.kind === 'rule') {
      const v = ruleViolations(it.rule);
      L.push(`=== ${it.id} · rule ===`, `Rule: ${ruleText(it.rule)} (as asserted: subject → object).`);
      if (it.rule.comment) L.push(`Reviewer comment: "${it.rule.comment}"`);
      L.push(v.length ? `${v.length} triple${v.length === 1 ? '' : 's'} break the rule${v.length > 60 ? ' (first 60 shown)' : ''}:` : 'No triples break the rule right now; check whether related links should change.');
      for (const e of v.slice(0, 60)) L.push(`  ${idOf(e.s)} ${qn(e.p)} ${idOf(e.o)}   [${displayTypes(G.nodes.get(e.s))[0] ? qn(displayTypes(G.nodes.get(e.s))[0]) : '?'} → ${displayTypes(G.nodes.get(e.o))[0] ? qn(displayTypes(G.nodes.get(e.o))[0]) : '?'}]`);
      continue;
    } else {
      L.push(`=== ${it.id} · general note (applies to the whole graph) ===`, `"${it.rule.text}"`);
      continue;
    }
    if (it.rec.check) L.push(`Found by the automatic check "${it.rec.check}"; the reviewer decided it for a group of similar items.`);
    L.push(`Reviewer comment: ${it.rec.note ? '"' + it.rec.note + '"' : '(none — decide from the drawing)'}`);
    const info = infos.get(it.id);
    if (info) {
      L.push(`Close-up: image ${info.img}. Tagged instances (tag | id | classes | label | x,y | location / system | context):`, ...info.inf.instLines);
      if (info.inf.links.length) L.push('Links of the instances inside the square:', ...info.inf.links);
    }
  }
  L.push('', 'How to answer:',
    '- For each item, propose the smallest set of corrections that resolves it and that the drawing supports. Follow the reviewer\'s comment.',
    '- For a rule or a general note that affects many triples, give one finding per affected triple (at most 80 per item). Use replace_link when a triple should point to a different instance or use a different predicate; use wrong_link when it should simply be removed.',
    '- If an item cannot be resolved from the drawing or the comment, explain why in its summary and give no findings. Do not invent components that are not drawn.');
  L.push('', 'Reply with only this JSON, no prose:');
  L.push('{"items":[{"item":"I1","summary":"<what you propose, one or two sentences>","findings":[{"type":"<type>", ...fields..., "conf":<0..1>, "evidence":"<why, max 25 words>"}]}]}');
  L.push('Fields per type:',
    '- replace_link: "from","predicate","to" exactly as asserted, plus the parts that change: "newFrom" / "newPredicate" / "newTo"',
    '- wrong_link and wrong_direction: "from","predicate","to" exactly as asserted',
    '- missing_link: "from","predicate","to"',
    '- missing_instance: "proposedId", "proposedTypes":[…], "label", "x", "y", "links":[{"from","predicate","to"}]',
    '- wrong_type: "id", "addTypes":[…], "removeTypes":[…]',
    '- delete_instance: "id"',
    '- misplaced_anchor: "id", "x", "y"',
    '- other: "id" (optional), "text"',
    'Use instance ids exactly as written (never tag numbers) and prefixed names for classes and predicates. Include every item, in order.');
  return L.join('\n');
}
async function openResolveModal() {
  if (!S.G) { toast('Open a graph first'); return; }
  const items = resolveItems();
  if (!items.length) { toast('There are no open flags, rules or notes to resolve'); openIssues(); return; }
  const sample = await getSample();
  const lim = sample ? await sample.limits().catch(() => null) : null;
  const picked = new Set(items);
  const chosen = () => items.filter(it => picked.has(it));
  const describe = list => {
    const nF = list.filter(i => i.kind === 'node' || i.kind === 'edge').length, nR = list.filter(i => i.kind === 'rule').length, nN = list.filter(i => i.kind === 'note').length;
    return [nF && `${nF} flagged instance${nF === 1 ? '' : 's'} or link${nF === 1 ? '' : 's'}`, nR && `${nR} rule${nR === 1 ? '' : 's'}`, nN && `${nN} general note${nN === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'nothing';
  };
  const intro = h('p');
  const note = h('textarea', { class: 'note', placeholder: 'Optional: anything else Claude should know for this round' });
  const info = h('div', { class: 'callout' }), log = h('div', { class: 'runlog', 'aria-live': 'polite' }), bar = h('div', { class: 'bar', hidden: true }, h('div'));
  /* the items in this run: collapsed by default, untick to leave an item out */
  const cnt = h('span', { class: 'cnt-muted' });
  const ul = h('ul', { class: 'pick-list' });
  const boxes = [];
  for (const it of items) {
    const cb = h('input', { type: 'checkbox', checked: true, 'aria-label': itemLabel(it) });
    cb.addEventListener('change', () => { if (cb.checked) picked.add(it); else picked.delete(it); update(); });
    boxes.push(cb);
    const sub = it.rec && it.rec.note ? it.rec.note : it.kind === 'rule' || it.kind === 'note' ? '' : '';
    const chip = it.kind === 'node' || it.kind === 'edge' ? statusChip(it.rec && it.rec.status || 'issue') : h('span', { class: 'schip ' + (it.kind === 'rule' ? 'rule' : 'note') }, it.kind === 'rule' ? 'Rule' : 'Note');
    ul.append(h('li', null, h('label', { class: 'pick-row' }, cb, h('span', { class: 'grow' }, h('span', { class: 'pick-top' }, chip, h('span', { class: 'pick-name' }, itemLabel(it))), sub ? h('span', { class: 'pick-note' }, sub) : null))));
  }
  const setAll = v => { boxes.forEach((cb, k) => { cb.checked = v; if (v) picked.add(items[k]); else picked.delete(items[k]); }); update(); };
  const pick = h('details', { class: 'pickitems' },
    h('summary', null, h('span', { class: 'grow' }, h('b', null, 'Items in this run'), h('span', { class: 'muted' }, ' — untick any you want to leave out')), cnt),
    h('div', { class: 'pickbar' }, h('button', { class: 'btn small ghost', type: 'button', onclick: () => setAll(true) }, 'Select all'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => setAll(false) }, 'Select none')),
    ul);
  const runBtn = h('button', { class: 'btn primary' });
  const closeBtn = h('button', { class: 'btn ghost' }, 'Close');
  closeBtn.addEventListener('click', () => { if (S.claudeCtl) S.claudeCtl.abort(); else closeModal(); });
  let maxImages = 0;
  const foot = [closeBtn];
  const update = () => {
    const list = chosen();
    cnt.textContent = `${list.length} of ${items.length}`;
    intro.textContent = `${claudeName()} reads ${describe(list)} with your comments, close-ups of the flagged places and the relevant part of the graph, and proposes concrete fixes: remove, reverse or re-point links, add missing ones, change classes, add or delete instances. Nothing changes until you accept a fix and apply it to the graph; every applied fix goes into the change log.`;
    runBtn.textContent = list.length ? `Resolve ${list.length} item${list.length === 1 ? '' : 's'}` : 'Resolve';
    if (!sample || !lim) return;
    runBtn.disabled = !list.length || !!S.claudeCtl;
    const withRect = list.filter(i => i.rect).length, nRef = maxImages >= 3 ? refBudget(maxImages, 2) : 0;
    const crops = maxImages ? Math.min(withRect, Math.max(0, maxImages - 1 - nRef)) : 0;
    info.textContent = !list.length ? 'Tick at least one item.' : maxImages ? `Sends ${crops ? 1 + crops + nRef : 0} images (an overview and ${crops} close-up${crops === 1 ? '' : 's'}${crops && nRef ? (nRef === 1 && S.legend ? ', the legend' : `, ${nRef} reference image${nRef === 1 ? '' : 's'}`) : ''}) and the item list in one call. ${usageNote()}.${withRect > crops ? ` ${withRect - crops} item(s) go as text only.` : ''}` : 'This view can\'t send images, so Claude gets the graph text only.';
  };
  if (!sample || !lim) { info.className = 'callout warn'; info.textContent = 'Claude isn\'t available here. Open the app inside Claude to resolve issues — your project comes along as a file — or set your own Claude API key.'; runBtn.disabled = true; foot.push(...noClaudeFoot()); }
  else { maxImages = lim.images ? Math.min(lim.images.maxCount || 1, 20) : 0; foot.push(runBtn); }
  update();
  runBtn.addEventListener('click', async () => {
    const list = chosen();
    if (!list.length) return;
    list.forEach((it, k) => { it.id = 'I' + (k + 1); if (it.rect) it.rect.id = it.id; });   /* number the items of this run */
    runBtn.disabled = true; closeBtn.textContent = 'Stop'; note.disabled = true; boxes.forEach(cb => { cb.disabled = true; });
    bar.hidden = false; bar.classList.add('indet');
    const out = await runResolve(sample, list, { note: note.value.trim(), maxImages }, (msg, frac) => {
      log.textContent = msg;
      if (frac != null) { bar.classList.remove('indet'); bar.firstChild.style.width = (frac * 100) + '%'; }
    });
    bar.classList.remove('indet'); closeBtn.textContent = 'Close';
    if (out) {
      const show = h('button', { class: 'btn primary' }, 'Review the fixes');
      show.addEventListener('click', () => { closeModal(); openIssues('findings'); });
      $('#modalFoot').textContent = ''; $('#modalFoot').append(closeBtn, show);
    } else { runBtn.disabled = false; note.disabled = false; boxes.forEach(cb => { cb.disabled = false; }); }
  });
  openModal('Resolve issues with Claude', [intro, pick, note, info, bar, log], foot);
}
async function runResolve(sample, items, opts, report) {
  const ctl = new AbortController();
  S.claudeCtl = ctl;
  const snap = snapshot();
  try {
    report('Preparing the issue list and close-ups…');
    const ids = idMapFor([...S.G.nodes.values()]);
    const imgs = [], labels = [], infos = new Map();
    const withRect = items.filter(i => i.rect);
    const nRef = opts.maxImages >= 3 ? refBudget(opts.maxImages, 2) : 0;
    const budget = opts.maxImages ? Math.max(0, opts.maxImages - 1 - nRef) : 0;
    const cropped = withRect.slice(0, budget);
    if (cropped.length) {
      imgs.push(await renderAreaOverview(cropped.map(i => i.rect))); labels.push('overview of the whole drawing with the flagged places outlined and labelled');
      for (const it of cropped) {
        const inf = areaContext(it.rect, ids);
        imgs.push((await renderAreaImage(it.rect, inf, true)).blob); labels.push(`${it.id} — close-up of the flagged place with the graph's instances tagged`);
        infos.set(it.id, { inf, img: imgs.length });
      }
      for (const r of refImages().slice(0, nRef)) { imgs.push(r.blob); labels.push(r.label); }
    }
    const prompt = buildResolvePrompt(items, infos, { labels, note: opts.note, ids, refSent: cropped.length ? nRef : 0 });
    report(`Claude is working through ${items.length} item${items.length === 1 ? '' : 's'}…`);
    const options = { model: 'claude-opus-5-5', modelTier: 'complex', signal: ctl.signal, cache: false,
      onText: ({ text }) => { const k = (text.match(/"type"\s*:/g) || []).length; report(`Receiving proposed fixes… ${k}`); } };
    if (imgs.length) options.images = imgs;
    const res = await sample(prompt, options);
    const model = modelLabel(res);
    const obj = parseLooseJson(res.text);
    if (!obj || !Array.isArray(obj.items)) throw { code: 'bad_json', message: 'Claude\'s answer could not be read.', text: res.text };
    const run = { id: 'v' + Date.now().toString(36), at: new Date().toISOString(), kind: 'resolve', model, note: opts.note || '',
      areas: items.map(it => ({ id: it.id, label: itemLabel(it), ...(it.rect ? { x: it.rect.x, y: it.rect.y, s: it.rect.s } : {}) })), summaries: {} };
    let count = 0;
    for (const r of obj.items) {
      const it = items.find(x => x.id === String(r && r.item));
      if (!it) continue;
      run.summaries[it.id] = String(r.summary || '').slice(0, 400);
      const grp = run.areas.find(a => a.id === it.id);
      for (const fd of (Array.isArray(r.findings) ? r.findings : []).slice(0, 120)) {
        const f = normaliseFinding(fd, grp, run, ids.map);
        if (f) { f.issueRef = { kind: it.kind, key: it.key }; S.findings.push(f); count++; }
      }
    }
    S.recheckRuns.push(run);
    persist(); frame(); renderIssues();
    report(`Done with ${model}: ${count} proposed fix${count === 1 ? '' : 'es'} for ${items.length} item${items.length === 1 ? '' : 's'}.` + (res.truncated ? ' The answer was cut short — resolve fewer items at a time.' : ''), 1);
    return { count, run };
  } catch (e) {
    if (e && e.code === 'cancelled') report('Stopped.');
    else if (e && e.code === 'bad_json') { report(e.message + ' Nothing was changed.'); console.warn(e.text); }
    else report((e && SAMPLE_ERR[e.code]) || ('Something went wrong: ' + ((e && (e.message || e.code)) || e)));
    return null;
  } finally {
    S.claudeCtl = null;
    commit('resolve with Claude', snap);
  }
}

/* ---- project files: graph + drawing + legend + layout + review in one .json ---- */
const blobToDataUrl = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
function dataUrlToBlob(u) {
  const i = u.indexOf(','), meta = u.slice(5, i), b64 = u.slice(i + 1);
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
  return new Blob([arr], { type: meta.split(';')[0] || 'application/octet-stream' });
}
async function projectJson() {
  return JSON.stringify({
    format: 'kg-overlay-project/1', savedAt: new Date().toISOString(),
    graphs: S.graphs.map(g => ({ name: g.name, text: g.text })),
    drawing: S.drawing ? { name: S.drawing.name, page: S.drawing.page, comment: S.drawing.comment || undefined, dataUrl: await blobToDataUrl(S.drawing.source || S.drawing.blob) } : null,
    legend: S.legend ? { name: S.legend.name, comment: S.legend.comment || undefined, dataUrl: await blobToDataUrl(S.legend.blob) } : null,
    images: await Promise.all(S.ctxImages.map(async i => ({ name: i.name, role: i.role, comment: i.comment || undefined, dataUrl: await blobToDataUrl(i.blob) }))),
    layout: layoutDoc(),
  });
}
async function saveProject() {
  if (!S.G && !S.drawing) { toast('Nothing to save yet'); return false; }
  busy(true, 'Packing the project…');
  try { const json = await projectJson(); busy(false); return await saveFile(baseName() + '.project.json', json); }
  catch (e) { busy(false); toast('Could not pack the project: ' + (e.message || e)); return false; }
}
async function openProjectObject(obj) {
  busy(true, 'Opening the project…');
  try {
    let drawing = null, legend = null;
    if (obj.drawing && obj.drawing.dataUrl) {
      const blob = dataUrlToBlob(obj.drawing.dataUrl);
      drawing = await prepareDrawing(new File([blob], obj.drawing.name || 'drawing', { type: blob.type }), obj.drawing.page || 1);
      drawing.comment = obj.drawing.comment || '';
    }
    if (obj.legend && obj.legend.dataUrl) { const blob = dataUrlToBlob(obj.legend.dataUrl); const im = await loadImageBlob(blob); legend = { name: obj.legend.name || 'legend', blob, url: im.url, comment: obj.legend.comment || '' }; }
    const images = [];
    for (const it of Array.isArray(obj.images) ? obj.images : []) { if (!it || !it.dataUrl) continue; try { const blob = dataUrlToBlob(it.dataUrl); const im = await loadImageBlob(blob); images.push({ id: 'im' + images.length, name: it.name || 'image', blob, url: im.url, role: it.role === 'title' ? 'title' : 'context', comment: it.comment || '' }); } catch { /* skip */ } }
    if (drawing && obj.layout) LS.del(`kgov:ds:${drawing.hash}:p${drawing.page}`);   /* the project file is the record: don't mix in older state kept in this browser */
    newProject(true);
    await openSession({ graphs: obj.graphs || [], drawing, legend, images, isDemo: false });
    if (obj.layout) importLayoutObject(obj.layout, { silent: true, asOriginal: true });
    rebuild(); renderAllPanels(); renderIssues(); fitView();
    S.undo = []; S.redo = []; updateUndo();
    toast('Project opened');
  } catch (e) { console.error(e); toast('Could not open the project: ' + (e.message || e)); }
  finally { busy(false); }
}

/* ---- Open in Claude: Claude features need the page to run inside Claude ---- */
/* =====================================================================
   12g. Reference images: legend, title block and other context images
   ===================================================================== */
const IMG_ROLES = [['drawing', 'Main drawing'], ['legend', 'Legend'], ['title', 'Title block'], ['context', 'Context']];
const noteSuffix = c => (c && String(c).trim() ? ` — reviewer's note: "${String(c).trim().replace(/\s+/g, ' ').slice(0, 400)}"` : '');
/* every reference image, in the order Claude gets them (legend first), with a label for the prompt */
function refImages() {
  const out = [];
  if (S.legend) out.push({ blob: S.legend.blob, name: S.legend.name, label: `the symbol legend of the drawing ("${S.legend.name}")${noteSuffix(S.legend.comment)}` });
  for (const im of S.ctxImages) if (im.role === 'title') out.push({ blob: im.blob, name: im.name, label: `the title block of the drawing ("${im.name}")${noteSuffix(im.comment)}` });
  for (const im of S.ctxImages) if (im.role !== 'title') out.push({ blob: im.blob, name: im.name, label: `a reference image ("${im.name}")${noteSuffix(im.comment)}` });
  return out;
}
/* notes that go into the prompt as text: the note on the drawing, and notes on images that did not fit */
function refNoteLines(sent) {
  const L = [];
  if (S.drawing && S.drawing.comment && S.drawing.comment.trim()) L.push(`The reviewer's note on the drawing: "${S.drawing.comment.trim().replace(/\s+/g, ' ').slice(0, 600)}"`);
  for (const r of refImages().slice(sent || 0)) if (/reviewer's note/.test(r.label)) L.push(`Not attached for lack of room — ${r.label}`);
  return L;
}
const refCount = () => (S.legend ? 1 : 0) + S.ctxImages.length;
/* how many reference images to send next to the drawing images: at least the legend, at most a quarter of the room */
function refBudget(maxImages, reserved) {
  const n = refCount();
  if (!n) return 0;
  const room = Math.max(0, maxImages - reserved);
  return Math.min(n, room, Math.max(1, Math.floor((maxImages - 1) / 4)));
}
function setCtxImages(list) {
  for (const im of S.ctxImages || []) if (im.url && !(list || []).some(x => x.url === im.url)) URL.revokeObjectURL(im.url);
  S.ctxImages = list || [];
  updateImagesBtn();
  if (!$('#legendWin').hidden) showImagesWin(S.imgWinIdx || 0);
}
function updateImagesBtn() {
  const b = $('#btnLegend'), n = refCount();
  if (!b) return;
  b.title = n ? `Legend and reference images (${n})` : 'Legend and reference images';
  b.setAttribute('aria-label', b.title);
  b.classList.toggle('has', n > 0);
}
function imagesList() {
  const L = [];
  if (S.legend) L.push({ kind: 'legend', name: S.legend.name, url: S.legend.url, comment: S.legend.comment || '', role: 'legend' });
  for (const im of S.ctxImages) L.push({ kind: 'ctx', id: im.id, name: im.name, url: im.url, comment: im.comment || '', role: im.role });
  return L;
}
function showImagesWin(idx) {
  const list = imagesList(), w = $('#legendWin');
  if (!list.length) { w.hidden = true; return; }
  idx = clamp(idx || 0, 0, list.length - 1);
  S.imgWinIdx = idx;
  const it = list[idx];
  $('#lgTitle').textContent = it.role === 'legend' ? 'Legend' : it.role === 'title' ? 'Title block' : 'Reference image';
  $('#lgTitle').title = it.name;
  $('#legendImg').src = it.url;
  $('#legendImg').alt = it.name;
  const tabs = $('#lgTabs');
  tabs.textContent = '';
  tabs.hidden = list.length < 2;
  list.forEach((x, i) => tabs.append(h('button', { class: 'chip' + (i === idx ? ' on' : ''), title: x.name, onclick: () => showImagesWin(i) }, h('span', null, x.role === 'legend' ? 'Legend' : x.role === 'title' ? 'Title block' : x.name))));
  const note = $('#lgNote');
  note.textContent = it.comment;
  note.hidden = !it.comment;
}
function toggleImagesWin() {
  if (!refCount()) { toast('No legend or reference images yet', { label: 'Add images…', fn: () => pickFiles('add-images') }); return; }
  const w = $('#legendWin');
  w.hidden = !w.hidden;
  if (!w.hidden) {
    showImagesWin(S.imgWinIdx || 0);
    if (!w._placed) { w.style.left = '12px'; w.style.top = '60px'; w._placed = true; makeDraggable(w, w.querySelector('header')); }
  }
}
function guessRole(name, i, needDrawing) {
  if (/legend|symbol|signatur|tegnforklaring|key/i.test(name)) return 'legend';
  if (/title|tittel|stamp|header|antet|hode|block/i.test(name)) return 'title';
  return needDrawing && i === 0 ? 'drawing' : 'context';
}
/* the dialog for several images at once: role and a note per image. mode 'open' (new drawing set), 'add' (add to the current project), 'manage' (edit what is loaded) */
async function openImagesDialog(files, mode) {
  const isPdf = f => PDF_EXT.test(f.name) || f.type === 'application/pdf';
  let entries;
  if (mode === 'manage') {
    entries = [];
    if (S.drawing) entries.push({ kind: 'drawing', name: S.drawing.name, url: S.drawing.url, role: 'drawing', comment: S.drawing.comment || '', fixed: true });
    if (S.legend) entries.push({ kind: 'legend', name: S.legend.name, url: S.legend.url, blob: S.legend.blob, role: 'legend', comment: S.legend.comment || '' });
    for (const im of S.ctxImages) entries.push({ kind: 'ctx', id: im.id, name: im.name, url: im.url, blob: im.blob, role: im.role, comment: im.comment || '' });
    if (!entries.length) { toast('No images loaded yet'); return; }
  } else {
    const list = [...files];
    /* the largest image is the likeliest main drawing */
    const needDrawing = mode === 'open' || !S.drawing;
    if (needDrawing) list.sort((a, b) => (isPdf(b) - isPdf(a)) || b.size - a.size);
    entries = list.map((f, i) => ({ kind: 'file', file: f, name: f.name, url: isPdf(f) ? null : URL.createObjectURL(f), pdf: isPdf(f), role: isPdf(f) ? (needDrawing && i === 0 ? 'drawing' : 'skip') : guessRole(f.name, i, needDrawing), comment: '' }));
    if (needDrawing && !entries.some(e => e.role === 'drawing')) { const e = entries.find(x => x.role === 'context') || entries.find(x => x.role !== 'skip'); if (e) e.role = 'drawing'; }
    if (S.legend && mode === 'add') for (const e of entries) if (e.role === 'legend') e.role = 'context';   /* keep the current legend unless the user picks this one */
  }
  const canDrawing = mode !== 'add' || !S.drawing;
  const roles = IMG_ROLES.filter(([r]) => r !== 'drawing' || canDrawing);
  const listBox = h('div', { class: 'imglist' });
  const err = h('div', { class: 'callout warn', hidden: true });
  const draw = () => {
    listBox.textContent = '';
    entries.forEach((e, i) => {
      if (e.removed) return;
      const thumb = e.url ? h('img', { src: e.url, alt: '', class: 'ithumb' }) : h('div', { class: 'ithumb pdf' }, 'PDF');
      const seg = h('div', { class: 'qa-seg mini', role: 'radiogroup', 'aria-label': 'Role of ' + e.name });
      for (const [r, label] of roles) {
        if (e.fixed && r !== 'drawing') continue;
        if (!e.fixed && e.kind !== 'file' && r === 'drawing') continue;
        const dis = e.pdf && r !== 'drawing';
        seg.append(h('button', { class: e.role === r ? 'on' : '', role: 'radio', 'aria-checked': e.role === r ? 'true' : 'false', disabled: dis, title: dis ? 'A PDF can only be the main drawing' : null, onclick: () => {
          if (r === 'drawing' || r === 'legend') for (const o of entries) if (o !== e && o.role === r && !o.fixed) o.role = o.pdf ? 'skip' : 'context';
          e.role = r; draw();
        } }, label));
      }
      const note = h('textarea', { class: 'note inote', rows: 2, placeholder: e.role === 'drawing' ? 'Note on the drawing for Claude (optional), e.g. "the supply side is on the left"' : e.role === 'legend' ? 'Note on the legend (optional), e.g. "BRS = fire damper"' : e.role === 'title' ? 'Note (optional), e.g. "drawing number and revision"' : 'What does this image show? (optional)', 'aria-label': 'Note on ' + e.name });
      note.value = e.comment;
      note.addEventListener('input', () => { e.comment = note.value; });
      const rm = mode === 'manage' && !e.fixed ? h('button', { class: 'x-btn', 'aria-label': 'Remove ' + e.name, title: 'Remove this image', onclick: () => { e.removed = true; draw(); } }, '✕') : null;
      listBox.append(h('div', { class: 'imgrow' + (e.role === 'skip' ? ' skip' : '') },
        thumb,
        h('div', { class: 'grow' },
          h('div', { class: 'imgname' }, h('b', { class: 'mono' }, e.name), rm),
          e.role === 'skip' ? h('div', { class: 'hint' }, 'Not used — PDFs can only be the main drawing.') : seg,
          e.role === 'skip' ? null : note)));
    });
  };
  draw();
  const intro = mode === 'manage' ? 'Set what each image is and add a note for Claude. Notes go into every prompt with the image (anchoring, re-check and resolve).'
    : mode === 'open' ? 'Pick the main drawing and say what the other images are. Each image can carry a note for Claude.'
      : 'These images are added to the project as reference for Claude — the drawing, the graph and your review stay as they are.';
  const ok = h('button', { class: 'btn primary' }, mode === 'manage' ? 'Save' : mode === 'open' ? 'Open' : 'Add to project');
  const cancel = h('button', { class: 'btn ghost', onclick: () => { cleanup(); closeModal(); } }, 'Cancel');
  const cleanup = () => { for (const e of entries) if (e.kind === 'file' && e.url && !e.used) URL.revokeObjectURL(e.url); };
  ok.addEventListener('click', async () => {
    const live = entries.filter(e => !e.removed && e.role !== 'skip');
    const main = live.find(e => e.role === 'drawing');
    if (mode === 'open' && !main) { err.hidden = false; err.textContent = 'Choose which image is the main drawing.'; return; }
    ok.disabled = true;
    try {
      if (mode === 'manage') {
        const d = live.find(e => e.kind === 'drawing'); if (d && S.drawing) S.drawing.comment = d.comment.trim();
        const lg = live.find(e => e.role === 'legend');
        const ctx = [];
        let legend = null;
        for (const e of live) {
          if (e.kind === 'drawing') continue;
          if (e === lg) legend = e.kind === 'legend' ? { ...S.legend, comment: e.comment.trim() } : { name: e.name, blob: e.blob, url: e.url, comment: e.comment.trim() };
          else ctx.push({ id: e.id || 'im' + Math.random().toString(36).slice(2, 8), name: e.name, blob: e.blob, url: e.url, role: e.role === 'title' ? 'title' : 'context', comment: e.comment.trim() });
        }
        /* keep object URLs that moved between legend and context */
        const keep = new Set([legend && legend.url, ...ctx.map(c => c.url)].filter(Boolean));
        if (S.legend && S.legend.url && !keep.has(S.legend.url)) URL.revokeObjectURL(S.legend.url);
        S.legend = null;
        for (const im of S.ctxImages) if (!keep.has(im.url)) URL.revokeObjectURL(im.url);
        S.ctxImages = [];
        S.legend = legend; $('#legendImg').src = legend ? legend.url : '';
        setCtxImages(ctx);
        closeModal();
        afterImagesChanged();
        toast('Images updated');
        return;
      }
      const legendE = live.find(e => e.role === 'legend');
      const ctx = live.filter(e => e.role === 'title' || e.role === 'context').map(e => ({ id: 'im' + Math.random().toString(36).slice(2, 8), name: e.name, blob: e.file, url: e.url, role: e.role, comment: e.comment.trim() }));
      for (const e of live) if (e.role !== 'drawing') e.used = true;
      let legend;
      if (legendE) legend = { name: legendE.name, blob: legendE.file, url: legendE.url, comment: legendE.comment.trim() };
      closeModalForce();
      if (main) {
        busy(true, 'Opening the drawing…');
        const drawing = await prepareDrawing(main.file);
        drawing.comment = main.comment.trim();
        if (mode === 'open' && S.isDemo) newProject(true);
        await openSession({ drawing, keepGraph: true, isDemo: false, legend: legend !== undefined ? legend : (mode === 'open' ? null : undefined), images: mode === 'open' ? ctx : [...S.ctxImages, ...ctx] });
        if (!S.G) toast('Now open the knowledge graph (.ttl)');
      } else {
        if (legend) setLegend(legend);
        setCtxImages([...S.ctxImages, ...ctx]);
        afterImagesChanged();
        toast(`Added ${live.length} image${live.length === 1 ? '' : 's'} as reference for Claude`, { label: 'Show', fn: () => { $('#legendWin').hidden = true; toggleImagesWin(); } });
      }
      cleanup();
    } catch (e) { console.error(e); busy(false); toast(e.message || String(e)); ok.disabled = false; }
  });
  openModal(mode === 'manage' ? 'Drawing and reference images' : mode === 'open' ? 'Open drawing and images' : 'Add images to the project', [h('p', null, intro), listBox, err], [cancel, ok]);
  $('#modal .modal').classList.add('mid');
}
function afterImagesChanged() {
  updateImagesBtn();
  if (!$('#legendWin').hidden) showImagesWin(S.imgWinIdx || 0);
  renderSetup();
  if (!S.isDemo) saveSessionToIdb();
}

/* =====================================================================
   12h. Claude outside Claude: an API key from a .env file
   Inside Claude the page asks Claude through the platform (your Claude account).
   Opened as a file elsewhere, the same calls can go straight to the Anthropic API
   with the user's own key. The key stays in this browser and is sent only to
   api.anthropic.com.
   ===================================================================== */
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5', 'most capable — best for anchoring and re-checks'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'fast and capable, lower cost'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5', 'fastest and cheapest, for small graphs'],
  ['claude-fable-5-1', 'Claude Fable 5.1', 'Mythos-class'],
];
const MODEL_NAMES = Object.fromEntries(API_MODELS.map(([id, name]) => [id, name]));
const API_DEFAULT = { model: 'claude-opus-5-5', maxTokens: 32000 };
const ENV_FILES = ['.env', 'claude.env'];
function parseEnv(text) {
  const out = {};
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1].toUpperCase()] = v;
  }
  const key = out.ANTHROPIC_API_KEY || out.CLAUDE_API_KEY || out.API_KEY || '';
  const model = out.CLAUDE_MODEL || out.ANTHROPIC_MODEL || out.MODEL || '';
  const mt = parseInt(out.CLAUDE_MAX_TOKENS || out.MAX_TOKENS || '', 10);
  return { key: key.trim(), model: model.trim(), maxTokens: isFinite(mt) && mt > 0 ? mt : null };
}
function envText(cfg) {
  return ['# Graph Overlay Inspector — Claude API settings',
    '# Keep this file next to the app\'s HTML file (as .env or claude.env). Never share it or commit it to Git.',
    `ANTHROPIC_API_KEY=${cfg.key || ''}`,
    `CLAUDE_MODEL=${cfg.model || API_DEFAULT.model}`,
    `CLAUDE_MAX_TOKENS=${cfg.maxTokens || API_DEFAULT.maxTokens}`, ''].join('\n');
}
function setApiConfig(cfg, source, remember) {
  if (!cfg || !cfg.key) { S.api = null; LS.del('kgov:api'); updateClaudeAvail(); return; }
  S.api = { key: cfg.key, model: cfg.model || API_DEFAULT.model, maxTokens: cfg.maxTokens || API_DEFAULT.maxTokens, source };
  if (remember) LS.set('kgov:api', { key: S.api.key, model: S.api.model, maxTokens: S.api.maxTokens });
  else if (remember === false) LS.del('kgov:api');
  S._apiSample = null;
  updateClaudeAvail();
}
const maskKey = k => (k ? k.slice(0, 10) + '…' + k.slice(-4) : '');
const apiModelName = () => (S.api ? MODEL_NAMES[S.api.model] || S.api.model : 'Claude Opus 5.5');
/* which Claude answers here, and whose usage it runs on */
function claudeName() { return S.nativeSample ? 'Claude Opus 5.5' : S.api ? apiModelName() : 'Claude Opus 5.5'; }
function usageNote() { return S.nativeSample ? 'It runs on your Claude usage' : S.api ? 'It runs on your API key (billed to its Anthropic account)' : 'It runs on your Claude usage'; }
function modelLabel(res) {
  if (res && res.modelApplied) return MODEL_NAMES[res.modelApplied] || res.modelApplied;
  return `Claude (${(res && res.modelTierApplied) || 'default'} tier)`;
}
async function getSample() {
  const native = await S.capSample;
  if (native) return native;
  if (S.api && S.api.key) return S._apiSample || (S._apiSample = makeApiSample());
  return null;
}
async function tryLoadEnvFile() {
  if (S.api) return;
  if (location.protocol === 'file:') return;   /* browsers don't let a file:// page read its neighbours */
  for (const name of ENV_FILES) {
    try {
      const r = await fetch(name, { cache: 'no-store' });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      if (/html/.test(ct)) continue;   /* a server that answers every path with the app */
      const cfg = parseEnv(await r.text());
      if (cfg.key) { setApiConfig(cfg, name, null); toast(`Claude is ready: using the API key from ${name} (${apiModelName()})`); return; }
    } catch { /* not served */ }
  }
}
function updateClaudeAvail() {
  const native = !!S.nativeSample, api = !native && !!(S.api && S.api.key);
  const avail = native || api;
  $('#btnInClaude').hidden = avail; $('#mInClaude').hidden = avail;
  $('#btnAnchor').title = avail ? `One-time placement of graph instances on the drawing (${claudeName()})` : 'Claude isn\'t available in this view — open the app in Claude or set an API key';
  const m = $('#mApiKey'); if (m) m.textContent = api ? `Claude API key · ${apiModelName()}…` : 'Claude API key (.env)…';
  const m2 = $('#mApiKey2'); if (m2) m2.textContent = m ? m.textContent : 'Claude API key (.env)…';
  renderSetup();
}
function noClaudeFoot() {
  return [h('button', { class: 'btn', onclick: () => { closeModal(); openEnvModal(); } }, 'Use an API key…'), h('button', { class: 'btn primary', onclick: () => { closeModal(); openInClaudeModal(); } }, 'Open in Claude…')];
}

/* ---- the sample() interface on top of the Messages API ---- */
async function apiImage(blob) {
  /* about 1.15 megapixels and at most 1568 px on the long side, as the platform does */
  let bmp = null;
  try { bmp = await createImageBitmap(blob); } catch { /* fall back to <img> */ }
  let w, hh, src = bmp, url = null;
  if (bmp) { w = bmp.width; hh = bmp.height; }
  else { const im = await loadImageBlob(blob); url = im.url; w = im.w; hh = im.h; src = new Image(); src.src = url; await src.decode(); }
  const sc = Math.min(1, Math.sqrt(1.15e6 / (w * hh)), 1568 / Math.max(w, hh));
  const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(hh * sc));
  let out = blob;
  if (sc < 1 || !/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) {
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cw, ch); c.imageSmoothingQuality = 'high'; c.drawImage(src, 0, 0, cw, ch);
    out = await new Promise(r => cv.toBlob(r, 'image/png'));
    if (out.size > 3.6e6) out = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
  }
  if (bmp && bmp.close) bmp.close();
  if (url) URL.revokeObjectURL(url);
  const data = (await blobToDataUrl(out)).split(',')[1];
  return { type: 'image', source: { type: 'base64', media_type: out.type || 'image/png', data } };
}
function apiError(code, message, text) { return { code, message, text }; }
function makeApiSample() {
  const call = async (input, opts = {}) => {
    const cfg = S.api;
    if (!cfg || !cfg.key) throw apiError('not_granted', 'No API key is set.');
    const signal = opts.signal;
    if (signal && signal.aborted) throw apiError('cancelled', 'Stopped.');
    const turns = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(t => ({ role: t.role, content: t.content }));
    const content = [];
    for (const b of opts.images || []) content.push(await apiImage(b));
    const last = turns[turns.length - 1];
    last.content = [...content, { type: 'text', text: String(last.content) }];
    const body = { model: cfg.model, max_tokens: cfg.maxTokens, stream: true, messages: turns };
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw apiError('cancelled', 'Stopped.');
      throw apiError('api_network', 'Could not reach api.anthropic.com. Check the network connection. (Inside a claude.ai page the API can\'t be called directly — there, Claude runs on your Claude account instead.)');
    }
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.type)) || ''; } catch { /* no body */ }
      const st = res.status;
      if (st === 401) throw apiError('api_auth', `The API key was rejected (401${msg ? ': ' + msg : ''}).`);
      if (st === 403) throw apiError('api_auth', `The API key isn't allowed to do this (403${msg ? ': ' + msg : ''}).`);
      if (st === 404) throw apiError('api_model', `Model "${cfg.model}" was not found for this key (404). Choose another model under Claude API key.`);
      if (st === 413) throw apiError('prompt_too_large', msg || 'The request is too large.');
      if (st === 429) throw apiError('rate_limited', msg || 'Rate limit reached.');
      if (st === 529 || st >= 500) throw apiError('upstream_error', `The API is busy or unavailable (${st}) — try again in a moment.`);
      throw apiError('api_error', `${st}: ${msg || res.statusText}`);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '', stop = null, model = cfg.model;
    const handle = ev => {
      if (!ev) return;
      if (ev.type === 'message_start' && ev.message && ev.message.model) model = ev.message.model;
      else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        text += ev.delta.text;
        if (opts.onText) { try { opts.onText({ text, delta: ev.delta.text }); } catch (e) { console.warn(e); } }
      } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
      else if (ev.type === 'error') throw apiError(ev.error && ev.error.type === 'overloaded_error' ? 'upstream_error' : 'api_error', (ev.error && ev.error.message) || 'The API reported an error.', text);
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
          if (data) { let ev = null; try { ev = JSON.parse(data); } catch { /* partial */ } handle(ev); }
        }
      }
    } catch (e) {
      if (e && e.code) throw e;
      if (e && e.name === 'AbortError') throw apiError('cancelled', 'Stopped.', text);
      throw apiError('upstream_error', 'The connection dropped while Claude was answering.', text);
    }
    if (!text.trim()) throw apiError('empty_completion', 'Claude returned an empty answer.');
    return { text, truncated: stop === 'max_tokens', modelApplied: model.replace(/-\d{8}$/, ''), modelTierApplied: opts.modelTier || 'default' };
  };
  const fn = (input, opts) => call(input, opts);
  fn.json = async (input, opts) => { const r = await call(input, opts); const v = parseLooseJson(r.text); if (v == null) throw apiError('bad_json', 'The answer was not JSON.', r.text); return v; };
  fn.limits = async () => ({ maxPromptBytes: 900000, images: { maxCount: 20, maxInputBytes: 30e6, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }, tools: { maxCount: 0 } });
  fn.isApi = true;
  return fn;
}

/* ---- the dialog: key, model, .env file ---- */
function openEnvModal() {
  closeMenus();
  const cur = S.api || LS.get('kgov:api', null) || {};
  const remembered = !!LS.get('kgov:api', null);
  const keyIn = h('input', { type: 'password', id: 'envKeyIn', class: 'envkey mono', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key' });
  keyIn.value = cur.key || '';
  const show = h('button', { class: 'btn small ghost', type: 'button', onclick: () => { keyIn.type = keyIn.type === 'password' ? 'text' : 'password'; show.textContent = keyIn.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
  const modelSel = h('select', { 'aria-label': 'Model' }, ...API_MODELS.map(([id, name, why]) => h('option', { value: id }, `${name} — ${why}`)));
  const custom = cur.model && !MODEL_NAMES[cur.model];
  if (custom) modelSel.append(h('option', { value: cur.model }, cur.model));
  modelSel.value = cur.model || API_DEFAULT.model;
  const mtIn = h('input', { type: 'number', min: 1024, max: 128000, step: 1024, value: cur.maxTokens || API_DEFAULT.maxTokens, 'aria-label': 'Max output tokens', style: { width: '110px' } });
  const remember = h('input', { type: 'checkbox' }); remember.checked = remembered;
  const status = h('div', { class: 'callout', hidden: true, 'aria-live': 'polite' });
  const say = (msg, warn) => { status.hidden = false; status.className = 'callout' + (warn ? ' warn' : ''); status.textContent = msg; };
  const cfgNow = () => ({ key: keyIn.value.trim(), model: modelSel.value, maxTokens: clamp(parseInt(mtIn.value, 10) || API_DEFAULT.maxTokens, 1024, 128000) });
  const loadBtn = h('button', { class: 'btn small', type: 'button' }, 'Load .env file…');
  loadBtn.addEventListener('click', () => {
    const fi = h('input', { type: 'file', accept: '.env,.txt,text/plain', style: { display: 'none' } });
    fi.addEventListener('change', async () => {
      const f = fi.files[0]; fi.remove(); if (!f) return;
      const cfg = parseEnv(await f.text());
      if (!cfg.key) { say(`No ANTHROPIC_API_KEY line found in ${f.name}.`, true); return; }
      keyIn.value = cfg.key;
      if (cfg.model) { if (![...modelSel.options].some(o => o.value === cfg.model)) modelSel.append(h('option', { value: cfg.model }, cfg.model)); modelSel.value = cfg.model; }
      if (cfg.maxTokens) mtIn.value = cfg.maxTokens;
      say(`Read the key${cfg.model ? ' and model' : ''} from ${f.name}. Press Use key.`);
    });
    document.body.append(fi); fi.click();
  });
  const saveEnvBtn = h('button', { class: 'btn small', type: 'button', onclick: () => { const c = cfgNow(); if (!c.key) { say('Enter a key first.', true); return; } saveFile('claude.env', envText(c)); } }, 'Save as .env file');
  const testBtn = h('button', { class: 'btn small', type: 'button' }, 'Test');
  testBtn.addEventListener('click', async () => {
    const c = cfgNow();
    if (!c.key) { say('Enter a key first.', true); return; }
    testBtn.disabled = true; say(`Asking ${MODEL_NAMES[c.model] || c.model}…`);
    const prev = S.api;
    S.api = { ...c, source: 'test' };
    try { const r = await makeApiSample()('Reply with the single word OK.', { modelTier: 'quick' }); say(`Works: ${modelLabel(r)} answered "${r.text.trim().slice(0, 40)}".`); }
    catch (e) { say((e && e.message) || String(e), true); }
    finally { S.api = prev; testBtn.disabled = false; }
  });
  const inClaude = !!S.nativeSample;
  const body = [
    h('p', null, 'Outside Claude — when the app is opened as a file in a browser — Claude can still anchor, re-check and resolve: the app calls the Anthropic API directly with your own API key. The key stays in this browser and is sent only to api.anthropic.com; usage is billed to the key\'s account.'),
    inClaude ? h('div', { class: 'callout' }, 'This copy runs inside Claude and already uses your Claude account, so no key is needed here. A key you save is used when the app is opened as a file outside Claude.') : null,
    h('div', { class: 'envgrid' },
      h('label', { for: 'envKeyIn' }, 'API key'), h('div', { class: 'envrow' }, keyIn, show),
      h('label', null, 'Model'), modelSel,
      h('label', null, 'Max output'), h('div', { class: 'envrow' }, mtIn, h('span', { class: 'muted' }, 'tokens per answer'))),
    h('label', { class: 'check', style: { marginTop: '8px' } }, remember, h('span', null, 'Remember in this browser ', h('span', { class: 'muted' }, '— anyone using this browser profile could use the key'))),
    h('div', { class: 'btnrow', style: { marginTop: '10px' } }, loadBtn, saveEnvBtn, testBtn,
      S.api || remembered ? h('button', { class: 'btn small ghost danger-text', type: 'button', onclick: () => { setApiConfig(null); keyIn.value = ''; remember.checked = false; say('The key is forgotten in this browser.'); } }, 'Forget key') : null),
    status,
    h('details', { class: 'envhelp' }, h('summary', null, 'Using a .env file next to the app'),
      h('p', null, 'Save the settings with ', h('b', null, 'Save as .env file'), ' and keep it in the same folder as the app\'s HTML file, named ', h('code', null, '.env'), ' or ', h('code', null, 'claude.env'), '. It looks like this:'),
      h('pre', null, 'ANTHROPIC_API_KEY=sk-ant-…\nCLAUDE_MODEL=claude-opus-5-5\nCLAUDE_MAX_TOKENS=32000'),
      h('p', null, 'When the folder is served by a local web server (for example ', h('code', null, 'python3 -m http.server'), '), the app finds the file by itself. Opened straight from disk (file://), browsers don\'t let a page read other files, so use ', h('b', null, 'Load .env file…'), ' once and tick Remember. Never share the file or commit it to Git.')),
  ];
  const use = h('button', { class: 'btn primary' }, 'Use key');
  use.addEventListener('click', () => {
    const c = cfgNow();
    if (!c.key) { say('Enter or load a key first.', true); return; }
    if (!/^sk-/.test(c.key)) { say('That doesn\'t look like an Anthropic API key (they start with sk-ant-).', true); return; }
    setApiConfig(c, 'manual', remember.checked);
    closeModal();
    toast(inClaude ? 'Key saved for use outside Claude' : `Claude is ready: ${apiModelName()} with your API key`);
  });
  openModal('Claude API key', body, [h('button', { class: 'btn ghost', onclick: closeModal }, 'Close'), use]);
}

function openInClaudeButton(label) {
  return h('a', { class: 'btn primary', href: ARTIFACT_URL, target: '_blank', rel: 'noopener' }, label || 'Open in Claude ↗');
}
function openInClaudeModal() {
  const has = !!(S.G || S.drawing) && !S.isDemo;
  const body = [h('p', null, 'Anchoring, re-checking and resolving issues need Claude. Here, Claude isn\'t reachable: open the app in Claude (sign in if asked), or use your own Anthropic API key — then Claude works right here in this copy.')];
  if (has) {
    body.push(h('ol', null,
      h('li', null, h('b', null, 'Save the project file'), ' — it holds the graph, the drawing, the legend, placements, your review, rules, proposals and the change log.'),
      h('li', null, h('b', null, 'Open in Claude'), ' — the same app opens in a new tab.'),
      h('li', null, 'Drop the project file onto it, or use ', h('b', null, 'Open → Open project file'), '. Everything is back where you left it.')));
  } else body.push(h('p', null, 'In Claude, open your graph and drawing as usual.'));
  body.push(h('p', { class: 'hint' }, 'With an API key: choose ', h('b', null, 'Set up API key (.env)'), ' — enter the key and model, or load a .env file kept next to the app.'));
  const foot = [h('button', { class: 'btn ghost', onclick: closeModal }, 'Close'), h('button', { class: 'btn', onclick: () => { closeModal(); openEnvModal(); } }, 'Set up API key (.env)…')];
  if (has) foot.push(h('button', { class: 'btn', onclick: saveProject }, 'Save project file'));
  foot.push(openInClaudeButton());
  openModal('Open the app in Claude', body, foot);
}

/* ---- setup card: stays until both the graph and the drawing are loaded ---- */
function renderSetup() {
  const need = !(S.G && S.drawing);
  const box = $('#empty');
  box.hidden = !need;
  if (!need) return;
  box.textContent = '';
  const row = (n, label, req, val, act, btn, again) => h('div', { class: 'srow' + (val ? ' done' : '') },
    h('span', { class: 'sico' }, val ? '✓' : String(n)),
    h('div', { class: 'grow' }, h('b', null, label), h('div', { class: 'muted', style: { fontSize: '12px', overflowWrap: 'anywhere' } }, val || (req ? 'Required' : 'Optional — helps Claude recognise the symbols'))),
    h('button', { class: 'btn' + (!val && req ? ' primary' : ''), onclick: () => pickFiles(act) }, val ? again || 'Replace…' : btn));
  box.append(h('div', { class: 'box' },
    h('h2', null, 'Start a review'),
    h('p', null, 'Add the knowledge graph and the drawing it was extracted from. You can also drop the files anywhere on the page.'),
    row(1, 'Knowledge graph', true, S.graphs.length ? S.graphs.map(g => g.name).join(' + ') : null, 'open-graph', 'Open graph…'),
    row(2, 'Drawing', true, S.drawing ? S.drawing.name : null, 'open-drawing', 'Open drawing…'),
    row(3, 'Legend and other images', false, refCount() ? [S.legend && S.legend.name, ...S.ctxImages.map(i => i.name)].filter(Boolean).join(', ') : null, 'add-images', 'Add images…', 'Add more…'),
    h('div', { class: 'srow' + (S.nativeSample || S.api ? ' done' : '') },
      h('span', { class: 'sico' }, S.nativeSample || S.api ? '✓' : '4'),
      h('div', { class: 'grow' }, h('b', null, 'Claude'), h('div', { class: 'muted', style: { fontSize: '12px' } },
        S.nativeSample ? 'Runs on your Claude account here. An API key (.env) is only needed for copies opened outside Claude.'
          : S.api ? `${apiModelName()} with your API key${S.api.source && S.api.source !== 'manual' && S.api.source !== 'saved' ? ' from ' + S.api.source : ''}` : 'Optional — an API key or a .env file lets Claude anchor and re-check outside Claude')),
      h('button', { class: 'btn', onclick: openEnvModal }, S.api ? 'Change…' : S.nativeSample ? 'API key (.env)…' : 'Set up API key (.env)…')),
    h('div', { class: 'btnrow', style: { marginTop: '14px' } },
      h('button', { class: 'btn ghost', onclick: () => pickFiles('open-project') }, 'Open project file…'),
      h('button', { class: 'btn ghost', onclick: () => loadDemo(true) }, 'Load demo'))));
}
/* New project: offer to save the current one first, then start from the setup card */
function hasProjectWork() { return !!(S.G || S.drawing) && (!S.isDemo || S.undo.length > 0); }
function confirmNewProject() {
  closeMenus();
  if (!hasProjectWork()) { startFresh(); return; }
  const saveBtn = h('button', { class: 'btn primary' }, 'Save project, then start new');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const ok = await saveProject();
    saveBtn.disabled = false;
    if (ok) { closeModal(); startFresh(); }
    else if (!$('#modal').hidden && $('#modalTitle').textContent === 'Start a new project?') toast('Not saved — the current project is still open');
  });
  openModal('Start a new project?', [
    h('p', null, 'Save the current project first? The project file keeps the graph, the drawing, the legend, placements, your review, rules, Claude\'s proposals and the change log. Open it again any time with Open → Open project file.'),
    h('p', { class: 'hint' }, 'Starting new clears the current graph and drawing, and forgets the review this browser kept for that drawing.'),
    h('p', { class: 'hint' }, S.nativeSample ? 'For copies of the app opened outside Claude, ' : 'Claude features outside Claude need ', h('button', { class: 'linkbtn', onclick: () => { closeModal(); openEnvModal(); } }, S.nativeSample ? 'set up an API key (.env)' : 'an API key (.env) — set it up'), '.'),
  ], [h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn danger', onclick: () => { closeModal(); startFresh(); } }, 'Discard and start new'), saveBtn]);
}
function startFresh() {
  if (S.key) LS.del(dsKey());
  IDB.del('last');
  newProject(false);
  toast('New project — add the knowledge graph and the drawing');
}
function newProject(silent) {
  if (S.areaMode) exitAreaMode(false);
  S.G = null; S.graphs = []; S.parsed = null; S.isDemo = false;
  if (S.issueFocus) { S.issueFocus = null; renderFocusPill(); }
  if (S.drawing && S.drawing.url) URL.revokeObjectURL(S.drawing.url);
  S.drawing = null;
  const img = $('#drawing'); img.removeAttribute('src'); img.hidden = true;
  setLegend(null);
  setCtxImages([]);
  applyDataset(null);
  if (S.rightPanel) closeRightPanel();
  S.sparqlSel = null; if (S.sparql) { S.sparql.res = null; S.sparql.err = null; }
  if (!silent) { renderAllPanels(); rebuild(); updateHeader(); }
}

/* =====================================================================
   13. Export, help, theme
   ===================================================================== */
async function saveFile(filename, data) {
  const dl = await S.capDownloads;
  if (dl) {
    try { await dl.save({ filename, data }); toast('Saved ' + filename); return true; }
    catch (e) {
      if (e && e.code === 'declined') return false;
      if (e && !['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e.code)) { toast('Could not save: ' + (e.message || e.code)); return false; }
    }
  }
  if (!FRAMED) {   /* opened directly in a browser tab: an ordinary download works */
    try {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: /\.json$/i.test(filename) ? 'application/json' : 'text/plain' }));
      const a = h('a', { href: url, download: filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Saved ' + filename);
      return true;
    } catch { /* fall through to copy */ }
  }
  const ta = h('textarea', { class: 'out', readonly: true });
  ta.value = typeof data === 'string' ? data : '';
  openModal(filename, [h('p', null, 'Saving files isn\'t available in this view. Copy the content below instead.'), ta], [h('button', { class: 'btn primary', onclick: () => copyText(ta.value, ta) }, 'Copy')]);
  return false;
}
function layoutDoc() {
  const d = S.drawing;
  return {
    format: 'kg-overlay-layout/1',
    exportedAt: new Date().toISOString(),
    artifact: d ? { name: d.name, width: d.w, height: d.h, page: d.page } : null,
    graphs: S.graphs.map(g => ({ name: g.name, fnv1a: fnv1a(g.text) })),
    units: 'px',
    anchors: Object.fromEntries([...S.anchors].sort((a, b) => a[0].localeCompare(b[0]))),
    offDrawing: [...S.off].sort(),
    qa: S.qa,
    runs: S.runs,
    findings: S.findings,
    recheckRuns: S.recheckRuns,
    rules: S.rules,
    changes: S.changes,
  };
}
function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
/* why each element is in the report: the automatic checks, review decisions, rules, proposals and changes that concern it */
const CHECK_WHY = {
  unplaced: () => 'Not placed on the drawing yet, so its position is unknown',
  lowconf: it => `Placed by Claude with low confidence (${(S.anchors.get(it.iri) || {}).conf ?? '?'}): it may sit on the wrong symbol`,
  noflow: () => 'Component without any flow link: a connection is probably missing',
  open: () => 'Segment with only one flow neighbour (open end): a connection may be missing',
  long: () => 'Unusually long flow link: a collapsed run, a wrong connection or a misplaced anchor',
  twoway: () => 'Flow asserted in both directions: the flow direction contradicts itself',
  untyped: () => 'No rdf:type, so its class is unknown',
  outside: () => 'Its anchor lies outside the drawing',
};
function reviewWhy(r) {
  const st = { ok: 'Reviewer confirmed it as correct', issue: 'Reviewer flagged it as an issue', unsure: 'Reviewer is unsure about it', resolved: 'Reviewer flagged it; now resolved' }[r.status] || ('Review status ' + r.status);
  return st + (r.check ? ` (decided from the report "${r.check}")` : '');
}
function reportReasons() {
  const node = new Map(), link = new Map();
  const add = (m, k, txt) => { let a = m.get(k); if (!a) m.set(k, a = []); if (!a.includes(txt)) a.push(txt); };
  for (const c of S.checks || computeChecks()) for (const it of c.items) {
    const txt = CHECK_WHY[c.id] ? CHECK_WHY[c.id](it) : c.title;
    if (it.iri) add(node, it.iri, txt); else add(link, it.group.qaKey, txt);
  }
  for (const [iri, r] of Object.entries(S.qa.nodes)) if (r.status) add(node, iri, reviewWhy(r));
  for (const [k, r] of Object.entries(S.qa.edges)) if (r.status) add(link, k, reviewWhy(r));
  for (const r of S.rules) if (r.kind === 'rule' && r.status !== 'resolved') for (const e of ruleViolations(r)) { const t = `Its ${qn(e.p)} link breaks the rule "${ruleText(r)}"`; add(node, e.s, t); add(node, e.o, t); }
  for (const f of S.findings) if (f.status !== 'dismissed') for (const iri of new Set([f.iri, f.fromIri, f.toIri])) if (iri) add(node, iri, `${(FT[f.type] || FT.other).label} proposed by ${originLabel(f) || 'Claude'} (${f.status})${f.evidence ? ': ' + f.evidence : ''}`);
  for (const c of activeChanges()) for (const iri of changeNodes(c)) add(node, iri, `Changed in the graph by ${c.id} (${(CHANGE_LABEL[c.type] || c.type).toLowerCase()})`);
  for (const iri of S.off) add(node, iri, 'Marked as not on this drawing');
  return { node, link };
}
function qaCsv() {
  const G = S.G, why = reportReasons();
  const rows = [['item', 'name', 'why_in_report', 'iri_or_link', 'classes', 'status', 'note', 'placement', 'x', 'y', 'confidence', 'reviewed_at']];
  const inst = [];
  for (const n of G.nodes.values()) {
    const q = S.qa.nodes[n.iri] || {}, a = S.anchors.get(n.iri), rs = why.node.get(n.iri) || [];
    inst.push({ rank: q.status === 'issue' ? 0 : q.status === 'unsure' ? 1 : rs.length ? 2 : 3,
      row: ['instance', n.local, rs.join('; ') || 'No issue found: listed for completeness', n.iri, [...n.types].map(qn).join(' '), q.status || '', q.note || '', placed(n.iri) ? a.source : S.off.has(n.iri) ? 'not on drawing' : 'unplaced', a ? a.x : '', a ? a.y : '', a && a.conf != null ? a.conf : '', q.at || ''] });
  }
  inst.sort((x, y) => x.rank - y.rank);
  for (const r of inst) rows.push(r.row);
  for (const k of new Set([...Object.keys(S.qa.edges), ...why.link.keys()])) {
    const q = S.qa.edges[k] || {}, [cat, a, b] = k.split('|');
    const trip = G.edges.filter(e => e.cat === cat && ((e.s === a && e.o === b) || (e.s === b && e.o === a))).map(e => `${G.nodes.get(e.s)?.local} ${qn(e.p)} ${G.nodes.get(e.o)?.local}`).join('; ');
    rows.push(['link', `${G.nodes.get(a)?.local || a} – ${G.nodes.get(b)?.local || b} (${cat})`, (why.link.get(k) || []).join('; ') || 'Reviewed link', trip || '(no longer in the graph)', '', q.status || '', q.note || '', '', '', '', '', q.at || '']);
  }
  for (const r of S.rules) rows.push([r.kind, r.kind === 'rule' ? `${ruleViolations(r).length} violations` : '', r.kind === 'rule' ? `Reviewer rule: every triple that breaks it is a likely error${r.comment ? '. ' + r.comment : ''}` : 'General instruction from the reviewer for Claude', ruleText(r), '', r.status, r.comment || '', '', '', '', '', r.at || '']);
  for (const f of S.findings) rows.push(['finding (' + f.area + ')', FT[f.type] ? FT[f.type].label : f.type, `Proposed by ${originLabel(f) || 'Claude'}${f.evidence ? ': ' + f.evidence : ''}`, findingTitle(f), (f.proposedTypes || f.addTypes || []).join(' '), f.status, issueComment(f), 're-check', f.x ?? '', f.y ?? '', f.conf ?? '', '']);
  for (const c of S.changes) rows.push(['change ' + c.id, CHANGE_LABEL[c.type] || c.type, `${c.status === 'reverted' ? 'Reverted change' : 'Applied to the graph'}${c.why ? ': ' + c.why : ''}`, c.title, '', c.status, c.comment || '', '', '', '', c.conf ?? '', c.at || '']);
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}
function baseName() { return (S.graphs[0]?.name || 'graph').replace(/\.[^.]+$/, ''); }
function openHelp() {
  openModal('How this works', [
    h('p', null, 'Load a candidate knowledge graph and the drawing it was extracted from. Each instance is drawn on top of the symbol it came from, so you can see at a glance what the extraction got right, what it missed and what it connected wrongly.'),
    h('h3', null, '1 · Placing instances on the drawing'),
    h('ul', null,
      h('li', null, 'Coordinates already in the graph are used automatically (any numeric …X / …Y predicate pair, e.g. sig:drawingX / sig:drawingY).'),
      h('li', null, h('b', null, 'Anchor with Claude'), ' places the rest in one call: the drawing is sent as an overview plus gridded tiles, together with every instance\'s classes, attributes and relations. Afterwards everything runs locally.'),
      h('li', null, 'Drag any node to correct it. Drop it outside the drawing to mark it as not on this drawing. The ↶ / ↷ buttons undo and redo moves, marks, review flags, imports and Claude runs.')),
    h('h3', null, '2 · Reading the overlay'),
    h('ul', null,
      h('li', null, 'The Drawing ⇄ Graph fader at the bottom crossfades the two layers: centre shows both fully, left only the drawing, right only the graph. It snaps to the centre; double-click it to reset.'),
      h('li', null, 'Line colour = connection category (toggle categories and single predicates in the side panel; click the arrow to expand).'),
      h('li', null, 'Solid = component to component. Dashed = one end is a room/zone/storey or a system.'),
      h('li', null, 'Arrows show the canonical direction: flow direction for flows, whole/container → part for topology and location. Inverse predicates (e.g. brick:isFedBy) are drawn the same way as their forward form, and parallel predicates (fso:suppliesFluidTo + brick:feeds) share one line.'),
      h('li', null, 'Node shapes: ● component, ○ duct/pipe segment, ■ fitting, ▢ location, ⬡ system, ◆ point/sensor. A dotted ring means low placement confidence.'),
      h('li', null, 'Scope: This drawing shows only what is placed on it; + Neighbours adds directly linked instances from elsewhere in the graph (e.g. a radiator in the same room from a heating graph); Full graph shows everything. Unplaced instances wait in the panel to the right of the drawing.'),
      h('li', null, 'Instances with no shown connection are faded and their name is hidden; rest the pointer on one for a second to see its name and thicken all its lines. Node size and line width are under Display.'),
      h('li', null, h('b', null, 'Reset'), ' (bottom right, or R) puts the fader, zoom and every highlight back, then offers to highlight what is still in question.')),
    h('h3', null, '3 · Re-checking doubtful areas'),
    h('ul', null,
      h('li', null, h('b', null, 'Re-check areas'), ' dims the drawing and fades the graph: tap the places you doubt to light up rounded squares (about 4 symbols wide; change it with Size), or switch to ', h('b', null, 'Rectangle'), ' and click two opposite corners. All marked areas go to Claude in one call, with close-ups that show where the graph puts each instance. Tick ', h('b', null, 'The areas are related'), ' when the same problem shows up in several places: Claude then compares the areas with each other too.'),
      h('li', null, 'Findings (missing or misplaced components, wrong classes, wrong, missing or reversed links) appear in a list and on the drawing. Accept or dismiss each one in the Issues panel; Apply to graph then puts accepted ones into effect.')),
    h('h3', null, '4 · Issues and fixes'),
    h('ul', null,
      h('li', null, h('b', null, 'Issues'), ' (top bar) opens a panel with every flagged instance and link and your comment on it. Cards show only their header: click one to open it and highlight its instances and links in orange on the drawing; click it again or the empty drawing to let go. Section headers fold away. Edit comments right in the card. Add ', h('b', null, 'rules'), ' (which kinds of instances a predicate may connect) to catch many wrong links at once, and ', h('b', null, 'general notes'), ' for Claude.'),
      h('li', null, h('b', null, 'Resolve with Claude'), ' sends the open issues, rules and notes in one call — open “Items in this run” to leave some out. Claude proposes concrete fixes; accept or dismiss each.'),
      h('li', null, h('b', null, 'Apply to graph'), ' puts accepted fixes into effect: removed links and instances disappear from the view, new ones appear. Your files are never changed — each applied fix is an entry in the ', h('b', null, 'Change log'), ' (what was removed and added, why, who proposed it), and any entry can be reverted. Export the refined graph as Turtle, the log as CSV, or a SPARQL Update.'),
      h('li', null, 'Claude features need Claude: inside Claude they use your Claude account. Elsewhere, either use ', h('b', null, 'Open in Claude'), ' (save the project file, open the app in Claude and drop the file on it) or set up your own ', h('b', null, 'Claude API key'), ' (Open menu): enter it with a model, or keep a .env file next to the app. The key stays in your browser and goes only to api.anthropic.com.')),
    h('h3', null, '5 · Reviewing'),
    h('ul', null,
      h('li', null, 'Click a node for all its predicates: classes, system, location, connections and literal properties. The view zooms to its connections — hidden ones appear dimmed and clickable on top of the labels — and clicking the empty drawing zooms back. Point at a connection in the card to light up its line; click it for the line\'s triples (click again to close). The connection card highlights its subject and object.'),
      h('li', null, h('b', null, 'Ctrl-click'), ' (⌘-click on a Mac) adds nodes to the selection. The card then shows what they have in common — shared values in green, differing ones as “multiple values” — with a chip per node to switch. ', h('b', null, 'Show path'), ' highlights the chain of shown links between them; if there is none, it says so and names the room, system or parent they share.'),
      h('li', null, 'Each node\'s card ends with its issues and checks — flags, automatic checks, rules it breaks, Claude\'s proposals and applied changes — with the decision right there.'),
      h('li', null, 'Mark instances and links as Correct / Issue / Unsure with a note. Export the review as CSV or the full layout + review as JSON.'),
      h('li', null, 'Review & checks lists automatic reports: unplaced instances, low-confidence placements, components without flow, open-ended segments, unusually long flow links, two-way flows. Click a report for its options: Show all highlights its items and dims the rest; tick items (or Mark all) and Decide for marked to give them one decision and one comment for Claude. Each item shows its decision; “open” counts what is still undecided.'),
      h('li', null, 'Connections: Uncheck all hides every line, then tick just the predicates you want. Instances without any shown connection fade to 50 %.'),
      h('li', null, 'The review report (CSV) says for every row why it is there: which check, rule, decision, proposal or change concerns it.')),
    h('h3', null, '6 · Images and SPARQL'),
    h('ul', null,
      h('li', null, 'Open drawing accepts several images at once: pick the main drawing and mark the others as legend, title block or context, each with a note for Claude. ', h('b', null, 'Add images to the project'), ' adds more without starting over; the ✎ in the image window edits roles and notes.'),
      h('li', null, h('b', null, 'SPARQL'), ' (top bar) queries the loaded graph with every applied change, right in the browser. Pick an example or write your own (common prefixes are predefined); Ctrl/⌘ + Enter runs it. With owl:sameAs ticked, aliases count as the same thing: sameAs is symmetric and transitive, and every triple about one alias holds for all of them. Results list below — Expand opens a big table (full screen, filter, sort, CSV). With “Show results in the view”, the entities and links found are highlighted on the drawing; click a row to highlight just that row.')),
    h('h3', null, 'Layout file format'),
    h('pre', null, '{\n  "format": "kg-overlay-layout/1",\n  "artifact": {"name": "01_diagram.png", "width": 7310, "height": 4753},\n  "units": "px",            // or "norm1000"\n  "anchors": {"<instance IRI>": {"x": 1636, "y": 2856, "source": "claude", "conf": 0.9}},\n  "offDrawing": ["<instance IRI>"],\n  "qa": {"nodes": {"<IRI>": {"status": "issue", "note": "…"}}, "edges": {}}\n}'),
    h('h3', null, 'Shortcuts'),
    h('p', null, h('kbd', null, 'F'), ' fit · ', h('kbd', null, 'R'), ' reset view · ', h('kbd', null, '+'), ' / ', h('kbd', null, '−'), ' zoom · ', h('kbd', null, '/'), ' search · ', h('kbd', null, 'T'), ' class labels · ', h('kbd', null, 'Esc'), ' close · ', h('kbd', null, 'Ctrl/⌘ Z'), ' undo · ', h('kbd', null, 'Ctrl/⌘ Shift Z'), ' redo'),
    h('p', { class: 'hint' }, 'Files stay in your browser. Nothing is sent anywhere except when you run a Claude feature (anchoring, re-check, resolve).'),
  ], [h('button', { class: 'btn primary', onclick: closeModal }, 'Got it')]);
}
const THEMES = ['auto', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $('#btnTheme').title = 'Theme: ' + t;
}

/* =====================================================================
   14. Wiring
   ===================================================================== */
/* DJ-style crossfader: centre = both at 100 %, left = drawing only, right = graph only */
function setMix(v, save = true) {
  v = clamp(Math.round(+v || 0), -100, 100);
  S.settings.mix = v;
  const g = v < 0 ? 1 + v / 100 : 1, d = v > 0 ? 1 - v / 100 : 1;
  ov.style.opacity = g; drawingEl.style.opacity = d;
  const r = $('#mix');
  if (r && +r.value !== v) r.value = v;
  $('#mixD').textContent = Math.round(d * 100) + '%';
  $('#mixG').textContent = Math.round(g * 100) + '%';
  $('#mixer').classList.toggle('centered', v === 0);
  if (r) r.setAttribute('aria-valuetext', `drawing ${Math.round(d * 100)} %, graph ${Math.round(g * 100)} %`);
  if (save) saveSettings();
}
function closeMenus() { $$('.menu').forEach(m => { m.hidden = true; }); $$('[aria-haspopup=menu]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
function toggleMenu(btn, menu) {
  const open = menu.hidden;
  closeMenus();
  if (!open) return;
  menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
  placeMenu(menu);
  const f = menu.querySelector('button'); if (f) f.focus({ preventScroll: true });
}
function placeMenu(menu) {
  menu.classList.remove('sheet');
  menu.style.right = ''; menu.style.top = '';
  if (window.innerWidth <= 600) {   /* phones: full-width dropdown under the top bar */
    menu.classList.add('sheet');
    menu.style.top = Math.round($('.topbar').getBoundingClientRect().bottom + 6) + 'px';
    return;
  }
  const r = menu.getBoundingClientRect();
  if (r.left < 8) menu.style.right = Math.round(r.left - 8) + 'px';
  else if (r.right > window.innerWidth - 8) menu.style.right = Math.round(r.right - window.innerWidth + 8) + 'px';
}
async function doAction(act) {
  closeMenus();
  switch (act) {
    case 'open-graph': case 'add-graph': case 'open-drawing': case 'open-legend': case 'import-layout': pickFiles(act); break;
    case 'issues': S.rightPanel === 'issues' ? closeIssues() : openIssues(); break;
    case 'sparql': S.rightPanel === 'sparql' ? closeSparql() : openSparql(); break;
    case 'reset-view': resetView(true); break;
    case 'add-images': pickFiles('add-images'); break;
    case 'manage-images': openImagesDialog(null, 'manage'); break;
    case 'api-key': openEnvModal(); break;
    case 'load-demo': await loadDemo(true); break;
    case 'export-layout': if (S.G) saveFile(baseName() + '.overlay.json', JSON.stringify(layoutDoc(), null, 1)); break;
    case 'export-qa': if (S.G) saveFile(baseName() + '.review.csv', qaCsv()); break;
    case 'copy-prompt': openPromptModal('unplaced'); break;
    case 'export-corrections': openCorrections(); break;
    case 'export-refined': exportRefined(); break;
    case 'export-changelog': exportChangeLog(); break;
    case 'export-project': saveProject(); break;
    case 'open-project': pickFiles('open-project'); break;
    case 'new-project': confirmNewProject(); break;
    case 'open-in-claude': openInClaudeModal(); break;
    case 'reset-manual': {
      const manual = [...S.anchors].filter(([, a]) => a.source === 'manual');
      if (!manual.length) { toast('There are no manual moves'); break; }
      const yes = h('button', { class: 'btn danger' }, `Undo ${manual.length} manual move${manual.length === 1 ? '' : 's'}`);
      yes.addEventListener('click', () => {
        const snap = snapshot();
        for (const [iri] of manual) { const o = S.orig.get(iri); if (o) S.anchors.set(iri, { ...o }); else S.anchors.delete(iri); }
        commit(`reset ${manual.length} manual move${manual.length === 1 ? '' : 's'}`, snap);
        persist(); rebuild(); closeModal();
      });
      openModal('Undo all manual moves?', [h('p', null, 'Every node you dragged goes back to its original position (from the graph, an imported layout or Claude). Review statuses and notes are kept. You can redo this with the Undo button.')], [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), yes]);
      break;
    }
    default: break;
  }
}
function wire() {
  $('#btnOpen').addEventListener('click', e => { e.stopPropagation(); toggleMenu($('#btnOpen'), $('#menuOpen')); });
  $('#btnExport').addEventListener('click', e => { e.stopPropagation(); toggleMenu($('#btnExport'), $('#menuExport')); });
  $('#btnMore').addEventListener('click', e => { e.stopPropagation(); $('#mTheme').textContent = 'Theme: ' + LS.get('kgov:theme', 'auto'); toggleMenu($('#btnMore'), $('#menuMore')); });
  $('#mLegend').addEventListener('click', () => { closeMenus(); toggleImagesWin(); });
  $('#mHelp').addEventListener('click', () => { closeMenus(); openHelp(); });
  $('#mTheme').addEventListener('click', () => { closeMenus(); $('#btnTheme').click(); });
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRecheck').addEventListener('click', () => (S.areaMode ? exitAreaMode(true) : enterAreaMode()));
  $('#btnIssues').addEventListener('click', () => (S.rightPanel === 'issues' ? closeIssues() : openIssues()));
  $('#btnSparql').addEventListener('click', () => (S.rightPanel === 'sparql' ? closeSparql() : openSparql()));
  $('#btnInClaude').addEventListener('click', openInClaudeModal);
  $('#mRecheck').addEventListener('click', () => { closeMenus(); enterAreaMode(); });
  $('#btnRedo').addEventListener('click', redo);
  window.addEventListener('resize', () => { const m = $$('.menu').find(x => !x.hidden); if (m) placeMenu(m); });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
  $$('[data-act]').forEach(b => b.addEventListener('click', () => doAction(b.dataset.act)));
  $('#fileInput').addEventListener('change', e => handleFiles(e.target.files, pendingMode));
  $('#btnAnchor').addEventListener('click', openAnchorModal);
  $('#btnHelp').addEventListener('click', openHelp);
  $('#modalClose').addEventListener('click', () => { if (S.claudeCtl) S.claudeCtl.abort(); else closeModal(); });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('#btnTheme').addEventListener('click', () => {
    const cur = LS.get('kgov:theme', 'auto');
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    LS.set('kgov:theme', next); applyTheme(next); theme = null; frame();
  });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { theme = null; frame(); }); } catch { /* old browsers */ }
  $('#btnLegend').addEventListener('click', toggleImagesWin);
  $('#lgManage').addEventListener('click', () => openImagesDialog(null, 'manage'));
  $('#sideClose').addEventListener('click', () => { $('#side').classList.remove('open'); const sc = $('.scrim'); if (sc) sc.remove();
  });
  $('#lgClose').addEventListener('click', () => { $('#legendWin').hidden = true; });
  let lgZoom = 100;
  const setLg = z => { lgZoom = clamp(z, 50, 600); $('#legendImg').style.width = lgZoom + '%'; };
  $('#lgIn').addEventListener('click', () => setLg(lgZoom * 1.4));
  $('#lgOut').addEventListener('click', () => setLg(lgZoom / 1.4));
  $('#zIn').addEventListener('click', () => zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1.4));
  $('#zOut').addEventListener('click', () => zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1 / 1.4));
  $('#zFit').addEventListener('click', () => fitView(true));
  $('#zReset').addEventListener('click', () => resetView(true));
  $$('input[name=scope]').forEach(r => r.addEventListener('change', () => { if (r.checked) setScope(r.value); }));
  $('#pdfPage').addEventListener('change', async e => {
    const page = +e.target.value;
    const src = S.drawing.source;
    try { const d = await prepareDrawing(src, page); await openSession({ drawing: d, keepGraph: true }); } catch (err) { toast(err.message); busy(false); }
  });

  const st = S.settings;
  const rl = $('#rngLabel');
  setMix(st.mix || 0, false);
  const mx = $('#mix');
  mx.addEventListener('input', () => { const v = +mx.value; setMix(Math.abs(v) <= 7 ? 0 : v); });   /* snaps to the centre */
  mx.addEventListener('dblclick', () => setMix(0));
  $('#mixDrawBtn').addEventListener('click', () => setMix(st.mix === -100 ? 0 : -100));
  $('#mixGraphBtn').addEventListener('click', () => setMix(st.mix === 100 ? 0 : 100));
  const syncDisplay = () => {
    rl.value = st.labelSize; $('#valLabel').textContent = st.labelSize + 'px';
    $('#rngNode').value = nodeScale(); $('#valNode').textContent = nodeScale() + '×';
    $('#rngLine').value = lineScale(); $('#valLine').textContent = lineScale() + '×';
    $('#optTypes').checked = st.showTypes; $('#optDeclutter').checked = st.declutter; $('#optInvert').checked = st.invert;
    $('#optMerge').checked = st.merge; $('#optFlagged').checked = st.flaggedOnly; $('#selName').value = st.nameMode;
    $('#optDimUnlinked').checked = st.dimUnlinked !== false;
    drawingEl.classList.toggle('inverted', st.invert);
  };
  syncDisplay();
  rl.addEventListener('input', () => { st.labelSize = +rl.value; syncDisplay(); saveSettings(); if (S.G) rebuild(); });
  $('#rngNode').addEventListener('input', e => { st.nodeScale = +e.target.value; syncDisplay(); saveSettings(); if (S.G) rebuild(); });
  $('#rngLine').addEventListener('input', e => { st.lineScale = +e.target.value; syncDisplay(); saveSettings(); frame(); });
  $('#optTypes').addEventListener('change', e => { st.showTypes = e.target.checked; saveSettings(); if (S.G) rebuild(); });
  $('#optDeclutter').addEventListener('change', e => { st.declutter = e.target.checked; saveSettings(); frame(); });
  $('#optInvert').addEventListener('change', e => { st.invert = e.target.checked; syncDisplay(); saveSettings(); });
  $('#optMerge').addEventListener('change', e => { st.merge = e.target.checked; saveSettings(); if (S.G) rebuild(); });
  $('#optDimUnlinked').addEventListener('change', e => { st.dimUnlinked = e.target.checked; saveSettings(); if (S.G) rebuild(); });
  $('#optFlagged').addEventListener('change', e => { st.flaggedOnly = e.target.checked; saveSettings(); applyFocus(); });
  $('#selName').addEventListener('change', e => { st.nameMode = e.target.value; saveSettings(); if (S.G) { rebuild(); renderSystems(); } });
  $('#selTypePref').addEventListener('change', e => { st.typePref = e.target.value; saveSettings(); if (S.G) rebuild(); });

  const search = $('#search');
  search.addEventListener('input', runSearch);
  search.addEventListener('focus', runSearch);
  search.addEventListener('keydown', e => {
    const btns = $$('#searchResults button');
    if (e.key === 'ArrowDown') { searchSel = Math.min(btns.length - 1, searchSel + 1); markSearch(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { searchSel = Math.max(0, searchSel - 1); markSearch(); e.preventDefault(); }
    else if (e.key === 'Enter') { const b = btns[searchSel]; if (b) pickSearch(b.dataset.iri); }
    else if (e.key === 'Escape') { $('#searchResults').hidden = true; search.blur(); }
  });
  search.addEventListener('blur', () => setTimeout(() => { $('#searchResults').hidden = true; }, 180));

  const side = $('#side');
  $('#btnPanel').addEventListener('click', () => {
    const open = !side.classList.contains('open');
    side.classList.toggle('open', open);
    let scrim = $('.scrim');
    if (open && !scrim) { scrim = h('div', { class: 'scrim', onclick: () => { side.classList.remove('open'); scrim.remove(); } }); document.body.append(scrim); }
    if (!open && scrim) scrim.remove();
  });

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) { closeModal(); return; }
      if (S.areaMode) { if (S.rectStart) { S.rectStart = null; frame(); renderAreaBar(); } else exitAreaMode(true); return; }
      closeMenus();
      if (S.edgePopOpen) { closeEdgePop(); return; }
      if (S.selection.length) { deselect(); return; }
      if (S.issueFocus || S.pathFocus || S.selFinding || S.selArea || S.issueSel || S.sparqlSel != null) { clearTransient(); return; }
      if (S.rightPanel && window.innerWidth <= 820) { closeRightPanel(); return; }
      if (S.focusSystem) { S.focusSystem = null; S.sysMembers = null; renderSystems(); applyFocus(); }
      return;
    }
    if (typing || !$('#modal').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') fitView(true);
    else if (e.key === 'r' || e.key === 'R') resetView(true);
    else if (e.key === '+' || e.key === '=') zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1.3);
    else if (e.key === '-' || e.key === '_') zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1 / 1.3);
    else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (e.key === 't' || e.key === 'T') { st.showTypes = !st.showTypes; $('#optTypes').checked = st.showTypes; saveSettings(); if (S.G) rebuild(); }
  });

  /* drag & drop files */
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#dropHint').hidden = false; e.preventDefault(); } });
  window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').hidden = true; });
  window.addEventListener('drop', e => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); dragDepth = 0; $('#dropHint').hidden = true;
    const files = [...e.dataTransfer.files];
    const hasGraph = files.some(f => GRAPH_EXT.test(f.name));
    handleFiles(files, hasGraph ? 'open-graph' : 'open-drawing');
  });

  new ResizeObserver(() => { if (S.G && !S._fitted && vp.clientWidth > 0) { S._fitted = true; fitView(); } frame(); }).observe(vp);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureCache.clear(); if (S.G) rebuild(); });
}

async function init() {
  loadSettings();
  applyTheme(LS.get('kgov:theme', 'auto'));
  sizeCanvas();
  wire();
  updateUndo();
  renderCats();
  const use = name => { try { return window.claude && typeof window.claude.use === 'function' ? Promise.resolve(window.claude.use(name)).catch(() => null) : Promise.resolve(null); } catch { return Promise.resolve(null); } };
  S.capSample = use('sample');
  S.capDownloads = use('downloads');
  S.capSample.then(fn => {
    S.nativeSample = fn || null;
    if (!fn) {
      const saved = LS.get('kgov:api', null);
      if (saved && saved.key) setApiConfig(saved, 'saved', null);
      tryLoadEnvFile();
    }
    updateClaudeAvail();
  });
  const restored = await restoreSession();
  if (!restored) await loadDemo();
}
window.__kgov = S; /* for debugging in the console */
init();
})();
