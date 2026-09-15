'use server';

// shipment-handover-action.ts — P0-1 片 5(plan 3.4):管理者「確認已交貨」那一支 server action。
//
// 🔵 自己一檔, 不放進 `shipment-actions.ts`:那支檔的源碼守門(`shipment-actions.test.ts`「本檔每一支寫入 action 都要有閘」)
//    逐字找 `authorizeAdminMutation`, 而這支用的是更嚴的 `authorizeManagerMutation`(它內部先過同一道 admin 閘)。
//    形狀照 `shipment-dispatch-hct-action.ts` 的拆法;本檔的閘由 `shipment-handover-action.test.ts` 守。

import { revalidatePath } from 'next/cache';
import type { ShipmentReference } from '@pcm/domain';
import { toShipmentReference } from '@pcm/domain';
import { authorizeManagerMutation } from '../session/authorize';
import { auditLog } from './shipment-action-audit';
import { confirmHctHandover } from './shipment-repository';
import type { VoidResult } from './shipment-actions';

/**
 * P0-1 片 5(plan 3.4):「確認已交貨」—— 叫過新竹、派遣結果沒記下來, 而貨確實交給司機了。
 * 🔴 權限兩層:這裡 `authorizeManagerMutation` 只為了給一句人話;真權威是 RPC 裡的 `is_manager`。
 * 🔴 `actor` 由這裡給, 不由 client 送。理由空白、狀態不對由 RPC 擋, 它的錯誤訊息是給人看的中文 ⇒ 直接顯示。
 */
export async function confirmHctHandoverAction(args: {
  shipmentId: string;
  shipmentReference: string;
  reason: string;
}): Promise<VoidResult> {
  const auth = await authorizeManagerMutation();
  if (auth === null) {
    return {
      ok: false,
      message: '只有管理者可以確認已交貨。若你是管理者, 請先在右上角選擇操作人員, 再送一次。',
    };
  }
  if (args.reason.trim() === '') {
    return { ok: false, message: '一定要填理由(例如司機簽收單號、跟新竹哪位確認、幾點)。' };
  }
  let reference: ShipmentReference;
  try {
    reference = toShipmentReference(args.shipmentReference);
  } catch {
    return { ok: false, message: '這箱的箱號格式不對, 不能確認交貨。這不是你操作錯, 請回報並附這行字。[shipment_reference]' };
  }
  auditLog('shipment.hct_handover_confirm', auth, 'attempt', { shipment_id: args.shipmentId });
  try {
    await confirmHctHandover({
      shipmentReference: reference,
      actor: auth.actorId,
      reason: args.reason,
      // 🔴 動態 import:理由同 `resetHctUnknownToDraftAction`(`../audit/context` 是 server-only)。
      requestId: await (await import('../audit/context')).getRequestId(),
    });
    revalidatePath('/orders');
    auditLog('shipment.hct_handover_confirm', auth, 'ok', { shipment_id: args.shipmentId });
    return { ok: true };
  } catch (e) {
    auditLog('shipment.hct_handover_confirm', auth, 'fail', { shipment_id: args.shipmentId });
    return { ok: false, message: e instanceof Error ? e.message : '確認已交貨失敗' };
  }
}
