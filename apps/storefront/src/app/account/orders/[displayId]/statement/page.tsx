import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getOrderRepo } from '@/lib/auth/composition';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import type { MemberOrderDetail } from '@pcm/domain';

// 客人的「訂單明細 / 對帳單」列印頁(片 A —— 只有路由與授權,版面是片 B)。
//
// 🔴 **它是什麼、不是什麼**(OD 稿 `pcm-home-redesign/order-detail-page.html:193` 逐字,
//    而那是 **2026-08-07 Sean 拍板**):
//      「下載訂單 PDF」= **訂單明細 / 對帳單**,**不是發票**。
//      公司行號的對帳需求走這裡;發票走財政部電子發票平台與載具,是另一條路。
//      **稿上刻意不出現「下載發票」四個字,免得網站端誤接成開立發票。**
//    🛑 **⇒ 接的人千萬不要把這一頁接成開立發票。** 那是稿上唯一被特別叮嚀的一格,
//       而它是【一個作者預見到誤接、用留白去防】的例子 —— 而留白只有讀到註解的人看得見。
//
// 🔴🔴 **給片 C(那顆鈕)的人:這一頁的 URL 是 `/account/orders/<displayId>/statement`,
//    【沒有 `.pdf`】。** 而 `OrderDetailView.tsx:9` 那段「刻意不做」的註解寫的是
//    `/account/orders/<id>/statement.pdf`(它抄的是稿 `:288`,而稿假設的是伺服器產檔)。
//    ⇒ **接鈕時照【這一行】,不要照那一行** —— 差一個 `.pdf` 那顆鈕就 404,
//      而稿 `:286` 逐字警告的正是那件事(「不給一個會 404 的 href」)。
//    📌 而那段註解本身是好事:**一個作者把「我不做」寫成了下一個人的規格** ——
//      他大可以只寫「先不做」,而他把 URL 寫下來了。
//
// ⚠️ **這一頁的 HTML【甲乙共用】**(選型檔 `:98-99` 確認):日後若改成伺服器產 PDF(乙),
//    **這一頁不用重寫,只是換一個地方去渲染它** ⇒ 先做甲不會讓乙變貴。
//    🔴 而**會推翻甲的唯一前提是:明細要夾在 Email 裡寄**(信裡塞不了列印對話框)。
//       ⇒ 那個前提 Sean 沒有提過,而**沉默不是拍板** ⇒ 它記在 `Q-出貨信起點` 旁邊當備註。
//
// 🔴 **為什麼是「客人自己的瀏覽器畫」而不是伺服器產 PDF**
//    ⚠️ **依 `docs/plans/2026-08-29-pdf-render-selection.md` 的【推薦】甲,而 Sean 尚未落檔**
//    (code-reviewer 2026-08-29 查:該選型檔自己就是端給他的題、板 `:208` 態仍 `open`、
//     memory 0829 四支 ruling 檔零命中 ⇒ **我第一版寫「Sean 拍甲」是字面 vs 事實**)。
//    伺服器那條路在 Vercel 的 Linux 容器上跑,而**容器沒有中文字型** ⇒ 會印出豆腐字。
//    完整選型與量測:`docs/plans/2026-08-29-pdf-render-selection.md`(`-b9`)。
//    ⚠️ 而上半沒有完全消失:Linux 桌機客人可能落到 `sans-serif`。**客人端 OS 分佈未量。**
//
// 🔴🔴 **授權:本頁【不得自己查訂單】。**
//    它必須走 `findOrderDetailForCustomer(displayId, user.id)` ——
//    那支的查詢是 `.eq('display_id').eq('customer_user_id')`
//    (`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:824-825`;
//     ⛔ ~~`:815`~~ 那是簽章行,不是那條查詢 —— code-reviewer 2026-08-29 抓)。
//    ⇒ 「客人打得開自己的、打不開別人的」由**那一條**保證,而不是由這一頁保證。
//    📌 **而本頁的測試斷言的是【它呼叫了那支方法】,不是【它有沒有過濾 customer_user_id】** ——
//       後者在有人重寫查詢時**照樣會綠**(只要他也記得加那個過濾)
//       ⇒ 而重點不是「這一次寫對了」,是**它與既有那條路綁在一起**。

type Props = {
  params: Promise<{ displayId: string }>;
};

// 🔴 標題只用固定字 —— **不要**把單號/品名/金額/收件人放進 `<title>`:
//    那會出現在瀏覽器分頁、歷史紀錄與分享預覽裡,而那三處都不受登入保護。
//    (與 `../page.tsx` 同一立場,原句在那裡。)
export const metadata: Metadata = {
  title: '訂單明細 | PCM MOTOR PARTS',
};

export const dynamic = 'force-dynamic';

