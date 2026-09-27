// bulk-box.ts — 多張單一次各建一箱的「一張單」那一步(2026-09-27 出貨流程乙第 7 項;Sean 答 Q1 甲)。
// 計畫 ~/pcm-mailbox/計畫-後台出貨流程乙-20260927.md 第二節第 7 項。
//
// 🔴 按訂單分組:每張單各自讀自己的可出品項、自己的收件地址、自己一把重試鍵, 各自跑一次既有的 `submitShipment`;
//    不把多張單交給單箱建箱流程(那一條會把多張單攤平、地址取第一張;Codex R1 建議 5)。呼叫端(瀏覽器)逐張依序呼叫本函式。
// 🔴 快照與鍵存在 sessionStorage(以訂單 id 為鍵), 成功才清。結果不明(送出時斷線)時, 重按用同一把鍵、同一份快照重送,
//    既有的防重複機制會回上一次的結果;**不重新讀品項**(同一把鍵內容不同會被拒, 20260807160000:301;Codex R3 必修 3)。
// 只建箱、不出貨 ⇒ 不寄信。快遞商固定新竹物流(批次建箱就是為了接著要號、叫車)。

import type { ShipmentCandidates } from './shipment-candidates';
import type { SubmitShipmentInput, SubmitShipmentResult } from './shipment-actions';
import { toRecipientSnapshot } from './recipient';

export type BulkBoxDeps = {
  fetchCandidates: (orderIds: readonly string[]) => Promise<ShipmentCandidates>;
  submit: (input: SubmitShipmentInput) => Promise<SubmitShipmentResult>;
  /** `null` = 瀏覽器不給用(私密視窗等)⇒ 仍然建箱, 只是斷線後重按會是新的一把鍵。 */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  newKey: () => string;
};

/** `label` = 訂單編號(給人看的);讀不到候選時是 null。 */
export type BulkBoxOutcome = { orderId: string; label: string | null; ok: boolean; text: string };

type Saved = { input: SubmitShipmentInput; label: string | null };

const storageKey = (orderId: string) => `bulk-ship:${orderId}`;

function readSaved(storage: BulkBoxDeps['storage'], orderId: string): Saved | null {
  try {
    const raw = storage?.getItem(storageKey(orderId)) ?? null;
    return raw === null ? null : (JSON.parse(raw) as Saved);
  } catch {
    return null;
  }
}

export async function createBoxForOrder(orderId: string, pickedItemIds: readonly string[], deps: BulkBoxDeps): Promise<BulkBoxOutcome> {
  let saved = readSaved(deps.storage, orderId);
  let input = saved?.input ?? null;
  let label = saved?.label ?? null;
  if (input === null) {
    const c = await deps.fetchCandidates([orderId]);
    label = c.items[0]?.orderDisplayId ?? null;
    const items = c.items
      .filter((i) => pickedItemIds.includes(i.orderItemId) && i.remaining > 0)
      .map((i) => ({ orderItemId: i.orderItemId, quantity: i.remaining }));
    if (items.length === 0) {
      return { orderId, label, ok: false, text: '勾到的品項目前沒有可出的數量，沒有建箱。' };
    }
    const recipient = c.recipient === null ? null : toRecipientSnapshot(c.recipient);
    if (recipient === null) {
      return { orderId, label, ok: false, text: '這張單的收件資料不完整，沒有建箱。請先補收件人。' };
    }
    input = { idempotencyKey: deps.newKey(), recipient, carrierCode: 'hct', items, markShipped: false };
    try {
      if (deps.storage !== null) {
        deps.storage.setItem(storageKey(orderId), JSON.stringify({ input, label } satisfies Saved));
        saved = { input, label };
      }
    } catch {
      // 存不進去也照建;只是斷線後重按不會沿用同一把鍵(下面的句子會改說法)。
    }
  }
  let r: SubmitShipmentResult;
  try {
    r = await deps.submit(input);
  } catch {
    return {
      orderId,
      label,
      ok: false,
      // 2026-09-28 R1 Fable 建議:沒存進瀏覽器就不能承諾「不會多建一箱」(重按會是新的一把鍵)。
      text:
        saved !== null
          ? '這張單的建箱結果不明。請再按一次（會沿用同一筆資料，不會多建一箱），或打開這張單看箱子。'
          : '這張單的建箱結果不明。請先打開這張單看箱子；沒有箱子再重新建箱，以免多建一箱。',
    };
  }
  // 2026-09-28 R1 Fable 建議:資料庫明確拒絕而沒建箱(沒箱號、有錯誤代碼)⇒ 這把鍵沒用掉, 清掉快照,
  //   下次重讀品項與地址(否則員工改了地址或品項, 重按仍送舊資料)。沒有錯誤代碼的失敗不確定, 快照留著。
  if (r.ok || (r.shipmentReference === null && r.code !== null)) {
    try {
      deps.storage?.removeItem(storageKey(orderId));
    } catch {
      // 清不掉不影響結果。
    }
  }
  if (r.ok) return { orderId, label, ok: true, text: `已建箱 ${r.shipmentReference}` };
  return {
    orderId,
    label,
    ok: false,
    text:
      r.shipmentReference === null
        ? r.message
        : `建箱沒有完成（箱 ${r.shipmentReference}）：${r.message} 請打開這張單看箱子。`,
  };
}
