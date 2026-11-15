// node tests/i18n-check.mjs : key parity MM/EN, every key used in code exists, no leftover hard-coded UI text in index.html
import fs from 'node:fs'; import path from 'node:path';
import { I18N } from '../public/js/i18n.js';
const mm = Object.keys(I18N.mm), en = Object.keys(I18N.en);
let bad = 0; const fail = (m) => { console.error('FAIL ' + m); bad++; };
mm.filter((k) => !en.includes(k)).forEach((k) => fail('missing in en: ' + k));
en.filter((k) => !mm.includes(k)).forEach((k) => fail('missing in mm: ' + k));
[...mm, ...en].forEach((k) => { if (!I18N.mm[k] || !I18N.en[k]) fail('empty: ' + k); });
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.(js|html)$/.test(f) && files.push(p); } })('public');
const used = new Set();
const pats = [/\bT\(\s*'([a-z0-9_]+)'/g, /\bt\(\s*'([a-z0-9_]+)'/g, /setT\([^,\n]+,\s*'([a-z0-9_]+)'/g, /AppError\(\s*'([a-z0-9_]+)'/g,
  /(?:msgKey|okKey|titleKey|labelKey)\s*[:=]\s*'([a-z0-9_]+)'/g, /showNotice\(\s*'([a-z0-9_]+)'/g, /tAttr\([^,]+,\s*'[a-z]+',\s*'([a-z0-9_]+)'/g,
  /\bkey:\s*'([a-z0-9_]+)'/g, /data-i18n(?:-aria)?="([a-z0-9_]+)"/g, /setAria\([^,]+,\s*'([a-z0-9_]+)'/g, /'(err_[a-z0-9_]+)'/g,
  /\b(?:num|T)\(\s*'(set_[a-z]+)',\s*'(set_[a-z_]+)'/g, /\['(?:chapters|voices|generate)',\s*'(tab_[a-z]+)'\]/g];
for (const f of files) { const s = fs.readFileSync(f, 'utf8'); for (const p of pats) for (const m of s.matchAll(p)) m.slice(1).forEach((g) => g && used.add(g)); }
['idle', 'running', 'paused', 'complete', 'incomplete', 'canceled'].forEach((s) => used.add('gen_state_' + s));
['path_direct', 'path_proxy', 'path_unknown', 'test_ok_direct', 'test_ok_proxy', 'set_chunk', 'set_chunk_hint', 'set_cfg', 'set_cfg_hint', 'pl_pause', 'pl_play', 'gen_merging'].forEach((k) => used.add(k));
for (const k of used) if (k !== 'gen_state_' && !(k in I18N.en)) fail('key used in code but not defined: ' + k);
const unused = en.filter((k) => !used.has(k)); if (unused.length) console.log('note: defined but not found by the scan (may be dynamic): ' + unused.join(', '));
// placeholders must match between languages
for (const k of en) { const a = (I18N.en[k].match(/\{\w+\}/g) || []).sort().join(), b = (I18N.mm[k].match(/\{\w+\}/g) || []).sort().join(); if (a !== b) fail(`placeholder mismatch in ${k}: en[${a}] mm[${b}]`); }
// index.html: no visible text outside data-i18n elements (rough check: text nodes between tags)
const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>/g, '');
for (const m of html.matchAll(/>([^<>]+)</g)) { const x = m[1].trim(); if (x && !/^(MM|EN)$/.test(x)) fail('hard-coded text in index.html: ' + x); }
console.log(bad ? `\n${bad} problems` : `i18n ok: ${mm.length} keys in both languages, ${used.size} used keys checked`);
process.exitCode = bad ? 1 : 0;
