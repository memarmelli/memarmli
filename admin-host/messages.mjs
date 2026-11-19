// Carry the application's headers and file bytes in one WebSocket message.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
export const maxBody = 12 * 1024 * 1024;
const methods = {
  GET: /^\/(?:api\/(?:session|data|log|bot|bot\/edits\/\d+\/file)|uploads\/[a-f0-9]{24}\.(?:jpg|png|webp|pdf))$/,
  HEAD: /^\/uploads\/[a-f0-9]{24}\.(?:jpg|png|webp|pdf)$/,
  POST: /^\/api\/(?:login|logout|upload|students(?:\/bulk|\/[a-f0-9]{12}\/(?:thumb|invite))?|bot\/(?:sync|(?:edits|joins)\/\d+))$/,
  PUT: /^\/api\/(?:students\/[a-f0-9]{12}|cohorts\/\d{4})$/,
  DELETE: /^\/api\/students\/[a-f0-9]{12}(?:\/telegram)?$/
};

export function allowed(method, path) {
  return Object.hasOwn(methods, method) && methods[method].test(path);
}

export function encode(meta, body = new Uint8Array()) {
  const header = encoder.encode(JSON.stringify(meta));
  if (header.length > 8192 || body.byteLength > maxBody) throw new RangeError('Message too large');
  const wire = new Uint8Array(4 + header.length + body.byteLength);
  new DataView(wire.buffer).setUint32(0, header.length);
  wire.set(header, 4);
  wire.set(new Uint8Array(body.buffer ?? body, body.byteOffset ?? 0, body.byteLength), 4 + header.length);
  return wire;
}

export function decode(buffer) {
  const length = new DataView(buffer).getUint32(0);
  if (length > 8192 || length + 4 > buffer.byteLength || buffer.byteLength - length - 4 > maxBody) {
    throw new RangeError('Invalid message length');
  }
  const meta = JSON.parse(decoder.decode(new Uint8Array(buffer, 4, length)));
  return {meta, body: new Uint8Array(buffer, 4 + length)};
}
