// Thin Telegram Bot API client. TELEGRAM_API can point elsewhere for tests.

export class TelegramError extends Error {
  constructor(method, description, code) {
    super(`Telegram ${method} failed: ${description}`);
    this.code = code;
  }
}

export function telegramClient(env, fetchImpl = fetch) {
  const api = env.TELEGRAM_API || 'https://api.telegram.org';
  const token = env.TELEGRAM_BOT_TOKEN;

  async function call(method, payload = {}) {
    if (!token) throw new TelegramError(method, 'bot token is not configured', 0);
    const response = await fetchImpl(`${api}/bot${token}/${method}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!result.ok) throw new TelegramError(method, result.description || `HTTP ${response.status}`, result.error_code || response.status);
    return result.result;
  }

  // Downloads a file a user sent to the bot (Telegram allows up to 20 MB).
  async function download(fileId) {
    const file = await call('getFile', {file_id: fileId});
    const response = await fetchImpl(`${api}/file/bot${token}/${file.file_path}`);
    if (!response.ok) throw new TelegramError('download', `HTTP ${response.status}`, response.status);
    return {bytes: await response.arrayBuffer(), path: file.file_path};
  }

  return {call, download};
}
