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

// Parses one file's source and returns { defs: Set<name>, refs: Map<name, count> } —
// refs excludes names the file defines itself and common built-ins, and counts every
// occurrence (not just distinct names) so edge weight reflects actual usage volume.
// Returns null on parse failure (caller should keep the file's previous state).
function analyzeSource(src) {
    let ast;
    try {
        ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
    } catch (e) {
        return null;
    }

    const defs = new Set();
    for (const node of ast.body) {
        if (node.type === 'ClassDeclaration' && node.id) {
            defs.add(node.id.name);
        } else if (node.type === 'FunctionDeclaration' && node.id) {
            defs.add(node.id.name);
        } else if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (decl.id && decl.id.type === 'Identifier') defs.add(decl.id.name);
            }
        }
    }

    const refs = new Map();
    walk.simple(ast, {
        Identifier(node) {
            const name = node.name;
            if (defs.has(name) || COMMON_GLOBALS.has(name)) return;
            refs.set(name, (refs.get(name) || 0) + 1);
        }
    });

    return { defs, refs };
}

module.exports = { analyzeSource, COMMON_GLOBALS };
