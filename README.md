# Graph Overlay Inspector

Match a P&ID with its extracted knowledge graph as a graphical overlay. Inspect the knowledge graph (BOT / FSO / Brick, Turtle) directly on the drawing it came from. Run SPARQL on the graph with the results shown on the drawing. Refine the graph with issue reports, rules, single entity and predicate changes, or by having Claude re-check sub-areas of the P&ID. Fixes go back into the graph through a change log.

- **Online app (runs inside Claude):** https://claude.ai/artifact/8YhmdfPfZJrJiHpNsR8LF8. It is shared as *Anyone with the link* and the HTRK-VEN03 ventilation demo is preloaded.
- **Single-file copy:** [`graph-overlay-inspector.html`](graph-overlay-inspector.html). It works in any browser; Claude features there use your own API key (see §1).

---

## 1. Ways to run and share it

### The online app (recommended)
- **It is a page hosted on claude.ai, not part of a chat.** It keeps working after the chat that built it ends. Every republish updates the same link for everyone.
- **Anyone with the link can open it.** The review features work for everybody: loading files, overlay, review, checks, applying fixes, SPARQL and exports.
- **The Claude features (Anchor, Re-check areas, Resolve with Claude) work when the link is opened inside claude.ai while signed in.**
  - The calls run on the viewer's own Claude account and usage, never the author's.
  - The first call asks the viewer to allow it, including sending images.
  - If the viewer's plan lacks Claude Opus 5.5, a nearby model answers; the run log names the model that did.
- **Every person's work is private to their own browser.** Viewers don't see each other's graphs, drawings or reviews. A review travels as a project file (see below).
- **Only the author can change the published app.** Viewers cannot edit it. On Team and Enterprise plans the author can add editors in the Share menu.
- **Anyone can make their own copy.** A viewer can copy or customise the page into their own chat, or edit the HTML file, and change that copy as they like. The original and its link are not affected. A copy's *Open in Claude* button still points to the original link unless `ARTIFACT_URL` in `src/app.js` is changed.
- **Public links can be blocked by an organisation.** If the author's or the viewer's organisation blocks public links, the link won't open.

### The single HTML file
The file is enough to share on its own. Everything except the Claude features works locally. For the Claude features there are two routes:

