const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
// config/community.ts reads import.meta.env, which CommonJS cannot run; give it the bundled posts directly.
const configPath = path.join(__dirname, '../config/community.ts');
require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: {
        NEWS: [
            { id: '1.0.5', kind: 'update', title: '1.0.5', paragraphs: ['a', 'b'], publishedAt: '2026-10-05T09:00:00+09:00' },
            { id: '1.0.6', kind: 'update', title: '1.0.6', paragraphs: ['c'], publishedAt: '2026-10-05T21:00:00+09:00' },
        ],
    },
};
const { choosePosts, missingBundledPosts, sortPosts, toParagraphs } = require('../utils/newsPosts.ts');

const post = (id, publishedAt, extra = {}) => ({ id, kind: 'notice', title: id, body: id, publishedAt, visible: true, pinned: false, ...extra });

test('posts list pinned first, then newest first', () => {
    const sorted = sortPosts([post('old', 1), post('new', 3), post('pinned', 2, { pinned: true })]);
    assert.deepEqual(sorted.map(p => p.id), ['pinned', 'new', 'old']);
});

test('server posts win once there are any; otherwise the cache, then the bundled posts', () => {
    assert.deepEqual(choosePosts([post('server', 1)], [post('cached', 1)]).map(p => p.id), ['server']);
    assert.deepEqual(choosePosts(null, [post('cached', 1)]).map(p => p.id), ['cached']);
    assert.deepEqual(choosePosts(null, null).map(p => p.id), ['1.0.6', '1.0.5']);
    // an empty server (nothing posted yet) still shows the bundled posts
    assert.deepEqual(choosePosts([], [post('cached', 1)]).map(p => p.id), ['1.0.6', '1.0.5']);
});

test('bundled posts join paragraphs and are offered for upload until the server has their ids', () => {
    const bundled = choosePosts(null, null);
    assert.equal(bundled[1].body, 'a\n\nb');
    assert.deepEqual(toParagraphs('first\n\n\nsecond\n  \nthird line\nsame paragraph'), ['first', 'second', 'third line\nsame paragraph']);
    assert.deepEqual(missingBundledPosts([post('1.0.6', 1)]).map(p => p.id), ['1.0.5']);
});
