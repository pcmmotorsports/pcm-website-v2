// 客人的「下載訂單明細 PDF」—— 片 C3。伺服器產檔,零對外請求。
//
// ══ 這條 route 的設計(母 plan 的設計 B;主視窗 -2d [16689c] 2026-08-31 批)══════════
// 我們**不去 goto 自己的網址** —— 那要把客人的 session cookie 轉發進 headless Chrome。
// 改成:route 自己拿資料 → `renderToStaticMarkup(<StatementDoc/>)` → `page.setContent(html)`。
//   · 授權走**同一支** `findOrderDetailForCustomer(displayId, user.id)` —— 與那一頁逐字相同
//   · 沒有 root layout ⇒ **那條 Google Fonts `<link>` 根本不存在** ⇒ 沒有東西需要攔
//   · 字型內嵌成 `data:` URI(只嵌這張紙用得到的子集)⇒ 對外網路請求 0
//
// 🛑 **客人瀏覽器那條路完全沒有被動到** —— `app/layout.tsx:159-164` 那條 Google Fonts
//    `<link>` 還在、還在用。**不要把這條 route 讀成「我們把 Google 從全站拿掉了」。**
//
// 🔴 **URL 帶 `.pdf` 是規格,不是風格**:`components/account/OrderDetailView.tsx` 那顆鈕的
//    註解與 OD 稿 `:288` 寫死的就是 `/account/orders/<id>/statement.pdf`。差一個 `.pdf` 那顆鈕就 404。
//
// ⚠️ **字型檔從哪來**:`.next/static/` 底下的編譯產物,由 `next.config.ts` 的
//    `outputFileTracingIncludes` 拉進這條 route 的函式包。拉不進來的話 ⇒ 見下面 `uncovered`。
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getOrderRepo } from '@/lib/auth/composition';
// 🔵 **2026-09-01:產檔那兩段搬到 `@/lib/print/statement-pdf`**(⟦b4-MAILPDF1⟧ 的前置)——
//    寄訂單信要附一份 PDF, 而它需要**同一條路**。
//    🛑 而搬走的只有「資源組裝」與「Chrome 產檔」兩支原語;
//       **政策(缺什麼就拒絕產)留在這條 route 裡**, 因為寄信那條路要不要一樣拒絕**還沒有人拍板**。
//    ⇒ 📌 把政策焊進共用函式, 下一個呼叫端就只能接受它或整支複製一份。
import { buildStatementPdfHtml, htmlToPdf } from '@/lib/print/statement-pdf';

// 🔴 一定要 nodejs runtime —— chromium 與 `node:fs` 在 edge 上都不存在。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 🔴 **明寫 maxDuration**(codex must-fix):不寫的話它吃平台預設, 而**預設值我們沒有量過**;
//    平台強殺時 `finally` 裡的 `browser.close()` 不保證跑得到 ⇒ 殘留行程。
//    60 秒是**估的**:冷啟動 + 解壓 chromium + 渲染 + 產檔, 我沒有量過任何一段。
//    ⚠️ 這個數字要在真部署量到之後回來改。
export const maxDuration = 60;

/* 🔴🔴 **資源從哪來 —— 這一段被一發實驗推翻過一次, 兩個版本都留著。**
 *
 *  ⛔ ~~第一版:從 `.next/static/` 讀【編譯後】的 CSS 與字型~~
 *     在本機**完全正常**(那些檔就在那裡), 而在 Vercel 上**拿不到**:
 *     `outputFileTracingIncludes` **拉不進 Next 自己的建置產物**(`next.config.ts` 有實驗數字)。
 *     🛑 那個壞法的形狀是最糟的:PDF 照樣產出來、HTTP 200, 而**每個中文是方框**
 *        ⇒ 所有機器可讀的訊號都一樣, 只有客人看得出來。
 *
 *  ✅ 現在:兩邊都改成**追蹤得到的來源**
 *     · 版面 CSS ⇒ `src/styles/*.css`(**原始碼**, 不是編譯產物)
 *       —— 這兩支是純 CSS、沒有前處理, 所以原始碼與編譯產物在這個用途上等價
 *     · 字型     ⇒ `@fontsource/noto-sans-tc`(住 `node_modules`)
 *       —— 它的 CSS 就是 `@font-face` + `unicode-range`, `buildStatementHtml` 現成吃得下 */
