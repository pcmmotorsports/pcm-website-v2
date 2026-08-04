// BrandPageTimeline.tsx — 品牌介紹頁的年表(深色場;D2d-2;2026-08-04)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 :1436-1445、組裝 :2007-2014、CSS :1134-1156、RWD :1170-1180 與 :1186-1192)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD)。
//
// 🔴 **整頁唯一的深色場**(`.bp-time{background:var(--c-graphite);color:#fff}`)——
//    設計稿把深色重量從中段的數字帶移到這裡,節奏是「動→白→白→白→深」(:970-974)。
//    連帶兩條覆寫:`.bp-time .bp-sec-label{color:#fff}` 與 `::after{background:var(--c-red)}`
//    —— 漏搬會變成深底上的黑字 + 一條看不見的黑短線。守門在 `styles/brand-page.test.ts`。
//
// ⚠️ 實測分布(2026-08-04):**20 家裡只有 2 家有 timeline**(akrapovic / gb-racing),
//    各 13 列、各 4 列標 `key`、13 列全都有 `d`。
//    ⇒ 🔴 **排版問題在另外 18 家看不到** —— 「20 家都正常」不是這一區的驗收。
//    ⇒ `d` 缺席那條分支(設計稿 :2012 的 `m.d ? … : ''`)在現有資料下**不可達**,
//      判別力由測試的合成 fixture 提供,不是由真資料提供。
//
// 全部欄位都是純文字:設計稿 :2011-2012 對 `y` / `t` / `d` 三個都走 esc()
// —— 與 Craft 的 `rows[].d`(不 esc)相反,這是同一片裡的第二組「方向相反」。

import type { BrandTimeline } from '@/data/brand-content-types';

export function BrandPageTimeline({ timeline }: { timeline: BrandTimeline }) {
  return (
    <section className="bp-time">
      <div className="bp-time-inner">
        <div className="bp-sec-label">Timeline</div>
        {/* 同 Why / Craft:這層無 class 的 wrapper 讓標題與列表擠在第二欄裡。 */}
        <div>
          <h2>{timeline.title}</h2>
          <div className="bp-time-list">
            {timeline.items.map((item) => (
              // 🔴 `is-key` = 該品牌真正的轉折點,用紅點標出來(設計稿 :2009 逐字:
              //    「每條都標等於沒標」)。它同時換掉圓點顏色與年份的字重/亮度兩處。
              <div
                className={`bp-time-item${item.key ? ' is-key' : ''}`}
                key={`${item.y}-${item.t}`}
              >
                <div className="bp-time-y">{item.y}</div>
                <div className="bp-time-body">
                  <h3>
                    {/* 🔴 刻意偏離設計稿字面(:2011 沒有這個 span)—— Sean 2026-08-04
                        拍 A(backlog #312 第一條)。`is-key` 在視覺上**只有顏色差異**
                        (圓點白→橘、年份半透明→全白;手機版只有年份變色)⇒ 用讀屏的人
                        拿到的是 13 條長得一模一樣的年表,設計上想強調的那 4 條在語意層
                        完全不存在。這是真的資訊遺失,也過不了 WCAG 1.4.1「不能只用顏色傳達」。
                        放在 h3 **裡面**而不是外面:標題導覽會把它一起唸出來
                        (放外面時用標題跳讀的人照樣聽不到)。視覺零改動。 */}
                    {item.key && <span className="bp-sr-only">關鍵事件:</span>}
                    {item.t}
                  </h3>
                  {/* d **不是選填、是可為空字串**(型別上必填,同 `about.pull` 的慣例;
                      關卡2 R3 更正我原本寫的「選填」)。空字串時整個 <p> 不建、不是建一個空的。
                      現有 2 家 26 列全都有值。 */}
                  {item.d ? <p>{item.d}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
