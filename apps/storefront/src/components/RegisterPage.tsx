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
//   + client/server 皆檢 phone(server RegisterInput.parse phone regex 權威、不改 schema)。

'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { registerAction } from '@/app/register/actions';
import { validateRegister, type RegisterFieldErrors } from '@/lib/auth/field-validation';

export function RegisterPage({ next }: { next?: string } = {}) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', agree: false });
  // 雙通道(#181 釘死 2):fieldErrors=逐欄驗證錯、formError=帳號層級錯(頂部);互不取代。
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // client 逐欄驗證(主防線、與 server 同一份 validateRegister)
    const v = validateRegister(form);
    if (!v.ok) {
      setFieldErrors(v.fieldErrors);
      setFormError(null);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setPending(true);
    // 成功(直登)時 registerAction 內 redirect(#190 導回 sanitize 過的 next、client 自動導航);
    // 失敗回 { fieldErrors }(server 重驗逐欄)或 { formError }(帳號層級)。
    const result = await registerAction(form, next);
    if (result?.fieldErrors || result?.formError) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.formError) setFormError(result.formError);
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
            <label className="auth-field">
              <span>姓名（必填）</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="王小明"
              />
              {fieldErrors.name && <span className="auth-field-err">{fieldErrors.name}</span>}
            </label>
            <label className="auth-field">
              <span>Email（必填）</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="your@email.com"
              />
              {fieldErrors.email && <span className="auth-field-err">{fieldErrors.email}</span>}
            </label>
            <label className="auth-field">
              <span>手機（必填）</span>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="0912 345 678"
              />
              {fieldErrors.phone && <span className="auth-field-err">{fieldErrors.phone}</span>}
            </label>
            <label className="auth-field">
              <span>密碼（必填）</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="至少 8 碼"
              />
              {fieldErrors.password && <span className="auth-field-err">{fieldErrors.password}</span>}
            </label>
            <label className="auth-check auth-check-full">
              <input
                type="checkbox"
                checked={form.agree}
                onChange={(e) => setForm({ ...form, agree: e.target.checked })}
              />
              <span>我同意 <a href="#">服務條款</a> 與 <a href="#">隱私政策</a></span>
            </label>
            {fieldErrors.agree && <span className="auth-field-err">{fieldErrors.agree}</span>}
            <button type="submit" className="auth-submit" disabled={pending}>建立帳號</button>
          </form>

          <div className="auth-foot">
            已有帳號？<Link href="/login">登入</Link>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
