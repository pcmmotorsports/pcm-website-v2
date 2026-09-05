// 後台的「出貨明細單 PDF」—— ⟦f3-SHIPPDF1⟧ P-2。伺服器產檔, 零對外請求。
//
// ══ 這條 route 的設計:逐條照顧客站那條(`statement.pdf/route.ts`)══════════════
// **不去 goto 自己的網址** —— 那要把員工的 session cookie 轉發進 headless Chrome。
// 改成:route 自己拿資料 → `renderToStaticMarkup(<ShippingDoc/>)` → `page.setContent(html)`。
//
// 🔴🔴 **授權走【與那一頁逐字相同】的兩道**(不是另外發明一套):
//   ① 全站登入閘 —— `proxy.ts:84` 的 matcher `'/((?!_next/static|_next/image|favicon.ico).*)'`
//      涵蓋 `/print/...`;本 route 的路徑在它底下 ⇒ **未登入拿不到這裡**。
//      🛑 而**「涵蓋」是我讀 matcher 讀出來的** ⇒ 上面那句**不是證據**。
//        ✅ 證據在 `shipping-pdf-auth.test.ts`:它【真的呼叫】`proxy()`, 餵一個真的沒有 cookie 的
//        `NextRequest` 打這條 `.pdf` 路徑, 斷言拿到的東西前四位元組**不是** `%PDF`(本片驗收條件①)。
//        ⚠️ 而那支檔答不到「有權限 ⇒ 真的吐得出 PDF」—— `@sparticuz/chromium` 是 Linux binary,
//          本機 `spawn ENOEXEC` ⇒ 那一半要線上有人下載一次。**缺口寫在那支檔的檔頭。**
//   ② 兩個 id 的關係 —— **不信網址**:先用訂單查它的包裹, 再從結果裡找那個箱號。
//      找不到 = 這箱與這單無關 ⇒ 404。**絕不拿箱 id 直接去查箱**(那一頁的檔頭逐字寫過)。
//
// 🔴🔴 **路徑形狀是【量出來的】, 不是挑的**(codex R1 must-fix-1, 2026-09-06):
//    ⛔ 我第一版把它放在 `shipping/[shipmentId].pdf/route.ts` —— 那是【動態段 + 副檔名】。
//    當場讀 build 產物 `.next/routes-manifest.json`:**兩條路由編出來的 regex 逐字相同**
//      `/print/orders/[id]/shipping/[shipmentId].pdf` ⇒ ^/print/orders/([^/]+?)/shipping/([^/]+?)(?:/)?$
//      `/print/orders/[id]/shipping/[shipmentId]`     ⇒ ^/print/orders/([^/]+?)/shipping/([^/]+?)(?:/)?$
//    ⇒ `.pdf` **從 regex 裡整個消失**, 而兩條互相遮蔽 —— 連【既有那張列印頁】都被拖下水。
//    🛑 而 `pnpm build` 對這件事**完全安靜**、三綠全綠、`.nft.json` 照樣生得出來
//      ⇒ 我原本那組 tracing 守門在這個世界裡是全綠的。
//    ✅ 改成【靜態段】`[shipmentId]/shipping.pdf/route.ts`(同顧客站 `statement.pdf` 的形狀),
//      並在 tracing 守門加一格直接讀 routes-manifest 比兩條 regex —— 那一格才殺得掉這個突變。
//
// 🔴 **URL 帶 `.pdf` 是規格不是風格** —— 同顧客站那條:它要能被當成一個檔下載。
//    ⚠️ 而**今天沒有任何一顆鈕指向它**(⟦f3-SHIPPDF1⟧ P-2 刻意不做鈕:OD 稿裡沒有那顆鈕,
//    而視覺不是本線的域)⇒ 📌 **它今天只有用網址打得到。**
//
// 🛑🛑 **本檔最可能的失敗形狀, 寫在最前面**(顧客站那條路踩過, 而後台是全新的一條):
//    **PDF 照樣產出來、HTTP 200, 而每個中文是方框** —— 資源在本機讀得到、在函式包裡讀不到。
//    ⇒ 而**三綠 / typecheck / lint / 任何單元測試都不會紅** —— 它們不看打包清單。
//    ⇒ ✅ 守它的是 `next.config.ts` 的 `outputFileTracingIncludes` 與那支 tracing 測試。
import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildStatementHtml, htmlToPdf, isInsideDir, resolveFontPkgs } from '@pcm/pdf';
import { getAdminOrderRepository } from '../../../../../../../lib/orders/order-repository';
import { isOrderId } from '../../../../../../../lib/orders/order-detail-view';
import { loadOrderShipments } from '../../../../../../../lib/shipping/order-shipments';
import { ShippingDoc } from '../../../../../../../components/print/shipping-doc';

