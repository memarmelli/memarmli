// Local stand-in for the Cloudflare Worker: the real worker code on node:sqlite, with a fake Telegram.
// Used by test_server_sync.py; POST /__hook delivers a Telegram update, GET /__calls lists Bot API calls.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createWorker} from '../src/index.js';
const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(SCHEMA);
const prepare = sql => {
  let args = [];
  const s = {
    bind(...v) { args = v; return s; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return {results: sqlite.prepare(sql).all(...args)}; },
    async run() { const r = sqlite.prepare(sql).run(...args); return {meta: {changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid)}}; },
    execute() { return sqlite.prepare(sql).run(...args); }
  };
  return s;
};
const db = {prepare, async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(x => x.execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }};

const calls = [];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const PDF = new TextEncoder().encode('%PDF-1.4 test');
const fetchImpl = async (url, init = {}) => {
  const path = new URL(url).pathname;
  if (path.startsWith('/file/')) return new Response(path.includes('photo') ? JPEG : PDF);
  const method = path.split('/').pop();
  const payload = init.body ? JSON.parse(init.body) : {};
  calls.push({method, payload});
  const result = method === 'getFile' ? {file_path: String(payload.file_id).startsWith('ph') ? 'photos/a.jpg' : 'documents/a.pdf'} : {message_id: calls.length};
  return Response.json({ok: true, result});
};
const env = {TELEGRAM_BOT_TOKEN: 't', TELEGRAM_WEBHOOK_SECRET: 'hook', SYNC_SECRET: 'local-sync-secret', BOT_USERNAME: 'memar_mli_bot'};
const worker = createWorker({db, env, fetchImpl});

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (req.url === '/__calls') { res.end(JSON.stringify(calls)); return; }
  const headers = {...req.headers};
  if (req.url === '/__hook') headers['x-telegram-bot-api-secret-token'] = 'hook';
  const path = req.url === '/__hook' ? '/telegram/webhook' : req.url;
  const response = await worker.fetch(new Request('http://bot.local' + path, {method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body}));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(Number(process.env.MOCK_PORT || 8799), () => console.log('mock bot ready'));
