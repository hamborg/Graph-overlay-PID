# Graph Overlay Inspector

Match a P&ID with its extracted knowledge graph as a graphical overlay. Inspect the knowledge graph (BOT / FSO / Brick, Turtle) directly on the drawing it came from, and on every other artifact it was built from — detail sheets, plans, BMS screenshots, catalog pages, product sheets and point lists. Run SPARQL on the graph (also from plain words) with the results shown on the drawing. Refine the graph with issue reports, review rules, edits to instances and relations, or by having Claude re-check sub-areas and resolve issues. Fixes go back into the graph through a change log, and the refined graph exports as Turtle together with a SPARQL Update.

- **Online app (runs inside Claude):** https://claude.ai/artifact/8YhmdfPfZJrJiHpNsR8LF8. It is shared as *Anyone with the link* and the HTRK-VEN03 ventilation demo is preloaded.
- **Single-file copy:** [`graph-overlay-inspector.html`](graph-overlay-inspector.html). It works in any browser, also offline (except PDF rendering); Claude features there use your own API key (see §1).
- **Several artifacts, one graph:** a project holds any number of sheets and point lists, in groups (domains). Every sheet is a view of its own with side diagrams around it; the **Evidence** panel and the **Instances** table show where each instance appears (see §3).

---

## 1. Ways to run and share it

### The online app (recommended)
- **It is a page hosted on claude.ai, not part of a chat.** It keeps working after the chat that built it ends. Every republish updates the same link for everyone.
- **Anyone with the link can open it.** Loading files, overlay, review, checks, edits, applying fixes, SPARQL and exports work for everybody.
- **The Claude features** (Anchor, Re-check areas, Resolve with Claude, Suggest placements, SPARQL from plain words) **work when the link is opened inside claude.ai while signed in.** The calls run on the viewer's own Claude account and usage, never the author's. The first call asks the viewer to allow it, including sending images. If the viewer's plan lacks Claude Opus 5.5, a nearby model answers; the run log names the model.
- **Every person's work is private to their own browser.** A review travels as a project file.
- **Only the author can change the published app.** Anyone can make their own copy (chat or HTML file); the original and its link are not affected.
- **Saving files inside Claude:** Claude lets a page save only some file types (images, txt, json, md, csv, html, svg, pdf, docx, pptx, xlsx, zip …). **`.ttl` is not among them**, and the page cannot change that. When a `.ttl` save is refused the app offers: *Try direct .ttl* (an ordinary browser download, which the sandbox may block), the **refined graph package (.zip)**, *Save as .txt* or *Copy*. Outside Claude the `.ttl` is saved directly.

### The single HTML file
Everything except the Claude features works locally, and `.ttl` exports download directly. For the Claude features:

