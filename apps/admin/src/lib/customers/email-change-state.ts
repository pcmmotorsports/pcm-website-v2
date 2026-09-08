// email-change-state.ts — 後台「改客人信箱」的結果碼 + **資格閘**(純函式、可單測)。
//
// Sean 2026-09-08 最終拍 A =【最簡單版】(memory `project_0908-sean-picks-minimal-email-fix`):
//   ✅ 只改 `auth.users`(登入用)+ `customers`(後台看的)+ 一行稽核
//   ⛔ 舊訂單的 `orders.notification_email` 不動 · `email_outbox.recipient_email` 不動
//   ⛔ 不撤 session、不做修復與對帳協定、不做批次
//
// 🔴 **本檔刻意零 import supabase / 零 server-only** —— 資格閘與文案要能不接 DB 就測得出來
//    (同 `email-verification.ts` 的分工:取數在別支、判讀在純函式)。

import type { EmailVerification } from './email-verification';

/**
 * 🔴 **結果碼全部帶 `customer_email_` 前綴。**
 * `result-banner.tsx` 的 `MESSAGES` 是 orders / products / customers **共用的一張表**,
 * 而 `denied` / `invalid` / `error` / `not_found` 這四個字面**已經被改單線用掉了**。
 * ⇒ 撞號在畫面上長得像「訊息偶爾會不對」(該檔 `manual_order_` 那一族的註解逐字記著這件事)。
 */
export type EmailChangeResultKind =
  | 'saved'
  | 'saved_audit_failed'
  | 'no_change'
  | 'denied'
  | 'invalid'
  | 'not_eligible'
  /** 🔴 與 `not_eligible` 分開:那一族是永久的, 這一顆是**現在讀不到**, 下一步相反。 */
  | 'unreadable'
  | 'taken'
  /** 🔴 Auth 那一發整段拋出(網路那一類 auth-js 是 throw 不是回 error)⇒ **不知道它套用了沒**。 */
  | 'auth_unknown'
  | 'not_found'
  /** 登入信箱改了、後台這一欄沒寫成, 而**重按會好**(權限沒開 / 暫時性)。 */
  | 'half_done'
  /** 登入信箱改了、後台這一欄**永遠寫不成**(撞到別人的 UNIQUE / 有人改成了第三個值)⇒ 不要重按。 */
  | 'half_done_stuck'
  | 'error';

export function emailChangeResultCode(kind: EmailChangeResultKind): string {
  return `customer_email_${kind}`;
}

/**
 * 🔵 GoTrue `app_metadata.providers` 裡代表「純密碼註冊」的那個值。
 * 其餘任何值(`google` / `apple` / …)= 這個帳號**不是靠信箱+密碼登入的**。
 */
const EMAIL_AUTH_PROVIDER = 'email';

/**
 * 🔴🔴 **資格閘 —— 本片的安全線。兩個軸都要過, 而它們答的是不同的問題。**
 *
 * ```
 * 軸一 kind(pcm_provider + 合成網域)  問「這個位址是不是我們自己編出來的」
 * 軸二 authProviders(GoTrue 標準欄)   問「這個帳號是不是靠【信箱+密碼】登入的」
 * ```
 *
 * 🔴 **軸二是被審出來的**(code-reviewer 與 codex 2026-09-08 各自獨立抓到, 我複驗過):
 * ```
 * Google 一鍵註冊是現行活路   LoginPage.tsx:192 signInWithOAuth({provider:'google'}) · :312「使用 Google 登入」
 * 而 pcm_provider 只有兩個寫入者  line-admin.ts:82 · manual-customer.ts:437(⚪ 負對照:現造字面 0 命中)
 * ⇒ Google 帳號 pcm_provider = undefined、email 是真 gmail ⇒ 合成網域判 false
 * ⇒ classifyEmailVerification 走到最後一行 ⇒ 【verified】⇒ 舊版白名單【放行】
 * ```
 * ⇒ 📌 **它不是「第七格 kind」, 它塌進白名單的第一格。**
 *    只有軸一的話, 客服會對一個 Google 帳號按下去 ⇒ 改掉 `auth.users.email`,
 *    而那個人的登入憑證是 Google identity ⇒ **要嘛毫無作用(而客服以為修好了),
 *    要嘛多出一條「用客服打進去的位址做密碼重設」的路** —— 兩個都不是本片要的。
 *    🛑 **哪一個成立我沒有量到**(要一台活的 GoTrue)⇒ 所以擋下, 不是挑一個賭。
 *
 * 🛑 **兩軸都寫成白名單, 不是「排除某幾種」**:排除式的話, 後來多出來的第三種
 *    (新的 kind / 新的 OAuth provider)會**預設放行**, 而新增一種是零訊號的動作。
 */
