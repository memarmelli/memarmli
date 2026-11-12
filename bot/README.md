# Melli Architect bot (@memar_mli_bot)

A Cloudflare Worker with a D1 database. It does three jobs:

- **Self-editing.** A graduate links their Telegram account to their profile and sends changes (text, photo, PDF résumé, open-to-work and mentoring flags, a note to the admins). Every change waits in the admin dashboard and goes live only after approval.
- **Anonymous contact.** The Contact button on a profile opens `t.me/memar_mli_bot?start=c_<id>`. The bot relays messages both ways with `copyMessage`, so neither side sees the other's account unless they press "Reveal my identity". Recipients can block a sender or close the conversation. Only graduates who turned on "Accept messages" get the button.
- **Join requests.** People with no profile can ask to be added; the admin accepts (a draft profile is created and linked) or rejects.
- **Lineage news.** When a graduate connects, the nearest graduate of the same lineage before and after them (same last two digits of the student number) gets a message, if they are connected too. Graduates also hear when an admin approves or rejects their edits.

The site server (`server.py`) stays the source of truth. Every minute it pushes the profile list to the worker and pulls back links, pending edits and join requests. The Telegram account of a graduate never reaches the public site; `data.js` only gets a Contact link for people who opted in.

## How a graduate gets linked

In the admin, open the profile, then either:

- write their Telegram **@username** and tell them to send `/start` to the bot, or
- press **Create invite link** and send them the one-time link (for people without a username, or when the username is unknown).

## Setup (once)

Run these in `bot/`, logged in to the Cloudflare account that should own the bot.

```bash
npm install
npx wrangler login
npx wrangler d1 create melli-architect-bot
```

Copy `wrangler.example.toml` to `wrangler.toml` and paste the `database_id` that the last command printed. Set `SITE_URL` to the public address of the site if it has one.

```bash
npx wrangler d1 execute melli-architect-bot --remote --file=schema.sql
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put SYNC_SECRET
npm run deploy
```

Use long random values for the two secrets, for example from `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

Point Telegram at the worker (replace the three placeholders):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=<WORKER_URL>/telegram/webhook" -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" -d "allowed_updates=[\"message\",\"callback_query\"]" -d "drop_pending_updates=true"
```

Finally, add the link to `.env` next to `server.py` (or one folder up) and restart `run.bat`:

```
BOT_SYNC_URL=<WORKER_URL>
BOT_SYNC_SECRET=<the same value as SYNC_SECRET>
```

The admin dashboard then shows "connected" with the time of the last sync.

## Tests

```bash
npm test                                  # worker and bot logic, with a fake Telegram
python test/test_server_sync.py           # server.py against the worker, end to end
```

Both run offline. They need Node 22.5 or newer (for `node:sqlite`) and Python 3.10 or newer.

## Limits

- 60 relayed messages and 15 new conversations per sender per day.
- Résumé PDFs up to 10 MB; photos as Telegram photos or image files.
- Text fields have the same length limits as the admin form.
