const fs = require('fs'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2] + '/n3bundle.js', 'utf8') + '\nthis.N3Parser = N3Parser;', ctx);
const E = require(process.argv[2] + '/src/sparql.js');
const ttl = `@prefix ex: <http://ex.org/> . @prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:Fan1 ex:feeds ex:Coil1 . ex:Fan1 ex:label "fan" .
ex:SF01 owl:sameAs ex:Fan1 . ex:SF01 ex:power 3 .
ex:Coil1 owl:sameAs ex:HC01 . ex:HC01 owl:sameAs ex:HC-01b .
ex:HC-01b ex:feeds ex:Duct1 .`;
const quads = new ctx.N3Parser().parse(ttl);
const P = { ex: 'http://ex.org/', owl: 'http://www.w3.org/2002/07/owl#' };
const short = t => t ? t.value.replace('http://ex.org/', '') : '-';
for (const [q, sa] of [
  ['SELECT ?o WHERE { ex:SF01 ex:feeds ?o }', false],
  ['SELECT ?o WHERE { ex:SF01 ex:feeds ?o }', true],
  ['SELECT ?x WHERE { ex:Fan1 ex:feeds/ex:feeds ?x }', true],
  ['SELECT ?p WHERE { ex:Fan1 ex:power ?p }', true],
  ['SELECT ?y WHERE { ex:Coil1 owl:sameAs ?y }', true],
  ['ASK { ex:HC-01b owl:sameAs ex:Coil1 }', true],
  ['ASK { ex:HC-01b owl:sameAs ex:Coil1 }', false],
]) {
  const r = E.run(q, quads, { prefixes: P, sameAs: sa });
  console.log(sa ? 'sameAs' : 'plain ', q, '=>', r.type === 'ask' ? r.value : r.rows.map(x => r.vars.map(v => short(x[v])).join('|')).join(', '), r.sameAs ? JSON.stringify(r.sameAs) : '');
}
