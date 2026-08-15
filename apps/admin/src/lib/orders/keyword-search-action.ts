'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeOrderKeywordSearch } from '@pcm/domain';
// #365 片②:單值欄位的唯一讀法。
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import {
  ORDER_KEYWORD_COOKIE,
  ORDER_KEYWORD_FIELD,
  ORDER_KEYWORD_RETURN_TO_FIELD,
  encodeOrderKeywordCookie,
} from './order-keyword-cookie';

// keyword-search-action.ts — #347-2b:搜尋 / 清除搜尋的**唯一入口**(POST + PRG)。
//
// 🔴 **PRG 是紅線不是風格**(Q-a=B):搜尋詞不進 URL ⇒ 表單必須 POST;POST 之後必須 redirect,
//    否則員工按 F5 會重送整個 POST。這條與 A13b 的 PRG 改造同源
//    (`lib/orders/order-actions.ts:29` 那段 ⑤ 逐字寫過同一個理由)。
//
// 🔴 **清除搜尋走同一支**(主視窗 2026-08-10 裁決條件①):送空字串 ⇒ 刪 cookie ⇒ 同樣 redirect。
//    **不得**在前端做成 `router.replace` 之類的捷徑 —— 那會生出第二條語意不同、而且沒有人守的路徑。
//
// 🔴 **搜尋詞絕不落 log**:migration `20260809180000` 檔頭 `:50-74` 明令。
//    本檔連 `console.error` 都沒有 —— 不是忘了寫,是刻意的。無效輸入的處置見下方註解。

/**
 * PRG 的目的地:表單帶回來的**當下列表 URL**(已由呼叫端把 `page` 歸 1)。
 *
 * 🔴 為什麼要帶、而不是一律 `redirect('/orders')`:其他六個篩選軸(付款/出貨/來源/管道/
 * 單號/供應商單號)是 **URL 狀態**;固定導回 `/orders` = **搜尋一次就把篩選全洗掉**,
 * 正是 `order-list-view.ts` 那兩條 🔴 註警告過的同一個 fail-open 形狀,只是換了觸發點。
 *
 * 🔴 驗證 fail-closed 且**退回安全值**(照 `lib/customers/wallet-actions.ts` 的既有 returnTo 範式):
 * 不是站內 `/orders` 開頭、或含 `//` `://` 換行 ⇒ 一律當作 `/orders`。
 * 不擲錯的理由:此時 cookie 已經寫好了,擲錯只會讓員工看到錯誤頁而不知道搜尋到底生效沒有。
 */
function safeListReturnTo(raw: string | null): string {
  if (raw === null) return '/orders';
  // 🔴 控制字元與非 latin-1 一起擋(code-reviewer 2026-08-10 nit-6):它們不是 open-redirect
  //    ——那條被下面的前綴白名單擋死了——而是**會讓 `redirect()` 自己爆掉**:
  //    Node 對 header 值裡的這些字元擲 `ERR_INVALID_CHAR`,結果正是本函式上面那段說要避免的
  //    「cookie 已經寫好了、員工卻看到錯誤頁,不知道搜尋到底生效沒有」。
  if (raw.startsWith('//') || raw.includes('://')) return '/orders';
  if (/[\u0000-\u001f\u007f]/.test(raw) || /[^\u0000-\u00ff]/.test(raw)) return '/orders';
  if (raw !== '/orders' && !raw.startsWith('/orders?')) return '/orders';
  return raw;
}

