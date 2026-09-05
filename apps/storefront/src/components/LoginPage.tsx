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
import {
  AUTH_CODE_NEEDS_CONFIRMATION,
  AUTH_RESEND_SENT_NOTICE,
  AUTH_RESEND_FAILED_NOTICE,
} from '@/lib/auth/auth-copy';
import { resendSignupConfirmationAction } from '@/app/login/actions';
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

// 登入頁副標的兩句。抽成常數只是為了讓上面那個三元式讀得懂, **不是為了共用** ——
// 它們各自只有一個使用者。
// ⚠️ `AUTH_SUB_DEFAULT` 的字面與 `app/login/page.tsx` 的 `metadata.description` 相同,
//    ⛔ ~~而那是巧合~~ 🔴 **2026-08-29 code-reviewer 訂正:不是巧合, 是【同源】** ——
//    兩者都出自 `design-reference/components/AccountPages.jsx` 的 `.auth-sub`
//    (原句用「你」;「你 ⇒ 您」是 Sean 既有的稱謂拍板)。
//    📌 **寫成「巧合」會讓下一個人不知道回哪對稿** ⇒ 正確的說法是【同源, 而各自演化】。
//    🛑 **仍然不要把兩者收斂成一個來源** —— 理由不是它們無關, 是它們的【讀者不同】:
//       一個給爬蟲、一個給站在這裡的人 ⇒ 詳見該檔那一行上方的註解。
const AUTH_SUB_DEFAULT = '登入您的 PCM 帳號，查看訂單與收藏。';
const AUTH_SUB_CHECKOUT = '結帳前請先登入，購物車會幫您留著。';

