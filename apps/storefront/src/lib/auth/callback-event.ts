// callback-event.ts — 顧客站登入回呼的可查性紀錄(板 :395)。
//
// 🔴 **為什麼有這支檔**:`api/auth/line/callback/route.ts` 在本片之前【零落痕】。
//    2026-08-30 量(route 本體 + 它 import 的三支 lib):`console.` / `.insert(` / `.rpc(` 三個字集全 0;
//    正對照同檔 `redirect` ⇒ 7、`sanitizeNextParam` ⇒ 4(尺是活的)。
//    ⇒ 「查不到」同時代表【沒有人打過】與【全部都成功】,而那兩件事要分得開。
//    唯一的既有紀錄是 Vercel runtime log:保存 1 小時 + 要面板權限 ⇒ 當不了帳。
//
// 🔴🔴 **fail-open,而它與 tappay 的 fail-closed 相反 —— 理由寫在這裡讓人打**:
//    **記錄失敗【不得擋登入】。觀測不是閘。**
//    tappay 那條 fail-closed 因為它守的是錢;本片守的是「事後查得到」。
//    兩邊最壞情況差一個量級:漏記一次登入 = 少一列;擋掉一次登入 = **客人進不來**。
//    ⇒ 本檔**永不 throw**、永不回傳失敗給呼叫端(回 void),catch 一切。
//
// ⚠️ **而 fail-open 的代價要講出來,不是藏起來**:DB 掛掉 / RPC 沒 apply / 權限不對
//    ⇒ **那一列就是不見,而登入照常成功** ⇒ 症狀與「沒有人登入」一模一樣。
//    ⇒ 後備是 console.warn 的**固定前綴**(值班 grep 得到),而那只是【一小時的軌跡】,
//      不是帳。📌 **它買到的是「出事之後查得到」,不是「有人會被通知」** ——
//      全 repo 沒有任何告警接線在讀 console。
//
// 🔴 **零 PII**:只送 provider / outcome / reason_code。**連 state 的雜湊都不送了。**
//    · 原始 error **不落庫也不入 console 參數** —— 它可能夾帶 token / email / 上游 body。
//    · state 那一欄在 fable R3 之後整個拿掉了,理由在 migration 檔頭:
//      它原本要買的「重放看得見」構造不出來(cookie 第一發就刪),而它讓攻擊者
//      **鑄得出無限多把合法的鍵** ⇒ 一個買不到東西又開一個攻擊面的欄位,正確的數量是零。
//
// 🔴🔴 **本檔【不】自己 import `@pcm/adapters/server`,而那不是風格 —— lint 把我打紅過一次。**
//    `eslint.config.js` 對 `apps/storefront/**` 有整片禁令(ADR-0005 §6/§7:storefront 不得碰 service_role),
//    而例外是**一道一道登記**的:登記處就是那些 `// eslint-disable-next-line no-restricted-imports` 行
//    (數法寫在 `line-admin.ts` 檔頭那條 git grep 命令;2026-08-16 實跑 **4** 道)。
//    ⇒ 我第一版在這裡加了第五道 ⇒ **那是把一個要 Sean 拍板 + ADR 記錄的安全面,用一行註解自己批准掉。**
//    ⇒ 改成:**服務端能力由既有那道門(`line-admin.ts`)發出來**,而它發的不是原始 service_role client,
//      是一個**只做得到這一支 RPC** 的窄物件 ⇒ **門的數量**不變、登記表不說謊。
//      🔵 codex R5:~~這裡原本也寫了「爆炸半徑不變」~~ —— 那句是假的,**能力面確實變大了**;
//      不變的是 import 的門數與 server-only 邊界。詳 `line-admin.ts` 那支 factory 的註解。
//    📌 **一道守門被繞過去的時候,通常看起來像「我照著隔壁那個檔做」。**
//
// @see supabase/migrations/20260830130000_m4b_395_auth_callback_events.sql
import 'server-only';

import { createAuthCallbackEventClient } from './line-admin';

/**
 * 失敗原因的**封閉集**。
 *
 * 🔵 **codex R4 nit:~~舊字面說「DB 端 CHECK 是 `^[a-z0-9_]{1,64}$`(形狀)」~~ —— 已經不是了。**
 *    R1-9 之後 DB 那側也是**同樣這九個字的列舉**,兩層現在是**逐字相同的兩份清單**,
 *    由 `callback-event.reason-codes.test.ts` 交叉核釘住。
 *    📌 留著這段修正是刻意的:舊字面會讓下一個擴充的人以為「DB 收任意形狀」⇒ 只改這裡就上線
 *      ⇒ 而那條路的終點是 fail-open 把 DB 的拒絕吞掉,**那個 reason 從此零列而全綠**。
 *
 * ⚠️ **加一個新的 reason code = 要改三個地方**:本型別 / 下面 migration 的 CHECK /
 *    `reason-codes.test.ts` 的 `TS_REASONS`。少改任何一個,那支測試會紅(那是它存在的理由)。
 */
