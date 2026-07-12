// M-4a M0-S3 共用 base64url 編解碼(runtime-neutral:只用 btoa/atob + TextEncoder/Decoder,
//   絕不 import node:crypto/Buffer,故 session.ts〔crypto.subtle〕與 proxy〔可能 edge/node〕皆可安全引用)。
// 對齊報價單 lib/session.ts 已驗的 b64url 實作字面。

/** bytes → base64url 字串(無 padding)。 */
export function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url 字串 → bytes。非法輸入 throw(呼叫端以 try/catch 收斂為 fail-closed)。 */
export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** UTF-8 字串 → base64url。 */
export function b64urlEncodeString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}

/** base64url → UTF-8 字串。非法輸入 throw。 */
export function b64urlDecodeString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}
