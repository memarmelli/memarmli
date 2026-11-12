import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createWorker} from '../src/index.js';
import {sha256} from '../src/bot.js';

const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

// Minimal D1 on top of node:sqlite: prepare/bind/first/all/run and batch.
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  const prepare = sql => {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return {results: sqlite.prepare(sql).all(...args)}; },
      async run() {
        const result = sqlite.prepare(sql).run(...args);
        return {meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}};
      },
      execute() { return sqlite.prepare(sql).run(...args); }
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    sqlite
  };
}

// Fake Telegram: records every call and answers like the Bot API.
function fakeTelegram() {
  const calls = [];
  let messageId = 100;
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.startsWith('/file/')) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {status: 200});
    const method = path.split('/').pop();
    const payload = init.body ? JSON.parse(init.body) : {};
    calls.push({method, payload});
    const result = method === 'getFile' ? {file_path: 'documents/file_1.pdf'} : {message_id: (messageId += 1)};
    return Response.json({ok: true, result});
  };
  return {calls, fetchImpl, sent: chatId => calls.filter(call => String(call.payload.chat_id) === String(chatId))};
}

const ENV = {TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_WEBHOOK_SECRET: 'hook-secret', SYNC_SECRET: 'sync-secret-value', SITE_URL: 'https://melli.example'};
const GRAD = {id: 101, first_name: 'Sara', username: 'SaraAmini', language_code: 'fa'};
const VISITOR = {id: 202, first_name: 'Ali', username: 'ali_x'};
const STRANGER = {id: 303, first_name: 'Reza'};

function setup() {
  const db = d1();
  const telegram = fakeTelegram();
  let clock = Date.UTC(2026, 9, 28, 12);
  const worker = createWorker({db, env: ENV, fetchImpl: telegram.fetchImpl, now: () => clock});
  let updateId = 1;
  const hook = update => worker.fetch(new Request('https://bot.test/telegram/webhook', {
    method: 'POST', headers: {'x-telegram-bot-api-secret-token': 'hook-secret', 'content-type': 'application/json'},
    body: JSON.stringify({update_id: (updateId += 1), ...update})
  }));
  let messageId = 1;
  const say = (from, text, extra = {}) => hook({message: {message_id: (messageId += 1), from, chat: {id: from.id, type: 'private'}, text, ...extra}});
  const press = (from, data) => hook({callback_query: {id: `cb${messageId += 1}`, from, data, message: {chat: {id: from.id}}}});
  const sync = (path, method = 'GET', payload) => worker.fetch(new Request(`https://bot.test${path}`, {
    method, headers: {authorization: 'Bearer sync-secret-value', 'content-type': 'application/json'},
    body: payload ? JSON.stringify(payload) : undefined
  }));
  return {db, telegram, worker, hook, say, press, sync, tick: ms => { clock += ms; }};
}

async function pushProfiles(env, extra = {}) {
  const inviteHash = await sha256('invite-token-1');
  const response = await env.sync('/sync/profiles', 'POST', {profiles: [
    {id: 'aaaaaaaaaaaa', name: 'سارا امینی', nameEn: 'Sara Amini', year: 1399, studentNumber: '99411012', telegramUsername: '@saraamini', published: true, card: {location: 'برلین، آلمان'}},
    {id: 'bbbbbbbbbbbb', name: 'نیما فرهمند', year: 1398, studentNumber: '98411012', inviteHash, published: true, card: {}, ...extra}
  ]});
  assert.equal(response.status, 200);
  return response.json();
}

test('webhook and sync API reject requests without their secrets', async () => {
  const env = setup();
  const bad = await env.worker.fetch(new Request('https://bot.test/telegram/webhook', {method: 'POST', body: '{}'}));
  assert.equal(bad.status, 403);
  const noAuth = await env.worker.fetch(new Request('https://bot.test/sync/state'));
  assert.equal(noAuth.status, 403);
  const wrong = await env.worker.fetch(new Request('https://bot.test/sync/state', {headers: {authorization: 'Bearer nope'}}));
  assert.equal(wrong.status, 403);
  assert.equal((await env.sync('/sync/state')).status, 200);
});

test('a graduate whose @username is on their profile is linked on /start', async () => {
  const env = setup();
  await pushProfiles(env);
  await env.say(GRAD, '/start');
  const state = await (await env.sync('/sync/state')).json();
  assert.equal(state.links.length, 1);
  assert.equal(state.links[0].profileId, 'aaaaaaaaaaaa');
  assert.equal(state.links[0].acceptsMessages, false);
  assert.match(env.telegram.sent(GRAD.id).map(call => call.payload.text).join('\n'), /سارا امینی/);
});

