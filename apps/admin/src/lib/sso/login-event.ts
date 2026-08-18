// login-event.ts — 把 SSO 登入事件寫進自家 DB(M-4b;Sean 2026-08-18 `Q04=乙` + 三個岔路全拍)。
//
// 🔴 **為什麼**:Vercel Hobby 的 runtime log 保留 = **1 小時**,而 log drain 要 Pro
//    ⇒ 出事那天要回答「誰、什麼時候、從哪裡登入了後台」,**一小時之後沒有任何地方查得到**。
//    `security-log.ts` 那半仍然照寫(它是那一小時內的軌跡),本檔加的是**留得住的那一半**。
//
// 🔴 **為什麼是【一支函式同時做兩件】**:呼叫端有 **5 處**(`api/sso/callback/route.ts`,4 失敗 + 1 成功)。
//    若 console log 與 DB 寫入是兩個函式,**下一個人加第六處時很可能只叫其中一個**,
//    而那時 DB 少一列**不會有任何東西紅**。
//    ⚠️ **它保證的是「依序嘗試兩邊」,不是「兩邊都成功」**(codex 關卡2 收窄我原本寫的
//    ~~「讓只做一半在型別上就不成立」~~ —— 那是假的:`logSsoLogin` 仍然 export 得出去,
//    別的檔照樣 import 得到;真正擋住繞道的是測試裡那格 source-contract,而它也有天花板,見該格註解)。
//
// 🔴 **best-effort:不讓寫紀錄拖垮登入**。DB 掛掉 / 表還沒 apply / 權限不對 ⇒ 吞掉,登入照常完成。
//    (那張表 apply 之前,這裡每次都會走失敗分支 —— **那是預期的**,不是壞了。)
//    ⚠️ **兩個保護是分開的**(codex 關卡2 R1 高1):
//      · console 那半**自己包 try/catch** —— ~~原本它在 try 外~~,它若 throw 會直接中斷 route。
//      · DB 那半**有硬逾時** —— ~~原本沒有~~;連線一直不結束時,五條路徑都會卡到平台把函式殺掉,
//        **成功路徑即使 session cookie 已經簽好,response 也送不出去**。
//    ⚠️ 逾時只**解開 route 的等待**,不保證底層連線被取消(那要 adapter 支援 abort signal)。
//
// 🔴 **PII**:`ip` / `user_agent` 是 PII。它們**只進 DB 那一列**,
//    **絕不進 console log、絕不進回應**(鏡像 PRD §7 對 email 的規則)。
//    ⚠️ **正確的說法是「不輸出那個錯誤」,不是「不進錯誤訊息」**(codex 關卡2:DB 的 error message
//      本來就可能夾帶整列資料,我們控制不了它的內容,只控制得了**不把它印出去**)。
//
// @see supabase/migrations/20260818190000_m4b_admin_sso_login_events.sql
// @see docs/specs/2026-08-18-admin-login-events-to-own-db-draft.md §7
import 'server-only';
import { isIP } from 'node:net';

import { createSupabaseServiceClient } from '@pcm/adapters/server';

import { logSsoLogin, type SsoLoginLogFields, type SsoLoginOutcome } from './security-log';

/** `user_agent` 落表上限(鏡像 `charge-actions.ts` 對 UA 的 1024 截斷)。 */
const UA_MAX = 1024;

/** DB 寫入的硬逾時。登入是互動路徑,寫紀錄不值得讓客人多等。 */
const DB_WRITE_TIMEOUT_MS = 1_500;

/**
 * 從 request headers 取來源 IP。
 *
 * 🔴🔴 **取哪一段是【app 層的決定】,而這個決定會影響鑑識結論** ——
 *    proxy 後面拿到的常常是一串(`client, proxy1, proxy2`),這裡取**第一段**。
 * ```
 * x-vercel-forwarded-for  ← Vercel 自己填的，最可信（優先）
 * x-forwarded-for         ← 🔴 客戶端可控：攻擊者可以自己塞一個假的
 * x-real-ip               ← 同上
 * ```
 * ⇒ **不要把這一欄讀成「這就是客人的 IP」。** 它是 best-effort 的鑑識線索,不是身分證據。
 *    (同一句話也寫在 migration 的 `COMMENT ON COLUMN`,兩處都寫是刻意的。)
 */
export function extractClientIp(headers: Headers): string | null {
  const raw =
    headers.get('x-vercel-forwarded-for') ??
    headers.get('x-forwarded-for') ??
    headers.get('x-real-ip');
  const first = raw?.split(',')[0]?.trim();
  // 🔴 **真的 parse,不是看字元**(codex 關卡2 R1 高3:~~原本只檢查字元集合~~,
  //    `999.999.999.999` / `::::` 這種**字元全合法而語法錯**的值會通過,
  //    然後讓 PG 的 `inet` 拒絕**整筆 INSERT** ⇒ 連 outcome 都遺失)。
  //    `node:net` 的 `isIP` 回 0 = 兩種都不是。
  if (!first || isIP(first) === 0) return null;
  // ⚠️ **驗過語法 ≠ 驗過真實性**:`x-forwarded-for` 是客戶端可控的,
  //    攻擊者可以送一個**語法完全合法的假 IP**。這一欄是鑑識線索,不是身分證據。
  return first;
}

