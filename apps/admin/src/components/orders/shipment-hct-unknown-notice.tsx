import { ShipmentHctResetButton } from './shipment-hct-reset-button';

// shipment-hct-unknown-notice.tsx — ⟦ship-HCTUNKNOWNSTUCK⟧ 的 UI 那半(乙-2)
//
// 🔴🔴 **這一片【只做看得見的那半】, 而那是一個拍板**(主視窗 2026-09-05 乙-2):
//    plan 的核心是「**查到沒送出去才准放回 draft**」—— 而那要先查得動新竹。
//    而 2026-09-05 05:0x 量到:那個服務**只講 SOAP**, 我們的 client 送 JSON
//    ⇒ 📌 **今天查不動 ⇒ 那顆「重設為草稿」永遠不會亮 ⇒ 現在做它等於做一顆假鈕。**
//    ⇒ 而那支 RPC 的守門是「憑證據才准重設」, **證據的形狀由傳輸決定**
//      ⇒ 🛑 **migration 是不可變歷史, 現在寫等於猜。** 等 `Q-新竹傳輸方式` 答完。
//
// 🔵 **所以這一片能買到的只有一件, 而它值得**:
//    讓那一箱**在畫面上看得見**。今天卡住的箱與正常的箱**長得一模一樣**,
//    而員工唯一會做的事就是**再按一次送出** —— 那正是 `unknown` 要擋的。

/** DB 的 `shipments.hct_status` 值域(`20260904140000` 加了 `unknown`)。 */
export type HctStatus = 'draft' | 'submitted' | 'failed' | 'unknown';

export function ShipmentHctUnknownNotice({
  hctStatus,
  shipmentId,
  shipmentReference,
  placeholderStuck = false,
}: {
  hctStatus: string;
  shipmentId?: string;
  shipmentReference?: string;
  /**
   * 🔴 **甲型(佔位卡住)才給出口** —— 乙型(新竹回過話而我們讀不懂)那顆鈕**不出現**。
   * 🛑 **不出現, 不是 disabled** —— 📌 一顆 disabled 的鈕會讓人去找「怎麼把它變成可按」,
   *    而乙型今天**沒有安全的答案**(等 `Q-新竹傳輸方式`)。
   */
  placeholderStuck?: boolean;
}) {
  // 🔴 只有 `unknown` 出聲 —— 其餘三態不畫任何東西。
  //    📌 **一個對每一箱都說話的提示, 會被學會忽略**;而這一句要在它出現時被讀到。
  if (hctStatus !== 'unknown') return null;
  const canReset =
    placeholderStuck && shipmentId !== undefined && shipmentReference !== undefined;
  return (
    <div className='mt-1'>
      <p className='text-destructive text-xs font-bold' role='status'>
        送出結果未知 —— <span className='underline'>不要重送</span>,先查新竹
        {!canReset && (
          <span className='text-muted-foreground ml-1 font-normal'>
            (查詢功能未接:新竹傳輸方式待確認)
          </span>
        )}
      </p>
      {canReset && (
        <ShipmentHctResetButton shipmentId={shipmentId} shipmentReference={shipmentReference} />
      )}
    </div>
  );
}
