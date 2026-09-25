// EmailConfirmedNotice.tsx — 首頁「Email 已確認」提示(2026-09-26 資安修正片 2)
//
// /auth/confirm 驗證註冊確認信成功後導到 /?confirmed=1, 首頁看到這個參數才掛這個元件。
// 🔴 Email 取自【已驗證的登入狀態】(getVerifiedUser, 向 Auth 驗過 token),不信網址帶的任何值;
//    沒有登入狀態就什麼都不顯示 —— 不能只因為網址有 confirmed=1 就說成功。
// 瀏覽器原本登入 A、開了 B 的有效連結時, 登入狀態已切成 B, 這裡寫出的就是 B, 客人看得出換了帳號。
// getVerifiedUser 是 request-scoped 快取, 與首頁其他地方共用同一次驗證, 不多一次往返。

import { getVerifiedUser } from '@/lib/auth/verified-user';

/** 首頁要不要掛這個提示:只認 `confirmed=1` 一個值;沒帶、其他值、重複參數(陣列)都不掛。 */
export function shouldShowConfirmedNotice(params: { confirmed?: string | string[] }): boolean {
  return params.confirmed === '1';
}

export async function EmailConfirmedNotice() {
  const { user } = await getVerifiedUser();
  if (!user?.email) return null;
  return (
    <p className="auth-ok home-confirmed-notice" role="status">
      Email 已確認，歡迎加入。目前登入的帳號是 {user.email}。
    </p>
  );
}