test('an invite link connects any account once, and cannot be taken over', async () => {
  const env = setup();
  await pushProfiles(env);
  await env.say(STRANGER, '/start l_wrong-token');
  assert.match(env.telegram.sent(STRANGER.id).at(-1).payload.text, /معتبر نیست/);
  await env.say(STRANGER, '/start l_invite-token-1');
  await env.say(VISITOR, '/start l_invite-token-1');
  const state = await (await env.sync('/sync/state')).json();
  const link = state.links.find(item => item.profileId === 'bbbbbbbbbbbb');
  assert.ok(link);
  assert.match(env.telegram.sent(VISITOR.id).at(-1).payload.text, /حساب تلگرام دیگری/);
});

test('self-edits wait for approval and the graduate hears the decision', async () => {
  const env = setup();
  await pushProfiles(env);
  await env.say(GRAD, '/start');
  await env.press(GRAD, 'e:occupation');
  await env.say(GRAD, 'طراح شهری');
  await env.press(GRAD, 'e:linkedin');
  await env.say(GRAD, 'javascript:alert(1)');
  assert.match(env.telegram.sent(GRAD.id).at(-1).payload.text, /linkedin/i);
  await env.press(GRAD, 'x');
  await env.press(GRAD, 'f:openToWork:1');
  await env.press(GRAD, 'e:resumeFile');
  await env.say(GRAD, '', {document: {file_id: 'FILE1', file_name: 'cv.pdf', mime_type: 'application/pdf', file_size: 2048}});
  let state = await (await env.sync('/sync/state')).json();
  assert.deepEqual(state.edits.map(edit => [edit.field, edit.value, edit.hasFile]), [['occupation', 'طراح شهری', false], ['openToWork', true, false], ['resumeFile', null, true]]);
  const file = await env.sync(`/sync/edits/${state.edits[2].id}/file`);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.equal(new Uint8Array(await file.arrayBuffer())[0], 0x25);
  assert.equal((await env.sync(`/sync/edits/${state.edits[0].id}`, 'POST', {decision: 'approved'})).status, 200);
  assert.equal((await env.sync(`/sync/edits/${state.edits[1].id}`, 'POST', {decision: 'rejected', note: 'بعداً'})).status, 200);
  state = await (await env.sync('/sync/state')).json();
  assert.equal(state.edits.length, 1);
  const texts = env.telegram.sent(GRAD.id).map(call => call.payload.text).join('\n');
  assert.match(texts, /تأیید شد/);
  assert.match(texts, /تأیید نشد\.\nبعداً/);
});

test('anonymous contact: opt-in, relay both ways, reveal and block', async () => {
  const env = setup();
  await pushProfiles(env);
  await env.say(GRAD, '/start');
  await env.say(VISITOR, '/start c_aaaaaaaaaaaa');
  assert.match(env.telegram.sent(VISITOR.id).at(-1).payload.text, /پیام دریافت نمی‌کند/);

  await env.press(GRAD, 'm:msg');
  let state = await (await env.sync('/sync/state')).json();
  assert.equal(state.links[0].acceptsMessages, true);

  await env.say(VISITOR, '/start c_aaaaaaaaaaaa');
  await env.say(VISITOR, 'سلام، درباره‌ی پروژه‌ی شما سؤال داشتم');
  const copies = env.telegram.calls.filter(call => call.method === 'copyMessage');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].payload.chat_id, '101');
  assert.equal(copies[0].payload.from_chat_id, VISITOR.id);
  assert.ok(env.telegram.sent('101').some(call => /فرستنده ناشناس است/.test(call.payload.text || '')));
  // Nothing sent to the graduate reveals the visitor.
  assert.ok(!JSON.stringify(env.telegram.sent('101')).includes('ali_x'));

  const conversationId = /^r:(\w+)$/.exec(copies[0].payload.reply_markup.inline_keyboard[0][0].callback_data)[1];
  await env.press(GRAD, `r:${conversationId}`);
  await env.say(GRAD, 'سلام، بفرمایید');
  const back = env.telegram.calls.filter(call => call.method === 'copyMessage').at(-1);
  assert.equal(back.payload.chat_id, '202');
  assert.ok(env.telegram.sent('202').some(call => /پاسخ سارا امینی/.test(call.payload.text || '')));

  await env.press(VISITOR, `v:${conversationId}`);
  assert.ok(env.telegram.sent('101').some(call => /@ali_x/.test(call.payload.text || '')));

  await env.press(GRAD, `b:${conversationId}`);
  await env.say(VISITOR, '/start c_aaaaaaaaaaaa');
  assert.match(env.telegram.sent(VISITOR.id).at(-1).payload.text, /امکان ارسال پیام/);

  // A stranger cannot act on someone else's conversation.
  await env.press(STRANGER, `r:${conversationId}`);
  assert.match(env.telegram.sent(STRANGER.id).at(-1).payload.text, /فعال نیست/);
  state = await (await env.sync('/sync/state')).json();
  assert.equal(state.conversations, 1);
});

