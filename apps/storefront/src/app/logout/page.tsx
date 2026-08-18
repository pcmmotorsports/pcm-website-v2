// app/logout/page.tsx — /logout 登出確認頁(全站重設計 第2批;2026-08-06)
//
// 真權威 = OD `logout-page.html`。Sean 2026-08-05 指出「登出頁面也沒有做」。
//
// 🔴🔴 **這一頁目前「做好了但沒接上」—— 這是刻意的,不是漏做。**
//    設計端檔頭寫「要採用這頁,網站端得新開 `app/logout/page.tsx` 並把 logoutAction 的
//    redirect 目的地由 `'/'` 改成 `'/logout'`」。**本批只做前半。**
//    ① 設計端說的「真站登出跑完直接 redirect 回**首頁**」與事實不符 ——
//       實查 `app/account/actions.ts:19` 是 `redirect('/login')`,不是 `'/'`。
//       ⇒ 「改 redirect 目的地」實際上是把登出後的落點從**登入頁**換成**這一頁**,
//       那是一個產品決定(登出後該直接看到登入表單、還是先看一頁道別),不是照抄一行。
//    ② `logoutAction` 是 auth server action ⇒ 動它命中**鐵則 12②(權限)**,
//       commit 前必過 codex 對抗審查。夜跑窗不碰高風險面。
//    ⇒ 本頁先建起來讓 Sean 能直接開 `/logout` 看長相;接線與否列進 STOP 等他拍板。
//    **在接線之前,這條路由只有直接輸入網址才到得了,沒有任何連結指向它。**
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
