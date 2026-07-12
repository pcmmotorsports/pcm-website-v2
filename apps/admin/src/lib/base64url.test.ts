import { describe, expect, it } from 'vitest';
import { b64urlDecodeString, b64urlEncodeString, b64urlFromBytes, b64urlToBytes } from './base64url';

describe('base64url', () => {
  it('bytes round trip', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect(b64urlToBytes(b64urlFromBytes(bytes))).toEqual(bytes);
  });

  it('string round trip', () => {
    const s = '{"s":"abc","r":"/orders"}';
    expect(b64urlDecodeString(b64urlEncodeString(s))).toBe(s);
  });

  it('produces url-safe alphabet (no + / =)', () => {
    const out = b64urlFromBytes(new Uint8Array([251, 255, 254]));
    expect(out).not.toMatch(/[+/=]/);
  });

  it('throws on invalid input', () => {
    expect(() => b64urlToBytes('!!!')).toThrow();
  });
});
