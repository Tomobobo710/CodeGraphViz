const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const COMMON_GLOBALS = new Set([
    'window', 'document', 'console', 'Math', 'Object', 'Array', 'String', 'Number',
    'Boolean', 'JSON', 'Map', 'Set', 'Promise', 'Error', 'TypeError', 'RangeError',
    'Symbol', 'Proxy', 'Reflect', 'Date', 'RegExp', 'Infinity', 'NaN', 'undefined',
    'globalThis', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch',
    'WebSocket', 'Worker', 'ArrayBuffer', 'Float32Array', 'Uint8Array', 'Uint16Array',
    'Int32Array', 'DataView', 'navigator', 'location', 'localStorage', 'sessionStorage',
    'Blob', 'File', 'FileReader', 'URL', 'Image', 'Audio', 'CustomEvent', 'Event',
    'requestIdleCallback', 'structuredClone', 'crypto', 'self', 'global'
]);

// Parses one file's source and returns { defs, refs, imports, isModule, hasCommonJS } where:
//   defs: Set<name> — top-level class/function/var names this file defines
//   refs: Map<name, count> — non-local identifier references, for the legacy
//         global-namespace matching path (still useful even in module files,
//         since a module can also lean on ambient globals)
//   imports: Array<{ specifier, kind, names }> — raw import/require statements.
//            kind is 'default' | 'named' | 'namespace' | 'side-effect' | 're-export'
//            | 're-export-all' | 'require' (require() calls, names is the
//            destructured binding names when known, [] otherwise). Caller
//            resolves `specifier` to a file path (or external package) and
//            turns this into edges.
//   isModule: whether sourceType: 'module' parsing succeeded (has ESM syntax)
//   hasCommonJS: whether the file has require()/module.exports/exports.x usage
// Returns null on parse failure (caller should keep the file's previous state).
function analyzeSource(src) {
    let ast;
    let isModule = true;
    try {
        ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
    } catch (e) {
        isModule = false;
        try {
            ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
        } catch (e2) {
            return null;
        }
    }

    const defs = new Set();
    const imports = [];

    for (const node of ast.body) {
        if (node.type === 'ClassDeclaration' && node.id) {
            defs.add(node.id.name);
        } else if (node.type === 'FunctionDeclaration' && node.id) {
            defs.add(node.id.name);
        } else if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (decl.id && decl.id.type === 'Identifier') defs.add(decl.id.name);
            }
        } else if (node.type === 'ImportDeclaration') {
            const specifier = node.source.value;
            if (node.specifiers.length === 0) {
                imports.push({ specifier, kind: 'side-effect', names: [] });
                continue;
            }
            const names = [];
            let kind = 'named';
            for (const spec of node.specifiers) {
                if (spec.type === 'ImportDefaultSpecifier') { kind = 'default'; defs.add(spec.local.name); }
                else if (spec.type === 'ImportNamespaceSpecifier') { kind = 'namespace'; defs.add(spec.local.name); }
                else { names.push(spec.imported ? spec.imported.name : spec.local.name); defs.add(spec.local.name); }
            }
            imports.push({ specifier, kind, names });
        } else if (node.type === 'ExportNamedDeclaration' && node.source) {
            // re-export: export { x } from './other.js' -- still a real dependency edge
            imports.push({ specifier: node.source.value, kind: 're-export', names: (node.specifiers || []).map(s => s.local.name) });
        } else if (node.type === 'ExportAllDeclaration' && node.source) {
            imports.push({ specifier: node.source.value, kind: 're-export-all', names: [] });
        } else if (node.type === 'ExportDefaultDeclaration') {
            const d = node.declaration;
            if (d && d.id) defs.add(d.id.name);
        } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
            const d = node.declaration;
            if (d.id) defs.add(d.id.name);
            if (d.declarations) for (const decl of d.declarations) if (decl.id && decl.id.type === 'Identifier') defs.add(decl.id.name);
        }
    }

    // CommonJS: require() calls can appear anywhere (not just top-level), so this
    // needs a full walk rather than an ast.body scan. Handles the three common shapes:
    //   const x = require('./foo')                    -> binds `x`
    //   const { a, b } = require('./foo')              -> named, binds `a`, `b`
    //   require('./foo')                                -> side-effect only
    // Bindings introduced this way count as defs so they don't get miscounted as
    // cross-file refs to some other file's global. walk.ancestor gives access to
    // the enclosing VariableDeclarator (if any) so the binding shape can be read.
    let hasCommonJS = false;
    walk.ancestor(ast, {
        CallExpression(node, state, ancestors) {
            if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
            if (!node.arguments.length || node.arguments[0].type !== 'Literal' || typeof node.arguments[0].value !== 'string') return;
            hasCommonJS = true;
            const specifier = node.arguments[0].value;
            const declarator = ancestors[ancestors.length - 2];
            if (declarator && declarator.type === 'VariableDeclarator' && declarator.init === node) {
                if (declarator.id.type === 'ObjectPattern') {
                    const names = declarator.id.properties
                        .filter(p => p.type === 'Property')
                        .map(p => (p.value && p.value.type === 'Identifier') ? p.value.name : (p.key && p.key.name))
                        .filter(Boolean);
                    for (const n of names) defs.add(n);
                    imports.push({ specifier, kind: 'require', names });
                    return;
                } else if (declarator.id.type === 'Identifier') {
                    defs.add(declarator.id.name);
                    imports.push({ specifier, kind: 'require', names: [] });
                    return;
                }
            }
            imports.push({ specifier, kind: 'require', names: [] });
        }
    });
    if (/\bmodule\.exports\b|\bexports\.\w/.test(src)) hasCommonJS = true;

    const refs = new Map();
    walk.simple(ast, {
        Identifier(node) {
            const name = node.name;
            if (defs.has(name) || COMMON_GLOBALS.has(name)) return;
            if (name === 'require' || name === 'module' || name === 'exports' || name === '__dirname' || name === '__filename') return;
            refs.set(name, (refs.get(name) || 0) + 1);
        }
    });

    return { defs, refs, imports, isModule, hasCommonJS };
}

