const fs = require('fs'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2] + '/n3bundle.js', 'utf8') + '\nthis.N3Parser = N3Parser;', ctx);
const S = require(process.argv[2] + '/src/sparql.js');
const ttl = fs.readFileSync(process.argv[3], 'utf8');
const prefixes = {};
const quads = new ctx.N3Parser().parse(ttl, null, (p, i) => { prefixes[p] = i.value || i; });
console.log('quads', quads.length, Object.keys(prefixes).join(' '));
const show = r => {
  if (r.type === 'ask') return 'ASK ' + r.value;
  if (r.type !== 'select') return r.type + ' ' + r.triples.length + ' triples; e.g. ' + r.triples.slice(0, 2).map(t => [t.s, t.p, t.o].map(x => x.value.split(/[#/]/).pop()).join(' ')).join(' | ');
  return `${r.rows.length} rows [${r.vars.join(',')}] ${r.ms}ms: ` + r.rows.slice(0, 4).map(row => r.vars.map(v => row[v] ? row[v].value.split(/[#/]/).pop() : '-').join('|')).join(' ; ');
};
const Q = [
  'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }',
  'SELECT ?class (COUNT(?s) AS ?n) WHERE { ?s a ?class } GROUP BY ?class ORDER BY DESC(?n) LIMIT 5',
  'SELECT ?room (COUNT(?el) AS ?n) WHERE { ?room bot:containsElement ?el } GROUP BY ?room HAVING (COUNT(?el) > 5) ORDER BY ?room',
  'SELECT DISTINCT ?x WHERE { ?ahu a brick:Air_Handling_Unit . ?ahu fso:suppliesFluidTo+ ?x } LIMIT 5',
  'SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { ?ahu a brick:Air_Handling_Unit . ?ahu fso:suppliesFluidTo+ ?x }',
  'SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { ?ahu a brick:Air_Handling_Unit . ?x ^fso:suppliesFluidTo* ?ahu }',
  'SELECT ?s WHERE { ?s a bot:Element . FILTER NOT EXISTS { ?space bot:containsElement ?s } } ORDER BY ?s LIMIT 5',
  'SELECT ?s ?label WHERE { ?s rdfs:label ?label . FILTER(CONTAINS(LCASE(STR(?label)), "fan")) } LIMIT 3',
  'SELECT ?s ?l WHERE { ?s a brick:Damper . OPTIONAL { ?s rdfs:label ?l } } LIMIT 3',
  'ASK { ?s a brick:Air_Handling_Unit }',
  'SELECT ?a ?b WHERE { { ?a brick:feeds ?b } UNION { ?a fso:returnsFluidTo ?b } } LIMIT 3',
  'SELECT ?x WHERE { VALUES ?t { brick:Damper brick:Supply_Fan } ?x a ?t } ',
  'SELECT ?x (STRLEN(STR(?x)) AS ?len) WHERE { ?x a brick:Supply_Fan } ',
  'CONSTRUCT { ?b brick:isFedBy ?a } WHERE { ?a brick:feeds ?b } LIMIT 10',
  'DESCRIBE inst:AHU_HTRK-VEN03',
  'SELECT ?s ?o WHERE { ?s fso:suppliesFluidTo/fso:suppliesFluidTo ?o } LIMIT 3',
  'SELECT (COUNT(*) AS ?n) WHERE { ?s fso:suppliesFluidTo|fso:returnsFluidTo ?o }',
  'SELECT ?s WHERE { ?s ?p ?o . MINUS { ?s a bot:Space } FILTER(?p = rdf:type) } LIMIT 2',
  'SELECT ?x ?y WHERE { ?x sig:drawingX ?y . FILTER(?y > 7000) } ORDER BY DESC(?y) LIMIT 3',
  'SELECT ?x (?y * 2 AS ?d) WHERE { ?x sig:drawingX ?y } ORDER BY ?y LIMIT 2',
  'SELECT (AVG(?y) AS ?avg) (MIN(?y) AS ?min) (MAX(?y) AS ?max) (SUM(?y) AS ?sum) WHERE { ?x sig:drawingX ?y }',
  'SELECT (GROUP_CONCAT(?l; SEPARATOR=", ") AS ?all) WHERE { ?x a brick:Supply_Fan ; rdfs:label ?l }',
  'SELECT ?x WHERE { ?x a ?t . FILTER(?t IN (brick:Damper, brick:Fire_Damper)) } LIMIT 2',
  'SELECT * WHERE { ?x a brick:Supply_Fan ; ?p ?o } LIMIT 3',
  'SELECT ?x WHERE { { SELECT ?x WHERE { ?x a bot:Space } LIMIT 2 } }',
  'PREFIX ex: <http://example.org/> SELECT ?x WHERE { BIND(ex:a AS ?x) }',
  'SELECT ?s WHERE { ?s !(rdf:type|rdfs:label) inst:Space_TEKNIKRUM } LIMIT 3',
  'SELECT ?x WHERE { ?x a brick:Damper FILTER(REGEX(STR(?x), "rk1-0[35]", "i")) }',
  'SELECT ?t WHERE { inst:AHU_HTRK-VEN03 a ?t }',
  'SELECT ?x WHERE { ?x a [ ] } LIMIT 1',
];
for (const q of Q) {
  try { const r = S.run(q, quads, { prefixes }); console.log('OK ', q.slice(0, 70).padEnd(70), '→', show(r)); }
  catch (e) { console.log('ERR', q.slice(0, 70).padEnd(70), '→', e.message); }
}
for (const bad of ['SELECT ?x WHERE { ?x a }', 'SELECT ?x WHERE { ?x zz:p ?y }', 'SELEC ?x', 'SELECT ?x WHERE { ?x a brick:Damper . FILTER(foo(?x)) }']) {
  try { S.run(bad, quads, { prefixes }); console.log('no error for', bad); } catch (e) { console.log('expected error:', e.message); }
}
