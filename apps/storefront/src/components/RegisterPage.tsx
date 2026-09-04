// RegisterPage.tsx — 註冊頁(M-1-14e-f1-b、#181 表單 UX 強化)
//
// 字面從 design-reference/components/AccountPages.jsx RegisterPage(L256-308)直接搬(鐵則 1、不翻譯):
// - controlled form 維持 design 形狀(name/email/phone/password/agree)
// - 無社交鈕(design L256-308 確無、D-e、鐵則 1;PRD §8.2 誤抄已由 plan v4 更正)
// - 路由 adaptation(同 LoginPage、鐵則 1 例外類別 2 技術實作):
//   · <Header currentPage="register" onNav> → <Header currentPage="register" />(storefront Header 內走 next/link)
//   · <Footer onNav> → <HomeFooter />
//   · onNav('login')「登入」→ <Link href="/login">
//   · submit localStorage mock → registerAction server action(逐欄驗證 + registerCustomer、信任邊界在 server)
//
// #181 business override(鐵則 1 設計為基底、Sean 2026-05-25 Q1=B/Q2=B 拍板、4 點釘死):
// - 全欄必填標(Q1=B):姓名/Email/手機/密碼 label 一律加全形「（必填）」(沿用 f1-b 手機既有格式、4 欄統一)。
// - 逐欄 inline error(Q2=B):errors.{欄} 顯示在該欄 input 下方(取代 design 單一頂部 .auth-err 之「驗證」用途);
//   空欄專屬「請填寫…」、非空格式錯沿用 zod(共用 validateRegister、client/server 同一份)。
// - 雙通道並存(釘死 2):頂部 .auth-err 保留給「帳號層級錯」(此 Email 已註冊 / Email 驗證提示 = formError),
//   逐欄 .auth-field-err 給「欄位驗證錯」(fieldErrors);兩通道互不取代、可同時顯示。
// - D-g=A 手機必填(鐵則 1 design override):design L261 presence 放行空手機,業務必填 →「手機（必填）」label
//   + client/server 皆檢 phone(server `RegisterInput.parse` 權威)
//     ⛔ ~~phone regex~~ ⇒ **2026-09-04 Sean 拍甲:只擋空、不驗格式**(`⟦b4-PHONEREGEXSPLIT⟧`)。

'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { registerAction } from '@/app/register/actions';
import { validateRegister, type RegisterFieldErrors } from '@/lib/auth/field-validation';
// 🔴 顯示字面的【唯一真相】—— 不在本檔重打那三個中文字(見 @pcm/schemas 那一節)。
import { GENDER_CODES, GENDER_LABEL } from '@pcm/schemas';

