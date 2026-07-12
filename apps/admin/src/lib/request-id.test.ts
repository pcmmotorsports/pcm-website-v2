import { describe, it, expect } from 'vitest';
import { generateRequestId, isSafeRequestId, REQUEST_ID_HEADER } from './request-id';

describe('request-id', () => {
  it('should expose the x-request-id header name', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
  });

  it('should generate a req_-prefixed uuid', () => {
    expect(generateRequestId()).toMatch(/^req_[0-9a-f-]{36}$/);
  });

  it('should generate a unique id each call', () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });

  describe('isSafeRequestId', () => {
    it('should accept generated ids and normal upstream ids', () => {
      expect(isSafeRequestId(generateRequestId())).toBe(true);
      expect(isSafeRequestId('vercel-abc-123')).toBe(true);
    });

    it('should reject injection / control chars / oversized / empty / nullish', () => {
      expect(isSafeRequestId('a\nb')).toBe(false);
      expect(isSafeRequestId('a b')).toBe(false);
      expect(isSafeRequestId('x'.repeat(201))).toBe(false);
      expect(isSafeRequestId('')).toBe(false);
      expect(isSafeRequestId(null)).toBe(false);
      expect(isSafeRequestId(undefined)).toBe(false);
    });
  });
});