// 🔴🔴 **本檔只能 export async function**(`'use server'` 模組的硬規定)。
//    兩個表單欄位名常數因此住在 `order-keyword-cookie.ts` —— 它們原本寫在這裡,
//    `next build` 直接紅:「The module has no exports at all」(Next 看到非函式 export
//    就把整個模組的 export 清空)。⚠️ **typecheck、lint、全套 6365 格測試全部沒抓到** ——
//    vitest 不執行 `'use server'` 的契約檢查 ⇒ 這條**只有 build 抓得到**,
//    正是鐵則 11「動 .ts/.tsx 一定要跑 build」存在的理由。
export async function applyOrderKeywordSearchAction(formData: FormData): Promise<void> {
  // 🔴 縱深防禦(code-reviewer 2026-08-10 nit-7):本檔原本是唯一不呼授權的 order server action。
  //    實害有限(它只寫呼叫者自己的 cookie),但 `lib/session/authorize.ts:12-16` 明文
  //    「安全縱深不只靠 proxy 登入閘」—— 例外會變成慣例,慣例會被下一支真的碰資料的 action 抄走。
  //    未授權 ⇒ 什麼都不做、直接導回列表(不擲錯:proxy 那層本來就會把未登入的人導去 SSO)。
  if ((await authorizeAdminMutation()) === null) redirect('/orders');

  // 🔴 #365 片②:兩欄都改走「`getAll()` 恰一筆」讀法。
  //    · 搜尋詞送兩份 ⇒ 讀成 null ⇒ `normalizeOrderKeywordSearch(null)` 回 `empty` ⇒ **刪 cookie**。
  //      這與「員工清空搜尋框」同一個出口,是本檔既有的 fail-closed 語意(見下方 else 分支註解):
  //      讀不出一個明確的搜尋詞時,寧可讓 chip 消失、列表回全部,也不要拿其中一份去查。
  //    · `return_to` 讀成 null ⇒ `safeListReturnTo` 退回 `/orders`(它本來就有這條 fallback)。
  const parsed = normalizeOrderKeywordSearch(readSingleString(formData, ORDER_KEYWORD_FIELD));
  const returnTo = safeListReturnTo(
    readSingleString(formData, ORDER_KEYWORD_RETURN_TO_FIELD),
  );
  const store = await cookies();

  if (parsed.kind === 'ok') {
    store.set(ORDER_KEYWORD_COOKIE, encodeOrderKeywordCookie(parsed.value), {
      httpOnly: true,
      sameSite: 'lax',
      // 本機 http 開發要讀得到;正式站一律只走 https。
      secure: process.env.NODE_ENV === 'production',
      // 🔴 `/orders` 而不是 `/`(code-reviewer 2026-08-10 nit-8):`/` 會讓這個帶 PII 的 cookie
      //    跟著**每一個** admin 請求送出(含 `/_next/*` 靜態資源)。目前唯一的讀取端就是訂單列表,
      //    收窄曝光面、行為零損失。⚠️ 日後有別的路由要讀它,記得同步放寬這裡。
      path: '/orders',
      // 🔴 **刻意不給 max-age = session cookie**(主視窗 2026-08-10 核准):
      //    搜尋詞可能含客人姓名,關掉瀏覽器就該消失,不在硬碟上長留。
    });
  } else {
    // `empty` = 使用者清空了搜尋框(或按 ✕);
    // `invalid` = 太長 / 含 NUL 之類 PG 與 JSON 收不下的字元。
    // 🔴 **兩者都刪 cookie**,理由是同一個:畫面上那個「目前搜尋」chip 是員工唯一看得到的狀態,
    //    留著一個查不動的舊詞會讓列表與 chip 說不同的話。
    //    ⚠️ 誠實界線:`invalid` 目前**不回饋訊息**(PRG 之後 state 就沒了,而結果碼要走 `?r=`
    //    這條 URL 通道 —— 那是 A13b 的命名空間,本片不擴)。實務上打得出 120 字以上或 NUL 的
    //    只有貼上一整段文字,而那時列表回全部訂單 + chip 消失,行為是「搜尋沒有生效」而不是騙人。
    //    要做明示訊息 = 另一片(需要先定 `?r=` 的碼)。
    // 🔴🔴 **必須帶 `path`,而且要與上面 `set` 的那個【逐字相同】** ——
    //    `delete(name)` 在 Next 展開成 `set({ name, value: '', expires: new Date(0) })`
    //    (`next/dist/compiled/@edge-runtime/cookies/index.js:302-305`,**開檔讀過**)
    //    ⇒ **完全不帶 `Path` 屬性**。瀏覽器依 RFC 6265 用 request-uri 算 default-path
    //    ⇒ 得到 `/`,而原 cookie 是 `Path=/orders` ⇒ **兩者不同 ⇒ 原 cookie 活著。**
    // 🔴 後果有兩層,第二層更毒:
    //    ① 員工按「清除搜尋」**沒有反應**(清單不變);
    //    ② `invalid`(太長 / 含 NUL)也走這個出口 ⇒ **fail-closed 其實沒有 closed** ——
    //       舊搜尋詞繼續生效,而**畫面顯示的搜尋詞與實際查詢的不是同一個**,
    //       那正是本檔下方註解逐字說「更糟」的那個形狀。
    // ⚠️ 本條由 codex 對抗審查 2026-08-16 指出於**客戶側**;**訂單側是同一個病、而且已經上線**
    //    ——finding 給的是症狀位置,不是病的邊界(house 教訓)。
    store.delete({ name: ORDER_KEYWORD_COOKIE, path: '/orders' });
  }

  // 🔴 `redirect()` 一定要在所有 try 之外(本檔沒有 try,但下一個人加的時候要記得):
  //    它是**擲 NEXT_REDIRECT** 來運作的,被 catch 吞掉會讓「已經寫好 cookie 的成功路徑」
  //    看起來像失敗(`lib/orders/note-actions.ts:28` 整段逐字寫過同一個坑)。
  //    目的地由表單帶回(`page` 已歸 1:換了搜尋條件還停在第 3 頁常常直接看到空白頁)。
  redirect(returnTo);
}
