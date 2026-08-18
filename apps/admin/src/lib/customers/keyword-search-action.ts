'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeOrderKeywordSearch } from '@pcm/domain';
import { readSingleString } from '../forms/single-value';
import { TIER_PARAM } from './customer-list-view';
import { authorizeAdminMutation } from '../session/authorize';
import {
  CUSTOMER_KEYWORD_COOKIE,
  CUSTOMER_KEYWORD_COOKIE_PATH,
  CUSTOMER_KEYWORD_FIELD,
  CUSTOMER_KEYWORD_RETURN_TO_FIELD,
  encodeCustomerKeywordCookie,
} from './customer-keyword-cookie';

// keyword-search-action.ts — `#525`:客戶搜尋 / 清除搜尋的**唯一入口**(POST + PRG)。
//
// 🔴 **PRG 是紅線不是風格**(`Q-a=B`):搜尋詞不進 URL ⇒ 表單必須 POST;
//    POST 之後必須 redirect,否則員工按 F5 會重送整個 POST。
//
// 🔴 **清除搜尋走同一支**:送空字串 ⇒ 刪 cookie ⇒ 同樣 redirect。
//    **不得**在前端做成 `router.replace` 之類的捷徑 —— 那會生出第二條語意不同、而且沒有人守的路徑。
//
// 🔴 **搜尋詞絕不落 log**:本檔連 `console.error` 都沒有 —— **不是忘了寫,是刻意的**
//    (migration 檔頭同一條:搜尋詞是 PII、不得落 server log)。
//
// ⚠️ **本檔只能 export async function**(`'use server'` 模組的硬規定)——
//    兩個表單欄位名常數因此住在 `customer-keyword-cookie.ts`。
//    訂單側 2026-08-10 實測踩過:多一個非函式 export,`next build` 直接紅
//    「The module has no exports at all」,而 **typecheck / lint / 全套測試都抓不到**。

/**
 * PRG 的目的地:表單帶回來的**當下列表 URL**(已由呼叫端把 `page` 歸 1)。
 *
 * 🔴 為什麼要帶、而不是一律 `redirect('/customers')`:
 * 會員等級篩選是 **URL 狀態**;固定導回 `/customers` = **搜尋一次就把篩選洗掉**。
 *
 * 🔴 驗證 fail-closed 且**退回安全值**(照訂單側與 `wallet-actions.ts` 的既有 returnTo 範式):
 * 不是站內 `/customers` 開頭、或含 `//` `://` 控制字元 ⇒ 一律當作 `/customers`。
 * **不擲錯**的理由:此時 cookie 已經寫好了,擲錯只會讓員工看到錯誤頁**而不知道搜尋到底生效沒有**。
 */
function safeListReturnTo(raw: string | null): string {
  if (raw === null) return '/customers';
  // 🔴 控制字元與非 latin-1 一起擋:它們不是 open-redirect(那條被下面的前綴白名單擋死了),
  //    而是**會讓 `redirect()` 自己爆掉** —— Node 對 header 值裡的這些字元擲 `ERR_INVALID_CHAR`,
  //    結果正是上面說要避免的「cookie 寫好了、員工卻看到錯誤頁」。
  if (raw.startsWith('//') || raw.includes('://')) return '/customers';
  if (/[\u0000-\u001f\u007f]/.test(raw) || /[^\u0000-\u00ff]/.test(raw)) return '/customers';
  if (raw !== '/customers' && !raw.startsWith('/customers?')) return '/customers';

  // 🔴🔴 **query 收窄成【鍵名白名單】,不是只驗前綴**(codex 對抗審查 2026-08-16,must-fix)。
  //    上一版只驗「以 `/customers` 開頭」⇒ `return_to=/customers?q=王小明` **原樣通過**,
  //    而它會被 `redirect()` 寫進 `Location` ⇒ **PII 進 URL / 瀏覽歷史 / access log / Referer**
  //    —— 那正是整個 cookie+PRG 設計唯一要防的那件事。
  // ⚠️ **我方 UI 送不出這種值**(`buildCustomerListHref` 只產 `tier` / `page`)——
  //    但那是「目前沒人這樣呼叫」,不是「呼叫了會被擋」。**紅線的守門不能建立在呼叫端的自律上。**
  // 🔴 白名單而非黑名單:黑名單要窮舉「什麼是 PII」,而白名單只要窮舉**我們自己會產生什麼**。
  const ALLOWED = new Set([TIER_PARAM, 'page', 'r']);
  const qs = raw.indexOf('?');
  if (qs !== -1) {
    for (const key of new URLSearchParams(raw.slice(qs + 1)).keys()) {
      if (!ALLOWED.has(key)) return '/customers';
    }
  }
  return raw;
}

