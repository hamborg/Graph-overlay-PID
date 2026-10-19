import fs from 'fs';
const src = process.argv[2];
const rd = f => fs.readFileSync(`${src}/${f}`, 'utf8');
const strip = t => t.replace(/^import .*$/mg, '');
let iris = strip(rd('IRIs.js')).replace('export default {', 'return {');
let df = strip(rd('N3DataFactory.js'))
  .replace(/^export default DataFactory;\s*$/m, '')
  .replace(/^export \{ Quad as Triple \};\s*$/m, '')
  .replace(/^export (class|function) /mg, '$1 ');
let lex = strip(rd('N3Lexer.js')).replace('export default class N3Lexer', 'class N3Lexer');
let par = strip(rd('N3Parser.js')).replace('export default class N3Parser', 'class N3Parser');
for (const [n,t] of [['df',df],['lex',lex],['par',par]]) if (/^\s*export /m.test(t)) throw new Error('leftover export in '+n);
const out = `/*! N3.js 2.0.1 (MIT, Ruben Verborgh et al.) — Turtle/TriG/N-Triples/N3 parser, inlined */
var N3Parser = (function () {
  'use strict';
  const namespaces = (function () { ${iris} })();
  const N3DataFactory = (function () { ${df}
    return DataFactory; })();
  const N3Lexer = (function () { ${lex}
    return N3Lexer; })();
  ${par}
  return N3Parser;
})();
`;
fs.writeFileSync(process.argv[3], out);
console.log('bundle bytes', out.length);
