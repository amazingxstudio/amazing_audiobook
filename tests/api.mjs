// node tests/api.mjs : tests api/audio.js host checks and api/tts.js validation (network stubbed)
import assert from 'node:assert/strict';
const mkRes = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; }, setHeader(k, v) { r.headers[k] = v; } }; return r; };
const audio = (await import('../api/audio.js')).default;
const H = 'openbmb-voxcpm-demo.hf.space';
let calls = [];
globalThis.fetch = async (u, o) => { calls.push(String(u)); const url = String(u);
  if (url.includes('/redir')) return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x.wav' } });
  if (url.includes('/big')) return new Response(new Uint8Array(5 * 1024 * 1024), { status: 200, headers: { 'content-type': 'audio/wav' } });
  return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/wav' } }); };
const run = async (q, m = 'GET') => { const r = mkRes(); await audio({ method: m, query: q }, r); return r; };
let r = await run({ u: `https://${H}/gradio_api/file=/tmp/a.wav` }); assert.equal(r.code, 200); assert.equal(r.headers['Content-Type'], 'audio/wav');
r = await run({ u: 'https://evil.example.com/a.wav' }); assert.equal(r.code, 403);
r = await run({ u: `http://${H}/a.wav` }); assert.equal(r.code, 403);
r = await run({ u: `https://${H}.evil.com/a.wav` }); assert.equal(r.code, 403);
r = await run({ u: `https://${H}/redir` }); assert.equal(r.code, 403, 'redirect to another host must be blocked');
r = await run({ u: `https://${H}/big` }); assert.equal(r.code, 413);
r = await run({ u: 'not a url' }); assert.equal(r.code, 400);
r = await run({}, 'POST'); assert.equal(r.code, 405);
r = await run({ u: 'https://my-user-my-space.hf.space/a.wav', s: 'My_User/My.Space' }); assert.equal(r.code, 200, 'override space host');
let tts;
try { tts = (await import('../api/tts.js')).default; } catch (e) { console.log('tts.js skipped (npm install not run: ' + e.code + ')'); }
if (tts) {
const post = async (b) => { const x = mkRes(); await tts({ method: 'POST', body: b }, x); return x; };
assert.equal((await post({})).code, 400);
assert.equal((await post({ text: 'x', space: 'bad space' })).code, 400);
}
console.log('api tests ok');
