// email-verification-read.ts — 去 Auth 那一側取「這個客人驗證了沒」的原料(板 :437)。
//
// 🔴 **取數與判讀刻意分兩支檔**:判讀在 `email-verification.ts`,是**純函式**
//    ⇒ 三種帳號 × 三種狀態的組合**不需要一個資料庫就測得出來**。本檔只負責把三格原料拿回來。
//
// 🛑 **一個【明說不修】的缺口(code-reviewer nit 6)**:
//    分類全靠 `app_metadata.pcm_provider`,而 `apps/storefront/src/lib/auth/line-admin.ts:65`
//    自己點名有一種**孤兒**:`generateLink` 誤建出來的帳號 —— **合成信箱、而沒有 `pcm_provider`**
//    ⇒ 它會落進 `verified` / `unverified`,而客服可能照著那個合成信箱寄信。
//    ⚠️ **不修的理由不是它不重要,是修法本身有代價**:第二訊號要比對合成信箱的網域,
//    而那個網域常數住在 **storefront**(`lib/auth/line.ts`)—— admin 抄一份過來就是
//    **兩份會漂的字面**,而本 repo 反覆記過那個病。
//    ⇒ 📌 要修的話正解是把那個常數抽進 `packages/`,而那是另一片。**這裡標著,不假裝沒看到。**
//
// 🔴 **本檔【不新增任何權限】**:`auth.admin.getUserById` 在 admin 已經有人在用 ——
//    `apps/admin/src/lib/customers/manual-customer.ts:297`(手動建單查客人)、`:410`。
//    ⇒ 本片是**多一個讀取點**,不是多一把鑰匙。
//
// 🔵🔵 **code-reviewer must-fix 2 + 4(2026-08-30),兩條一起讀:**
// ```
// ② 我原本把所有失敗吞成 null ⇒ 那個 promise【恆為 fulfilled】
//    ⇒ load-customer-detail 的 settle() 那一行 console.error 對第六路是【死碼】
//    ⇒ ⇒ GoTrue 掛掉時：畫面印「讀不到」，而【全站零 log】
//    ⇒ ⇒ 🔴 這一片發明了 unknown 這一態，卻沒有人分得出它是「auth 掛了」還是「線沒接」
//    ⇒ 修法：失敗在【本檔】自己出聲（固定前綴、零 PII），不指望上游那一行。
// ④ 而「掛住」我一格都沒處理：getUserById 不回 ⇒ allSettled 無限等
//    ⇒ ⇒ 整張客人卡 + 訂單面板【一起白】
//    ⇒ ⇒ 🔴 我在 plan 裡寫的是「不得讓整張客人卡變錯誤頁」，而【永遠不出現】比錯誤頁差一級
//    ⇒ 修法：硬逾時（家法 callback-event.ts 那支同款 1.5 秒）。
// ```
// 📌 **兩條的共同形狀:我把「error 形狀」處理得很乾淨,然後以為那就是「失敗」的全部。**
//
// 🔴 **失敗回 `null`,而 `null` 的意思是【我沒讀到】,不是【他沒驗證】。**
//    呼叫端把 `null` 丟給 `classifyEmailVerification` ⇒ 得到 `unknown` 那一態。
//    ⚠️ 這一條是抄來的教訓:`app/api/sso/callback/route.ts:196` 逐字記著
//    「三種世界在這裡回**同一個 null**:查無此人 / 已停用 / **DB 讀不到**」
//    ⇒ 那一頁因此**兩種可能都要講**。本片不重蹈:讀不到自己一態。
import 'server-only';

import { createSupabaseServiceClient } from '@pcm/adapters/server';

import { isSyntheticEmailDomain } from '@pcm/schemas';

import type { EmailVerificationInput } from './email-verification';

/** 🔴 值班撈這一行用的**固定前綴**(整支檔只有這裡定義它)。 */
const READ_FAILED_PREFIX = '[admin/customers] Email 驗證狀態讀不到 —— ';

/** 硬逾時。客人卡是互動路徑,一格附屬資訊不值得讓它整頁卡住(家法 `callback-event.ts` 同款)。 */
const READ_TIMEOUT_MS = 1_500;

/** 本模組需要的 client 形狀(注入用;真身是 `createSupabaseServiceClient()`)。同 `manual-customer.ts:168` 的家法(`:163` 是那段註解、`:168` 才是型別)。 */
export type EmailVerificationClient = {
  auth: {
    admin: {
      getUserById: (id: string) => PromiseLike<{
        data: {
          user: {
            email?: string | null;
            email_confirmed_at?: string | null;
            app_metadata?: Record<string, unknown>;
          } | null;
        };
        error: unknown;
      }>;
    };
  };
};

