import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * b5-identity-wiring-trigger.test.ts — E8-B **B5「admin 吃身分」的半落地觸發器**(機制,不是提醒)。
 *
 * ## 我守的是哪一刻(🔴 讀之前先看清楚,因為它比你以為的窄)
 *
 * `plan v4:218` 逐字:「**順序是硬的,不是建議**」。而那句話目前**沒有任何機制在守**。
 * B5 那一片(`plan v4` §4)要同時做三件事:payload 型別 + callback + `actor.ts` 改讀 session。
 * 🔴 **危險的不是「三件都沒做」(今天的狀態,一致、安全),是【只做了前面、沒做最後一件】**:
 *
 * ```
 * 票(session)裡已經帶著「他是誰」了      ← 前兩件做完
 * 而 actor.ts 還在讀使用者自己挑的 cookie  ← 最後一件沒做
 * ⇒ 稽核歸屬、授權閘 (authorize.ts:19-21 第③道) 用的仍然是【自選身分】
 * ⇒ 而畫面一切正常、三綠不紅、其他測試不紅
 * ⇒ 🔴 **那一刻所有人都會說「真登入上線了」,而系統其實還在信任使用者自己挑的那個人。**
 * ```
 * ⇒ **這一格就是在守那個半落地狀態。** 兩個訊號同時成立才紅。
 *
 * ## 🔴 我【守不到】什麼(誠實邊界,不要把我讀成比我大)
 *
 * ```
 * ❌ 我守不到「報價單那邊 B4 上線、開始送 sub」那一刻。
 *    理由:那一刻變的是【對面送來的資料】,而我方 repo 的型別與 code 一個字都不會動
 *    (exchange.ts:26-27 逐字寫了那是刻意的 expand 前向相容:「那個欄根本沒人讀 ⇒ 被忽略、照舊登入」)
 *    ⇒ **靜態測試看不到 runtime 才發生的事。** 要答那一題只能去報價單庫問(查法見本檔最下方)。
 * ❌ 我只看【原始碼字面】。有人用別的寫法達到同樣效果,我掃不到。
 * ❌ 我不驗授權對不對、不驗 session 簽得對不對。那是 session.test.ts / authorize.test.ts 的事。
 * ```
 *
 * ## 🔴 什麼時候該把我拿掉
 *
 * **B5 三件事都做完之後**(payload 帶身分 **且** `actor.ts` 改讀 session)——
 * 那時 `[3]` 那格會告訴你「可以刪了」。**刪掉本檔,不要留著當紀念**:
 * 一個永遠綠的觸發器會被下一個人讀成「這件事有人在守」,而它已經沒有對象了。
 */

const HERE = __dirname;

// ── 訊號 A:簽出去的票裡到底有沒有「他是誰」──────────────────────────────
//   量的是 `AdminSessionPayload` 這個 **interface 的本體**,不是整支檔 ——
//   🔴 整支檔搜 `sub` 會命中一大票註解與 `AdminSessionSub` 型別宣告(那個型別今天就存在、
//      而它【沒有被 payload 用到】)⇒ 用整支檔當分母會恆真,那就是一個沒有判別力的量具。
const PAYLOAD_IFACE_RE = /export interface AdminSessionPayload \{([\s\S]*?)\n\}/;

export function payloadCarriesIdentity(sessionSrc: string): boolean {
  const body = PAYLOAD_IFACE_RE.exec(sessionSrc)?.[1];
  if (body === undefined) {
    // 介面被改名或改寫成 type ⇒ 我量不到 ⇒ 🔴 回 true(fail-loud),不要靜靜回 false 假裝沒事。
    return true;
  }
  const code = body
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    .join('\n');
  return /\bsub\s*[?:]/.test(code) || /\bstaff_id\b/.test(code);
}

// ── 訊號 B:actor.ts 是不是還在讀「使用者自己挑的那顆 cookie」────────────────
export function actorStillReadsPickerCookie(actorSrc: string): boolean {
  return /store\.get\(ACTOR_COOKIE\)/.test(actorSrc);
}

/**
 * 純邏輯:兩個訊號 → 這格該不該紅。拆成純函式,是為了讓 `[2]` 能在**不動任何檔案**的情況下
 * 對著一個假造的「已經半落地」世界驗證斷言真的會失敗(量具要能表演給自己看)。
 */
