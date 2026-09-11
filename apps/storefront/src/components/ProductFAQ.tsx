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
import { FREE_SHIPPING_THRESHOLD, HOME_SHIPPING_FEE } from '@pcm/domain';
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
      // 🔴 2026-09-12 Sean 貼稿改版(`~/pcm-mailbox/2026-09-12-文案改版-四頁.md`),本陣列四題照稿;
      //    保固那題仍共用 rpm-policies(稿上 FAQ Q3 那幾句不用,主視窗 09-12 同意「一份」)。
      [
        { b: '確認下單：' },
        '請核對商品適用之車型與年份後直接下單。若不確定是否吻合，歡迎先加入官方 LINE 提供愛車資訊，由專人為您確認規格與原廠交期。',
      ],
      // 🔴 **付款方式字面 = 結帳頁今天【真的做得到】的那些, 不是未來會有的**(Sean 2026-09-04 拍甲,
      //   原話逐字在 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 第二十八題):
      //   ⛔ ~~`銀行轉帳、線上刷卡、LINE Pay`~~ ⇒ ✅ **只留「線上刷卡」**。
      //   成因:結帳頁 `CheckoutStep2.tsx` 的付款方式**只有一顆 radio**、標籤逐字「信用卡付款」
      //   (該檔自己的測試還釘著「不得出現 `ATM 轉帳`」)⇒ 📌 **這一句承諾了兩種客人結不了帳的方式。**
      //   🔴 而它的受眾比看起來寬:`FAQ_ITEMS` 同時餵 **①商品頁 N°04 ②`/info/shipping` 的 FAQ tab
      //   ③FAQPage JSON-LD**(⇒ **Google 會把它當成我們的公開承諾讀走**)。
      //   🔵 **匯款開了要加回來** —— 那條線是 `-mail`(匯款結帳岔路), 已請它寫進 flag 翻開步驟。
      //   ⚠️ 舊字面留在上面那行刪除線裡, 讓搜「LINE Pay」的人同一發撞到這段。
      //   ✅ 2026-09-12:匯款已開(Sean 走第 12 步親眼看到結帳頁「ATM 轉帳」並用它下單)⇒ 加回來,
      //      用字對齊結帳頁 `CheckoutStep2.tsx` 的「ATM 轉帳」。
      [
        { b: '付款方式：' },
        '目前提供',
        { b: '線上刷卡' },
        '與',
        { b: 'ATM 轉帳' },
        '支付服務（暫無貨到付款）。',
      ],
      // 🔴 運費字面**吃常數、不 hardcode**(2026-08-18 W5):原字面 `宅配 $100。` 只講費用、不講免運門檻,
      //   而**同一個商品頁**另有兩處講門檻(`ProductInfo` 的「滿 NT$ 5,000 免運」、`ProductServices` 的
      //   「NT$ 5,000 以上免運費」)⇒ 客人在同一畫面同時讀到「要 100」與「滿 5000 免運」。
      //   🔴 而 `FAQ_ITEMS` **同時餵 JSON-LD**(見上方「單一真相」註)⇒ 分歧會被 Google 讀走。
      //   措辭直接抄同站正例 `InfoShippingPage.tsx:73`(鐵則 1:照抄不自己翻譯)。
      //   ⇒ 驗收:免運門檻若要改,全站只需要改 `packages/domain/src/order/shipping.ts` 一處。
      //   ⚠️ 那支常數的註解自己寫著它與 `create_order` RPC §7 的 `5000` / `100` **是人工同步的兩處**
      //      —— 本片沒有解那一半,不要因為這裡吃了常數就以為 DB 那邊也跟著動。
      //   🔴 09-12 改版:「本島」⇒「全台（含離島）」(對齊 /info/shipping「離島不另外加價」)。
      [
        { b: '配送運費：' },
        `全台（含離島）宅配運費 NT$ ${HOME_SHIPPING_FEE}；全館單筆訂單`,
        { b: `滿 NT$ ${FREE_SHIPPING_THRESHOLD.toLocaleString()} 即享免運` },
        '優惠。',
      ],
    ],
  },
  {
    id: 'leadtime',
    q: '訂購後需要等待多久？',
    a: [
      // 🔴 交期字面**必須與 /terms 第 7 條一致**(2026-08-18):原字面「2–6 週」比合約那份短一半,
      //   而短的那個是承諾、長的那個是合約 ⇒ 曝險在短的這邊。
      //   合約那份 = `@/data/legal-content` `TERMS_SECTIONS` 第 7 條「一般約 2–12 週」(同檔 `:133`)。
      //   🔴 **兩份字面都是 Sean 的,只是日期不同**:2026-06-03 他給 FAQ 的「2–6 週」(manifest `OD-13`)、
      //      2026-07-23 他給條款的訂貨時程「2–12 週」(`legal-content.ts:9` 逐字)。
      //      ✅ **2026-08-18 14:0x Sean 拍板 `Q-G3-1 = 甲` —— 已確認,追認 `d8c176b9` 這一顆。**
      //      送他的選項逐字:「甲 = 2–12 週(與合約一致,G3 已經改好,你確認就收工)」
      //      (落檔 memory `project_0818-four-rulings-1400.md`,G2 開檔核過原文。)
      //      ~~本片取較新的那份 = 施工端判斷、待 Sean 確認,不是他拍的板。~~
      //      🔴 **舊句劃掉留痕,而它作廢的過程本身是教訓**:拍板 14:0x 就落了 memory,
      //         **而這支檔一直到 17:2x 都還寫著「待確認」** —— 被背書的那份檔不知道自己被背書了。
      //         ⇒ 判別句:**拍板落檔的時候,那個決定【指著的那份檔】有沒有一起改?**
      //   ⚠️ **不要引 `#291` Q2=A** —— 那條裁的是「出貨後 1-3 個工作天」加前綴,沒有提 FAQ、
      //      也沒有立 2–12 為正典;`CheckoutStep1.tsx` / `InfoShippingPage.tsx` 只在**註解**裡提過 2-12 週,
      //      畫面上沒有那個數 ⇒ 不成立「同站另兩處已對齊」。
      //   ⚠️ 方向只能是 FAQ 往合約靠。反過來動條款 = 鐵則 12⑤ 對外不可回收,要 Sean 拍板。
      //   ⚠️ 不是同一件事、不要順手一起改:`ProductTabs.tsx:277` / `ProductSwatchWall.tsx:95`
      //      的「1–4 個月」是【特殊樣式】另一個品類,那兩處彼此已一致。
      //   守門在 `ProductFAQ.test.tsx`:從 TERMS 第 7 條抽出週數區間、比對本字面,任一邊漂移就紅。
      [
        '本店商品多為接單後向海外原廠排單之',
        { b: '預購與客製代訂品' },
        '，標準備貨交期約需',
        { b: '2～12 週' },
        '。',
      ],
      [
        '部分手工排產或特殊備料零件製程較長，實際交貨時間以原廠最新排程回覆為準，下單前後均可透過官方 LINE 追蹤進度。',
      ],
    ],
  },
  {
    id: 'warranty',
    q: '保固與退換貨說明',
    // 保固政策與 OD-8 ProductTabs 保固 pane 共用同一份(@/data/rpm-policies)、不分歧(Sean 2026-06-03)。
    a: RPM_WARRANTY_PARAGRAPHS,
  },
  {
    id: 'install',
    q: '購買後可以到哪裡安裝？',
    a: [
      ['進口改裝零組件之精度與安裝工序各有不同，建議交由熟悉該品牌的專業技師或合格車行施工。'],
      [
        '本店於全台各地皆有',
        { b: '合作店家' },
        '可配合預約施工。安裝工資依車款難易度與工時透明報價，下單前後歡迎隨時透過官方 LINE 諮詢合作據點與預約推薦。',
      ],
    ],
  },
  {
    id: 'store',
    q: '有實體門市可以看現貨嗎？',
    a: [
      [
        '本店以',
        { b: '線上專屬訂購模式' },
        '為主，以提供最完整的海外零件選單與精準配給服務。看貨諮詢、車型配適確認與報價需求，皆可直接透過官方 LINE 線上處理；後續施工安裝則由全台合作店家網絡全力支援。',
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
