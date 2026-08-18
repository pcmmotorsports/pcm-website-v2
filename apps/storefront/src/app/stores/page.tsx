// app/stores/page.tsx — /stores 合作店家(全站重設計 第2批;2026-08-06)
//
// 真權威 = OD `coming-soon.html?v=stores` + `coming-soon-handoff.md` §二表格第二列。
// Sean 2026-08-05 逐字:「那兩個頁面要換成這個頁面,然後說**新功能即將上線**」。
//
// 🔴 **完整的 `/stores` 頁設計稿是存在的**(`stores-page.html` + `pcm-stores.css` +
//    `stores-install-data.js`),**刻意不搬**:合作店家的店名 / 地址 / 電話 / 營業時間
//    Sean 還沒給,設計稿裡那幾家全是版位示範(`pending: true`)。
//    交接單 §八 逐字:「在拿到之前,`/stores` 掛這頁反而比掛一頁『9 家示範資料』誠實。」
//    ⇒ 資料到齊後照 §七 把這裡換回真正的頁面元件即可,設計稿不用動。
//
// 🔴 **天地要自己 import**:交接單 §三之二 寫「真站不用做這段 —— Next.js 的 app/layout.tsx
//    本來就會包 header / footer」,**那個前提在本站不成立**(派工單 §3-2 實查:`Header` /
//    `HomeFooter` 由各頁 view 元件各自 import、計 13 處,`app/` 底下無 nested layout)。
//    所以這裡明確 import 兩顆殼 —— 少了它們客人點進來就出不去(Sean 明文要求保留天地)。
//
// 🔴 **不 noindex**:這是站內頁,交接單 §三「兩個 meta 差異」逐字「功能版是站內頁,不該
//    noindex」。只有整站版 `/coming-soon` 要。
//
// 內容分級 L1。⚠️ 全頁沒有編造任何店名 / 電話 / 地址 / 金額 —— 待補清單見 STOP。

import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = {
  title: '合作店家 · 即將上線 — PCM MOTOR PARTS',
  description:
    'PCM 合作店家地圖正在整理中。全台合作車行的名單、地址與各家能做的施工項目，很快就會在這裡查得到。',
};

export default function StoresPage() {
  return (
    <>
      <Header currentPage="stores" />
      <ComingSoon
        hasNav
        eyebrow="N°06 · PARTNER STORES"
        titleLead="新功能，"
        titleAccent="即將上線。"
        lede={
          <>
            <strong>合作店家地圖</strong>正在整理中。全台合作車行的名單、地址與各家能做的施工項目，很快就會在這裡查得到。
            <br />
            在那之前想找店家安裝，直接用 LINE 跟我們說，我們幫您接。
          </>
        }
        etaText="名單整理中"
        secondaryCta={{ href: '/', label: '回首頁', icon: 'home' }}
      />
      <HomeFooter />
    </>
  );
}
