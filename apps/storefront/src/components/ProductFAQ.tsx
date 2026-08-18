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
// 標點:渲染文案用全形(逗號「，」/ 冒號「：」/ 問號「？」/ 分號「；」+ 頓號「、」句號「。」括號「（）」);
//   英文 / 程式碼維持半形。Sean 2026-06-10 Q2=B:商品詳情頁散文家族全改全形、反轉原 OD「半形家族慣例」(業務 override、鐵則 1 例外)。

import { Fragment } from 'react';
import { RPM_WARRANTY_PARAGRAPHS, type PolicyRun } from '@/data/rpm-policies';
import { safeJsonLd } from '@/lib/json-ld';

// A2(2026-07-03):FaqItem / FAQ_ITEMS / renderRuns 改 export —— /info/shipping 頁 FAQ tab
// 重用同一份全站政策 FAQ(單一真相、不抄分歧版本;渲染樣式各頁自帶)。行為零變。
export type FaqItem = { id: string; q: string; a: PolicyRun[][] };

// 單一真相:畫面(JSX)與 JSON-LD(plain text)同源衍生。
export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'order',
    q: '如何訂購？（下單・付款・配送）',
    a: [
      [{ b: '下單：' }, '確認商品是否適用後直接下單即可，如不確定歡迎直接 LINE 我們確認商品適用性與交期。'],
      [{ b: '付款：' }, '目前沒有貨到付款，可用 ', { b: '銀行轉帳、線上刷卡、LINE Pay' }, ' 支付。'],
      [{ b: '運費：' }, '宅配 $100。'],
    ],
  },
  {
    id: 'leadtime',
    q: '訂購要等多久？',
    a: [
      // 🔴 交期字面**必須與 /terms 第 7 條一致**(2026-08-18):原字面「2–6 週」比合約那份短一半,
      //   而短的那個是承諾、長的那個是合約 ⇒ 曝險在短的這邊。
      //   合約那份 = `@/data/legal-content` `TERMS_SECTIONS` 第 7 條「一般約 2–12 週」(同檔 `:133`)。
      //   🔴 **兩份字面都是 Sean 的,只是日期不同**:2026-06-03 他給 FAQ 的「2–6 週」(manifest `OD-13`)、
      //      2026-07-23 他給條款的訂貨時程「2–12 週」(`legal-content.ts:9` 逐字)。
      //      本片取較新的那份 = **施工端判斷、待 Sean 確認**,不是他拍的板。
      //   ⚠️ **不要引 `#291` Q2=A** —— 那條裁的是「出貨後 1-3 個工作天」加前綴,沒有提 FAQ、
      //      也沒有立 2–12 為正典;`CheckoutStep1.tsx` / `InfoShippingPage.tsx` 只在**註解**裡提過 2-12 週,
      //      畫面上沒有那個數 ⇒ 不成立「同站另兩處已對齊」。
      //   ⚠️ 方向只能是 FAQ 往合約靠。反過來動條款 = 鐵則 12⑤ 對外不可回收,要 Sean 拍板。
      //   ⚠️ 不是同一件事、不要順手一起改:`ProductTabs.tsx:277` / `ProductSwatchWall.tsx:95`
      //      的「1–4 個月」是【特殊樣式】另一個品類,那兩處彼此已一致。
      //   守門在 `ProductFAQ.test.tsx`:從 TERMS 第 7 條抽出週數區間、比對本字面,任一邊漂移就紅。
      [
        '預購商品為',
        { b: '下定後與原廠訂購' },
        '，需等待 2–12 週不等，部分商品等待時間較長，預估等待時間以詢問時回報之時間為準。',
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
    q: '可以到哪裡安裝？',
    a: [
      [
        '每個部品的安裝方式都不太一樣，建議找',
        { b: '熟悉相關部品的技師或車行' },
        '施工最穩。也可以預約我們的合作店家（全台都有點），安裝費用依商品與工時而定，預約時可以先問報價。不確定的話，下單前先 LINE 我們，可以幫您建議。',
      ],
    ],
  },
  {
    id: 'store',
    q: '有實體門市嗎？',
    a: [
      [
        '我們',
        { b: '以線上賣場為主' },
        '，看貨、諮詢、報價都可以直接 LINE 我們線上處理；安裝則可透過全台合作店家協助。',
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

export function renderRuns(runs: PolicyRun[]) {
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
        <p className="pd-lead">如果還有疑問，直接 LINE 問會最快。下面這些是大家最常問的。</p>
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
