// BrandPageWhy.tsx — 品牌介紹頁的 Why 區:四張差異點卡 + 底部數字條(D2d-1;2026-08-04)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 :1412-1423、組裝 :1972-1989、CSS :1074-1106、RWD :1158-1169 與 :1170-1180)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD)。
//
// 🔴 **D2d 拆成兩片**:計畫 §5.2 把 Why + Craft + Timeline 列為同一片 D2d,實讀設計稿後
//    三段合計約 90 行 CSS + 三個獨立版型(含 Craft 的影片/圖分流與 Timeline 的深色場),
//    一片做完會超出鐵則 4 的 45 分鐘 ⇒ D2d-1 = Why(本片)、D2d-2 = Craft + Timeline。
//    同 D2c 拆成 -1/-2 的理由與作法。
//
// ⚠️ 實測分布(2026-08-04,對 20 家求值):
//    highlights 20 家全有、**每家恰 4 張卡**;stats 只有 14 家(3 或 4 個數字)。
//    ⇒ 「沒有 highlights 就整段不放」那條路在型別上就不存在(D1a 量出 20/20 ⇒ 非選填),
//      本片不建那個分支;而「沒有 stats」是真的走得到的 6 家。

import type { CSSProperties } from 'react';
import type { BrandContent } from '@/data/brand-content-types';
import { BrandRichText } from '@/components/BrandRichText';
import '@/styles/brand-page.css';

export function BrandPageWhy({ brand }: { brand: BrandContent }) {
  const { highlights, stats } = brand;

  return (
    <section className="bp-why">
      <div className="bp-why-inner">
        <div className="bp-sec-label">Why</div>
        {/* 這層沒有 class 的 div 是設計稿骨架 :1416 就有的 —— 它讓 h2/lead/卡片/數字條
            擠在格線的第二欄裡,拿掉的話四個子元素會各自變成 grid item、排成一直排。 */}
        <div>
          <h2>{highlights.title}</h2>
          {/* 🔴 lead 是**純文字**:設計稿 :1974 對它走 `textContent`,與下面卡片的 `c.d`
              直接內插(:1977,不 esc)相反 —— 又一組「同一個資料物件裡兩種處理」的相反對。
              型別上它是 BrandRichString,但實測 20 家的 lead 零標記,兩邊一致。 */}
          <p className="bp-why-lead">{highlights.lead}</p>
          <div className="bp-why-grid">
            {highlights.cards.map((card, i) => (
              <article className="bp-why-card" key={card.t}>
                {/* 編號補零到兩位(設計稿 :1976 的 padStart)—— 01 02 03 04 是等寬字的
                    視覺對齊,寫成 1 2 3 4 會讓左緣參差。 */}
                <span className="bp-why-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{card.t}</h3>
                {/* d 帶白名單標記(20 家共 59 張卡有)⇒ 過 BrandRichText,絕不直接內插 */}
                <BrandRichText as="p">{card.d}</BrandRichText>
              </article>
            ))}
          </div>
          {/* 🔴 沒有 stats 的 6 家:整個 .bp-nums **不建**(設計稿 :1987 是 remove 不是 hide)。
              留一個空的 div 會讓 `border-top` 憑空多畫一條線在卡片下面。 */}
          {stats && (
            // 🔴 `--num-n` 與 `data-n` **兩個都要設**,它們守的不是同一件事:
            //    --num-n 決定欄數(寫死 4 的話,只有 3 個數字的 6 家會多一格空白 +
            //    一條斷掉的分隔線);data-n 給 ≤1024 兩欄版判斷「最後一列」是一格還是兩格
            //    (設計稿 :1164-1168:4 個排 2×2 最後一列是第 3、4 個,3 個排 2+1 只有第 3 個
            //     —— 寫死 `-n+2` 會讓 3 個數字的第 2 格提早收掉底線、第一列變成半條線)。
            //    漏掉任一個都只在特定家數 + 特定寬度下現形,而且看起來像「線畫歪了」。
            <div
              className="bp-nums"
              style={{ '--num-n': stats.items.length } as CSSProperties}
              data-n={stats.items.length}
            >
              {stats.items.map((item) => (
                <div className="bp-num" key={item.l}>
                  {/* n / l / s 三個都是純文字(設計稿 :1985-1986 全走 esc)。
                      `plus` 為真才補一個 <sup>+</sup> —— 實測 50 格中 9 格有。 */}
                  <div className="bp-num-n">
                    {item.n}
                    {item.plus ? <sup>+</sup> : null}
                  </div>
                  <div className="bp-num-l">{item.l}</div>
                  <div className="bp-num-s">{item.s}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
