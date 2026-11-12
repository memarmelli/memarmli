// The conversation logic of @memar_mli_bot: linking a Telegram account to a
// profile, self-edits that wait for an admin, join requests, and anonymous
// conversations started from a profile's Contact button.

import {FIELDS, t, fieldLabel} from './text.js';

const MAX_UPLOAD = 10 * 1024 * 1024;
const LIMITS = {message: 60, conversation: 15};
const LINKEDIN = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/\S*$/i;

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomId(length = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(byte => 'abcdefghijkmnpqrstuvwxyz23456789'[byte % 32]).join('');
}

const button = (text, data) => ({text, callback_data: data});
const urlButton = (text, url) => ({text, url});

export function createBot({db, tg, env, now = Date.now}) {
  const botUsername = env.BOT_USERNAME || 'memar_mli_bot';
  const siteUrl = (env.SITE_URL || '').replace(/\/$/, '');

  /* ------------------------------------------------------------ storage */

  async function session(telegramId, from) {
    let row = await db.prepare('SELECT lang, state, data FROM sessions WHERE telegram_id = ?').bind(telegramId).first();
    if (!row) {
      const lang = String(from?.language_code || '').startsWith('en') ? 'en' : 'fa';
      await db.prepare('INSERT OR IGNORE INTO sessions (telegram_id, lang, updated_at) VALUES (?, ?, ?)').bind(telegramId, lang, now()).run();
      row = {lang, state: null, data: null};
    }
    return {lang: row.lang, state: row.state, data: row.data ? JSON.parse(row.data) : {}};
  }

  async function setState(telegramId, state, data = {}) {
    await db.prepare('UPDATE sessions SET state = ?, data = ?, updated_at = ? WHERE telegram_id = ?')
      .bind(state, state ? JSON.stringify(data) : null, now(), telegramId).run();
  }

  async function linkOf(telegramId) {
    return db.prepare(`SELECT l.profile_id, l.accepts_messages, p.name, p.name_en, p.year, p.student_number, p.published, p.card
      FROM links l JOIN profiles p ON p.id = l.profile_id WHERE l.telegram_id = ?`).bind(telegramId).first();
  }

  async function langOf(telegramId) {
    const row = await db.prepare('SELECT lang FROM sessions WHERE telegram_id = ?').bind(telegramId).first();
    return row?.lang || 'fa';
  }

  async function countUsage(telegramId, kind) {
    const day = new Date(now()).toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO usage (telegram_id, day, kind, count) VALUES (?, ?, ?, 1)
      ON CONFLICT (telegram_id, day, kind) DO UPDATE SET count = count + 1`).bind(telegramId, day, kind).run();
    const row = await db.prepare('SELECT count FROM usage WHERE telegram_id = ? AND day = ? AND kind = ?').bind(telegramId, day, kind).first();
    return row.count <= LIMITS[kind];
  }

  /* ------------------------------------------------------------ output */

  const send = (chatId, text, keyboard) => tg.call('sendMessage', {
    chat_id: chatId, text, disable_web_page_preview: true,
    ...(keyboard ? {reply_markup: {inline_keyboard: keyboard}} : {})
  });

  function menuKeyboard(lang, link) {
    if (!link) return [[button(t(lang, 'btnJoin'), 'm:join')], [button(t(lang, 'btnLang'), 'm:lang')]];
    return [
      [button(t(lang, 'btnProfile'), 'm:profile'), button(t(lang, 'btnEdit'), 'm:edit')],
      [button(t(lang, link.accepts_messages ? 'btnMessagesOn' : 'btnMessagesOff'), 'm:msg')],
      [button(t(lang, 'btnLang'), 'm:lang')]
    ];
  }

  async function showMenu(chatId, lang, link, intro) {
    await send(chatId, intro || t(lang, 'menu'), menuKeyboard(lang, link));
  }

  function profileUrl(link) {
    return siteUrl && link.published ? `${siteUrl}/student.html?year=${link.year}&student=${String(link.student_number || '').slice(-2)}` : '';
  }

  async function showProfile(chatId, lang, link) {
    const card = JSON.parse(link.card || '{}');
    const show = (key, value) => t(lang, 'profileField', {label: fieldLabel(lang, key), value: value || t(lang, 'empty')});
    const yesNo = value => t(lang, value ? 'btnYes' : 'btnNo');
    const fields = [
      show('nameEn', card.nameEn), show('location', card.location), show('occupation', card.occupation),
      show('employer', card.employer), show('linkedin', card.linkedin),
      show('openToWork', yesNo(card.openToWork)), show('mentoring', yesNo(card.mentoring)),
      show('photo', card.hasPhoto ? '✓' : ''), show('resumeFile', card.hasResume ? '✓' : ''),
      show('summary', card.summary ? `${String(card.summary).slice(0, 160)}${card.summary.length > 160 ? '…' : ''}` : '')
    ].join('\n');
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM edits WHERE profile_id = ? AND status = 'pending'").bind(link.profile_id).first();
    const text = t(lang, 'profile', {
      name: lang === 'en' && link.name_en ? link.name_en : link.name, year: link.year || '', number: link.student_number || '',
      fields, pending: pending.n ? t(lang, 'pendingCount', {n: pending.n}) : t(lang, 'noPending')
    });
    const keyboard = [[button(t(lang, 'btnEdit'), 'm:edit')]];
    const url = profileUrl(link);
    if (url) keyboard.push([urlButton(t(lang, 'viewOnSite'), `${url}${lang === 'en' ? '&lang=en' : ''}`)]);
    keyboard.push([button(t(lang, 'btnBack'), 'm:menu')]);
    await send(chatId, text, keyboard);
  }

  async function showFieldChooser(chatId, lang) {
    const keys = Object.keys(FIELDS);
    const rows = [];
    for (let i = 0; i < keys.length; i += 2) rows.push(keys.slice(i, i + 2).map(key => button(fieldLabel(lang, key), `e:${key}`)));
    rows.push([button(t(lang, 'btnBack'), 'm:menu')]);
    await send(chatId, t(lang, 'chooseField'), rows);
  }

  /* ------------------------------------------------------------ linking */

  async function linkProfile(telegramId, from, profile) {
    const taken = await db.prepare('SELECT telegram_id FROM links WHERE profile_id = ?').bind(profile.id).first();
    if (taken && taken.telegram_id !== telegramId) return 'linkTaken';
    const other = await db.prepare('SELECT profile_id FROM links WHERE telegram_id = ?').bind(telegramId).first();
    if (other && other.profile_id !== profile.id) return 'alreadyLinked';
    if (!taken) {
      await db.prepare(`INSERT INTO links (profile_id, telegram_id, telegram_username, first_name, accepts_messages, linked_at)
        VALUES (?, ?, ?, ?, 0, ?)`).bind(profile.id, telegramId, (from.username || '').toLowerCase() || null, from.first_name || null, now()).run();
      await announceToLineage(profile.id);
    }
    return 'linked';
  }

  // When a graduate connects, the nearest graduates of the same lineage (same last
  // two digits, the closest intake before and after) hear about it, if they are here too.
  async function announceToLineage(profileId) {
    const me = await db.prepare('SELECT id, name, name_en, year, student_number, published FROM profiles WHERE id = ?').bind(profileId).first();
    if (!me?.published || !me.year || !me.student_number) return;
    const {results} = await db.prepare(`SELECT p.year, l.telegram_id FROM profiles p LEFT JOIN links l ON l.profile_id = p.id
      WHERE p.published = 1 AND p.id != ? AND substr(p.student_number, -2) = ?`).bind(me.id, me.student_number.slice(-2)).all();
    const older = results.filter(row => row.year < me.year).sort((a, b) => b.year - a.year)[0];
    const newer = results.filter(row => row.year > me.year).sort((a, b) => a.year - b.year)[0];
    const url = profileUrl(me);
    // To the older graduate the newcomer is a lineage child; to the newer one, a lineage parent.
    for (const [row, relation] of [[older, 'relationChild'], [newer, 'relationParent']]) {
      if (!row?.telegram_id) continue;
      const lang = await langOf(row.telegram_id);
      await send(row.telegram_id, t(lang, 'lineageJoined', {
        name: lang === 'en' && me.name_en ? me.name_en : me.name, year: me.year, relation: t(lang, relation), link: url ? `\n${url}` : ''
      })).catch(() => {});
    }
  }

  async function handleStart(chatId, telegramId, from, lang, param) {
    await setState(telegramId, null);
    if (param.startsWith('l_')) {
      const profile = await db.prepare('SELECT id, name FROM profiles WHERE invite_hash = ?').bind(await sha256(param.slice(2))).first();
      if (!profile) return send(chatId, t(lang, 'linkInvalid'));
      const result = await linkProfile(telegramId, from, profile);
      if (result !== 'linked') return send(chatId, t(lang, result));
      await send(chatId, `${t(lang, 'linked', {name: profile.name})}\n\n${t(lang, 'privacy')}`);
      return showMenu(chatId, lang, await linkOf(telegramId));
    }
    if (param.startsWith('c_')) return startContact(chatId, telegramId, lang, param.slice(2));

    let link = await linkOf(telegramId);
    if (!link && from.username) {
      const profile = await db.prepare('SELECT id, name FROM profiles WHERE telegram_username = ?').bind(from.username.toLowerCase()).first();
      if (profile && (await linkProfile(telegramId, from, profile)) === 'linked') {
        await send(chatId, `${t(lang, 'linked', {name: profile.name})}\n\n${t(lang, 'privacy')}`);
        link = await linkOf(telegramId);
      }
    }
    if (link) return showMenu(chatId, lang, link, t(lang, 'welcomeLinked', {name: lang === 'en' && link.name_en ? link.name_en : link.name}));
    const pending = await db.prepare("SELECT id FROM join_requests WHERE telegram_id = ? AND status = 'pending'").bind(telegramId).first();
    return showMenu(chatId, lang, null, `${t(lang, 'welcomeStranger')}${pending ? `\n\n${t(lang, 'joinPending')}` : ''}`);
  }

  /* ------------------------------------------------------------ self-edits */

  async function saveEdit(link, telegramId, field, value, file = {}) {
    await db.prepare(`INSERT INTO edits (profile_id, telegram_id, field, value, file_id, file_name, mime, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(link.profile_id, telegramId, field, value === undefined ? null : JSON.stringify(value), file.id || null, file.name || null, file.mime || null, now()).run();
  }

  async function receiveEdit(chatId, telegramId, lang, link, field, message) {
    const spec = FIELDS[field];
    if (spec.kind === 'photo') {
      const photo = message.photo?.[message.photo.length - 1];
      const imageDocument = message.document && /^image\/(jpeg|png|webp)$/.test(message.document.mime_type || '') ? message.document : null;
      const chosen = photo || imageDocument;
      if (!chosen || (chosen.file_size || 0) > MAX_UPLOAD) return send(chatId, t(lang, 'needPhoto'), [[button(t(lang, 'btnCancel'), 'x')]]);
      await saveEdit(link, telegramId, field, undefined, {id: chosen.file_id, name: imageDocument?.file_name || 'photo.jpg', mime: imageDocument?.mime_type || 'image/jpeg'});
    } else if (spec.kind === 'pdf') {
      const document = message.document;
      if (!document || document.mime_type !== 'application/pdf' || (document.file_size || 0) > MAX_UPLOAD) {
        return send(chatId, t(lang, 'needPdf'), [[button(t(lang, 'btnCancel'), 'x')]]);
      }
      await saveEdit(link, telegramId, field, undefined, {id: document.file_id, name: document.file_name || 'resume.pdf', mime: 'application/pdf'});
    } else {
      const text = (message.text || '').trim();
      if (!text) return send(chatId, t(lang, 'needText'), [[button(t(lang, 'btnCancel'), 'x')]]);
      if (text.length > spec.max) return send(chatId, t(lang, 'tooLong', {max: spec.max}), [[button(t(lang, 'btnCancel'), 'x')]]);
      if (field === 'linkedin' && !LINKEDIN.test(text)) return send(chatId, t(lang, 'badLinkedin'), [[button(t(lang, 'btnCancel'), 'x')]]);
      await saveEdit(link, telegramId, field, text);
    }
    await setState(telegramId, null);
    return showMenu(chatId, lang, link, t(lang, 'saved'));
  }

  async function askEdit(chatId, telegramId, lang, link, field) {
    const spec = FIELDS[field];
    if (!spec) return;
    const card = JSON.parse(link.card || '{}');
    if (spec.kind === 'flag') {
      return send(chatId, t(lang, 'askFlag', {label: fieldLabel(lang, field)}),
        [[button(t(lang, 'btnYes'), `f:${field}:1`), button(t(lang, 'btnNo'), `f:${field}:0`)], [button(t(lang, 'btnCancel'), 'x')]]);
    }
    await setState(telegramId, `edit:${field}`);
    const current = field === 'name' ? link.name : field === 'nameEn' ? link.name_en : card[field];
    const prompt = spec.kind === 'photo' ? t(lang, 'askPhoto') : spec.kind === 'pdf' ? t(lang, 'askPdf')
      : t(lang, 'askText', {label: fieldLabel(lang, field), current: current ? String(current).slice(0, 300) : t(lang, 'empty')});
    return send(chatId, prompt, [[button(t(lang, 'btnCancel'), 'x')]]);
  }

  /* ------------------------------------------------------------ join requests */

  async function receiveJoin(chatId, telegramId, from, lang, state, data, message) {
    const text = (message.text || '').trim();
    if (!text) return send(chatId, t(lang, 'needText'), [[button(t(lang, 'btnCancel'), 'x')]]);
    if (state === 'join:name') {
      await setState(telegramId, 'join:number', {name: text.slice(0, 120)});
      return send(chatId, t(lang, 'joinNumber'), [[button(t(lang, 'btnCancel'), 'x')]]);
    }
    if (state === 'join:number') {
      await setState(telegramId, 'join:note', {...data, number: text.slice(0, 20)});
      return send(chatId, t(lang, 'joinNote'), [[button(t(lang, 'btnSend'), 'j:send')], [button(t(lang, 'btnCancel'), 'x')]]);
    }
    return finishJoin(chatId, telegramId, from, lang, {...data, note: text.slice(0, 1000)});
  }

  async function finishJoin(chatId, telegramId, from, lang, data) {
    await db.prepare(`INSERT INTO join_requests (telegram_id, telegram_username, name, student_number, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(telegramId, (from.username || '').toLowerCase() || null, data.name, data.number || null, data.note || null, now()).run();
    await setState(telegramId, null);
    return send(chatId, t(lang, 'joinSent'));
  }

  /* ------------------------------------------------------------ anonymous conversations */

  async function startContact(chatId, telegramId, lang, profileId) {
    const target = await db.prepare(`SELECT p.id, p.name, p.name_en, l.telegram_id, l.accepts_messages
      FROM profiles p JOIN links l ON l.profile_id = p.id WHERE p.id = ? AND p.published = 1`).bind(profileId).first();
    if (!target || !target.accepts_messages) return send(chatId, t(lang, 'contactUnavailable'));
    if (target.telegram_id === telegramId) return send(chatId, t(lang, 'contactSelf'));
    const blocked = await db.prepare('SELECT 1 AS b FROM blocks WHERE recipient_id = ? AND sender_id = ?').bind(target.telegram_id, telegramId).first();
    if (blocked) return send(chatId, t(lang, 'contactBlocked'));
    await setState(telegramId, 'compose', {profileId});
    return send(chatId, t(lang, 'contactIntro', {name: lang === 'en' && target.name_en ? target.name_en : target.name}), [[button(t(lang, 'btnCancel'), 'x')]]);
  }

  async function conversationKeyboard(conversation, viewerId) {
    const lang = await langOf(viewerId);
    const rows = [[button(t(lang, 'btnReply'), `r:${conversation.id}`)]];
    const viewerIsSender = viewerId === conversation.sender_id;
    const revealed = viewerIsSender ? conversation.sender_revealed : conversation.recipient_revealed;
    const second = [];
    if (!revealed) second.push(button(t(lang, 'btnReveal'), `v:${conversation.id}`));
    if (!viewerIsSender) second.push(button(t(lang, 'btnBlock'), `b:${conversation.id}`));
    if (second.length) rows.push(second);
    rows.push([button(t(lang, 'btnClose'), `c:${conversation.id}`)]);
    return rows;
  }

  // Copies the message to the other side (copyMessage hides the sender) under a short header.
  async function relay(chatId, fromId, lang, conversation, message, isFirst) {
    const toId = fromId === conversation.sender_id ? conversation.recipient_id : conversation.sender_id;
    const toLang = await langOf(toId);
    let header;
    if (fromId === conversation.recipient_id) {
      const profile = await db.prepare('SELECT name, name_en FROM profiles WHERE id = ?').bind(conversation.profile_id).first();
      header = t(toLang, 'incomingFromGraduate', {name: toLang === 'en' && profile?.name_en ? profile.name_en : profile?.name || ''});
    } else {
      header = t(toLang, isFirst ? 'incomingNew' : 'incomingReply');
    }
    try {
      await send(toId, header);
      await tg.call('copyMessage', {
        chat_id: toId, from_chat_id: chatId, message_id: message.message_id,
        reply_markup: {inline_keyboard: await conversationKeyboard(conversation, toId)}
      });
    } catch (error) {
      return send(chatId, t(lang, 'contactUnavailable'));
    }
    await db.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').bind(now(), conversation.id).run();
    return send(chatId, t(lang, isFirst ? 'contactSent' : 'replySent'),
      fromId === conversation.sender_id ? await conversationKeyboard(conversation, fromId) : null);
  }

  async function receiveCompose(chatId, telegramId, lang, data, message) {
    const target = await db.prepare(`SELECT l.telegram_id, l.accepts_messages FROM links l JOIN profiles p ON p.id = l.profile_id
      WHERE l.profile_id = ? AND p.published = 1`).bind(data.profileId).first();
    await setState(telegramId, null);
    if (!target || !target.accepts_messages) return send(chatId, t(lang, 'contactUnavailable'));
    const blocked = await db.prepare('SELECT 1 AS b FROM blocks WHERE recipient_id = ? AND sender_id = ?').bind(target.telegram_id, telegramId).first();
    if (blocked) return send(chatId, t(lang, 'contactBlocked'));
    if (!(await countUsage(telegramId, 'message'))) return send(chatId, t(lang, 'contactLimit'));
    let conversation = await db.prepare(`SELECT * FROM conversations WHERE profile_id = ? AND sender_id = ? AND closed = 0
      ORDER BY last_at DESC LIMIT 1`).bind(data.profileId, telegramId).first();
    const isFirst = !conversation;
    if (!conversation) {
      if (!(await countUsage(telegramId, 'conversation'))) return send(chatId, t(lang, 'contactLimit'));
      const id = randomId(10);
      await db.prepare(`INSERT INTO conversations (id, profile_id, sender_id, recipient_id, created_at, last_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(id, data.profileId, telegramId, target.telegram_id, now(), now()).run();
      conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
    }
    return relay(chatId, telegramId, lang, conversation, message, isFirst);
  }

  async function conversationFor(id, telegramId) {
    const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
    if (!conversation || (conversation.sender_id !== telegramId && conversation.recipient_id !== telegramId)) return null;
    return conversation;
  }

  async function receiveReply(chatId, telegramId, lang, data, message) {
    await setState(telegramId, null);
    const conversation = await conversationFor(data.conversationId, telegramId);
    if (!conversation || conversation.closed) return send(chatId, t(lang, 'conversationGone'));
    if (telegramId === conversation.sender_id) {
      const blocked = await db.prepare('SELECT 1 AS b FROM blocks WHERE recipient_id = ? AND sender_id = ?').bind(conversation.recipient_id, telegramId).first();
      if (blocked) return send(chatId, t(lang, 'contactBlocked'));
    }
    if (!(await countUsage(telegramId, 'message'))) return send(chatId, t(lang, 'contactLimit'));
    return relay(chatId, telegramId, lang, conversation, message, false);
  }

  /* ------------------------------------------------------------ updates */

  async function onCallback(callback) {
    const telegramId = String(callback.from.id);
    const chatId = callback.message?.chat?.id ?? callback.from.id;
    const {lang} = await session(telegramId, callback.from);
    const data = String(callback.data || '');
    await tg.call('answerCallbackQuery', {callback_query_id: callback.id}).catch(() => {});
    const link = await linkOf(telegramId);

    if (data === 'x') {
      await setState(telegramId, null);
      return showMenu(chatId, lang, link, t(lang, 'cancelled'));
    }
    if (data === 'm:menu') return showMenu(chatId, lang, link);
    if (data === 'm:lang') {
      const next = lang === 'en' ? 'fa' : 'en';
      await db.prepare('UPDATE sessions SET lang = ? WHERE telegram_id = ?').bind(next, telegramId).run();
      return showMenu(chatId, next, link);
    }
    if (data === 'm:join') {
      if (link) return showMenu(chatId, lang, link);
      await setState(telegramId, 'join:name');
      return send(chatId, t(lang, 'joinName'), [[button(t(lang, 'btnCancel'), 'x')]]);
    }
    if (data === 'j:send') {
      const current = await session(telegramId, callback.from);
      if (current.state !== 'join:note') return showMenu(chatId, lang, link);
      return finishJoin(chatId, telegramId, callback.from, lang, current.data);
    }
    if (data === 'm:profile' && link) return showProfile(chatId, lang, link);
    if (data === 'm:edit' && link) return showFieldChooser(chatId, lang);
    if (data === 'm:msg' && link) {
      const next = link.accepts_messages ? 0 : 1;
      await db.prepare('UPDATE links SET accepts_messages = ? WHERE profile_id = ?').bind(next, link.profile_id).run();
      return showMenu(chatId, lang, {...link, accepts_messages: next}, t(lang, next ? 'messagesOn' : 'messagesOff'));
    }
    let match = /^e:(\w+)$/.exec(data);
    if (match && link) return askEdit(chatId, telegramId, lang, link, match[1]);
    match = /^f:(openToWork|mentoring):([01])$/.exec(data);
    if (match && link) {
      await saveEdit(link, telegramId, match[1], match[2] === '1');
      return showMenu(chatId, lang, link, t(lang, 'saved'));
    }

    match = /^([rvbc]):([a-z0-9]{10})$/.exec(data);
    if (match) {
      const conversation = await conversationFor(match[2], telegramId);
      if (!conversation || conversation.closed) return send(chatId, t(lang, 'conversationGone'));
      const otherId = telegramId === conversation.sender_id ? conversation.recipient_id : conversation.sender_id;
      const otherLang = await langOf(otherId);
      if (match[1] === 'r') {
        await setState(telegramId, 'reply', {conversationId: conversation.id});
        return send(chatId, t(lang, 'askReply'), [[button(t(lang, 'btnCancel'), 'x')]]);
      }
      if (match[1] === 'v') {
        const column = telegramId === conversation.sender_id ? 'sender_revealed' : 'recipient_revealed';
        await db.prepare(`UPDATE conversations SET ${column} = 1 WHERE id = ?`).bind(conversation.id).run();
        const name = [callback.from.first_name, callback.from.last_name].filter(Boolean).join(' ');
        const who = callback.from.username ? `${name} (@${callback.from.username})` : `${name} (tg://user?id=${telegramId})`;
        await send(otherId, t(otherLang, 'revealNotice', {who})).catch(() => {});
        return send(chatId, t(lang, 'revealed'));
      }
      if (match[1] === 'b' && telegramId === conversation.recipient_id) {
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO blocks (recipient_id, sender_id, created_at) VALUES (?, ?, ?)').bind(telegramId, conversation.sender_id, now()),
          db.prepare('UPDATE conversations SET closed = 1 WHERE recipient_id = ? AND sender_id = ?').bind(telegramId, conversation.sender_id)
        ]);
        return send(chatId, t(lang, 'blocked'));
      }
      if (match[1] === 'c') {
        await db.prepare('UPDATE conversations SET closed = 1 WHERE id = ?').bind(conversation.id).run();
        await send(otherId, t(otherLang, 'closedNotice')).catch(() => {});
        return send(chatId, t(lang, 'closed'));
      }
    }
    return showMenu(chatId, lang, link);
  }

  async function onMessage(message) {
    if (message.chat?.type !== 'private') return;
    const telegramId = String(message.from.id);
    const chatId = message.chat.id;
    const current = await session(telegramId, message.from);
    const {lang} = current;
    const text = (message.text || '').trim();

    if (text.startsWith('/start')) return handleStart(chatId, telegramId, message.from, lang, text.split(/\s+/)[1] || '');
    if (text === '/cancel') {
      await setState(telegramId, null);
      return showMenu(chatId, lang, await linkOf(telegramId), t(lang, 'cancelled'));
    }
    if (text === '/menu') return showMenu(chatId, lang, await linkOf(telegramId));
    if (text === '/privacy') return send(chatId, t(lang, 'privacy'));

    const state = current.state || '';
    if (state === 'compose') return receiveCompose(chatId, telegramId, lang, current.data, message);
    if (state === 'reply') return receiveReply(chatId, telegramId, lang, current.data, message);
    if (state.startsWith('join:')) return receiveJoin(chatId, telegramId, message.from, lang, state, current.data, message);
    if (state.startsWith('edit:')) {
      const link = await linkOf(telegramId);
      if (link && FIELDS[state.slice(5)]) return receiveEdit(chatId, telegramId, lang, link, state.slice(5), message);
      await setState(telegramId, null);
    }
    return showMenu(chatId, lang, await linkOf(telegramId), t(lang, 'unknown'));
  }

  async function handleUpdate(update) {
    if (typeof update.update_id === 'number') {
      const fresh = await db.prepare('INSERT OR IGNORE INTO seen_updates (update_id, seen_at) VALUES (?, ?)').bind(update.update_id, now()).run();
      if (!fresh.meta.changes) return;
      if (update.update_id % 50 === 0) {
        await db.prepare('DELETE FROM seen_updates WHERE seen_at < ?').bind(now() - 3 * 86400000).run();
      }
    }
    if (update.callback_query) return onCallback(update.callback_query);
    if (update.message) return onMessage(update.message);
  }

  /* ------------------------------------------------------------ notices from the site server */

  async function notifyEdit(edit, decision, note) {
    const lang = await langOf(edit.telegram_id);
    const label = fieldLabel(lang, edit.field);
    const text = decision === 'approved' ? t(lang, 'editApproved', {label})
      : t(lang, 'editRejected', {label, note: note ? `\n${note}` : ''});
    await send(edit.telegram_id, text).catch(() => {});
  }

  async function notifyJoin(request, decision) {
    const lang = await langOf(request.telegram_id);
    await send(request.telegram_id, t(lang, decision === 'accepted' ? 'joinAccepted' : 'joinRejected')).catch(() => {});
  }

  return {handleUpdate, notifyEdit, notifyJoin, announceToLineage, botUsername};
}