/**
 * 取原料。**永不 throw** —— 這一路壞掉只能讓那一列顯示「讀不到」,
 * 不得讓整張客人卡變成錯誤頁(而 `loadCustomerDetail` 的 `allSettled` 是第二道)。
 *
 * 🔴 **只取三格,不把整個 auth user 帶回來** —— 那裡面有 PII,而判讀不需要看到它。
 */
export async function readEmailVerification(
  userId: string,
  injected?: EmailVerificationClient,
): Promise<EmailVerificationInput | null> {
  try {
    const client = injected ?? (createSupabaseServiceClient() as unknown as EmailVerificationClient);
    // 🔵 must-fix 4:硬逾時。`Promise.race` **不會取消底層那一發** ——
    //    它解開的是【這一頁的等待】,不是那個請求。而那正是這裡要的。
    // 🔵 **codex nit:輸的那一邊的 timer 要清掉。**
    //    ~~原版把 `setTimeout` 直接寫在 race 裡~~ ⇒ 成功路徑下那個 timer **還活著 1.5 秒**;
    //    一頁開很多張卡時就是一堆掛著的 timer。⇒ 存 handle、`finally` 清。
    // 🛑 **而它清不掉的那一半要講明**:`Promise.race` **不會取消底層那一發 Auth 請求** ——
    //    它解開的是【這一頁的等待】。Auth 掛住而有人連開 100 張卡 ⇒ 頁面都會回來,
    //    而那 100 個底層讀取仍然掛到 fetch 自己結束。**那是這個修法的天花板,不是 bug。**
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = await Promise.race([
      client.auth.admin.getUserById(userId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('auth_read_timeout')), READ_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    // 🔴 supabase-js 這一支失敗時**回 `{ error }`,不 reject**(同 `login-event.ts:107` 那個坑)
    //    ⇒ 只靠 catch 抓不到主要失敗路徑。
    if (res.error || !res.data.user) {
      // 🔵 must-fix 2:在【本檔】出聲。只印固定句 —— 不接 error 物件(它會夾帶那個 user 的 email)。
      console.warn(READ_FAILED_PREFIX + 'Auth 回了 error 或查無此 user。畫面會顯示「讀不到」。');
      return null;
    }
    const meta = res.data.user.app_metadata ?? {};
    const provider = typeof meta.pcm_provider === 'string' ? meta.pcm_provider : undefined;
    // 🔵 **code-reviewer nit 5**:~~原本是 `email_confirmed_at ?? null`~~ ——
    //    那讓【欄位根本不在】與【欄位是 null】變成同一件事,而前者是
    //    「我不認得這個回應的形狀」、後者是「他真的沒驗證」。
    //    ⇒ 欄位缺席 ⇒ 回 `null`(整個 input)⇒ 下游是 `unknown`,不是 `unverified`。
    //    ⚠️ GoTrue 今天**會**回這一欄 ⇒ 這是補一個缺口,不是修一個現行 bug。
    if (!('email_confirmed_at' in res.data.user)) {
      console.warn(READ_FAILED_PREFIX + 'Auth 回應裡沒有 email_confirmed_at 這一欄(形狀不認得)。');
      return null;
    }
    // 🔵 codex must-fix:合成信箱的判斷走 `@pcm/schemas` 既有那支(admin 已經在用),
    //    **不抄第二份網域字面**。而這裡只把【布林】往下傳 —— email 本身不離開本檔。
    const email = res.data.user.email;
    const syntheticAddress = typeof email === 'string' && isSyntheticEmailDomain(email);
    return { confirmedAt: res.data.user.email_confirmed_at ?? null, provider, syntheticAddress };
  } catch {
    // 🔴 不接住 error 物件:Auth 的錯誤訊息可能夾帶那個 user 的內容(email 等 PII)。
    // 🔵 must-fix 2:~~原本這裡寫「`settle()` 會印它自己的那一行」~~ —— **那句是假的**:
    //    本函式從不 reject ⇒ 第六路恆為 fulfilled ⇒ `settle()` 的 `console.error` 走不到。
    //    ⇒ 所以出聲的責任在這裡,不在上游。
    console.warn(READ_FAILED_PREFIX + '整段拋出或逾時(1.5 秒)。畫面會顯示「讀不到」。');
    return null;
  }
}
