// 後台的「新竹託運標籤 PDF」—— ⟦ship-HCTLABELCAPTURE⟧ 片 D2。伺服器產檔, **零對外請求**。
//
// 🎯 **這條路存在的那一刻**:員工手上有一箱貨、要貼標籤。那張圖**早就躺在庫裡了** ——
//    新竹建單那一發(`TransData_Json`)回的整包本來就存進 `shipments.hct_raw_response`
//    (`hct-client.ts` 逐字「`raw` 整包留著」)⇒ 📌 **缺的一直是【讀出來印】這一側。**
//
// ══ 逐條照 P-2(`shipping.pdf/route.ts`)══════════════════════════════════════
// 🔴🔴 **路徑用【靜態段】`label.pdf/`** —— P-2 的 codex R1 must-fix-1 量到:
//    動態段 + 副檔名(`[shipmentId].pdf`)編出來的 regex 裡 **`.pdf` 整個消失**,
//    兩條路由互相遮蔽, 而 `pnpm build` 對這件事**完全安靜**。守門 = 同層 `label-pdf-route-shape.test.ts`。
// 🔴🔴 **而這條 route 需要 chromium 的四包 `.br`, 它們【不會被靜態追蹤看到】**
//    (執行期字串 join 出來的路徑)⇒ `next.config.ts` 要**給它自己一個 key**。
//    🛑 我第一版**沒有加**:理由是「這張紙零文字 ⇒ 零字型 ⇒ 不必進 tracing」——
//      **字型那一半對, 而 chromium 那一半與字型無關** ⇒ 📌 一個正確的理由用在它沒涵蓋的項目上。
//      量到的:加 key 之前 `label.pdf` 的 `.nft.json` 裡 `.br` = **0**, 而 `shipping.pdf` = **4**。
//    ✅ 守門 = 同層 `label-pdf-tracing.test.ts`(它去數真的被帶進去幾支)。
// 🔴 **授權兩道**:①全站登入閘(`proxy.ts` matcher 蓋到 `/print/...`;證據在 auth 測試)
//    ②**不信網址** —— 先用訂單查它的箱, 再找那個箱號;找不到 = 這箱與這單無關 ⇒ 404。
//
// ══ 而有兩件事這條路【與 P-2 相反】, 理由寫在這裡 ═══════════════════════════
// ① **這張紙上一個字都沒有** ⇒ **零字型、零 `print-a4.css`**
//    ⇒ 📌 P-2 檔頭那句「PDF 產出來、HTTP 200, 而每個中文是方框」**在這條路上不存在**,
//      因為沒有中文可以變成方框。(貼紙上的多餘文字會跟著貼上箱子, 這也是版面決定。)
// ② **一格壞掉 ⇒ 不產檔, 回 409** —— 不印一張含警告格的紙。
//    P-2 那張是**人在看的明細單**, 缺一格看得出來;這張是**要撕下來貼上箱子的貼紙**,
//    🛑 而「這一格沒有標籤」與「這一格的標籤壞了」在紙上長得一模一樣。
import { NextResponse } from 'next/server';
import { htmlToPdf } from '@pcm/pdf';
import { getAdminOrderRepository } from '../../../../../../../lib/orders/order-repository';
import { isOrderId } from '../../../../../../../lib/orders/order-detail-view';
import { loadOrderShipments } from '../../../../../../../lib/shipping/order-shipments';
import { getHctLabelRawByShipmentId } from '../../../../../../../lib/shipping/shipment-repository';
import { extractHctLabelImage } from '../../../../../../../lib/shipping/hct-label-image';
import {
  A4_GRID,
  buildLabelPages,
  buildLabelSheetHtml,
  type LabelSheet,
} from '../../../../../../../lib/shipping/hct-label-layout';

// 🔴 一定要 nodejs runtime —— chromium 在 edge 上不存在。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// ⚠️ 60 是**照抄 P-2**, 而那一支自己註明「後台這一側一段都沒有量過」。這裡一樣沒量過。
export const maxDuration = 60;

