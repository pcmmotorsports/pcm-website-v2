
//
// ⚠️⚠️ **2026-08-23:本檔守不到【上游】那個世界。**
//   本檔的訊號要求「**我們這邊已經動手到一半**」(欄已加而接線未換 / insert 已加鍵而表沒欄)。
//   🔴 而真正會發生的世界是相反的:**我們根本沒開始,而上游已經在送。**
//      那個世界裡本檔的訊號恆假 ⇒ **一聲都不會叫。**
//   📏 實據:`lib/sso/exchange.ts` 已經在解析、清洗、回傳 `sub`,而 `api/sso/callback/route.ts`
//      沒有把它帶進 session 或 login event ⇒ 報價單 B3/B4 一上線,`sub` 就會被丟掉。
//      ⚠️ ~~【靜默】丟掉~~ **同一顆 commit 之後不再是「靜默」的** ——
//         `identity-drop-trace` 會留下一行指名 `sub` 的痕。**丟棄本身仍未修**(仍併 B5-a)。
//   ✅ **那一半改由 `lib/sso/identity-drop-trace.ts` 守**(斷言的是**可觀測性**,不是結構)。
//   ⇒ **不要把「本檔存在」讀成「這條身分鏈被守著了」** —— 本檔只守我們自己做到一半那一種。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * login-event-identity-drop-fuse.test.ts — **稽核軌跡「身分寫不進去卻不出聲」的觸發器**(機制,不是提醒)。
 *
 * ## 背景(E-71 找到的,本檔複驗過座標後延伸)
 *
 * `callback/route.ts` 兩處呼叫 `recordSsoLogin(...)` 都只傳 `{ requestId, amr: result.amr }`,
 * 沒有帶 `result.sub`。這件事**已經有守門**了:
 * `apps/admin/src/lib/session/b5-identity-wiring-trigger.test.ts` 顧的是「session 票 + actor.ts」那條線。
 *
 * 🔴 **本檔顧的是另一條、b5 那支不管的線:稽核表**(`admin_sso_login_events`)。
 * 那張表(`supabase/migrations/20260818190000_m4b_admin_sso_login_events.sql:72-90`)
 * **完全沒有身分欄**(id/occurred_at/outcome/reason/amr/request_id/source_app/ip/user_agent,共 9 欄,零 staff_id)。
 * `SsoLoginLogFields`(`security-log.ts:11-17`)也只有 requestId/reason/amr,同樣零身分欄。
 *
 * ## 我守的是哪一刻(兩個訊號都成立才紅)
 *
 * ```
 * 訊號 A:login-event.ts 的 .insert({...}) 開始【嘗試】寫身分欄(例如加一行 staff_id: ...)
 * 訊號 B:而 admin_sso_login_events 這張表【仍然沒有】那個欄位
 * ⇒ ⇒ PostgREST 會回 column not found 的 error,而 recordSsoLogin() 對任何 DB error
 *      一律靜默降級成 'log_only'(login-event.ts:138-140,刻意的:PII 不外流)
 * ⇒ ⇒ 每一筆稽核紀錄都會【永遠】卡在 log_only,而症狀跟「DB 掛掉」「表還沒 apply」長得一模一樣
 *      ——沒有任何東西會紅,直到出事那天有人想從稽核表查「誰登入的」才發現查無此欄。
 * ```
 *
 * 今天:A 不成立(insert 物件裡沒有任何身分鍵)⇒ 不紅,這是一致、安全的現況。
 *
 * ## 🔴 我【守不到】什麼(誠實邊界)
 *
 * ```
 * ❌ 我不驗「DB 是否真的會因為多餘欄位報 column not found」——那是 PostgREST 的行為,
 *    我只驗【兩份原始碼字面對不對得起來】(insert 物件的鍵 vs migration 的欄名)。
 * ❌ 兩邊都是我手寫的正則,不是生成型別 —— 跟 login-event.test.ts 檔頭講的一樣:
 *    若兩邊剛好用同一個錯字改,我看不出來(schema 守門的天花板,見 login-event.test.ts 檔頭、backlog #652)。
 * ❌ 我不管 session 票 / actor.ts 那條線,那是 b5-identity-wiring-trigger.test.ts 的事。
 * ```
 *
 * ## 什麼時候該把我拿掉
 *
 * B5 身分落地、且 `admin_sso_login_events` 也補上對應欄位(migration + insert 同步)之後,
 * 訊號 A 與 B 都會成立、evaluateFuse 會判 armed=false(見 `[3]`)。屆時刪掉本檔,不要留著當紀念。
 */

