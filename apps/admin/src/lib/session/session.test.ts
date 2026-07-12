import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSessionSecretConfigured,
  buildAdminSession,
  isFull2faSession,
  newSid,
  signSession,
  verifySession,
  type AdminSessionPayload,
} from './session';

const SECRET = 'test-admin-session-secret-0123456789abcdef';

describe('admin session', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = prev;
  });

  it('newSid = 32 hex, unique', () => {
    expect(newSid()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSid()).not.toBe(newSid());
  });

  it('sign → verify round trip', async () => {
    const p = buildAdminSession(['pwd', 'totp'], 1_700_000_000);
    const token = await signSession(p);
    expect(token).toBeTruthy();
    expect(await verifySession(token)).toEqual(p);
  });

  it('each build rotates sid', () => {
    const a = buildAdminSession(['pwd'], 1_700_000_000);
    const b = buildAdminSession(['pwd'], 1_700_000_000);
    expect(a.sid).not.toBe(b.sid);
  });

  it('tampered payload → null', async () => {
    const token = (await signSession(buildAdminSession(['pwd'], 1_700_000_000)))!;
    const dot = token.indexOf('.');
    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const badData = (data[0] === 'a' ? 'b' : 'a') + data.slice(1);
    expect(await verifySession(`${badData}.${sig}`)).toBeNull();
  });

  it('expired (exp <= now) → null', async () => {
    const token = await signSession(buildAdminSession(['pwd'], 1_700_000_000, -10));
    expect(await verifySession(token)).toBeNull();
  });

  it('missing secret: sign → null, verify → null (fail-closed)', async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    expect(adminSessionSecretConfigured()).toBe(false);
    expect(await signSession(buildAdminSession(['pwd'], 1_700_000_000))).toBeNull();
    expect(await verifySession('a.b')).toBeNull();
  });

  it('weak secret (<32 chars) treated as unset — fail-closed (MF5)', async () => {
    process.env.ADMIN_SESSION_SECRET = 'x'; // 弱值 → 視為未設
    expect(adminSessionSecretConfigured()).toBe(false);
    expect(await signSession(buildAdminSession(['pwd'], 1_700_000_000))).toBeNull();
  });

  it('token signed under a different secret → null', async () => {
    const token = await signSession(buildAdminSession(['pwd'], 1_700_000_000));
    process.env.ADMIN_SESSION_SECRET = 'a-totally-different-secret-value-xyz';
    expect(await verifySession(token)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession('')).toBeNull();
    expect(await verifySession('nodot')).toBeNull();
    expect(await verifySession('.sigonly')).toBeNull();
    expect(await verifySession('dataonly.')).toBeNull();
  });

  it('isFull2faSession: totp/recovery = true, pwd-only = false', () => {
    const base = { v: 1, sid: 'x', iat: 1, exp: 2, auth_time: 1 } as const;
    expect(isFull2faSession({ ...base, amr: ['pwd', 'totp'] } as AdminSessionPayload)).toBe(true);
    expect(isFull2faSession({ ...base, amr: ['pwd', 'recovery'] } as AdminSessionPayload)).toBe(true);
    expect(isFull2faSession({ ...base, amr: ['pwd'] } as AdminSessionPayload)).toBe(false);
  });
});
