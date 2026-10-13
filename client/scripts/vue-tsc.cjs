// Runs vue-tsc against the client's own TypeScript 6 (the `typescript`
// devDependency here is aliased to npm:typescript@~6.0.3). TypeScript 7
// ships no JS API, so vue-tsc can't run on it, and the root's TS7 is the
// copy that gets hoisted -- a plain `vue-tsc` (itself hoisted) would
// resolve that one. Passing the tsc path explicitly sidesteps hoisting.
// Drop this wrapper once vue-tsc supports TS7 (vuejs/language-tools#6170).
const tscPath = require.resolve('typescript/lib/tsc', { paths: [__dirname] })
require('vue-tsc').run(tscPath)
