// InfoShippingPage.tsx — /info/shipping 配送 & 退貨政策頁(A2、2026-07-03)
//
// 版面字面從 design-reference/components/Pages.jsx ShippingPage(L751-835)直接搬:
// PageHero(breadcrumbs/title/subtitle 逐字)+ 三 tab(配送方式/退換貨/常見問題)+
// shipping-card / shipping-note / policy-block / faq-item 結構。design harness 轉譯:
// onNav breadcrumb → Next <Link>;React.useState → useState。
//
// 🔴 內容 = 業務事實、以既有 SSoT 為準、design 示意文案衝突處不搬(字面 vs 事實):
// 1. 免運門檻:design「NT$4000」→ FREE_SHIPPING_THRESHOLD(5,000;#161 Sean 拍板永久)。
// 2. 運費:design「NT$150」→ HOME_SHIPPING_FEE(100;@pcm/domain、checkout 同源)。
// 3. design「合作店家取貨」卡不搬:checkout Q1=A 拍板配送只「貨運宅配」(CheckoutView L24)。
// 4. 🔴 design returns tab「7 天鑑賞期可退」與 PCM 真實政策相反 —— 本店為客製化委任代購、
//    依消保法 19 條不適用鑑賞期(rpm-policies.ts = Sean 釘的法律主張單一真相、
//    「不得各自抄分歧版本」)→ returns tab 改渲染 RPM_WARRANTY_PARAGRAPHS + NOTES。
// 5. FAQ tab 重用 ProductFAQ.FAQ_ITEMS(全站政策 FAQ 單一真相),不搬 design 5 題示意
//    (其中「三聯式發票」「安裝費線上預約」為未實現承諾、不上線)。
// 6. 海外配送 note:design「離島另行報價」軟化為「請先 LINE 聯絡確認」(不做未證實報價承諾)。
// 內容分級:政策文案 = L1/L2(hardcode + SSoT 常數;後台化見 #248/site_policies LOG)。

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FREE_SHIPPING_THRESHOLD, HOME_SHIPPING_FEE } from '@pcm/domain';
import { Header } from './Header';
import { HomeFooter } from './HomeFooter';
import { FAQ_ITEMS, renderRuns } from './ProductFAQ';
import { RPM_WARRANTY_PARAGRAPHS, RPM_WARRANTY_NOTES } from '@/data/rpm-policies';

const TABS = [
  ['shipping', '配送方式'],
  ['returns', '退換貨'],
  ['faq', '常見問題'],
] as const;

export function InfoShippingPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('shipping');

  return (
    <div data-screen-label="Shipping">
      <Header currentPage="shipping" />
      <section className="page-hero">
        <div className="page-hero-inner">
          <nav className="pp-breadcrumb">
            <Link href="/">首頁</Link>
            <span>›</span>
            <span>配送 & 退貨</span>
          </nav>
          <h1 className="page-hero-title">配送 & 退貨政策</h1>
          <p className="page-hero-subtitle">讓您安心下單的承諾</p>
        </div>
      </section>
      <div className="shipping-body">
        <div className="shipping-tabs">
          {TABS.map(([v, l]) => (
            <button key={v} className={tab === v ? 'is-on' : ''} onClick={() => setTab(v)}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'shipping' && (
          <div className="shipping-content">
            <div className="shipping-grid">
              <div className="shipping-card">
                <div className="shipping-card-num">01</div>
                <div className="shipping-card-title">貨運宅配</div>
                <div className="shipping-card-desc">
                  單筆滿 NT$ {FREE_SHIPPING_THRESHOLD.toLocaleString()} 免運，到府配送
                </div>
                <div className="shipping-card-meta">
                  <span>
                    運費 NT$ {HOME_SHIPPING_FEE}（滿 NT$ {FREE_SHIPPING_THRESHOLD.toLocaleString()} 免運）
                  </span>
                  {/* 🔴 #291(Sean 07-24 拍 Q2=A):加「出貨後」—— 原字面與 /terms 第 10 條的
                      「訂貨約 2-12 週」並列時,會被讀成三天到貨的交期承諾。這裡指的是出貨後的宅配時間。 */}
                  <span>出貨後 1-3 個工作天</span>
                </div>
              </div>
            </div>
            <div className="shipping-note">
              <strong>離島與海外配送</strong>
              <p>目前配送範圍為台灣本島；離島與海外請下單前先透過 LINE 聯絡我們確認。</p>
            </div>
          </div>
        )}

        {tab === 'returns' && (
          <div className="shipping-content">
            <div className="policy-block">
              <h3>退換貨政策</h3>
              {RPM_WARRANTY_PARAGRAPHS.map((para, i) => (
                <p key={i}>{renderRuns(para)}</p>
              ))}
            </div>
            <div className="policy-block">
              <h3>補充說明</h3>
              <ul>
                {RPM_WARRANTY_NOTES.map((note, i) => (
                  <li key={i}>{renderRuns(note)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {tab === 'faq' && (
          <div className="shipping-content">
            {FAQ_ITEMS.map((item) => (
              <details key={item.id} className="faq-item">
                <summary>{item.q}</summary>
                {item.a.map((para, pi) => (
                  <p key={pi}>{renderRuns(para)}</p>
                ))}
              </details>
            ))}
          </div>
        )}
      </div>
      <HomeFooter />
    </div>
  );
}
