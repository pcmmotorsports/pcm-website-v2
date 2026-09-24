// components/B2bRegisterNotice.tsx —— 經銷站的 /register(B2B 計畫 F 節 Q2 甲,主視窗 2026-09-25 派工)。
//
// 新註冊的帳號一定是一般會員,在經銷站註冊完會立刻被登出(L2a)⇒ 這裡不給表單,請他到一般站提出經銷商申請。
// 帳號兩站共用:開通後用同一組帳號登入經銷站。稿上沒有這一頁 ⇒ 版型與按鈕沿用 /login/reset「連結失效」那一格
// (.auth-card、.auth-submit-link、.auth-submit-ghost),不新增元件樣式。
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { DEALER_APPLY_URL } from '@/lib/auth/site-login-copy';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';

/** @param next 從哪裡被帶來註冊(#190:登入連結要把它帶著,登入後回原頁)。 */
export function B2bRegisterNotice({ next }: { next?: string }) {
  return (
    <div className="ap-page">
      <Header currentPage="register" />
      <main className="auth-main">
        <div className="auth-card">
          <div className="ap-mono">N°02 · Dealer account</div>
          <h1>經銷帳號需要先提出申請</h1>
          <p className="auth-sub">
            經銷商網站只給已開通經銷資格的帳號使用，經銷資格需要先申請、經審核開通。請先在一般網站登入或註冊，再提出經銷商申請；開通後用同一組帳號登入這裡。
          </p>
          {/* 申請表只在一般站(申請中的人是一般會員,在經銷站會被登出;計畫 E 節)⇒ 完整網址 */}
          <a className="auth-submit auth-submit-link" href={DEALER_APPLY_URL}>
            提出經銷商申請
          </a>
          <Link
            className="auth-submit auth-submit-ghost auth-submit-link"
            href={next ? `/login?next=${encodeURIComponent(sanitizeNextParam(next))}` : '/login'}
          >
            已有經銷帳號？登入
          </Link>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
