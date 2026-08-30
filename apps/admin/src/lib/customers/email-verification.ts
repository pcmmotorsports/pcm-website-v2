// email-verification.ts — 後台客人明細的「Email 驗證狀態」判讀(板 :437 ⟦b4-AUTHMAIL1⟧)。
//
// 🔴 **這支檔存在的理由不是「多顯示一個欄位」,是【三種帳號的同一個欄位有三個意思】。**
//
// 起因:客人打電話說「我註冊了沒收到驗證信」,而後台看不到他驗證了沒。
// 🔵 **codex nit:數法必須帶【時點錨】,否則本檔自己會命中它。**
//   ~~原句寫 `git grep -l 'email_confirmed_at' -- 'apps/admin/src/**'` ⇒ 0 支~~
//   ⇒ 那條命令在**本片 commit 之後**會印 ≥1(命中的就是這幾支新檔)
//     ⇒ 讀的人會得到與結論**相反**的印象(= 早就有人在看驗證狀態了)。
//   ⇒ 正確的數法要錨在**本片之前**那一顆:
//     `git grep -l 'email_confirmed_at' <本片的父 commit> -- 'apps/admin/src/**'` ⇒ **0 支**
//     (負對照:同一顆上查 `zq7f3x9never_used_marker_15` ⇒ 0;
//      正對照:同一顆上查 `customers` ⇒ 109 支 ⇒ 尺是活的)
//   📌 **一個描述「我出生之前的世界」的數字,會被我的出生改掉,而那句話留在原地。**
//      (同型:`load-customer-detail.test.ts:24-33` 2026-08-27 已記過一次。)
//
// 🔴🔴 **而天真版(只看 `email_confirmed_at` 有沒有值)會【對兩種帳號說謊】**:
// ```
// LINE 登入   ⇒ 合成信箱（lineSyntheticEmail），從來不需要驗證
//              ⇒ 天真版顯示「已驗證」⇒ 客服以為那個信箱寄得到
// 後台手動建  ⇒ manual-customer.ts:368 `createUser({ email_confirm: true })`
//              ⇒ 出生就是已驗證，而那是【佔位信箱】
//              ⇒ 天真版顯示「已驗證」⇒ 客服照著那個地址寄，然後以為寄出去了
// ```
// 📌 **⇒ 一個「已驗證」的綠字,在三種帳號上是三個意思** ——
//    而把它們印成同一個字,就是把這一片要修的病(分不開)換個地方長出來。
//
// 🔴 **第三件:三態不得塌成兩態。**
//    「讀不到」**不是**「未驗證」。同型的坑 `apps/admin/src/app/api/sso/callback/route.ts:196`
//    逐字記著:`resolveActiveStaffById` 對「查無 / 已停用 / **DB 讀不到**」回**同一個 null**
//    ⇒ 那一頁因此**兩種可能都要講**。這裡照辦:讀不到自己一態,文案不含「未驗證」。
//
// 🔴 **本檔刻意是【純函式】** —— 不 import supabase、不 import server-only。
//    取數在 `load-customer-detail.ts`,判讀在這裡 ⇒ 三種帳號 × 三種狀態的組合
//    **不需要一個資料庫就測得出來**。

/** `app_metadata.pcm_provider` 的兩個具名值;一般 email 註冊【沒有這一欄】。 */
export const LINE_PROVIDER = 'line';
export const MANUAL_PROVIDER = 'manual';

/**
 * 判讀的輸入。**刻意收得很窄** —— 只收判得出結論的那三格,
 * 不收整個 auth user 物件(那裡面有 PII,而本檔不需要看到它)。
 */
