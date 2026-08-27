// app/account/orders/[displayId]/page.tsx — 會員訂單明細(`#240`;server 守門 + 唯讀投影 → OrderDetailView)
//
// 🔴 **網址段是 `displayId`,不是 `orders.id` 那個 UUID** —— OD 稿檔頭逐字定的契約:
//    「/account/orders/<displayId>。原型用 ?id= 帶,真站是動態路由段」。
//
// 🔴 **這一頁不重建 domain `Order`**(`#217` 裁定 D:明細走唯讀投影;`findById` 是**刻意不提供**
//    的 deferred stub,不是待辦)⇒ 走 `findOrderDetailForCustomer` 具名白名單投影。
//
// 🔴 **查無不 throw、不回 403、不 notFound()**:
//    · 不洩存在性 —— 「別人的單」與「不存在的單」對客人必須長得一樣(驗收條件 2);
//    · 走 **OD 稿自己的「查無此訂單」狀態**(`order-detail-page.html:133-137` 的 `.acc-empty`),
//      而不是 Next 的 404 頁 —— 稿把它畫在同一個殼裡,客人不會被丟出會員中心(驗收條件 3)。
//
// 🔴🔴 ~~被 `#249` 藏起來的 unpaid 孤兒單,在這裡**也**看不到(adapter 端同一道 `.neq`)~~
//    —— **2026-08-24 那道濾網兩處一起拆了**(Sean 拍【甲】:顯示但標「已取消」/「已逾期」)。
//    ⇒ 現在**每一張自己的單都看得到**,而狀態字由 `orderStatusLabel` 的取消軸決定。
//    📌 原句的顧慮(「列表看不到、直連網址看得到」會讓拍板在另一個入口失效)**仍然成立、
//    只是方向反過來**:少拆一邊 ⇒ 列表看得到而點進去說「查無此訂單」。**兩處同進退。**

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getOrderRepo } from '@/lib/auth/composition';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { OrderDetailView } from '@/components/account/OrderDetailView';
import type { MemberOrderDetail } from '@pcm/domain';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ displayId: string }>;
};

// 🔴 標題只用單號 —— **不要**把品名/金額/收件人放進 <title>:那會出現在瀏覽器分頁、
//    歷史紀錄與分享預覽裡,而那三處都不受登入保護。
export const metadata: Metadata = {
  title: '訂單明細 | PCM MOTOR PARTS',
};

export default async function OrderDetailRoute({ params }: Props) {
  // 🔴 **不要再 decodeURIComponent 一次**(codex 關卡2 must-fix,2026-08-23):
  //    Next 的動態路由段**進來就已經解碼過**(全 app 零個其他路由再解一次;
  //    對照 `products/[slug]/page.tsx:75` 直接用 `slug`)。
  //    再解一次的後果不是「多此一舉」,是 **500**:網址帶 `%25` ⇒ Next 解成裸 `%`
  //    ⇒ `decodeURIComponent('%')` 實測拋 `URIError: URI malformed`
  //    ⇒ **繞過下面那個「查無此訂單」畫面,直接炸掉整頁。**
  const { displayId } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 未登入 → /login 帶 next 導回**這一頁**(對齊 `#190` 在 /account 的既有做法)。
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/account/orders/${displayId}`)}`);
  }

  let order: MemberOrderDetail | null = null;
  try {
    order = await (await getOrderRepo()).findOrderDetailForCustomer(displayId, user.id);
  } catch (orderError) {
    // 讀取失敗 → 退化成「查無」畫面、不 500。
    // ⚠️ **與 `order === null` 刻意走同一個畫面**:對客人而言兩者都是「這頁沒有東西」,
    //    而分流成兩種畫面只會多一個要維護的狀態。差別留在 server log 裡。
    console.error('[account/orders] 訂單明細讀取失敗、退化查無:', orderError);
  }

  return (
    // 🔴🔴 **站台頁首/頁尾 2026-08-27 補上 —— 在此之前這一頁【只有一個裸 <main>】。**
    //    客人打開自己的訂單明細, 畫面上**沒有導覽、沒有 logo、走不回商店**。
    //    📏 分母是量的不是抽樣的:`find apps/storefront/src/app/account -name page.tsx` ⇒ **2 頁**,
    //       中間層 `layout.tsx` ⇒ **0** ⇒ 沒有共用殼, 每頁自己帶。
    //       · `/account`                    → `AccountView.tsx:175` `<Header currentPage="account" />`
    //                                         + `:247` `<HomeFooter />`  ⇒ **兩個都有**
    //       · `/account/orders/[displayId]`  → `OrderDetailView` 兩個都 **0** ⇒ **只有這一頁沒有**
    //    ⇒ **所以這是漏了, 不是一個架構決定**(全站 `<Header>` 29 支 / `<HomeFooter>` 27 支)。
    //    ⇒ 稿那一側也有:`order-detail-page.html:29` `<header class="pcm-header">` / `:70` `<footer class="ed-footer">`
    //    ⚠️ 外層 `.ap-page` 與 `currentPage="account"` **照抄 `AccountView` 那一份**, 不自創。
    <div data-screen-label="OrderDetail" className="ap-page">
      <Header currentPage="account" />
      <main className="acc-main" data-od-id="order-detail-main">
        {order === null ? (
          // 標題「查無此訂單」= OD 稿 :133-137 的字面,逐字、不動。
          <div className="acc-empty" data-od-id="order-not-found">
            查無此訂單
            {/* 🔴🔴 **副標 2026-08-24 換掉了,而它【偏離 OD 稿】—— 那是 Sean 自己拍的。**
                ```
                Q6 這句要不要改 ⇒ 他答【甲 = 必做】(不是文案潤飾,是這片的必做項)
                三版文案 ⇒ 他答【乙】,逐字:
                  「您所有的訂單都在訂單記錄裡, 回去找找看。若確定是您的, 請與客服聯絡」
                ```
                **為什麼必做**:~~原字面「訂單編號可能輸入錯誤,或這筆不屬於目前登入的帳號」~~
                對「**我們自己藏起來的、他自己的單**」是**假的** —— 它叫客人去重打編號、去換帳號登入,
                兩條都沒用,而試完之後最合理的動作就是**再刷一次**。

                🔴🔴 **而這句話的模糊是【資安性質】,不是文筆 —— 不准為了「講清楚」拆開**:
                檔頭 :9-12 逐字「不洩存在性 —— **別人的單與不存在的單對客人必須長得一樣**」。
                分開講「編號不存在」與「不是你的單」⇒ 客人可以拿這一頁當**列舉工具掃單號**
                (舊單號 `PCM-YYYY-NNNN` 是連號的)。⇒ 新字面刻意**不說**是哪一種。
                ⚠️ 下一個想把它改得「更有幫助」的人:先讀 memory
                `project_0824-sean-cancelled-orders-visible-and-notfound-copy`。 */}
            <div className="acc-empty-sub">
              您所有的訂單都在訂單記錄裡,回去找找看。若確定是您的,請與客服聯絡
            </div>
          </div>
        ) : (
          <OrderDetailView order={order} />
        )}
      </main>
      <HomeFooter />
    </div>
  );
}
