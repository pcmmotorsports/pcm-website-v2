// RegisterPage.tsx — 註冊頁(M-1-14e-f1-b)
//
// 字面從 design-reference/components/AccountPages.jsx RegisterPage(L256-308)直接搬(鐵則 1、不翻譯):
// - controlled form 維持 design 形狀(name/email/phone/password/agree)
// - 無社交鈕(design L256-308 確無、D-e、鐵則 1;PRD §8.2 誤抄已由 plan v4 更正)
// - 路由 adaptation(同 LoginPage、鐵則 1 例外類別 2 技術實作):
//   · <Header currentPage="register" onNav> → <Header currentPage="register" />(storefront Header 內走 next/link)
//   · <Footer onNav> → <HomeFooter />
//   · onNav('login')「登入」→ <Link href="/login">
//   · submit localStorage mock → registerAction server action(RegisterInput.parse + registerCustomer、信任邊界在 server)
// - D-g=A 手機必填(鐵則 1 design override、Sean 2026-05-24 拍):design L261 presence 檢查放行空手機
//   (只檢 name/email/password),本案業務必填(PCM 接單/配送需手機)→ ① 手機 label 顯式「（必填）」affordance
//   ② client presence 檢查含 phone ③ 權威驗證仍 server RegisterInput.parse(phone required regex、不改 schema);
//   非靠 server 靜默報錯。
// - 客端 presence 字面用 design「請填寫必要欄位」(L261)/「請同意服務條款」(L262)。

'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { registerAction } from '@/app/register/actions';

export function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', agree: false });
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // D-g=A:phone 納入必填 presence(design L261 原只檢 name/email/password、放行空手機)
    if (!form.name || !form.email || !form.phone || !form.password) {
      setErr('請填寫必要欄位');
      return;
    }
    if (!form.agree) {
      setErr('請同意服務條款');
      return;
    }
    setErr(null);
    setPending(true);
    // 成功(直登)時 registerAction 內 redirect(導 '/'、client 自動導航);失敗回 { error } 顯示 auth-err。
    const result = await registerAction(form);
    if (result?.error) {
      setErr(result.error);
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
            {err && <div className="auth-err">{err}</div>}
            <label className="auth-field">
              <span>姓名</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="王小明"
              />
            </label>
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="your@email.com"
              />
            </label>
            <label className="auth-field">
              {/* D-g=A 手機必填顯式 affordance(鐵則 1 design override、business 拍板;design 原為「手機」) */}
              <span>手機（必填）</span>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="0912 345 678"
              />
            </label>
            <label className="auth-field">
              <span>密碼</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="至少 8 碼"
              />
            </label>
            <label className="auth-check auth-check-full">
              <input
                type="checkbox"
                checked={form.agree}
                onChange={(e) => setForm({ ...form, agree: e.target.checked })}
              />
              <span>我同意 <a href="#">服務條款</a> 與 <a href="#">隱私政策</a></span>
            </label>
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
