import {DurableObject} from 'cloudflare:workers';
import {allowed, decode, encode, maxBody} from './messages.mjs';

const archive = 'https://memar-mli.ir';
const admin = 'https://admin.memar-mli.ir';
const connectorPath = '/_archive/connection';
const publicAsset = /^\/(?:admin\/(?:index\.html|admin\.(?:js|css))?|career\.js|assets\/(?:favicon\.svg|portrait-empty\.svg|melli-original\.png|(?:NotoKufiArabic-fa|KodeMono|Vazirmatn)\.woff2))$/;
const loginPath = path => path === '/api/session' || path === '/api/login';

function reply(status, message) {
  return Response.json({error: message}, {status, headers: {'Cache-Control': 'no-store'}});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== admin) return reply(404, 'Not found');
    if (url.pathname === '/' || url.pathname === '/admin') return Response.redirect(admin + '/admin/', 302);
    if (publicAsset.test(url.pathname) && ['HEAD', 'GET'].includes(request.method)) {
      return fetch(archive + url.pathname + url.search, {method: request.method});
    }
    const path = url.pathname;
    const origin = request.headers.get('Origin');
    const archiveLogin = loginPath(path) && origin === archive;
    if (path === connectorPath) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || !env.CONNECTOR_SECRET ||
          request.headers.get('Authorization') !== 'Bearer ' + env.CONNECTOR_SECRET) return reply(403, 'Forbidden');
    } else if (archiveLogin && request.method === 'OPTIONS') {
      return new Response(null, {status: 204, headers: {
        'Access-Control-Allow-Origin': archive, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Content-Type, X-Melli',
        'Vary': 'Origin'
      }});
    } else {
      if (!allowed(request.method, path)) return reply(404, 'Not found');
      if (!['HEAD', 'GET'].includes(request.method) &&
          ((origin !== admin && !archiveLogin) || request.headers.get('X-Melli') !== '1')) return reply(403, 'Forbidden');
      if (!loginPath(path) && !/(?:^|;\s*)melli_admin=[\w-]+(?:;|$)/.test(request.headers.get('Cookie') || '')) {
        return reply(path.startsWith('/uploads/') ? 404 : 401, 'Login required');
      }
    }
    const connection = env.ARCHIVE.getByName('melli-architect');
    const response = await connection.fetch(request);
    if (!archiveLogin) return response;
    const result = new Response(response.body, response);
    result.headers.set('Access-Control-Allow-Origin', archive);
    result.headers.set('Access-Control-Allow-Credentials', 'true');
    result.headers.set('Vary', 'Origin');
    return result;
  }
};

export class ArchiveConnection extends DurableObject {
  pending = new Map();
  media = {active: 0, limit: 3, waiting: []};
  edits = {active: 0, limit: 6, waiting: []};

  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === connectorPath) {
      const pair = new WebSocketPair();
      for (const previous of this.ctx.getWebSockets()) previous.close(1000, 'Reconnected');
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, {status: 101, webSocket: pair[0]});
    }
    const slots = path.startsWith('/uploads/') || path.endsWith('/file') || path === '/api/upload'
      ? this.media : this.edits;
    if (slots.active < slots.limit) slots.active++;
    else {
      if (slots.waiting.length >= 150) return reply(503, 'Server busy');
      await new Promise(resolve => slots.waiting.push(resolve));
    }
    try {
      const socket = this.ctx.getWebSockets().find(item => item.readyState === WebSocket.OPEN);
      if (!socket) return reply(503, 'ارتباط با سرور مدیریت برقرار نیست.');
      return await this.forward(request, path, socket);
    } finally {
      const next = slots.waiting.shift();
      if (next) next();
      else slots.active--;
    }
  }

  async forward(request, path, socket) {
    const limit = path === '/api/upload' ? 12000000 : 1000000;
    if (Number(request.headers.get('Content-Length')) > limit) return reply(413, 'Body too large');
    const chunks = [];
    let size = 0;
    if (request.body) {
      for await (const chunk of request.body) {
        size += chunk.byteLength;
        if (size > limit) return reply(413, 'Body too large');
        chunks.push(chunk);
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const id = crypto.randomUUID();
    const headers = {};
    for (const key of ['Origin', 'X-Melli', 'Content-Type', 'CF-Connecting-IP']) {
      if (request.headers.has(key)) headers[key] = request.headers.get(key);
    }
    const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)(melli_admin=[\w-]+)(?:;|$)/);
    if (cookie) headers.Cookie = cookie[1];
    let timer;
    try {
      const message = encode({id, method: request.method, path, headers}, body);
      return await new Promise((resolve, reject) => {
        this.pending.set(id, {resolve, socket});
        timer = setTimeout(() => resolve(reply(504, 'The admin server timed out')), 60000);
        try { socket.send(message); } catch (error) { reject(error); }
      });
    } finally {
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }

  webSocketMessage(socket, message) {
    const {meta, body} = decode(message);
    const call = this.pending.get(meta.id);
    if (call?.socket !== socket) return;
    const headers = new Headers({'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
                                 'X-Robots-Tag': 'noindex', 'X-Frame-Options': 'DENY'});
    for (const key of ['content-type', 'set-cookie', 'content-disposition']) {
      if (meta.headers[key]) headers.set(key, meta.headers[key]);
    }
    call.resolve(new Response(body.length ? body : null, {status: meta.status, headers}));
  }

  webSocketClose(socket, code, reason) {
    for (const call of this.pending.values()) {
      if (call.socket === socket) call.resolve(reply(503, 'Admin server disconnected'));
    }
    socket.close(code === 1006 ? 1000 : code, reason);
  }
}
