// verified-user.ts — 一個 request 內共用的【已驗證】使用者。
//
// 🔴 **為什麼有這支檔(codex `⑦` R2 nit)**:`#215` 之後首頁會跑到兩次 `getUser()` ——
//    一次解 tier、一次撈愛車 chips。我原本主張「不能合併,因為合併只能把 user 當參數傳進去,
//    而那正是本片剛修掉的形狀(tier 來源變成呼叫端說我是誰)」。
//    **那是一個假二選一。** 第三條路存在:把「去拿一個經過驗證的 user」這件事本身
//    做成 request-scoped 快取 ⇒ **信任來源沒有變**(仍是 `getUser()` 向 Auth 驗 token),
//    只是同一個 request 內不重複問。
//    📌 而這個 `cache()` 不是我發明的慣例:`apps/storefront/src/lib/products.ts` 已經在用。
//
// ⚠️ **限度(寫在這裡,免得被當成通用登入 helper)**:
//  · `cache()` 的作用域是**單一 request**(React server 端)。跨 request 不共用 ⇒ 不會有人拿到別人的身分。
//  · 它**不做授權判斷**,只回「Auth 說你是誰」。誰能看什麼由 RLS 與各自的查詢負責。
//  · 在 RSC 之外(例如單元測試)`cache()` 的記憶行為不保證 —— **測試請直接 mock 本模組**,
//    不要靠「呼叫兩次會拿到同一份」這件事。

import { cache } from 'react';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 🔴 **未登入的正常形狀是「`user` 為 null **而且** `error` 是 `AuthSessionMissingError`」** ——
 *    不是「`user` 為 null 且無 error」。
 *    📏 **量到的,不是推的**:`@supabase/auth-js@2.105.3` 的 `GoTrueClient.js` 逐字
 *    `return { data: { user: null }, error: new errors_1.AuthSessionMissingError() }`
 *    (`getUser()` 內「no access_token」那一支);官方判別式 `isAuthSessionMissingError`
 *    自己的實作就是 `isAuthError(error) && error.name === 'AuthSessionMissingError'`
 *    (`lib/errors.js`)。⇒ 我們比對同一個 `name`,而**不是**新增一個對 `@supabase/auth-js`
 *    的直接依賴(它在本 app 是傳遞依賴,直接 import 會多一條會漂的線)。
 * ⚠️ 代價:`name` 是字串比對。哪天它改名 ⇒ 本函式會把訪客判成故障 ⇒ **log 變吵,但不會誤放權限**
 *    (降級方向仍然只往下)。
 */
export function isNoSessionError(error: { name?: string } | null | undefined): boolean {
  return error?.name === 'AuthSessionMissingError';
}

/** 同一個 request 內共用的「Auth 說你是誰」+ 那個 supabase client。 */
export const getVerifiedUser = cache(async () => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: data?.user ?? null, error: error ?? null };
});
