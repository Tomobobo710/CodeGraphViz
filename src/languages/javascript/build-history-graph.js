const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { analyzeSource, COMMON_GLOBALS } = require('../../core/graph-core');

const ROOT = process.argv[2];
const OUT = process.argv[3] || 'history-graph.json';

if (!ROOT) {
    console.error('Usage: node build-history-graph.js <path-to-repo> [out.json]');
    process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, '.git'))) {
    console.error('Not a git repo.');
    process.exit(1);
}

// Full commit list, oldest first, with the files each commit touched (added/modified/deleted).
const raw = execSync(
    `git log --reverse --name-status --format="%x00COMMIT%x00%H%x00%aI%x00%an"`,
    { cwd: ROOT, maxBuffer: 1024 * 1024 * 512 }
).toString('utf8');

const commits = [];
let current = null;
for (const line of raw.split('\n')) {
    if (line.startsWith('\x00COMMIT\x00')) {
        if (current) commits.push(current);
        const [, , hash, date, author] = line.split('\x00');
        current = { hash, date, author, changes: [] }; // changes: {status, file}
    } else if (line.trim() && current) {
        const parts = line.split('\t');
        const statusCode = parts[0][0]; // A, M, D, R100/C100 etc -> take first char
        if (statusCode === 'R' || statusCode === 'C') {
            // rename/copy: "R100\told\tnew" -- the old path stops existing (for renames;
            // for copies it lives on, but treating it as gone too just means a stale
            // pre-copy edge disappears a commit early, which is harmless), the new path
            // is added with its content as of this commit
            const oldFile = parts[1].trim().replace(/\\/g, '/');
            const newFile = parts[2].trim().replace(/\\/g, '/');
            if (statusCode === 'R' && oldFile.endsWith('.js') && !oldFile.endsWith('.min.js')) {
                current.changes.push({ status: 'D', file: oldFile });
            }
            if (newFile.endsWith('.js') && !newFile.endsWith('.min.js')) {
                current.changes.push({ status: 'A', file: newFile });
            }
        } else {
            const file = parts[parts.length - 1].trim().replace(/\\/g, '/');
            if (file.endsWith('.js') && !file.endsWith('.min.js')) {
                current.changes.push({ status: statusCode, file });
            }
        }
    }
}
if (current) commits.push(current);

const relevant = commits.filter(c => c.changes.length > 0);
console.error(`${relevant.length}/${commits.length} commits touch JS files`);

// Running state across the whole walk.
const fileDefs = {};   // rel -> Set(names)
const fileRefs = {};   // rel -> Set(names)
const nameOwners = {}; // globalName -> rel (first definer wins, matches build-graph.js)
const allFilesEverSeen = new Set();

function computeEdges() {
    const edges = {}; // "A B" -> weight
    for (const rel of Object.keys(fileRefs)) {
        const refs = fileRefs[rel];
        if (!refs) continue;
        for (const [name, occurrences] of refs) {
            const owner = nameOwners[name];
            if (!owner || owner === rel) continue;
            if (!fileDefs[owner]) continue; // owner file since deleted
            const key = `${rel} ${owner}`;
            edges[key] = (edges[key] || 0) + occurrences;
        }
    }
    return edges;
}

function rebuildOwnersFor(names) {
    // a def-owner mapping can only gain new owners here (first-definer-wins),
    // never lose one just because another file also defines the same name
    for (const name of names) {
        if (!nameOwners[name]) {
            for (const rel of Object.keys(fileDefs)) {
                if (fileDefs[rel] && fileDefs[rel].has(name)) { nameOwners[name] = rel; break; }
            }
        }
    }
}

const snapshots = []; // { hash, date, author, files, edgeCount, added: [{source,target,weight}], removed: [{source,target}] }
let processed = 0;
let prevEdgesObj = {};

for (const c of relevant) {
    const touchedNames = new Set();
    const deletedFiles = [];

    for (const { status, file } of c.changes) {
        if (status === 'D') {
            deletedFiles.push(file);
            // capture what this file used to own before wiping it, so ownership of
            // those names can be reassigned to whichever other file still defines them
            // (e.g. after a rename/move) instead of permanently orphaning every edge
            // that referenced them
            if (fileDefs[file]) {
                for (const n of fileDefs[file]) {
                    if (nameOwners[n] === file) {
                        delete nameOwners[n];
                        touchedNames.add(n);
                    }
                }
            }
            delete fileDefs[file];
            delete fileRefs[file];
            continue;
        }
        let src;
        try {
            src = execFileSync('git', ['show', `${c.hash}:${file}`], { cwd: ROOT, maxBuffer: 1024 * 1024 * 64 }).toString('utf8');
        } catch (e) {
            continue; // file not present at this commit (edge case with renames)
        }
        const result = analyzeSource(src);
        if (!result) continue; // parse error, keep previous state for this file
        fileDefs[file] = result.defs;
        fileRefs[file] = result.refs;
        allFilesEverSeen.add(file);
        for (const n of result.defs) touchedNames.add(n);
    }

    rebuildOwnersFor(touchedNames);
    const edgesObj = computeEdges();

    // store only what changed since the previous snapshot (added/removed edges),
    // not the full edge list every commit -- keeps file size sane over hundreds of commits
    const added = [];
    const removed = [];
    for (const key of Object.keys(edgesObj)) {
        if (!(key in prevEdgesObj) || prevEdgesObj[key] !== edgesObj[key]) {
            const [source, target] = key.split(' ');
            added.push({ source, target, weight: edgesObj[key] });
        }
    }
    for (const key of Object.keys(prevEdgesObj)) {
        if (!(key in edgesObj)) {
            const [source, target] = key.split(' ');
            removed.push({ source, target });
        }
    }
    prevEdgesObj = edgesObj;

    snapshots.push({
        hash: c.hash.slice(0, 8),
        date: c.date,
        author: c.author,
        files: c.changes.filter(ch => ch.status !== 'D').map(ch => ch.file),
        deletedFiles,
        edgeCount: Object.keys(edgesObj).length,
        added,
        removed,
    });

    processed++;
    if (processed % 25 === 0) console.error(`  ${processed}/${relevant.length} commits processed`);
}

// final node list = union of every file ever seen (matches build-graph.js's "current tree" shape,
// but historically anything that existed at any point is included so it doesn't vanish/reappear oddly)
const nodes = [...allFilesEverSeen].map(rel => ({ id: rel, dir: path.dirname(rel) }));

fs.writeFileSync(OUT, JSON.stringify({ hasGit: true, nodes, commits: snapshots }, null, 2));
console.error(`Wrote ${nodes.length} nodes, ${snapshots.length} commit snapshots to ${OUT}`);