export type EmailVerificationInput = {
  /** `auth.users.email_confirmed_at`。`null` = 沒驗證過。 */
  confirmedAt: string | null;
  /** `app_metadata.pcm_provider`;一般 email 註冊是 `undefined`。 */
  provider: string | null | undefined;
  /**
   * 這個帳號的信箱是不是**我們自己產的**(`*.pcmmotorsports.local`)。
   *
   * 🔵 **codex must-fix(2026-08-30):這一格是為了【沒有 `pcm_provider` 的孤兒】。**
   *    `apps/storefront/src/lib/auth/line-admin.ts:65` 自己點名有那種帳號
   *    (`generateLink` 誤建)⇒ 合成信箱、而 `app_metadata` 是空的
   *    ⇒ 只看 `provider` 的話它會落進 `verified`/`unverified`,而客服會照著那個位址寄信。
   * 🔴 **而我原本寫「不修,因為那個網域常數住在 storefront、抄過來會漂」—— 那個理由是假的**:
   *    判斷工具早就在 `@pcm/schemas`(`isSyntheticEmailDomain`),而 **admin 本來就在用它**
   *    (`lib/customers/customer-list-view.ts:62`)。⇒ 沒有第二份字面,不會漂。
   *    📌 **一個「修法有代價」的判斷,在我沒去查那個代價還在不在的時候,就只是一個藉口。**
   * ⚠️ 布林在**取數那一側**算好 ⇒ email 本身不進本檔(判讀不需要看到 PII)。
   */
  syntheticAddress: boolean;
};

/**
 * 判讀結果。**`kind` 是封閉集,而每一格都對應一句不同的話** ——
 * 沒有任何兩格共用文案,那是刻意的(共用文案 = 又把它們印成同一個字)。
 */
export type EmailVerification =
  /** 一般 email 註冊 + 已驗證。 */
  | { kind: 'verified' }
  /** 🔴 一般 email 註冊 + 沒驗證 —— **這一格才是客服在找的那個**。 */
  | { kind: 'unverified' }
  /** LINE 登入:合成信箱,不適用「驗證」這個概念。 */
  | { kind: 'line' }
  /** 後台手動建立:佔位信箱,出生就標已驗證 ⇒ 那個「已驗證」不代表信箱是真的。 */
  | { kind: 'manual' }
  /**
   * 🔵 **合成信箱,而【沒有】provider 旗標可以說明它是哪一種**(codex must-fix)。
   *    ⇒ 那個位址不是一個真的信箱 ⇒ 「已驗證 / 未驗證」兩句話對它都是誤導。
   */
  | { kind: 'synthetic' }
  /** 🔴 讀不到(Auth API 掛了 / 查無此 user)。**不是**「未驗證」。 */
  | { kind: 'unknown' };

/**
 * 判讀。**順序是承重的**:先問「這是哪一種帳號」,再問「驗證了沒」。
 *
 * 🔴 **反過來寫就是天真版**:先看 `confirmedAt` 有沒有值 ⇒ LINE 與手動兩種都會落進
 *    `verified` ⇒ 而它們的「已驗證」不是同一件事。
 *    ⇒ 📌 **這個 if 的順序不是風格,是這支檔的全部內容。**
 */
export function classifyEmailVerification(
  input: EmailVerificationInput | null,
): EmailVerification {
  // 讀不到 ⇒ 自己一態。呼叫端在 Auth API 失敗時送 `null` 進來。
  if (input === null) return { kind: 'unknown' };
  if (input.provider === LINE_PROVIDER) return { kind: 'line' };
  if (input.provider === MANUAL_PROVIDER) return { kind: 'manual' };
  // 🔵 codex must-fix:沒有旗標、而位址是我們自己產的 ⇒ 孤兒。
  //    這一格必須排在最後一行之前 —— 它接的正是「provider 認不出來」那個縫。
  if (input.syntheticAddress) return { kind: 'synthetic' };
  return input.confirmedAt === null ? { kind: 'unverified' } : { kind: 'verified' };
}

/**
 * 畫面文案。**五句兩兩不同,而測試釘住這件事** ——
 * 兩句一樣的話,那兩種帳號在畫面上就又分不開了。
 *
 * 🔴 `unknown` 那一句**刻意不含「未驗證」三個字**(測試用負對照釘住):
 *    客服照著畫面對客人講話,而「我們讀不到」與「你沒驗證」是兩句不同的話。
 */
export const EMAIL_VERIFICATION_LABEL: Record<EmailVerification['kind'], string> = {
  verified: '已驗證',
  unverified: '尚未驗證',
  line: 'LINE 登入(不需驗證)',
  manual: '後台建立(佔位信箱)',
  synthetic: '系統產生的位址(寄不到客人手上)',
  unknown: '讀不到(可能是系統暫時查不到,不代表客人沒驗證)',
};
