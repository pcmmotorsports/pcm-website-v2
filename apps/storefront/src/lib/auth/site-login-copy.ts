// lib/auth/site-login-copy.ts —— 站別登入被擋時,登入頁顯示的話與另一站的連結(B2B 計畫第四版 F 節 Q3,文字逐字照計畫)。
// 伺服器端(site-login-gate.ts 產生錯誤碼)與登入頁(LoginPage.tsx 顯示)共用,所以不放 server-only。
import type { SiteMode } from '@/lib/site-mode';
import { LINE_ADD_URL, LINE_OA_ID } from '@/lib/line-cta';

export type SiteLoginError =
  | 'site-member-on-b2b'
  | 'site-dealer-on-retail'
  | 'site-unknown'
  // 每次請求的檢查(src/proxy.ts)用:登入時站別是對的,之後等級才變(計畫 E 節)
  | 'site-dealer-approved'
  | 'site-dealer-revoked'
  // 後台停用的會員(登入當下與每次請求都用這一個)
  | 'site-disabled';

// ponytail: 兩站網址寫死正式站;本機開發點下去也會到正式站。要分環境時再改成 env。
export const RETAIL_SITE_URL = 'https://www.pcmmotorsports.com';
export const B2B_SITE_URL = 'https://b2b.pcmmotorsports.com';

export type SiteLoginMessage = { text: string; links?: { href: string; label: string }[] };

/** 經銷商申請表只在一般站用(申請中的人是一般會員,在經銷站會被登出;計畫 E 節)。 */
export const DEALER_APPLY_URL = `${RETAIL_SITE_URL}/dealer-apply`;
const APPLY_LINK = { href: DEALER_APPLY_URL, label: '提出經銷商申請' };

/** 不是站別錯誤碼 ⇒ 回 null,讓登入頁照原本的 OAuth 錯誤處理。 */
export function siteLoginMessage(code: string | undefined, mode: SiteMode): SiteLoginMessage | null {
  switch (code) {
    case 'site-member-on-b2b':
      return {
        text: '這是經銷商專用網站。您的帳號目前是一般會員，請到一般網站登入。',
        links: [APPLY_LINK, { href: `${RETAIL_SITE_URL}/login`, label: '前往 www.pcmmotorsports.com' }],
      };
    case 'site-dealer-on-retail':
      return {
        text: '您的帳號是經銷商帳號，請到經銷商網站登入，那裡會顯示您的經銷價格。',
        links: [{ href: `${B2B_SITE_URL}/login`, label: '前往 b2b.pcmmotorsports.com' }],
      };
    case 'site-dealer-approved':
      return {
        text: '您的經銷資格已開通，請到經銷商網站登入。',
        links: [{ href: `${B2B_SITE_URL}/login`, label: '前往 b2b.pcmmotorsports.com' }],
      };
    case 'site-dealer-revoked':
      return {
        text: '這個帳號目前沒有經銷資格，請到一般網站登入。',
        links: [APPLY_LINK, { href: `${RETAIL_SITE_URL}/login`, label: '前往 www.pcmmotorsports.com' }],
      };
    case 'site-disabled':
      // Sean 2026-09-26 Q30 甲:只有密碼正確的人會看到這一句(密碼錯的在 Supabase 那一步就擋下, 看到的是「Email 或密碼錯誤」)
      return {
        text: `此帳號已停用，如有疑問請加 LINE ${LINE_OA_ID} 聯絡我們。`,
        links: [{ href: LINE_ADD_URL, label: `加 LINE ${LINE_OA_ID}` }],
      };
    case 'site-unknown':
      return {
        text:
          mode === 'b2b'
            ? '目前無法確認您的經銷資格，請稍後再登入。若一直無法登入，請聯絡 PCM 業務。'
            : '暫時無法完成登入，請稍後再試。',
      };
    default:
      return null;
  }
}