1. **Your own Anthropic API key** (Open → *Claude API key (.env)…*, the setup card, or the *Open in Claude* dialog):
   - Enter the key, choose the model (Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.1) and the max output tokens. *Test* sends a one-word request.
   - The app then calls `https://api.anthropic.com/v1/messages` directly from the browser (streaming). Usage is billed to the key's account. Images are scaled to about 1.15 MP / 1568 px first.
   - **Keep a `.env` file next to the HTML file** (named `.env` or `claude.env`):
     ```
     ANTHROPIC_API_KEY=sk-ant-…
     CLAUDE_MODEL=claude-opus-5-5
     CLAUDE_MAX_TOKENS=32000
     ```
     `CLAUDE_API_KEY`, `ANTHROPIC_MODEL`, `MODEL` and `MAX_TOKENS` are accepted too. *Save as .env file* writes one for you.
   - **Served over http(s)** (e.g. `python3 -m http.server` in that folder), the app finds the file by itself. **Opened from disk (file://)**, browsers don't let a page read its neighbours, so use *Load .env file…* once and tick *Remember in this browser*.
   - The key stays in the browser (only in `localStorage` if you tick Remember; *Forget key* removes it), is sent only to api.anthropic.com and is never written to project files. **Never commit a `.env` file**; this repo's `.gitignore` excludes them.
   - Inside the claude.ai artifact the page can't reach the API (content security policy); there the viewer's Claude account is used instead.
2. **Open in Claude** (top bar, or ⋯ on phones):
   - **Save project file:** one `.project.json` holding graph(s), drawing, legend and reference images with notes, placements, review, rules, proposals and change log;
   - **a link to the online app.** There, drop the project file on the page or use *Open → Open project file*, and everything comes back as it was.

Limits of the file route:
- **The project hand-off to Claude is manual (save + drop).** Browsers keep a local file and a Claude page completely apart.
- **The file is a snapshot of the app version it was made from.** The online app gets updates; project files work in both.
- **PDF drawings need internet,** because the PDF renderer (pdf.js 4.10.38 from jsDelivr) loads on demand. PNG and JPG work offline.
- **The demo is not in the file.** *Load demo* says so and offers *Open in Claude*. Serving the `site/` folder over http includes it.
- **Uploading the HTML into a Claude chat makes a separate copy** (a chat artifact) that is not connected to the Claude features. Share the link instead.

---

## 2. Workflow

1. **Start a review.**
   - The setup card stays until both a graph and a drawing are loaded. Its rows: knowledge graph, drawing, legend and other images (optional), and Claude (API key, optional outside Claude).
   - Formats: Turtle / N-Triples / TriG graphs (several files can be merged), and a PNG / JPG drawing or a PDF page.
   - **Several images at once:** *Open drawing* accepts more than one file. A dialog shows a thumbnail per image, its role (Main drawing / Legend / Title block / Context) and a note for Claude. *Add images to the project* adds reference images later without restarting.
   - Opening your own files replaces the demo.
   - **New project** (next to Open) offers to save the current project first, then starts empty. It also forgets the review this browser stored for that drawing.
2. **Place instances on the drawing.**
   - Numeric `…X` / `…Y` predicate pairs in the graph (e.g. `sig:drawingX` / `sig:drawingY`) are used automatically.
   - **Anchor with Claude** places the rest in one call. It sends an overview plus gridded tiles, the reference images with their notes, and each instance's classes and relations.
   - Without the in-page call: export the anchoring prompt, run it in any Claude chat with the drawing attached, and import the JSON reply.
3. **Review.**
   - Click, Ctrl/⌘-click and long-hover instances to inspect them (§3).
   - Drag nodes to correct them; dropping a node outside the drawing marks it as not on this drawing.
   - Mark instances and links as Correct, Issue, Unsure or Resolved, with a comment.
   - Decide for whole groups at once in *Review & checks*.
4. **Re-check areas** marks doubtful places on the drawing (squares or rectangles). Claude compares the areas with the graph, and with each other, in one call.
5. **Issues → Resolve with Claude** sends the open flags, rules and notes you pick in one call. Claude proposes concrete fixes.
6. **Accept** the fixes you agree with, then **Apply to graph**. The view updates, and each applied fix becomes a change-log entry.
7. **Query** the graph with **SPARQL** and see the results on the drawing.
8. **Export** the refined graph (.ttl), the SPARQL Update, the change log (.csv), the review report (.csv) or the project file.

**Undo / redo** (↶ ↷, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z) covers moves, reviews, decisions, rules, imports, Claude runs, accepting, applying and reverting. It holds 200 steps and is cleared when another graph or drawing is opened.

---

## 3. Features

### Selecting and inspecting
- **Click an instance:** the view zooms (animated) to fit all its connections. Connections whose category is switched off appear dimmed and dashed but clickable. The selection's lines are drawn on top of the labels. Clicking the empty drawing closes the card, hides those lines and zooms back to the view before.
- **Ctrl-click (⌘-click on a Mac)** adds instances to the selection. The card then shows:
  - shared values (location, system, parent, class) in green, and *(multiple values)* in grey where they differ;
  - a chip per instance at the top to switch to its own details;
  - **Show path:** highlights the shortest chain of shown links between the selected instances; if there is none it says so and names what they share (room, system or parent).
- **Instance card:** classes, system, location, connections, literal properties and placement. Pointing at a connection lights up its line; clicking the row opens the connection card, clicking it again closes it. The connection card highlights its subject and object.
- **Issues & checks per instance:** each card ends with the automatic checks, flagged links, rules it breaks, Claude's proposals and applied changes that concern it, each with its decision inline.
- **Long hover** (about 1 s): shows the instance's name (also for faded ones) and draws all its incoming and outgoing lines thicker.
- **Reset** (zoom bar, or R): resets the fader, zoom and every highlight, then asks whether to highlight what is still in question.
- Clicking the empty drawing with nothing selected clears every highlight, including the outline of a re-check area or finding.

### Issues panel (right side)
- **Cards show only their header** until chosen. Clicking a card opens it and highlights its instances and links in orange (glow plus rings); clicking it again, or the empty drawing, lets go. Sections fold away (remembered per browser).
- **Rules & general notes.**
  - A rule says which classes or kinds a predicate may connect, e.g. "brick:feeds only between physical elements". Kinds: physical element, component, segment, fitting, location, system, point. Matching respects `rdfs:subClassOf`.
  - Violations are counted live; opening the card highlights them.
  - *Propose removals* turns violations into fixes without Claude.
  - General notes are free-text instructions for Claude.
- **Flagged instances & links.** Each card has the entity or the triples behind the line, the status, the report it was decided from, and an editable comment.
- **Proposed fixes & re-check findings.** Accept, dismiss or reopen each one, or *Accept all* per group; accepted ones can then be applied. Fix types:
  - re-point link, remove link, reverse link, add link;
  - add instance, delete instance, change class;
  - move node.
- **Resolve with Claude:** a collapsed *Items in this run* list ticks every open item; untick any to leave it out (the items sent are numbered I1… in order).
- **Change log** (see below).

### Applying fixes and the change log
- **The loaded files are never modified.** The graph on screen is the source graph with the active change-log entries applied in order; the last operation on a triple wins.
- **Each entry records:**
  - the triples removed (−) and added (+);
  - Claude's reason and the reviewer's comment or rule;
  - the origin (run, model, item or area), the time, and any notes.
- **Applying** marks the flags it answers as Resolved. **Revert** takes an entry back out of the graph and restores those flags; the entry stays in the log as reverted.
- **Exports:**
  - **Refined graph (.ttl):** the effective graph, merged into one Turtle file and re-parsed before saving.
  - **SPARQL Update:** the net change against the source as DELETE DATA / INSERT DATA.
  - **Change log (.csv).**
- The change log is stored per drawing, like the rest of the review, so each page of a multi-page PDF keeps its own.

### Review & checks (left panel)
- **Automatic reports (no LLM):**
  - unplaced instances;
  - low-confidence placements (confidence < 0.6);
  - components without any flow link;
  - open-ended segments;
  - unusually long flow links (longer than both 5 × the median flow link and 22 % of the drawing diagonal);
  - flows asserted in both directions;
  - untyped instances;
  - anchors outside the drawing.
- **Each report header** shows its size and how many items are still undecided ("n open" or ✓). Clicking it gives:
  - **Show all:** highlights the items and dims the rest. A pill above the fader shows what's highlighted; ✕ or Esc clears it.
  - **Mark all / Unmark all,** plus a checkbox per item. Marked items get a dashed ring.
  - **Decide for N marked…:** one decision (Issue / Unsure / Correct) and one comment for all of them. Issue and Unsure items go to *Resolve with Claude* together, with the report name.
  - **Undecided only:** a filter.

### Re-check areas
- **Entering the mode** dims the drawing and fades the graph to 15 %; the fader still works.
- **Square:** each tap adds a rounded square, 4 × a typical symbol by default (2–8 ×).
- **Rectangle:** click one corner, then the opposite corner, as in Paint; a dashed rubber band follows the pointer and Esc cancels the first corner.
- Clicking an area removes it; up to 12 areas per call.
- **Claude receives** an overview, a clean and a tagged close-up per area, the reference images with notes, and the graph content inside each area.
- **The areas are related** (ticked by default for two or more areas): Claude compares the areas with each other too, reports a recurring problem in every area where it occurs with the same wording, and names the shared pattern in each summary.

### SPARQL panel
- **SPARQL** (top bar; ⋯ on phones) opens a right-hand panel. Queries run in the browser on the effective graph (sources plus applied changes) with a small SPARQL 1.1 engine written for the app (`src/sparql.js`, no external library).
- **Supported:** SELECT, ASK, CONSTRUCT, DESCRIBE; property paths (`/ | ^ * + ? !`); OPTIONAL, UNION, MINUS, FILTER, BIND, VALUES, sub-SELECT, (NOT) EXISTS; GROUP BY / HAVING with COUNT, SUM, AVG, MIN, MAX, SAMPLE, GROUP_CONCAT; ORDER BY, DISTINCT, LIMIT, OFFSET; the usual built-in functions. Errors give the line and column; very expensive queries stop at a step cap.
- **Prefixes:** the graph's prefixes plus `rdf rdfs owl xsd bot fso brick` work without PREFIX lines.
- **owl:sameAs as identity** (checkbox, on by default):
  - the graph is expanded with the OWL 2 RL equality rules before the query runs: sameAs is symmetric and transitive (eq-sym, eq-trans), and every triple about one alias holds for every other alias in subject, predicate and object position (eq-rep-s/p/o);
  - the results line reports the number of sameAs groups and inferred triples; the expansion is capped at 3 million triples;
  - when a result names an alias that isn't on the drawing, the view highlights the member of its group that is;
  - unticking it re-runs the query on the asserted triples only.
- **Editor:** Ctrl/⌘+Enter runs; *Examples* (classes, flow links, downstream of the AHU, components without a room, dampers, parts, label search, dead ends, owl:sameAs groups, ASK, CONSTRUCT) and *History* (last 25 queries).
- **Results:** a list (first 400 rows) where IRIs of instances on the drawing are links; *Expand* opens a big table with full screen, filter, column sorting and CSV download.
- **Show results in the view:** highlights every entity found plus the links between the entities of each row (restricted to the row's predicates when the query returns some), including links whose category is switched off. Clicking a row highlights just that row.

### Reference images
- The legend, title blocks and other context images each carry a role and a note; the main drawing can carry a note too. All notes go into the anchoring, re-check and resolve prompts; images that don't fit the image budget go in as text notes.
- The image window (top-bar icon) has a tab per image, the note, zoom, and ✎ to edit roles and notes or remove images.

---

## 4. Current settings and defaults

| Setting | Default | Where |
| :- | :- | :- |
| Scope | This drawing | Side panel → Scope (This drawing / + Neighbours / Full graph) |
| Connection categories (on/off, colour) | Flow on `#2563eb` · Sensing & points on `#16a34a` · Location on `#d97706` · System topology **off** `#7c3aed` · Parts & composition on `#db2777` · Heat transfer on `#dc2626` · Physical connection on `#0f766e` · Other links **off** `#64748b` | Side panel → Connections (per category and per predicate; colours editable) |
| Flow shades | `fso:returnsFluidTo` `#0891b2`; `brick:feeds`, `fso:feedsFluidTo` `#3b82f6` | Per-predicate colour |
| Check all / Uncheck all | — | Connections. Ticking one predicate switches its category on |
| Merge parallel predicates into one line | on | Connections |
| Fade instances without a shown connection | on (drawn at 50 %, name hidden until a long hover) | Connections |
| Show class (rdf:type) under names | on (T toggles) | Display |
| Class shown | Most specific | Display (or prefer one namespace) |
| Node name | Instance name (IRI local part) | Display (or rdfs:label) |
| Label size | 11 px (8–16) | Display |
| Node size | 3 × (1–5 ×); shrinks to 0.6 × when zoomed far out, full size from 2 × the fit zoom | Display |
| Line width | 2 × (1–4 ×) | Display |
| Hide labels that would overlap | on | Display |
| Invert drawing (dark) | off | Display |
| Background | white (light theme) | Theme |
| Long hover | ≈ 0.9 s | Fixed |
| Highlight flagged items only | off | Review & checks |
| Proposals on drawing | on | Issues panel |
| Drawing ⇄ Graph fader | centre (both 100 %); snaps to centre within ±7; double-click recentres | Bottom of the canvas |
| Re-check areas | square, 4 × symbol (2–8 ×), or rectangle; max 12 areas; "related" on for ≥ 2 | Re-check bar / dialog |
| Low-confidence threshold | 0.6 (dotted amber ring) | Fixed |
| SPARQL | Show results in the view: on · owl:sameAs: on | SPARQL panel |
| Theme | Auto (follows the system) | Top bar (Auto → Light → Dark) |
| Claude model inside Claude | `claude-opus-5-5`, tier `complex` (falls back to a nearby tier if the viewer's plan lacks it) | Fixed |
| Claude model with an API key | `claude-opus-5-5`, max 32 000 output tokens | Claude API key dialog or `.env` |
| Anchoring images | tiles ≈ 1.15 MP, longest side ≤ 1568 px; up to a quarter of the image budget for reference images | Fixed |
| Undo history | 200 steps | Fixed |

Kept per browser in `localStorage`: `kgov:settings`, `kgov:theme`, `kgov:areaFactor`, `kgov:areaShape`, `kgov:issSec` (folded sections), `kgov:sparqlQ`, `kgov:sparqlHist`, `kgov:sparqlView`, `kgov:sparqlSameAs`, and `kgov:api` (only when you tick Remember).

Review state is kept per drawing in `kgov:ds:<image hash>:p<page>`. It holds placements, review, rules, findings and the change log.

The last session (graphs, drawing, legend, reference images and notes) is kept in IndexedDB `kg-overlay-inspector` / `last`.

**Published artifact:**
- runtime contract 0.2.85;
- capabilities `sample` (with images) and `downloads`;
- sharing *Anyone with the link*.

---

## 5. Display rules
- **Line style:** solid = component ↔ component. Dashed = one end is a room, zone, storey or system. Hidden connections of a selection: thinner, dashed and dimmed.
- **Arrows:** canonical direction. Flows point in the flow direction; topology and location point from container to part. Inverse predicates (e.g. `brick:isFedBy`) are drawn like their forward form. Parallel predicates (e.g. `fso:suppliesFluidTo` + `brick:feeds`) share one line.
- **Highlights:** the issue in question (card, path, SPARQL result) is orange with a glow and rings; the rest dims.
- **Node shapes:** ● component, ○ duct/pipe segment, ■ fitting, ▢ location, ⬡ system, ◆ point/sensor. A dashed outline means not placed; a dotted ring means low placement confidence.
- **Hidden from the canvas:** `rdf:type` (shown under names), `rdfs:*`, `owl:*`, `skos:*`, `dcterms:*` and literals. All of them appear in the details card.
- **Phones:** the side panel, Issues and SPARQL panels open as drawers; choosing a card or result row closes the drawer and keeps the highlight. ⋯ holds New project, Open in Claude, Claude API key, Add images, Re-check, SPARQL, Reset view, the exports, Legend, Help and Theme.

## 6. Anchoring conventions
- Equipment, dampers, terminals and sensors: centre of the symbol. Motors and actuators: their own symbol.
- Ducts and pipes: midpoint of the drawn run between their two flow neighbours. Junctions: where the lines meet.
- Rooms and zones: their name/number text. Systems: a system label or a representative line point.
- Building or storey without a drawn label: not on drawing.

---

## 7. File formats

### Layout file `kg-overlay-layout/1`
| Field | Content |
| :- | :- |
| `artifact` | the drawing it was made for |
| `units` | `px` or `norm1000` |
| `anchors` | IRI → `{x, y, source, conf, why}` |
| `offDrawing` | instances marked as not on this drawing |
| `qa` | `{nodes, edges}`, each `{status, note, check, at}` |
| `findings`, `recheckRuns`, `rules`, `changes` | the review state; re-check areas carry `x, y, s, w, h, shape`, runs carry `related` |

### Change entry
`{id, seq, batch, at, status: applied|reverted, type, title, why, comment, origin, conf, del:[triple], ins:[triple], notes, anchor, resolved}`

A triple is `{s, p, o, ot: iri|lit|blank, lang, dt}`.

### Project file `kg-overlay-project/1`
`graphs` [{name, text}] (the unmodified sources), `drawing` {name, page, comment, dataUrl}, `legend` {name, comment, dataUrl}, `images` [{name, role: title|context, comment, dataUrl}], `layout` (as above). The API key is never included.

### Review report (.csv)
Columns: `item, name, why_in_report, iri_or_link, classes, status, note, placement, x, y, confidence, reviewed_at`.

`why_in_report` lists the checks, rules, decisions, proposals and changes that concern the row. Flagged instances come first.

### Change log (.csv)
Columns: `change, status, applied_at, reverted_at, type, title, removed_triples, added_triples, why, reviewer_comment, origin, confidence, finding, batch, notes`.

### SPARQL results (.csv)
One column per variable (or `subject, predicate, object` for CONSTRUCT / DESCRIBE), full IRIs and plain literal values.

---

## 8. Building and testing

```
src/head.html      styles (light/dark tokens) and <title>
src/body.html      markup
src/app.js         all logic (sections 1–14, plus 12b re-check, 12c issues, 12d change log,
                   12f right panels + SPARQL panel, 12g reference images, 12h Claude API key)
src/sparql.js      the SPARQL 1.1 engine (also loadable in Node: module.exports)
n3bundle.js        N3.js 2.0.1 Turtle/TriG parser, inlined (bundle_n3.mjs rebuilds it)
assemble.py        → site/index.html (published page) and site/test.html (standalone file)
site/demo/         demo graph, drawing, legend and layout (published next to the page)
tests/             Playwright tests (t2–t16), mock_claude.js (stand-in for Claude), fixtures,
                   sparql_engine.js / sparql_sameas.js (Node tests for the engine)
```

Build and test:

```
python3 assemble.py
cp site/test.html graph-overlay-inspector.html          # the single-file copy
cd site && python3 -m http.server 8765 &                # tests expect this server
cd .. && python3 tests/t14_new.py tests/out tests tests/fixtures
node tests/sparql_engine.js "$PWD" site/demo/HTRK-VEN03_knowledge_graph.ttl
node tests/sparql_sameas.js "$PWD"
```

Tests need Python Playwright with Chromium. `t14_new.py` routes `api.anthropic.com` to a local stand-in, so no real key is used; `t15_file_phone.py` writes a fake `.env` at test time.

## 9. Known limits
- **Claude features are tested with stand-ins.** All in-page calls (anchoring, re-check, resolve, and the API-key route) were tested against `tests/mock_claude.js` and a mocked API; how good the real proposals are only shows on real runs.
- **The change log, like all review state, is per drawing page.**
- **The refined Turtle export is one merged file.** When several graphs are loaded, they are not split back into their source files.
- **Projects move between browsers or people only via the project file.**
- **owl:sameAs reasoning is query-time only.** It is not applied to the drawing itself or to the exports.
- **The API key route only works outside claude.ai,** and the key is as safe as the browser profile it is remembered in.
