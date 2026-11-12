// Cloudflare Worker for @memar_mli_bot.
//
//   POST /telegram/webhook   Telegram updates (checked against TELEGRAM_WEBHOOK_SECRET)
//   /sync/...                private API for the site server (Bearer SYNC_SECRET)
//   GET  /health
//
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SYNC_SECRET.
// Vars: BOT_USERNAME, SITE_URL.

import {createBot} from './bot.js';
import {telegramClient} from './telegram.js';

const json = (value, status = 200) => Response.json(value, {status});

// Constant-time comparison so the sync secret cannot be guessed byte by byte.
function sameSecret(given, expected) {
  if (!expected || typeof given !== 'string' || given.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < given.length; i += 1) difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const text = (value, limit) => (value == null ? null : String(value).slice(0, limit));

export function createWorker({db, env, fetchImpl = fetch, now = Date.now}) {
  const tg = telegramClient(env, fetchImpl);
  const bot = createBot({db, tg, env, now});

  async function state() {
    const links = await db.prepare(`SELECT profile_id, telegram_username, first_name, accepts_messages, linked_at FROM links`).all();
    const edits = await db.prepare(`SELECT id, profile_id, field, value, file_name, mime, created_at,
      CASE WHEN file_id IS NULL THEN 0 ELSE 1 END AS has_file FROM edits WHERE status = 'pending' ORDER BY created_at`).all();
    const joins = await db.prepare(`SELECT id, telegram_username, name, student_number, note, created_at FROM join_requests
      WHERE status = 'pending' ORDER BY created_at`).all();
    const conversations = await db.prepare('SELECT COUNT(*) AS n FROM conversations').first();
    return {
      links: links.results.map(row => ({
        profileId: row.profile_id, telegramUsername: row.telegram_username, firstName: row.first_name,
        acceptsMessages: Boolean(row.accepts_messages), linkedAt: row.linked_at
      })),
      edits: edits.results.map(row => ({
        id: row.id, profileId: row.profile_id, field: row.field, value: row.value == null ? null : JSON.parse(row.value),
        fileName: row.file_name, mime: row.mime, hasFile: Boolean(row.has_file), createdAt: row.created_at
      })),
      joinRequests: joins.results.map(row => ({
        id: row.id, telegramUsername: row.telegram_username, name: row.name, studentNumber: row.student_number,
        note: row.note, createdAt: row.created_at
      })),
      conversations: conversations.n,
      botUsername: bot.botUsername
    };
  }

  // The site server sends every profile; this replaces the table in one batch.
  async function replaceProfiles(profiles) {
    const statements = [db.prepare('DELETE FROM profiles')];
    for (const profile of profiles.slice(0, 5000)) {
      if (!profile || typeof profile.id !== 'string' || !/^[a-f0-9]{12}$/.test(profile.id)) continue;
      statements.push(db.prepare(`INSERT INTO profiles (id, name, name_en, year, student_number, telegram_username, invite_hash, published, card)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        profile.id, text(profile.name, 120) || '', text(profile.nameEn, 120), Number(profile.year) || null,
        text(profile.studentNumber, 12), profile.telegramUsername ? String(profile.telegramUsername).replace(/^@/, '').toLowerCase().slice(0, 64) : null,
        /^[a-f0-9]{64}$/.test(profile.inviteHash || '') ? profile.inviteHash : null, profile.published ? 1 : 0,
        JSON.stringify(profile.card || {}).slice(0, 20000)
      ));
    }
    // Links to profiles that no longer exist are dropped.
    statements.push(db.prepare('DELETE FROM links WHERE profile_id NOT IN (SELECT id FROM profiles)'));
    await db.batch(statements);
  }

  async function syncApi(request, path, method) {
    const authorization = request.headers.get('authorization') || '';
    if (!sameSecret(authorization.replace(/^Bearer /, ''), env.SYNC_SECRET)) return json({error: 'forbidden'}, 403);

    if (path === '/sync/state' && method === 'GET') return json(await state());
    if (path === '/sync/profiles' && method === 'POST') {
      const payload = await body(request);
      if (!payload || !Array.isArray(payload.profiles)) return json({error: 'profiles must be a list'}, 400);
      await replaceProfiles(payload.profiles);
      return json(await state());
    }

    let match = /^\/sync\/edits\/(\d+)$/.exec(path);
    if (match && method === 'POST') {
      const payload = await body(request);
      const decision = payload?.decision;
      if (decision !== 'approved' && decision !== 'rejected') return json({error: 'decision must be approved or rejected'}, 400);
      const edit = await db.prepare("SELECT * FROM edits WHERE id = ? AND status = 'pending'").bind(Number(match[1])).first();
      if (!edit) return json({error: 'edit not found'}, 404);
      await db.prepare('UPDATE edits SET status = ?, note = ?, decided_at = ? WHERE id = ?')
        .bind(decision, text(payload.note, 500), now(), edit.id).run();
      await bot.notifyEdit(edit, decision, text(payload.note, 500));
      return json({ok: true});
    }
    match = /^\/sync\/edits\/(\d+)\/file$/.exec(path);
    if (match && method === 'GET') {
      const edit = await db.prepare('SELECT file_id, mime FROM edits WHERE id = ?').bind(Number(match[1])).first();
      if (!edit?.file_id) return json({error: 'no file'}, 404);
      const file = await tg.download(edit.file_id);
      return new Response(file.bytes, {headers: {'content-type': edit.mime || 'application/octet-stream'}});
    }
    match = /^\/sync\/joins\/(\d+)$/.exec(path);
    if (match && method === 'POST') {
      const payload = await body(request);
      const decision = payload?.decision;
      if (decision !== 'accepted' && decision !== 'rejected') return json({error: 'decision must be accepted or rejected'}, 400);
      const join = await db.prepare("SELECT * FROM join_requests WHERE id = ? AND status = 'pending'").bind(Number(match[1])).first();
      if (!join) return json({error: 'request not found'}, 404);
      const statements = [db.prepare('UPDATE join_requests SET status = ?, decided_at = ? WHERE id = ?').bind(decision, now(), join.id)];
      // Accepting with a profile id connects the requester's Telegram account to it.
      if (decision === 'accepted' && /^[a-f0-9]{12}$/.test(payload.profileId || '')) {
        statements.push(db.prepare(`INSERT OR IGNORE INTO links (profile_id, telegram_id, telegram_username, accepts_messages, linked_at)
          VALUES (?, ?, ?, 0, ?)`).bind(payload.profileId, join.telegram_id, join.telegram_username, now()));
      }
      await db.batch(statements);
      await bot.notifyJoin(join, decision);
      if (statements.length > 1) await bot.announceToLineage(payload.profileId);
      return json({ok: true});
    }
    match = /^\/sync\/links\/([a-f0-9]{12})$/.exec(path);
    if (match && method === 'DELETE') {
      await db.prepare('DELETE FROM links WHERE profile_id = ?').bind(match[1]).run();
      return json({ok: true});
    }
    return json({error: 'not found'}, 404);
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      try {
        if (url.pathname === '/health' && method === 'GET') return json({ok: true});
        if (url.pathname === '/telegram/webhook' && method === 'POST') {
          if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
            return json({error: 'forbidden'}, 403);
          }
          const update = await body(request);
          if (update) await bot.handleUpdate(update);
          return json({ok: true});
        }
        if (url.pathname.startsWith('/sync/')) return await syncApi(request, url.pathname, method);
        return json({error: 'not found'}, 404);
      } catch (error) {
        console.error(error);
        // Telegram retries non-2xx answers forever; the webhook always acknowledges.
        if (url.pathname === '/telegram/webhook') return json({ok: true});
        return json({error: 'server error'}, 500);
      }
    }
  };
}

export default {
  fetch(request, env) {
    return createWorker({db: env.DB, env}).fetch(request);
  }
};
