# CodeGraphViz

<img width="3793" height="1766" alt="image" src="https://github.com/user-attachments/assets/525f3752-33ae-4c5f-8f2c-9f5064f6dbcc" />


A dependency graph visualizer for JavaScript codebases. Draws real code
coupling — which files define something and which other files use it — as
an interactive force-directed graph, optionally animated over the repo's
real git history.

Inspired by [Gource](https://gource.io/): Gource shows you *when* files
changed and *where* they live in the folder tree, animated over a repo's git
history. It can't show you *what actually talks to what* — the tree layout
is folder structure, not code coupling. This tool parses the JS itself and
draws a graph of real coupling instead, Gource-style playback included.

## Supported codebases

Handles three JavaScript dependency styles, and can mix them within the same
project:

- **ES modules** — `import`/`export` statements, resolved directly from the
  import specifier to a file (most reliable path)
- **CommonJS** — `require(...)` calls (anywhere in a file, not just at the
  top) and `module.exports`/`exports.x`, also resolved directly from the
  specifier
- **Plain global-scope JS** — no `import`/`require` at all; classic
  multi-`<script>`-tag codebases where files communicate through shared
  global names (`class Foo {}` in one file, bare `Foo` in another). Coupling
  here is inferred by matching definitions to usages, since there's no
  explicit statement pointing at the source file — a heuristic, not certain

External npm packages and Node built-in modules (`fs`, `path`, etc.) show up
as their own nodes on the graph, with version/description pulled from
`node_modules` when available.

Not yet supported: TypeScript syntax (`.ts`/`.tsx` won't parse — acorn is
JS-only), bundler-specific resolution (path aliases, etc.), and any language
other than JavaScript. See **Known limitations** below.

## Project layout

```
CodeGraphViz/
  src/
    core/
      graph-core.js            # shared parser: define/reference extraction
    languages/
      javascript/
        build-graph.js         # static (current-tree) graph builder
        build-history-graph.js # full git-history graph builder
    viewer/
      viewer.html               # the D3 force-directed viewer
  output/                       # generated graph.json / history-graph.json land here
  serve.js                      # tiny static file server for local viewing
  run.bat / run.sh              # one-command setup + build + serve
```

`languages/` exists so more language analyzers (e.g. a future C++
`#include`-and-symbol-based variant) can live alongside the JavaScript one
without reorganizing anything — each gets its own subfolder and writes to
the same `output/` + `viewer/` pair.

## How it works

1. **`src/core/graph-core.js`** parses one file's source with
   [acorn](https://github.com/acornjs/acorn) (`sourceType: 'module'`, falling
   back to `'script'` for files that error on that) and extracts:
   - every top-level `class`, `function`, and `const`/`let`/`var` it defines
   - every `import` / re-export-from statement, and every `require(...)`
     call anywhere in the file (default/named/namespace/side-effect-only
     variants all handled)
   - every identifier it *references* that isn't its own and isn't a
     browser/JS/Node built-in (`window`, `Math`, `fetch`, `fs`, etc.) — the
     legacy global-namespace matching path, used for files with no
     `import`/`require` at all

   `import`/`require` specifiers get resolved directly to a file path (or
   classified as an external package/Node built-in) via
   `resolveSpecifier()` — no name-guessing needed there, since the statement
   says exactly what it depends on. The global-namespace path is a fallback
   heuristic for everything else.

2. **`src/languages/javascript/build-graph.js`** runs that analysis across
   every `.js` file in a repo and combines both edge sources (explicit
   imports/requires + inferred global-namespace matches) into `graph.json`:
   nodes (files, plus external packages) + weighted edges, reflecting the
   current state of the working tree.

3. **`src/languages/javascript/build-history-graph.js`** does the same
   analysis but walks the repo's **entire git history**, commit by commit,
   re-parsing only the files each commit touched (via `git show
   <hash>:<path>`) and tracking definitions, references, imports, and file
   renames incrementally. Output is `history-graph.json`: a per-commit list
   of edge diffs (added/removed), small enough to replay in a browser even
   for a repo with hundreds of commits. External package version/description
   metadata reflects whatever's in `node_modules` *now*, not as of each
   historical commit — reinstalling dependencies at every commit isn't
   practical.

4. **`src/viewer/viewer.html`** loads `output/graph.json` and
   `output/history-graph.json` and renders an interactive force-directed
   graph with [D3](https://d3js.org/). If history data is present it enables
   a Gource-style playback timeline; otherwise it falls back to a static view
   of the current tree. External packages render as visually distinct nodes
   (dashed ring) with a tooltip showing version/description when known.

The global-namespace matching path is a heuristic, not ground truth — it can
miss edges (dynamic access like `window[name]`) or invent false ones (two
files that happen to define a same-named local that isn't really shared).
The `import`/`require` path doesn't have this problem, since it resolves
from an explicit statement rather than guessing.

## Prerequisites

- [Node.js](https://nodejs.org/) (any reasonably current version)
- `git` available on your PATH — `build-history-graph.js` shells out to
  `git log` / `git show`; not needed for the static-only `build-graph.js`
- Internet access in the browser tab that opens the viewer (D3 loads from a
  CDN, not bundled locally)

## Quickest way to run it

From the project root:

- Windows: double-click `run.bat` (or run it from a terminal)
- macOS/Linux: `./run.sh`

Either one installs dependencies on first run if needed, asks for the path
to the repo you want to visualize, builds the graph (and the history graph
too, if that path has a `.git` folder), starts the server, and opens the
viewer in your browser.

## Manual setup / usage

```
npm install
```

Then, from the project root:

```
npm run build -- "<path-to-repo>" output/graph.json
npm run build:history -- "<path-to-repo>" output/history-graph.json   # optional, enables playback
npm start
```

Open `http://localhost:8090`.

(Equivalent direct `node` commands, if you'd rather skip npm scripts:
`node src/languages/javascript/build-graph.js "<path-to-repo>" output/graph.json`,
`node src/languages/javascript/build-history-graph.js "<path-to-repo>" output/history-graph.json`,
`node serve.js`.)

## Viewer controls

- **Drag** a node to reposition it
- **Scroll / pinch** to zoom, **drag background** to pan
- **Click a node** to isolate it and its direct neighbors; click empty space
  to clear
- **Search box** filters/dims nodes and edges by path substring
- **Layout sliders**: Repulsion, Link distance, Collide padding, Node size,
  Link thickness, Cluster pull (how strongly files in the same top-level
  directory are pulled toward a shared anchor point; 0 = pure physics)
- **Min edge weight** — hide edges below N references
- **Labels always** — show every filename instead of only on hover/zoom-in

Node size = how many places reference it (in-degree, fixed relative to the
highest weight seen so far during playback — never rescales down).
Node color = top-level directory. External packages (npm dependencies, Node
built-ins) render with a dashed ring and are labeled by package name instead
of file path; hover for version/description when available.

### History playback (when `history-graph.json` is present)

- **Play/pause** and a **scrubber** to move through commits; dragging the
  scrubber while playing keeps playback running from the new position
- **Settings (⚙)**: seconds per commit, idle-gap auto-skip + cap, beam
  duration, author avatars on/off + scale, loop
- Each unique git author gets an avatar that flies to whatever file(s) it
  commits, with a colored beam connecting avatar to target; avatars fade in
  fast on activity and fade out when idle
- Files/edges appear and disappear as they're actually added, changed, and
  removed/renamed across real commits — not just a fade based on first-seen
  date

## Re-running on a different repo / after code changes

Re-run `run.bat`/`run.sh` (or the manual build commands) against any path
and reload the viewer — see **Supported codebases** above for what it can
and can't analyze.

## Known limitations

- No TypeScript support: `.ts`/`.tsx` files won't parse (acorn doesn't
  understand TypeScript syntax), so they're silently skipped with a parse
  error logged to the console.
- No bundler-aware resolution: path aliases (e.g. `@/utils/foo` configured
  in a bundler, not a real relative path) won't resolve and are treated as
  dangling imports.
- Dynamic imports (`import(...)` as an expression) and dynamic `require`
  (`require(someVariable)`) aren't tracked — only static string-literal
  specifiers are.
- JavaScript only. No C++, Python, or other language support.
- History parsing assumes standard git rename detection (`git log
  --name-status`); very aggressive refactors that git can't recognize as a
  rename will show as a delete + a brand new unconnected file.
- External package metadata during history playback reflects the *current*
  `node_modules`, not what was actually installed at each historical commit.
