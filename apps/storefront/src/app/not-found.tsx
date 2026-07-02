// app/not-found.tsx — 全站 404 頁(A3、2026-07-03)
//
// 字面從 design-reference/components/ErrorPage.jsx 直接搬(404 變體、type=404:
// num/eyebrow/title/desc 逐字、showSupport=false 不渲染 err-support 段)。
// design harness 轉譯(對齊既有慣例、非視覺偏離):
//   - onNav('home') / onNav('catalog') button → Next <Link href="/">/<Link href="/products">
//     (design btn-primary/btn-outline class 字面保留;btn-outline=checkout.css 全域版與 design
//      shared 逐字同;btn-primary 全域僅 cart.css 精簡版 → design shared 缺的屬性折入
//      error.css .err-btn-primary scope、見該檔註解〔code-reviewer F1〕)
//   - <Header currentPage="error" onNav> → <Header currentPage="error" />(storefront Header 慣例)
//   - <Footer onNav> → <HomeFooter />(design Footer 即 SiteFooter delegate)
//   - data-screen-label 保留
// CSS = styles/error.css(design error.css 逐字搬、layout.tsx 全域 import 對齊 design 序)。
// 500 變體不搬(Next error boundary 屬 error.tsx 職責、另 slice;本片只補 404)。
// 內容分級 L1(文案年 0-1 次改動、hardcode 可)。

import Link from 'next/link';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';

export const metadata: Metadata = {
  title: '找不到這個頁面 — PCM Motorsports',
};

export default function NotFound() {
  return (
    <div data-screen-label="Error 404" className="err-page">
      <Header currentPage="error" />
      <main className="err-main">
        <div className="err-inner">
          <div className="err-num" aria-hidden="true">404</div>
          <div className="ap-mono err-eyebrow">N°404 · Not Found</div>
          <h1 className="err-title">找不到這個頁面</h1>
          <p className="err-desc">您訪問的頁面可能已被移動或不存在。試試從首頁開始?</p>
          <div className="err-cta">
            <Link href="/" className="btn-primary err-btn-primary">
              回首頁
              <span>→</span>
            </Link>
            <Link href="/products" className="btn-outline err-btn-outline">
              商品目錄
            </Link>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