export function RegisterPage({ next }: { next?: string } = {}) {
  // 🔵 gender 預設 '' = 沒選(選填)。送出時 '' 會被轉成 undefined ⇒ 不進 options.data。
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', agree: false, gender: '' });
  // 雙通道(#181 釘死 2):fieldErrors=逐欄驗證錯、formError=帳號層級錯(頂部);互不取代。
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // 🔵 第三通道(2026-08-31 `-15`):非錯誤的頂部訊息。**刻意不進 clearErr** —— 見下方註解。
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * 一開始改某一欄就清那一欄的 inline 錯 + 頂部帳號層級錯(2026-08-08 全站掃測 B 級;四張表單同形)。
   * 完整理由見 `LoginPage.tsx` 同名函式的註解(只清被動那欄 / formError 一律清 / 無錯時回原值讓 React bail out)。
   *
   * ✅ **[2026-08-31 `-15` 已處理]** —— 下面那段是**處理之前**的原文,一字不刪,
   *    因為它把失效條件寫得比任何事後說明都清楚。**做法採它給的第一個選項:改走非 error 通道。**
   *    ⇒ `register/actions.ts` 現在回 `formNotice`(不是 `formError`),而 `formNotice`
   *      **不在本函式清除的範圍裡** ⇒ 客人按鍵不會弄丟他唯一的成功訊號。
   *    🔴 而它是【客人看得到的】錯,不是內部整潔:成功訊息用紅底錯誤樣式呈現 + 一按鍵就消失
   *      ⇒ 客人重送 ⇒ 拿到「此 Email 已註冊」⇒ **以為註冊失敗**。
   *
   * 🛑 ~~**本頁的 formError 不只裝錯誤**(R1 must-fix,LoginPage 那句「它講的是上一次送出的
   *    **錯誤**」在本頁範圍不足):`register/actions.ts:75` 會用同一個通道回
   *    「註冊成功,請至信箱完成 Email 驗證後再登入。」。今天走不到那條分支
   *    (`actions.ts:73-74` 註明 confirm email 前置為 OFF、預期不命中),所以清掉無害。
   *    ⚠️ **失效條件**:#173 把 confirm email 重開的那一刻,這裡就會把客人唯一的成功訊號
   *    一按鍵清掉(他會重送 → 拿到「此 Email 已註冊」→ 以為註冊失敗)。
   *    重開 #173 的人必須連帶處理:成功訊息改走非 error 通道,或本函式排除該字面。~~
   *
   * 🔴 與 LoginPage 的差異:**本頁的「同意條款」checkbox 要接**。`agree` 是 `RegisterField`
   *    的一員(`field-validation.ts:26`)、有自己的 `fieldErrors.agree`;而 LoginPage 的
   *    「記住我」不是驗證欄、勾了不代表在修正任何錯 ⇒ 那邊不接。判準是「這欄有沒有自己的錯」,
   *    不是「它是不是 checkbox」。
   */
  const clearErr = (k: keyof RegisterFieldErrors) => {
    setFieldErrors((prev) => (prev[k] === undefined ? prev : { ...prev, [k]: undefined }));
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // client 逐欄驗證(主防線、與 server 同一份 validateRegister)
    // 🔵 '' 是「沒選」,不是一個值 ⇒ 轉成 undefined,讓 zod 的 .optional() 放行、
    //    也讓它不進 options.data(見 SupabaseAuthAdapter 那段註解)。
    const payload = { ...form, gender: form.gender === '' ? undefined : form.gender };
    const v = validateRegister(payload);
    if (!v.ok) {
      setFieldErrors(v.fieldErrors);
      setFormError(null);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    // 送出新的一發時才清 notice(它代表上一次送出的結果);按鍵不清 —— 見 clearErr。
    setFormNotice(null);
    setPending(true);
    // 成功(直登)時 registerAction 內 redirect(#190 導回 sanitize 過的 next、client 自動導航);
    // 失敗回 { fieldErrors }(server 重驗逐欄)或 { formError }(帳號層級)。
    const result = await registerAction(payload, next);
    if (result?.fieldErrors || result?.formError || result?.formNotice) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.formError) setFormError(result.formError);
      if (result.formNotice) setFormNotice(result.formNotice);
      setPending(false);
    }
  };

  return (
    <div className="ap-page">
      <Header currentPage="register" />
      <main className="auth-main">
        <div className="auth-card">
          <div className="ap-mono">N°02 · Sign up</div>
          <h1>加入 PCM</h1>
          <p className="auth-sub">建立帳號，享會員價與專屬優惠。</p>

          <form onSubmit={submit}>
            {/* 頂部:帳號層級錯(此 Email 已註冊 等);逐欄驗證錯顯示在各欄下方(釘死 2 雙通道) */}
            {formError && <div className="auth-err">{formError}</div>}
            {/* 非錯誤的頂部訊息(confirm email 重開後的「請收信驗證」)。與 .auth-err 互不取代。 */}
            {formNotice && <div className="auth-ok">{formNotice}</div>}
            <label className="auth-field">
              <span>姓名（必填）</span>
              <input
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); clearErr('name'); }}
                placeholder="王小明"
              />
              {fieldErrors.name && <span className="auth-field-err">{fieldErrors.name}</span>}
            </label>
            <label className="auth-field">
              <span>Email（必填）</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => { setForm({ ...form, email: e.target.value }); clearErr('email'); }}
                placeholder="your@email.com"
              />
              {fieldErrors.email && <span className="auth-field-err">{fieldErrors.email}</span>}
            </label>
            <label className="auth-field">
              <span>手機（必填）</span>
              {/* 手機欄叫數字鍵盤 —— 形狀抄 CheckoutStep1.tsx:175-181 的 email 欄(type/inputMode/autoComplete 三件套)。
                  ⛔ ~~autoComplete 用 `tel-national` 不用 `tel`:因為 phone regex `/^[\d\s-]{8,}$/` 不收 `+`~~
                  🔴🔴 **那個【理由】2026-09-04 起不成立了**(Sean 拍甲:不驗格式 ⇒ `+886` 現在收得下)。
                  ⚠️ **而值我沒有動** —— `tel` vs `tel-national` 會改變瀏覽器自動填入什麼,
                     那是 Sean 的品味/行為決定, 不是我順手改的東西。**留著 + 標明理由已失效。**
                  📌 代價明寫:通訊錄存 `+886…` 的人, 自動填入仍會被降級成國內格式 ——
                     而**拍板要救的正是這種人**。⇒ 要不要換成 `tel`, 端他。
                     ⇒ 用 `tel` 會讓通訊錄存國際格式的人一按自動填入就撞「手機格式不正確」。
                  不加 pattern:placeholder 就是 `0912 345 678`(帶空白),pattern="[0-9]*" 會擋掉照著打的人;
                     且本表單是 <form onSubmit>,pattern 失敗會被瀏覽器攔在 submit 前 ⇒ 逐欄 inline error 那條路整條不跑。 */}
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={form.phone}
                onChange={(e) => { setForm({ ...form, phone: e.target.value }); clearErr('phone'); }}
                placeholder="0912 345 678"
              />
              {fieldErrors.phone && <span className="auth-field-err">{fieldErrors.phone}</span>}
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
            {/* ══ 性別(選填)══════════════════════════════════════════════════
                🔴 **這一欄只對【用 Email 註冊的人】有效** —— Google 一鍵與 LINE 進來的人
                   從頭到尾不會看到這張表單,他們的 `customers.gender` 恆為 NULL。
                   那是結構,不是漏做。⇒ 任何「客人性別分布」的統計都只涵蓋這條路進來的人,
                   **而那個偏差在報表上沒有形狀**。(同一句話也寫在 DB 那一欄的 COMMENT 裡,
                   因為做報表的人不會讀這支檔。)
                🔵 顯示中文、**送代碼** —— 對應表在 `@pcm/schemas` 的 `GENDER_LABEL`,
                   改文案只改那裡,DB 值域一動都不用動。 */}
            <label className="auth-field">
              <span>性別（選填）</span>
              <select
                value={form.gender}
                onChange={(e) => { setForm({ ...form, gender: e.target.value }); clearErr('gender'); }}
              >
                <option value="">不選擇</option>
                {GENDER_CODES.map((code) => (
                  <option key={code} value={code}>{GENDER_LABEL[code]}</option>
                ))}
              </select>
              {fieldErrors.gender && <span className="auth-field-err">{fieldErrors.gender}</span>}
            </label>
            <label className="auth-check auth-check-full">
              <input
                type="checkbox"
                checked={form.agree}
                onChange={(e) => { setForm({ ...form, agree: e.target.checked }); clearErr('agree'); }}
              />
              {/* #291(2026-07-24):原為死連結 href="#",已接真頁面。
                  `target="_blank"`:避免填到一半的註冊表單被導航沖掉。
                  ⚠️ 連結雖在 <label> 內,但 a[href] 屬 interactive content、被 HTML 規格排除在
                  label activation 之外 → 點它不會誤勾同意(2026-07-24 真瀏覽器實測 + 對照組確認;
                  詳 CheckoutStep2ReviewSections.tsx 同段註解)。故不掛 stopPropagation。 */}
              <span>
                我同意{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer">
                  服務條款
                </a>{' '}
                與{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer">
                  隱私政策
                </a>
              </span>
            </label>
            {fieldErrors.agree && <span className="auth-field-err">{fieldErrors.agree}</span>}
            <button type="submit" className="auth-submit" disabled={pending}>建立帳號</button>
          </form>

          <div className="auth-foot">
            {/* 🔴 #190:反方向同款 —— 這裡掉了 next,登入完一樣落首頁。 */}
            已有帳號？
            <Link href={next ? `/login?next=${encodeURIComponent(sanitizeNextParam(next))}` : '/login'}>
              登入
            </Link>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