export default async function OrderStatementRoute({ params }: Props) {
  // 🔴 **不要再 `decodeURIComponent` 一次**(codex 關卡2 must-fix,2026-08-23,原句在 `../page.tsx`):
  //    Next 的動態路由段**進來就已經解碼過**。再解一次的後果不是「多此一舉」,是 **500**:
  //    網址帶 `%25` ⇒ Next 解成裸 `%` ⇒ `decodeURIComponent('%')` 拋 `URIError`
  //    ⇒ **繞過下面那個「查無」畫面,直接炸掉整頁。**
  const { displayId } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未登入 → /login 帶 next 導回**這一頁**(對齊 `../page.tsx` 的既有做法)。
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/account/orders/${displayId}/statement`)}`);
  }

  let order: MemberOrderDetail | null = null;
  try {
    order = await (await getOrderRepo()).findOrderDetailForCustomer(displayId, user.id);
  } catch (orderError) {
    // 讀取失敗 → 退化成「查無」畫面、不 500(與 `../page.tsx` 刻意走同一個畫面:
    // 對客人而言兩者都是「這頁沒有東西」)。差別留在 server log 裡。
    console.error('[account/orders/statement] 讀取失敗、退化查無:', orderError);
  }

  if (!order) {
    return (
      // 🔴🔴 **殼照抄隔壁 `[displayId]/page.tsx:94-99`,不自創。**
      //    ⛔ ~~我第一版用了 `mx-auto max-w-2xl px-4 py-16 text-center` 這類 Tailwind class~~
      //    ⇒ **那在 storefront 是【死的】**:code-reviewer R2 2026-08-29 量到 ——
      //      `apps/storefront/package.json` 的 deps+devDeps 對 `tailwind`/`postcss` ⇒ **零命中**
      //      (而 `apps/admin` 有);`find -name postcss.config*` ⇒ 只有 admin 那支;
      //      storefront 的 `@tailwind` 指令 ⇒ **0**。
      //    🔴 **⇒ 那些 class 一條 CSS 都產不出來,而畫面是【瀏覽器預設樣式】。**
      //    📌 **而 10 格測試全綠、三綠也全綠** —— **沒有任何一把尺會 parse class 有沒有對應規則。**
      //       ⇒ 這一格只有開瀏覽器看得到,而 R1 那一輪也沒看到。
      //    ⚠️ 我第一版還犯了一個更小的:用了 `.acc-empty-sub` 而**沒有 `.acc-empty` 父層**
      //       ⇒ **抄了子、丟了母**。
      <div data-screen-label='Order statement' className='ap-page'>
        {/* 🔴 **查無這一頁要有出口** —— 隔壁 `page.test.tsx` 那一格逐字:
            「查無畫面沒有頁首 ⇒ **那才是最需要出口的一頁**」。
            ⚠️ 而【只靠 `MobileTabBar` 是假的】:它 `<1080px` 才在 ⇒ **手機有出口、桌機沒有**。 */}
        <Header currentPage='account' />
        <main className='acc-main'>
          <div className='acc-empty' data-od-id='order-not-found'>
            查無此訂單
            {/* 🔴🔴 **這一句是【拍板字面】,逐字抄自隔壁 `[displayId]/page.tsx`,不是我寫的。**
                Sean 2026-08-24 拍 Q6 = 甲(必做,逐字「我把它當這片的必做, 不是文案潤飾」),
                三版文案答【乙】—— 落檔 memory `project_0824-sean-cancelled-orders-visible-and-notfound-copy`。
                🛑 **不要把它改得「更有幫助」**:分開講「編號不存在」與「不是你的單」
                ⇒ 客人可以拿這一頁當**列舉工具**掃別人的單號。**那個模糊是資安性質的。**
                ⚠️ 我第一版自己寫了「這張單不存在,或它不是這個帳號的。」——
                **那與被推翻的舊句是同一個形狀**(列舉兩種可能、不給下一步),
                而隔壁那道負對照閘掃的是舊句字面 ⇒ **換個措辭它就掃不到**(R1 抓)。 */}
            <div className='acc-empty-sub'>
              您所有的訂單都在訂單記錄裡,回去找找看。若確定是您的,請與客服聯絡
            </div>
          </div>
        </main>
        <HomeFooter />
      </div>
    );
  }

  // ⚠️ **片 A 到此為止 —— 版面是片 B。**
  //    片 B 卡在一個未拍的容差題(客人這張要不要與後台印的「訂單明細」一模一樣),
  //    而那題已排進給 Sean 的佇列。⇒ 在他答之前,這裡刻意只放最小可驗證的內容。
  //    🔴 而**成功這條路刻意不加頁首頁尾** —— 它是列印版面,而 chrome 會被印進紙裡。
  //    🛑 而顧客站那顆「下載訂單 PDF」鈕是片 C,不得早於 A/B ——
  //       稿 `:286` 逐字「**不假裝下載成功、也不給一個會 404 的 href**」。
  //    ⚠️ 版面的 class 等片 B 接 `print-a4.css`,**這裡不自創**(見上面那一段的成因)。
  return (
    <main data-od-id='order-statement-main'>
      <h1>訂單明細</h1>
      <p>單號 {order.displayId}</p>
    </main>
  );
}
