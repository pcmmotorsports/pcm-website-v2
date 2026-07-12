import { describe, expect, it } from 'vitest';
import { decodeStateCookie, encodeStateCookie, newState, safeReturnTo } from './state';

const STATE = '0123456789abcdef0123456789abcdef';

describe('sso state', () => {
  it('newState = 32 hex, unique', () => {
    expect(newState()).toMatch(/^[0-9a-f]{32}$/);
    expect(newState()).not.toBe(newState());
  });

  describe('safeReturnTo', () => {
    it('accepts safe relative paths', () => {
      expect(safeReturnTo('/')).toBe('/');
      expect(safeReturnTo('/orders')).toBe('/orders');
      expect(safeReturnTo('/customers/list_1')).toBe('/customers/list_1');
    });

    it('rejects open-redirect / injection vectors → /', () => {
      expect(safeReturnTo('//evil.com')).toBe('/');
      expect(safeReturnTo('/\\evil.com')).toBe('/');
      expect(safeReturnTo('https://evil.com')).toBe('/');
      expect(safeReturnTo('/a@evil.com')).toBe('/');
      expect(safeReturnTo('/a?x=1')).toBe('/');
      expect(safeReturnTo('orders')).toBe('/');
      expect(safeReturnTo('/api/sso/start')).toBe('/'); // SSO 控制路徑 → 防登入迴圈 (nit-6)
      expect(safeReturnTo('/api/sso/callback')).toBe('/');
      expect(safeReturnTo(null)).toBe('/');
      expect(safeReturnTo(undefined)).toBe('/');
      expect(safeReturnTo('/' + 'a'.repeat(600))).toBe('/');
    });
  });

  describe('encode / decode', () => {
    it('round trips state + returnTo', () => {
      expect(decodeStateCookie(encodeStateCookie(STATE, '/orders'))).toEqual({ s: STATE, r: '/orders' });
    });

    it('sanitizes returnTo on encode (bad → /)', () => {
      expect(decodeStateCookie(encodeStateCookie(STATE, '//evil.com'))).toEqual({ s: STATE, r: '/' });
    });

    it('re-validates returnTo on decode (bad value bypassing encode → /)', () => {
      const crafted = Buffer.from(JSON.stringify({ s: STATE, r: '//evil.com' })).toString('base64url');
      expect(decodeStateCookie(crafted)).toEqual({ s: STATE, r: '/' });
    });

    it('rejects malformed / bad state → null', () => {
      expect(decodeStateCookie(undefined)).toBeNull();
      expect(decodeStateCookie('')).toBeNull();
      expect(decodeStateCookie('not-base64url-!!!')).toBeNull();
      expect(decodeStateCookie(Buffer.from(JSON.stringify({ s: 'short', r: '/' })).toString('base64url'))).toBeNull();
      expect(decodeStateCookie(Buffer.from(JSON.stringify({ r: '/' })).toString('base64url'))).toBeNull();
      expect(decodeStateCookie('x'.repeat(1100))).toBeNull();
    });
  });
});
