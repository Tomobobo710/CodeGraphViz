# CodeGraphViz

<img width="3793" height="1766" alt="image" src="https://github.com/user-attachments/assets/525f3752-33ae-4c5f-8f2c-9f5064f6dbcc" />


A dependency graph visualizer for JavaScript codebases that don't use modules —
the classic "pile of scripts sharing a global namespace" style (no `import`,
no bundler, everything talks through shared globals at runtime).

Inspired by [Gource](https://gource.io/): Gource shows you *when* files
changed and *where* they live in the folder tree, animated over a repo's git
history. It can't show you *what actually talks to what* — the tree layout
is folder structure, not code coupling. This tool parses the JS itself and
draws a graph of real coupling instead: which files define a class or
function, and which other files use it — optionally animated over the repo's
real git history, Gource-style.

## Supported codebases

**Currently: plain, non-modular JavaScript only** — code written as
`class Foo {}` / `function bar() {}` at the top level of a file, with no
`import`/`export` and no bundler, where files communicate through shared
global names resolved at runtime (classic multi-`<script>`-tag projects).

Not yet supported: ES modules, TypeScript, any bundler-based project,
and any language other than JavaScript. See **Known limitations** below.

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

1. **`src/languages/javascript/build-graph.js`** walks every `.js` file in a
   repo with [acorn](https://github.com/acornjs/acorn), and for each file
   records:
   - every top-level `class`, `function`, and `const`/`let`/`var` it defines
   - every identifier it *references* that isn't its own and isn't a
     browser/JS built-in (`window`, `Math`, `fetch`, etc.)

   If file B references a name only defined in file A, that's an edge
   `B -> A`. Output is `graph.json`: nodes (files) + weighted edges (reference
   counts), reflecting the current state of the working tree.

2. **`src/languages/javascript/build-history-graph.js`** does the same
   analysis but walks the repo's **entire git history**, commit by commit,
   re-parsing only the files each commit touched (via `git show
   <hash>:<path>`) and tracking definitions, references, and file renames
   incrementally. Output is `history-graph.json`: a per-commit list of edge
   diffs (added/removed), small enough to replay in a browser even for a repo
   with hundreds of commits.

3. **`src/core/graph-core.js`** is the shared parser both build scripts use.

4. **`src/viewer/viewer.html`** loads `output/graph.json` and
   `output/history-graph.json` and renders an interactive force-directed
   graph with [D3](https://d3js.org/). If history data is present it enables
   a Gource-style playback timeline; otherwise it falls back to a static view
   of the current tree.

This is a heuristic, not ground truth. It can miss edges (dynamic access like
`window[name]`) or invent false ones (two files that happen to define a
same-named local that isn't really shared).

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
Node color = top-level directory.

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

- No ES module support: `import`/`export` statements aren't parsed at all,
  so a modern module-based JS project will show zero edges. Would need a
  second analysis path that resolves import specifiers to file paths instead
  of matching on global names.
- JavaScript only. No C++, Python, or other language support.
- History parsing assumes standard git rename detection (`git log
  --name-status`); very aggressive refactors that git can't recognize as a
  rename will show as a delete + a brand new unconnected file.