const RESOLVE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];

// Resolves an import specifier used by `fromFile` to either:
//   { type: 'local', relPath: string } — a real file inside the project root
//   { type: 'external', packageName: string, subpath: string|null } — an npm package
//   null — relative import that couldn't be resolved to an existing file (dangling)
// `fromFile` and results are project-root-relative paths with forward slashes.
function resolveSpecifier(specifier, fromFile, projectRoot) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const fromDir = path.dirname(path.join(projectRoot, fromFile));
        const base = specifier.startsWith('/') ? path.join(projectRoot, specifier) : path.resolve(fromDir, specifier);

        const candidates = [];
        if (path.extname(base)) {
            candidates.push(base);
        } else {
            for (const ext of RESOLVE_EXTENSIONS) candidates.push(base + ext);
            for (const ext of RESOLVE_EXTENSIONS) candidates.push(path.join(base, 'index' + ext));
        }
        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return { type: 'local', relPath: path.relative(projectRoot, candidate).replace(/\\/g, '/') };
            }
        }
        return null; // relative import that points nowhere real (dangling)
    }

    // bare specifier -> external package. Scoped packages are two segments (@scope/name).
    const parts = specifier.split('/');
    const bareName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const packageName = bareName.replace(/^node:/, '');
    const subpath = specifier.slice(bareName.length).replace(/^\//, '') || null;
    return { type: 'external', packageName, subpath, isBuiltin: NODE_BUILTINS.has(packageName) };
}

const NODE_BUILTINS = new Set([
    'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
    'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector',
    'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
    'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'trace_events',
    'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib', 'diagnostics_channel',
    'async_hooks',
]);

// Best-effort metadata for an external package, read from node_modules if present.
// Returns null fields when nothing is available (no network calls, ever).
const _pkgMetaCache = new Map();
function getExternalPackageInfo(packageName, projectRoot) {
    if (_pkgMetaCache.has(packageName)) return _pkgMetaCache.get(packageName);
    if (NODE_BUILTINS.has(packageName)) {
        const info = { version: null, description: 'Node.js built-in module' };
        _pkgMetaCache.set(packageName, info);
        return info;
    }
    let info = { version: null, description: null };
    try {
        const pkgJsonPath = path.join(projectRoot, 'node_modules', packageName, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
            info = { version: pkg.version || null, description: pkg.description || null };
        }
    } catch (e) {
        // malformed package.json or unreadable -- leave info as unknowns
    }
    _pkgMetaCache.set(packageName, info);
    return info;
}

module.exports = { analyzeSource, COMMON_GLOBALS, resolveSpecifier, getExternalPackageInfo };
