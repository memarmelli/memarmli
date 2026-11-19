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
  socket.addEventListener('open', () => { connected = true; });
  socket.addEventListener('message', ({data}) => {
    lastSeen = Date.now();
    if (data !== 'pong') respond(socket, data).catch(() => socket.close(1002, 'Invalid message'));
  });
  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > 90000) socket.close();
    else if (socket.readyState === WebSocket.OPEN) socket.send('ping');
  }, 30000);
  try {
    await new Promise(resolve => {
      socket.addEventListener('close', resolve, {once: true});
      socket.addEventListener('error', resolve, {once: true});
    });
  } finally {
    clearInterval(heartbeat);
    if (socket.readyState === WebSocket.OPEN) socket.close();
  }
  return connected;
}

let retry = 1000;
while (true) {
  const connected = await connect().catch(() => false);
  retry = connected ? 1000 : Math.min(retry * 2, 30000);
  await delay(retry);
}
