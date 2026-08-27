/**
 * GoTrue(Supabase Auth)錯誤碼的**唯一**判別處。
 *
 * 🔴🔴 **為什麼它住在 `packages/` 而不是各自那一支檔裡**(2026-08-28 R3 F5):
 *    這個判斷原本有**兩份**:`apps/storefront/src/lib/auth/line-admin.ts` 一份、
 *    `apps/admin/src/lib/customers/manual-customer.ts` 一份,而**後來那份出生就比前面那份寬**
 *    (多認 `'23505'` 與兩條訊息子字串)。
 *    ⇒ 而兩邊對「認錯」的後果**方向相反**:
 *      · line 登入那邊:認太寬 ⇒ 把別的錯當成「這個信箱已存在」⇒ 走 magiclink ⇒ 誤指一個帳號
 *      · 後台建客人那邊:認太寬 ⇒ 把別的錯當成撞鍵 ⇒ 走回收路徑 ⇒ **可能回傳別人的帳號**
 *    ⇒ **兩邊都是「寬的那份比較危險」** ⇒ 共用這一份,而這一份取**窄**的。
 *
 * 🔴 **窄的代價寫出來**:認不出來的那一發會走「原樣拋」——
 *    那個方向是安全的(不會把別人的帳號當成自己人),代價只是員工看到一句系統錯誤。
 *
 * ⚠️ **射程**:兩顆碼是 `@supabase/auth-js` 的 `ErrorCode` union 成員
 *    (`node_modules/.pnpm/@supabase+auth-js@2.105.3/…/lib/error-codes.d.ts:6`,2026-08-28 當場開檔核過)。
 *    **GoTrue 版本換了要回來重核** —— 這裡不靠訊息字串猜,訊息會隨語系與版本變。
 */
export function isEmailExistsError(error: { code?: string; message?: string }): boolean {
  return error.code === 'email_exists' || error.code === 'user_already_exists';
}