1. **Your own Anthropic API key** (Open → *Claude API key (.env)…*, the setup card, or the *Open in Claude* dialog):
   - Enter the key, choose the model (Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.1) and the max output tokens. *Test* sends a one-word request.
   - The app calls `https://api.anthropic.com/v1/messages` directly from the browser (streaming). Usage is billed to the key's account. Images are scaled to about 1.15 MP / 1568 px first.
   - **A `.env` file** (named `.env` or `claude.env`):
     ```
     ANTHROPIC_API_KEY=sk-ant-…
     CLAUDE_MODEL=claude-opus-5-5
     CLAUDE_MAX_TOKENS=32000
     # only for keys not scoped to one workspace:
     ANTHROPIC_WORKSPACE_ID=wrkspc_…
     ```
     `CLAUDE_API_KEY`, `ANTHROPIC_MODEL`, `MODEL`, `MAX_TOKENS` and `WORKSPACE_ID` are accepted too. *Save as .env file* writes one for you.
   - **Workspace ID:** a key that is not scoped to one workspace needs it, or the API answers 400. It is sent as the `anthropic-workspace-id` header; the dialog has a field for it and says so when the API asks for it.
   - **Where the app finds the file:** served over http(s) (e.g. `python3 -m http.server` in that folder) it is read next to the app by itself. Opened from disk (file://), browsers don't let a page read its neighbours — use *Load .env file…*, or **open or drop a folder that contains it**, and tick *Remember in this browser* if you like.
   - The key stays in the browser (only in `localStorage` if you tick Remember; *Forget key* removes it), is sent only to api.anthropic.com and is never written to project files. **Never commit a `.env` file**; `.gitignore` excludes them.
2. **Open in Claude:** save the project file (`.project.json`: graphs, drawings, images with notes, point lists, placements, review, rules, proposals, change log) and drop it on the online app.

Limits of the file route: the hand-off to Claude is manual (save + drop); PDF drawings need internet (pdf.js 4.10.38 loads on demand); the demo is not in the file (serving `site/` over http includes it).

---

## 2. Workflow

1. **Start a review.** Drop the graph and the artifacts — files or whole folders — or use Open.
   - Graphs: Turtle / N-Triples / TriG (several files are merged). Artifacts: PNG, JPG, WebP, GIF, BMP, SVG, **TIFF** (scans, decoded in the browser) and PDF pages; point lists as `.csv`, `.tsv` or `.txt`; a project description as `.md` / `.txt`.
   - **Folders become groups** (domains such as Ventilation or Heating): the first folder under the one you open. The open dialog shows a block per group; say for each file what it is — P&ID / diagram, Plan, BMS screenshot, Catalog page, Product sheet, Functional report, Description, Other sheet, or Legend, Title block, Context image — and add a note for Claude. **Dropping more files while the dialog is open adds them to its list.** A file the browser can't read is listed and left out; the rest opens.
   - **Project description** (optional): the *Description* tab in the sheet bar, the setup card or Open → *Project description…*. Claude reads it with every request.
2. **Place instances on the sheets.** Coordinates in the graph (numeric `…X` / `…Y` pairs) are used automatically. **Anchor with Claude** places the rest — on this sheet or on every sheet in turn. **Place on another sheet…** in an instance card, and the **Instances** table for the ones on no artifact yet (place by hand or let Claude suggest).
3. **Review.** Inspect, drag, decide (Correct / Issue / Unsure / Resolved, with comments), decide whole reports at once in *Review & checks*, flag links, make one issue for several instances and links, check point-list rows, propose or apply relations, rename instances and edit labels and comments.
4. **Re-check areas** marks doubtful places on a drawing; Claude compares them with the graph in one call.
5. **Issues → Resolve with Claude** sends the open flags, rules, notes and group issues you pick — with editable comments, bundles and an overall comment — in one call. Claude proposes concrete fixes.
6. **Accept** the fixes you agree with, then **Apply to graph**. Each applied fix becomes a change-log entry.
7. **Query** the graph with **SPARQL** — or describe what you want and let Claude write the query.
8. **Export** the refined graph (.ttl), the refined graph package (.zip), the SPARQL Update, the change log, the review report, the instance coverage table or the project file.

**Undo / redo** (↶ ↷, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z) covers moves (also on side diagrams), placements on any sheet, guests, reviews and per-report decisions, link flags, rules, group issues, proposals, renames and text edits, relation changes, time series IDs, point-list edits, Claude runs, accepting, applying and reverting. It holds 200 steps.

---

## 3. Features

### Selecting and inspecting
- **Click an instance:** it is chosen and the view zooms to fit it and its connections (switchable in *View settings*). The selection's lines are drawn on top of the labels; switched-off categories show dimmed and dashed. Clicking the empty drawing lets go and zooms back.
- **Ctrl/⌘-click** adds or removes instances — without zooming. **Ctrl/⌘-click a line** adds that link (predicate) to the selection; chosen links get a halo.
- **Box select:** Shift-drag on empty space, or switch on box select (dashed square by the zoom buttons) and drag; Ctrl/⌘ adds. Optionally the box also picks the links between the instances inside it. **Dragging with the mouse wheel button always pans.**
- **Instance card:** class, system, location, connections (every asserted triple, in its direction), **Time series** for points, **Properties** (all literal values, links to things that are not drawn, and **Referenced by**: triples pointing at the instance from things that are not drawn — a product class, a type …; click one for everything the graph says about it), owl:sameAs twins, placement and where it appears, its issues and checks, and its review. **Edit…** next to the IRI renames it or edits labels and comments.
- **Several instances:** shared values, *Show path* (shortest chain of shown links), *One issue for these…*. **Two instances:** *Between them* lists every triple linking them (owl:sameAs too) with Issue…, Correct, Select link, Change… (predicate or direction) and Remove…, plus **Suggest a new relation…** (pick direction and predicate, then propose it — it waits in Issues to be accepted — or apply it now after a confirmation tick).
- **Chosen links:** flag each as an issue, mark them correct, or make one issue with the chosen instances.
- **Long hover** (≈ 1 s) shows the name and thickens all its lines.

### Several sheets, views and the board
- **Every sheet is a view.** The sheet bar lists all artifacts by group; opening one makes it the view's sheet. There is no main drawing.
- **Side diagrams** sit around the view's sheet on a grid, scaled to its size — added clockwise, from **+** bands next to any diagram, or from the chip row; drag one by its title to another slot; collapse, swap, open as its own view, or close. Each view remembers its own board; *Reset* folds them.
- **Scope:** *This drawing* (side diagrams dimmed until a chosen instance links into them), *+ Neighbours*, *Full graph*.
- **owl:sameAs twins** are marked with the chosen instance and joined by a teal chain; **click the chain** (or *The link…* in the card's Same as box) to choose both and see, flag, change or remove the sameAs triple.
- **Doors** lead to sheets that are not on the board; **guests** are instances from another sheet dragged into a view without becoming a placement there.
- **Evidence** (top bar) shows, per chosen instance, a cropped call-out from every sheet it is on, its point-list rows, and where it is missing.

### Instances table (coverage)
- **Instances** (top bar, or the link under Scope): every instance with one column per sheet (● shown there — click to go to it; – marked as not on it), point-list rows, the total, and **Likely on** (the sheet most of its neighbours are on).
- Filters: *On no artifact* (default), *On no sheet*, *On a sheet*, *All*; text and kind; sorting; CSV export.
- For chosen rows: **place by hand** (pick the sheet, then click), **suggest placements with Claude** on the sheets you tick (one call per sheet, only for the chosen instances; also for ones marked "not on it" before), mark them as not on a sheet, choose them in the view, or flag them. *All its triples* opens a card; closing it returns to the table.

### Point lists (sensor lists)
- Rows are matched to instances when a cell equals a tag, label or name (ignoring case, spaces, `-`, `_`, `.`). **Header detection:** the first line is a header unless it looks like data (e.g. a list of sensor names); *First line is a header* corrects it.
- **The list viewer:** the table on the left (click, Ctrl/⌘- or Shift-click, or tick rows), the options for the chosen rows on the right — link to an instance (search, suggestions from the row, or the instance chosen in the app), unlink a wrong match (it stays rejected), report an issue (a flag on the instance, one group issue for several, or a note when no instance is linked), ignore rows. Rows that look like comments or noise (`####`, `# …`, `----`) are found for you. Filters for Linked / Not linked / Reported / Ignored; undo and redo in the viewer.
- **Time series:** a point (`brick:hasPoint` / `isPointOf`) shows its `ref:hasExternalReference` → `ref:TimeseriesReference` / `ref:hasTimeseriesId` under Connections. Without one, pick a value from its point-list row (or type it) and **Add**: it inserts `<point> ref:hasExternalReference [ a ref:TimeseriesReference ; ref:hasTimeseriesId "…" ]` as one change.

### Review & checks (left panel)
- **The reports cover the whole project and are the same on every sheet:** not placed on any sheet yet; low-confidence placements (< 0.6); long flow links; flow asserted in both directions; anchors outside the drawing; open-ended segments; plus the **review rules** and any class or predicate you add as a report. Items on another sheet name it; clicking one goes there. *Only what this view shows* narrows the list to the current view.
- Reports are split into **Instances**, **Links (predicates)** and **Mixed (group issues)**.
- **One decision per report and item, stored once for the project:** an instance can be Correct for one report and an Issue for another, and a decision made on one sheet holds on all. Issue / Unsure also flags the instance or link in Issues, naming the report. **Click a chosen decision again to make it undecided.**
- **Review rules…** say what the checks expect of which instances (has flow, is sensed, has a location, belongs to a system, is part of something, is typed, has a label, is placed), with exceptions — e.g. sensors and properties carry no flow.
- **Classes & predicates…** adds every instance of a class or every link of a predicate as a report; *Mark all* and decide together — a flag on each or **one issue** for all.

### Issues panel and Resolve with Claude
- **Cards show only their header** until chosen; choosing one highlights its instances and links. A **red/green preview** shows what a proposal or change does: removed links red, added links green, class and literal changes as chips, deletions and new instances ringed, moved anchors as arrows.
- **Rules & general notes**, **flagged instances, links & group issues** (each with the reports that raised it and an editable comment), **proposed fixes** (from Claude, from re-checks and from the reviewer) with accept / dismiss, then the **change log** and **closed issues**.
- **Resolve with Claude:** the items with editable comments (saved on the issue), **bundles** of related items with their own comment, and a comment on everything at the bottom. Fix types: re-point, remove, reverse and add links; add, delete, rename instances; change class; edit labels and comments; move nodes. When Claude proposes nothing it says why, and the answer stays on the issue.

### Editing the graph directly
- **Rename an instance or edit its labels and comments** (*Edit…* in its card). The dialog shows what will change and needs a confirmation tick. A rename rewrites every triple that uses the IRI — subject, object or predicate, nested values included — and moves its placements on every sheet, review records, issues and proposals along. Names that already exist are refused.
- **Relations:** add, change or remove a triple between two chosen instances (above), as a proposal or straight into the change log.

### Applying fixes and the change log
- **The loaded files are never modified.** The graph on screen is the source graph with the active change-log entries applied in order (renames rewrite the IRI everywhere, also in earlier changes).
- Each entry records the triples removed (−) and added (+), the reason, the reviewer's comment, the origin, the time and notes. **Revert** takes an entry back out; it stays in the log as reverted.
- **Exports:**
  - **Refined graph (.ttl):** the effective graph in one Turtle file, re-parsed before saving.
  - **Refined graph package (.zip):** the refined `.ttl`, the source graph(s) unchanged in `source/`, the corrections as a SPARQL Update (`.sparql` — run on the source it gives the refined graph), the change log (`.csv`) and a README.
  - **SPARQL Update:** DELETE DATA / INSERT DATA, plus DELETE/INSERT … WHERE for renames, and inserted blank nodes (time series references).
  - **Change log (.csv).**

### Re-check areas
- Squares (4 × a typical symbol, 2–8 ×) or rectangles (corner to corner); up to 12 areas per call. Claude receives an overview, a clean and a tagged close-up per area, the reference images with notes, and the graph content inside each area. *The areas are related* asks Claude to compare them.

### SPARQL panel
- Queries run in the browser on the effective graph with a small SPARQL 1.1 engine written for the app (`src/sparql.js`): SELECT, ASK, CONSTRUCT, DESCRIBE, property paths, OPTIONAL, UNION, MINUS, FILTER, BIND, VALUES, sub-queries, aggregates, ORDER BY, LIMIT/OFFSET and the usual functions.
- **Ask in plain words:** describe what you want; Claude writes the query from the graph's prefixes, classes and predicates, puts it in the editor and runs it — or refines the query already there.
- **owl:sameAs as identity** (on by default, OWL 2 RL equality rules). **Prefixes in this project** and **Classes & predicates** (with counts, sorted by count, prefix or name) insert into the query. Results list, expand to a big table (filter, sort, CSV) and highlight in the view.

### View settings
- The sliders icon by the zoom buttons: zoom on click, zoom on Ctrl/⌘-click add, box select, links in the box, **arrow direction** (subject → object as written — the default — or the canonical direction: flow, container → part), and the display options.

---

## 4. Current settings and defaults

| Setting | Default | Where |
| :- | :- | :- |
| Scope | This drawing | Side panel → Scope |
| Connection categories | Flow on `#2563eb` · Sensing & points on `#16a34a` · Location on `#d97706` · System topology **off** `#7c3aed` · Parts & composition on `#db2777` · Heat transfer on `#dc2626` · Physical connection on `#0f766e` · Other links **off** `#64748b` | Side panel → Connections (per category and predicate; colours editable) |
| Merge parallel predicates into one line | on | Connections / View settings |
| Fade instances without a shown connection | on | Connections |
| Show class under names | on (T toggles) | Display / View settings |
| Node name | Instance name (IRI local part) | Display (or rdfs:label) |
| Label size · node size · line width | 11 px · 3 × · 2 × | Display |
| Hide labels that would overlap | on | Display / View settings |
| Zoom to an instance when clicked | on | View settings |
| Zoom when adding with Ctrl/⌘-click | off | View settings |
| Box select by plain drag | off (Shift-drag always) | Zoom bar / View settings |
| Box also picks links | off | View settings |
| Arrows | subject → object as written | View settings |
| Only what this view shows (reports) | off | Review & checks |
| Low-confidence threshold | 0.6 (dotted amber ring) | Fixed |
| Drawing ⇄ Graph fader | centre (both 100 %) | Bottom of the canvas |
| Re-check areas | square, 4 × symbol, max 12 | Re-check bar |
| SPARQL | Show results in the view: on · owl:sameAs: on | SPARQL panel |
| Theme | Auto | Top bar |
| Claude model inside Claude | `claude-opus-5-5`, tier `complex` | Fixed |
| Claude model with an API key | `claude-opus-5-5`, max 32 000 output tokens | Claude API key dialog or `.env` |
| Undo history | 200 steps | Fixed |

Kept per browser in `localStorage`: `kgov:ds:<sheet id>` (the project record: placements of the first sheet, review, per-report decisions, rules, findings, change log, point-list edits), `kgov:sheet:<sheet id>` (placements of further sheets), `kgov:board` (each view's side diagrams), `kgov:settings`, `kgov:theme`, `kgov:checkView`, `kgov:reviewPicks`, `kgov:sparql*`, and `kgov:api` (only when you tick Remember). The last session (graphs, artifacts, groups, notes, point lists, description) is kept in IndexedDB `kg-overlay-inspector` / `last`.

**Published artifact:** runtime contract 0.2.85; capabilities `sample` (with images) and `downloads`; sharing *Anyone with the link*.

---

## 5. Display rules
- **Line style:** solid = component ↔ component; dashed = one end is a room, zone, storey or system.
- **Arrows** point from subject to object of the asserted triple (or, by choice, in the canonical direction). Parallel predicates share one line.
- **Highlights:** the issue in question is orange with a glow and rings, and the rest dims; highlights breathe gently (not with reduced motion). Chosen links get a blue halo.
- **Node shapes:** ● component, ○ duct/pipe segment, ■ fitting, ▢ location, ⬡ system, ◆ point/sensor. A dotted ring means low placement confidence.
- **Hidden from the canvas:** `rdf:type` (shown under names), `rdfs:*`, `owl:*`, `skos:*`, `dcterms:*` and literals — all in the instance card.

## 6. Anchoring conventions
- Equipment, dampers, terminals and sensors: centre of the symbol. Motors and actuators: their own symbol.
- Ducts and pipes: midpoint of the drawn run between their two flow neighbours. Junctions: where the lines meet.
- Rooms and zones: their name/number text. Systems: a system label or a representative line point.
- Catalog and product pages: the row or figure that shows the item.
- Not drawn on a sheet: reported as not on it.

---

## 7. File formats

### Layout file `kg-overlay-layout/1`
| Field | Content |
| :- | :- |
| `artifact`, `units` | the first sheet, `px` or `norm1000` |
| `anchors`, `offDrawing`, `guests` | placements of the first sheet |
| `qa` | `{nodes, edges, checks}` — review records; `checks` holds one decision per report and item (`"<report>|<iri or e:edge>"`) |
| `findings`, `recheckRuns`, `rules`, `checkRules`, `changes` | the review state (rules include group issues; findings include reviewer proposals) |
| `sheets` | further sheets: `{id, role, title, group, name, width, height, page, anchors, offDrawing, runs, guests}` |

### Change entry
`{id, seq, batch, at, status: applied|reverted, type, title, why, comment, origin, conf, del:[triple], ins:[triple], notes, anchor, resolved, rename?:{from, to}}`

A triple is `{s, p, o, ot: iri|lit|blank|bnode, lang, dt}`; inserted blank nodes use `ot: 'bnode'` and subjects `_:id`.

### Project file `kg-overlay-project/1`
`graphs` [{name, text}] (unmodified sources), `drawing` and `sheets` (role, title, group, comment, layout, dataUrl), `images` (role legend|title|context, group, comment, dataUrl), `tables` [{name, text, group, comment, links, unlinks, ignore, flags, headerMode}], `description`, `layout`. The API key is never included.

### CSV exports
- **Review report:** `item, name, why_in_report, iri_or_link, classes, status, note, placement, x, y, confidence, reviewed_at`.
- **Change log:** `change, status, applied_at, reverted_at, type, title, removed_triples, added_triples, why, reviewer_comment, origin, confidence, finding, batch, notes`.
- **Instance coverage:** `instance, iri, label, class, kind, <one column per sheet>, point list rows, total`.
- **SPARQL results:** one column per variable.

---

## 8. Building and testing

```
src/head.html      styles (light/dark tokens) and <title>
src/body.html      markup
src/app.js         all logic
src/sparql.js      the SPARQL 1.1 engine (also loadable in Node)
src/utif.js        UTIF.js TIFF decoder by Photopea (MIT, github.com/photopea/UTIF.js), bundled for offline TIFF scans
n3bundle.js        N3.js 2.0.1 Turtle/TriG parser, inlined (bundle_n3.mjs rebuilds it)
assemble.py        → site/index.html (published page) and site/test.html (standalone file)
tools/make_demo_sheets.py   draws the made-up demo artifacts
site/demo/         demo graph, drawing, legend, layout and the made-up extra artifacts (sheets.json)
tests/             Playwright tests (t2–t35), mock_claude.js (stand-in for Claude), fixtures,
                   sparql_engine.js / sparql_sameas.js (Node tests for the engine)
```

Build and test:

```
python3 assemble.py
cp site/test.html graph-overlay-inspector.html          # the single-file copy
cd site && python3 -m http.server 8765 &                # tests expect this server
cd .. && python3 tests/t25_review.py tests/out tests tests/fixtures
node tests/sparql_engine.js "$PWD" site/demo/HTRK-VEN03_knowledge_graph.ttl
node tests/sparql_sameas.js "$PWD"
```

Tests need Python Playwright with Chromium. They run against the stand-in for Claude and a mocked API, so no real key is used; the `.env` fixtures they need hold fake keys and are written at test time (never committed).

## 9. Known limits
- **Claude features are tested with stand-ins.** How good the real placements and proposals are only shows on real runs.
- **`.ttl` can't be saved directly inside Claude** (the page's allowed file types); use the single HTML file, the package, `.txt` or Copy.
- **The refined Turtle is one merged file;** several loaded graphs are not split back into their sources (the package keeps the sources and the SPARQL Update).
- **Projects move between browsers or people only via the project file.**
- **The demo's extra artifacts are made up** (AHU-01 detail sheet, BMS screenshot, catalog page, point list, sensors); the HTRK-VEN03 overview and graph are the real ones.
- **owl:sameAs reasoning is query-time only** (SPARQL); the drawing shows twins but does not merge them.
- **The API key route only works outside claude.ai,** and the key is as safe as the browser profile it is remembered in.
