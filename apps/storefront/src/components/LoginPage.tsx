// LoginPage.tsx — 登入頁(M-1-14e-f1-a、f1-c Google OAuth、#181 表單 UX 強化)
//
// 字面從 design-reference/components/AccountPages.jsx LoginPage(L181-253)直接搬(鐵則 1、不翻譯):
// - React.useState → useState;controlled inputs 維持 design 形狀(email/password/remember)
// - 路由 adaptation(ProductPage.tsx 既有慣例、鐵則 1 例外類別 2 技術實作):
//   · <Header currentPage="login" onNav> → <Header currentPage="login" />(storefront Header 內走 next/link)
//   · <Footer onNav> → <HomeFooter />
//   · onNav('register')「建立帳號」→ <Link href="/register">
//   · submit localStorage mock → loginAction server action(逐欄驗證 + loginCustomer、信任邊界在 server)
// - Google / LINE 社交鈕 markup 直接搬(含 svg + 字面);視覺嚴守 .auth-social / .auth-social-line:
//   · Google(f1-c 接線):onClick signInWithOAuth(client-initiated、redirectTo /auth/callback、繞 IAuthService port、PRD §8.4)。
//   · LINE(f2-b 接線):onClick 純導航 window.location.href='/api/auth/line/start'(自寫 OAuth、Supabase 不內建 LINE)。
// - oauthError prop(f1-c/f2-b):/auth/callback 失敗導 ?error=oauth、/api/auth/line/callback 失敗導 ?error=line →
//   login/page.tsx(server)讀 searchParams 傳入 → oauthErrorCopy 依 code 分流(Google / LINE / 通用)顯示於 formError 頂部通道。
// - 忘記密碼?→ <Link href="/login/forgot">(2026-08-08 修;與上面「建立帳號」同一條路由 adaptation)。
//   🔴 這裡原本是 <a href="#"> 配一句「該流程不在 f1 scope」的暫緩理由 —— **那個理由後來失效了**:
//      /login/forgot、/login/reset、兩支 action、兩支頁面測試都已做完並上線,只有登入頁這個**入口**
//      從沒接上去 ⇒ 正式站客人按「忘記密碼?」原地不動(Sean 回報「重新申請密碼功能無法使用」)。
//      教訓:**暫緩理由建立在「當時不可達」之上時要寫明失效條件**,否則條件變了沒人回來改。
//
// #181 business override(鐵則 1 設計為基底、Sean 2026-05-25 Q1=B/Q2=B 拍板):
// - 全欄必填標(Q1=B):Email/密碼 label 加全形「（必填）」(與註冊頁 4 欄統一)。
// - 逐欄 inline error(Q2=B):fieldErrors.{欄} 顯示在該欄 input 下方;空欄專屬「請填寫…」、非空格式錯沿用 zod
//   (共用 validateLogin、client/server 同一份;取代 design 單一頂部 .auth-err 之「驗證」用途)。
// - 雙通道並存(釘死 2):頂部 .auth-err 保留給「帳號層級錯」(Email 或密碼錯誤 / OAuth 失敗 = formError),
//   逐欄 .auth-field-err 給「欄位驗證錯」(fieldErrors);兩通道互不取代、可同時顯示。

'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { loginAction } from '@/app/login/actions';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { validateLogin, type LoginFieldErrors } from '@/lib/auth/field-validation';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';

// OAuth 失敗字面:依 /auth/callback(?error=oauth)或 /api/auth/line/callback(?error=line)導回的 error code 分流。
const GOOGLE_ERROR_COPY = 'Google 登入失敗，請重試';
const LINE_ERROR_COPY = 'LINE 登入失敗，請重試';
const GENERIC_OAUTH_ERROR_COPY = '社群登入失敗，請重試';

function oauthErrorCopy(code?: string): string | null {
  if (!code) return null;
  if (code === 'oauth') return GOOGLE_ERROR_COPY;
  if (code === 'line') return LINE_ERROR_COPY;
  return GENERIC_OAUTH_ERROR_COPY;
}