export function evaluateB5Trigger(
  identityInTicket: boolean,
  actorReadsCookie: boolean,
): { ok: boolean; reason: string } {
  if (identityInTicket && actorReadsCookie) {
    return {
      ok: false,
      reason:
        '🔴 session 票裡已經帶著身分了,而 apps/admin/src/lib/session/actor.ts 還在讀使用者自己挑的 ' +
        'ACTOR_COOKIE —— 現在的系統會【看起來像真登入,而實際上仍然信任自選身分】。\n' +
        '下一步(照 plan v4 §4 的 B5,順序是硬的):\n' +
        '① 改 actor.ts 的 getSessionActor():改成從 verifySession 的 payload 取 sub.staff_id,' +
        '不要再讀 ACTOR_COOKIE\n' +
        '② 檢查 authorize.ts:19-21 第③道閘的語意有沒有跟著換(它現在擋的是「沒選人」)\n' +
        '③ sub.kind === "fallback" 沒有 staff_id ⇒ 那條路要照 B6 的「備援唯讀橫幅」處理,' +
        '不要讓它退回自選\n' +
        '④ 三件都做完之後,刪掉 b5-identity-wiring-trigger.test.ts(本檔)',
    };
  }
  return { ok: true, reason: '' };
}

const sessionSrc = readFileSync(resolve(HERE, 'session.ts'), 'utf8');
const actorSrc = readFileSync(resolve(HERE, 'actor.ts'), 'utf8');

describe('E8-B B5 身分接線觸發器', () => {
  it('[1] 現在:票裡沒有身分、actor 仍讀 picker cookie → 一致,綠(量到的,不是假設)', () => {
    const identityInTicket = payloadCarriesIdentity(sessionSrc);
    const actorReadsCookie = actorStillReadsPickerCookie(actorSrc);

    expect(
      identityInTicket,
      'AdminSessionPayload 已經帶身分欄了 —— B5 開始落地了。去看 evaluateB5Trigger 的清單,' +
        '確認 actor.ts 有沒有跟著改',
    ).toBe(false);
    expect(
      actorReadsCookie,
      'actor.ts 已經不讀 ACTOR_COOKIE 了 —— 如果票裡還沒有身分,那現在沒有任何東西在標「操作者是誰」',
    ).toBe(true);
    expect(evaluateB5Trigger(identityInTicket, actorReadsCookie).ok).toBe(true);
  });

  it('[2] 🔴 反面驗證:餵一個假的「半落地」世界,確認這格真的會紅(不是死斷言)', () => {
    const faked = evaluateB5Trigger(true, true);
    expect(faked.ok).toBe(false);
    expect(faked.reason).toContain('getSessionActor');
    expect(faked.reason).toContain('b5-identity-wiring-trigger.test.ts');
  });

  it('[3] 正向對照:B5 三件都做完(票帶身分 + actor 不讀 cookie)→ 不再紅,該刪掉本檔', () => {
    expect(evaluateB5Trigger(true, false).ok).toBe(true);
  });

  it('[4] 🔴 量具自檢:兩支掃描器對「該說有」與「該說沒有」要給不同答案', () => {
    // 訊號 A:餵一個帶身分欄的假 payload ⇒ 必須說「有」
    expect(
      payloadCarriesIdentity(
        'export interface AdminSessionPayload {\n  v: 1;\n  sub: { kind: "user"; staff_id: string };\n}',
      ),
    ).toBe(true);
    // 訊號 A:🔴 只在【註解】裡出現 sub ⇒ 必須說「沒有」(這正是今天 session.ts 的形狀)
    expect(
      payloadCarriesIdentity(
        'export interface AdminSessionPayload {\n  v: 1;\n  // 之後會加 sub: AdminSessionSub\n}',
      ),
    ).toBe(false);
    // 訊號 A:介面被改名 ⇒ 量不到 ⇒ fail-loud 回 true,不靜靜放行
    expect(payloadCarriesIdentity('export interface SomethingElse {\n  v: 1;\n}')).toBe(true);

    // 訊號 B 雙向
    expect(actorStillReadsPickerCookie('return await resolveStaff(store.get(ACTOR_COOKIE)?.value);')).toBe(true);
    expect(actorStillReadsPickerCookie('return await resolveStaff(payload.sub.staff_id);')).toBe(false);
  });
});

/*
 * 🔴 本檔守不到的那一題,要用這一發回答(唯讀,對【報價單】那個庫跑):
 *
 *   -- 報價單 B4 開始送 sub 了沒?
 *   select column_name from pg_catalog.pg_attribute ...   ← 看 sso_codes 有沒有長出身分欄
 *   -- 具名登入有沒有真的跑過一次(2026-08-20 17:49 實測 0 / 0 / 0,分母 auth.users=2):
 *   select (select count(*) from auth.sessions)                                   as sessions_now,
 *          (select count(*) from auth.refresh_tokens)                             as refresh_tokens_now,
 *          (select count(*) from auth.users where last_sign_in_at is not null)     as users_ever_signed_in;
 */