export async function GET(_req: Request, ctx: { params: Promise<{ displayId: string }> }) {
  const { displayId } = await ctx.params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 🔴 **沒登入也回 404,不是 401/redirect** —— 這條 route 是給瀏覽器直接下載的,
  //    它沒有畫面可以導。而 404 同時符合下面那條「不洩存在性」。
  if (!user) return new NextResponse(null, { status: 404 });

  let order = null;
  try {
    order = await (await getOrderRepo()).findOrderDetailForCustomer(displayId, user.id);
  } catch (err) {
    console.error('[statement.pdf] 讀取失敗:', err);
  }
  // 🔴🔴 **別人的單與不存在的單走同一個出口** —— 與那一頁逐字同一個立場:
  //    分開講會讓這條 route 變成一個列舉工具。那個模糊是資安性質的。
  if (!order) return new NextResponse(null, { status: 404 });

  // 🔵 資源組裝(版面 CSS + 字型內嵌)已搬去 `@/lib/print/statement-pdf`。
  //    🔴 而**那幾段註解跟著碼一起搬了, 不是被刪掉** —— `process.cwd()` 未量、
  //       目錄逃逸那道、`react-dom/server` 只能動態 import, 三段逐字在那支檔裡。
  //    🔴 而 `printButton: false` 與 `createElement` 那兩段理由**跟著碼搬進去了**,
  //       而且 codex R1 之後**鎖在函式裡**:本函式收的是 `order` 不是一個元素
  //       ⇒ ⇒ **「呼叫端漏傳 printButton」這個錯, 在型別上構造不出來。**
  const built = await buildStatementPdfHtml(order);

  // 🛑🛑 **fail closed —— 三種缺口都拒絕產檔, 不產一張壞掉的紙。**
  //
  //    ⛔ ~~第一版只擋 `embedded === 0`~~ —— 🔴 **codex 抓到那道閘太窄**:
  //       只要**其他子集嵌成功了**、而某一支這張紙真的用到的中文子集兩個字重都缺,
  //       `uncovered > 0` 當時只寫 log ⇒ **客人仍然拿到一張 200 的、局部方框的 PDF**。
  //       同理:兩支版面 CSS 讀不到會被吞成空字串 ⇒ **一張沒有任何樣式的紙, 照樣 200**。
  //    📌 **⇒ 部分壞掉比全部壞掉難發現, 而它一樣會被寄給客人的會計。**
  //
  //    🔴 **為什麼寧可 500**:那個壞掉的世界與成功的世界, 在**所有機器可讀的訊號上完全一樣**
  //       —— 只有客人看得出來, 而他不會回報, 他只會覺得這家店很爛。
  //       而 500 有出路:`/statement` 那一頁還在, 那顆「列印 / 儲存成 PDF」的鈕也還在。
  //
  //    ⚠️ **這一格有一個【誤殺】的代價, 而它需要 Sean 拍**:
  //       客人的姓名/地址若含 Noto Sans TC 也沒有的罕用字 ⇒ `uncovered` 永遠非空
  //       ⇒ **那位客人會永久下載不到 PDF**。兩個選項:
  //         甲(現在這樣)寧可不給, 也不給一張名字是方框的單
  //         乙 局部缺字仍照產, 而在 log 記一筆
  //       ⇒ 我選甲當預設(壞紙會被寄給第三方, 而錯誤不會), 而**這是端給 Sean 的一題, 未拍板**。
  const missingCss = built.missingCss;

  // 🔴🔴 **2026-08-31 Sean 拍板【乙】—— 而它推翻我上面那一整段的預設。**
  //    他逐字:「**照樣產, 缺的字變空白, 只記 log**」
  //    他的理由(主視窗轉):**甲會讓一個客人名字有生僻字就整張單印不出來, 而員工當下不知道為什麼。**
  //    ⇒ 📌 我上面那段自己寫的推理(「壞紙會被寄給會計」)**不是錯的, 而他把它權衡掉了** ——
  //      落檔寫「Sean 拍乙」, **不要寫成「我們發現甲不好」**。那不是他說的路徑。
  //
  // 🛑 **而我把他的拍板【收窄】到「缺字」那一種, 這是一個判斷, 寫出來讓人可以推翻我**:
  //    · `uncovered > 0`(某幾個字沒人涵蓋)⇒ ✅ **照產 + log** —— 那正是他描述的情況
  //    · `embedded === 0`(一支字型都沒嵌到)⇒ 🔴 **仍然拒絕** —— 那不是「某個生僻字」,
  //      那是**整張紙每一個中文都會是方框**, 而它的成因是部署壞了、不是客人的名字
  //    · 版面 CSS 讀不到 ⇒ 🔴 **仍然拒絕** —— 那是一張沒有任何樣式的紙, 與缺字無關
  //    ⚠️ **而他那句話字面上涵蓋得到 `embedded === 0`**(「缺的字」可以讀成全部)
  //      ⇒ **這一格我端回去問了, 未拍板。** 在他答之前, 那兩種維持拒絕。
  if (built.embedded === 0 || missingCss) {
    console.error(
      // 🔴 **不記客人的字**(codex nit):原本會把最多 20 個實際字元寫進 log,
      //    而那是可識別的訂單內容。只留數量 —— 要知道是哪些字, 去本機重現。
      // 🛑 **而 `displayId` 我刻意留著, 與 codex 的建議不同, 理由寫在這裡讓下一個人可以推翻我**:
      //    它本來就在這條 route 的 URL 裡, 而平台的 access log 一定有它
      //    ⇒ 拿掉它不會讓這筆更不可識別, 只會讓客服拿到客訴時**對不到是哪一張單**。
      `[statement.pdf] 拒絕產檔 displayId=${displayId} · 內嵌 ${built.embedded} · 拿不到字型檔 ${built.skippedMissing} · 版面 CSS 缺 ${missingCss} · cwd=${process.cwd()}`,
    );
    return new NextResponse(null, { status: 500 });
  }

  // ✅ Sean 拍乙那一格:缺字**照產**, 而它必須留下一筆 —— 否則沒有人知道那張紙上有空白。
  if (built.uncovered > 0 || built.skippedMissing > 0) {
    console.warn(
      `[statement.pdf] 缺字照產(Sean 2026-08-31 拍乙) displayId=${displayId} · 內嵌 ${built.embedded} · 拿不到字型檔 ${built.skippedMissing} · 沒有 face 宣告涵蓋的字 ${built.uncovered} 個`,
    );
  }

  try {
    // 🔵 Chrome 那一段搬去 `htmlToPdf()`(動態 import chromium 的理由跟著搬)。
    //    🛑 **`try` 的位置沒有動** —— 產檔失敗仍然由這裡接、仍然回 500。
    const pdf = await htmlToPdf(built.html);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        // 檔名用單號 —— 客人下載一疊的時候分得出來。
        'content-disposition': `attachment; filename="PCM-${displayId}.pdf"`,
        // 🔴 這是客人自己的單 ⇒ **不得被任何共用快取收走**。
        'cache-control': 'private, no-store',
      },
    });
  } catch (err) {
    // 🛑 母 plan §6:產檔失敗**不得讓既有流程死**。這條 route 就是那個功能, 所以它自己回 500;
    //    而客人仍然拿得到明細 —— 那一頁(`/statement`)還在, 那顆鈕也還在。
    console.error('[statement.pdf] 產檔失敗:', err);
    return new NextResponse(null, { status: 500 });
  }
}