export function LoginPage({ oauthError, next }: { oauthError?: string; next?: string }) {
  // #190:client 端先 sanitize 一次(縱深、不送 garbage 給 Google/LINE);server action / OAuth callback 為權威白名單。
  const safeNext = sanitizeNextParam(next);
  const [form, setForm] = useState({ email: '', password: '', remember: true });
  // 雙通道(#181 釘死 2):fieldErrors=逐欄驗證錯、formError=帳號層級錯(頂部);互不取代。
  // oauthError(/auth/callback 失敗導回 ?error)→ 初始顯示 OAuth 失敗字面於 formError(f1-c)。
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(oauthErrorCopy(oauthError));
  const [pending, setPending] = useState(false);

  /**
   * 客人一開始改某一欄,就清掉那一欄的 inline 錯 + 頂部帳號層級錯(2026-08-08 全站掃測 B 級)。
   *
   * - **只清被動的那一欄**:其他欄的錯留著,客人一眼看得到還有幾處要修。
   * - **頂部 formError 一律清**:它講的是「上一次送出」的結果(Email 或密碼錯誤 / OAuth 失敗),
   *   人開始改輸入的那一刻它就過期了,留著會讓人以為改完還是錯。
   * - 兩個 setter 都在「本來就沒東西可清」時回傳原值 ⇒ **這兩個 setter** 不觸發更新。
   *   ⚠️ 不等於「不重繪」:同一個 handler 裡的 `setForm({ ...form, … })` 每次都產新物件,
   *   controlled input 本來就每按一鍵重繪一次(R1 nit:第一版把結論寫成「不會每按一鍵重繪」= 錯)。
   * - 「記住我」checkbox 不接:勾選框改不動任何欄位錯,也不代表客人在修正帳密。
   *
   * 📌 design 真權威(`design-reference/components/AccountPages.jsx:208-213`)的 onChange
   *    只有 `setForm(...)`、**同樣不清錯**;那是靜態原型(單一 `err` 字串、無真驗證),
   *    不是 UX 政策。本片是**新增行為**、不是對齊 design,如實記在此。
   */
  const clearErr = (k: keyof LoginFieldErrors) => {
    setFieldErrors((prev) => (prev[k] === undefined ? prev : { ...prev, [k]: undefined }));
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // client 逐欄驗證(主防線、與 server 同一份 validateLogin)
    const v = validateLogin(form);
    if (!v.ok) {
      setFieldErrors(v.fieldErrors);
      setFormError(null);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setPending(true);
    // 成功時 loginAction 內 redirect(#190 導回 sanitize 過的 next、client 自動導航);
    // 失敗回 { fieldErrors }(server 重驗逐欄)或 { formError }(帳號層級)。
    const result = await loginAction(form, next);
    if (result?.fieldErrors || result?.formError) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.formError) setFormError(result.formError);
      setPending(false);
    }
  };

  // Google 一鍵登入(f1-c):client-initiated signInWithOAuth → 重導 Google → 回 /auth/callback 換 session。
  const signInGoogle = async () => {
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // #190:redirectTo 帶 next(callback 端 sanitize 後導回);safeNext 已過白名單。
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });
    // 成功時瀏覽器即刻重導 Google(本元件卸載);僅發起失敗(如網路)時顯示錯誤(帳號層級、走 formError)。
    if (error) {
      setFormError(GOOGLE_ERROR_COPY);
    }
  };

  // LINE 一鍵登入(f2-b):導向自寫 OAuth start route(Supabase 不內建 LINE);純導航、不需 supabase client。
  const signInLine = () => {
    // #190:next 帶進 start route(存 cookie、callback 端 sanitize 後導回);safeNext 已過白名單。
    window.location.href = `/api/auth/line/start?next=${encodeURIComponent(safeNext)}`;
  };

  return (
    <div className="ap-page">
      <Header currentPage="login" />
      <main className="auth-main">
        <div className="auth-card">
          <div className="ap-mono">N°01 · Sign in</div>
          <h1>歡迎回來</h1>
          <p className="auth-sub">登入你的 PCM 帳號，查看訂單與收藏。</p>

          <form onSubmit={submit}>
            {/* 頂部:帳號層級錯(Email 或密碼錯誤 / OAuth 失敗);逐欄驗證錯顯示在各欄下方(釘死 2 雙通道) */}
            {formError && <div className="auth-err">{formError}</div>}
            <label className="auth-field">
              <span>Email（必填）</span>
              <input
                type="email"
                value={form.email}
                autoFocus
                onChange={(e) => { setForm({ ...form, email: e.target.value }); clearErr('email'); }}
                placeholder="your@email.com"
              />
              {fieldErrors.email && <span className="auth-field-err">{fieldErrors.email}</span>}
            </label>
            <label className="auth-field">
              <span>密碼（必填）</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => { setForm({ ...form, password: e.target.value }); clearErr('password'); }}
                placeholder="至少 8 碼"
              />
              {fieldErrors.password && <span className="auth-field-err">{fieldErrors.password}</span>}
            </label>
            <div className="auth-row">
              <label className="auth-check">
                <input
                  type="checkbox"
                  checked={form.remember}
                  onChange={(e) => setForm({ ...form, remember: e.target.checked })}
                />
                <span>記住我</span>
              </label>
              <Link href="/login/forgot" className="auth-forgot">忘記密碼？</Link>
            </div>
            <button type="submit" className="auth-submit" disabled={pending}>登入</button>
          </form>

          <div className="auth-divider"><span>或</span></div>

          <button type="button" className="auth-social" onClick={signInGoogle}>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.87 2.69-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86a5.39 5.39 0 0 1-5.07-3.73H.96v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.93 10.69A5.4 5.4 0 0 1 3.65 9c0-.59.1-1.16.28-1.69V4.98H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.02l2.97-2.33z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.98L3.93 7.3A5.39 5.39 0 0 1 9 3.58z"/>
            </svg>
            <span>使用 Google 登入</span>
          </button>
          <button type="button" className="auth-social auth-social-line" onClick={signInLine}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 5.67 2 10.16c0 3.96 3.57 7.27 8.37 7.9.33.07.77.22.88.5.1.26.07.67.03.93l-.14.86c-.04.26-.2 1.01.88.55 1.08-.46 5.83-3.44 7.96-5.88 1.47-1.61 2.02-3.24 2.02-4.86C22 5.67 17.52 2 12 2z"/></svg>
            <span>使用 LINE 登入</span>
          </button>

          <div className="auth-foot">
            第一次來？<Link href="/register">建立帳號</Link>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
