// LegalDocPage.tsx — 服務條款 / 隱私政策 共用版面(#291、2026-07-24)
//
// 純 presentational、無互動 → server component(不加 'use client')。
// 🔴 **零新增 CSS**:版面重用既有 `.page-hero` 家族與 `.policy-block`
// (`styles/pages-shipping.css`,已於 `app/layout.tsx:54` 全域載入)——與 /info/shipping 同款,
// 法律頁因此天生與站上其他資訊頁一致,不自創樣式(避免多一份要維護的 CSS)。
// 🔴 檔名刻意**不叫** `LegalPage` —— `design-reference/components/LegalPage.jsx` 是**草稿**
// (含假聯絡資訊與衝突條文),本頁內容一律取自 `data/legal-content.ts`,避免日後誤讀為同源。
//
// 內容與版面分離:文字全在 `data/legal-content.ts`(單一真相),本檔只負責渲染。

import Link from 'next/link';
import { Header } from './Header';
import { HomeFooter } from './HomeFooter';
import { LEGAL_LAST_UPDATED, LEGAL_UI_STRINGS, type LegalSection } from '@/data/legal-content';

type LegalDocPageProps = {
  /** 麵包屑最後一段與 hero 標題 */
  title: string;
  subtitle: string;
  sections: LegalSection[];
  /** e2e / design harness 用的畫面標記(對齊既有頁慣例) */
  screenLabel: string;
};

export function LegalDocPage({ title, subtitle, sections, screenLabel }: LegalDocPageProps) {
  return (
    <div data-screen-label={screenLabel}>
      {/* currentPage 給一個不對應任何導覽項的值 → 導覽列不誤標任何頁為 active */}
      <Header currentPage="legal" />
      <section className="page-hero">
        <div className="page-hero-inner">
          <nav className="pp-breadcrumb">
            <Link href="/">{LEGAL_UI_STRINGS.breadcrumbHome}</Link>
            <span>›</span>
            <span>{title}</span>
          </nav>
          <h1 className="page-hero-title">{title}</h1>
          <p className="page-hero-subtitle">{subtitle}</p>
        </div>
      </section>
      <div className="shipping-body">
        <div className="shipping-content">
          {sections.map((section) => (
            <div key={section.heading} className="policy-block">
              <h3>{section.heading}</h3>
              {section.paragraphs?.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
              {section.items && section.items.length > 0 && (
                <ul>
                  {section.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div className="policy-block">
            <p>
              {LEGAL_UI_STRINGS.lastUpdatedLabel}
              {LEGAL_LAST_UPDATED}
            </p>
          </div>
        </div>
      </div>
      <HomeFooter />
    </div>
  );
}