export function LoginPage({ oauthError, next }: { oauthError?: string; next?: string }) {
  // #190:client 端先 sanitize 一次(縱深、不送 garbage 給 Google/LINE);server action / OAuth callback 為權威白名單。
  // 🔴 **而在【副標換句】那一格上, 用 `safeNext` 與用 `next` 的行為【完全相同】**
  //    (2026-08-29 code-reviewer 抓到, 我實跑確認):
  //    `sanitizeNextParam` 只回「`next` 本身」或「fallback `/`」, 而 `/` 也 `!== '/checkout'`
  //    ⇒ `safeNext === '/checkout'` ⟺ `next === '/checkout'`。
  //    ⛔ ~~我原本宣稱「改用原始 next ⇒ 突變紅」~~ —— **那一發紅的是我同時改掉的 `===`, 不是 `next`**。
  //    純粹只換 `safeNext ⇒ next` ⇒ **23 格全綠, 殺不掉。**
  //    📌 **⇒ 所以這裡寫 `safeNext` 是【縱深與一致性】, 不是行為需要 ——**
  //       **而那代表【沒有任何測試守得住它】: 有人改回 `next` 不會有東西紅。**
  //    ⇒ 那不是缺陷, 是這一格的天花板;寫下來免得下一個人以為有守門在看。
  const safeNext = sanitizeNextParam(next);
  const [form, setForm] = useState({ email: '', password: '', remember: true });
  // 雙通道(#181 釘死 2):fieldErrors=逐欄驗證錯、formError=帳號層級錯(頂部);互不取代。
  // oauthError(/auth/callback 失敗導回 ?error)→ 初始顯示 OAuth 失敗字面於 formError(f1-c)。
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(oauthErrorCopy(oauthError));
  // 🔴 帳號層級錯的【碼】—— 重寄按鈕靠它, 不靠字面(2026-09-05「丙」)。
  //    OAuth 失敗那條路沒有碼 ⇒ 初值 null ⇒ 按鈕不出現(對:那不是沒驗證)。
  const [formErrorCode, setFormErrorCode] = useState<string | null>(null);
  /**
   * 🔴 **字面與碼一律【一起】設** —— 它們描述的是同一件事(上一次送出的結果)。
   * 少了這一支的話,每個 `setFormError(null)` 旁邊都要記得補一發清碼;
   * 而漏一處的樣子是:**訊息清掉了而重寄按鈕還掛在那裡**(旁邊沒有任何一句話),
   * 🛑 而那個畫面**三綠全綠、也不會噴錯** —— 沒有東西會叫。
   */
  const setFormErr = (msg: string | null, code: string | null = null) => {
    setFormError(msg);
    setFormErrorCode(code);
  };
  const [pending, setPending] = useState(false);
  // 重寄驗證信(`⟦b4-SIGNUPOPEN1⟧` 前置片)。`resendNotice` 一旦有值就把按鈕換掉 ——
  // 🔵 那是刻意的:**不讓他連按**。而它不是節流(節流在 provider 那一層),
  //    它只是不再給他一顆會讓他以為「這次才真的寄出」的按鈕。
  const [resendPending, setResendPending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  /**
   * 🔴🔴 **[codex 關卡2 must-fix ②]** 換帳號要把舊提示清掉。
   *    病:帳號 A 重寄完 ⇒ 客人改填帳號 B 再登入、B 也未驗證
   *      ⇒ 舊的 `resendNotice` 還在 ⇒ **B 看到的是 A 的成功提示, 而且【沒有按鈕】** ——
   *        他會以為系統已經替 B 寄了, 而其實一封都沒有。
   *    ⇒ 📌 那不只是殘影, 是**對一個沒發生的動作報成功**。
   */
  function clearResend(): void {
    setResendNotice(null);
    setResendPending(false);
  }

  /**
   * 重寄驗證信。🛑 **不論 action 回什麼,畫面都顯示同一句** ——
   * 與 server 端的帳號列舉防護成對;在這裡分支的話,那道防護會從 client 這一側漏掉。
   * 🔵 `catch` 也走同一句:網路錯與「帳號不存在」在畫面上必須無法分辨。
   */
  async function resend(): Promise<void> {
    setResendPending(true);
    try {
      await resendSignupConfirmationAction({ email: form.email });
      setResendNotice(AUTH_RESEND_SENT_NOTICE);
    } catch {
      // 🔴🔴 **[codex 關卡2 must-fix ①]** ⛔ ~~原本這裡是空的 catch + finally 一律報成功~~
      //    ⇒ 那把 action 那道「`resolveSiteUrl()` 回 undefined 就 throw、不吞」**整個抵銷掉**:
      //      站台設定壞掉時**一封都沒寄, 而畫面說「已重新寄出」** —— 對客人說謊。
      //    ✅ 改成報系統錯。🔵 **而它不洩漏帳號**:那個 throw 發生在【呼叫 provider 之前】,
      //      判準是站台設定不是那個 email ⇒ 對任何 email 都一樣。
      //    🛑 **而 provider 的 429 / 帳號不存在【不會走到這裡】** —— action 對它們回 `{}` 不 throw
      //      ⇒ 帳號列舉防護原封不動。
      setResendNotice(AUTH_RESEND_FAILED_NOTICE);
    } finally {
      setResendPending(false);
    }
  }

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
    setFormErr(null);
    // 🔴 [codex 關卡2 must-fix ②] 一動輸入就把重寄提示清掉 —— 見 `clearResend` 上方那段。
    //    掛在這裡是因為它與 `setFormErr(null)` 是同一件事:**上一次送出的結果**,
    //    而客人一改欄位, 那個結果就不再描述他現在填的東西。
    clearResend();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // client 逐欄驗證(主防線、與 server 同一份 validateLogin)
    const v = validateLogin(form);
    if (!v.ok) {
      setFieldErrors(v.fieldErrors);
      setFormErr(null);
      return;
    }
    setFieldErrors({});
    setFormErr(null);
    setPending(true);
    // 成功時 loginAction 內 redirect(#190 導回 sanitize 過的 next、client 自動導航);
    // 失敗回 { fieldErrors }(server 重驗逐欄)或 { formError }(帳號層級)。
    const result = await loginAction(form, next);
    if (result?.fieldErrors || result?.formError) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.formError) setFormErr(result.formError, result.formErrorCode ?? null);
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
      setFormErr(GOOGLE_ERROR_COPY);
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
          {/* 🔴 副標依【他為什麼被帶來這裡】換一句(2026-08-29 Sean 拍甲「依情況換一句」)。
              病:客人在購物車按「前往結帳」⇒ `checkout/page.tsx:52` 把他導來這裡,
                 而畫面上給他的理由是「查看訂單與收藏」—— **那不是他的理由**。
                 ⇒ 不只是沒解釋, 是給了一個【別人的】理由。
              ⚠️ **下面那句新文案的【字面是我們寫的】** —— Sean 選的是「依情況換」這個方向,
                 括號裡那個例句是我們寫在選項裡的提案。**他一個字就能改, 不必問我們。**
              🔴 **為什麼是完全相等而不是 `startsWith('/checkout')`**:
                 另有一條 `/checkout/callback?order=…`(`checkout/callback/page.tsx`)——
                 那是【付款完回來】的路, 不是【要去結帳】的路 ⇒ **兩種處境不同**。
                 ⇒ 用 `startsWith` 會把那句「購物車會幫您留著」講給一個【已經付完錢】的人聽。
                 ⇒ 下面那格守門釘的就是這件事:callback 那條【必須拿到原句】。
              🛑 **而 `next` 的值一個字都不印到畫面上** —— 它是使用者可控的參數;
                 這裡只拿 `safeNext`(已過 `sanitizeNextParam` 白名單)做【相等比較】。 */}
          <p className="auth-sub">
            {safeNext === '/checkout' ? AUTH_SUB_CHECKOUT : AUTH_SUB_DEFAULT}
          </p>

          <form onSubmit={submit}>
            {/* 頂部:帳號層級錯(Email 或密碼錯誤 / OAuth 失敗);逐欄驗證錯顯示在各欄下方(釘死 2 雙通道) */}
            {formError && <div className="auth-err">{formError}</div>}
            {/* 🔴🔴 **重寄驗證信**(`⟦b4-SIGNUPOPEN1⟧` 前置片,2026-09-05;主視窗 `-f8` 裁准)
                為什麼只在這一種錯誤下出現:客人被擋在「請先收信完成 Email 驗證」時,
                **在本片之前他沒有任何路可以走** —— 自助與後台都沒有重寄入口(實測 0)
                ⇒ 他只能自己去信箱找當初那封信。
                🔴 **[2026-09-05 「丙」] 判準從【字面】換成【錯誤碼】**。
                ⛔ ~~判準用逐字相等不是 includes(兩句都含「Email」…)~~ —— 那段推理當時是對的,
                   而它解的是「字面比對怎麼比才安全」,🎯 **而真正的病是【字面在兼差】**:
                   同一個字串既給客人看、又決定按鈕出不出現
                   ⇒ 📌 **改文案就會靜靜關掉那顆按鈕, 而三綠全綠、畫面也不會壞。**
                ✅ 換成 `formErrorCode` 之後:**文案可以隨便改(甚至統一成一句), 按鈕照樣在。**
                🛑 而它**不會**讓這頁不再洩漏帳號是否存在 —— 那是板上另一列的事。
                🔵 送出後**不論結果都顯示同一句** —— 與 action 的帳號列舉防護成對;
                   在這裡分支的話,防護就白做了(它擋 server 那半,這裡會從 client 漏)。 */}
            {formErrorCode === AUTH_CODE_NEEDS_CONFIRMATION && (
              <p className="auth-resend">
                {resendNotice ? (
                  <span className="auth-ok">{resendNotice}</span>
                ) : (
                  <button type="button" onClick={resend} disabled={resendPending}>
                    {resendPending ? '寄送中…' : '重寄驗證信'}
                  </button>
                )}
              </p>
            )}
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
              {/* 🔴 #190:去程也要帶 —— 少了它,忘記密碼頁根本拿不到 next 可以帶回來。 */}
              <Link
                href={next ? `/login/forgot?next=${encodeURIComponent(safeNext)}` : '/login/forgot'}
                className="auth-forgot"
              >
                忘記密碼？
              </Link>
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
            {/* 🔴 #190:next 要跟著跳過去 —— 結帳被攔的人在這裡點「建立帳號」,next 掉光
                ⇒ 註冊完落首頁、整條結帳重走(= W11 回報的症狀換一條路走到)。
                safeNext 已過 sanitizeNextParam(:54);無 next 時它是 '/' ⇒ 不掛空參數。 */}
            第一次來？
            <Link href={next ? `/register?next=${encodeURIComponent(safeNext)}` : '/register'}>
              建立帳號
            </Link>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