/**
 * 🔴 **回傳值存在的理由:讓「DB 那半在期限內【確認成功了沒】」可觀測。**
 * ⚠️ **措辭要精準到這個地步**(codex 關卡2 R2):
 * ```
 * 'ok'        = 期限內【確認】寫成功
 * 'log_only'  = 期限內【沒有確認成功】 ← 🔴 不等於「DB 一定沒寫進去」
 *               逾時那一路尤其明顯：底層 insert 可能【逾時之後才成功】
 * ```
 * ⇒ 拿它當「這一筆沒進 DB」的依據會錯。它只能用來說「我沒等到確認」。
 *
 * 寫入失敗是**靜默**的(那是刻意的 PII 保護),而靜默的後果是:
 * **「有檢查 `{ error }`」與「沒檢查」在外部看起來一模一樣** —— 我實測過:
 * 把那道檢查整個拿掉,13 格測試**全綠**。
 * ⇒ 一個沒有任何可觀測差異的檢查,**它的測試必然是恆綠的**。
 * ⇒ 所以把結果回出來。呼叫端(route)可以繼續忽略它,而**測試分得出兩個世界**。
 */
export type SsoLoginRecordResult = 'ok' | 'log_only';

/**
 * 寫一筆登入事件:**先 console log(1 小時軌跡),再 best-effort 進 DB(留得住的那半)**。
 *
 * 呼叫端**只需要叫這一支**。
 * ⚠️ ~~「它保證兩邊不會只做一半」~~ **那句是假的**(codex 關卡2 R2 抓到的第八句):
 *    它保證的只有**依序嘗試兩邊** —— 任一邊仍可能失敗,而 DB 那邊失敗時**設計上就是只剩 console 那半**。
 */
export async function recordSsoLogin(
  outcome: SsoLoginOutcome,
  fields: SsoLoginLogFields,
  headers: Headers,
): Promise<SsoLoginRecordResult> {
  // ① console 那半。🔴 **自己包 try/catch**(codex 關卡2 R1 高1):它原本在 try 外,
  //    若 `console.info` 在某個 runtime 上 throw,整條登入路徑會被它中斷 —— 而它只是寫紀錄的。
  try {
    logSsoLogin(outcome, fields);
  } catch {
    // 連寫 log 都失敗就真的沒地方講了。登入照常。
  }

  // ② DB 那半。🔴 整段包 try/catch + **硬逾時**:登入結果優先。
  try {
    // ✅ **窄 cast 已拆**(2026-08-19,backlog `#652` 兩個條件都成立:表 apply 了、`database.types.ts` 重生成了)。
    //    ~~在型別回來之前,守門是測試裡逐字比對欄名那一格~~ ⇒ **現在編譯器自己看得到了**:
    //    把 `.from()` 或任一欄名加 `_TYPO` ⇒ `TURBO_FORCE=1 pnpm typecheck` 當場紅(拆完**當場表演過**)。
    //    (同一件事 `SupabaseEmailOutboxAdapter` 檔頭在 `#415` 記過:拆掉 cast 之後那個性質**才回來**。)
    const insert = createSupabaseServiceClient().from('admin_sso_login_events').insert({
      outcome,
      reason: fields.reason ?? null,
      amr: fields.amr ? fields.amr.join('+') : null,
      request_id: fields.requestId,
      source_app: 'quote',
      ip: extractClientIp(headers),
      user_agent: headers.get('user-agent')?.slice(0, UA_MAX) ?? null,
      // 🔴 **不送 `occurred_at`** —— DB 有 BEFORE INSERT trigger 無條件覆寫成 `now()`;
      //    送了也會被蓋掉。這裡不送,是為了讓「時間由 DB 決定」在**呼叫端**也讀得出來。
    });

    const result = await Promise.race([
      insert,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('db_write_timeout')), DB_WRITE_TIMEOUT_MS),
      ),
    ]);

    // 🔴🔴 **supabase-js 的 `.insert()` 失敗時【回傳 `{ error }`,不會 reject】**
    //    (codex 關卡2 R1 高2)⇒ ~~只靠 catch~~ 根本抓不到主要失敗路徑:
    //    表不存在、權限不對、PostgREST 回錯 —— `await` 全部正常完成,`catch` 一次都不會跑。
    //    ⇒ 這裡**顯式檢查回傳值**,把它導向同一條靜默失敗的路。
    if (result !== null && typeof result === 'object' && 'error' in result && result.error) {
      return 'log_only'; // 🔴 **不丟 error 物件**:它帶著 DB 給的內容(= 那一行的 IP 與 UA)
    }
    return 'ok';
  } catch {
    // 🔴 零 PII、零 log:連 error 物件都不接住 —— 接住了就會有人「順手」把它印出來,
    //    而 DB 的錯誤訊息會夾帶出事那一行的內容(= IP 與 UA)。
    //    ⚠️ 代價寫在這裡:**寫入失敗是【靜默】的。** 表還沒 apply、權限不對、DB 掛掉、逾時,
    //       症狀都一樣:console 那半照常有、DB 那半沒有列。
    //       ⇒ 判別法是**比對兩邊**(Vercel log 有幾筆 vs DB 有幾列),不是等某個告警。
    //       (要不要做那個告警是另一題,未立案;plan §4「這個草案不解決什麼」已列。)
    return 'log_only';
  }
}
