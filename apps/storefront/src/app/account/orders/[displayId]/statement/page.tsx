import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getOrderRepo } from '@/lib/auth/composition';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import type { MemberOrderDetail } from '@pcm/domain';
import { StatementDoc } from '@/components/print/statement-doc';
// 🔴 CSS 在【這一頁】import、不進 `app/layout.tsx` —— `@page` 是頁面層 at-rule、
//    沒有選擇器可以侷限它 ⇒ 放進全域的話**顧客站每一頁**列印時都會變成 A4 12mm 邊距。
//    Next 只在載入本路由時才把它送出去。(同 `apps/admin/src/app/print/layout.tsx` 的既有立場。)
import '@/styles/print-a4.css';
import '@/styles/statement.css';
import { Noto_Sans_TC } from 'next/font/google';

/* 片 B(2026-08-31,主視窗 `-2d [16689c]` 拍「甲」)—— **自 host 這一頁的中文字型**。
 *
 * 🔴 **它修的不是「客人沒有字型」** —— 那個缺口不存在:`app/layout.tsx:159-164` 全站 `<head>`
 *    早就從 Google CDN 載了 `Noto+Sans+TC:wght@400;500;600;700`(實抓那支 CSS ⇒ 200 / 241,420 bytes /
 *    210 個 `@font-face`),而 `account` 底下零 nested layout ⇒ 這一頁吃的就是 root layout。
 *    plan §0 原本寫「今天的中文靠看的人那台機器剛好有字型」⇒ **那句已在 plan 裡就地訂正。**
 *
 * ✅ **真正修的**:片 C 要在**伺服器**上把這一頁渲染成 PDF,而那一刻**不可以依賴外部 CDN** ——
 *    它失敗時是【靜默】的:網路一慢就豆腐字,零錯誤零警告,而 PDF **照樣產出來**。
 *    (片 A 實測:字型沒載到時 headless Chrome 印出一張完全正常的中文 PDF,因為那台機器自己有字型。
 *     成因與負對照見 `docs/patterns/traps-inbox/A-20260831-環境替我供應了那個東西-而我記在自己的接線上.md`。)
 *
 * 🛑 **只給這一頁,不動 `app/layout.tsx`** —— 那支檔 `:16` 的註解裡住著一條既有拍板:
 *    「走 `<link>` 預連 + stylesheet(對齊 design 字面、避免 next/font 隱式包裝偏離 design)」。
 *    那是鐵則 1 的拍板 ⇒ 要推翻它得 Sean 點頭,不是這一片可以順手做的。
 *
 * 🔴 `preload: false` **是必須的,不是偏好**:`Noto_Sans_TC` 的 `subsets` 型別只允許
 *    `'cyrillic' | 'latin' | 'latin-ext' | 'vietnamese'` —— **沒有中文選項**
 *    (逐字在 `node_modules/next/dist/compiled/@next/font/dist/google/index.d.ts`)。
 *    而 Next 的 `preload: true` 要求宣告 subsets ⇒ 對 CJK 字型只能關掉 preload。
 *    ⚠️ 代價 = 少了 `<link rel=preload>`;字型仍然自 host、仍然會載,只是不搶跑。
 *
 * 📎 體積(量於 2026-08-31 11:2x,dev 產物):105 支 woff2 / 4,193,212 bytes。
 *    400 與 700 **共用同一批檔** —— Google 給的是**可變字型**(解 woff2 表頭有 `fvar`/`avar`/`HVAR`/`STAT`)
 *    ⇒ 粗體是真的粗體,不是瀏覽器合成的。
 *
 * 🔴 **codex R3 抓到一格,而我實跑之後結論與他的處方相反 —— 三件都是量到的**:
 *    ① next/font 除了自 host 的 face,還多宣告一個度量替身(逐字抄自編譯產物):
 *       `@font-face{font-family:Noto Sans TC Fallback;src:local(Arial);
 *        ascent-override:110.73%;descent-override:27.49%;size-adjust:104.76%}`
 *       ⇒ 它是**被拉伸過的 Arial**,不是 Noto。
 *    ② 他的處方是「關掉度量 fallback」⇒ 🔴 我加了 `adjustFontFallback: false`、重 build(rc=0)、
 *       逐檔掃編譯產物 ⇒ **`local(Arial)` 仍然是 1 次** ⇒ 那個選項在 Next 16.3.0 + Turbopack
 *       底下**型別收、但不生效** ⇒ 留著它等於在碼裡寫一句假話,所以拿掉。
 *    ③ 那它有沒有害?⛔ ~~定稿後的紙沒有變~~ —— **那句話我寫成了無條件句,而 codex R4 打回。**
 *       ✅ 成立的是**帶三個條件**的版本:字型比對是逐字的、取第一個有那個字的家族,
 *          而第一順位仍是 `Noto Sans TC` ⇒ **在下面三件同時成立時**紙不會變:
 *            (a) 那支字型**已經載完**(不是 swap 空窗期)
 *            (b) 紙上每一個字元 `Noto Sans TC` **都畫得出來**
 *            (c) 那台機器上**沒有** `Arial`(替身是 `src:local(Arial)`)
 *       🛑 而三個條件的現況逐條:
 *            (a) **未量** —— swap 空窗期的畫面我沒有量
 *            (b) **未量** —— 片 A 量過 repo 內的字, 但客人的姓名/地址/品名不在那個分母裡
 *            (c) Linux 容器**預期**沒有 Arial(它是 Microsoft 授權字型), **而我沒有實測那個容器**
 *       📌 ⇒ 所以正確的講法是:**我沒有找到它會改變定稿版面的路徑, 而我也沒有證明它不會。**
 *
 * 🔴 **為什麼回傳值一定要被接住(而不是只呼叫、丟掉)**:實測 —— 寫成裸呼叫
 *    `Noto_Sans_TC({...});` ⇒ **build 失敗**(`Ecmascript file had an error`,指到那一行)。
 *    Next 要求 font loader 的回傳值必須被指派。
 *    ⇒ 所以下面那個 prop 不只是說明,它是**讓這個 import 活著的那個參照**。 */
const statementFont = Noto_Sans_TC({ weight: ['400', '700'], preload: false });

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

  // ✅ **片 B(版面)已落地** —— Sean 2026-08-30 拍 `Q-容差 = 甲`
  //    (逐字「客人下載的明細 = 後台那張,一模一樣」)⇒ 原本擋著這一格的容差題已解。
  //    🔴 **成功這條路刻意不加頁首頁尾** —— 它是列印版面,而 chrome 會被印進紙裡。
  //       (查無那條路【有】頁首頁尾,因為那一頁最需要出口。兩條路不同是刻意的。)
  //    ⚠️ **一模一樣有一格做不到**,而那是授權過的偏離 ——
  //       理由與那道守門寫在 `components/print/statement-doc.tsx` 檔頭那一大段。
  return <StatementDoc order={order} fontFamily={statementFont.style.fontFamily} />;
}
