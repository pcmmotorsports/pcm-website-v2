// hct-pickup-confirm.ts — 新竹的箱子「手打單號就標出貨」之前要先勾一格(⟦走查 F8⟧)。
//
// 🔴 Sean 2026-09-11 拍 Q1 乙「不一定, 有時候會在新竹自己的網站, 或用手寫的託運單」、
//    Q2 乙「留著, 但員工要先勾『新竹已經收走了』才能按」
//    (plan `docs/plans/2026-09-11-hct-manual-ship-before-dispatch-plan.md` §4, 主視窗轉)。
// 🔴 **只管手打那條**:建箱彈窗「建箱並標出貨」與出貨卡「填單號並標記出貨」。
//    叫車那條(`shipment-dispatch-hct-action.ts`)直接呼 repository 的 `markShipmentShipped`,
//    **不經過這裡、也不經過那兩支 action** ⇒ 叫到車就標出貨, 不受影響。
// 🔴 畫面與 server 共用同一句話與同一個判斷 —— 兩邊各寫一份會各自漂。
//    (`shipment-actions.ts` 是 `'use server'`, 只能匯出 async 函式 ⇒ 常數住在這裡。)

/** 勾選框上的字。 */
export const HCT_PICKUP_CONFIRM_LABEL = '新竹已經把貨收走了(這個單號是新竹給的)';

/** 沒勾就按(或繞過畫面直接送)時的那句話。 */
export const HCT_PICKUP_REQUIRED_MESSAGE =
  '新竹物流的箱子要先勾「新竹已經把貨收走了」才能標出貨。' +
  '還沒收走的話,先「只建箱」,再按「送新竹」、到出貨清單「叫車」—— 叫到車系統會自己標出貨。';

/** 手打標出貨要不要先勾:只有新竹。順豐 / 其他照舊。 */
export function needsHctPickupConfirm(carrierCode: string): boolean {
  return carrierCode === 'hct';
}