test('join requests reach the admins, and acceptance links the account', async () => {
  const env = setup();
  await pushProfiles(env);
  await env.say(STRANGER, '/start');
  await env.press(STRANGER, 'm:join');
  await env.say(STRANGER, 'رضا کاظمی');
  await env.say(STRANGER, '97411033');
  await env.press(STRANGER, 'j:send');
  let state = await (await env.sync('/sync/state')).json();
  assert.equal(state.joinRequests.length, 1);
  assert.equal(state.joinRequests[0].studentNumber, '97411033');
  await env.sync('/sync/profiles', 'POST', {profiles: [{id: 'cccccccccccc', name: 'رضا کاظمی', year: 1397, studentNumber: '97411033', published: false}]});
  assert.equal((await env.sync(`/sync/joins/${state.joinRequests[0].id}`, 'POST', {decision: 'accepted', profileId: 'cccccccccccc'})).status, 200);
  state = await (await env.sync('/sync/state')).json();
  assert.equal(state.joinRequests.length, 0);
  assert.equal(state.links.find(link => link.profileId === 'cccccccccccc').profileId, 'cccccccccccc');
  assert.match(env.telegram.sent('303').at(-1).payload.text, /ساخته شد/);
});

test('when a graduate connects, the nearest linked graduate of the same lineage hears about it', async () => {
  const env = setup();
  await pushProfiles(env);
  await env.say(STRANGER, '/start l_invite-token-1');
  const before = env.telegram.sent(STRANGER.id).length;
  await env.say(GRAD, '/start');
  const news = env.telegram.sent(STRANGER.id).slice(before).map(call => call.payload.text);
  assert.equal(news.length, 1);
  assert.match(news[0], /سارا امینی، ورودی 1399، فرزند نسلی شما/);
  assert.match(news[0], /https:\/\/melli\.example\/student\.html\?year=1399&student=12/);
  // The one who just connected gets no news about themselves.
  assert.ok(!env.telegram.sent(GRAD.id).some(call => /پیوست/.test(call.payload.text)));
});

test('a repeated Telegram update is handled once', async () => {
  const env = setup();
  await pushProfiles(env);
  const update = {update_id: 777, message: {message_id: 5, from: STRANGER, chat: {id: STRANGER.id, type: 'private'}, text: '/start'}};
  const post = () => env.worker.fetch(new Request('https://bot.test/telegram/webhook', {
    method: 'POST', headers: {'x-telegram-bot-api-secret-token': 'hook-secret'}, body: JSON.stringify(update)
  }));
  await post();
  const count = env.telegram.calls.length;
  await post();
  assert.equal(env.telegram.calls.length, count);
});

test('contact messages are rate limited per day', async () => {
  const env = setup();
  await pushProfiles(env);
  await env.say(GRAD, '/start');
  await env.press(GRAD, 'm:msg');
  for (let i = 0; i < 61; i += 1) {
    await env.say(VISITOR, '/start c_aaaaaaaaaaaa');
    await env.say(VISITOR, `پیام ${i}`);
  }
  assert.match(env.telegram.sent(VISITOR.id).at(-1).payload.text, /حد مجاز/);
  assert.equal(env.telegram.calls.filter(call => call.method === 'copyMessage').length, 60);
});

test('unlinking from the site removes the connection', async () => {
  const env = setup();
  await pushProfiles(env);
  await env.say(GRAD, '/start');
  assert.equal((await env.sync('/sync/links/aaaaaaaaaaaa', 'DELETE')).status, 200);
  const state = await (await env.sync('/sync/state')).json();
  assert.equal(state.links.length, 0);
});