/** 看得懂的錯要**看得懂** —— 員工看到的是這一行, 不是 HTTP 狀態碼。 */
function problem(status: number, text: string): NextResponse {
  return new NextResponse(text, {
    status,
    // 🔴 這條路的任何回應都可能牽到收件人資料 ⇒ 一律不給任何共用快取收走。
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string; shipmentId: string }> }) {
  const { id, shipmentId } = await ctx.params;
  if (!isOrderId(id) || !isOrderId(shipmentId)) return new NextResponse(null, { status: 404 });

  // 🔵 版面參數走 query —— 它們是**這一次列印**的事, 不是這一箱的屬性。
  const q = new URL(req.url).searchParams;
  const sheetParam = q.get('sheet') ?? 'single';
  if (sheetParam !== 'single' && sheetParam !== 'a4-2x3') {
    // 🔵 回顯**截斷**:這串是使用者送的。`text/plain` 下風險低, 而截斷比賭它更便宜
    //    (`apps/admin` 全域 grep `nosniff` ⇒ 0 命中 ⇒ 我們沒有那一層保險)。
    return problem(400, `sheet 只收 single 或 a4-2x3(收到 ${sheetParam.slice(0, 20)})`);
  }
  const sheet: LabelSheet = sheetParam;
  const startRaw = q.get('startAt');
  const startAt = startRaw === null ? 1 : Number(startRaw);
  // 🔴 **不夾, 擋** —— `buildLabelPages` 自己也會丟(逐字「夾到 1 會讓標籤印在一個已經撕走的
  //    格子上」), 這裡先擋是為了回一句**員工看得懂的話**而不是一個 500。
  if (!Number.isInteger(startAt) || startAt < 1 || startAt > A4_GRID.perSheet) {
    return problem(400, `startAt 必須是 1..${A4_GRID.perSheet} 的整數(收到 ${(startRaw ?? '').slice(0, 20)})`);
  }
  // ⚠️ `sheet=single` 時 `startAt` **驗了卻不生效**(`buildLabelPages` 只對 `a4-2x3` 用它)——
  //    這裡刻意**不報錯**:一張紙一張圖本來就沒有「從第幾格開始」。
  //    🔵 而它仍然被驗, 是為了讓「打錯字」在兩種版面下得到同一個回答。

  const detail = await getAdminOrderRepository().findAdminOrderDetail(id);
  if (detail === null) return new NextResponse(null, { status: 404 });

  // 🔴 品項走頂層分頁撈到盡 —— 逐字照 P-2:餵給 `loadOrderShipments` 的 id 集合若被夾過,
  //    後面的箱**根本不會被查到**。
  const { items } = await getAdminOrderRepository().listOrderItemsForDetail(id);
  const titleByItemId = new Map(items.map((it) => [it.id, it.title]));
  const groups = await loadOrderShipments(titleByItemId);
  // 🔴 `null` = **讀失敗**(不是「沒有箱」)⇒ 500。回 404 會讓值班去找一張根本沒問題的單。
  if (groups === null) {
    console.error(`[label.pdf] 讀不到這張單的包裹 order=${id} shipment=${shipmentId}`);
    return new NextResponse(null, { status: 500 });
  }
  const group = groups.find((g) => g.shipment.id === shipmentId);
  if (group === undefined) return new NextResponse(null, { status: 404 });

  const row = await getHctLabelRawByShipmentId(shipmentId);
  if (row === null) return new NextResponse(null, { status: 404 });
  // 🔴 作廢的箱不給標籤 —— 貼上去的箱子收不回來。(同 `shipment-section.tsx` 那顆列印鈕的立場,
  //    而**那一層只是 UX**:網址可貼、可書籤 ⇒ 這一層才是守門。)
  if (row.voidedAt !== null) return problem(409, '這一箱已作廢, 不提供託運標籤。');
  // 🔵 `submitted` 之外的狀態**不是錯**, 是「還沒送新竹」⇒ 講人話, 不要回 500。
  if (row.hctStatus !== 'submitted') {
    return problem(409, `這一箱還沒有新竹的標籤(目前狀態:${row.hctStatus})。請先送新竹, 送成功才會有圖。`);
  }

  const img = extractHctLabelImage(row.raw);
  if (!img.ok) {
    // 🔴 `reason` 是**我們自己造的短碼**(`not_an_image(hex:is_pdf,...)`)—— 零 PII。
    //    ⛔ **絕不把 `row.raw` 或那串圖印進 log**:那一包裡有收件人姓名 / 電話 / 地址,
    //      而平台 log 是一個我們刪不掉的地方(P-2 的 codex R1 must-fix-3 就是這一格)。
    console.error(`[label.pdf] 取不到標籤圖 order=${id} shipment=${shipmentId} reason=${img.reason}`);
    return problem(409, `新竹回的那一包裡沒有看得懂的標籤圖(${img.reason})。請把這一行原樣回報。`);
  }

  const pages = buildLabelPages({
    labels: [{ imageBase64: img.imageBase64, shipmentRef: group.shipment.shipmentReference }],
    sheet,
    startAt,
  });
  // 🔴🔴 **產檔【之前】的最後一道**:任何一格不是 `label` ⇒ 不產檔。
  //    上面 `extractHctLabelImage` 已經擋過一次, 而**這一層擋的是另一件事** ——
  //    `buildLabelPages` 自己那道 `brokenReason`(空字串 / 太短 / 非 base64 字元)。
  //    ⇒ 📌 兩道問的不是同一個問題:前者問「解得出圖嗎」, 後者問「這串字面上像不像話」。
  const bad = pages.flatMap((p) => p.slots).filter((s) => s.kind === 'broken');
  if (bad.length > 0) {
    const reasons = bad.map((b) => (b.kind === 'broken' ? b.reason : '')).join(',');
    console.error(`[label.pdf] 版面層判壞 order=${id} shipment=${shipmentId} reason=${reasons}`);
    return problem(409, `這張標籤圖版面層判定壞掉(${reasons}), 不產檔。`);
  }

  try {
    const pdf = await htmlToPdf(buildLabelSheetHtml(pages, img.mime, sheet));
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="HCT-${detail.displayId}-${group.shipment.shipmentReference}.pdf"`,
        // 🔴 標籤上有收件人姓名 / 電話 / 地址 ⇒ **不得被任何共用快取收走**。
        'cache-control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[label.pdf] 產檔失敗:', err);
    return new NextResponse(null, { status: 500 });
  }
}
