/*! N3.js 2.0.1 (MIT, Ruben Verborgh et al.) — Turtle/TriG/N-Triples/N3 parser, inlined */
var N3Parser = (function () {
  'use strict';
  const namespaces = (function () { const RDF  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    XSD  = 'http://www.w3.org/2001/XMLSchema#',
    SWAP = 'http://www.w3.org/2000/10/swap/';

return {
  xsd: {
    decimal: `${XSD}decimal`,
    boolean: `${XSD}boolean`,
    dateTime: `${XSD}dateTime`,
    double:  `${XSD}double`,
    integer: `${XSD}integer`,
    string:  `${XSD}string`,
  },
  rdf: {
    type:          `${RDF}type`,
    nil:           `${RDF}nil`,
    first:         `${RDF}first`,
    rest:          `${RDF}rest`,
    langString:    `${RDF}langString`,
    dirLangString: `${RDF}dirLangString`,
    reifies:       `${RDF}reifies`,
  },
  owl: {
    sameAs: 'http://www.w3.org/2002/07/owl#sameAs',
  },
  r: {
    forSome: `${SWAP}reify#forSome`,
    forAll:  `${SWAP}reify#forAll`,
  },
  log: {
    implies: `${SWAP}log#implies`,
    isImpliedBy: `${SWAP}log#isImpliedBy`,
  },
};
 })();
  const N3DataFactory = (function () { // N3.js implementations of the RDF/JS core data types
// See http://rdf.js.org/data-model-spec/



const { rdf, xsd } = namespaces;

// eslint-disable-next-line prefer-const
let DEFAULTGRAPH;
let _blankNodeCounter = 0;
// The ID of the empty IRI, which cannot be '' as that is the ID of the default graph
const EMPTY_IRI_ID = '<>';

const escapedLiteral = /^"(.*".*)(?="[^"]*$)/;

// ## DataFactory singleton
const DataFactory = {
  namedNode,
  blankNode,
  variable,
  literal,
  defaultGraph,
  quad,
  triple: quad,
  fromTerm,
  fromQuad,
};

// ## Term constructor
class Term {
  constructor(id) {
    this.id = id;
  }

  // ### The value of this term
  get value() {
    return this.id;
  }

  // ### Returns whether this object represents the same term as the other
  equals(other) {
    // If both terms were created by this library,
    // equality can be computed through ids of the same term type,
    // since IRIs such as `?x` have the same id as other terms
    if (other instanceof Term)
      return this.id === other.id && this.termType === other.termType;
    // Otherwise, compare term type and value
    return !!other && this.termType === other.termType &&
                      this.value    === other.value;
  }

  // ### Implement hashCode for Immutable.js, since we implement `equals`
  // https://immutable-js.com/docs/v4.0.0/ValueObject/#hashCode()
  hashCode() {
    return 0;
  }

  // ### Returns a plain object representation of this term
  toJSON() {
    return {
      termType: this.termType,
      value:    this.value,
    };
  }
}


// ## NamedNode constructor
class NamedNode extends Term {
  // ### Creates a named node
  /**
   * @deprecated Create named nodes through a data factory instead
   * (`DataFactory.namedNode(iri)`), so that term validation can be applied;
   * the constructor assumes an already-validated IRI.
   */
  constructor(iri) {
    if (iri !== '')
      super(iri);
    // The empty IRI gets a distinct ID, since '' is the ID of the default graph
    else {
      super(EMPTY_IRI_ID);
      Object.defineProperty(this, 'value', { value: '' });
    }
  }

  // ### The term type of this term
  get termType() {
    return 'NamedNode';
  }
}

// ## Literal constructor
class Literal extends Term {
  // ### Creates a literal
  /**
   * @deprecated Create literals through a data factory instead
   * (`DataFactory.literal(value, languageOrDatatype)`), so that term
   * validation can be applied; the constructor takes the internal
   * id representation and assumes it is already valid.
   */
  constructor(id) {
    super(id);
  }

  // ### The term type of this term
  get termType() {
    return 'Literal';
  }

  // ### The text value of this literal
  get value() {
    return this.id.substring(1, this.id.lastIndexOf('"'));
  }

  // ### The language of this literal
  get language() {
    // Find the last quotation mark (e.g., '"abc"@en-us')
    const id = this.id;
    let atPos = id.lastIndexOf('"') + 1;
    const dirPos = id.lastIndexOf('--');
    // If "@" it follows, return the remaining substring; empty otherwise
    return atPos < id.length && id[atPos++] === '@' ? (dirPos > atPos ? id.substr(0, dirPos) : id).substr(atPos).toLowerCase() : '';
  }

  // ### The direction of this literal
  get direction() {
    // Find the last double dash after the closing quote (e.g., '"abc"@en-us--ltr')
    const id = this.id;
    const endPos = id.lastIndexOf('"');
    const dirPos = id.lastIndexOf('--');
    return dirPos > endPos && dirPos + 2 < id.length ? id.substr(dirPos + 2).toLowerCase() : '';
  }

  // ### The datatype IRI of this literal
  get datatype() {
    return new NamedNode(this.datatypeString);
  }

  // ### The datatype string of this literal
  get datatypeString() {
    // Find the last quotation mark (e.g., '"abc"^^http://ex.org/types#t')
    const id = this.id, dtPos = id.lastIndexOf('"') + 1;
    const char = dtPos < id.length ? id[dtPos] : '';
    // If "^" it follows, return the remaining substring
    return char === '^' ? id.substr(dtPos + 2) :
           // If "@" follows, return rdf:langString or rdf:dirLangString; xsd:string otherwise
           (char !== '@' ? xsd.string : (id.indexOf('--', dtPos) > 0 ? rdf.dirLangString : rdf.langString));
  }

  // ### Returns whether this object represents the same term as the other
  equals(other) {
    // If both literals were created by this library,
    // equality can be computed through ids
    if (other instanceof Literal)
      return this.id === other.id;
    // Otherwise, compare term type, value, language, and datatype
    return !!other && !!other.datatype &&
                      this.termType === other.termType &&
                      this.value    === other.value    &&
                      this.language === other.language &&
                      ((this.direction === other.direction) || (this.direction === '' && !other.direction)) &&
                      this.datatype.value === other.datatype.value;
  }

  toJSON() {
    return {
      termType:  this.termType,
      value:     this.value,
      language:  this.language,
      direction: this.direction,
      datatype: { termType: 'NamedNode', value: this.datatypeString },
    };
  }
}

// ## BlankNode constructor
class BlankNode extends Term {
  // ### Creates a blank node
  /**
   * @deprecated Create blank nodes through a data factory instead
   * (`DataFactory.blankNode(name)`), so that term validation can be applied;
   * the constructor assumes an already-validated name.
   */
  constructor(name) {
    super(`_:${name}`);
  }

  // ### The term type of this term
  get termType() {
    return 'BlankNode';
  }

  // ### The name of this blank node
  get value() {
    return this.id.substr(2);
  }
}

class Variable extends Term {
  // ### Creates a variable
  /**
   * @deprecated Create variables through a data factory instead
   * (`DataFactory.variable(name)`), so that term validation can be applied;
   * the constructor assumes an already-validated name.
   */
  constructor(name) {
    super(`?${name}`);
  }

  // ### The term type of this term
  get termType() {
    return 'Variable';
  }

  // ### The name of this variable
  get value() {
    return this.id.substr(1);
  }
}

// ## DefaultGraph constructor
class DefaultGraph extends Term {
  // ### Creates the default graph
  /**
   * @deprecated Obtain the default graph through a data factory instead
   * (`DataFactory.defaultGraph()`).
   */
  constructor() {
    super('');
    return DEFAULTGRAPH || this;
  }

  // ### The term type of this term
  get termType() {
    return 'DefaultGraph';
  }

  // ### Returns whether this object represents the same term as the other
  equals(other) {
    // If both terms were created by this library,
    // equality can be computed through strict equality;
    // otherwise, compare term types.
    return (this === other) || (!!other && (this.termType === other.termType));
  }
}

// ## DefaultGraph singleton
DEFAULTGRAPH = new DefaultGraph();

// ### Constructs a term from the given internal string ID
// The third 'nested' parameter of this function is to aid
// with recursion over nested terms. It should not be used
// by consumers of this library.
// See https://github.com/rdfjs/N3.js/pull/311#discussion_r1061042725
function termFromId(id, factory, nested) {
  factory = factory || DataFactory;

  // Falsy value or empty string indicate the default graph
  if (!id)
    return factory.defaultGraph();

  // Identify the term type based on the first character
  switch (id[0]) {
  case '?':
    return factory.variable(id.substr(1));
  case '_':
    return factory.blankNode(id.substr(2));
  case '"':
    // Shortcut for internal literals
    if (factory === DataFactory)
      return new Literal(id);
    // Literal without datatype or language
    if (id[id.length - 1] === '"')
      return factory.literal(id.substr(1, id.length - 2));
    // Literal with datatype or language
    const endPos = id.lastIndexOf('"', id.length - 1);
    let languageOrDatatype;
    if (id[endPos + 1] === '@') {
      languageOrDatatype = id.substr(endPos + 2);
      const dashDashIndex = languageOrDatatype.lastIndexOf('--');
      if (dashDashIndex > 0 && dashDashIndex < languageOrDatatype.length) {
        languageOrDatatype = {
          language: languageOrDatatype.substr(0, dashDashIndex),
          direction: languageOrDatatype.substr(dashDashIndex + 2),
        };
      }
    }
    else {
      languageOrDatatype = factory.namedNode(id.substr(endPos + 3));
    }
    return factory.literal(id.substr(1, endPos - 1),
            languageOrDatatype);
  case '[':
    id = JSON.parse(id);
    break;
  case '<':
    if (id === EMPTY_IRI_ID)
      return factory.namedNode('');
    // falls through
  default:
    if (!nested || !Array.isArray(id)) {
      return factory.namedNode(id);
    }
  }
  return factory.quad(
    termFromId(id[0], factory, true),
    termFromId(id[1], factory, true),
    termFromId(id[2], factory, true),
    id[3] && termFromId(id[3], factory, true),
  );
}

// ### Constructs an internal string ID from the given term or ID string
// The third 'nested' parameter of this function is to aid
// with recursion over nested terms. It should not be used
// by consumers of this library.
// See https://github.com/rdfjs/N3.js/pull/311#discussion_r1061042725
function termToId(term, nested) {
  if (typeof term === 'string')
    return term;
  if (term instanceof Term && term.termType !== 'Quad')
    return term.id;
  if (!term)
    return DEFAULTGRAPH.id;

  // Term instantiated with another library
  switch (term.termType) {
  case 'NamedNode': {
    const iri = term.value;
    return iri !== '' ? iri : EMPTY_IRI_ID;
  }
  case 'BlankNode':    return `_:${term.value}`;
  case 'Variable':     return `?${term.value}`;
  case 'DefaultGraph': return '';
  case 'Literal':      return `"${term.value}"${
    term.language ? `@${term.language}${term.direction ? `--${term.direction}` : ''}` :
      (term.datatype && term.datatype.value !== xsd.string ? `^^${term.datatype.value}` : '')}`;
  case 'Quad':
    const res = [
      termToId(term.subject, true),
      termToId(term.predicate, true),
      termToId(term.object, true),
    ];
    if (term.graph && term.graph.termType !== 'DefaultGraph') {
      res.push(termToId(term.graph, true));
    }
    return nested ? res : JSON.stringify(res);
  default: throw new Error(`Unexpected termType: ${term.termType}`);
  }
}


// ## Quad constructor
class Quad extends Term {
  // ### Creates a quad
  /**
   * @deprecated Create quads through a data factory instead
   * (`DataFactory.quad(subject, predicate, object, graph)`), so that term
   * validation can be applied; the constructor assumes already-validated terms.
   */
  constructor(subject, predicate, object, graph) {
    super('');
    this._subject   = subject;
    this._predicate = predicate;
    this._object    = object;
    this._graph     = graph || DEFAULTGRAPH;
  }

  // ### The term type of this term
  get termType() {
    return 'Quad';
  }

  get subject() {
    return this._subject;
  }

  get predicate() {
    return this._predicate;
  }

  get object() {
    return this._object;
  }

  get graph() {
    return this._graph;
  }

  // ### Returns a plain object representation of this quad
  toJSON() {
    return {
      termType:  this.termType,
      subject:   this._subject.toJSON(),
      predicate: this._predicate.toJSON(),
      object:    this._object.toJSON(),
      graph:     this._graph.toJSON(),
    };
  }

  // ### Returns whether this object represents the same quad as the other
  equals(other) {
    return !!other && this._subject.equals(other.subject)     &&
                      this._predicate.equals(other.predicate) &&
                      this._object.equals(other.object)       &&
                      this._graph.equals(other.graph);
  }
}

// ### Escapes the quotes within the given literal
function escapeQuotes(id) {
  return id.replace(escapedLiteral, (_, quoted) => `"${quoted.replace(/"/g, '""')}`);
}

// ### Unescapes the quotes within the given literal
function unescapeQuotes(id) {
  return id.replace(escapedLiteral, (_, quoted) => `"${quoted.replace(/""/g, '"')}`);
}

// ### Creates an IRI
function namedNode(iri) {
  return new NamedNode(iri);
}

// ### Creates a blank node
function blankNode(name) {
  return new BlankNode(name || `n3-${_blankNodeCounter++}`);
}

// ### Creates a literal
function literal(value, languageOrDataType) {
  // Create a language-tagged string
  if (typeof languageOrDataType === 'string')
    return new Literal(`"${value}"@${languageOrDataType.toLowerCase()}`);

  // Create a language-tagged string with base direction
  if (languageOrDataType !== undefined && !('termType' in languageOrDataType)) {
    return new Literal(`"${value}"@${languageOrDataType.language.toLowerCase()}${languageOrDataType.direction ? `--${languageOrDataType.direction.toLowerCase()}` : ''}`);
  }

  // Automatically determine datatype for booleans, numbers, BigInts, and dates
  let datatype = languageOrDataType ? languageOrDataType.value : '';
  if (datatype === '') {
    // Convert a boolean
    if (typeof value === 'boolean')
      datatype = xsd.boolean;
    // Convert an integer or double
    else if (typeof value === 'number') {
      if (Number.isFinite(value))
        // From 1e21 upward, a number's string form turns exponential ("1e+21"),
        // which is not a valid xsd:integer lexical, so type it as xsd:double
        // (the same cut-off as JSON-LD 1.1's Object to RDF Conversion)
        datatype = Number.isInteger(value) && Math.abs(value) < 1e21 ? xsd.integer : xsd.double;
      else {
        datatype = xsd.double;
        if (!Number.isNaN(value))
          value = value > 0 ? 'INF' : '-INF';
      }
    }
    // Convert a BigInt, whose decimal string is always a valid xsd:integer lexical
    else if (typeof value === 'bigint')
      datatype = xsd.integer;
    // Convert a valid date
    else if (value instanceof Date && !Number.isNaN(value.getTime())) {
      datatype = xsd.dateTime;
      value = value.toISOString();
    }
  }

  // Create a datatyped literal
  return (datatype === '' || datatype === xsd.string) ?
    new Literal(`"${value}"`) :
    new Literal(`"${value}"^^${datatype}`);
}

// ### Creates a variable
function variable(name) {
  return new Variable(name);
}

// ### Returns the default graph
function defaultGraph() {
  return DEFAULTGRAPH;
}

// ### Creates a quad
function quad(subject, predicate, object, graph) {
  return new Quad(subject, predicate, object, graph);
}

function fromTerm(term) {
  if (term instanceof Term)
    return term;

  // Term instantiated with another library
  switch (term.termType) {
  case 'NamedNode':    return namedNode(term.value);
  case 'BlankNode':    return blankNode(term.value);
  case 'Variable':     return variable(term.value);
  case 'DefaultGraph': return DEFAULTGRAPH;
  case 'Literal':      return literal(term.value, !term.language ? term.datatype :
    term.direction ? { language: term.language, direction: term.direction } : term.language);
  case 'Quad':         return fromQuad(term);
  default:             throw new Error(`Unexpected termType: ${term.termType}`);
  }
}

function fromQuad(inQuad) {
  if (inQuad instanceof Quad)
    return inQuad;

  if (inQuad.termType !== 'Quad')
    throw new Error(`Unexpected termType: ${inQuad.termType}`);

  return quad(fromTerm(inQuad.subject), fromTerm(inQuad.predicate), fromTerm(inQuad.object), fromTerm(inQuad.graph));
}

    return DataFactory; })();
  const N3Lexer = (function () { // **N3Lexer** tokenizes N3 documents.


const { xsd } = namespaces;
const SPACE = 0x20, TAB = 0x09, LF = 0x0A, CR = 0x0D, HASH = 0x23,
    DOT = 0x2E, COLON = 0x3A, ZERO = 0x30, NINE = 0x39,
    PERCENT = 0x25, BACKSLASH = 0x5C;

// Whitespace as matched by `\s`
function isWhitespace(charCode) {
  return charCode === SPACE || charCode >= TAB && charCode <= CR ||
    charCode >= 0xA0 && (charCode === 0xA0 || charCode === 0x1680 ||
      charCode >= 0x2000 && charCode <= 0x200A || charCode === 0x2028 || charCode === 0x2029 ||
      charCode === 0x202F || charCode === 0x205F || charCode === 0x3000 || charCode === 0xFEFF);
}
// Characters that can directly follow a name: whitespace and punctuation
// (the lookahead `[,;!\^\s#()\[\]\{\}"'<>]` of the former regular expressions)
const asciiDelimiters = new Uint8Array(0x80);
for (const char of ',;!^#()[]{}"\'<> \t\n\v\f\r')
  asciiDelimiters[char.charCodeAt(0)] = 1;
function isDelimiter(charCode) {
  return charCode < 0x80 ? asciiDelimiters[charCode] === 1 : isWhitespace(charCode);
}
// Whether a name can end before the given position: it must be followed by
// a delimiter, optionally after a dot. At the end of finished input, it can always end.
function canEndName(input, pos, inputFinished) {
  let charCode = input.charCodeAt(pos);
  if (charCode === DOT)
    charCode = input.charCodeAt(++pos);
  if (pos >= input.length)
    return inputFinished;
  return isDelimiter(charCode);
}

// Fixed escape sequences allowed in string literals (ECHAR)
const stringEscapeReplacements = {
  '\\': '\\', "'": "'", '"': '"',
  'n': '\n', 'r': '\r', 't': '\t', 'f': '\f', 'b': '\b',
};
// Fixed escape sequences allowed in local names of prefixed names (PN_LOCAL_ESC)
const localNameEscapeReplacements = {
  '_': '_', '~': '~', '.': '.', '-': '-', '!': '!', '$': '$', '&': '&',
  "'": "'", '(': '(', ')': ')', '*': '*', '+': '+', ',': ',', ';': ';',
  '=': '=', '/': '/', '?': '?', '#': '#', '@': '@', '%': '%',
};
const illegalIriChars = /[\x00-\x20<>\\"\{\}\|\^\`]/;

// Character classes of names, as bit flags for ASCII characters
const PREFIX_START = 1, // PN_CHARS_BASE
    LOCAL_START = 2,      // PN_CHARS_U, digits, and colon
    NAME_CHAR = 4,        // PN_CHARS
    LOCAL_CHAR = 8,       // PN_CHARS and colon
    LOCAL_ESCAPE = 16;    // characters that can be escaped in local names (PN_LOCAL_ESC)
const asciiNameClasses = new Uint8Array(0x80);
for (let charCode = 0; charCode < 0x80; charCode++) {
  const char = String.fromCharCode(charCode);
  const letter = char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z';
  const nameChar = letter || char === '_' || char === '-' || char >= '0' && char <= '9';
  asciiNameClasses[charCode] =
    (letter ? PREFIX_START : 0) |
    (nameChar && char !== '-' || char === ':' ? LOCAL_START : 0) |
    (nameChar ? NAME_CHAR : 0) |
    (nameChar || char === ':' ? LOCAL_CHAR : 0) |
    (char in localNameEscapeReplacements ? LOCAL_ESCAPE : 0);
}
// Returns the length (0, 1, or 2 code units) of the character at the given position
// if it is in the given name character class
function nameCharLength(input, pos, charClass) {
  const charCode = input.charCodeAt(pos);
  if (charCode < 0x80)
    return (asciiNameClasses[charCode] & charClass) !== 0 ? 1 : 0;
  // Characters from U+10000 to U+EFFFF consist of a surrogate pair
  if (charCode >= 0xD800 && charCode <= 0xDB7F) {
    const low = input.charCodeAt(pos + 1);
    return low >= 0xDC00 && low <= 0xDFFF ? 2 : 0;
  }
  // PN_CHARS has some characters that PN_CHARS_BASE does not
  if (charClass >= NAME_CHAR && (charCode === 0xB7 || charCode >= 0x300 && charCode <= 0x36F ||
                                 charCode === 0x203F || charCode === 0x2040))
    return 1;
  // PN_CHARS_BASE
  return charCode >= 0xC0 && charCode <= 0x1FFF && charCode !== 0xD7 && charCode !== 0xF7 &&
           (charCode < 0x300 || charCode >= 0x370 && charCode !== 0x37E) ||
         charCode >= 0x200C && charCode <= 0x200D || charCode >= 0x2070 && charCode <= 0x218F ||
         charCode >= 0x2C00 && charCode <= 0x2FEF || charCode >= 0x3001 && charCode <= 0xD7FF ||
         charCode >= 0xF900 && charCode <= 0xFDCF || charCode >= 0xFDF0 && charCode <= 0xFFFD ? 1 : 0;
}
function isLocalEscape(charCode) {
  return charCode < 0x80 && (asciiNameClasses[charCode] & LOCAL_ESCAPE) !== 0;
}
function isHexDigit(charCode) {
  return charCode >= ZERO && charCode <= NINE ||
    charCode >= 0x41 && charCode <= 0x46 || charCode >= 0x61 && charCode <= 0x66;
}
// Returns the end of the prefix (PN_PREFIX) at the given position,
// which can contain single dots, but not start or end with one
function skipPrefix(input, pos) {
  let length = nameCharLength(input, pos, PREFIX_START);
  while (length !== 0) {
    pos += length;
    const next = input.charCodeAt(pos) === DOT ? pos + 1 : pos;
    // Most names are ASCII, so look those up without a call
    const charCode = input.charCodeAt(next);
    length = charCode < 0x80 ? (asciiNameClasses[charCode] & NAME_CHAR) !== 0 ? 1 : 0 :
      nameCharLength(input, next, NAME_CHAR);
    if (length !== 0)
      pos = next;
  }
  return pos;
}
// Returns the end of the local name (PN_LOCAL) at the given position,
// which can contain dots, but not start or end with one
function skipLocalName(input, pos) {
  let end = pos, charClass = LOCAL_START;
  while (true) {
    // Most names are ASCII, so look those up without a call
    const charCode = input.charCodeAt(pos);
    let length = charCode < 0x80 ? (asciiNameClasses[charCode] & charClass) !== 0 ? 1 : 0 :
      nameCharLength(input, pos, charClass);
    // Percent-encoded character (PERCENT)
    if (length === 0 && charCode === PERCENT &&
        isHexDigit(input.charCodeAt(pos + 1)) && isHexDigit(input.charCodeAt(pos + 2)))
      length = 3;
    // Escaped character (PN_LOCAL_ESC)
    else if (length === 0 && charCode === BACKSLASH && isLocalEscape(input.charCodeAt(pos + 1)))
      length = 2;
    if (length !== 0) {
      end = pos += length;
      charClass = LOCAL_CHAR;
    }
    // Dots are allowed after the first character, but not at the end
    else if (charCode === DOT && charClass === LOCAL_CHAR)
      pos++;
    else
      return end;
  }
}
// Returns the end of the prefixed name at the given position, or -1 if there is none
function skipPrefixedName(input, pos, inputFinished) {
  const colon = skipPrefix(input, pos);
  if (input.charCodeAt(colon) !== COLON)
    return -1;
  const end = skipLocalName(input, colon + 1);
  return canEndName(input, end, inputFinished) ? end : -1;
}

// A valid code point is a Unicode scalar value: at most U+10FFFF and not a surrogate
function isValidCodePoint(charCode) {
  return charCode <= 0x10FFFF && (charCode < 0xD800 || charCode > 0xDFFF);
}

const lineModeRegExps = {
  _iri: true,
  _unescapedIri: true,
  _simpleQuotedString: true,
  _langcode: true,
  _blank: true,
  _commentLine: true,
  _whitespace: true,
};
const invalidRegExp = /$0^/;
const nonWhitespace = /\S*/y;

// Matches a sticky regular expression at the given position of the input
function execAt(regExp, input, pos) {
  regExp.lastIndex = pos;
  return regExp.exec(input);
}
function testAt(regExp, input, pos) {
  regExp.lastIndex = pos;
  return regExp.test(input);
}
// Matches the rest of the input followed by a space, as at the end of the input,
// a token that can contain (but not end with) a dot needs a non-dot character after it
function execAtEnd(regExp, input, pos) {
  regExp.lastIndex = 0;
  return regExp.exec(`${input.slice(pos)} `);
}

// Whitespace or the start of a comment
function isSeparatorCode(code) {
  return code === SPACE || code === TAB || code === LF || code === CR || code === HASH;
}

// Words with a fixed meaning in the grammar, which cannot name an additional directive
const reservedWords = /^(?:prefix|base|version|graph|forsome|forall|iri|a|true|false|has|is|of|id)$/i;

// Unfinished input in a stream up to this length is tokenized again with every chunk
const MIN_RESCAN_LENGTH = 1024;

// ## Constructor
class N3Lexer {
  constructor(options) {
    // ## Regular expressions
    // It's slightly faster to have these as properties than as in-scope variables.
    // They are sticky, so they only match at the `lastIndex` set by `execAt`.
    this._iri = /<((?:[^ <>{}\\]|\\[uU])+)>[ \t]*/y; // IRI with escape sequences; needs sanity check after unescaping
    this._unescapedIri = /<([^\x00-\x20<>\\"\{\}\|\^\`]*)>[ \t]*/y; // IRI without escape sequences; no unescaping
    this._simpleQuotedString = /"([^"\\\r\n]*)"(?=[^"])/y; // string without escape sequences
    this._simpleApostropheString = /'([^'\\\r\n]*)'(?=[^'])/y;
    this._langcode = /@([a-z]+(?:-[a-z0-9]+)*)(?=[^a-z0-9])/iy;
    this._variable = /\?(?:(?:[A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:[\-0-9:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)(?=[.,;!\^\s#()\[\]\{\}"'<>])/y;
    this._blank = /_:((?:[0-9A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)(?:[ \t]+|(?=\.?[,;:!\^\s#()\[\]\{\}"'<>]))/y;
    this._number = /[\-+]?(?:(\d+\.\d*|\.?\d+)[eE][\-+]?\d+|(?=\.?\d)\d*(?:(\.)\d+)?)(?=\.?[,;:!\^\s#()\[\]\{\}"'<>])/y;
    this._boolean = /(?:true|false)(?=[.,;!\^\s#()\[\]\{\}"'<>])/y;
    this._atKeyword = /@[a-z]+(?=[\s#<:"'.])/iy;
    this._keyword = /(?:PREFIX|BASE|VERSION|GRAPH)(?=[\s#<"'])/iy;
    this._n3Verb = /(?:has|is|of)(?=[\s#()\[\]\{\}"'<>?_+\-0-9])/y;
    this._n3Id = /id(?=[\s#<])/y;
    this._shortPredicates = /a(?=[\s#()\[\]\{\}"'<>])/y;
    this._commentLine = /[ \t]*#([^\n\r]*)(?:\r\n|\n|\r)([ \t]*)/y;
    this._whitespace = /[ \t]+/y;
    options = options || {};

    // Whether the log:isImpliedBy predicate is supported
    this._isImpliedBy = options.isImpliedBy;

    // In line mode (N-Triples or N-Quads), only simple features may be parsed
    if (this._lineMode = !!options.lineMode) {
      this._n3Mode = false;
      // Don't tokenize special literals
      for (const key in this) {
        if (!(key in lineModeRegExps) && this[key] instanceof RegExp)
          this[key] = invalidRegExp;
      }
      // The only keyword in N-Triples and N-Quads is VERSION, which is case-sensitive
      this._keyword = /VERSION(?=[\s#<"])/y;
    }
    // When not in line mode, enable N3 functionality by default
    else {
      this._n3Mode = options.n3 !== false;
    }
    // Recognize additional directive keywords, such as MESSAGE
    // (the @-form of a directive is always tokenized as an @-keyword)
    this._directive = null;
    if (options.directives && options.directives.length !== 0) {
      for (const name of options.directives) {
        if (!/^[a-z]+$/i.test(name) || reservedWords.test(name))
          throw new Error(`Invalid directive name: "${name}"`);
      }
      this._directive = new RegExp(`(?:${options.directives.join('|')})(?=[\\s#<])`, 'iy');
      this._directiveMaxLength = Math.max(...options.directives.map(name => name.length));
      // The first characters of directive names, so other words skip the regular expression
      this._directiveStarts = options.directives.map(name => name[0].toLowerCase() + name[0].toUpperCase()).join('');
    }
    // Don't output comment tokens by default
    this.comments = !!options.comments;
    // Cache the last tested closing position of long literals
    this._literalClosingPos = 0;
  }

  // ## Private methods

  // ### `_tokenizeToEnd` tokenizes as for as possible, emitting tokens through the callback
  _tokenizeToEnd(callback, inputFinished) {
    // Continue parsing as far as possible; the loop will return eventually.
    // Rather than slicing off every token, track the position of the remaining input;
    // the regular expressions are sticky, so they match at that position.
    const input = this._input;
    let pos = 0;
    let currentLineLength = this._linePosition + input.length;
    while (true) {
      // Consume one separator line at a time, including its following indentation.
      while (true) {
        let charCode = input.charCodeAt(pos), separatorLength = 0;
        if (charCode === SPACE || charCode === TAB) {
          const next = input.charCodeAt(pos + 1);
          separatorLength = next === SPACE || next === TAB ?
            execAt(this._whitespace, input, pos)[0].length : 1;
          charCode = input.charCodeAt(pos + separatorLength);
        }
        if (charCode === HASH) {
          const comment = execAt(this._commentLine, input, pos);
          if (comment) {
            const commentLength = comment[0].length;
            // Keep a trailing CR buffered in case the next chunk starts with LF.
            if (!inputFinished && pos + commentLength === input.length &&
                input.charCodeAt(input.length - 1) === CR)
              return this._suspend(input, pos, currentLineLength);
            if (this.comments)
              emitComment(comment[1], this._line, currentLineLength - (input.length - pos) + separatorLength);
            pos += commentLength;
            currentLineLength = input.length - pos + comment[2].length;
            this._line++;
          }
          else {
            // A comment without a line ending stays buffered until EOF.
            pos += separatorLength;
            if (!inputFinished)
              return this._suspend(input, pos, currentLineLength);
            if (this.comments)
              emitComment(input.slice(pos + 1), this._line, currentLineLength - (input.length - pos));
            pos = input.length;
            break;
          }
        }
        else if (charCode === LF || charCode === CR) {
          // A CR at the end of a chunk may still be followed by LF.
          if (!inputFinished && charCode === CR && pos + separatorLength + 1 === input.length)
            return this._suspend(input, pos, currentLineLength);
          separatorLength += charCode === CR && input.charCodeAt(pos + separatorLength + 1) === LF ? 2 : 1;
          // Indentation is consumed with the newline, but belongs to the next line's columns.
          let indentationLength = 0;
          const next = input.charCodeAt(pos + separatorLength);
          if (next === SPACE || next === TAB) {
            const following = input.charCodeAt(pos + separatorLength + 1);
            indentationLength = following === SPACE || following === TAB ?
              execAt(this._whitespace, input, pos + separatorLength)[0].length : 1;
          }
          pos += separatorLength + indentationLength;
          currentLineLength = input.length - pos + indentationLength;
          this._line++;
        }
        else {
          pos += separatorLength;
          break;
        }
      }
      if (pos >= input.length) {
        // A datatype marker needs a type
        if (inputFinished && this._previousMarker === '^^')
          return reportSyntaxError(this, input, pos);
        this._linePosition = currentLineLength;
        if (inputFinished) {
          emitToken('eof', '', '', this._line, currentLineLength, 0);
          return this._input = null;
        }
        return this._input = '';
      }

      // Look for specific token types based on the first character
      const line = this._line, firstChar = input[pos];
      let type = '', value = '', prefix = '',
          match = null, matchLength = 0, lexicalLength = 0,
          finalLineLength = 0, inconclusive = false, tripleQuoted = false;
      switch (firstChar) {
      case '^':
        // A datatype marker separated from its type cannot be followed by another marker
        if (this._previousMarker === '^^')
          return reportSyntaxError(this, input, pos);
        // We need at least 3 tokens lookahead to distinguish ^^<IRI> and ^^pre:fixed
        if (input.length - pos < 3)
          break;
        // Try to match a type
        else if (input[pos + 1] === '^') {
          this._previousMarker = '^^';
          // Move to type IRI or prefixed name
          pos += 2;
          if (input[pos] !== '<') {
            // Whitespace and comments may separate the marker from the type
            if (isSeparatorCode(input.charCodeAt(pos)))
              continue; // eslint-disable-line no-continue
            inconclusive = true;
            break;
          }
        }
        // If no type, it must be a path expression
        else {
          if (this._n3Mode) {
            matchLength = 1;
            type = '^';
          }
          break;
        }
        // Fall through in case the type is an IRI
      case '<':
        // Try to find a full IRI without escape sequences
        if (match = execAt(this._unescapedIri, input, pos)) {
          type = 'IRI', value = match[1];
          lexicalLength = match[1].length + 2;
        }
        // Try to find a full IRI with escape sequences
        else if (match = execAt(this._iri, input, pos)) {
          value = this._unescape(match[1], stringEscapeReplacements);
          if (value === null || illegalIriChars.test(value))
            return reportSyntaxError(this, input, pos);
          type = 'IRI';
          lexicalLength = match[1].length + 2;
        }
        // Try to find a triple term
        else if (input.length - pos > 2 && input[pos + 1] === '<' && input[pos + 2] === '(')
          type = '<<(', matchLength = 3;
        // Try to find a reified triple
        else if (!this._lineMode && input.length - pos > (inputFinished ? 1 : 2) && input[pos + 1] === '<')
          type = '<<', matchLength = 2;
        // Try to find a backwards implication arrow
        else if (this._n3Mode && input.length - pos > 1 && input[pos + 1] === '=') {
          matchLength = 2;
          if (this._isImpliedBy) type = 'abbreviation', value = '<';
          else type = 'inverse', value = '>';
        }
        // Try to find an inverted predicate marker
        else if (this._n3Mode && input.length - pos > 1 && input[pos + 1] === '-')
          type = 'inversePredicate', matchLength = 2;
        break;

      case '>':
        // Try to find a reified triple
        if (input.length - pos > 1 && input[pos + 1] === '>')
          type = '>>', matchLength = 2;
        break;

      case '_':
        // Try to find a blank node. Since it can contain (but not end with) a dot,
        // we always need a non-dot character before deciding it is a blank node.
        // Therefore, try inserting a space if we're at the end of the input.
        if ((match = execAt(this._blank, input, pos)) ||
            inputFinished && (match = execAtEnd(this._blank, input, pos))) {
          type = 'blank', prefix = '_', value = match[1];
          lexicalLength = match[1].length + 2;
        }
        break;

      case '"':
        // Try to find a literal without escape sequences
        if (match = execAt(this._simpleQuotedString, input, pos))
          value = match[1];
        // Try to find a literal wrapped in three pairs of quotes
        else {
          ({ value, matchLength, finalLineLength, tripleQuoted } = this._parseLiteral(input, pos));
          if (value === null)
            return reportSyntaxError(this, input, pos);
        }
        if (match !== null || matchLength !== 0) {
          type = 'literal';
          this._literalClosingPos = 0;
        }
        break;

      case "'":
        if (!this._lineMode) {
          // Try to find a literal without escape sequences
          if (match = execAt(this._simpleApostropheString, input, pos))
            value = match[1];
          // Try to find a literal wrapped in three pairs of quotes
          else {
            ({ value, matchLength, finalLineLength, tripleQuoted } = this._parseLiteral(input, pos));
            if (value === null)
              return reportSyntaxError(this, input, pos);
          }
          if (match !== null || matchLength !== 0) {
            type = 'literal';
            this._literalClosingPos = 0;
          }
        }
        break;

      case '?':
        // Try to find a variable
        if (this._n3Mode && (match = execAt(this._variable, input, pos)))
          type = 'var', value = match[0];
        break;

      case '@':
        // Try to find a language code. A language code can contain dash-separated
        // subtags, so if the match is immediately followed by a single dash and the
        // input is not finished, another subtag may still arrive in a later chunk and
        // the match would be premature; wait for more input in that case.
        // A double dash starts a direction code, which cannot extend the language code.
        if (this._previousMarker === 'literal' && (match = execAt(this._langcode, input, pos)) && match[1] !== 'version') {
          const end = pos + match[0].length;
          if (!inputFinished && input[end] === '-' && input[end + 1] !== '-')
            match = null;
          else
            type = 'langcode', value = match[1];
        }
        // Try to find a keyword
        else if (match = execAt(this._atKeyword, input, pos))
          type = match[0];
        break;

      case '.':
        // Try to find a dot as punctuation
        if (input.length - pos === 1 ? inputFinished : (input[pos + 1] < '0' || input[pos + 1] > '9')) {
          type = '.';
          matchLength = 1;
          break;
        }
        // Fall through to numerical case (could be a decimal dot)

      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
      case '+':
      case '-':
        if (input[pos + 1] === '-') {
          // Try to find a direction code
          if (this._previousMarker === 'langcode') {
            if (input.startsWith('--ltr', pos))
              type = 'dircode', value = 'ltr', matchLength = 5;
            else if (input.startsWith('--rtl', pos))
              type = 'dircode', value = 'rtl', matchLength = 5;
          }
          break;
        }

        // Try to find a number. Since it can contain (but not end with) a dot,
        // we always need a non-dot character before deciding it is a number.
        // Therefore, try inserting a space if we're at the end of the input.
        if (match = execAt(this._number, input, pos) ||
            inputFinished && (match = execAtEnd(this._number, input, pos))) {
          type = 'literal', value = match[0];
          prefix = (typeof match[1] === 'string' ? xsd.double :
                    (typeof match[2] === 'string' ? xsd.decimal : xsd.integer));
        }
        break;

      case 'B':
      case 'b':
      case 'p':
      case 'P':
      case 'G':
      case 'g':
      case 'V':
      case 'v':
        // Try to find a SPARQL-style keyword
        if (match = execAt(this._keyword, input, pos))
          type = match[0].toUpperCase();
        else
          inconclusive = true;
        break;

      case 'f':
      case 't':
        // Try to match a boolean
        if (testAt(this._boolean, input, pos))
          type = 'literal', value = firstChar === 't' ? 'true' : 'false', prefix = xsd.boolean, matchLength = value.length;
        else
          inconclusive = true;
        break;

      case 'a':
        // Try to find an abbreviated predicate
        if (testAt(this._shortPredicates, input, pos))
          type = 'abbreviation', value = 'a', matchLength = 1;
        else
          inconclusive = true;
        break;

      case 'h':
      case 'o':
        // Try to find an N3 verb keyword
        if (this._n3Mode && (match = this._matchN3Verb(input, pos, inputFinished)))
          type = match[0];
        else
          inconclusive = true;
        break;

      case 'i':
        // Try to find an IRI property list identifier or N3 verb keyword
        if (this._n3Mode && testAt(this._n3Id, input, pos))
          type = 'id', matchLength = 2;
        else if (this._n3Mode && (match = this._matchN3Verb(input, pos, inputFinished)))
          type = match[0];
        else
          inconclusive = true;
        break;

      case '=':
        // Try to find an implication arrow or equals sign
        if (this._n3Mode && input.length - pos > 1) {
          type = 'abbreviation';
          if (input[pos + 1] !== '>')
            matchLength = 1, value = '=';
          else
            matchLength = 2, value = '>';
        }
        break;

      case '!':
        if (!this._n3Mode)
          break;
      case ')':
        if (!inputFinished && (input.length - pos === 1 || (input.length - pos === 2 && input[pos + 1] === '>'))) {
          // Don't consume yet, as it *could* become a triple term end.
          break;
        }
        // Try to find a triple term
        if (input.length - pos > 2 && input[pos + 1] === '>' && input[pos + 2] === '>') {
          type = ')>>', matchLength = 3;
          break;
        }
      case ',':
      case ';':
      case '[':
      case ']':
      case '(':
      case '}':
      case '~':
        if (!this._lineMode) {
          matchLength = 1;
          type = firstChar;
        }
        break;
      case '{':
        // We need at least 2 tokens lookahead to distinguish "{|" and "{ "
        if (!this._lineMode && input.length - pos >= 2) {
          // Try to find a quoted triple annotation start
          if (input[pos + 1] === '|')
            type = '{|', matchLength = 2;
          else
            type = firstChar, matchLength = 1;
        }
        break;
      case '|':
        // We need 2 tokens lookahead to parse "|}"
        // Try to find a quoted triple annotation end
        if (input.length - pos >= 2 && input[pos + 1] === '}')
          type = '|}', matchLength = 2;
        break;

      default:
        inconclusive = true;
      }

      // Some first characters do not allow an immediate decision, so inspect more
      if (inconclusive) {
        // Try to find a prefix
        let end;
        if ((this._previousMarker === '@prefix' || this._previousMarker === 'PREFIX') &&
            input.charCodeAt(end = skipPrefix(input, pos)) === COLON &&
            end + 1 < input.length && (input[end + 1] === '#' || input[end + 1] === '<' ||
                                       isWhitespace(input.charCodeAt(end + 1)))) {
          type = 'prefix', value = input.slice(pos, end);
          matchLength = end + 1 - pos;
        }
        // Try to find an additional directive keyword
        // (at the end of the input, only a short final word can be one)
        else if (this._directive !== null && this._directiveStarts.includes(firstChar) &&
                 ((match = execAt(this._directive, input, pos)) ||
                 inputFinished && input.length - pos <= this._directiveMaxLength &&
                 (match = execAtEnd(this._directive, input, pos))))
          type = match[0].toUpperCase();
        // Try to find a prefixed name. Since it can contain (but not end with) a dot,
        // we always need a non-dot character before deciding it is a prefixed name,
        // except at the end of the input.
        else if (!this._lineMode && (end = skipPrefixedName(input, pos, inputFinished)) >= 0) {
          const colon = input.indexOf(':', pos);
          type = 'prefixed', prefix = input.slice(pos, colon);
          value = this._unescape(input.slice(colon + 1, end), localNameEscapeReplacements);
          matchLength = end - pos;
        }
      }

      // A type token is special: it can only be emitted after an IRI or prefixed name is read
      if (this._previousMarker === '^^') {
        switch (type) {
        case 'prefixed': type = 'type';    break;
        case 'IRI':      type = 'typeIRI'; break;
        default:         type = '';
        }
      }

      // What if nothing of the above was found?
      if (!type) {
        // We could be in streaming mode, and then we just wait for more input to arrive.
        // Otherwise, a syntax error has occurred in the input.
        // One exception: error on an unaccounted linebreak (= not inside a triple-quoted literal).
        if (inputFinished || (!input.startsWith("'''", pos) && !input.startsWith('"""', pos) &&
                              /\n|\r/.test(input.slice(pos))))
          return reportSyntaxError(this, input, pos);
        else
          return this._suspend(input, pos, currentLineLength);
      }

      // Emit the parsed token
      // Consumption includes separator whitespace; lexicalLength excludes it
      // and any synthetic EOF space. Consumption is clamped to the input below.
      const length = matchLength || match[0].length;
      const start = currentLineLength - (input.length - pos);
      let token;
      if (finalLineLength) {
        token = {
          type, value, prefix, line, start,
          end: finalLineLength, endLine: this._line, tripleQuoted,
        };
        callback(null, token);
      }
      // Triple-quoted strings are marked, since version declarations do not allow them
      else if (tripleQuoted) {
        token = { type, value, prefix, line, start, end: start + length, tripleQuoted };
        callback(null, token);
      }
      else
        token = emitToken(type, value, prefix, line, start, lexicalLength || length);
      this.previousToken = token;
      // The string of a version declaration cannot take a language tag, so a following @keyword is a keyword
      this._previousMarker = type === 'literal' && (this._previousMarker === 'VERSION' || this._previousMarker === '@version') ? 'version' : type;

      // Advance to next part to tokenize
      pos = Math.min(pos + length, input.length);
      if (finalLineLength)
        currentLineLength = input.length - pos + finalLineLength;
    }

    // Emits a comment at its exact position within matched whitespace.
    function emitComment(value, line, start) {
      callback(null, {
        type: 'comment', value, prefix: '', line,
        start, end: start + value.length + 1,
      });
    }
    // Emits the token through the callback
    function emitToken(type, value, prefix, line, start, length) {
      const token = { type, value, prefix, line, start, end: start + length };
      callback(null, token);
      return token;
    }
    // Signals the syntax error through the callback
    function reportSyntaxError(self, input, pos) {
      callback(self._syntaxError(execAt(nonWhitespace, input, pos)[0]));
    }
  }

  // ### `_suspend` keeps the unconsumed input until more input arrives
  _suspend(input, pos, currentLineLength) {
    this._linePosition = currentLineLength - (input.length - pos);
    return this._input = input.slice(pos);
  }

  // ### `_matchN3Verb` matches an N3 verb unless the input is a longer prefixed name
  _matchN3Verb(input, pos, inputFinished) {
    const verb = execAt(this._n3Verb, input, pos);
    if (!verb)
      return null;

    // Most verb boundaries cannot be part of a prefix, so keep the common path fast.
    // U+1680 and U+FEFF are whitespace to the regular expression but name characters.
    const next = input[pos + verb[0].length];
    if (next !== '-' && next !== '_' && (next < '0' || next > '9') &&
        next !== '\u1680' && next !== '\ufeff')
      return verb;

    // A prefix can start with a verb and continue with characters that are also
    // valid verb boundaries. Prefer the longer prefixed name when it is complete.
    if (skipPrefixedName(input, pos, true) >= 0)
      return null;

    // If a stream chunk ends partway through such a prefix,
    // wait for the colon instead of prematurely emitting the verb.
    if (!inputFinished && skipPrefix(input, pos) === input.length)
      return null;
    return verb;
  }

  // ### `_unescape` replaces N3 escape codes by their corresponding characters,
  // allowing only the fixed escape sequences from the given replacement table
  _unescape(item, replacements) {
    let backslash = item.indexOf('\\');
    if (backslash < 0)
      return item;

    let result = '', start = 0;
    // A trailing lone backslash is not an escape sequence.
    while (backslash >= 0 && backslash + 1 < item.length) {
      const escapedChar = item[backslash + 1];
      let end = backslash + 2, replacement;
      if (escapedChar === 'u' || escapedChar === 'U') {
        end += escapedChar === 'u' ? 4 : 8;
        if (end > item.length)
          return null;

        let charCode = 0;
        for (let i = backslash + 2; i < end; i++) {
          let digit = item.charCodeAt(i);
          if (digit >= 0x30 && digit <= 0x39) // 0–9
            digit -= 0x30;
          else if (digit >= 0x41 && digit <= 0x46) // A–F
            digit -= 0x41 - 10;
          else if (digit >= 0x61 && digit <= 0x66) // a–f
            digit -= 0x61 - 10;
          else
            return null;
          // Eight digits can exceed a signed 32-bit integer; avoid bitwise shifts.
          charCode = charCode * 16 + digit;
        }
        if (!isValidCodePoint(charCode))
          return null;
        replacement = String.fromCodePoint(charCode);
      }
      else {
        if (!(escapedChar in replacements))
          return null;
        replacement = replacements[escapedChar];
      }
      result += item.slice(start, backslash) + replacement;
      start = end;
      backslash = item.indexOf('\\', start);
    }
    return result + item.slice(start);
  }

  // ### `_parseLiteral` parses a literal at the given position into an unescaped value
  _parseLiteral(input, pos) {
    // Ensure we have enough lookahead to identify triple-quoted strings
    if (input.length - pos >= 3) {
      // The caller has already identified a single or double quote.
      const quote = input[pos];
      const openingLength = input[pos + 1] === quote && input[pos + 2] === quote ? 3 : 1;
      let opening = quote;
      if (openingLength === 3)
        opening = quote === '"' ? '"""' : "'''";

      // Find the next candidate closing quotes
      let closingPos = pos + Math.max(this._literalClosingPos, openingLength);
      while ((closingPos = input.indexOf(opening, closingPos)) > pos) {
        // Count backslashes right before the closing quotes
        let backslashCount = 0;
        while (input[closingPos - backslashCount - 1] === '\\')
          backslashCount++;

        // An even number of backslashes (in particular 0)
        // means these are actual, non-escaped closing quotes
        if (backslashCount % 2 === 0) {
          // Extract and unescape the value
          const raw = input.substring(pos + openingLength, closingPos),
              lines = raw.split(/\r\n|\r|\n/),
              lineCount = lines.length - 1;
          const matchLength = closingPos - pos + openingLength;
          // Only triple-quoted strings can be multi-line
          if (openingLength === 1 && lineCount !== 0 ||
              openingLength === 3 && this._lineMode)
            break;
          this._line += lineCount;
          const finalLineLength = lineCount === 0 ? 0 : lines[lines.length - 1].length + openingLength;
          return {
            value: this._unescape(raw, stringEscapeReplacements), matchLength, finalLineLength,
            tripleQuoted: openingLength === 3,
          };
        }
        closingPos++;
      }
      this._literalClosingPos = input.length - pos - openingLength + 1;
    }
    return { value: '', matchLength: 0, finalLineLength: 0, tripleQuoted: false };
  }

  // ### `_tryTokenizeToEnd` tokenizes as far as possible, reporting failures through the callback
  _tryTokenizeToEnd(callback, inputFinished) {
    // Keep track of errors thrown by the callback, which must reach the caller unchanged
    let callbackError;
    try {
      this._tokenizeToEnd((error, token) => {
        try {
          return callback(error, token);
        }
        catch (thrown) {
          throw (callbackError = thrown);
        }
      }, inputFinished);
    }
    catch (error) {
      // Matching an extremely long token can exhaust the regular expression stack
      if (error === callbackError || !(error instanceof RangeError))
        throw error;
      callback(this._syntaxError(null, `Token too long on line ${this._line}.`));
    }
  }

  // ### `_syntaxError` creates a syntax error for the given issue
  _syntaxError(issue, message = `Unexpected "${issue}" on line ${this._line}.`) {
    this._input = null;
    const err = new Error(message);
    err.context = {
      token: undefined,
      line: this._line,
      previousToken: this.previousToken,
    };
    return err;
  }

  // ### `_startTokenization` resets the lexer state for a new input
  _startTokenization() {
    this._line = 1;
    this._linePosition = 0;
    this._previousMarker = undefined;
    this.previousToken = undefined;
    this._literalClosingPos = 0;
    this._input = undefined;
    // Deferred tokenization and stream events can outlive their invocation.
    // Ignore them once a later call takes ownership of the lexer state.
    return this._tokenization = {};
  }

  // ### `_tokenizeString` synchronously emits the tokens of a complete string through the callback,
  // so that the caller can consume each token without the lexer collecting them all first
  _tokenizeString(input, callback) {
    this._startTokenization();
    this._input = this._readStartingBom(input);
    this._tryTokenizeToEnd(callback, true);
  }

  // ### Strips off any starting UTF BOM mark.
  _readStartingBom(input) {
    if (input.startsWith('\ufeff')) {
      this._linePosition = 1;
      return input.slice(1);
    }
    return input;
  }

  // ## Public methods

  // ### `tokenize` starts the transformation of an N3 document into an array of tokens.
  // The input can be a string or a stream.
  // Token ranges use one-based lines and zero-based, end-exclusive UTF-16 columns.
  // Separator whitespace counts towards the next token's start, outside either range.
  // Multiline tokens also have endLine; their end column is relative to that line.
  tokenize(input, callback) {
    const tokenization = this._startTokenization();

    // If the input is a string, continuously emit tokens through the callback until the end
    if (typeof input === 'string') {
      this._input = this._readStartingBom(input);
      // If a callback was passed, asynchronously call it
      if (typeof callback === 'function')
        queueMicrotask(() => {
          if (this._tokenization === tokenization)
            this._tryTokenizeToEnd(callback, true);
        });
      // If no callback was passed, tokenize synchronously and return
      else {
        const tokens = [];
        let error;
        this._tryTokenizeToEnd((e, t) => e ? (error = e) : tokens.push(t), true);
        if (error) throw error;
        return tokens;
      }
    }
    // Otherwise, the input must be a stream
    else {
      let decoder, retryLength = 0;
      if (typeof input.setEncoding === 'function')
        input.setEncoding('utf8');
      // Adds the data chunk to the buffer and parses as far as possible
      input.on('data', data => {
        if (this._tokenization === tokenization && this._input !== null && data.length !== 0) {
          // Decode bytes, keeping an incomplete trailing character for the next chunk
          if (typeof data !== 'string') {
            decoder = decoder || new TextDecoder('utf-8', { ignoreBOM: true });
            if (!(data = decoder.decode(data, { stream: true })))
              return;
          }
          // Only read a BOM at the start
          if (typeof this._input === 'undefined')
            this._input = this._readStartingBom(data);
          else
            this._input += data;
          // Tokenize as far as possible. When a previous attempt left a long unfinished token,
          // wait until the buffered input has doubled, so the token is not rescanned for every chunk.
          if (this._input.length >= retryLength) {
            this._tryTokenizeToEnd(callback, false);
            retryLength = this._input !== null && this._input.length > MIN_RESCAN_LENGTH ?
              2 * this._input.length : 0;
          }
        }
      });
      // Parses until the end
      input.on('end', () => {
        if (this._tokenization === tokenization && this._input !== null) {
          // Decode any incomplete character left at the end
          const rest = decoder ? decoder.decode() : '';
          if (rest)
            this._input = typeof this._input === 'string' ? this._input + rest : rest;
          if (typeof this._input === 'string')
            this._tryTokenizeToEnd(callback, true);
        }
      });
      input.on('error', error => {
        if (this._tokenization === tokenization)
          callback(error);
      });
    }
  }
}

    return N3Lexer; })();
  // **N3Parser** parses N3 documents.




let blankNodePrefix = 0;
// Detects `.` and `..` path segments in an IRI
const dotSegments = /(^|\/)\.\.?($|[/#?])/;
// Detects `.` and `..` segments in the path of an IRI, ignoring its query and fragment
const pathDotSegments = /^[^?#]*(?:^|\/)\.\.?(?:$|[/#?])/;

// ## Constructor
class N3Parser {
  constructor(options) {
    this._contextStack = [];
    this._graph = null;

    // Set the document IRI
    options = options || {};
    this._setBase(options.baseIRI);
    options.factory && initDataFactory(this, options.factory);

    // Set supported features depending on the format
    const format = (typeof options.format === 'string') ?
                 options.format.match(/(?:^|\W)(\w*)$/)[1].toLowerCase() : '',
        isTurtle = /turtle/.test(format), isTriG = /trig/.test(format),
        isNTriples = /triple/.test(format), isNQuads = /quad/.test(format),
        isN3 = this._n3Mode = /n3/.test(format),
        isLineMode = isNTriples || isNQuads;
    // Keep inverse handling off the non-N3 emission path
    this._emitCurrent = this._emit;
    if (isN3) {
      this._createQuad = this._createQuadInDirection;
      this._emit = this._emitInDirection;
      this._emitCurrent = this._emitCurrentInDirection;
    }
    if (!(this._supportsNamedGraphs = !(isTurtle || isN3)))
      this._readPredicateOrNamedGraph = this._readPredicate;
    // Support triples in other graphs
    this._supportsQuads = !(isTurtle || isTriG || isNTriples || isN3);
    // Whether the log:isImpliedBy predicate is supported
    this._isImpliedBy = options.isImpliedBy;
    // Whether an undeclared empty prefix resolves against the document IRI
    this._implicitEmptyPrefix = !!options.implicitEmptyPrefix;
    // Whether an empty formula is read as the boolean literal true,
    // as in the N3 spec tests (opt-in until the next major version)
    this._emptyFormulaAsTrue = !!options.emptyFormulaAsTrue;
    // Disable relative IRIs in N-Triples or N-Quads mode
    if (isLineMode)
      this._resolveRelativeIRI = iri => { return null; };
    this._blankNodePrefix = typeof options.blankNodePrefix !== 'string' ? '' :
                              options.blankNodePrefix.replace(/^(?!_:)/, '_:');
    // Map the token types of additional directives (@name and NAME) to their names
    this._directives = null;
    if (options.directives) {
      this._directives = Object.create(null);
      for (const name of options.directives)
        this._directives[`@${name.toLowerCase()}`] = this._directives[name.toUpperCase()] = name;
    }
    this._lexer = options.lexer || new N3Lexer({
      lineMode: isLineMode, n3: isN3, isImpliedBy: this._isImpliedBy, directives: options.directives,
    });
    // Disable explicit quantifiers by default
    this._explicitQuantifiers = !!options.explicitQuantifiers;
    // Disable formula-only blank node scoping by default
    this._formulaScopedBlankNodes = !!options.formulaScopedBlankNodes;
    // Disable parsing of unsupported versions by default
    this._parseUnsupportedVersions = !!options.parseUnsupportedVersions;
    this._version = options.version;
    // Maximum nesting depth of triple terms (default 1024; Infinity disables the limit)
    const maxTripleTermDepth = options.maxTripleTermDepth;
    this._maxTripleTermDepth = maxTripleTermDepth === Infinity ||
      Number.isInteger(maxTripleTermDepth) && maxTripleTermDepth >= 0 ? maxTripleTermDepth : 1024;
  }

  // ## Static class methods

  // ### `_resetBlankNodePrefix` restarts blank node prefix identification
  static _resetBlankNodePrefix() {
    blankNodePrefix = 0;
  }

  // ## Private methods

  // ### `_setBase` sets the base IRI to resolve relative IRIs
  _setBase(baseIRI) {
    if (!baseIRI) {
      this._base = '';
      this._basePath = '';
      this._basePathHasDotSegments = false;
    }
    else {
      // Remove fragment if present
      const fragmentPos = baseIRI.indexOf('#');
      if (fragmentPos >= 0)
        baseIRI = baseIRI.substr(0, fragmentPos);
      // Set base IRI and its components
      this._base = baseIRI;
      const queryPos = baseIRI.indexOf('?');
      const path = queryPos < 0 ? baseIRI : baseIRI.substr(0, queryPos);
      this._basePath   = baseIRI.indexOf('/') < 0 ? baseIRI :
                         path.substr(0, path.lastIndexOf('/') + 1);
      const base = baseIRI;
      baseIRI = baseIRI.match(/^(?:([a-z][a-z0-9+.-]*:))?(\/\/[^\/?#]*)?/i);
      this._baseRoot   = baseIRI[0];
      this._baseScheme = baseIRI[1];
      // If the base has an authority but an empty path,
      // relative IRIs merge under the path '/' (RFC 3986 §5.2.3)
      if (baseIRI[2] !== undefined && (base.length === this._baseRoot.length || base[this._baseRoot.length] === '?'))
        this._basePath = `${this._baseRoot}/`;
      // Check once whether resolving against the base path needs to remove dot segments
      this._basePathHasDotSegments = dotSegments.test(this._basePath);
    }
  }

  // ### `_enterTripleTerm` stores the current parsing context when entering a triple term,
  // failing if triple terms nest deeper than the maximum depth
  _enterTripleTerm(type, subject, predicate, token) {
    if (this._tripleTermDepth >= this._maxTripleTermDepth) {
      this._error(`Triple terms nested deeper than ${this._maxTripleTermDepth} level${this._maxTripleTermDepth === 1 ? '' : 's'}`, token);
      return false;
    }
    this._tripleTermDepth++;
    this._saveContext(type, this._graph, subject, predicate, null);
    this._graph = null;
    return true;
  }

  // ### `_saveContext` stores the current parsing context
  // when entering a new scope (list, blank node, formula)
  _saveContext(type, graph, subject, predicate, object) {
    // Only N3 contexts need the extra parser state.
    if (!this._n3Mode) {
      this._contextStack.push({ type, subject, predicate, object, graph });
      return;
    }
    const context = {
      type,
      subject, predicate, object, graph,
      inverse: this._inversePredicate,
      expectOf: this._expectOf,
      blankPrefix: this._prefixes._,
      prefixChanges: this._prefixChanges,
      quantifiedChanges: this._quantifiedChanges,
      emptyFormula: this._emptyFormula,
    };
    // Prefix and base declarations are scoped to their formula,
    // so record prefix changes to undo them when the formula ends
    if (type === 'formula') {
      context.base = [this._base, this._basePath, this._baseRoot, this._baseScheme,
        this._basePathHasDotSegments];
      this._prefixChanges = [];
    }
    this._contextStack.push(context);
    // Every new scope resets the predicate direction
    this._inversePredicate = false;
    this._expectOf = false;
    // In N3, blank nodes and quantifiers are scoped to a formula;
    // with `formulaScopedBlankNodes`, lists and blank node property lists
    // share the enclosing scope instead of rescoping
    if (!this._formulaScopedBlankNodes || type === 'formula') {
      // Label the scope with the enclosing formula's blank node
      // (using a dot as separator, as a blank node label cannot start with it)
      this._prefixes._ = (this._graph ? `${this._graph.value}.` : '.');
      this._quantifiedChanges = [];
    }
    // A formula starts empty and must not inherit its parent's subject
    if (type === 'formula') {
      this._subject = null;
      this._emptyFormula = true;
    }
  }

  // ### `_restoreContext` restores the parent context
  // when leaving a scope (list, blank node, formula)
  _restoreContext(type, token) {
    // Obtain the previous context
    const context = this._contextStack.pop();
    if (!context || context.type !== type)
      return this._error(`Unexpected ${token.type}`, token);

    // Restore the quad of the previous context
    this._subject   = context.subject;
    this._predicate = context.predicate;
    this._object    = context.object;
    this._graph     = context.graph;

    // Restore N3 context settings
    if (this._n3Mode) {
      this._inversePredicate = context.inverse;
      this._expectOf = context.expectOf;
      if (type === 'formula')
        [this._base, this._basePath, this._baseRoot, this._baseScheme,
          this._basePathHasDotSegments] = context.base;
      if (this._prefixChanges !== context.prefixChanges) {
        undoChanges(this._prefixes, this._prefixChanges);
        this._prefixChanges = context.prefixChanges;
      }
      this._prefixes._ = context.blankPrefix;
      if (this._quantifiedChanges !== context.quantifiedChanges) {
        undoChanges(this._quantified, this._quantifiedChanges);
        this._quantifiedChanges = context.quantifiedChanges;
      }
      this._emptyFormula = context.emptyFormula;
    }
  }

  // ### `_readBeforeTopContext` is called once only at the start of parsing.
  _readBeforeTopContext(token) {
    if (this._version && !this._isValidVersion(this._version))
      return this._error(`Detected unsupported version as media type parameter: "${this._version}"`, token);
    return this._readInTopContext(token);
  }

  // ### `_readInTopContext` reads a token when in the top context
  _readInTopContext(token) {
    switch (token.type) {
    // If an EOF token arrives in the top context, signal that we're done
    case 'eof':
      if (this._graph !== null)
        return this._error('Unclosed graph', token);
      delete this._prefixes._;
      return this._callback(null, null, this._prefixes);
    // It could be a prefix declaration
    case 'PREFIX':
      this._sparqlStyle = true;
    case '@prefix':
      return this._readPrefix;
    // It could be a base declaration
    case 'BASE':
      this._sparqlStyle = true;
    case '@base':
      return this._readBaseIRI;
    // It could be a version declaration
    case 'VERSION':
      this._sparqlStyle = true;
    case '@version':
      return this._readVersion;
    // It could be a graph
    case '{':
      if (this._supportsNamedGraphs) {
        this._graph = '';
        this._subject = null;
        return this._readSubject;
      }
    case 'GRAPH':
      if (this._supportsNamedGraphs)
        return this._readNamedGraphLabel;
    // Otherwise, the next token must be a subject, unless it is an additional directive
    default:
      if (this._directives !== null && token.type in this._directives && this._graph === null) {
        this._sparqlStyle = token.type[0] !== '@';
        this._directiveCallback(this._directives[token.type]);
        return this._readDeclarationPunctuation;
      }
      return this._readSubject(token);
    }
  }

  // ### `_readInFormulaContext` reads a token at the statement level of a formula
  _readInFormulaContext(token) {
    switch (token.type) {
    case 'PREFIX':
      this._sparqlStyle = true;
    case '@prefix':
      return this._readPrefix;
    case 'BASE':
      this._sparqlStyle = true;
    case '@base':
      return this._readBaseIRI;
    default:
      return this._readSubject(token);
    }
  }

  // ### `_getStatementReader` returns the reader for the current statement scope
  _getStatementReader() {
    const context = this._contextStack[this._contextStack.length - 1];
    return context && context.type === 'formula' ? this._readInFormulaContext : this._readInTopContext;
  }

  // ### `_readEntity` reads an IRI, prefixed name, blank node, or variable
  _readEntity(token, quantifier) {
    let value;
    switch (token.type) {
    // Read a relative or absolute IRI
    case 'IRI':
    case 'typeIRI':
      const iri = this._resolveIRI(token.value);
      if (iri === null)
        return this._error('Invalid IRI', token);
      value = this._factory.namedNode(iri);
      break;
    // Read a prefixed name
    case 'type':
    case 'prefixed':
      const prefix = this._prefixes[token.prefix];
      if (prefix === undefined)
        return this._error(`Undefined prefix "${token.prefix}:"`, token);
      value = this._factory.namedNode(prefix + token.value);
      break;
    // Read a blank node
    case 'blank':
      value = this._factory.blankNode(this._prefixes[token.prefix] + token.value);
      break;
    // Read a variable
    case 'var':
      value = this._factory.variable(token.value.substr(1));
      break;
    // Everything else is not an entity
    default:
      return this._error(`Expected entity but got ${token.type}`, token);
    }
    // In N3 mode, replace the entity if it is quantified
    if (!quantifier && this._n3Mode && (value.id in this._quantified))
      value = this._quantified[value.id];
    return value;
  }

  // ### `_readList` starts reading a list in the subject, predicate, or object position
  _readList(token, subject, predicate, object) {
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    if (parent.type === '<<') {
      return this._error('Unexpected list in reified triple', token);
    }
    // Start a new list
    this._saveContext('list', this._graph, subject, predicate, object);
    this._subject = null;
    return this._readListItem;
  }

  // ### `_readSubject` reads a quad's subject
  _readSubject(token) {
    this._predicate = null;
    // Any statement token means the enclosing formula is not empty
    if (token.type !== '}')
      this._emptyFormula = false;
    switch (token.type) {
    case '[':
      // Start a new quad with a new blank node as subject
      this._saveContext('blank', this._graph,
                        this._subject = this._factory.blankNode(), null, null);
      return this._readBlankNodeHead;
    case '(':
      return this._readList(token, this.RDF_NIL, null, null);
    case '{':
      // Start a new formula
      if (!this._n3Mode)
        return this._error('Unexpected graph', token);
      this._saveContext('formula', this._graph,
                        this._graph = this._factory.blankNode(), null, null);
      return this._readInFormulaContext;
    case '}':
       // No subject; the graph in which we are reading is closed instead
      return this._readPunctuation(token);
    case '@forSome':
      if (!this._n3Mode)
        return this._error('Unexpected "@forSome"', token);
      this._subject = null;
      this._predicate = this.N3_FORSOME;
      this._quantifier = 'blankNode';
      return this._readQuantifierList;
    case '@forAll':
      if (!this._n3Mode)
        return this._error('Unexpected "@forAll"', token);
      this._subject = null;
      this._predicate = this.N3_FORALL;
      this._quantifier = 'variable';
      return this._readQuantifierList;
    case 'literal':
      if (!this._n3Mode)
        return this._error('Unexpected literal', token);

      if (token.prefix.length === 0) {
        this._literalValue = token.value;
        return this._completeSubjectLiteral;
      }
      else {
        this._subject = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
        // This branch is N3-only, so the literal subject might start a path
        return this._getPathReader(this._readPredicateOrNamedGraph);
      }
    case '<<(':
      if (!this._n3Mode)
        return this._error('Disallowed triple term as subject', token);
      return this._enterTripleTerm('<<(', null, null, token) && this._readSubject;
    case '<<':
      return this._enterTripleTerm('<<', null, null, token) && this._readSubject;
    default:
      // Read the subject entity
      if ((this._subject = this._readEntity(token)) === undefined)
        return;
      // In N3 mode, the subject might be a path
      if (this._n3Mode)
        return this._getPathReader(this._readPredicateOrNamedGraph);
    }

    // The next token must be a predicate,
    // or, if the subject was actually a graph IRI, a named graph
    return this._readPredicateOrNamedGraph;
  }

  // ### `_readPredicate` reads a quad's predicate
  _readPredicate(token) {
    const type = token.type;
    let pathable = false;
    switch (type) {
    case 'inverse':
      this._inversePredicate = true;
    case 'abbreviation':
      this._predicate = this.ABBREVIATIONS[token.value];
      break;
    case 'has':
      return this._readPredicateAfterVerb;
    case 'is':
      this._inversePredicate = true;
      this._expectOf = true;
      return this._readPredicateAfterVerb;
    case 'inversePredicate':
      this._inversePredicate = true;
      return this._readPredicateAfterVerb;
    case '|}':
      // Expected predicate didn't come, must have been trailing semicolon
      // or an empty annotation block
      this._subject = null;
      return this._readAnnotationBlockPunctuation(token);
    case '.':
    case ']':
    case '}':
      // Expected predicate didn't come, must have been trailing semicolon.
      // In N3 mode, a subject (such as a path) can be a statement by itself.
      if (this._predicate === null && !this._n3Mode)
        return this._error(`Unexpected ${type}`, token);
      this._subject = null;
      return type === ']' ? this._readBlankNodeTail(token) : this._readPunctuation(token);
    case ';':
      // Additional semicolons can be safely ignored
      return this._predicate !== null ? this._readPredicate :
             this._error('Expected predicate but got ;', token);
    case 'literal':
      if (!this._n3Mode)
        return this._error('Unexpected literal', token);

      if (token.prefix.length === 0) {
        this._literalValue = token.value;
        return this._completePredicateLiteral;
      }
      else
        this._predicate = this._factory.literal(token.value, this._factory.namedNode(token.prefix));

      pathable = true;
      break;
    case '(':
      // In N3, a list can be a predicate
      return this._n3Mode ?
        this._readList(token, this._subject, this.RDF_NIL, null) :
        this._error(`Expected entity but got ${type}`, token);
    case '[':
      if (this._n3Mode) {
        // Start a new quad with a new blank node as subject
        this._saveContext('blank', this._graph, this._subject,
                          this._subject = this._factory.blankNode(), null);
        return this._readBlankNodeHead;
      }
      return this._error('Disallowed blank node as predicate', token);
    case '{':
      // In N3, a formula can be a predicate
      if (this._n3Mode) {
        this._saveContext('formula', this._graph, this._subject,
                          this._graph = this._factory.blankNode(), null);
        return this._readSubject;
      }
      return this._readEntity(token);
    case 'blank':
      if (!this._n3Mode)
        return this._error('Disallowed blank node as predicate', token);
    default:
      if ((this._predicate = this._readEntity(token)) === undefined)
        return;
      pathable = this._n3Mode;
    }
    this._validAnnotation = true;
    // The next token must be an object
    return pathable ? this._getPathReader(this._readObject, 'predicate') : this._readObject;
  }

  // ### `_readPredicateAfterVerb` reads the predicate following `has` or `is`
  _readPredicateAfterVerb(token) {
    if (token.type === 'has' || token.type === 'is' || token.type === 'of' ||
        token.type === 'inversePredicate')
      return this._error(`Expected expression but got ${token.type}`, token);
    return this._readPredicate(token);
  }

  // ### `_readObject` reads a quad's object
  _readObject(token) {
    if (this._expectOf) {
      if (token.type !== 'of')
        return this._error(`Expected of but got ${token.type}`, token);
      this._expectOf = false;
      return this._readObject;
    }
    switch (token.type) {
    case 'literal':
      // Regular literal, can still get a datatype or language
      if (token.prefix.length === 0) {
        this._literalValue = token.value;
        return this._readDataTypeOrLang;
      }
      // Pre-datatyped string literal (prefix stores the datatype)
      else {
        this._object = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
        // In N3 mode, the literal object might start a path
        if (this._n3Mode)
          return this._getPathReader(this._getContextEndReader());
      }
      break;
    case '[':
      // Start a new quad with a new blank node as subject
      this._saveContext('blank', this._graph, this._subject, this._predicate,
                        this._subject = this._factory.blankNode());
      return this._readBlankNodeHead;
    case '(':
      return this._readList(token, this._subject, this._predicate, this.RDF_NIL);
    case '{':
      // Start a new formula
      if (!this._n3Mode)
        return this._error('Unexpected graph', token);
      this._saveContext('formula', this._graph, this._subject, this._predicate,
                        this._graph = this._factory.blankNode());
      return this._readInFormulaContext;
    case '<<(':
      return this._enterTripleTerm('<<(', this._subject, this._predicate, token) && this._readSubject;
    case '<<':
      return this._enterTripleTerm('<<', this._subject, this._predicate, token) && this._readSubject;
    default:
      // Read the object entity
      if ((this._object = this._readEntity(token)) === undefined)
        return;
      // In N3 mode, the object might be a path
      if (this._n3Mode)
        return this._getPathReader(this._getContextEndReader());
    }
    return this._getContextEndReader();
  }

  // ### `_readPredicateOrNamedGraph` reads a quad's predicate, or a named graph
  _readPredicateOrNamedGraph(token) {
    return token.type === '{' ? this._readGraph(token) : this._readPredicate(token);
  }

  // ### `_readGraph` reads a graph
  _readGraph(token) {
    if (token.type !== '{')
      return this._error(`Expected graph but got ${token.type}`, token);
    // The "subject" we read is actually the GRAPH's label
    this._graph = this._subject, this._subject = null;
    return this._readSubject;
  }

  // ### `_readBlankNodeHead` reads the head of a blank node
  _readBlankNodeHead(token) {
    if (token.type === ']') {
      this._subject = null;
      return this._readBlankNodeTail(token);
    }
    else {
      const stack = this._contextStack, parentParent = stack.length > 1 && stack[stack.length - 2];
      if (parentParent.type === '<<') {
        return this._error('Unexpected compound blank node expression in reified triple', token);
      }
      if (token.type === 'id')
        return this._readIriPropertyListId;
      this._predicate = null;
      return this._readPredicate(token);
    }
  }

  // ### `_readIriPropertyListId` replaces a property list's blank node with its IRI
  _readIriPropertyListId(token) {
    const iri = this._readEntity(token);
    if (iri === undefined)
      return;
    if (iri.termType !== 'NamedNode')
      return this._error(`Expected IRI after id but got ${token.type}`, token);

    const placeholder = this._subject;
    this._subject = iri;
    const context = this._contextStack[this._contextStack.length - 1];
    if (context.subject === placeholder)
      context.subject = iri;
    if (context.predicate === placeholder)
      context.predicate = iri;
    if (context.object === placeholder)
      context.object = iri;
    this._predicate = null;
    return this._readIriPropertyListPredicate;
  }

  // ### `_readIriPropertyListPredicate` requires properties after an IRI property list ID
  _readIriPropertyListPredicate(token) {
    if (token.type === ';' || token.type === ']' || token.type === '.' || token.type === '}')
      return this._error(`Expected predicate but got ${token.type}`, token);
    return this._readPredicate(token);
  }

  // ### `_readBlankNodeTail` reads the end of a blank node
  _readBlankNodeTail(token) {
    if (token.type !== ']')
      return this._readBlankNodePunctuation(token);

    // Store blank node quad
    if (this._subject !== null)
      this._emitCurrent(this._subject, this._predicate, this._object, this._graph);

    // Restore the parent context containing this blank node
    const empty = this._predicate === null;
    this._restoreContext('blank', token);
    // If the blank node was the object, restore previous context and read punctuation
    if (this._object !== null)
      return this._getContextEndReader();
    // If the blank node was the predicate, continue reading the object
    else if (this._predicate !== null)
      return this._getPathReader(this._readObject, 'predicate');
    // If the blank node was the subject, continue reading the predicate
    else
      // If the blank node was empty, it could be a named graph label
      return empty ? this._readPredicateOrNamedGraph : this._readPredicateAfterBlank;
  }

  // ### `_readPredicateAfterBlank` reads a predicate after an anonymous blank node
  _readPredicateAfterBlank(token) {
    switch (token.type) {
    case '.':
    case '}':
      // No predicate is coming if the triple is terminated here
      this._subject = null;
      return this._readPunctuation(token);
    default:
      return this._readPredicate(token);
    }
  }

  // ### `_readListItem` reads items from a list
  _readListItem(token) {
    let item = null,                      // The item of the list
        list = null,                      // The list itself
        next = this._readListItem;        // The next function to execute
    const previousList = this._subject,   // The previous list that contains this list
        stack = this._contextStack,       // The stack of parent contexts
        parent = stack[stack.length - 1]; // The parent containing the current list

    switch (token.type) {
    case '[':
      // Stack the current list quad and start a new quad with a blank node as subject
      this._saveContext('blank', this._graph,
                        list = this._factory.blankNode(), this.RDF_FIRST,
                        this._subject = item = this._factory.blankNode());
      next = this._readBlankNodeHead;
      break;
    case '(':
      // Stack the current list quad and start a new list
      this._saveContext('list', this._graph,
                        list = this._factory.blankNode(), this.RDF_FIRST, this.RDF_NIL);
      this._subject = null;
      break;
    case ')':
      // Closing the list; restore the parent context
      this._restoreContext('list', token);
      // If this list is contained within a parent list, return the membership quad here.
      // This will be `<parent list element> rdf:first <this list>.`.
      if (stack.length !== 0 && stack[stack.length - 1].type === 'list') {
        // In N3 mode, this list might be the start of a path
        if (this._n3Mode) {
          // Close this list's tail, as a path would alter the membership quad only
          if (previousList !== null)
            this._emit(previousList, this.RDF_REST, this.RDF_NIL, this._graph);
          // Create a new context to read the path;
          // _readPath will restore the context and output the membership quad
          this._saveContext('item', this._graph, this._subject, this._predicate, this._object);
          this._subject = this._object, this._predicate = null;
          return this._getPathReader(this._readListItem);
        }
        this._emit(this._subject, this._predicate, this._object, this._graph);
      }
      // Was this list the parent's subject?
      if (this._predicate === null) {
        // The next token is the predicate
        next = this._n3Mode ? this._getPathReader(this._readPredicate) : this._readPredicate;
        // No list tail if this was an empty list
        if (this._subject === this.RDF_NIL)
          return next;
      }
      // Was this list the parent's predicate?
      else if (this._object === null) {
        // The next token is the object
        next = this._getPathReader(this._readObject, 'predicate');
        // No list tail if this was an empty list
        if (this._predicate === this.RDF_NIL)
          return next;
      }
      // The list was in the parent context's object
      else {
        next = this._getContextEndReader();
        // In N3 mode, the list object might be the start of a path
        if (this._n3Mode)
          next = this._getPathReader(next);
        // No list tail if this was an empty list
        if (this._object === this.RDF_NIL)
          return next;
      }
      // Close the list by making the head nil
      list = this.RDF_NIL;
      break;
    case 'literal':
      // Regular literal, can still get a datatype or language
      if (token.prefix.length === 0) {
        this._literalValue = token.value;
        next = this._readListItemDataTypeOrLang;
      }
      // Pre-datatyped string literal (prefix stores the datatype)
      else {
        item = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
        next = this._getContextEndReader();
      }
      break;
    case '{':
      // Start a new formula
      if (!this._n3Mode)
        return this._error('Unexpected graph', token);
      // The formula is an item of the list,
      // so it must be linked in the list's graph before the graph changes
      list = this._factory.blankNode();
      item = this._factory.blankNode();
      // Is this the first element of the list?
      if (previousList === null) {
        // This list is either the subject or the object of its parent
        if (parent.predicate === null)
          parent.subject = list;
        else
          parent.object = list;
      }
      else {
        // Continue the previous list with the current list
        this._emit(previousList, this.RDF_REST, list, this._graph);
      }
      // Output the item
      this._emit(list, this.RDF_FIRST, item, this._graph);
      // Stack the current list quad and start the formula
      this._saveContext('formula', this._graph, list, this.RDF_FIRST,
                        this._graph = item);
      this._subject = null;
      return this._readInFormulaContext;
    case '<<(':
    case '<<':
      if (!this._enterTripleTerm(token.type, null, null, token))
        return;
      next = this._readSubject;
      break;
    default:
      if ((item = this._readEntity(token)) === undefined)
        return;
    }

     // Create a new blank node if no item head was assigned yet
    if (list === null)
      this._subject = list = this._factory.blankNode();

    // When reading a reified triple or triple term, store the list as subject in the stack, as this will be overridden when reading the triple.
    if (token.type === '<<' || token.type === '<<(')
      stack[stack.length - 1].subject = this._subject;

    // Is this the first element of the list?
    if (previousList === null) {
      // The list is the subject of the parent
      if (parent.predicate === null)
        parent.subject = list;
      // The list is the predicate of the parent
      else if (parent.object === null)
        parent.predicate = list;
      // The list is the object of the parent
      else
        parent.object = list;
    }
    else {
      // Continue the previous list with the current list
      this._emit(previousList, this.RDF_REST, list, this._graph);
    }
    // If an item was read, add it to the list
    if (item !== null) {
      // In N3 mode, the item might be a path
      if (this._n3Mode && (token.type === 'IRI' || token.type === 'prefixed' ||
                           token.type === 'var' || token.type === 'blank' ||
                           token.type === 'literal')) {
        // Create a new context to add the item's path
        this._saveContext('item', this._graph, list, this.RDF_FIRST, item);
        this._subject = item, this._predicate = null;
        // _readPath will restore the context and output the item
        return this._getPathReader(this._readListItem);
      }
      // Output the item
      this._emit(list, this.RDF_FIRST, item, this._graph);
    }
    return next;
  }

  // ### `_readDataTypeOrLang` reads an _optional_ datatype or language
  _readDataTypeOrLang(token) {
    return this._completeObjectLiteral(token, false);
  }


  // ### `_readListItemDataTypeOrLang` reads an _optional_ datatype or language in a list
  _readListItemDataTypeOrLang(token) {
    return this._completeObjectLiteral(token, true);
  }

  // ### `_completeLiteral` completes a literal with an optional datatype or language
  // Defers possible direction tags without allocating bound callbacks.
  _completeLiteral(token, component) {
    let literal, readCb = false;

    switch (token.type) {
    // Create a datatyped literal
    case 'type':
    case 'typeIRI':
      const datatype = this._readEntity(token);
      if (datatype === undefined) return; // No datatype means an error occurred
      if (datatype.value === namespaces.rdf.langString || datatype.value === namespaces.rdf.dirLangString) {
        return this._error('Detected illegal (directional) languaged-tagged string with explicit datatype', token);
      }
      literal = this._factory.literal(this._literalValue, datatype);
      token = null;
      break;
    // Create a language-tagged string
    case 'langcode':
      if (token.value.split('-').some(t => t.length > 8))
        return this._error('Detected language tag with subtag longer than 8 characters', token);
      literal = this._factory.literal(this._literalValue, token.value);
      this._literalLanguage = token.value;
      token = null;
      // Save state for a possible direction tag
      this._literalComponent = component;
      readCb = true;
      break;
    // Create a simple string literal by default
    default:
      literal = this._factory.literal(this._literalValue);
    }

    return { token, literal, readCb };
  }

  // ### `_readDirCode` reads an optional directional language tag
  _readDirCode(token) {
    const component = this._literalComponent, listItem = this._literalListItem;
    // Attempt to read a dircode
    if (token.type === 'dircode') {
      const term = this._factory.literal(this._literalValue, { language: this._literalLanguage, direction: token.value });
      if (component === 'subject')
        this._subject = term;
      else if (component === 'predicate')
        this._predicate = term;
      else
        this._object = term;
      this._literalLanguage = undefined;
      token = null;
    }

    if (component === 'subject' || component === 'predicate') {
      // A subject or predicate literal implies N3 mode, so it might start a path
      const next = component === 'subject' ? this._readPredicateOrNamedGraph : this._readObject;
      const reader = this._getPathEndReader(token, next, component);
      return reader || next.call(this, token);
    }
    return this._completeObjectLiteralPost(token, listItem);
  }

  // Completes a literal in subject or predicate position
  _completeTermLiteral(token, component) {
    const completed = this._completeLiteral(token, component);
    if (!completed)
      return;

    let next;
    if (component === 'subject') {
      this._subject = completed.literal;
      next = this._readPredicateOrNamedGraph;
    }
    else {
      this._predicate = completed.literal;
      this._validAnnotation = true;
      next = this._readObject;
    }

    // Postpone completion if the literal is only partially completed (such as lang+dir).
    if (completed.readCb) {
      this._literalListItem = false;
      return this._readDirCode;
    }

    // A subject or predicate literal implies N3 mode, so it might start a path.
    const reader = this._getPathEndReader(completed.token, next, component);
    if (reader)
      return reader;

    // Consume the non-path token now
    return next.call(this, completed.token);
  }

  // Completes a literal in subject position
  _completeSubjectLiteral(token) {
    return this._completeTermLiteral(token, 'subject');
  }

  // Completes a literal in predicate position
  _completePredicateLiteral(token) {
    return this._completeTermLiteral(token, 'predicate');
  }

  // Completes a literal in object position
  _completeObjectLiteral(token, listItem) {
    const completed = this._completeLiteral(token, 'object');
    if (!completed)
      return;

    this._object = completed.literal;

    // Postpone completion if the literal is only partially completed (such as lang+dir).
    if (completed.readCb) {
      this._literalListItem = listItem;
      return this._readDirCode;
    }

    return this._completeObjectLiteralPost(completed.token, listItem);
  }

  _completeObjectLiteralPost(token, listItem) {
    // In N3 mode, the literal object might start a path
    if (this._n3Mode && (token === null || token.type === '!' || token.type === '^')) {
      // If this literal was part of a list, defer writing the item;
      // _readPath will then restore the context and output it
      if (listItem) {
        this._saveContext('item', this._graph, this._subject, this.RDF_FIRST, this._object);
        this._subject = this._object, this._predicate = null;
        return this._getPathEndReader(token, this._readListItem);
      }
      return this._getPathEndReader(token, this._getContextEndReader());
    }
    // If this literal was part of a list, write the item
    // (we could also check the context stack, but passing in a flag is faster)
    if (listItem)
      this._emit(this._subject, this.RDF_FIRST, this._object, this._graph);
    // If the token was consumed, continue with the rest of the input
    if (token === null)
      return this._getContextEndReader();
    // Otherwise, consume the token now
    else {
      this._readCallback = this._getContextEndReader();
      return this._readCallback(token);
    }
  }

  // ### `_readFormulaTail` reads the end of a formula
  _readFormulaTail(token) {
    if (token.type !== '}')
      return this._readPunctuation(token);

    // Store the last quad of the formula
    if (this._subject !== null)
      this._emitCurrent(this._subject, this._predicate, this._object, this._graph);

    const formula = this._graph, empty = this._emptyFormula;
    // Restore the parent context containing this formula
    this._restoreContext('formula', token);

    // When the emptyFormulaAsTrue option is set, an empty formula
    // is read as the boolean literal true, following the N3 spec tests
    // and the direction discussed in https://github.com/w3c-cg/N3/issues/185
    if (empty && this._emptyFormulaAsTrue) {
      if (this._subject === formula)
        this._subject = this.N3_TRUE;
      else if (this._predicate === formula)
        this._predicate = this.N3_TRUE;
      else
        this._object = this.N3_TRUE;
    }

    // Continue according to the formula's position in the enclosing statement
    if (this._object !== null)
      return this._getPathReader(this._getContextEndReader(), 'object');
    if (this._predicate !== null)
      return this._getPathReader(this._readObject, 'predicate');
    return this._getPathReader(this._readPredicate, 'subject');
  }

  // ### `_readPunctuation` reads punctuation between quads or quad parts
  _readPunctuation(token) {
    let next, graph = this._graph;
    const subject = this._subject, inversePredicate = this._inversePredicate;
    switch (token.type) {
    // A closing brace ends a graph
    case '}':
      if (this._graph === null)
        return this._error('Unexpected graph closing', token);
      if (this._n3Mode)
        return this._readFormulaTail(token);
      this._graph = null;
    // A dot just ends the statement, without sharing anything with the next
    case '.':
      this._subject = null;
      this._tripleTerm = null;
      next = this._getStatementReader();
      if (inversePredicate) this._inversePredicate = false;
      break;
    // Semicolon means the subject is shared; predicate and object are different
    case ';':
      if (inversePredicate) this._inversePredicate = false;
      next = this._readPredicate;
      break;
    // Comma means both the subject and predicate are shared; the object is different
    case ',':
      next = this._readObject;
      break;
    // A reifier or annotation block annotates the triple just read
    case '~':
    case '{|':
      return this._readAnnotationStart(token);
    // An annotation block can only be closed from within one
    case '|}':
      return this._error('Unexpected annotation syntax closing', token);
    default:
      // An entity means this is a quad (only allowed if not already inside a graph)
      if (this._supportsQuads && this._graph === null && (graph = this._readEntity(token)) !== undefined) {
        next = this._readQuadPunctuation;
        break;
      }
      return this._error(`Expected punctuation to follow "${this._object.id}"`, token);
    }
    // A quad has been completed now, so return it
    if (subject !== null) {
      const predicate = this._predicate, object = this._object;
      this._emit(subject, predicate, object, graph, inversePredicate);
    }
    return next;
  }

    // ### `_readBlankNodePunctuation` reads punctuation in a blank node
  _readBlankNodePunctuation(token) {
    let next, resetInversePredicate = false;
    switch (token.type) {
    // Semicolon means the subject is shared; predicate and object are different
    case ';':
      resetInversePredicate = this._inversePredicate;
      next = this._readPredicate;
      break;
    // Comma means both the subject and predicate are shared; the object is different
    case ',':
      next = this._readObject;
      break;
    // Annotation syntax applies to the quad just read, exactly as it does
    // outside of a blank node property list
    case '~':
    case '{|':
      return this._readAnnotationStart(token);
    case '|}':
      return this._error('Unexpected annotation syntax closing', token);
    default:
      return this._error(`Expected punctuation to follow "${this._object.id}"`, token);
    }
    // A quad has been completed now, so return it
    this._emitCurrent(this._subject, this._predicate, this._object, this._graph);
    if (resetInversePredicate)
      this._inversePredicate = false;
    return next;
  }

  // ### `_readQuadPunctuation` reads punctuation after a quad
  _readQuadPunctuation(token) {
    if (token.type !== '.')
      return this._error('Expected dot to follow quad', token);
    return this._readInTopContext;
  }

  // ### `_readPrefix` reads the prefix of a prefix declaration
  _readPrefix(token) {
    if (token.type !== 'prefix')
      return this._error('Expected prefix to follow @prefix', token);
    this._prefix = token.value;
    return this._readPrefixIRI;
  }

  // ### `_readPrefixIRI` reads the IRI of a prefix declaration
  _readPrefixIRI(token) {
    if (token.type !== 'IRI')
      return this._error(`Expected IRI to follow prefix "${this._prefix}:"`, token);
    const prefixNode = this._readEntity(token);
    if (this._prefixChanges !== null)
      this._prefixChanges.push(this._prefix, this._prefixes[this._prefix]);
    this._prefixes[this._prefix] = prefixNode.value;
    this._prefixCallback(this._prefix, prefixNode);
    return this._readDeclarationPunctuation;
  }

  // ### `_readBaseIRI` reads the IRI of a base declaration
  _readBaseIRI(token) {
    const iri = token.type === 'IRI' && this._resolveIRI(token.value);
    if (!iri)
      return this._error('Expected valid IRI to follow base declaration', token);
    this._setBase(iri);
    return this._readDeclarationPunctuation;
  }

  // ### `_isValidVersion` checks if the given version is valid for this parser to handle.
  _isValidVersion(version) {
    return this._parseUnsupportedVersions || N3Parser.SUPPORTED_VERSIONS.includes(version);
  }

  // ### `_readVersion` reads version string declaration
  _readVersion(token) {
    if (token.type !== 'literal')
      return this._error('Expected literal to follow version declaration', token);
    // Only short strings are allowed, so no numbers or booleans (which have a datatype prefix)
    if (token.prefix !== '' || token.tripleQuoted)
      return this._error('Version declarations must use single quotes', token);
    this._versionCallback(token.value);
    if (!this._isValidVersion(token.value))
      return this._error(`Detected unsupported version: "${token.value}"`, token);
    return this._readDeclarationPunctuation;
  }

  // ### `_readNamedGraphLabel` reads the label of a named graph
  _readNamedGraphLabel(token) {
    switch (token.type) {
    case 'IRI':
    case 'blank':
    case 'prefixed':
      return this._readSubject(token), this._readGraph;
    case '[':
      return this._readNamedGraphBlankLabel;
    default:
      return this._error('Invalid graph label', token);
    }
  }

  // ### `_readNamedGraphLabel` reads a blank node label of a named graph
  _readNamedGraphBlankLabel(token) {
    if (token.type !== ']')
      return this._error('Invalid graph label', token);
    this._subject = this._factory.blankNode();
    return this._readGraph;
  }

  // ### `_readDeclarationPunctuation` reads the punctuation of a declaration
  _readDeclarationPunctuation(token) {
    // SPARQL-style declarations don't have punctuation
    if (this._sparqlStyle) {
      this._sparqlStyle = false;
      return this._getStatementReader().call(this, token);
    }

    if (token.type !== '.')
      return this._error('Expected declaration to end with a dot', token);
    return this._getStatementReader();
  }

  // Reads a list of quantified symbols from a @forSome or @forAll statement
  _readQuantifierList(token) {
    let entity;
    switch (token.type) {
    case 'IRI':
    case 'prefixed':
      if ((entity = this._readEntity(token, true)) !== undefined)
        break;
    default:
      return this._error(`Unexpected ${token.type}`, token);
    }
    // Without explicit quantifiers, map entities to a quantified entity
    if (!this._explicitQuantifiers) {
      if (this._quantifiedChanges !== null)
        this._quantifiedChanges.push(entity.id, this._quantified[entity.id]);
      this._quantified[entity.id] = this._factory[this._quantifier](this._factory.blankNode().value);
    }
    // With explicit quantifiers, output the reified quantifier
    else {
      // If this is the first item, start a new quantifier list
      if (this._subject === null)
        this._emit(this._graph || this.DEFAULTGRAPH, this._predicate,
                   this._subject = this._factory.blankNode(), this.QUANTIFIERS_GRAPH);
      // Otherwise, continue the previous list
      else
        this._emit(this._subject, this.RDF_REST,
                   this._subject = this._factory.blankNode(), this.QUANTIFIERS_GRAPH);
      // Output the list item
      this._emit(this._subject, this.RDF_FIRST, entity, this.QUANTIFIERS_GRAPH);
    }
    return this._readQuantifierPunctuation;
  }

  // Reads punctuation from a @forSome or @forAll statement
  _readQuantifierPunctuation(token) {
    // Read more quantifiers
    if (token.type === ',')
      return this._readQuantifierList;
    // End of the quantifier list
    else {
      // With explicit quantifiers, close the quantifier list
      if (this._explicitQuantifiers) {
        this._emit(this._subject, this.RDF_REST, this.RDF_NIL, this.QUANTIFIERS_GRAPH);
        this._subject = null;
      }
      // Read a dot
      this._readCallback = this._getContextEndReader();
      return this._readCallback(token);
    }
  }

  // ### `_getPathReader` reads a potential path and then resumes with the given function
  _getPathReader(afterPath, position) {
    this._afterPath = afterPath;
    this._pathPosition = position || (this._predicate === null ? 'subject' : 'object');
    return this._readPath;
  }

  // ### `_getPathEndReader` continues reading after a term that might start a path,
  // given the pending token that follows the term (or `null` if it was consumed)
  _getPathEndReader(token, afterPath, position) {
    // Other pending tokens are not handled here
    if (token !== null && token.type !== '!' && token.type !== '^')
      return null;
    const reader = this._getPathReader(afterPath, position);
    // If no token is pending, wait for the next one; otherwise, consume it now
    return token === null ? reader : reader.call(this, token);
  }

  // ### `_readPath` reads a potential path
  _readPath(token) {
    switch (token.type) {
    // Forward path
    case '!': return this._readForwardPath;
    // Backward path
    case '^': return this._readBackwardPath;
    // Not a path; resume reading where we left off
    default:
      const afterPath = this._afterPath;
      const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
      // If we were reading a list item, we still need to output it
      if (parent && parent.type === 'item') {
        // The list item is the remaining subejct after reading the path
        const item = this._subject;
        // Switch back to the context of the list
        this._restoreContext('item', token);
        // Output the list item
        this._emit(this._subject, this.RDF_FIRST, item, this._graph);
      }
      this._afterPath = null;
      this._pathPosition = null;
      return afterPath.call(this, token);
    }
  }

  // ### `_readForwardPath` reads a '!' path
  _readForwardPath(token) {
    let subject, predicate;
    const object = this._factory.blankNode();
    // The next token is the predicate
    if ((predicate = this._readEntity(token)) === undefined)
      return;
    // Replace the path expression with the generated object in its current position
    if (this._pathPosition === 'subject')
      subject = this._subject, this._subject = object;
    else if (this._pathPosition === 'predicate')
      subject = this._predicate, this._predicate = object;
    else
      subject = this._object,  this._object  = object;
    // Emit the path's current quad and read its next section
    this._emit(subject, predicate, object, this._graph);
    return this._readPath;
  }

  // ### `_readBackwardPath` reads a '^' path
  _readBackwardPath(token) {
    const subject = this._factory.blankNode();
    let predicate, object;
    // The next token is the predicate
    if ((predicate = this._readEntity(token)) === undefined)
      return;
    // Replace the path expression with the generated subject in its current position
    if (this._pathPosition === 'subject')
      object = this._subject, this._subject = subject;
    else if (this._pathPosition === 'predicate')
      object = this._predicate, this._predicate = subject;
    else
      object = this._object,  this._object  = subject;
    // Emit the path's current quad and read its next section
    this._emit(subject, predicate, object, this._graph);
    return this._readPath;
  }

// ### `_readTripleTermTail` reads the end of a triple term
  _readTripleTermTail(token) {
    if (token.type !== ')>>')
      return this._error(`Expected )>> but got ${token.type}`, token);
    // Read the quad and restore the previous context
    const quad = this._createQuad(this._subject, this._predicate, this._object,
        this._graph, this._inversePredicate);
    this._restoreContext('<<(', token);
    this._tripleTermDepth--;

    // If we're in a list, continue processing that list
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    if (parent && parent.type === 'list') {
      this._emit(this._subject, this.RDF_FIRST, quad, this._graph);
      return this._getContextEndReader();
    }
    // If the triple was the subject, continue by reading the predicate.
    if (this._subject === null) {
      this._subject = quad;
      return this._readPredicate;
    }
    // If the triple was the object, read context end.
    else {
      this._object = quad;
      return this._getContextEndReader();
    }
  }

  // ### `_readReifiedTripleTailOrReifier` reads a reifier or the end of a nested reified triple
  _readReifiedTripleTailOrReifier(token) {
    if (token.type === '~') {
      return this._readReifier;
    }
    return this._readReifiedTripleTail(token);
  }

  // ### `_readReifiedTripleTail` reads the end of a nested reified triple
  _readReifiedTripleTail(token) {
    if (token.type !== '>>')
      return this._error(`Expected >> but got ${token.type}`, token);
    // Read the triple term and restore the previous context
    this._tripleTerm = null;
    const reifier = this._readTripleTerm();
    this._restoreContext('<<', token);
    this._tripleTermDepth--;

    // // If we're in a list, continue processing that list
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    if (parent && parent.type === 'list') {
      this._emit(this._subject, this.RDF_FIRST, reifier, this._graph);
      return this._getContextEndReader();
    }
    // If the triple was the subject, continue by reading the predicate.
    else if (this._subject === null) {
      this._subject = reifier;
      return this._readPredicateOrReifierTripleEnd;
    }
    // If the triple was the object, read context end.
    else {
      this._object = reifier;
      return this._getContextEndReader();
    }
  }

  _readPredicateOrReifierTripleEnd(token) {
    if (token.type === '.') {
      this._subject = null;
      return this._readPunctuation(token);
    }
    return this._readPredicate(token);
  }

  // ### `_readReifier` reads the triple term identifier after a tilde when in a reifying triple.
  _readReifier(token) {
    // Without an identifier, the reifier is a fresh blank node
    if (token.type === '>>')
      return this._readReifiedTripleTail(token);
    this._reifier = this._readEntity(token);
    return this._readReifiedTripleTail;
  }

  // ### `_readAnnotationStart` reads the first reifier or annotation block after an object,
  // which completes the annotated quad
  _readAnnotationStart(token) {
    this._emitCurrent(this._subject, this._predicate, this._object, this._graph);
    // A new triple is annotated, so its triple term cannot be reused
    this._tripleTerm = null;
    return this._readAnnotation(token);
  }

  // ### `_readAnnotation` reads what follows an annotated quad:
  // further reifiers or annotation blocks for that same quad, or punctuation
  _readAnnotation(token) {
    switch (token.type) {
    case '~':
      return this._readReifierInAnnotation;
    case '{|':
      return this._readAnnotationBlockHead(token);
    }
    // The annotated quad was already emitted when its annotation started,
    // so continue without emitting it a second time
    this._tripleTerm = null;
    switch (token.type) {
    // The subject stays shared with the next predicate-object pair
    case ';':
      this._inversePredicate = false;
      return this._readPredicate;
    // The subject and predicate stay shared with the next object
    case ',':
      return this._readObject;
    default:
      this._subject = null;
      // Resume in the enclosing context
      return this._getContextEndReader().call(this, token);
    }
  }

  // ### `_readReifierInAnnotation` reads the optional reifier after a tilde in annotation syntax
  _readReifierInAnnotation(token) {
    switch (token.type) {
    case 'IRI':
    case 'typeIRI':
    case 'type':
    case 'prefixed':
    case 'blank':
    case 'var':
      this._reifier = this._readEntity(token);
      return this._readAnnotationBlockOrReifier;
    }
    // Without an identifier, the reifier is a fresh blank node
    this._reifier = this._factory.blankNode();
    return this._readAnnotationBlockOrReifier(token);
  }

  // ### `_readAnnotationBlockOrReifier` reads what follows a reifier:
  // either an annotation block, which uses the reifier as its subject,
  // or anything else, in which case the reifier stands alone
  _readAnnotationBlockOrReifier(token) {
    if (token.type === '{|')
      return this._readAnnotationBlockHead(token);
    this._readTripleTerm();
    return this._readAnnotation(token);
  }

  // ### `_readAnnotationBlockHead` opens an annotation block,
  // whose predicate-object pairs describe the reifier of the annotated quad
  _readAnnotationBlockHead(token) {
    const reifier = this._readTripleTerm();
    this._saveContext('annotation', this._graph, this._subject, this._predicate, this._object);
    // Restored when the block closes, so further annotations reuse the same triple term
    this._contextStack[this._contextStack.length - 1].tripleTerm = this._tripleTerm;
    this._subject = reifier;
    this._predicate = this._object = this._tripleTerm = null;
    this._inversePredicate = false;
    this._validAnnotation = false;
    return this._readPredicate;
  }

  // ### `_readAnnotationBlockPunctuation` reads punctuation inside an annotation block
  _readAnnotationBlockPunctuation(token) {
    const stack = this._contextStack;
    if (token.type === '|}') {
      if (!stack.length || stack[stack.length - 1].type !== 'annotation')
        return this._error('Unexpected annotation syntax closing', token);
      if (!this._validAnnotation)
        return this._error('Annotation block can not be empty', token);
      // Emit the last quad of the block, unless a trailing semicolon already did
      if (this._subject !== null)
        this._emitCurrent(this._subject, this._predicate, this._object, this._graph);
      // Return to the annotated quad, which can be followed by more annotations
      const { tripleTerm } = stack[stack.length - 1];
      this._restoreContext('annotation', token);
      this._tripleTerm = tripleTerm;
      return this._readAnnotation;
    }
    // Otherwise, punctuation inside a block works like inside a blank node property list
    return this._readBlankNodePunctuation(token);
  }

  _readTripleTerm() {
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    const parentGraph = parent ? parent.graph : undefined;
    const reifier = this._reifier || this._factory.blankNode();
    this._reifier = null;
    this._tripleTerm = this._tripleTerm || this._createQuad(
      this._subject, this._predicate, this._object, null, this._inversePredicate,
    );
    this._emit(reifier, this.RDF_REIFIES, this._tripleTerm, parentGraph || this._graph || this.DEFAULTGRAPH);
    return reifier;
  }

  // ### `_getContextEndReader` gets the next reader function at the end of a context
  _getContextEndReader() {
    const contextStack = this._contextStack;
    if (!contextStack.length)
      return this._readPunctuation;

    switch (contextStack[contextStack.length - 1].type) {
    case 'blank':
      return this._readBlankNodeTail;
    case 'list':
      return this._readListItem;
    case 'formula':
      return this._readFormulaTail;
    case '<<(':
      return this._readTripleTermTail;
    case '<<':
      return this._readReifiedTripleTailOrReifier;
    case 'annotation':
      return this._readAnnotationBlockPunctuation;
    }
  }

  // ### `_createQuad` creates a quad
  _createQuad(subject, predicate, object, graph) {
    return this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
  }

  // ### `_createQuadInDirection` creates a quad in the active predicate direction
  _createQuadInDirection(subject, predicate, object, graph, inversePredicate) {
    return inversePredicate ?
      this._factory.quad(object, predicate, subject, graph || this.DEFAULTGRAPH) :
      this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
  }

  // ### `_emitInDirection` sends a quad in the active predicate direction
  _emitInDirection(subject, predicate, object, graph, inversePredicate) {
    this._callback(null, this._createQuad(subject, predicate, object, graph, inversePredicate));
  }

  // ### `_emitCurrentInDirection` sends a quad in the current predicate direction
  _emitCurrentInDirection(subject, predicate, object, graph) {
    this._callback(null, this._createQuad(subject, predicate, object, graph, this._inversePredicate));
  }

  // ### `_emit` sends a quad through the callback
  _emit(subject, predicate, object, graph) {
    this._callback(null, this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH));
  }

  // ### `_error` emits an error message through the callback
  _error(message, token) {
    // Bound input-derived content while preserving the line suffix and full token context.
    const suffix = ` on line ${token.line}.`;
    if (message.length + suffix.length > 200)
      message = `${message.slice(0, 199 - suffix.length)}…`;
    const err = new Error(`${message}${suffix}`);
    err.context = {
      token: token,
      line: token.line,
      previousToken: this._lexer.previousToken,
    };
    this._callback(err);
    this._callback = noop;
  }

  // ### `_resolveIRI` resolves an IRI against the base path
  _resolveIRI(iri) {
    return /^[a-z][a-z0-9+.-]*:/i.test(iri) ? iri : this._resolveRelativeIRI(iri);
  }

  // ### `_resolveRelativeIRI` resolves an IRI against the base path,
  // assuming that a base path has been set and that the IRI is indeed relative
  _resolveRelativeIRI(iri) {
    // An empty relative IRI indicates the base IRI
    if (!iri.length)
      return this._base;
    // Decide resolving strategy based in the first character
    switch (iri[0]) {
    // Resolve relative fragment IRIs against the base IRI
    case '#': return this._base + iri;
    // Resolve relative query string IRIs by replacing the query string
    case '?': {
      const queryPos = this._base.indexOf('?');
      return (queryPos < 0 ? this._base : this._base.substr(0, queryPos)) + iri;
    }
    // Resolve root-relative IRIs at the root of the base IRI
    case '/':
      // Resolve scheme-relative IRIs to the scheme,
      // keeping the reference's authority intact (RFC 3986 §5.2.4)
      if (iri[1] !== '/')
        return this._baseRoot + this._removeDotSegments(iri);
      // Without a base scheme, a leading ':' marks where the authority starts
      return this._baseScheme ? this._removeDotSegments(this._baseScheme + iri) :
        this._removeDotSegments(`:${iri}`).substr(1);
    // Resolve all other IRIs at the base IRI's path
    default:
      // Relative IRIs cannot contain a colon in the first path segment
      if (/^[^/:]*:/.test(iri))
        return null;
      // Only scan the joined IRI for dot segments if either part can contain them,
      // as the base path can be long and the joined IRI would need to be copied
      return this._basePathHasDotSegments || pathDotSegments.test(iri) ?
        this._removeDotSegments(this._basePath + iri) : this._basePath + iri;
    }
  }

  // ### `_removeDotSegments` resolves './' and '../' path segments in an IRI as per RFC3986
  _removeDotSegments(iri) {
    // Don't modify the IRI if it does not contain any dot segments
    if (!dotSegments.test(iri))
      return iri;

    // Start with an imaginary slash before the IRI in order to resolve trailing './' and '../'
    const length = iri.length;
    let result = '', i = -1, pathStart = -1, segmentStart = 0, next = '/';

    while (i < length) {
      switch (next) {
      // The path starts with the first slash after the authority
      case ':':
        if (pathStart < 0) {
          // Skip two slashes before the authority
          if (iri[++i] === '/' && iri[++i] === '/')
            // Skip to the end of the authority
            while ((pathStart = i + 1) < length && iri[pathStart] !== '/' && iri[pathStart] !== '?' && iri[pathStart] !== '#')
              i = pathStart;
        }
        break;
      // Don't modify a query string or fragment
      case '?':
      case '#':
        i = length;
        break;
      // Handle '/.' or '/..' path segments
      case '/':
        if (iri[i + 1] === '.') {
          next = iri[++i + 1];
          switch (next) {
          // Remove a '/.' segment
          case '/':
            result += iri.substring(segmentStart, i - 1);
            segmentStart = i + 1;
            break;
          // Remove a trailing '/.' segment
          case undefined:
          case '?':
          case '#':
            return result + iri.substring(segmentStart, i) + iri.substr(i + 1);
          // Remove a '/..' segment
          case '.':
            next = iri[++i + 1];
            if (next === undefined || next === '/' || next === '?' || next === '#') {
              result += iri.substring(segmentStart, i - 2);
              // Try to remove the parent path from result
              if ((segmentStart = result.lastIndexOf('/')) >= pathStart)
                result = result.substr(0, segmentStart);
              // Remove a trailing '/..' segment
              if (next !== '/')
                return `${result}/${iri.substr(i + 1)}`;
              segmentStart = i + 1;
            }
          }
        }
      }
      next = iri[++i];
    }
    return result + iri.substring(segmentStart);
  }

  // ## Public methods

  // ### `parse` parses the N3 input and emits each parsed quad through the onQuad callback.
  parse(input, quadCallback, prefixCallback, versionCallback) {
    // The second parameter also accepts an object of named callbacks.
    // As a second and third parameter it still accepts a separate quadCallback and prefixCallback for backward compatibility as well
    let onQuad, onPrefix, onComment, onVersion, onDirective, onToken, onTokenEnd;
    if (quadCallback && (quadCallback.onQuad || quadCallback.onPrefix || quadCallback.onComment || quadCallback.onVersion ||
                         quadCallback.onDirective || quadCallback.onToken || quadCallback.onTokenEnd)) {
      onQuad = quadCallback.onQuad;
      onPrefix = quadCallback.onPrefix;
      onComment = quadCallback.onComment;
      onVersion = quadCallback.onVersion;
      onDirective = quadCallback.onDirective;
      onToken = quadCallback.onToken;
      onTokenEnd = quadCallback.onTokenEnd;
    }
    else {
      onQuad = quadCallback;
      onPrefix = prefixCallback;
      onVersion = versionCallback;
    }
    // The read callback is the next function to be executed when a token arrives.
    // We start reading in the top context.
    this._readCallback = this._readBeforeTopContext;
    // A parse that failed part-way can have left scopes and a statement open
    this._contextStack = [];
    this._graph = this._subject = this._predicate = this._object = null;
    this._tripleTerm = this._reifier = null;
    this._sparqlStyle = false;
    this._prefixes = Object.create(null);
    this._prefixes._ = this._blankNodePrefix ? this._blankNodePrefix.substr(2)
                                             : `b${blankNodePrefix++}_`;
    // Optionally bind the N3 empty prefix to the document's local namespace
    if (this._n3Mode && this._implicitEmptyPrefix && this._base)
      this._prefixes[''] = this._resolveIRI('#');
    this._prefixCallback = onPrefix || noop;
    this._versionCallback = onVersion || noop;
    this._directiveCallback = onDirective || noop;
    this._inversePredicate = false;
    this._expectOf = false;
    this._quantified = Object.create(null);
    // Changes to prefixes and quantifiers in nested scopes, to undo when leaving them
    this._prefixChanges = null;
    this._quantifiedChanges = null;
    this._emptyFormula = false;
    this._tripleTermDepth = 0;

    const readGrammarToken = token => {
      return this._readCallback = this._readCallback(token);
    };
    let readToken = readGrammarToken;

    // Comments bypass the grammar, but participate in the token lifecycle.
    if (onComment || this._lexer.comments) {
      this._lexer.comments = true;
      readToken = token => {
        if (token.type !== 'comment')
          return readGrammarToken(token);
        if (onComment) onComment(token.value);
        return this._readCallback;
      };
    }

    // Install observers once per parse, leaving the ordinary token path intact.
    if (onToken || onTokenEnd) {
      const consumeToken = readToken;
      readToken = token => {
        try {
          try {
            if (onToken) onToken(token);
            return consumeToken(token);
          }
          finally {
            if (onTokenEnd) onTokenEnd(token);
          }
        }
        catch (error) {
          // A consumer exception aborts this parse, including later chunks.
          this._readCallback = null;
          throw error;
        }
      };
    }

    // Parse synchronously if no quad callback is given.
    if (!onQuad) {
      const quads = [];
      let error;
      this._callback = (e, t) => { e ? (error = e) : t && quads.push(t); };
      const lexer = this._lexer;
      // Without callbacks, nothing observes the parse before the whole document
      // has lexed, so tokens can be parsed as they are lexed instead of being
      // collected into an array first. A lexer that replaces the built-in
      // tokenize keeps going through its own implementation.
      if (!onPrefix && !onVersion && !onDirective && !onComment && !onToken && !onTokenEnd &&
          lexer.tokenize === N3Lexer.prototype.tokenize && typeof lexer._tokenizeString === 'function') {
        // A lexical error used to stop the parse before any token was read,
        // so undo base declarations that were read before it
        const base = [this._base, this._basePath, this._baseRoot, this._baseScheme];
        lexer._tokenizeString(input, (e, token) => {
          if (e) {
            [this._base, this._basePath, this._baseRoot, this._baseScheme] = base;
            this._callback(e), this._callback = noop;
          }
          else if (this._readCallback) readToken(token);
        });
      }
      else
        lexer.tokenize(input).every(readToken);
      if (error) throw error;
      return quads;
    }

    const processNextToken = (error, token) => {
      if (error !== null)
        this._callback(error), this._callback = noop;
      else if (this._readCallback)
        readToken(token);
    };

    // Parse asynchronously otherwise, executing the read callback when a token arrives
    this._callback = onQuad;
    this._lexer.tokenize(input, processNextToken);
  }
}

// ### `undoChanges` restores the entries of a map from a list of key and previous value pairs
function undoChanges(map, changes) {
  for (let i = changes.length - 2; i >= 0; i -= 2) {
    if (changes[i + 1] === undefined)
      delete map[changes[i]];
    else
      map[changes[i]] = changes[i + 1];
  }
}

// The empty function
function noop() {}

// Initializes the parser with the given data factory
function initDataFactory(parser, factory) {
  parser._factory = factory;

  parser.DEFAULTGRAPH = factory.defaultGraph();

  // Set common named nodes
  parser.RDF_FIRST   = factory.namedNode(namespaces.rdf.first);
  parser.RDF_REST    = factory.namedNode(namespaces.rdf.rest);
  parser.RDF_NIL     = factory.namedNode(namespaces.rdf.nil);
  parser.RDF_REIFIES = factory.namedNode(namespaces.rdf.reifies);
  parser.N3_FORALL   = factory.namedNode(namespaces.r.forAll);
  parser.N3_FORSOME  = factory.namedNode(namespaces.r.forSome);
  parser.N3_TRUE     = factory.literal('true', factory.namedNode(namespaces.xsd.boolean));
  parser.ABBREVIATIONS = {
    'a': factory.namedNode(namespaces.rdf.type),
    '=': factory.namedNode(namespaces.owl.sameAs),
    '>': factory.namedNode(namespaces.log.implies),
    '<': factory.namedNode(namespaces.log.isImpliedBy),
  };
  parser.QUANTIFIERS_GRAPH = factory.namedNode('urn:n3:quantifiers');
}
N3Parser.SUPPORTED_VERSIONS = [
  '1.2',
  '1.2-basic',
  '1.1',
];
initDataFactory(N3Parser.prototype, N3DataFactory);

  return N3Parser;
})();