/**
 * 🔴 **`badge` 是給【最上面那一列 Email 旁邊】用的短標,而它與 `reason` 綁在同一個回傳值裡。**
 *    Sean 2026-09-09 拍甲:「這個客人的信箱能不能改」要在他問問題的地方(最上面那個 Email)
 *    就看得到 —— 而在此之前答案住在整頁最底下, 中間隔著兩張表單兩顆鈕。
 *    🎯 **他今晚做的就是這件事:他捲下去了, 然後回報「沒出現」。**
 *
 * 🔴🔴 **為什麼 `badge` 住在這裡, 不在畫面那一側自己拼**:
 *    上面那一列與下面那一區【叫同一支函式】⇒ 📌 **它們在結構上不可能講不同的話。**
 *    ⛔ 兩邊各判一次的話, 它們有機會各說各話, 而 diff 上看不出來
 *      —— 那正是本型別把「能不能改」與「為什麼不能」綁成一個值的同一個理由。
 *
 * 🛑 **`badge` 的詞彙不是新編的**, 逐格對著下面 `KIND_REASON` 與 provider 那句的字面收短:
 *    「不能改」對應 KIND_REASON 的「不能在這裡改信箱」;
 *    🔴 而 `unknown` / 讀不到那兩格用的是「**先不改**」不是「不能改」——
 *    因為那兩句的原文逐字是「**這不代表不能改**」⇒ 用同一個詞會把三態塌成兩態,
 *    而本檔上下都在防那件事。
 */
export type EmailChangeEligibility =
  | { allowed: true; badge: string }
  | { allowed: false; reason: string; badge: string };

const CHANGEABLE_KINDS: readonly EmailVerification['kind'][] = ['verified', 'unverified'];

/**
 * 🔴 **回傳把「能不能改」與「為什麼不能」綁成一個值**(舊版是兩支函式)——
 *    兩支的話,它們有機會各說各話,而 diff 上看不出來。
 *
 * @param kind          `classifyEmailVerification` 的結果
 * @param authProviders GoTrue `app_metadata.providers`;`null` / `undefined` = 讀不到 ⇒ 擋
 */
export function emailChangeEligibility(
  kind: EmailVerification['kind'],
  authProviders: readonly string[] | null | undefined,
): EmailChangeEligibility {
  // ── 軸一:這個位址是不是我們自己編出來的 ──
  if (!CHANGEABLE_KINDS.includes(kind)) {
    return { allowed: false, reason: KIND_REASON[kind], badge: KIND_BADGE[kind] };
  }
  // ── 軸二:這個帳號是不是靠信箱+密碼登入的 ──
  if (!authProviders || authProviders.length === 0) {
    return {
      allowed: false,
      reason:
        '現在讀不到這個帳號是用什麼方式登入的,所以不敢讓你改 —— 這不代表不能改。請重新整理再試一次;一直讀不到請找工程師。',
      // 🔴 「先不改」不是「不能改」—— 上面那句原文逐字「這不代表不能改」。
      badge: '讀不到 · 先不改',
    };
  }
  const nonEmail = authProviders.filter((p) => p !== EMAIL_AUTH_PROVIDER);
  if (nonEmail.length > 0) {
    return {
      allowed: false,
      reason: `這個客人是用${nonEmail.join(' / ')}登入的,不是用信箱密碼 —— 改了這裡不會改到他的登入方式,反而會讓兩邊對不起來。請他自己去那個平台改,或改用他原本的方式登入。`,
      // 🔵 provider 名字直接取自 `authProviders`, **不做任何對照表** ——
      //    一張表會在 GoTrue 多一種 provider 的那天靜靜地少一格, 而那天沒有東西會叫。
      badge: `${nonEmail.join(' / ')} 登入 · 不能改`,
    };
  }
  return { allowed: true, badge: '可以改 ↓' };
}

