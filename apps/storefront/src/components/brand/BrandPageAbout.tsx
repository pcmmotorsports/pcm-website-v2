// BrandPageAbout.tsx — 品牌介紹頁的 About 區(D2c-1;2026-08-04)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 :1386-1411、組裝邏輯 :1851-1854 與 :1958-1968、CSS :659-688 與 :961)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD)。
//
// 🔴 右欄「一次只放一個東西」(設計稿 :1958 逐字):
//    有官方影片 → 放影片;沒有才退回產品照卡;兩者皆無 → 整列收成兩欄、正文吃回右邊那格。
//    **影片右欄是 D2c-2**(要 client 元件 + 點擊才掛 iframe)。本片只做產品照那條路,
//    並把「有影片時不渲染產品照」的分流先立起來 —— 否則 D2c-2 接上去時會兩個都出現。
//
// ⚠️ 實測分布(2026-08-04):20 家全部有 aside,其中 11 家同時有 video
//    ⇒ **真正看得到產品照卡的只有 9 家**;而「兩者皆無」的兩欄退化態在現有資料下**不可達**。
//    不可達 ≠ 不會壞:D3 之後若有人新增一家沒圖沒片的品牌,那條路才第一次被走到。
//    守門靠測試(本片)與 CSS 文字層(brand-page.test.ts),不能靠肉眼看。

import type { BrandContent } from '@/data/brand-content-types';
import { BrandRichText } from '@/components/BrandRichText';
import { brandAsset } from './BrandPageHeader';
import '@/styles/brand-page.css';

export function BrandPageAbout({ brand }: { brand: BrandContent }) {
  // 右欄分流:影片優先,其次產品照。影片本體 D2c-2 接;本片只負責「有影片就不放產品照」。
  const showAside = !brand.video && brand.aside !== undefined;

  // 🔴 `no-aside` 反映的是「右欄**這一刻**有沒有東西」,不是「最終會不會有東西」。
  //    設計稿最終狀態下,有 video 的品牌右欄放影片、不掛 no-aside(:1967-1968);
  //    但 **D2c-1 還沒有影片元件** —— 這時就照最終狀態不掛的話,那 11 家會保留
  //    `200px .8fr minmax(420px,1.2fr)` 三軌卻只有兩個子元素:正文被壓進 .8fr、
  //    第三軌整片空(1440 實測約 629px 死白)。每一片都要在它自己落地的當下是對的。
  //    ⇒ D2c-2 加上影片渲染時,這一行同步改成 `showAside || brand.video !== undefined`。
  const hasRightColumn = showAside;

  return (
    <section className="bp-about">
      <div className={`bp-about-inner${hasRightColumn ? '' : ' no-aside'}`}>
        <div className="bp-sec-label">About</div>
        <div className="bp-body">
          {/* lead / tail 帶白名單標記(設計稿 :1852/:1854 **不 esc**)⇒ 過 BrandRichText */}
          <BrandRichText as="p">{brand.about.lead}</BrandRichText>
          {/* 🔴 pull 是**純文字**:設計稿 :1853 對它走 esc(),與 lead/tail 不同。
              實測 20 家的 pull 零標記,兩邊一致。空字串 ⇒ 整個 <p> 不建(不是建一個空的)。 */}
          {brand.about.pull ? <p className="bp-pull">{brand.about.pull}</p> : null}
          <BrandRichText as="p">{brand.about.tail}</BrandRichText>
        </div>
        {showAside && brand.aside && (
          <aside className="bp-aside">
            <div className="bp-aside-card">
              {/* 產品照在正文右側、不是首屏 ⇒ lazy(設計稿 :1964 逐字)。
                  與橫幅照的 eager 是刻意相反的:那張是 LCP,這張不是。 */}
              <img src={brandAsset(brand.aside.src)} alt={brand.aside.alt} loading="lazy" />
              <h3>{brand.aside.title}</h3>
              {/* note 帶標記(設計稿 :1964 對它**不** esc)⇒ 過 BrandRichText。
                  ⚠️ 全站唯一帶標記的 aside.note 是 lightech 的「PUSH &amp; PULL」,
                     而 lightech **有 video** ⇒ 它的產品照卡在正式資料下永不渲染
                     ⇒ 這條解碼路徑目前**不可達**,判別力由測試的合成 fixture 提供,
                     不是由真資料提供。與上面「兩者皆無」那條的揭露標準一致。 */}
              <BrandRichText as="p">{brand.aside.note}</BrandRichText>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
