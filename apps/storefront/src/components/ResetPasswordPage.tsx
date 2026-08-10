// ResetPasswordPage.tsx — 設定新密碼頁(設新密碼 / 完成,忘記密碼接線片)
//
// 字面從 pcm-mailbox/附件-D-忘記密碼-reset-password-page.html 直接搬(鐵則 1、不翻譯):
// - 狀態 A(設新密碼)/ C(完成)用 React state 切換;狀態 B(連結失效)由 server 端 page.tsx 決定
//   要不要渲染本元件(plan §3-3、見 app/login/reset/page.tsx)。
// - 眼睛切換鈕 aria-pressed / aria-label 照稿切換;強度三段格門檻邏輯照稿(<8=1、>=12 且
//   種類>=3=3、其餘=2)、文字「太短/可以用/夠強」照稿。
// - .auth-note 換裝置登出提醒照留(plan §3-5 ① 已驗證屬實、主對話親讀 supabase/auth 原始碼)。
// - 🔴 不放社交登入鈕(plan §2-4 決定 1:Google/LINE 帳號沒有 PCM 密碼可重設,放了會誤導)。
// - 狀態 C「前往登入」用 <a class="auth-submit auth-submit-link">(next/link 對應)照稿,那是真的
//   導頁、不是 JS 動作。

'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { resetPasswordAction } from '@/app/login/reset/actions';
import { validateResetPassword, type ResetPasswordFieldErrors } from '@/lib/auth/field-validation';

/** 密碼強度:只看長度與字元種類(稿逐字「不裝聰明」)。<8=1、>=12 且種類>=3=3、其餘=2、空字串=0(不顯示)。 */
function strengthLevel(password: string): number {
  if (password === '') return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length < 8) return 1;
  if (password.length >= 12 && kinds >= 3) return 3;
  return 2;
}

const STRENGTH_TEXT = ['', '太短', '可以用', '夠強'];

export function ResetPasswordPage({ email }: { email: string }) {
  const [stage, setStage] = useState<'set' | 'done'>('set');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ResetPasswordFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const level = strengthLevel(password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateResetPassword({ password, confirm });
    if (!v.ok || !v.data) {
      setFieldErrors(v.fieldErrors);
      setFormError(null);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setPending(true);
    // 🔴 **`confirm` 一定要一起送**(2026-08-11 正式站客面壞、Sean 親測撞到):
    //    `resetPasswordAction` 開頭就跑 `validateResetPassword(input)`(`app/login/reset/actions.ts`),
    //    而那支對空 `confirm` 直接開「請再輸入一次密碼」(`lib/auth/field-validation.ts:199-200`)
    //    ⇒ 原本只送 `{ password }` 的寫法讓 **happy path 100% 不可達**:密碼填得再對,
    //    送出永遠回同一句、密碼永遠改不成。
    //    (`v.data` strip 掉 confirm,所以 confirm 取 state;client 剛用同一組原值比對過。)
    //    ⚠️ 別反過來把 server 改成 password-only:`actions.ts` 檔頭寫明它**刻意**共用這支驗證
    //    (含 confirm 兩句 Sean Q24-e 拍板的照稿字面)。
    //    ⚠️ 但也**別把 server 那道記成安全控制**(R1 nit-5 收窄):攻擊者用 curl 兩欄都自己填、
    //    永遠填得相等 ⇒ 它擋得住的只有「壞掉的 client」,也就是這次這種。
    const result = await resetPasswordAction({ password: v.data.password, confirm });
    setPending(false);
    if (result.fieldErrors || result.formError) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.formError) setFormError(result.formError);
      return;
    }
    setStage('done');
  };

  if (stage === 'done') {
    return (
      <div className="ap-page">
        <Header currentPage="login" />
        <main className="auth-main">
          <div className="auth-card">
            <div className="auth-icon-ok" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m4 12.5 5.2 5.2L20 7"/></svg>
            </div>
            <div className="ap-mono">Done</div>
            <h1>密碼改好了</h1>
            <p className="auth-sub">用新密碼登入就可以了。</p>
            <Link className="auth-submit auth-submit-link" href="/login">前往登入</Link>
          </div>
        </main>
        <HomeFooter />
      </div>
    );
  }

  return (
    <div className="ap-page">
      <Header currentPage="login" />
      <main className="auth-main">
        <div className="auth-card">
          <div className="ap-mono">N°03 · New password</div>
          <h1>設定新密碼</h1>
          <p className="auth-sub">為 <b>{email}</b> 設一組新密碼，設好之後就能直接登入。</p>

          <form onSubmit={submit} noValidate>
            {formError && <div className="auth-err">{formError}</div>}

            <label className="auth-field">
              <span>新密碼（必填）</span>
              <div className="auth-input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 碼"
                  autoComplete="new-password"
                  autoFocus
                />
                <button
                  type="button"
                  className="auth-eye"
                  aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((s) => !s)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
              {fieldErrors.password && <span className="auth-field-err">{fieldErrors.password}</span>}
            </label>

            {password !== '' && (
              <div className="auth-meter" data-level={level}>
                <div className="auth-meter-bars" aria-hidden="true">
                  <span className={`auth-meter-bar${level >= 1 ? ' is-on' : ''}`} />
                  <span className={`auth-meter-bar${level >= 2 ? ' is-on' : ''}`} />
                  <span className={`auth-meter-bar${level >= 3 ? ' is-on' : ''}`} />
                </div>
                <span className="auth-meter-t" role="status">{STRENGTH_TEXT[level]}</span>
              </div>
            )}

            <label className="auth-field">
              <span>再輸入一次（必填）</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再打一次上面那組"
                autoComplete="new-password"
              />
              {fieldErrors.confirm && <span className="auth-field-err">{fieldErrors.confirm}</span>}
            </label>

            <button type="submit" className="auth-submit" disabled={pending}>設定新密碼</button>
          </form>

          <div className="auth-note">
            改完密碼之後，<b>其他裝置上的登入會被登出</b>，需要用新密碼重新登入一次。
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