export type LineCallbackReason =
  | 'missing_code'          // LINE 端取消授權 / 根本沒帶 code
  | 'missing_state_param'   // query 沒有 state ⇒ 多半是有人直接打這個 endpoint
  | 'missing_state_cookie'  // cookie 不在(過期 / 被清 / 跨裝置)
  | 'missing_nonce_cookie'  // 同上,但少的是 nonce
  | 'state_mismatch'        // 兩邊都有而對不起來 ⇒ CSRF 候選
  | 'invalid_sub'           // line-admin:LINE user id 形狀不合法
  | 'collision_not_line'    // line-admin:防冒登入(同 email 已存在非 LINE 帳號)
  | 'session_verify_failed' // Supabase verifyOtp 回 error
  | 'upstream_error';       // LINE 換 token / 驗 id_token / 任一 throw

/**
 * 🔴 **這個型別就是那道門發出來的【能力】** —— 它做得到的事只有一件:呼叫這一支 RPC。
 * 拿到它的人**碰不到** `.from()` / `.auth` / 任何別的 service_role 面。
 *
 * 🔴 **而它同時是一個窄 cast,有明確退場條件**(家法:`products.ts:619`、`manual-customer-actions.ts:78`)。
 * `record_auth_callback_event` 還不在 `packages/adapters/src/supabase/database.types.ts` 裡
 * (數法 `grep -c 'record_auth_callback_event' <該檔>` ⇒ **0**,2026-08-30 量)——
 * 那份型別是 **apply 之後才重新生成**的。
 * ⇒ 📌 **退場條件寫死在這裡**:migration apply + 型別重生成之後,把 cast 換成生成型別,
 *   讓編譯器自己看得到欄名(同 `login-event.ts:176` 拆 cast 那一格的理由:
 *   拆完之後「打錯欄名會紅」這個性質**才回來**)。**而這個 interface 本身留著** —— 它不是為了補型別,
 *   是為了**限制那道門發出去的東西有多寬**。
 */
export interface AuthCallbackEventClient {
  /**
   * 🔵🔵 **codex R2-5(must-fix):方法【不收函式名】。**
   *    ~~上一版是 `rpc(fn, args)`,由呼叫端指定名稱~~ ⇒ 閉包只是藏住了 client,
   *    一句 `(createAuthCallbackEventClient() as any).rpc('別支_RPC', …)`
   *    就能用 service_role 叫**任何一支** RPC ⇒ **它擋的是型別,不是能力。**
   *    ⇒ 現在名稱**寫死在門那一側**,這裡只送參數 ⇒ 拿到它的人**叫不出第二支**。
   */
  record(args: {
    p_provider: 'line';
    p_outcome: 'success' | 'failure';
    // 🔵 **codex R1-10(must-fix)**:~~原本是 `string | null`~~ ⇒ 任何拿到 factory 的
    //    server 模組都能送一個自創原因碼進去,**TS 所稱的封閉集在門的出口就失效了**。
    //    ⇒ 釘成 `LineCallbackReason`。而 DB 那一側也從 regex 收成【九個列舉】(migration R1-9),
    //      **兩層漂開時 DB 會擋** —— 不是靠人記得同步改兩邊。
    p_reason_code: LineCallbackReason | null;
  }): PromiseLike<{ error: unknown }>;
}

/** 🔴 值班撈這一行用的**固定前綴**(整支檔只有這裡定義它)。 */
const RECORD_FAILED_PREFIX = '[auth.callback] 登入回呼紀錄沒寫成 —— ';

/** DB 寫入的硬逾時。登入是互動路徑,寫紀錄不值得讓客人多等(鏡像 `login-event.ts:40`)。 */
const DB_WRITE_TIMEOUT_MS = 1_500;

/**
 * 記一列登入回呼事件。**永不 throw、永不擋登入。**
 *
 * 🔴🔴 **supabase-js 的 `.rpc()` 失敗時【回傳 `{ error }`,不會 reject】**
 *    (與 `login-event.ts:107` 同一個坑)⇒ 只靠 catch 抓不到主要失敗路徑:
 *    函式不存在、權限不對、PostgREST 回錯 —— `await` 全部正常完成、`catch` 一次都不會跑。
 *    ⇒ 這裡**顯式檢查回傳值**。
 */
export async function recordLineCallbackEvent(
  outcome: 'success' | 'failure',
  reasonCode: LineCallbackReason | null,
): Promise<void> {
  try {
    const client = createAuthCallbackEventClient();
    const result = await Promise.race([
      client.record({
        p_provider: 'line',
        p_outcome: outcome,
        p_reason_code: reasonCode,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('db_write_timeout')), DB_WRITE_TIMEOUT_MS),
      ),
    ]);
    if (result?.error) {
      // 🔴 **不印 error 物件** —— PostgREST 的 message/details 會夾帶那一次呼叫的參數。
      //    只印固定句;要查是哪個世界,去 DB 那邊看物件在不在。
      console.warn(RECORD_FAILED_PREFIX + 'RPC 回了 error(函式未 apply / 權限 / PostgREST)。登入本身不受影響。');
    }
  } catch {
    // 🔴 逾時 / 網路斷 / client 建不起來 / 任何 throw。同樣只印固定句、不接住 error 物件。
    // ⚠️ `Promise.race` 逾時**不會取消底層那發 RPC** ⇒ 它可能稍後才寫成
    //    ⇒ **這一行的意思是「我沒等到確認」,不是「那一列不在」。**
    console.warn(RECORD_FAILED_PREFIX + '整段拋出或逾時。那一列可能不存在,也可能稍後才寫成。登入本身不受影響。');
  }
}
