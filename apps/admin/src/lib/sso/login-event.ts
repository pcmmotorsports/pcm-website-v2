// login-event.ts — 把 SSO 登入事件寫進自家 DB(M-4b;Sean 2026-08-18 `Q04=乙` + 三個岔路全拍)。
//
// 🔴 **為什麼**:Vercel Hobby 的 runtime log 保留 = **1 小時**,而 log drain 要 Pro
//    ⇒ 出事那天要回答「誰、什麼時候、從哪裡登入了後台」,**一小時之後沒有任何地方查得到**。
//    `security-log.ts` 那半仍然照寫(它是那一小時內的軌跡),本檔加的是**留得住的那一半**。
//
// 🔴🔴 **為什麼是【一支函式同時做兩件】而不是讓呼叫端各叫一次**:
//    呼叫端有四處(`api/sso/callback/route.ts`)。若 console log 與 DB 寫入是兩個函式,
//    **下一個人加第五處失敗路徑時,很可能只叫其中一個** —— 而那時 DB 少一列**不會有任何東西紅**。
//    ⇒ 收成一個入口,讓「只做一半」在型別上就不成立。
//
// 🔴 **best-effort:絕不擋登入**。DB 掛掉 / 表還沒 apply / 權限不對 ⇒ 吞掉,登入照常完成。
//    (那張表 apply 之前,這裡每次都會吃一個 catch —— **那是預期的**,不是壞了。)
//
// 🔴 **PII**:`ip` / `user_agent` 是 PII。它們**只進 DB 那一列**,
//    **絕不進 console log、絕不進錯誤訊息、絕不進回應**(鏡像 PRD §7 對 email 的規則)。
//    ⇒ 本檔的 catch **連 error 物件都不留**(它可能帶著行內容)。
//
// @see supabase/migrations/20260818190000_m4b_admin_sso_login_events.sql
// @see docs/specs/2026-08-18-admin-login-events-to-own-db-draft.md §7
import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

import { logSsoLogin, type SsoLoginLogFields, type SsoLoginOutcome } from './security-log';

/** `user_agent` 落表上限(鏡像 `charge-actions.ts` 對 UA 的 1024 截斷)。 */
const UA_MAX = 1024;

/**
 * 只允許 IPv4 / IPv6 會用到的字元,長度 ≤ 45(IPv6 最長 45 字元)。
 *
 * 🔴 **這不是「驗它是合法 IP」,是「別把一個未驗證字串送進 DB」** ——
 *    `ip` 欄是 `inet`,PG 解析失敗會讓**整個 INSERT 失敗** ⇒ 那一列**整列不見**(連 outcome 都沒了)。
 *    ⇒ 形狀不對就送 `null`:**寧可少一個欄位,不要少一整列登入紀錄**。
 */
const IP_SHAPE = /^[0-9a-fA-F.:]{1,45}$/;

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
  if (!first || !IP_SHAPE.test(first)) return null;
  return first;
}

/**
 * 寫一筆登入事件:**先 console log(1 小時軌跡),再 best-effort 進 DB(留得住的那半)**。
 *
 * 呼叫端**只需要叫這一支**;它保證兩邊不會只做一半。
 */
export async function recordSsoLogin(
  outcome: SsoLoginOutcome,
  fields: SsoLoginLogFields,
  headers: Headers,
): Promise<void> {
  // ① 先寫 console —— 它不依賴 DB、不會失敗,而且是 DB 那半掛掉時唯一剩下的東西。
  logSsoLogin(outcome, fields);

  // ② 再寫 DB。🔴 整段包 try/catch:**登入結果優先**。
  try {
    // 🔴🔴 **窄 cast,而它有代價,代價寫在這裡**:
    //    `admin_sso_login_events` **還不在 `database.types.ts` 裡** —— 那份型別是從**正式庫**生成的,
    //    而這張表**還沒 apply**。⇒ 沒有 cast 就編不過。
    //    ⚠️ **代價 = 表名與欄名在這裡【不受型別把關】**(`SupabaseEmailOutboxAdapter` 檔頭記過同一件事:
    //       `#415` 拆掉窄 cast 之後,「把 `.from()` 或任一欄名加 `_TYPO` ⇒ tsc 當場紅」那個性質**才回來**)。
    //    ⇒ 在型別回來之前,**守門是下面那支測試裡逐字比對欄名的那一格**,不是編譯器。
    //    ⇒ **apply + 重生成 `database.types.ts` 之後,這個 cast 要拆掉**(拆了才有型別守門)。
    const client = createSupabaseServiceClient() as unknown as {
      from: (table: string) => { insert: (row: Record<string, unknown>) => Promise<unknown> };
    };
    await client
      .from('admin_sso_login_events')
      .insert({
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
  } catch {
    // 🔴 零 PII、零 log:連 error 物件都不接住 —— 接住了就會有人「順手」把它印出來,
    //    而 DB 的錯誤訊息會夾帶出事那一行的內容(= IP 與 UA)。
    //    ⚠️ 代價寫在這裡:**寫入失敗是【靜默】的。** 表還沒 apply、權限不對、DB 掛掉,
    //       症狀都一樣:console 那半照常有、DB 那半沒有列。
    //       ⇒ 判別法是**比對兩邊**(Vercel log 有幾筆 vs DB 有幾列),不是等某個告警。
    //       (要不要做那個告警是另一題,未立案;plan §4「這個草案不解決什麼」已列。)
  }
}