export async function applyCustomerKeywordSearchAction(formData: FormData): Promise<void> {
  // 🔴 縱深防禦:本 action 只寫呼叫者自己的 cookie,實害有限 ——
  //    但 `lib/session/authorize.ts` 明文「安全縱深不只靠 proxy 登入閘」,
  //    **例外會變成慣例,慣例會被下一支真的碰資料的 action 抄走。**
  //    未授權 ⇒ 什麼都不做、直接導回列表(不擲錯:proxy 那層本來就會把未登入的人導去 SSO)。
  // 🔴 `#534`(2026-08-18 G2,主視窗裁定 + G6 撤回「刻意例外」標記):**帶上 `r=denied`,不要裸導回。**
  //    上面那段自陳(「只寫呼叫者自己的 cookie,實害有限」)講的是**資料面** ——
  //    而 `#534` 的病是**可用性面**:員工搜尋被擋、**畫面完全正常**,他以為自己搜過了。
  //    ⇒ **擋得對,而失敗看不見。** 那句自陳從頭到尾沒有在講可用性 ⇒ **不構成豁免**
  //      (`lib/orders/` 那支有一模一樣的自陳,而它已經被修掉了 —— 兩支同形狀不該兩種待遇)。
  //    ⚠️ 這一行**不改授權行為**(擋的還是同一件事、仍 fail-closed),只讓那個失敗**看得見**。
  //    🔴 而「送出訊息碼」與「畫面真的印出來」是兩件事 ⇒ 動手前先驗過後者:
  //      `app/customers/page.tsx:20/41/78` 本來就讀 `?r=` 並渲染 `<ResultBanner>`,
  //      `denied` 的字面在 `components/orders/result-banner.tsx:46`。**不是新機制,是接回既有那條。**
  if ((await authorizeAdminMutation()) === null) redirect(`/customers?r=denied`);

  // 🔴 兩欄都走「`getAll()` 恰一筆」讀法:
  //    · 搜尋詞送兩份 ⇒ 讀成 null ⇒ 正規化回 `empty` ⇒ **刪 cookie**。
  //      這與「員工清空搜尋框」同一個出口,是刻意的 fail-closed:
  //      **讀不出一個明確的搜尋詞時,寧可讓 chip 消失、列表回全部,也不要拿其中一份去查。**
  //    · `return_to` 讀成 null ⇒ `safeListReturnTo` 退回 `/customers`。
  const parsed = normalizeOrderKeywordSearch(readSingleString(formData, CUSTOMER_KEYWORD_FIELD));
  const returnTo = safeListReturnTo(
    readSingleString(formData, CUSTOMER_KEYWORD_RETURN_TO_FIELD),
  );
  const store = await cookies();

  if (parsed.kind === 'ok') {
    store.set(CUSTOMER_KEYWORD_COOKIE, encodeCustomerKeywordCookie(parsed.value), {
      httpOnly: true,
      sameSite: 'lax',
      // 本機 http 開發要讀得到;正式站一律只走 https。
      secure: process.env.NODE_ENV === 'production',
      // 🔴 `/customers` 而不是 `/`:`/` 會讓這個帶 PII 的 cookie 跟著**每一個** admin 請求送出
      //    (含 `/_next/*` 靜態資源)。目前唯一的讀取端就是客戶列表 ⇒ 收窄曝光面、行為零損失。
      //    ⚠️ 日後有別的路由要讀它,記得同步放寬這裡。
      path: CUSTOMER_KEYWORD_COOKIE_PATH,
      // 🔴 **刻意不給 max-age = session cookie**:搜尋詞可能含客人姓名/電話,
      //    關掉瀏覽器就該消失,不在硬碟上長留。
    });
  } else {
    // `empty`   = 使用者清空了搜尋框(或按 ✕)
    // `invalid` = 太長 / 含 NUL 之類 PG 與 JSON 收不下的字元
    // 🔴 **兩者同一個出口 = 刪 cookie**,而**不是**保留舊搜尋詞:
    //    保留的話,員工按了 ✕ 卻發現清單沒變,會以為系統壞了;
    //    而 `invalid` 保留舊值更糟 —— **畫面顯示的搜尋詞與實際查詢的不是同一個。**
    // 🔴🔴 **必須帶 `path`,而且要與上面 `set` 的那個【逐字相同】** ——
    //    `delete(name)` 在 Next 展開成 `set({ name, value: '', expires: new Date(0) })`
    //    (`next/dist/compiled/@edge-runtime/cookies/index.js:302-305`,**開檔讀過**)
    //    ⇒ **完全不帶 `Path` 屬性**。瀏覽器依 RFC 6265 用 request-uri 算 default-path
    //    ⇒ 得到 `/`,而原 cookie 是 `Path=/customers` ⇒ **兩者不同 ⇒ 原 cookie 活著。**
    // 🔴 後果有兩層,第二層更毒:
    //    ① 員工按「清除搜尋」**沒有反應**(清單不變);
    //    ② `invalid`(太長 / 含 NUL)也走這個出口 ⇒ **fail-closed 其實沒有 closed** ——
    //       舊搜尋詞繼續生效,而**畫面顯示的搜尋詞與實際查詢的不是同一個**,
    //       那正是本檔下方註解逐字說「更糟」的那個形狀。
    // ⚠️ 本條由 codex 對抗審查 2026-08-16 指出於**客戶側**;**訂單側是同一個病、而且已經上線**
    //    ——finding 給的是症狀位置,不是病的邊界(house 教訓)。
    store.delete({ name: CUSTOMER_KEYWORD_COOKIE, path: CUSTOMER_KEYWORD_COOKIE_PATH });
  }

  redirect(returnTo);
}
