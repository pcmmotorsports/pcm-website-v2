import { describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_MAX_AGE_SEC,
  SSO_CHAIN_MAX_AGE_SEC,
  buildAdminSession,
  ssoChainExpired,
  type AdminSessionPayload,
} from './session';

// B5-b′ 片二:票鏈絕對上限 + 15 分鐘 TTL。
//
// 🔴 **本組守的是「續期不能無限續」** —— 那是本片唯一的天花板。
//    片二讓 admin 自己重簽而不經報價單 ⇒ 報價單那側永遠不會再驗證他
//    ⇒ 沒有這道上限,**一張被偷的票可以永遠續下去**。

const COMMON = { amr: ['pwd'] as const, authTime: 1_700_000_000 };

describe('片二 · TTL 與票鏈上限', () => {
  it('[1] TTL 是 15 分鐘,而【上限】仍是 12 小時 —— 兩個不同的數', () => {
    // 🔴 這一格擋的是「順手把上限也改成 15 分鐘」——
    //    那會讓每個人每 15 分鐘被迫走一次完整 SSO, 而那不是本片的意思。
    expect(ADMIN_SESSION_MAX_AGE_SEC).toBe(60 * 15);
    expect(SSO_CHAIN_MAX_AGE_SEC).toBe(60 * 60 * 12);
    expect(SSO_CHAIN_MAX_AGE_SEC).toBeGreaterThan(ADMIN_SESSION_MAX_AGE_SEC);
  });

  it('[2] 新票的 sso_at = 現在;而 exp 只給 15 分鐘', () => {
    const now = Math.floor(Date.now() / 1000);
    const p = buildAdminSession([...COMMON.amr], COMMON.authTime, { kind: 'user', staff_id: 'sean' });
    expect(p.sso_at).toBeGreaterThanOrEqual(now - 2);
    expect(p.exp - p.iat).toBe(60 * 15);
  });

  it('[3] 🔴 續期要把 sso_at 【原封抄過去】—— 讓它重新開始 = 上限永遠不會到', () => {
    const chainStart = 1_700_000_000;
    const renewed = buildAdminSession([...COMMON.amr], COMMON.authTime, undefined, {
      ssoAt: chainStart,
    });
    expect(renewed.sso_at).toBe(chainStart);
    // 而 iat 是新的 —— 兩個欄位語意不同, 這一格順便釘住那個差別
    expect(renewed.iat).not.toBe(chainStart);
  });

  it('[4] 起點過了 12 小時 ⇒ 鏈到期(不得再續)', () => {
    const start = 1_700_000_000;
    const p = { ...buildAdminSession([...COMMON.amr], COMMON.authTime), sso_at: start };
    expect(ssoChainExpired(p, start + SSO_CHAIN_MAX_AGE_SEC)).toBe(true);
    expect(ssoChainExpired(p, start + SSO_CHAIN_MAX_AGE_SEC + 1)).toBe(true);
  });

  it('[5] ✅ 正對照:還沒到 12 小時 ⇒ 可以續(否則 [4] 在「永遠說到期」時也是綠的)', () => {
    const start = 1_700_000_000;
    const p = { ...buildAdminSession([...COMMON.amr], COMMON.authTime), sso_at: start };
    expect(ssoChainExpired(p, start + SSO_CHAIN_MAX_AGE_SEC - 1)).toBe(false);
    expect(ssoChainExpired(p, start + 60)).toBe(false);
  });

  it('[6] 🔴 缺 sso_at 的舊票(片一簽出的)⇒ 用它自己的 iat 當起點,不得當成「沒有上限」', () => {
    // 片一已經簽出去的 v:2 票沒有這個欄。若把 undefined 當成「不限」⇒ 那些票永遠續得下去。
    const iat = 1_700_000_000;
    const old = { v: 2, sid: 'a'.repeat(32), iat, exp: iat + 60, amr: ['pwd'], auth_time: iat,
      sub: { kind: 'user', staff_id: 'sean' } } as AdminSessionPayload;
    expect(old.sso_at).toBeUndefined();
    expect(ssoChainExpired(old, iat + SSO_CHAIN_MAX_AGE_SEC)).toBe(true);
    // ✅ 正對照:同一張舊票在上限之內仍然可續
    expect(ssoChainExpired(old, iat + 60)).toBe(false);
  });
});
