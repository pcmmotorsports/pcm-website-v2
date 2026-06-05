// ProductFAQ.tsx — 商品詳細頁 N°04「常見問題」FAQ 手風琴 + FAQPage JSON-LD
//
// OD-10(視覺真權威 OD product-detail-rpm-template.html §N°FAQ、鐵則 1 直接搬;
//   Sean 2026-06-02 Q1 override:N°03 留相關商品、FAQ 變 N°04 放下面 + FAQPage JSON-LD 同格式):
// - 結構 + 字面直接搬 OD 模板 FAQ:eyebrow(義體 04 + 金線 + N° 常見問題)+ h2 / lead +
//   .faq-list > details.faq-item(原生 <details>/<summary>、純 CSS 手風琴、+→× 旋轉、無需 JS)。
// - **RPM 共用區塊**(OD 模板註「RPM 共用」、全站政策性 FAQ)→ prop-less、純 presentational、無 hooks。
//   原生 <details> 不需 'use client';由 client parent ProductPage import 進 client bundle、仍 SSR 出 HTML。
// - FAQPage JSON-LD(GEO/SEO):<script type="application/ld+json"> 隨 section SSR 進初始 HTML、
//   答案文字由同一份 FAQ_ITEMS 結構衍生(plainAnswer)、與畫面內容單一真相、不會漂移。
// - 編號:OD 模板原 eb-no「03」、本站 Sean Q1 override 為 N°04(相關商品佔 N°03)。
//
// 🔴 FAQ item「保固與退換貨」**直接共用 @/data/rpm-policies 的 RPM_WARRANTY_PARAGRAPHS**、
//   與 ProductTabs 保固 pane(OD-8)同一份(Sean 2026-06-03 釘:別寫分歧版本;鑑賞期免除是法律主張、
//   Sean 仍在確認準確性、改字面只動 rpm-policies)。其餘 4 題為 FAQ 專屬字面(直接搬 OD FAQ)。
//
// 標點:半形逗號「,」/ 冒號「:」/ 問號「?」對齊產品頁元件家族慣例;頓號「、」句號「。」括號「（）」依 OD。

import { Fragment } from 'react';
import { RPM_WARRANTY_PARAGRAPHS, type PolicyRun } from '@/data/rpm-policies';
import { safeJsonLd } from '@/lib/json-ld';

type FaqItem = { id: string; q: string; a: PolicyRun[][] };

// 單一真相:畫面(JSX)與 JSON-LD(plain text)同源衍生。
const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'order',
    q: '如何訂購?（下單・付款・配送）',
    a: [
      [{ b: '下單:' }, '確認商品是否適用後直接下單即可,如不確定歡迎直接 LINE 我們確認商品適用性與交期。'],
      [{ b: '付款:' }, '目前沒有貨到付款,可用 ', { b: '銀行轉帳、線上刷卡、LINE Pay' }, ' 支付。'],
      [{ b: '運費:' }, '宅配 $100、超商取貨 $60。'],
    ],
  },
  {
    id: 'leadtime',
    q: '訂購要等多久?',
    a: [
      [
        '預購商品為',
        { b: '下定後與原廠訂購' },
        ',需等待 2–6 週不等,部分商品等待時間較長,預估等待時間以詢問時回報之時間為準。',
      ],
    ],
  },
  {
    id: 'warranty',
    q: '保固與退換貨',
    // 保固政策與 OD-8 ProductTabs 保固 pane 共用同一份(@/data/rpm-policies)、不分歧(Sean 2026-06-03)。
    a: RPM_WARRANTY_PARAGRAPHS,
  },
  {
    id: 'install',
    q: '可以到哪裡安裝?',
    a: [
      [
        '每個部品的安裝方式都不太一樣,建議找',
        { b: '熟悉相關部品的技師或車行' },
        '施工最穩。也可以預約我們的合作店家（全台都有點）,安裝費用依商品與工時而定,預約時可以先問報價。不確定的話,下單前先 LINE 我們,可以幫你建議。',
      ],
    ],
  },
  {
    id: 'store',
    q: '有實體門市嗎?',
    a: [
      [
        '我們',
        { b: '以線上賣場為主' },
        ',看貨、諮詢、報價都可以直接 LINE 我們線上處理;安裝則可透過全台合作店家協助。',
      ],
    ],
  },
];

// plain text(JSON-LD acceptedAnswer.text):段落以換行接、bold run 去標記只取文字
function plainAnswer(item: FaqItem): string {
  return item.a
    .map((para) => para.map((run) => (typeof run === 'string' ? run : run.b)).join(''))
    .join('\n');
}

const FAQ_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: plainAnswer(item) },
  })),
};

function renderRuns(runs: PolicyRun[]) {
  return runs.map((run, i) =>
    typeof run === 'string' ? <span key={i}>{run}</span> : <strong key={i}>{run.b}</strong>,
  );
}

export function ProductFAQ() {
  return (
    <section className="pd-section" aria-labelledby="pd-h-faq">
      {/* FAQPage JSON-LD — GEO/SEO、SSR 進初始 HTML、答案與畫面同源(plainAnswer)。
          safeJsonLd escape `<` 防 </script> breakout(2026-06-05 安全稽核 M-2、與 product-jsonld 同源)。 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(FAQ_JSONLD) }}
      />
      <div className="pd-section-head">
        <div className="pd-eyebrow">
          <span className="pd-eb-no">04</span>
          <span className="pd-eb-sep" aria-hidden="true" />
          <span className="pd-eb-label">{'N°  常見問題'}</span>
        </div>
        <h2 className="pd-h2" id="pd-h-faq">下單前常被問到的問題</h2>
        <p className="pd-lead">如果還有疑問,直接 LINE 問會最快。下面這些是大家最常問的。</p>
      </div>

      <div className="faq-list">
        {FAQ_ITEMS.map((item) => (
          <details className="faq-item" key={item.id}>
            <summary>
              {item.q}
              <span className="faq-icon" aria-hidden="true">
                +
              </span>
            </summary>
            <div className="faq-body">
              {item.a.map((para, pi) => (
                <Fragment key={pi}>
                  {pi > 0 && <br />}
                  {renderRuns(para)}
                </Fragment>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
