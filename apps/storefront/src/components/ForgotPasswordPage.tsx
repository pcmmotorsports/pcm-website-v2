// ForgotPasswordPage.tsx — 忘記密碼頁(填 Email / 已寄出,忘記密碼接線片)
//
// 字面從 pcm-mailbox/附件-D-忘記密碼-forgot-password-page.html 直接搬(鐵則 1、不翻譯):
// - 狀態 A(填 Email)/ B(已寄出)用 React state 切換,不是稿的 ?state= 預覽參數(不搬進真站)。
// - <Header currentPage="login" /> + <HomeFooter />(照 LoginPage.tsx 的 adaptation 慣例;稿的
//   header/footer/tabbar markup 不手抄一份)。
// - 內部導覽(回登入 / 回去登入)改 next/link <Link>(對齊 LoginPage.tsx 既有 adaptation 慣例)。
// - 「換一個 Email」用 <button class="auth-linkbtn">,不用 <a href="#">(plan §2-3 逐字:OD 自己踩過這個坑
//   才加這顆 class,本片存在的理由就是修一個 <a href="#">)。
//
// 安全(plan §3-1、本片最高風險點):server action requestPasswordResetAction 不論帳號存在與否 /
// 寄信成功或失敗一律回同一形狀(空物件),本元件送出成功一律進「已寄出」狀態、不判斷任何差異。
//
// 🔴 60 秒冷卻倒數(plan §3-2 Q24-D 拍板秒數、但稿沒畫倒數態 — OD 當時在等秒數):
// 本片自訂,沿用同一顆 .auth-submit-ghost、文字改成「沒收到？再寄一次（NN 秒）」,倒數完回復原字面;
// 待 OD 補圖後對齊視覺,目前只是functionally correct 的暫訂樣式。

'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { requestPasswordResetAction } from '@/app/login/forgot/actions';
import { validateForgot, type ForgotFieldErrors } from '@/lib/auth/field-validation';

const RESEND_COOLDOWN_SECONDS = 60;
// 站台設定錯誤時的頂部字面。刻意**不**寫「請稍後再試」——那句會騙客人再試一次,而設定沒改前
// 再試一百次都一樣。稿沒有這句(稿沒有這個情境),屬本片新增、已在 plan §8-2 申報。
const SERVER_ERROR_COPY = '系統暫時無法寄出重設信，請稍後聯絡客服';

export function ForgotPasswordPage() {
  const [stage, setStage] = useState<'ask' | 'sent'>('ask');
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ForgotFieldErrors>({});
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);
  // 對抗審查 R1 nit:server action 會在「站台設定錯誤」時**故意 throw**(forgot/actions.ts:29-33,
  // 規格明訂:不可偽裝成「信已寄出」)。沒有這條通道的話,client `await` 直接炸掉、`setPending(false)`
  // 永遠不執行 ⇒ 鈕永久卡 disabled、畫面停在轉圈,客人不知道發生什麼事。
  // 🔴 稿本來就有這個頂部通道(`<div class="auth-err" id="form-error" hidden>`),是我們第一版漏搬。
  const [formError, setFormError] = useState<string | null>(null);

  // 倒數:每秒扣 1、歸零自動停(cooldown===0 時 effect 直接 return、鈕自然變回可按)。
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateForgot({ email });
    if (!v.ok || !v.data) {
      setFieldErrors(v.fieldErrors);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setPending(true);
    let result;
    try {
      result = await requestPasswordResetAction({ email: v.data.email });
    } catch {
      // 站台設定錯誤(見 formError state 註解)。不透出技術細節,但一定要讓鈕解鎖、讓客人看到有事發生。
      setFormError(SERVER_ERROR_COPY);
      return;
    } finally {
      setPending(false);
    }
    if (result.fieldErrors) {
      setFieldErrors(result.fieldErrors);
      return;
    }
    setSentEmail(v.data.email);
    setStage('sent');
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const resend = async () => {
    if (cooldown > 0 || pending) return;
    setFormError(null);
    setPending(true);
    try {
      await requestPasswordResetAction({ email: sentEmail });
    } catch {
      setFormError(SERVER_ERROR_COPY);
      return;
    } finally {
      setPending(false);
    }
    setResent(true);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const retry = () => {
    setStage('ask');
    setEmail('');
    setFieldErrors({});
    setResent(false);
  };

  return (
    <div className="ap-page">
      <Header currentPage="login" />
      <main className="auth-main">
        {stage === 'ask' && (
          <div className="auth-card">
            <Link className="auth-back" href="/login">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
              <span>回登入</span>
            </Link>
            <div className="ap-mono">N°01 · Reset password</div>
            <h1>忘記密碼</h1>
            <p className="auth-sub">輸入註冊時用的 Email，我們寄一封重設密碼的信給你。</p>

            <form onSubmit={submit} noValidate>
              {formError && <div className="auth-err" role="alert">{formError}</div>}
              <label className="auth-field">
                <span>Email（必填）</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  autoComplete="email"
                  autoFocus
                />
                {fieldErrors.email && <span className="auth-field-err">{fieldErrors.email}</span>}
              </label>
              <button type="submit" className="auth-submit" disabled={pending}>寄出重設連結</button>
            </form>

            <div className="auth-note">
              用 <b>Google</b> 或 <b>LINE</b> 註冊的話沒有密碼可以重設 —— 直接回登入頁用原本的方式登入就好。
            </div>

            <div className="auth-foot">
              想起來了？<Link href="/login">回去登入</Link>
            </div>
          </div>
        )}

        {stage === 'sent' && (
          <div className="auth-card">
            <div className="auth-icon-ok" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z"/><path d="m4 7 8 6 8-6"/></svg>
            </div>
            <div className="ap-mono">N°02 · Check your inbox</div>
            <h1>信寄出去了</h1>
            <p className="auth-sub">
              如果 <b>{sentEmail}</b> 有註冊過 PCM 帳號，信箱裡就會收到一封重設密碼的信。
            </p>

            <ul className="auth-steps">
              <li>連結 <b>1 小時內有效</b>，過期就再要一次。</li>
              <li>沒看到信的話，<b>檢查垃圾郵件</b>——重設信最常掉在那裡。</li>
              <li>信裡的連結<b>只能用一次</b>，用過就失效。</li>
            </ul>

            {formError && <div className="auth-err" role="alert">{formError}</div>}
            <button
              type="button"
              className="auth-submit auth-submit-ghost"
              disabled={cooldown > 0 || pending}
              onClick={resend}
            >
              {cooldown > 0 ? `沒收到？再寄一次（${cooldown} 秒）` : '沒收到？再寄一次'}
            </button>
            {resent && (
              <p className="auth-hint">已經再寄一次了。<b>如果還是沒收到，先確認 Email 有沒有打錯。</b></p>
            )}

            <div className="auth-foot">
              Email 打錯了？<button type="button" className="auth-linkbtn" onClick={retry}>換一個 Email</button>
            </div>
          </div>
        )}
      </main>
      <HomeFooter />
    </div>
  );
}