const HERE = __dirname;
const loginEventSrc = readFileSync(resolve(HERE, 'login-event.ts'), 'utf8');
const migrationSrc = readFileSync(
  resolve(HERE, '../../../../../supabase/migrations/20260818190000_m4b_admin_sso_login_events.sql'),
  'utf8',
);

/** 剝掉 `//` 行註解與 `/* *\/` 區塊註解,避免「只在註解裡提過」被誤判成「真的有寫」。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const IDENTITY_KEY_RE = /\bstaff_id\b|\bsub\b/;

/** 訊號 A:`.insert({...})` 這個物件字面裡,有沒有出現身分鍵。 */
export function insertAttemptsIdentity(src: string): boolean {
  const body = /\.insert\(\{([\s\S]*?)\}\)/.exec(stripComments(src))?.[1];
  if (body === undefined) return true; // 掃不到 insert 物件 = 量具接不到檔 = fail-loud
  return IDENTITY_KEY_RE.test(body);
}

/** 訊號 B:`admin_sso_login_events` 的 `CREATE TABLE` 欄位清單裡,有沒有身分欄。 */
export function tableHasIdentityColumn(src: string): boolean {
  const body = /CREATE TABLE public\.admin_sso_login_events \(([\s\S]*?)\n\);/.exec(src)?.[1];
  if (body === undefined) return true; // 掃不到建表區塊 = 量具接不到檔 = fail-loud
  return /\bstaff_id\b/.test(body);
}

/** 兩訊號合成:JS 端試著寫身分欄,而 DB 端沒有那個欄 ⇒ 每次都靜默降級,武裝。 */
export function evaluateFuse(
  attemptsIdentity: boolean,
  hasColumn: boolean,
): { armed: boolean; reason: string } {
  if (attemptsIdentity && !hasColumn) {
    return {
      armed: true,
      reason:
        '🔴 login-event.ts 的 insert 物件已經在寫身分欄,而 admin_sso_login_events 這張表還沒有對應欄位 —— ' +
        'PostgREST 會回 column not found,recordSsoLogin() 對任何 DB error 一律靜默降級成 log_only ' +
        '(login-event.ts:138-140,刻意的 PII 保護)⇒ 每一筆稽核紀錄的身分欄永遠寫不進去,而且看起來跟 ' +
        '「DB 暫時掛了」一模一樣。\n' +
        '下一步:補一支 migration 幫 admin_sso_login_events 加上對應欄位(例如 staff_id text),' +
        '兩邊同一個 slice 一起做完,不要分兩片。',
    };
  }
  return { armed: false, reason: '' };
}

describe('稽核表(admin_sso_login_events)身分寫入 · 靜默降級觸發器', () => {
  it('[1] 現在:insert 沒有身分鍵、表也沒有身分欄 → 一致,綠(量到的,不是假設)', () => {
    const attemptsIdentity = insertAttemptsIdentity(loginEventSrc);
    const hasColumn = tableHasIdentityColumn(migrationSrc);

    expect(
      attemptsIdentity,
      'login-event.ts 的 insert 物件已經出現身分鍵了 —— 去看 admin_sso_login_events 有沒有跟著補欄位',
    ).toBe(false);
    expect(hasColumn, '表已經有身分欄了,而上面那格說 insert 還沒寫 —— 那就只是欄位閒置,不算武裝').toBe(
      false,
    );
    expect(evaluateFuse(attemptsIdentity, hasColumn).armed).toBe(false);
  });

  it('[2] 🔴 反面驗證:餵一個假的「JS 試著寫、DB 沒欄位」世界,確認這格真的會紅(不是死斷言)', () => {
    const faked = evaluateFuse(true, false);
    expect(faked.armed).toBe(true);
    expect(faked.reason).toContain('column not found');
    expect(faked.reason).toContain('log_only');
  });

  it('[3] 正向對照:兩邊都補齊(insert 寫身分欄 + 表有身分欄)→ 不再武裝', () => {
    expect(evaluateFuse(true, true).armed).toBe(false);
  });

  it('[4] 🔴 量具自檢:兩支掃描器對「該說有」與「該說沒有」要給不同答案', () => {
    // 訊號 A 雙向
    expect(insertAttemptsIdentity(".insert({\n  outcome,\n  staff_id: fields.sub?.staff_id,\n})")).toBe(
      true,
    );
    expect(insertAttemptsIdentity('.insert({\n  outcome,\n  amr,\n})')).toBe(false);
    // 🔴 只在註解裡提到 staff_id ⇒ 必須說「沒有」(這正是本檔今天的形狀之一:上面文件註解裡就寫了 staff_id)
    expect(
      insertAttemptsIdentity('.insert({\n  // 之後會加 staff_id\n  outcome,\n})'),
    ).toBe(false);
    // 掃不到 insert 物件 ⇒ fail-loud 回 true
    expect(insertAttemptsIdentity('const x = 1;')).toBe(true);

    // 訊號 B 雙向
    expect(
      tableHasIdentityColumn('CREATE TABLE public.admin_sso_login_events (\n  id uuid,\n  staff_id text\n);'),
    ).toBe(true);
    expect(
      tableHasIdentityColumn('CREATE TABLE public.admin_sso_login_events (\n  id uuid,\n  amr text\n);'),
    ).toBe(false);
    expect(tableHasIdentityColumn('CREATE TABLE public.something_else (\n  id uuid\n);')).toBe(true);
  });
});

