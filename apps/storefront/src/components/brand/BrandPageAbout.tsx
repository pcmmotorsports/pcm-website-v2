// BrandPageAbout.tsx — 品牌介紹頁的 About 區(D2c-1 正文+產品照 / D2c-2 影片右欄;2026-08-04)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 :1386-1411、組裝邏輯 :1851-1854 與 :1958-1969、CSS :659-688 與 :961)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD)。
//
// 🔴 右欄「一次只放一個東西」(設計稿 :1958 逐字):
//    有官方影片 → 放影片(`BrandPageMedia`,client 元件、點擊才掛 iframe);
//    沒有才退回產品照卡;兩者皆無 → 整列收成兩欄、正文吃回右邊那格。
//
// ⚠️ 實測分布(2026-08-04,D2f 加入 materya 影片後重數):20 家全部有 aside,其中 12 家同時有 video
//    ⇒ **真正看得到產品照卡的只有 8 家**;而「兩者皆無」的兩欄退化態在現有資料下**不可達**。
//    不可達 ≠ 不會壞:D3 之後若有人新增一家沒圖沒片的品牌,那條路才第一次被走到。
//    守門靠測試(本片)與 CSS 文字層(brand-page.test.ts),不能靠肉眼看。

import type { BrandContent } from '@/data/brand-content-types';
import { BrandRichText } from '@/components/BrandRichText';
import { BrandPageMedia } from './BrandPageMedia';
import { brandAsset } from '@/lib/brand-asset';
import '@/styles/brand-page.css';

export function BrandPageAbout({ brand }: { brand: BrandContent }) {
  // 右欄分流:影片優先,其次產品照(設計稿 :1960 的 `!brand.video && brand.aside`)。
  const showAside = !brand.video && brand.aside !== undefined;

  // D2c-2 已把影片接上 ⇒ 右欄「這一刻」有東西的條件回到設計稿最終狀態(:1966-1968:
  // 產品照與影片兩條路都 remove no-aside)。D2c-1 期間這裡刻意只認 showAside,
  // 因為當時影片元件還沒有 —— 那 12 家會保留三軌卻只有兩個子元素、第三軌 629px 死白。
  const hasRightColumn = showAside || brand.video !== undefined;

  // 直式影片(3:4 / 9:16)整列欄寬要重配,否則會被塞進給 16:9 用的寬欄裡變細長條
  // (設計稿 :1878-1881 把 class 掛在 inner 上,不是掛在影片自己身上)。
  const innerClass = [
    'bp-about-inner',
    hasRightColumn ? '' : 'no-aside',
    brand.video?.portrait ? 'has-portrait-media' : '',
  ].filter(Boolean).join(' ');

  return (
    <section className="bp-about">
      <div className={innerClass}>
        <div className="bp-sec-label">About</div>
        <div className="bp-body">
          {/* lead / tail 帶白名單標記(設計稿 :1852/:1854 **不 esc**)⇒ 過 BrandRichText */}
          <BrandRichText as="p">{brand.about.lead}</BrandRichText>
          {/* 🔴 pull 是**純文字**:設計稿 :1853 對它走 esc(),與 lead/tail 不同。
              實測 20 家的 pull 零標記,兩邊一致。空字串 ⇒ 整個 <p> 不建(不是建一個空的)。 */}
          {brand.about.pull ? <p className="bp-pull">{brand.about.pull}</p> : null}
          <BrandRichText as="p">{brand.about.tail}</BrandRichText>
        </div>
        {/* 右欄一次只放一個東西:有官方影片就放影片(D2c-2),沒有才退回下面的產品照卡。 */}
        {brand.video && <BrandPageMedia video={brand.video} />}
        {showAside && brand.aside && (
          <aside className="bp-aside">
            <div className="bp-aside-card">
              {/* 產品照在正文右側、不是首屏 ⇒ lazy(設計稿 :1964 逐字)。
                  與橫幅照的 eager 是刻意相反的:那張是 LCP,這張不是。 */}
              <img src={brandAsset(brand.aside.src)} alt={brand.aside.alt} loading="lazy" />
              {/* 🔴 **不是 `<h3>`,刻意偏離設計稿字面**(:1964 是 h3)—— Sean 2026-08-04
                  拍 A(backlog #311)。整頁的文件序是 h1(品牌名)→ 這裡 → Why 的 h2,
                  留成 h3 會①從 h1 直接跳到 h3 ②讓它排在自己「應該屬於」的 h2 之前
                  ⇒ 用標題導覽的人拿到一份對不上內容的大綱。
                  三個候選解裡選這個的理由:這格是**產品照的圖說**、不是文件章節
                  (另兩個候選是補一個視覺隱藏的 h2、或整頁降級重排 —— 前者會與同區塊
                   已存在的視覺標籤 `.bp-sec-label` "About" 對報讀器重複,正是 #308 在修的毛病)。
                  ⇒ 改完的大綱:h1 → h2 Why → h3 卡片 → h2 Craft → h2 Timeline。
                  視覺零改動:CSS 選擇器同步改成 `.bp-aside-title`,字級字重一字不動。 */}
              <p className="bp-aside-title">{brand.aside.title}</p>
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
