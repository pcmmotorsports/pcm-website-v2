'use client';

import { useCallback, useState } from 'react';
import { fetchItemProcurementChoices } from '../../lib/orders/receipt-actions';
import type { ItemProcurementChoice } from '../../lib/orders/receipt-repository';
import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';
import { ReceiptRecordForm } from './receipt-record-form';

// receipt-panel.tsx — #352-b-2 入口 2:出貨彈窗裡的「登錄到貨」區塊。
//
// 🔴 **為什麼從 `shipment-dialog.tsx` 抽出來**(R1 Important I3):那支已經 455 行、
//    越過鐵則 6 的 **400 行硬線**(300 是警戒)。入口 2 是一塊自成邊界的東西
//    (自己的三態載入 + 自己的文案),抽出來兩邊都變好讀。
//
// 🔴 **`choices` 的三態不可壓成兩態**:`null`+`error` = 被拒或查詢失敗(重試 / 找工程);
//    `[]` = 真的沒有採購列(去採購區塊建一筆)。合併會讓彈窗對員工說錯話。

/** 入口 2 的狀態機:哪一件正在登錄、它的採購列、載入狀態。 */
export function useReceiptEntry() {
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [choices, setChoices] = useState<ItemProcurementChoice[] | null>(null);
  const [choicesState, setChoicesState] = useState<'idle' | 'loading' | 'error'>('idle');

  const openReceipt = useCallback(async (c: ShipmentCandidateItem) => {
    setReceiptFor(c.orderItemId);
    setChoices(null);
    setChoicesState('loading');
    const rows = await fetchItemProcurementChoices(c.orderId, c.orderItemId);
    // 🔴 `null` = 被拒或查詢失敗,**不是**「這件沒有採購列」——兩者員工的下一步完全不同。
    if (rows === null) {
      setChoicesState('error');
      return;
    }
    setChoices(rows);
    setChoicesState('idle');
  }, []);

  const closeReceipt = useCallback(() => {
    setReceiptFor(null);
    setChoices(null);
    setChoicesState('idle');
  }, []);

  /**
   * 🔴 **M2:登錄成功後把採購列也重抓一次**。
   *    `choices` 帶著 `allocated/received`,而剛剛那筆到貨已經把 `received` 推上去了
   *    ⇒ 不重抓的話,員工要登錄**第二批**時小視窗的預設值還是舊的
   *    (預設 = `allocated − received`)⇒ 第一次送出必吃一個 `QUANTITY_EXCEEDS_ALLOCATED`。
   *    那不是錯誤,是**我們讓他撞的**。
   */
  const refreshChoices = useCallback(async (orderId: string, orderItemId: string) => {
    const rows = await fetchItemProcurementChoices(orderId, orderItemId);
    if (rows !== null) setChoices(rows);
  }, []);

  return { receiptFor, choices, choicesState, openReceipt, closeReceipt, refreshChoices };
}

export function ReceiptPanel({
  candidates,
  receiptFor,
  choices,
  choicesState,
  onCancel,
  onRecorded,
}: {
  candidates: readonly ShipmentCandidateItem[];
  receiptFor: string | null;
  choices: ItemProcurementChoice[] | null;
  choicesState: 'idle' | 'loading' | 'error';
  onCancel: () => void;
  /** 🔴 必須是**穩定身分**(R1 Critical C1):呼叫端用 `useCallback` 釘住。 */
  onRecorded: () => void;
}) {
  if (receiptFor === null) return null;

  return (
          <div className='rounded-md border p-3'>
            <div className='mb-2 flex items-center justify-between'>
              <span className='text-sm font-medium'>登錄到貨</span>
              <button
                type='button'
                onClick={onCancel}
                className='text-muted-foreground text-xs underline'
              >
                取消
              </button>
            </div>

            {choicesState === 'loading' && (
              <p className='text-muted-foreground text-xs'>正在讀取這個品項的採購紀錄…</p>
            )}

            {/* 🔴 失敗文案要寫「怎麼辦」不是「失敗了」(Sean 操作直覺化常設指令) */}
            {choicesState === 'error' && (
              <p role='alert' className='text-destructive text-xs'>
                讀不到這個品項的採購紀錄。請關掉這個彈窗、重新整理訂單頁再試一次;
                若還是讀不到,請通知系統維護(這批貨先不要出)。
              </p>
            )}

            {choicesState === 'idle' && choices !== null && choices.length === 0 && (
              <p className='text-xs'>
                這個品項還沒有任何採購紀錄,所以沒有可以登錄到貨的對象。
                請先到訂單頁的「採購」區塊補上要向誰訂(或選「店內現貨」),再回來登錄。
              </p>
            )}

            {choicesState === 'idle' &&
              choices !== null &&
              choices.map((ch) => {
                const item = candidates.find((c) => c.orderItemId === receiptFor);
                if (!item) return null;
                return (
                  <div key={ch.procurementId} className='border-t pt-2'>
                    <p className='text-muted-foreground mb-1 text-xs'>
                      {ch.supplierLabel ?? '(供應商資料缺)'} · 訂購 {ch.allocatedQuantity} · 已到貨{' '}
                      {ch.receivedQuantity}
                    </p>
                    <ReceiptRecordForm
                      orderId={item.orderId}
                      orderItemId={item.orderItemId}
                      procurementId={ch.procurementId}
                      returnTo={`/orders/${item.orderId}`}
                      remaining={Math.max(0, ch.allocatedQuantity - ch.receivedQuantity)}
                      inline
                      /* 驗收 23a:**不重整**、同一個彈窗內該品項變成可勾選且可出。
                         🔴 直接傳穩定的 `onRecorded`,**不要**在這裡包一層新的箭頭函式 ——
                            那會讓身分每次 render 都變、把 C1 那條迴圈原地復活。 */
                      onRecorded={onRecorded}
                    />
                  </div>
                );
              })}
          </div>
  );
}