// ── 🔴 **「提早退場」那一條(codex 2026-08-23 must-fix 4)**────────────────────────
//  `api/sso/callback/route.ts` 的 identity-drop trace **只掛 session 那一本**,
//  因為它看得到的 `loginEvent` 是**傳進去的參數**,不是本檔實際 `insert` 的那個物件。
//  🔴 **若 B5-a 只把 `sub` 加進呼叫端參數而忘了複製到 insert** ⇒ route 那道 trace 會**安靜下來**,
//     而 DB 仍然沒有身分 ⇒ **「安靜」會被讀成「已經好了」。**
//  ⇒ 本格接住那條路:**呼叫端契約一旦帶得動身分,`insert` 就必須把它抄過去。**
//  ⚠️ **限度**:它掃的是**原始碼字面**(`security-log.ts` 的欄位型別 + 本檔的 insert 物件字面)。
//     有人用展開運算子或變數組出那個物件 ⇒ 掃不到 ⇒ **本格會靜靜失去偵測力**,而不會紅。
describe('提早退場:呼叫端契約帶得動身分時,insert 必須跟著抄', () => {
  const securityLogSrc = readFileSync(resolve(HERE, 'security-log.ts'), 'utf8');

  it('🔴 前提:兩支原始碼都讀得到(讀不到 = 本組瞎了,不是通過)', () => {
    expect(securityLogSrc.length).toBeGreaterThan(0);
    expect(loginEventSrc.length).toBeGreaterThan(0);
  });

  it('SsoLoginLogFields 帶得動身分 ⇒ insert 物件字面也要有;兩邊要嘛都有、要嘛都沒有', () => {
    // ⚠️ 它是 `interface` 不是 `type`(2026-08-23 實測:寫成 `type` 的正規式當場 fail-loud 紅)。
    const fieldsType = /export interface SsoLoginLogFields \{([\s\S]*?)\n\}/.exec(securityLogSrc)?.[1];
    // 掃不到型別 ⇒ fail-loud(同本檔既有慣例:量具接不到檔就吵)
    expect(fieldsType, 'SsoLoginLogFields 掃不到 ⇒ 正規式與檔案已脫節').toBeDefined();
    const contractCarriesIdentity = /\bsub\b|\bstaff_id\b/.test(fieldsType ?? '');
    const insertCarriesIdentity = insertAttemptsIdentity(loginEventSrc);
    expect(
      insertCarriesIdentity,
      contractCarriesIdentity
        ? '🔴 呼叫端契約已經帶得動身分,而 insert 沒有抄過去 ⇒ **DB 會靜默丟掉它**,' +
          '而 route 那道 trace 會因為參數有值而安靜 ⇒ 看起來像做完了。'
        : '呼叫端契約還不帶身分,而 insert 卻有身分鍵 ⇒ 兩邊對不上,請人判。',
    ).toBe(contractCarriesIdentity);
  });
});
