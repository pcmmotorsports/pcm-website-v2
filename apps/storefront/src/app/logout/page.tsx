// app/logout/page.tsx — /logout 登出確認頁(全站重設計 第2批;2026-08-06)
//
// 真權威 = OD `logout-page.html`。Sean 2026-08-05 指出「登出頁面也沒有做」。
//
// ✅ **這一頁已經接上了(2026-08-18 G3)。** 登出之後客人會落在這裡,不是登入表單。
//    `app/account/actions.ts` 的 `logoutAction` 已 `redirect('/logout')`;守門在
//    `styles/coming-soon.test.ts`(那一格【翻過面】了:原本釘「不准沒過審查就接線」,
//    現在釘「目的地必須是 /logout」)。plan:`docs/specs/2026-08-18-g3-logout-wiring-plan.md`。
//
//    🔴 **接線的身分要分開講,不要合併:**
//      · **「要接線」= Sean 本人拍的**(2026-08-06 `Q2=A`,逐字見下)
//      · **「現在做」= 主視窗【代裁】** —— 原拍板附帶「排白天、夜間不動」,
//        代裁的理由是**那個條件的目的是「有人看著」,而 Sean 今晚在線上**
//        ⇒ 條件的【目的】滿足了,**不是條件被廢掉**。射程只到他在線上為止。
//      · Sean 原拍板明寫的 **鐵則 12② 對抗審查不降級** —— 代裁沒動它,已照跑。
//    ```
//    memory project_site-redesign-content-pages-decisions.md:17 逐字:
//      「Q2=A:/logout 道別頁要接線 —— 登出 redirect 由 /login 改 /logout；
//        動 logoutAction（auth server action）= 鐵則 12② 高風險片，
//        排白天 + codex 對抗審查不降級，夜間不動」
//    ```
//    ⚠️ 設計端檔頭寫的是「redirect 目的地由 `'/'` 改成 `'/logout'`」,而**真站當時是 `'/login'`**
//       (不是 `'/'`)⇒ 實際換掉的落點是**登入表單**,不是首頁。照抄設計稿那行會描述錯現況。
//
//    📎 這一筆本身是個教訓:**拍板落了 memory,而【那個決定指著的這支檔】曾經不知道自己被拍過。**
//       (同族 memory:`feedback_a-ruling-must-update-the-files-it-points-at`)
//
// 🔴 **字面全部是設計稿新寫的,沒有真站來源可對照**(`SITE-MAP.md` 2026-08-05 追加那節逐字)。
//    所以這裡一個字都沒有自己發明,全部逐字照搬 `logout-page.html:88-99`。
//
// 樣式:零新增元件級 CSS,`.lo-*` 那組已進 `styles/auth.css` 檔尾(設計端「沿用 pcm-auth.css」)。
// 內容分級 L1。

import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';

export const metadata: Metadata = {
  title: '已登出 — PCM Motorsports',
  // 登出確認頁沒有可索引的內容,而且被搜尋引擎收錄只會讓人從搜尋結果直接掉進來。
  robots: { index: false, follow: true },
};

export default function LogoutPage() {
  return (
    <div className="ap-page" data-screen-label="Logout">
      <Header currentPage="logout" />
      <main className="auth-main">
        <div className="auth-card lo-card">
          <div className="lo-icon" aria-hidden="true">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </div>
          <div className="ap-mono">N°ACCOUNT · SIGNED OUT</div>
          <h1>您已登出</h1>
          <p className="lo-note">
            感謝使用 PCM MOTOR PARTS,
            <br />
            期待再次為您服務。
          </p>
          <div className="lo-actions">
            <Link className="auth-submit" href="/login">
              重新登入
            </Link>
            <Link className="lo-secondary" href="/products">
              繼續逛商品
            </Link>
            <Link className="lo-secondary" href="/">
              回首頁
            </Link>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