/**
 * 軸一四種擋門各自的話。**每一句說出【下一步】,不是只說「不行」**
 * (CLAUDE.md 記過:守門紅了沒有出路會被整支刪掉)。
 * 🔴 **四句兩兩不同,而測試釘住這件事** —— 共用文案的話,員工就分不出
 *    「永遠不能改」與「現在讀不到、等一下再試」,而那兩件事的下一步是相反的。
 *
 * 🔴 **寫成 `Record<kind, string>` 而不是 switch**:漏掉任何一格 ⇒ **typecheck 紅**
 *    (`Record` 的鍵是窮盡的)⇒ 新增第七格 kind 時,編譯器會在這裡叫。
 */
const KIND_REASON: Record<EmailVerification['kind'], string> = {
  // 這兩格走不到(上面白名單先過)—— 放空字串會讓「不小心走到」變成一句沉默,
  // 所以照樣寫一句話,而測試釘住它們是走不到的。
  verified: '',
  unverified: '',
  line: 'LINE 登入的客人不能在這裡改信箱 —— 他的信箱是系統照 LINE 帳號算出來的,改掉會讓他下次登入變成另一個新客人(舊訂單與儲值金會留在原本那個帳號)。',
  manual:
    '後台手動建立的客人不能在這裡改信箱 —— 那個佔位信箱同時是建單的防重複鍵,改掉會讓同一張表單再建出第二個帳號。',
  synthetic:
    '這個帳號用的是系統產生的位址,而我們認不出它是哪一種登入方式 —— 不確定改了會壞掉什麼,所以先不開放。請找工程師看一下。',
  unknown:
    '現在讀不到這個帳號的登入資料,所以不敢讓你改 —— 這不代表不能改。請重新整理再試一次;一直讀不到請找工程師。',
};

/**
 * 軸一四種擋門的**短標**, 一一對應上面 `KIND_REASON` 的長句。
 * 🔴 **寫成 `Record<kind, string>` 而不是 switch** —— 同 `KIND_REASON` 的理由:
 *    漏掉任何一格 ⇒ **typecheck 紅**(`Record` 的鍵是窮盡的)。
 * 🛑 `verified` / `unverified` 走不到(白名單先過), 而照樣寫一句話 ——
 *    放空字串會讓「不小心走到」變成畫面上一塊沉默的空白。
 */
const KIND_BADGE: Record<EmailVerification['kind'], string> = {
  verified: '可以改 ↓',
  unverified: '可以改 ↓',
  line: 'LINE 登入 · 不能改',
  manual: '後台建立 · 不能改',
  synthetic: '系統位址 · 不能改',
  // 🔴 這一格與上面三格【刻意用不同的詞】—— 見 `EmailChangeEligibility` 的 docstring。
  unknown: '讀不到 · 先不改',
};

/**
 * 🔵 擋下來的時候, 這一次到底該送哪一顆結果碼。
 * 🔴 **`unknown` 與其他三格分開** —— 前者「等一下再試」、後者「不要再試」,
 *    共用一顆碼就是把 `email-verification.ts` 花整段註解防的「三態塌成兩態」
 *    在結果碼這一層再長一次(codex nit 7 / code-reviewer nit 4)。
 * ⚠️ 軸二讀不到也走 `unreadable`(同一種「現在不知道」)。
 */
export function emailChangeBlockedCode(
  kind: EmailVerification['kind'],
  authProviders: readonly string[] | null | undefined,
): EmailChangeResultKind {
  if (kind === 'unknown') return 'unreadable';
  if (CHANGEABLE_KINDS.includes(kind) && (!authProviders || authProviders.length === 0)) {
    return 'unreadable';
  }
  return 'not_eligible';
}
