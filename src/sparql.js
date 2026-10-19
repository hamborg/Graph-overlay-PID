/*! Small SPARQL 1.1 query engine for in-memory RDF/JS-style quads (Graph Overlay Inspector).
    Supports SELECT / ASK / CONSTRUCT / DESCRIBE; basic graph patterns with property paths
    (/ | ^ * + ? !); OPTIONAL, UNION, MINUS, FILTER, BIND, VALUES, sub-SELECT, GRAPH (default graph);
    FILTER (NOT) EXISTS; GROUP BY / HAVING with COUNT SUM AVG MIN MAX SAMPLE GROUP_CONCAT;
    ORDER BY, DISTINCT, REDUCED, LIMIT, OFFSET; most built-in functions. */
var SparqlEngine = (function () {
  'use strict';
  const XSD = 'http://www.w3.org/2001/XMLSchema#', RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  const XS = XSD + 'string', XI = XSD + 'integer', XD = XSD + 'decimal', XDB = XSD + 'double', XB = XSD + 'boolean', LS = RDF + 'langString';
  const NUMERIC = new Set(['integer', 'decimal', 'double', 'float', 'int', 'long', 'short', 'byte', 'nonNegativeInteger', 'positiveInteger', 'negativeInteger',
    'nonPositiveInteger', 'unsignedInt', 'unsignedLong', 'unsignedShort', 'unsignedByte'].map(x => XSD + x));
  const INTEGERS = new Set([...NUMERIC].filter(x => !/(decimal|double|float)$/.test(x)));

  /* ---------------- terms ---------------- */
  const iri = v => ({ termType: 'NamedNode', value: v });
  const lit = (v, lang, dt) => ({ termType: 'Literal', value: String(v), language: lang || '', datatype: iri(lang ? LS : dt || XS) });
  const blank = v => ({ termType: 'BlankNode', value: v });
  const TRUE = lit('true', '', XB), FALSE = lit('false', '', XB);
  const bool = b => (b ? TRUE : FALSE);
  const dtOf = t => (t.termType === 'Literal' ? (t.language ? LS : (t.datatype && t.datatype.value) || XS) : null);
  function tkey(t) {
    if (!t) return '';
    if (t.termType === 'NamedNode') return 'I' + t.value;
    if (t.termType === 'BlankNode') return 'B' + t.value;
    return 'L' + t.value + '\u0001' + (t.language || '').toLowerCase() + '\u0001' + (t.language ? '' : dtOf(t));
  }
  class SparqlError extends Error {}
  class EvalError extends Error {}
  const fail = m => { throw new EvalError(m); };

  /* ---------------- tokenizer ---------------- */
  const PN_CH = 'A-Za-z0-9_\\u00B7\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u203F-\\u2040\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD';
  const ESC = "%[0-9A-Fa-f]{2}|\\\\[_~.\\-!$&'()*+,;=/?#@%]";
  const RX = {
    ws: /(?:\s+|#[^\n]*)+/y,
    iriref: /<([^<>"{}|^`\\\x00-\x20]*)>/y,
    vari: new RegExp(`[?$]([${PN_CH}]+)`, 'y'),
    str3d: /"""((?:[^"\\]|\\[\s\S]|"(?!""))*)"""/y,
    str3s: /'''((?:[^'\\]|\\[\s\S]|'(?!''))*)'''/y,
    strd: /"((?:[^"\\\n\r]|\\.)*)"/y,
    strs: /'((?:[^'\\\n\r]|\\.)*)'/y,
    lang: /@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*)/y,
    num: /[0-9]+\.[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+[eE][+-]?[0-9]+|[0-9]+/y,
    bnode: new RegExp(`_:([${PN_CH}](?:[${PN_CH}.-]*[${PN_CH}-])?)`, 'y'),
    pname: new RegExp(`([A-Za-z](?:[${PN_CH}.-]*[${PN_CH}-])?)?:((?:[${PN_CH}:]|${ESC})(?:(?:[${PN_CH}.:-]|${ESC})*(?:[${PN_CH}:-]|${ESC}))?)?`, 'y'),
    word: /[A-Za-z_][A-Za-z0-9_]*/y,
    punct: /\^\^|&&|\|\||!=|<=|>=|[{}()[\].,;|/^*+?!=<>-]/y,
  };
  const unesc = s => s.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[tbnrf"'\\])/g, (m, c) => {
    if (c[0] === 'u' || c[0] === 'U') return String.fromCodePoint(parseInt(c.slice(1), 16));
    return { t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' }[c];
  });
  function tokenize(src) {
    const toks = [];
    let i = 0;
    const at = re => { re.lastIndex = i; const m = re.exec(src); return m && m.index === i ? m : null; };
    while (i < src.length) {
      let m = at(RX.ws);
      if (m) { i += m[0].length; continue; }
      const pos = i;
      const push = (t, v, len, extra) => { toks.push({ t, v, pos, ...extra }); i += len; };
      if ((m = at(RX.iriref))) { push('IRI', m[1], m[0].length); continue; }
      if ((m = at(RX.vari))) { push('VAR', m[1], m[0].length); continue; }
      if ((m = at(RX.str3d)) || (m = at(RX.str3s)) || (m = at(RX.strd)) || (m = at(RX.strs))) { push('STR', unesc(m[1]), m[0].length); continue; }
      if ((m = at(RX.lang)) && toks.length && toks[toks.length - 1].t === 'STR') { push('LANG', m[1], m[0].length); continue; }
      if ((m = at(RX.num))) { push('NUM', m[0], m[0].length, { dt: /[eE]/.test(m[0]) ? XDB : m[0].includes('.') ? XD : XI }); continue; }
      if ((m = at(RX.bnode))) { push('BNODE', m[1], m[0].length); continue; }
      if ((m = at(RX.pname))) { push('PNAME', (m[2] || '').replace(/\\(.)/g, '$1'), m[0].length, { pfx: m[1] || '' }); continue; }
      if ((m = at(RX.word))) { push('WORD', m[0], m[0].length, { up: m[0].toUpperCase() }); continue; }
      if ((m = at(RX.punct))) { push('P', m[0], m[0].length); continue; }
      throw new SparqlError(`Unexpected character "${src[i]}" at ${lineCol(src, i)}`);
    }
    toks.push({ t: 'EOF', v: '', pos: src.length });
    return toks;
  }
  function lineCol(src, pos) {
    const before = src.slice(0, pos), line = before.split('\n').length, col = pos - before.lastIndexOf('\n');
    return `line ${line}, column ${col}`;
  }

  /* ---------------- parser ---------------- */
  const AGGS = new Set(['COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'SAMPLE', 'GROUP_CONCAT']);
  const BUILTINS = new Set(['STR', 'LANG', 'LANGMATCHES', 'DATATYPE', 'BOUND', 'IRI', 'URI', 'BNODE', 'RAND', 'ABS', 'CEIL', 'FLOOR', 'ROUND', 'CONCAT',
    'STRLEN', 'UCASE', 'LCASE', 'ENCODE_FOR_URI', 'CONTAINS', 'STRSTARTS', 'STRENDS', 'STRBEFORE', 'STRAFTER', 'YEAR', 'MONTH', 'DAY', 'HOURS', 'MINUTES',
    'SECONDS', 'TIMEZONE', 'TZ', 'NOW', 'UUID', 'STRUUID', 'MD5', 'SHA1', 'SHA256', 'SHA384', 'SHA512', 'COALESCE', 'IF', 'STRLANG', 'STRDT', 'SAMETERM',
    'ISIRI', 'ISURI', 'ISBLANK', 'ISLITERAL', 'ISNUMERIC', 'REGEX', 'SUBSTR', 'REPLACE']);
  function parse(src, defaultPrefixes) {
    const toks = tokenize(src);
    let k = 0, bn = 0;
    const prefixes = {};
    let base = null;
    const peek = (o = 0) => toks[k + o];
    const next = () => toks[k++];
    const isW = (w, o = 0) => peek(o).t === 'WORD' && peek(o).up === w;
    const isP = (p, o = 0) => peek(o).t === 'P' && peek(o).v === p;
    const err = (msg, t = peek()) => { throw new SparqlError(`${msg} at ${lineCol(src, t.pos)}${t.t === 'EOF' ? ' (end of query)' : ` near "${src.slice(t.pos, t.pos + 18).split('\n')[0]}"`}`); };
    const expectP = p => { if (!isP(p)) err(`Expected "${p}"`); return next(); };
    const expectW = w => { if (!isW(w)) err(`Expected ${w}`); return next(); };
    const acceptP = p => (isP(p) ? next() : null);
    const acceptW = w => (isW(w) ? next() : null);
    const resolveIri = v => {
      if (!base || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(v)) return v;
      try { return new URL(v, base).href; } catch { return base + v; }
    };
    const pnameIri = t => {
      const ns = t.pfx in prefixes ? prefixes[t.pfx] : defaultPrefixes && t.pfx in defaultPrefixes ? defaultPrefixes[t.pfx] : null;
      if (ns == null) err(`Unknown prefix "${t.pfx}:"`, t);
      return ns + t.v;
    };
    const iriTok = () => {
      const t = peek();
      if (t.t === 'IRI') { next(); return resolveIri(t.v); }
      if (t.t === 'PNAME') { next(); return pnameIri(t); }
      return null;
    };
    const freshVar = () => ({ var: '_:b' + (++bn) });

    function prologue() {
      for (;;) {
        if (acceptW('PREFIX')) {
          const t = next();
          if (t.t !== 'PNAME' || t.v !== '') err('Expected a prefix name such as "ex:"', t);
          const i2 = peek(); if (i2.t !== 'IRI') err('Expected <IRI>'); next();
          prefixes[t.pfx] = resolveIri(i2.v);
        } else if (acceptW('BASE')) {
          const i2 = next(); if (i2.t !== 'IRI') err('Expected <IRI>', i2); base = i2.v;
        } else break;
      }
    }
    function query() {
      prologue();
      let q;
      if (isW('SELECT')) q = selectQuery(false);
      else if (acceptW('ASK')) { datasetClauses(); acceptW('WHERE'); q = { type: 'ASK', where: groupPattern() }; modifiers(q); }
      else if (acceptW('CONSTRUCT')) {
        q = { type: 'CONSTRUCT' };
        if (isP('{')) { q.template = constructTemplate(); datasetClauses(); expectW('WHERE'); q.where = groupPattern(); }
        else { datasetClauses(); expectW('WHERE'); expectP('{'); const tr = triplesBlockUntil('}'); expectP('}'); q.template = tr; q.where = { type: 'group', elems: [{ type: 'bgp', triples: tr }] }; }
        modifiers(q);
      } else if (acceptW('DESCRIBE')) {
        q = { type: 'DESCRIBE', targets: [] };
        if (acceptP('*')) q.star = true;
        else while (peek().t === 'VAR' || peek().t === 'IRI' || peek().t === 'PNAME') q.targets.push(peek().t === 'VAR' ? { var: next().v } : iri(iriTok()));
        datasetClauses();
        if (acceptW('WHERE') || isP('{')) q.where = groupPattern();
        modifiers(q);
      } else err('Expected SELECT, ASK, CONSTRUCT or DESCRIBE');
      if (acceptW('VALUES')) q.values = dataBlock();
      if (peek().t !== 'EOF') err('Unexpected text after the query');
      q.prefixes = prefixes;
      return q;
    }
    function datasetClauses() { while (acceptW('FROM')) { acceptW('NAMED'); if (!iriTok()) err('Expected <IRI> after FROM'); } }
    function selectQuery(sub) {
      expectW('SELECT');
      const q = { type: 'SELECT', projection: [], distinct: false, reduced: false };
      if (acceptW('DISTINCT')) q.distinct = true; else if (acceptW('REDUCED')) q.reduced = true;
      if (acceptP('*')) q.star = true;
      else {
        for (;;) {
          if (peek().t === 'VAR') q.projection.push({ var: next().v });
          else if (isP('(')) { next(); const e = expression(); expectW('AS'); const v = next(); if (v.t !== 'VAR') err('Expected ?variable after AS', v); expectP(')'); q.projection.push({ var: v.v, expr: e }); }
          else break;
        }
        if (!q.projection.length) err('Expected * or variables after SELECT');
      }
      if (!sub) datasetClauses();
      acceptW('WHERE');
      q.where = groupPattern();
      modifiers(q);
      if (sub && acceptW('VALUES')) q.values = dataBlock();
      return q;
    }
    function modifiers(q) {
      if (isW('GROUP') && isW('BY', 1)) {
        next(); next(); q.groupBy = [];
        for (;;) {
          if (peek().t === 'VAR') q.groupBy.push({ expr: { type: 'var', name: next().v } });
          else if (isP('(')) { next(); const e = expression(); let v = null; if (acceptW('AS')) { const t = next(); if (t.t !== 'VAR') err('Expected ?variable', t); v = t.v; } expectP(')'); q.groupBy.push({ expr: e, var: v }); }
          else if (peek().t === 'WORD' && (BUILTINS.has(peek().up) || peek().up === 'NOT')) q.groupBy.push({ expr: primary() });
          else if (peek().t === 'IRI' || peek().t === 'PNAME') q.groupBy.push({ expr: primary() });
          else break;
        }
        if (!q.groupBy.length) err('Expected a GROUP BY condition');
      }
      if (acceptW('HAVING')) { q.having = []; while (isP('(') || (peek().t === 'WORD' && BUILTINS.has(peek().up))) q.having.push(isP('(') ? bracketted() : primary()); }
      if (isW('ORDER') && isW('BY', 1)) {
        next(); next(); q.orderBy = [];
        for (;;) {
          if (isW('ASC') || isW('DESC')) { const d = next().up === 'DESC'; q.orderBy.push({ expr: bracketted(), desc: d }); }
          else if (peek().t === 'VAR') q.orderBy.push({ expr: { type: 'var', name: next().v }, desc: false });
          else if (isP('(')) q.orderBy.push({ expr: bracketted(), desc: false });
          else if (peek().t === 'WORD' && BUILTINS.has(peek().up)) q.orderBy.push({ expr: primary(), desc: false });
          else break;
        }
        if (!q.orderBy.length) err('Expected an ORDER BY condition');
      }
      for (let r = 0; r < 2; r++) {
        if (acceptW('LIMIT')) { const t = next(); if (t.t !== 'NUM') err('Expected a number', t); q.limit = parseInt(t.v, 10); }
        else if (acceptW('OFFSET')) { const t = next(); if (t.t !== 'NUM') err('Expected a number', t); q.offset = parseInt(t.v, 10); }
      }
    }
    function dataBlock() {
      const vars = [], rows = [];
      if (peek().t === 'VAR') {
        vars.push(next().v);
        expectP('{');
        while (!isP('}')) rows.push({ [vars[0]]: dataValue() });
        expectP('}');
      } else {
        expectP('(');
        while (peek().t === 'VAR') vars.push(next().v);
        expectP(')'); expectP('{');
        while (!isP('}')) {
          expectP('(');
          const row = {};
          for (const v of vars) { const val = dataValue(); if (val) row[v] = val; }
          expectP(')');
          rows.push(row);
        }
        expectP('}');
      }
      return { vars, rows };
    }
    function dataValue() {
      if (acceptW('UNDEF')) return null;
      const t = term(false);
      if (!t || t.var) err('Expected a value');
      return t;
    }
    function constructTemplate() {
      expectP('{');
      const tr = triplesBlockUntil('}');
      expectP('}');
      return tr;
    }
    function triplesBlockUntil(end) {
      const triples = [];
      while (!isP(end)) {
        triplesSameSubject(triples);
        if (!acceptP('.')) break;
      }
      return triples;
    }
    function groupPattern() {
      expectP('{');
      if (isW('SELECT')) { const sq = selectQuery(true); expectP('}'); return { type: 'group', elems: [{ type: 'subquery', query: sq }] }; }
      const elems = [];
      let bgp = null;
      const flush = () => { if (bgp && bgp.triples.length) elems.push(bgp); bgp = null; };
      while (!isP('}')) {
        if (peek().t === 'EOF') err('Missing "}"');
        if (isP('{')) {
          flush();
          const first = groupPattern(), alts = [first];
          while (acceptW('UNION')) alts.push(groupPattern());
          elems.push(alts.length > 1 ? { type: 'union', patterns: alts } : { type: 'group', pattern: first });
        } else if (acceptW('OPTIONAL')) { flush(); elems.push({ type: 'optional', pattern: groupPattern() }); }
        else if (acceptW('MINUS')) { flush(); elems.push({ type: 'minus', pattern: groupPattern() }); }
        else if (acceptW('GRAPH')) { flush(); if (peek().t === 'VAR') next(); else if (!iriTok()) err('Expected a graph name'); elems.push({ type: 'group', pattern: groupPattern() }); }
        else if (acceptW('SERVICE')) err('SERVICE (federated queries) is not supported here');
        else if (acceptW('FILTER')) { flush(); elems.push({ type: 'filter', expr: constraint() }); }
        else if (acceptW('BIND')) { flush(); expectP('('); const e = expression(); expectW('AS'); const v = next(); if (v.t !== 'VAR') err('Expected ?variable', v); expectP(')'); elems.push({ type: 'bind', expr: e, var: v.v }); }
        else if (acceptW('VALUES')) { flush(); elems.push({ type: 'values', data: dataBlock() }); }
        else {
          if (!bgp) bgp = { type: 'bgp', triples: [] };
          triplesSameSubject(bgp.triples);
          if (!acceptP('.') && !isP('}') && !isP('{') && !(peek().t === 'WORD' && ['OPTIONAL', 'MINUS', 'GRAPH', 'FILTER', 'BIND', 'VALUES', 'SERVICE'].includes(peek().up))) err('Expected "." or "}"');
          continue;
        }
        acceptP('.');
      }
      flush();
      expectP('}');
      return { type: 'group', elems };
    }
    function triplesSameSubject(out) {
      let s;
      if (isP('[') && !isP(']', 1)) { s = blankPropertyList(out); if (isP('.') || isP('}')) return; }
      else if (isP('(')) { s = collection(out); }
      else s = term(true);
      if (!s) err('Expected a subject');
      propertyList(s, out);
    }
    function propertyList(s, out) {
      for (;;) {
        const p = verb();
        for (;;) {
          const o = objectTerm(out);
          out.push({ s, p, o });
          if (!acceptP(',')) break;
        }
        if (!acceptP(';')) break;
        while (acceptP(';')) { /* empty ; ; */ }
        if (isP('.') || isP('}') || isP(']')) break;
      }
    }
    function objectTerm(out) {
      if (isP('[') && !isP(']', 1)) return blankPropertyList(out);
      if (isP('(')) return collection(out);
      const t = term(true);
      if (!t) err('Expected an object');
      return t;
    }
    function blankPropertyList(out) {
      expectP('[');
      const b = freshVar();
      propertyList(b, out);
      expectP(']');
      return b;
    }
    function collection(out) {
      expectP('(');
      const items = [];
      while (!isP(')')) items.push(objectTerm(out));
      expectP(')');
      if (!items.length) return iri(RDF + 'nil');
      const head = freshVar();
      let cur = head;
      items.forEach((it, i) => {
        out.push({ s: cur, p: { type: 'iri', iri: RDF + 'first' }, o: it });
        const nx = i === items.length - 1 ? iri(RDF + 'nil') : freshVar();
        out.push({ s: cur, p: { type: 'iri', iri: RDF + 'rest' }, o: nx });
        cur = nx;
      });
      return head;
    }
    function verb() {
      if (peek().t === 'VAR') return { var: next().v };
      return path();
    }
    function path() {
      const alts = [pathSeq()];
      while (acceptP('|')) alts.push(pathSeq());
      return alts.length > 1 ? { type: 'alt', items: alts } : alts[0];
    }
    function pathSeq() {
      const items = [pathEltOrInv()];
      while (acceptP('/')) items.push(pathEltOrInv());
      return items.length > 1 ? { type: 'seq', items } : items[0];
    }
    function pathEltOrInv() {
      if (acceptP('^')) return { type: 'inv', path: pathElt() };
      return pathElt();
    }
    function pathElt() {
      let p = pathPrimary();
      if (isP('*') || isP('+') || isP('?')) p = { type: 'mod', mod: next().v, path: p };
      return p;
    }
    function pathPrimary() {
      if (acceptP('(')) { const p = path(); expectP(')'); return p; }
      if (acceptP('!')) {
        const items = [];
        const one = () => { const inv = !!acceptP('^'); const i2 = isW('A') || isW('a') ? (next(), RDF + 'type') : iriTok(); if (!i2) err('Expected an IRI in the negated property set'); items.push({ iri: i2, inv }); };
        if (acceptP('(')) { if (!isP(')')) { one(); while (acceptP('|')) one(); } expectP(')'); } else one();
        return { type: 'neg', items };
      }
      if (peek().t === 'WORD' && peek().v === 'a') { next(); return { type: 'iri', iri: RDF + 'type' }; }
      const i2 = iriTok();
      if (!i2) err('Expected a predicate');
      return { type: 'iri', iri: i2 };
    }
    function term(allowVar) {
      const t = peek();
      if (t.t === 'VAR') { if (!allowVar) err('Variables are not allowed here', t); next(); return { var: t.v }; }
      if (t.t === 'IRI' || t.t === 'PNAME') return iri(iriTok());
      if (t.t === 'BNODE') { next(); return { var: '_:' + t.v }; }
      if (t.t === 'P' && t.v === '[' && isP(']', 1)) { next(); next(); return freshVar(); }
      if (t.t === 'STR') return literal();
      if (t.t === 'NUM') { next(); return lit(t.v, '', t.dt); }
      if (t.t === 'P' && (t.v === '-' || t.v === '+') && peek(1).t === 'NUM') { next(); const n = next(); return lit((t.v === '-' ? '-' : '') + n.v, '', n.dt); }
      if (t.t === 'WORD' && (t.up === 'TRUE' || t.up === 'FALSE')) { next(); return bool(t.up === 'TRUE'); }
      return null;
    }
    function literal() {
      const t = next();
      if (peek().t === 'LANG') return lit(t.v, next().v.toLowerCase());
      if (acceptP('^^')) { const d = iriTok(); if (!d) err('Expected a datatype IRI'); return lit(t.v, '', d); }
      return lit(t.v);
    }
    /* expressions */
    function constraint() {
      if (isP('(')) return bracketted();
      if (peek().t === 'WORD' && (BUILTINS.has(peek().up) || peek().up === 'NOT' || peek().up === 'EXISTS')) return primary();
      if (peek().t === 'IRI' || peek().t === 'PNAME') return primary();
      err('Expected a FILTER condition');
    }
    function bracketted() { expectP('('); const e = expression(); expectP(')'); return e; }
    function expression() {
      let e = andExpr();
      while (acceptP('||')) e = { type: 'op', op: '||', args: [e, andExpr()] };
      return e;
    }
    function andExpr() {
      let e = relExpr();
      while (acceptP('&&')) e = { type: 'op', op: '&&', args: [e, relExpr()] };
      return e;
    }
    function relExpr() {
      const e = addExpr();
      for (const op of ['=', '!=', '<=', '>=', '<', '>']) if (isP(op)) { next(); return { type: 'op', op, args: [e, addExpr()] }; }
      if (isW('IN')) { next(); return { type: 'in', not: false, expr: e, list: exprList() }; }
      if (isW('NOT') && isW('IN', 1)) { next(); next(); return { type: 'in', not: true, expr: e, list: exprList() }; }
      return e;
    }
    function exprList() {
      expectP('(');
      const l = [];
      if (!isP(')')) { l.push(expression()); while (acceptP(',')) l.push(expression()); }
      expectP(')');
      return l;
    }
    function addExpr() {
      let e = mulExpr();
      for (;;) {
        if (isP('+') || isP('-')) { const op = next().v; e = { type: 'op', op, args: [e, mulExpr()] }; }
        else break;
      }
      return e;
    }
    function mulExpr() {
      let e = unary();
      while (isP('*') || isP('/')) { const op = next().v; e = { type: 'op', op, args: [e, unary()] }; }
      return e;
    }
    function unary() {
      if (acceptP('!')) return { type: 'op', op: '!', args: [unary()] };
      if (acceptP('-')) return { type: 'op', op: 'neg', args: [unary()] };
      if (acceptP('+')) return unary();
      return primary();
    }
    function primary() {
      const t = peek();
      if (isP('(')) return bracketted();
      if (t.t === 'VAR') { next(); return { type: 'var', name: t.v }; }
      if (t.t === 'WORD') {
        const up = t.up;
        if (up === 'TRUE' || up === 'FALSE') { next(); return { type: 'term', term: bool(up === 'TRUE') }; }
        if (up === 'NOT' && isW('EXISTS', 1)) { next(); next(); return { type: 'exists', not: true, pattern: groupPattern() }; }
        if (up === 'EXISTS') { next(); return { type: 'exists', not: false, pattern: groupPattern() }; }
        if (AGGS.has(up)) {
          next(); expectP('(');
          const a = { type: 'agg', name: up, distinct: !!acceptW('DISTINCT') };
          if (up === 'COUNT' && acceptP('*')) a.star = true; else a.expr = expression();
          if (up === 'GROUP_CONCAT' && acceptP(';')) { expectW('SEPARATOR'); expectP('='); const s = next(); if (s.t !== 'STR') err('Expected a string', s); a.sep = s.v; }
          expectP(')');
          return a;
        }
        if (BUILTINS.has(up)) {
          next();
          if (up === 'BOUND') { expectP('('); const v = next(); if (v.t !== 'VAR') err('BOUND needs a ?variable', v); expectP(')'); return { type: 'fn', name: 'BOUND', args: [{ type: 'var', name: v.v }] }; }
          if ((up === 'NOW' || up === 'RAND' || up === 'UUID' || up === 'STRUUID') ) { expectP('('); expectP(')'); return { type: 'fn', name: up, args: [] }; }
          if (up === 'BNODE') { expectP('('); const args = isP(')') ? [] : [expression()]; expectP(')'); return { type: 'fn', name: up, args }; }
          return { type: 'fn', name: up, args: exprList() };
        }
        err(`Unknown function or keyword "${t.v}"`);
      }
      if (t.t === 'IRI' || t.t === 'PNAME') {
        const i2 = iriTok();
        if (isP('(')) return { type: 'fn', name: 'IRICALL', iri: i2, args: exprList() };
        return { type: 'term', term: iri(i2) };
      }
      const lt = term(false);
      if (lt) return { type: 'term', term: lt };
      err('Expected an expression');
    }
    return query();
  }

  /* ---------------- store ---------------- */
  function makeStore(quads) {
    const all = [], byS = new Map(), byP = new Map(), byO = new Map(), seen = new Set();
    const add = (m, k, t) => { let a = m.get(k); if (!a) m.set(k, a = []); a.push(t); };
    for (const q of quads) {
      const t = { s: q.subject, p: q.predicate, o: q.object };
      const k = tkey(t.s) + ' ' + tkey(t.p) + ' ' + tkey(t.o);
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(t); add(byS, tkey(t.s), t); add(byP, tkey(t.p), t); add(byO, tkey(t.o), t);
    }
    const match = (s, p, o) => {
      let cand = all;
      for (const [m, x] of [[byS, s], [byO, o], [byP, p]]) if (x) { const a = m.get(tkey(x)) || []; if (a.length < cand.length) cand = a; }
      const sk = s && tkey(s), pk = p && tkey(p), ok = o && tkey(o);
      return cand.filter(t => (!sk || tkey(t.s) === sk) && (!pk || tkey(t.p) === pk) && (!ok || tkey(t.o) === ok));
    };
    let nodesCache = null;
    const nodes = () => {
      if (nodesCache) return nodesCache;
      const m = new Map();
      for (const t of all) { m.set(tkey(t.s), t.s); m.set(tkey(t.o), t.o); }
      return (nodesCache = [...m.values()]);
    };
    return { all, match, nodes, size: all.length };
  }


  /* ---------------- owl:sameAs as identity (OWL 2 RL eq-sym, eq-trans, eq-rep-s/p/o) ----------------
     Members of one sameAs class are interchangeable: every triple about one member holds for all of them. */
  const SAME_AS = 'http://www.w3.org/2002/07/owl#sameAs';
  function sameAsClosure(quads, limit) {
    const parent = new Map(), term = new Map();
    const find = k => { let r = k; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(k) !== r) { const n = parent.get(k); parent.set(k, r); k = n; } return r; };
    const node = t => { const k = tkey(t); if (!parent.has(k)) { parent.set(k, k); term.set(k, t); } return k; };
    let links = 0;
    for (const q of quads) {
      if (q.predicate.value !== SAME_AS || q.object.termType === 'Literal' || q.subject.termType === 'Literal') continue;
      const a = find(node(q.subject)), b = find(node(q.object));
      links++;
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    }
    const classes = new Map();
    for (const k of parent.keys()) { const r = find(k); let c = classes.get(r); if (!c) classes.set(r, c = []); c.push(term.get(k)); }
    for (const [r, c] of classes) if (c.length < 2) classes.delete(r);
    const members = new Map();
    for (const c of classes.values()) for (const t of c) members.set(tkey(t), c);
    if (!members.size) return { quads, classes: 0, inferred: 0, links, members };
    const alts = t => members.get(tkey(t)) || [t];
    const out = [], seen = new Set();
    const push = (s, p, o) => {
      const k = tkey(s) + ' ' + tkey(p) + ' ' + tkey(o);
      if (seen.has(k)) return;
      seen.add(k); out.push({ subject: s, predicate: p, object: o });
      if (out.length > limit) throw new SparqlError(`owl:sameAs reasoning would produce more than ${limit.toLocaleString()} triples — switch it off or reduce the sameAs links.`);
    };
    const sameP = { termType: 'NamedNode', value: SAME_AS };
    for (const q of quads) {
      if (q.predicate.value === SAME_AS) continue;
      for (const s2 of alts(q.subject)) for (const p2 of alts(q.predicate)) for (const o2 of alts(q.object)) push(s2, p2, o2);
    }
    for (const c of classes.values()) for (const a of c) for (const b of c) push(a, sameP, b);
    for (const q of quads) if (q.predicate.value === SAME_AS) push(q.subject, q.predicate, q.object);   /* sameAs to literals etc. stays as asserted */
    let base = 0; { const bs = new Set(); for (const q of quads) { const k = tkey(q.subject) + ' ' + tkey(q.predicate) + ' ' + tkey(q.object); if (!bs.has(k)) { bs.add(k); base++; } } }
    return { quads: out, classes: classes.size, inferred: Math.max(0, out.length - base), links, members };
  }

  /* ---------------- evaluation ---------------- */
  function run(src, quads, opts = {}) {
    const q = parse(src, opts.prefixes || {});
    let same = null;
    if (opts.sameAs) { same = sameAsClosure(quads, opts.sameAsLimit || 3e6); quads = same.quads; }
    const store = makeStore(quads);
    let steps = 0;
    const MAX = opts.maxSteps || 4e7;
    const tick = n => { steps += n || 1; if (steps > MAX) throw new SparqlError('The query is too expensive to run here — add more constraints or a LIMIT.'); };
    let bnodeSeq = 0;

    const isVar = x => x && typeof x.var === 'string';
    const compatible = (a, b) => { for (const k in a) if (k in b && tkey(a[k]) !== tkey(b[k])) return false; return true; };
    const merge = (a, b) => Object.assign({}, a, b);
    function join(left, right) {
      const out = [];
      for (const a of left) for (const b of right) { tick(); if (compatible(a, b)) out.push(merge(a, b)); }
      return out;
    }

    /* property paths: list of [subject, object] pairs */
    function pathPairs(p, s, o) {
      tick();
      switch (p.type) {
        case 'iri': return store.match(s, iri(p.iri), o).map(t => [t.s, t.o]);
        case 'inv': return pathPairs(p.path, o, s).map(([a, b]) => [b, a]);
        case 'alt': return dedupe(p.items.flatMap(it => pathPairs(it, s, o)));
        case 'seq': {
          if (!s && o) return pathPairs(invertPath(p), o, null).map(([a, b]) => [b, a]);
          let cur = pathPairs(p.items[0], s, p.items.length === 1 ? o : null);
          for (let i = 1; i < p.items.length; i++) {
            const last = i === p.items.length - 1, nx = [];
            const byMid = new Map();
            for (const [a, m] of cur) { const k = tkey(m); let l = byMid.get(k); if (!l) byMid.set(k, l = { m, starts: [] }); l.starts.push(a); }
            for (const { m, starts } of byMid.values()) for (const [, e] of pathPairs(p.items[i], m, last ? o : null)) for (const a of starts) { tick(); nx.push([a, e]); }
            cur = dedupe(nx);
          }
          return cur;
        }
        case 'mod': {
          if (p.mod === '?') {
            const one = pathPairs(p.path, s, o);
            const zero = s && o ? (tkey(s) === tkey(o) ? [[s, o]] : []) : s ? [[s, s]] : o ? [[o, o]] : store.nodes().map(n => [n, n]);
            return dedupe([...zero, ...one]);
          }
          if (!s && o) return pathPairs({ type: 'mod', mod: p.mod, path: invertPath(p.path) }, o, null).map(([a, b]) => [b, a]);
          const starts = s ? [s] : store.nodes();
          const out = [];
          for (const st of starts) {
            const seen = new Map();
            if (p.mod === '*') seen.set(tkey(st), st);
            let frontier = [st];
            while (frontier.length) {
              const nx = [];
              for (const x of frontier) for (const [, y] of pathPairs(p.path, x, null)) { const k = tkey(y); if (!seen.has(k)) { seen.set(k, y); nx.push(y); } }
              frontier = nx;
            }
            for (const y of seen.values()) if (!o || tkey(y) === tkey(o)) out.push([st, y]);
          }
          return out;
        }
        case 'neg': {
          const fwd = new Set(p.items.filter(x => !x.inv).map(x => x.iri)), inv = new Set(p.items.filter(x => x.inv).map(x => x.iri));
          const out = [];
          if (fwd.size || !inv.size) for (const t of store.match(s, null, o)) if (!fwd.has(t.p.value)) out.push([t.s, t.o]);
          if (inv.size) for (const t of store.match(o, null, s)) if (!inv.has(t.p.value)) out.push([t.o, t.s]);
          return out;
        }
        default: throw new SparqlError('Unsupported path');
      }
    }
    function invertPath(p) {
      switch (p.type) {
        case 'iri': return { type: 'inv', path: p };
        case 'inv': return p.path;
        case 'seq': return { type: 'seq', items: p.items.slice().reverse().map(invertPath) };
        case 'alt': return { type: 'alt', items: p.items.map(invertPath) };
        case 'mod': return { type: 'mod', mod: p.mod, path: invertPath(p.path) };
        case 'neg': return { type: 'neg', items: p.items.map(x => ({ iri: x.iri, inv: !x.inv })) };
        default: return p;
      }
    }
    function dedupe(pairs) {
      const m = new Map();
      for (const pr of pairs) m.set(tkey(pr[0]) + ' ' + tkey(pr[1]), pr);
      return [...m.values()];
    }

    const val = (x, sol) => (isVar(x) ? sol[x.var] || null : x);
    function evalBGP(triples, input) {
      let sols = input;
      const remaining = triples.slice();
      while (remaining.length) {
        /* most-bound triple pattern first */
        const bound = new Set(sols.length ? Object.keys(sols[0]) : []);
        let bi = 0, bs = -1;
        remaining.forEach((t, i) => {
          const sc = (!isVar(t.s) || bound.has(t.s.var) ? 2 : 0) + (!isVar(t.o) || bound.has(t.o.var) ? 2 : 0) + (isVar(t.p) ? (bound.has(t.p.var) ? 1 : 0) : 1) + (t.p.type === 'iri' ? 0.5 : 0);
          if (sc > bs) { bs = sc; bi = i; }
        });
        const tp = remaining.splice(bi, 1)[0];
        const out = [];
        for (const sol of sols) {
          const s = val(tp.s, sol), o = val(tp.o, sol);
          if (isVar(tp.p)) {
            const pb = sol[tp.p.var] || null;
            for (const t of store.match(s, pb, o)) {
              tick();
              const ns = { ...sol };
              if (bindVar(ns, tp.s, t.s) && bindVar(ns, tp.p, t.p) && bindVar(ns, tp.o, t.o)) out.push(ns);
            }
          } else {
            for (const [a, b] of pathPairs(tp.p, s, o)) {
              tick();
              const ns = { ...sol };
              if (bindVar(ns, tp.s, a) && bindVar(ns, tp.o, b)) out.push(ns);
            }
          }
        }
        sols = out;
        if (!sols.length) break;
      }
      return sols;
    }
    function bindVar(sol, pat, t) {
      if (!isVar(pat)) return true;
      const cur = sol[pat.var];
      if (cur) return tkey(cur) === tkey(t);
      sol[pat.var] = t;
      return true;
    }
    function evalGroup(g, input) {
      let sols = input;
      const filters = [];
      for (const el of g.elems) {
        if (!sols.length && el.type !== 'filter') break;
        switch (el.type) {
          case 'bgp': sols = evalBGP(el.triples, sols); break;
          case 'filter': filters.push(el.expr); break;
          case 'optional': {
            const out = [];
            for (const s of sols) { const r = evalGroup(el.pattern, [s]); if (r.length) out.push(...r); else out.push(s); }
            sols = out; break;
          }
          case 'union': { const out = []; for (const br of el.patterns) out.push(...evalGroup(br, sols)); sols = out; break; }
          case 'minus': {
            const right = evalGroup(el.pattern, [{}]);
            sols = sols.filter(s => !right.some(r => { tick(); let shared = false; for (const k in r) if (k in s) { shared = true; if (tkey(r[k]) !== tkey(s[k])) return false; } return shared; }));
            break;
          }
          case 'bind': sols = sols.map(s => { if (s[el.var]) throw new SparqlError(`BIND: ?${el.var} is already bound`); const v = tryEval(el.expr, s); return v ? { ...s, [el.var]: v } : s; }); break;
          case 'values': sols = join(sols, el.data.rows); break;
          case 'group': sols = evalGroup(el.pattern, sols); break;
          case 'subquery': sols = join(sols, selectSolutions(el.query)); break;
          default: break;
        }
      }
      if (filters.length) sols = sols.filter(s => filters.every(f => ebvSafe(f, s)));
      return sols;
    }

    /* expressions */
    const isNum = t => t && t.termType === 'Literal' && NUMERIC.has(dtOf(t));
    const isStrLit = t => t && t.termType === 'Literal' && (dtOf(t) === XS || dtOf(t) === LS);
    const numOf = t => { const v = Number(t.value); if (Number.isNaN(v) && !/^NaN$/.test(t.value)) fail('not a number'); return v; };
    const numDt = (a, b, op) => {
      const da = dtOf(a), db = dtOf(b);
      if (da === XDB || db === XDB || da === XSD + 'float' || db === XSD + 'float') return XDB;
      if (op === '/') return XD;
      if (INTEGERS.has(da) && INTEGERS.has(db)) return XI;
      return XD;
    };
    const mkNum = (v, dt) => {
      if (dt === XI) return lit(String(Math.trunc(v)), '', XI);
      if (dt === XD) { let s = String(Math.round(v * 1e12) / 1e12); if (!s.includes('.') && !/e/i.test(s)) s += '.0'; return lit(s, '', XD); }
      return lit(String(v), '', XDB);
    };
    function ebv(t) {
      if (!t) fail('unbound');
      if (t.termType !== 'Literal') fail('no boolean value');
      const dt = dtOf(t);
      if (dt === XB) return t.value === 'true' || t.value === '1';
      if (NUMERIC.has(dt)) { const v = Number(t.value); return !Number.isNaN(v) && v !== 0; }
      if (dt === XS || dt === LS) return t.value.length > 0;
      fail('no boolean value');
    }
    function ebvSafe(e, s, grp) { try { return ebv(evalExpr(e, s, grp)); } catch (x) { if (x instanceof EvalError) return false; throw x; } }
    function tryEval(e, s, grp) { try { return evalExpr(e, s, grp); } catch (x) { if (x instanceof EvalError) return null; throw x; } }
    const strOf = t => { if (!t) fail('unbound'); if (t.termType === 'BlankNode') fail('blank node'); return t.value; };
    const strArg = t => { if (!t || t.termType !== 'Literal' || !(dtOf(t) === XS || dtOf(t) === LS)) fail('not a string'); return t; };
    const sameStrKind = (base, s) => (base.language ? lit(s, base.language) : lit(s));
    function compare(a, b) {
      if (isNum(a) && isNum(b)) { const x = numOf(a), y = numOf(b); return x < y ? -1 : x > y ? 1 : 0; }
      if (isStrLit(a) && isStrLit(b)) return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
      const da = dtOf(a), db = dtOf(b);
      if (a.termType === 'Literal' && b.termType === 'Literal' && da === db && (da === XB || da === XSD + 'dateTime' || da === XSD + 'date' || da === XSD + 'time')) return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
      fail('not comparable');
    }
    function equal(a, b) {
      if (!a || !b) fail('unbound');
      if (isNum(a) && isNum(b)) return numOf(a) === numOf(b);
      if (a.termType === 'Literal' && b.termType === 'Literal') {
        if (tkey(a) === tkey(b)) return true;
        const da = dtOf(a), db = dtOf(b);
        if ((da === XS || da === LS) && (db === XS || db === LS)) return false;
        if (da === db && (da === XB || da.startsWith(XSD + 'date'))) return a.value === b.value;
        if (da === db) return false;
        if ((da === XS || da === LS || da === XB) && (db === XS || db === LS || db === XB)) return false;
        return false;
      }
      return tkey(a) === tkey(b);
    }
    function regexOf(pat, flags) {
      let f = '';
      let p = pat;
      for (const c of flags || '') { if (c === 'i' || c === 'm' || c === 's') f += c; else if (c === 'x') p = p.replace(/\s+/g, ''); else if (c === 'q') p = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      try { return new RegExp(p, f + 'u'); } catch { try { return new RegExp(p, f); } catch { fail('bad regex'); } }
    }
    function evalExpr(e, s, grp) {
      tick();
      switch (e.type) {
        case 'var': { const v = s[e.name]; if (!v) fail('unbound ?' + e.name); return v; }
        case 'term': return e.term;
        case 'op': {
          const op = e.op;
          if (op === '||') { let err1 = null; try { if (ebv(evalExpr(e.args[0], s, grp))) return TRUE; } catch (x) { if (!(x instanceof EvalError)) throw x; err1 = x; } if (ebv(evalExpr(e.args[1], s, grp))) return TRUE; if (err1) throw err1; return FALSE; }
          if (op === '&&') { let err1 = null; try { if (!ebv(evalExpr(e.args[0], s, grp))) return FALSE; } catch (x) { if (!(x instanceof EvalError)) throw x; err1 = x; } if (!ebv(evalExpr(e.args[1], s, grp))) return FALSE; if (err1) throw err1; return TRUE; }
          if (op === '!') return bool(!ebv(evalExpr(e.args[0], s, grp)));
          if (op === 'neg') { const a = evalExpr(e.args[0], s, grp); if (!isNum(a)) fail('not numeric'); return mkNum(-numOf(a), dtOf(a) === XDB ? XDB : INTEGERS.has(dtOf(a)) ? XI : XD); }
          const a = evalExpr(e.args[0], s, grp), b = evalExpr(e.args[1], s, grp);
          switch (op) {
            case '=': return bool(equal(a, b));
            case '!=': return bool(!equal(a, b));
            case '<': return bool(compare(a, b) < 0);
            case '>': return bool(compare(a, b) > 0);
            case '<=': return bool(compare(a, b) <= 0);
            case '>=': return bool(compare(a, b) >= 0);
            default: {
              if (!isNum(a) || !isNum(b)) fail('not numeric');
              const x = numOf(a), y = numOf(b), dt = numDt(a, b, op);
              if (op === '+') return mkNum(x + y, dt);
              if (op === '-') return mkNum(x - y, dt);
              if (op === '*') return mkNum(x * y, dt);
              if (op === '/') { if (y === 0 && dt !== XDB) fail('division by zero'); return mkNum(x / y, dt); }
              fail('bad operator');
            }
          }
        }
        case 'in': {
          const v = evalExpr(e.expr, s, grp);
          let errSeen = null;
          for (const it of e.list) { try { if (equal(v, evalExpr(it, s, grp))) return bool(!e.not); } catch (x) { if (!(x instanceof EvalError)) throw x; errSeen = x; } }
          if (errSeen) throw errSeen;
          return bool(e.not);
        }
        case 'exists': { const r = evalGroup(e.pattern, [s]); return bool(e.not ? !r.length : r.length > 0); }
        case 'agg': return evalAgg(e, grp);
        case 'fn': return evalFn(e, s, grp);
        default: fail('bad expression');
      }
    }
    function evalAgg(e, grp) {
      if (!grp) throw new SparqlError(`${e.name}() can only be used with GROUP BY or in a SELECT that aggregates`);
      let vals;
      if (e.star) vals = grp.map(x => x);
      else { vals = []; for (const s of grp) { const v = tryEval(e.expr, s, null); if (v) vals.push(v); } }
      if (e.distinct) { const m = new Map(); for (const v of vals) m.set(e.star ? JSON.stringify(Object.keys(v).sort().map(k => [k, tkey(v[k])])) : tkey(v), v); vals = [...m.values()]; }
      switch (e.name) {
        case 'COUNT': return lit(String(vals.length), '', XI);
        case 'SUM': { let acc = lit('0', '', XI); for (const v of vals) { if (!isNum(v)) fail('SUM of non-number'); acc = mkNum(numOf(acc) + numOf(v), numDt(acc, v, '+')); } return acc; }
        case 'AVG': { if (!vals.length) return lit('0', '', XI); let acc = 0; for (const v of vals) { if (!isNum(v)) fail('AVG of non-number'); acc += numOf(v); } return mkNum(acc / vals.length, vals.some(v => dtOf(v) === XDB || dtOf(v) === XSD + 'float') ? XDB : XD); }
        case 'MIN': case 'MAX': { if (!vals.length) fail('empty'); let best = vals[0]; for (const v of vals.slice(1)) { const c = orderCmp(v, best); if (e.name === 'MIN' ? c < 0 : c > 0) best = v; } return best; }
        case 'SAMPLE': if (!vals.length) fail('empty'); return vals[0];
        case 'GROUP_CONCAT': return lit(vals.map(v => strOf(v)).join(e.sep != null ? e.sep : ' '));
        default: fail('unknown aggregate');
      }
    }
    function evalFn(e, s, grp) {
      const name = e.name;
      if (name === 'BOUND') return bool(!!s[e.args[0].name]);
      if (name === 'IF') return ebv(evalExpr(e.args[0], s, grp)) ? evalExpr(e.args[1], s, grp) : evalExpr(e.args[2], s, grp);
      if (name === 'COALESCE') { for (const a of e.args) { const v = tryEval(a, s, grp); if (v) return v; } fail('all unbound'); }
      const A = e.args.map(a => evalExpr(a, s, grp));
      const a0 = A[0];
      switch (name) {
        case 'IRICALL': {
          const dt = e.iri;
          if (dt.startsWith(XSD)) {
            const v = a0.termType === 'Literal' ? a0.value : a0.termType === 'NamedNode' && dt === XS ? a0.value : fail('cannot cast');
            if (dt === XS) return lit(v);
            if (dt === XB) { if (/^(true|1)$/i.test(v)) return TRUE; if (/^(false|0)$/i.test(v)) return FALSE; fail('bad boolean'); }
            if (NUMERIC.has(dt)) { const n = Number(v); if (Number.isNaN(n) || v.trim() === '') fail('bad number'); return INTEGERS.has(dt) ? lit(String(Math.trunc(n)), '', dt) : mkNum(n, dt === XD ? XD : XDB); }
            return lit(v, '', dt);
          }
          fail('unknown function <' + dt + '>');
        }
        case 'STR': return lit(strOf(a0));
        case 'LANG': if (a0.termType !== 'Literal') fail('not a literal'); return lit(a0.language || '');
        case 'LANGMATCHES': { const tag = strOf(a0).toLowerCase(), r = strOf(A[1]).toLowerCase(); if (r === '*') return bool(tag !== ''); return bool(tag === r || tag.startsWith(r + '-')); }
        case 'DATATYPE': if (a0.termType !== 'Literal') fail('not a literal'); return iri(dtOf(a0));
        case 'IRI': case 'URI': return a0.termType === 'NamedNode' ? a0 : iri(strOf(a0));
        case 'BNODE': return blank('q' + (++bnodeSeq));
        case 'RAND': return lit(String(Math.random()), '', XDB);
        case 'ABS': case 'CEIL': case 'FLOOR': case 'ROUND': { if (!isNum(a0)) fail('not numeric'); const f = { ABS: Math.abs, CEIL: Math.ceil, FLOOR: Math.floor, ROUND: Math.round }[name]; return mkNum(f(numOf(a0)), INTEGERS.has(dtOf(a0)) ? XI : dtOf(a0) === XDB ? XDB : XD); }
        case 'CONCAT': { const parts = A.map(strArg); const langs = new Set(parts.map(p => p.language || '')); const v = parts.map(p => p.value).join(''); return langs.size === 1 && [...langs][0] ? lit(v, [...langs][0]) : lit(v); }
        case 'STRLEN': return lit(String([...strArg(a0).value].length), '', XI);
        case 'UCASE': strArg(a0); return sameStrKind(a0, a0.value.toUpperCase());
        case 'LCASE': strArg(a0); return sameStrKind(a0, a0.value.toLowerCase());
        case 'ENCODE_FOR_URI': return lit(encodeURIComponent(strOf(a0)));
        case 'CONTAINS': return bool(strArg(a0).value.includes(strArg(A[1]).value));
        case 'STRSTARTS': return bool(strArg(a0).value.startsWith(strArg(A[1]).value));
        case 'STRENDS': return bool(strArg(a0).value.endsWith(strArg(A[1]).value));
        case 'STRBEFORE': { const x = strArg(a0).value, y = strArg(A[1]).value, i = x.indexOf(y); return i < 0 ? lit('') : sameStrKind(a0, x.slice(0, i)); }
        case 'STRAFTER': { const x = strArg(a0).value, y = strArg(A[1]).value, i = x.indexOf(y); return i < 0 ? lit('') : sameStrKind(a0, x.slice(i + y.length)); }
        case 'SUBSTR': { const x = [...strArg(a0).value], st = Math.round(numOf(A[1])), ln = A[2] ? Math.round(numOf(A[2])) : Infinity; const from = Math.max(1, st), to = st + ln; return sameStrKind(a0, x.slice(from - 1, Math.max(from - 1, to - 1)).join('')); }
        case 'REGEX': return bool(regexOf(strOf(A[1]), A[2] ? strOf(A[2]) : '').test(strArg(a0).value));
        case 'REPLACE': { const re = regexOf(strOf(A[1]), A[3] ? strOf(A[3]) : ''); const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); return sameStrKind(a0, strArg(a0).value.replace(g, strOf(A[2]).replace(/\$(\d)/g, '$$$1'))); }
        case 'YEAR': case 'MONTH': case 'DAY': case 'HOURS': case 'MINUTES': case 'SECONDS': {
          const m = /^(-?\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?))?/.exec(strOf(a0));
          if (!m) fail('not a date');
          const idx = { YEAR: 1, MONTH: 2, DAY: 3, HOURS: 4, MINUTES: 5, SECONDS: 6 }[name];
          return name === 'SECONDS' ? lit(String(Number(m[6] || 0)), '', XD) : lit(String(Number(m[idx] || 0)), '', XI);
        }
        case 'TIMEZONE': case 'TZ': { const m = /(Z|[+-]\d{2}:\d{2})$/.exec(strOf(a0)); return lit(m ? (m[1] === 'Z' ? 'Z' : m[1]) : ''); }
        case 'NOW': return lit(new Date().toISOString(), '', XSD + 'dateTime');
        case 'UUID': return iri('urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)));
        case 'STRUUID': return lit(crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
        case 'MD5': case 'SHA1': case 'SHA256': case 'SHA384': case 'SHA512': fail('hash functions are not supported');
        case 'STRLANG': return lit(strArg(a0).value, strOf(A[1]).toLowerCase());
        case 'STRDT': return lit(strArg(a0).value, '', A[1].value);
        case 'SAMETERM': return bool(tkey(a0) === tkey(A[1]));
        case 'ISIRI': case 'ISURI': return bool(a0.termType === 'NamedNode');
        case 'ISBLANK': return bool(a0.termType === 'BlankNode');
        case 'ISLITERAL': return bool(a0.termType === 'Literal');
        case 'ISNUMERIC': return bool(isNum(a0));
        default: fail('unknown function ' + name);
      }
    }
    function orderCmp(a, b) {
      const rank = t => (!t ? 0 : t.termType === 'BlankNode' ? 1 : t.termType === 'NamedNode' ? 2 : 3);
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (!a) return 0;
      if (ra === 3) { try { return compare(a, b); } catch { /* fall back to lexical */ } }
      return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    }
    const hasAgg = e => !!e && (e.type === 'agg' || (e.args || []).some(hasAgg) || (e.expr && e.type !== 'exists' && hasAgg(e.expr)) || (e.list || []).some(hasAgg));

    function selectSolutions(qq) {
      let sols = evalGroup(qq.where, [{}]);
      if (qq.values) sols = join(sols, qq.values.rows);
      const proj = qq.projection || [];
      const aggregating = !!qq.groupBy || !!qq.having || proj.some(p => p.expr && hasAgg(p.expr)) || (qq.orderBy || []).some(o => hasAgg(o.expr));
      let rows;
      if (aggregating) {
        const groups = new Map();
        if (!qq.groupBy) groups.set('', { base: {}, sols });
        else for (const s of sols) {
          const base = {}, parts = [];
          for (const gb of qq.groupBy) {
            const v = tryEval(gb.expr, s, null);
            parts.push(tkey(v));
            const nm = gb.var || (gb.expr.type === 'var' ? gb.expr.name : null);
            if (nm && v) base[nm] = v;
          }
          const k = parts.join('\u0002');
          let g = groups.get(k); if (!g) groups.set(k, g = { base, sols: [] });
          g.sols.push(s);
        }
        rows = [];
        for (const g of groups.values()) {
          const row = { ...g.base };
          for (const p of proj) if (p.expr) { const v = tryEval(p.expr, row, g.sols); if (v) row[p.var] = v; }
          if (qq.having && !qq.having.every(h => ebvSafe(h, row, g.sols))) continue;
          row.__grp = g.sols;
          rows.push(row);
        }
      } else {
        rows = sols;
        if (proj.some(p => p.expr)) rows = rows.map(s => { const r = { ...s }; for (const p of proj) if (p.expr) { if (r[p.var]) throw new SparqlError(`?${p.var} is already bound`); const v = tryEval(p.expr, r, null); if (v) r[p.var] = v; } return r; });
      }
      if (qq.orderBy) {
        const keyed = rows.map(r => ({ r, k: qq.orderBy.map(o => tryEval(o.expr, r, r.__grp || null)) }));
        keyed.sort((x, y) => { for (let i = 0; i < qq.orderBy.length; i++) { const c = orderCmp(x.k[i], y.k[i]); if (c) return qq.orderBy[i].desc ? -c : c; } return 0; });
        rows = keyed.map(x => x.r);
      }
      let vars;
      if (qq.star || !proj.length) {
        const seen = new Set();
        vars = [];
        const visit = g => { for (const el of g.elems) {
          if (el.type === 'bgp') for (const t of el.triples) for (const x of [t.s, t.p, t.o]) if (isVar(x) && !x.var.startsWith('_:') && !seen.has(x.var)) { seen.add(x.var); vars.push(x.var); }
          if (el.pattern) visit(el.pattern);
          if (el.patterns) el.patterns.forEach(visit);
          if (el.type === 'bind' && !seen.has(el.var)) { seen.add(el.var); vars.push(el.var); }
          if (el.type === 'values') for (const v of el.data.vars) if (!seen.has(v)) { seen.add(v); vars.push(v); }
          if (el.type === 'subquery') for (const v of el.query.vars || el.query.projection.map(p => p.var)) if (!seen.has(v)) { seen.add(v); vars.push(v); }
        } };
        visit(qq.where);
      } else vars = proj.map(p => p.var);
      qq.vars = vars;
      let out = rows.map(r => { const o = {}; for (const v of vars) if (r[v]) o[v] = r[v]; return o; });
      if (qq.distinct || qq.reduced) { const m = new Map(); for (const r of out) m.set(vars.map(v => tkey(r[v])).join('\u0002'), r); out = [...m.values()]; }
      if (qq.offset) out = out.slice(qq.offset);
      if (qq.limit != null) out = out.slice(0, qq.limit);
      return out;
    }

    const t0 = Date.now();
    let result;
    if (q.type === 'SELECT') { const rows = selectSolutions(q); result = { type: 'select', vars: q.vars, rows }; }
    else if (q.type === 'ASK') result = { type: 'ask', value: evalGroup(q.where, q.values ? q.values.rows : [{}]).length > 0 };
    else {
      let sols = q.where ? evalGroup(q.where, [{}]) : [{}];
      if (q.values) sols = join(sols, q.values.rows);
      if (q.orderBy) { const keyed = sols.map(r => ({ r, k: q.orderBy.map(o => tryEval(o.expr, r, null)) })); keyed.sort((x, y) => { for (let i = 0; i < q.orderBy.length; i++) { const c = orderCmp(x.k[i], y.k[i]); if (c) return q.orderBy[i].desc ? -c : c; } return 0; }); sols = keyed.map(x => x.r); }
      if (q.offset) sols = sols.slice(q.offset);
      if (q.limit != null) sols = sols.slice(0, q.limit);
      const triples = new Map();
      const addT = (s2, p2, o2) => { if (!s2 || !p2 || !o2 || s2.termType === 'Literal' || p2.termType !== 'NamedNode') return; triples.set(tkey(s2) + ' ' + tkey(p2) + ' ' + tkey(o2), { s: s2, p: p2, o: o2 }); };
      if (q.type === 'CONSTRUCT') {
        for (const s of sols) {
          const bmap = {};
          const inst = x => (isVar(x) ? (x.var.startsWith('_:') ? (bmap[x.var] = bmap[x.var] || blank('c' + (++bnodeSeq))) : s[x.var]) : x);
          for (const t of q.template) addT(inst(t.s), t.p.type === 'iri' ? iri(t.p.iri) : isVar(t.p) ? s[t.p.var] : null, inst(t.o));
        }
        result = { type: 'construct', triples: [...triples.values()] };
      } else {
        const targets = new Map();
        if (q.star) for (const s of sols) for (const v of Object.values(s)) targets.set(tkey(v), v);
        for (const tg of q.targets) { if (isVar(tg)) { for (const s of sols) if (s[tg.var]) targets.set(tkey(s[tg.var]), s[tg.var]); } else targets.set(tkey(tg), tg); }
        for (const tg of targets.values()) if (tg.termType !== 'Literal') for (const t of store.match(tg, null, null)) addT(t.s, t.p, t.o);
        result = { type: 'describe', triples: [...triples.values()] };
      }
    }
    result.ms = Date.now() - t0;
    result.steps = steps;
    if (same) { result.sameAs = { classes: same.classes, inferred: same.inferred, links: same.links }; result.sameMembers = same.members; }
    return result;
  }

  return { run, parse, tokenize, tkey, sameAsClosure, SparqlError };
})();
if (typeof module !== 'undefined') module.exports = SparqlEngine;
