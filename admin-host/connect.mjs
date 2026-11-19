import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {allowed, decode, encode, maxBody} from './messages.mjs';

const address = 'wss://admin.memar-mli.ir/_archive/connection';
const secret = (await readFile(process.argv[2], 'utf8')).trim();
if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Missing connector credential');

function localRequest({method, path, headers}, body) {
  if (!allowed(method, path)) throw new Error('Unknown admin operation');
  const localHeaders = {Host: 'admin.memar-mli.ir', 'Content-Length': body.byteLength};
  for (const key of ['Origin', 'X-Melli', 'Content-Type', 'Cookie', 'CF-Connecting-IP']) {
    if (headers[key]) localHeaders[key] = headers[key];
  }
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port: 4173, path, method, headers: localHeaders}, res => {
      const chunks = [];
      let size = 0;
      res.on('error', reject);
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBody) res.destroy(new Error('Response too large'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        const headers = {};
        for (const key of ['content-type', 'content-disposition', 'set-cookie']) {
          const value = res.headers[key];
          if (value) headers[key] = Array.isArray(value) ? value[0] : value;
        }
        resolve({status: res.statusCode, headers, body: Buffer.concat(chunks)});
      });
    });
    req.setTimeout(55000, () => req.destroy(new Error('Local server timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function respond(socket, data) {
  const {meta, body} = decode(data);
  let result;
  try {
    result = await localRequest(meta, body);
  } catch {
    result = {status: 502, headers: {}, body: new Uint8Array()};
  }
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(encode({id: meta.id, status: result.status, headers: result.headers}, result.body));
  }
}

async function connect() {
  const socket = new WebSocket(address, {headers: {Authorization: 'Bearer ' + secret}});
  socket.binaryType = 'arraybuffer';
  let lastSeen = Date.now();
  let connected = false;
  let stopped = false;
  let finish;
  const ended = new Promise(resolve => { finish = resolve; });
  let probeFailures = 0;
  socket.addEventListener('open', () => { connected = true; });
  socket.addEventListener('message', ({data}) => {
    if (stopped) return;
    lastSeen = Date.now();
    if (data !== 'pong') respond(socket, data).catch(() => socket.close(1002, 'Invalid message'));
  });
  socket.addEventListener('close', finish, {once: true});
  socket.addEventListener('error', finish, {once: true});
  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > 90000) finish();
    else if (socket.readyState === WebSocket.OPEN) socket.send('ping');
  }, 30000);
  // A socket can still answer pings across a Worker rollout while application
  // messages time out. Exercise the same read-only route used by the login page.
  const probe = setInterval(async () => {
    if (!connected || stopped) return;
    try {
      const response = await fetch('https://admin.memar-mli.ir/api/session', {signal: AbortSignal.timeout(12000)});
      if (!response.ok || (await response.json()).authenticated !== false) throw new Error();
      probeFailures = 0;
    } catch {
      if (++probeFailures >= 2) finish();
    }
  }, 45000);
  try {
    await ended;
  } finally {
    stopped = true;
    clearInterval(heartbeat);
    clearInterval(probe);
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  }
  return connected;
}

let retry = 1000;
while (true) {
  const connected = await connect().catch(() => false);
  retry = connected ? 1000 : Math.min(retry * 2, 30000);
  await delay(retry);
}