// 🔴 一定要 nodejs runtime —— chromium 與 `node:fs` 在 edge 上都不存在。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 🔴 **明寫 maxDuration** —— 不寫會吃平台預設, 而那個預設值我們沒有量過。
//    ⚠️ 60 是**照抄顧客站那條**的估值, 而**後台這一側我一段都沒有量過**。
//    那條檔頭自己記著:`@sparticuz/chromium` 在 macOS 上跑不起來 ⇒ 本機量不到。
export const maxDuration = 60;

/** 版面 CSS —— 讀【原始碼】那一份(不是編譯產物;顧客站那條踩過:tracing 拉不進 `.next/`)。 */
function readPageCss(): string | null {
  // 🔴 `process.cwd()` 在 Vercel 上是什麼:**admin 這一側沒有量到**;
  //    storefront 那一側量到了 —— `packages/pdf/src/index.ts` 逐字記著 `cwd=/var/task/apps/storefront`。
  //    ⇒ 形狀大概是 `/var/task/apps/<app>`, 而**「大概」不是量到** ⇒ 兩個候選都試(同顧客站)。
  for (const dir of [
    join(process.cwd(), 'src', 'app', 'print'),
    join(process.cwd(), 'apps', 'admin', 'src', 'app', 'print'),
  ]) {
    try {
      return readFileSync(join(dir, 'print-a4.css'), 'utf8');
    } catch {
      /* 下一個候選 */
    }
  }
  return null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; shipmentId: string }> },
) {
  const { id, shipmentId } = await ctx.params;
  // 兩個 id 都要驗形狀:非 UUID 不打 DB(同那一頁的既有立場)。
  if (!isOrderId(id) || !isOrderId(shipmentId)) {
    return new NextResponse(null, { status: 404 });
  }

  const detail = await getAdminOrderRepository().findAdminOrderDetail(id);
  if (detail === null) return new NextResponse(null, { status: 404 });

  // 🔴 品項走頂層分頁撈到盡 —— 與那一頁同一個決定(`detail.items` 被 200 夾住,
  //    而餵給 `loadOrderShipments` 的 id 集合若被夾過, 後面的箱**根本不會被查到**)。
  // 🔵 三行的形狀**逐字照那一頁**(`page.tsx:72-77`)—— 不自己發明一組。
  const { items, reportedTotal } = await getAdminOrderRepository().listOrderItemsForDetail(id);
  const titleByItemId = new Map(items.map((it) => [it.id, it.title]));
  const groups = await loadOrderShipments(titleByItemId);
  // 🔴 `null` = **讀失敗**(不是「沒有箱」)⇒ 回 404 是在說「這張單不存在」, 而那是假的
  //    (codex R1 nit:有效單據被偽裝成不存在, 而值班會照著這個 404 去找一張根本沒問題的單)。
  //    ⚠️ 這裡**刻意不照那一頁**(它 notFound)—— 那一頁是人在看, 看得到畫面;
  //      這裡是機器在下載一個檔, 5xx 與 404 是值班唯一分得出「壞了」與「沒有」的地方。
  if (groups === null) {
    console.error(`[shipping.pdf] 讀不到這張單的包裹 order=${id} shipment=${shipmentId}`);
    return new NextResponse(null, { status: 500 });
  }
  // 🔴 **不信網址**:從這張單的箱子裡找那個 id, 找不到就是無關 ⇒ 404。
  const group = groups.find((g) => g.shipment.id === shipmentId);
  if (group === undefined) return new NextResponse(null, { status: 404 });

  const pageCss = readPageCss();
  const { latin, tc } = resolveFontPkgs();
  const pkgs = [latin, tc].filter((d): d is string => d !== null);
  // 400 + 700 —— 那張紙上兩種字重都有(同顧客站那條的理由)。
  const fontCss = pkgs
    .flatMap((dir) =>
      ['400.css', '700.css'].map((f) => {
        try {
          return readFileSync(join(dir, f), 'utf8');
        } catch {
          return null;
        }
      }),
    )
    .filter((css): css is string => css !== null)
    .join('\n');

  // 🔴 `react-dom/server` 只能【動態】import —— App Router 對它有一道靜態 import 閘。
  const { renderToStaticMarkup } = await import('react-dom/server');
  // 🔴🔴 **這一段要獨立成一個 const, 理由不是好看**(code-reviewer R3 must-fix):
  //    下面那道中文字型閘的分母自檢**必須對著這份 body 問**, 不能對 `built.html` 問 ——
  //    `built.html` 還含著 `pageCss`, 而 `print-a4.css` 的中文註解裡就有那五個探針字
  //    (我自己數了一次 `grep -o <字> print-a4.css | wc -l`:出57 · 貨17 · 明18 · 細6 · 單38
  //     —— 審查者報的是 50/16/16/5/33, 數法不同而**結論一樣:五個字都 > 0**,
  //     而本格要的就是「>0」這件事, 不是那個數字本身)。
  //    ⇒ 對 `built.html` 問的話 `probePresent` **永遠是 5**、警報永遠不響,
  //      而 `uncovered` 只從 `bodyHtml` 算(`packages/pdf/src/html.ts`)⇒ `missingCore` **恆為 0**
  //      ⇒ 📌 **這道閘會靜默地永遠放行, 而它的註解正好在宣稱它擋得住那件事。**
  const bodyHtml = renderToStaticMarkup(
    createElement(ShippingDoc, {
      detail,
      items,
      reportedTotal,
      shipment: group.shipment,
      lines: group.lines,
      // 🔴 `printButton: false` —— 那顆鈕是 `'use client'`, 而這裡沒有 client boundary。
      //    顧客站那條踩過:漏傳 ⇒ 正式環境 500(runtime log 逐字
      //    `Attempted to call StatementPrintButton() from the server`)。
      printButton: false,
    }),
  );
  const built = buildStatementHtml({
    bodyHtml,
    pageCss: pageCss ?? '',
    fontCss,
    readFont: (rel) => {
      // 兩個套件的 `src:url()` 都是 `./files/…` ⇒ 同一個 `rel` 兩個目錄各試一次。
      for (const dir of pkgs) {
        const p = resolve(dir, rel);
        // 🔴 防目錄逃逸 —— `startsWith` 不是目錄邊界;**每一支各判一次**。
        if (!isInsideDir(dir, p)) continue;
        if (existsSync(p)) return new Uint8Array(readFileSync(p));
      }
      return null;
    },
  });

  // 🔴🔴 **拒絕產檔的政策留在這裡**(不焊進共用函式 —— 顧客站那條的理由:
  //    下一個呼叫端要不要一樣拒絕還沒有人拍板)。
  //    `embedded === 0` = 一支字型都沒嵌到 ⇒ 那不是「某個生僻字」, 是整張紙都會是方框。
  //
  // 🔴🔴 **而 `embedded === 0` 一個人守不住**(codex R1 must-fix-2):拉丁那支嵌成功、中文那支
  //    整包沒進函式包 ⇒ `embedded > 0` ⇒ **這道閘放行, 回 200, 而那張紙上每個中文是方框**
  //    —— 那正是本片檔頭第一句寫的失敗形狀, 而我原本的閘對它是綠的。
  // ⛔ **我第一版的修法是「`uncovered` 裡有任何一個漢字就拒絕」, 而那是錯的**(codex R2 must-fix-1):
  //    它把【中文整包沒到】與【某個罕用字沒有 face】混成同一件事 ——
  //    一位姓名裡有 `𠮷` 的客人, 中文字型明明好好的, 卻永遠拿不到自己的出貨單,
  //    而那還**反轉了這張紙既有的「缺字照產」政策**(下面那段 warn 就是那個政策)。
  // ✅ 改成問一組**這張紙上一定會有、而且一定是常用字**的探針:抬頭那五個字。
  //    它們沒有 face 涵蓋 ⇒ 中文那支【整包】沒到位;而罕用字缺席不會動到這五個。
  const CJK_PROBE = [...'出貨明細單'];
  // 🔵 **分母自檢**:探針字若根本不在這張紙上, 它永遠不會落進 `uncovered`
  //    ⇒ 這道閘會**無聲地變成恆真**。抬頭改字的那天, 這裡要出聲。
  const probePresent = CJK_PROBE.filter((c) => bodyHtml.includes(c));
  if (probePresent.length === 0) {
    console.error('[shipping.pdf] 中文探針一個都不在這張紙上 ⇒ 下面那道字型閘是恆真的, 去對 ShippingDoc 的抬頭');
  }
  const missingCore = probePresent.filter((c) => built.uncovered.includes(c));
  if (built.embedded === 0 || pageCss === null || missingCore.length > 0) {
    console.error(
      `[shipping.pdf] 拒絕產檔 order=${id} shipment=${shipmentId} · 內嵌 ${built.embedded} · ` +
        `拿不到字型檔 ${built.skippedMissing} · 版面 CSS 缺 ${pageCss === null} · ` +
        `中文探針缺 ${missingCore.length}/${probePresent.length} 個 · ` +
        `字型套件 latin=${latin ?? 'null'} tc=${tc ?? 'null'} · cwd=${process.cwd()}`,
    );
    return new NextResponse(null, { status: 500 });
  }
  // 🔵 `uncovered` 是**字的陣列**不是數字(顧客站那條的 `StatementPdfHtml` 把它換算過,
  //    而這裡直接吃 `buildStatementHtml` 的回傳 ⇒ 要用 `.length`)。
  // 🔴🔴 **而下面那行原本寫的是 `${built.uncovered}`**(codex R1 must-fix-3)——
  //    註解寫著「要用 `.length`」而碼沒有, 於是它把**字本身**攤平印進平台 log。
  //    那些字來自收件人姓名 / 地址 / 品名 ⇒ **PII 進了一個不受我們控制、也刪不掉的地方**。
  //    ⇒ 📌 這是「註解宣稱的比碼多」最貴的一種形狀:它讀起來完全正確。
  if (built.uncovered.length > 0 || built.skippedMissing > 0) {
    // 缺字照產, 而它必須留下一筆 —— 否則沒有人知道那張紙上有空白。
    console.warn(
      `[shipping.pdf] 缺字照產 order=${id} · 內嵌 ${built.embedded} · ` +
        `拿不到字型檔 ${built.skippedMissing} · 沒有 face 涵蓋的字 ${built.uncovered.length} 個`,
    );
  }

  try {
    const pdf = await htmlToPdf(built.html);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="PCM-${detail.displayId}-${group.shipment.shipmentReference}.pdf"`,
        // 🔴 這張紙含收件人姓名/電話/地址 ⇒ **不得被任何共用快取收走**。
        'cache-control': 'private, no-store',
      },
    });
  } catch (err) {
    // 產檔失敗不得讓既有流程死 —— 那一頁(`/print/…/shipping/<id>`)還在, 員工照樣印得出來。
    console.error('[shipping.pdf] 產檔失敗:', err);
    return new NextResponse(null, { status: 500 });
  }
}
