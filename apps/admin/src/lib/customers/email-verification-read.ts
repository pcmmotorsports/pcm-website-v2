// email-verification-read.ts — 去 Auth 那一側取「這個客人驗證了沒」的原料(板 :437)。
//
// 🔴 **取數與判讀刻意分兩支檔**:判讀在 `email-verification.ts`,是**純函式**
//    ⇒ 三種帳號 × 三種狀態的組合**不需要一個資料庫就測得出來**。本檔只負責把三格原料拿回來。
//
// ⛔ ~~**一個【明說不修】的缺口(code-reviewer nit 6)**~~ —— 🔴 **這一段整段過期了, 兩處都是**
//    (R5 抓到:它與同檔下面的實作**直接矛盾**, 而矛盾的那一半沒有被劃掉):
//    ① ~~「明說不修」~~ ⇒ **已經修了** —— 下面用的是 `@pcm/schemas` 的 `isSyntheticEmailDomain`。
//    ② ~~「分類全靠 `app_metadata.pcm_provider`」~~ ⇒ **今天不只它** —— 改信箱那一片的資格閘
//       另外吃 GoTrue 的 `app_metadata.providers` / `identities`(見下面 `authProviders` 那一段)。
//    📌 **留著劃掉不刪**:下一個人要看得到「當初判它不修的理由長什麼樣」, 而那個理由後來被自己推翻。
//    ⛔ ~~原文如下~~:分類全靠 `app_metadata.pcm_provider`,而 `apps/storefront/src/lib/auth/line-admin.ts:65`
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

/**
 * 🔴 **寫入路徑專用的逾時 —— 而它與上面那個【刻意不同】**(codex R3 must-fix)。
 *
 * 上面那 1.5 秒是給**顯示**用的:一格附屬資訊慢了, 寧可印「讀不到」也不要卡住整張客人卡。
 * 🛑 而**資格閘是寫入路徑**:同一個 1.5 秒套上去 ⇒ GoTrue 只是「有點慢」的那一天,
 *    一個**正當的客服操作會在動手之前就被拒**, 而客人在電話上。
 * ⇒ 📌 **一個為「顯示可以放棄」而選的數字, 不可以拿去決定「操作可不可以做」。**
 * ⚠️ 5 秒是**選的, 不是量出來的** —— 我沒有 GoTrue 的延遲分布。標在這裡, 不假裝它有依據。
 */
export const MUTATION_READ_TIMEOUT_MS = 5_000;

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
            /** GoTrue 的身分清單。`app_metadata.providers` 缺席時的**第二來源**(見下)。 */
            identities?: { provider?: unknown }[] | null;
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
  /** 逾時毫秒。**寫入路徑要傳 `MUTATION_READ_TIMEOUT_MS`**(理由見那個常數的 docstring)。 */
  timeoutMs: number = READ_TIMEOUT_MS,
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
        timer = setTimeout(() => reject(new Error('auth_read_timeout')), timeoutMs);
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
    // 🔵 **GoTrue 標準欄 `app_metadata.providers`**(不是我們自訂的 `pcm_provider`)——
    //    這是改信箱那一片資格閘的第二個軸。**認不得就回 `null`**, 而 `null` 在下游是「擋」。
    //
    // 🔴🔴 **只認【完整清單】那一種形狀, 而且【每一格都要是字串】**(codex R2 must-fix 3)。
    //    兩個被打掉的舊寫法, 留著給下一個想「放寬一點」的人:
    // ```
    // ⛔ ~~`providers` 裡的非字串成員【過濾掉】~~
    //    ⇒ `['email', {provider:'google'}]` 會被濾成 `['email']` ⇒ **放行**
    //    ⇒ 📌 我把「我看不懂的東西」當成「不存在的東西」——而它正是那個 Google。
    // ⛔ ~~只有 `provider` 字串時包成單元素陣列~~
    //    ⇒ `provider` 是【主要那一個】, **它證不了沒有第二個**
    //    ⇒ 一個 `provider:'email'` 而 identities 裡還掛著 Google 的帳號會放行。
    // ```
    //    ✅ 現行:`providers` 必須在、必須是陣列、必須每一格都是字串 —— 任一條不成立 ⇒ `null`。
    //    ⛔ ~~「哪一天 GoTrue 不回這一欄, 那一片會對所有人顯示讀不到 ⇒ 功能等於關掉,
    //       而那是刻意選的方向」~~ —— 🔴 **R3 把那個方向反過來了**:那一欄在 auth-js 2.105.3
    //       **本來就是選填**(不是「哪一天」), 而「功能等於關掉」不是可以接受的代價
    //       ⇒ 已加 `identities` 後備。**舊字面留刪除線 —— 它與下面那段直接矛盾, 不能只留一半。**
    //    ⚠️ 這一格**不影響**畫面上的驗證狀態判讀 —— 那支分類器一個字都沒動。
    // 🔴🔴 **兩個來源, 而第二個是被 codex R3 逼出來的**:
    //    `app_metadata.providers` 在 auth-js **2.105.3** 的型別是 `providers?: string[]`
    //    ——【選填】(實查 `node_modules/.pnpm/@supabase+auth-js@2.105.3/…/lib/types.d.ts:354`)。
    //    ⇒ 📌 只認它的話, **一個完全正常的信箱帳號只要少了這一欄, 就永遠落進「讀不到」**
    //       ⇒ 而「重新整理再試一次」補不出 metadata ⇒ **這條救援路對他永久關閉**。
    //    ⇒ 🛑 那正是 memory `feedback_two-correct-guards-can-switch-the-feature-off` 那個形狀:
    //       兩道各自正確的保護合起來把功能關掉, **而只驗保護的話全綠**。
    // ✅ 第二來源 = `identities[].provider`(同檔 `:381` `identities?: UserIdentity[]`、
    //    `:307` `provider: string`)—— 它是**同一發 `getUserById` 就在手上**的東西, 不多一把鑰匙。
    // ⚠️ 兩個都拿不到 ⇒ 仍然 `null` ⇒ 擋。**方向沒有放寬, 放寬的是【拿得到的機率】。**
    const rawProviders: unknown = meta.providers;
    const fromMeta =
      Array.isArray(rawProviders) && rawProviders.every((v) => typeof v === 'string')
        ? (rawProviders as string[])
        : null;
    const rawIdentities = res.data.user.identities;
    const fromIdentities =
      Array.isArray(rawIdentities) &&
      rawIdentities.length > 0 &&
      rawIdentities.every((i) => typeof i?.provider === 'string')
        ? rawIdentities.map((i) => i.provider as string)
        : null;
    const authProviders = fromMeta ?? fromIdentities;
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
    return {
      confirmedAt: res.data.user.email_confirmed_at ?? null,
      provider,
      syntheticAddress,
      authProviders,
    };
  } catch {
    // 🔴 不接住 error 物件:Auth 的錯誤訊息可能夾帶那個 user 的內容(email 等 PII)。
    // 🔵 must-fix 2:~~原本這裡寫「`settle()` 會印它自己的那一行」~~ —— **那句是假的**:
    //    本函式從不 reject ⇒ 第六路恆為 fulfilled ⇒ `settle()` 的 `console.error` 走不到。
    //    ⇒ 所以出聲的責任在這裡,不在上游。
    console.warn(READ_FAILED_PREFIX + `整段拋出或逾時(${timeoutMs} ms)。畫面會顯示「讀不到」。`);
    return null;
  }
}
