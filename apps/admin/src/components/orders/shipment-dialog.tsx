'use client';

// shipment-dialog.tsx — 建箱彈窗(片 2b-2b-2,C 版動線收官)。
//
// 🔴 **冪等鍵在開窗時生成一次、整個彈窗生命週期不換。**
//    重試(送出失敗後再按一次)必須沿用**同一把**,否則三支 RPC 的冪等層全部失效 ——
//    症狀是連按兩次真的建出兩個箱子,而兩次都回報成功。
//    ⇒ 鍵存在 state 裡、只在「開窗」與「成功後關窗」時換,**不在送出時換**。
//
// 🔴 **props 不收 `AdminOrderSummary` / `AdminOrderDetail`**(同 2b-1 紅線):
//    候選品項走 `ShipmentCandidateItem`(server 端算好的最小 DTO、零金額)。
//
// 🔴 **同一個品項只有一列 + 數量框**:`admin_add_shipment_items` 會退回同一份清單裡
//    重複的 `order_item_id` 並要求合併數量 ⇒ 畫面上不提供「再加一次」。
//
// ⚠️ 這裡的表單檢查是**體驗層不是正確性層**:真正擋住壞資料的是 DB 的 CHECK。
//    先擋只是不要讓員工按了才看到錯誤。

import { useCallback, useMemo, useState } from 'react';
import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';
import { submitShipment, type SubmitShipmentResult } from '../../lib/shipping/shipment-actions';

type Recipient = { name: string | null; phone: string | null; line: string | null };

const CARRIERS = [
  { code: 'hct', label: '新竹物流' },
  { code: 'sf', label: '順豐' },
  { code: 'other', label: '其他' },
] as const;

export function ShipmentDialog({
  customerUserId,
  candidates,
  recipient,
  idempotencyKey,
  onClose,
  onDone,
}: {
  customerUserId: string;
  candidates: readonly ShipmentCandidateItem[];
  recipient: Recipient;
  /** 🔴 由呼叫端生成、整段重試沿用同一把(見檔頭)。 */
  idempotencyKey: string;
  onClose: () => void;
  onDone: () => void;
}) {
  /** 每個品項要出的數量;0 = 這次不寄。預設全出。 */
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(candidates.map((c) => [c.orderItemId, c.remaining])),
  );
  const [carrier, setCarrier] = useState<'hct' | 'sf' | 'other'>('hct');
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitShipmentResult | null>(null);

  const chosen = useMemo(
    () =>
      candidates
        .map((c) => ({ orderItemId: c.orderItemId, quantity: qty[c.orderItemId] ?? 0 }))
        .filter((i) => i.quantity > 0),
    [candidates, qty],
  );

  // 🔴 送出前的體驗層檢查。每一條都對應一個 DB 端的 CHECK,措辭盡量貼近 DB 的訊息。
  const blocker = useMemo<string | null>(() => {
    if (chosen.length === 0) return '這箱還沒有任何品項。至少要選一件才能建箱。';
    if (carrier === 'other' && note.trim() === '') return '快遞商選「其他」時必須填寫送法說明。';
    if (carrier !== 'other' && note.trim() !== '') return '說明欄只給「其他」用,選新竹或順豐時請清空。';
    return null;
  }, [chosen.length, carrier, note]);

  /** 標出貨還多一道:非「其他」必須有單號。只建箱不受這條限制。 */
  const shipBlocker = useMemo<string | null>(
    () => (carrier !== 'other' && tracking.trim() === '' ? '快遞商是新竹或順豐時,標出貨前必須填貨運單號。' : null),
    [carrier, tracking],
  );

  const run = useCallback(
    async (markShipped: boolean) => {
      setBusy(true);
      setResult(null);
      const r = await submitShipment({
        idempotencyKey, // 🔴 不重生:重試沿用同一把
        customerUserId,
        recipient: { name: recipient.name ?? '', phone: recipient.phone ?? '', line: recipient.line ?? '' },
        carrierCode: carrier,
        ...(carrier === 'other' ? { carrierNote: note.trim() } : {}),
        items: chosen,
        ...(markShipped && tracking.trim() !== '' ? { trackingNumber: tracking.trim() } : {}),
        markShipped,
      });
      setResult(r);
      setBusy(false);
      if (r.ok) onDone();
    },
    [idempotencyKey, customerUserId, recipient, carrier, note, chosen, tracking, onDone],
  );

  return (
    <div className='bg-foreground/60 fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4'>
      {/* 🔴 `text-foreground` 是**承重的**,不是裝飾。2026-08-09 Sean 正式站實測:彈窗大量文字白字白底、
          整片不可讀。根因**不是寫死的色**,是**繼承** —— 彈窗原本掛在動作列
          `<div class="bg-foreground text-background">`(深底白字)裡面,面板只設了 `bg-card`(白底)
          **沒設字色** ⇒ 白底 + 繼承來的白字。凡是自己有設色的(muted / destructive / 主鈕)看得見,
          沒設的(標題 / 品名 / label / placeholder / 次要鈕)全部隱形 —— 症狀與 Sean 的截圖逐項吻合。
          ⇒ 兩道一起做:①面板**顯式**設字色(不論掛在哪都不再繼承)②把彈窗搬出動作列(見 shipping-selection.tsx)。 */}
      <div
        className='bg-card text-foreground mt-8 w-full max-w-2xl rounded-lg border shadow-xl'
        role='dialog'
        aria-label='建立包裹'
      >
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <h3 className='font-semibold'>建立包裹</h3>
          <button type='button' onClick={onClose} className='text-muted-foreground px-2' aria-label='關閉'>
            ✕
          </button>
        </div>

        <div className='space-y-3 px-4 py-3'>
          <p className='text-muted-foreground text-xs'>
            收件:{recipient.name ?? '—'} · {recipient.phone ?? '—'} · {recipient.line ?? '—'}
          </p>

          <ul className='divide-y rounded border'>
            {candidates.map((c) => (
              <li key={c.orderItemId} className='flex items-center gap-3 px-3 py-2'>
                <span className='text-muted-foreground w-24 shrink-0 font-mono text-xs'>{c.orderDisplayId}</span>
                <span className='min-w-0 flex-1 truncate text-sm'>{c.title ?? '—'}</span>
                <span className='text-muted-foreground shrink-0 text-xs'>還能出 {c.remaining}</span>
                {/* 🔴 數量框,不是「再加一次」—— 同一份清單裡重複的 order_item_id 會被 DB 退件 */}
                <input
                  type='number'
                  min={0}
                  max={c.remaining}
                  value={qty[c.orderItemId] ?? 0}
                  aria-label={`${c.title ?? '品項'} 要出的數量`}
                  onChange={(e) =>
                    setQty((p) => ({
                      ...p,
                      [c.orderItemId]: Math.max(0, Math.min(c.remaining, Number(e.target.value) || 0)),
                    }))
                  }
                  className='w-16 shrink-0 rounded border px-2 py-1 text-sm'
                />
              </li>
            ))}
          </ul>

          <div className='grid gap-3 sm:grid-cols-2'>
            <label className='text-xs font-semibold'>
              快遞商
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value as 'hct' | 'sf' | 'other')}
                className='mt-1 block w-full rounded border px-2 py-1.5 text-sm font-normal'
              >
                {CARRIERS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className='text-xs font-semibold'>
              貨運單號
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder={carrier === 'other' ? '可留空' : '標出貨前必填'}
                className='mt-1 block w-full rounded border px-2 py-1.5 text-sm font-normal'
              />
            </label>
          </div>

          {/* 🔴 說明欄只在「其他」時出現,而且必填 —— 兩個方向 DB 都會擋 */}
          {carrier === 'other' && (
            <label className='block text-xs font-semibold'>
              送法說明(必填)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder='例:客人自取 / 站到站'
                className='mt-1 block w-full rounded border px-2 py-1.5 text-sm font-normal'
              />
            </label>
          )}

          {blocker !== null && <p className='text-destructive text-xs'>{blocker}</p>}
          {result !== null && !result.ok && (
            <p className='text-destructive text-xs'>
              {result.message}
              {result.shipmentReference !== null && (
                <>
                  <br />
                  ⚠️ 箱子 <b className='font-mono'>{result.shipmentReference}</b>{' '}
                  已經建出來了(還沒出貨)。再按一次會沿用同一箱、不會重複建;不寄的話請去訂單頁作廢它。
                </>
              )}
            </p>
          )}
          {result?.ok === true && (
            <p className='text-xs'>
              已建立包裹 <b className='font-mono'>{result.shipmentReference}</b>
              {result.shipped ? '、並標記為已出貨。' : '(尚未出貨)。'}
            </p>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-2 border-t px-4 py-3'>
          <button
            type='button'
            disabled={busy || blocker !== null || shipBlocker !== null}
            onClick={() => void run(true)}
            className='bg-foreground text-background rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50'
          >
            建箱並標出貨
          </button>
          <button
            type='button'
            disabled={busy || blocker !== null}
            onClick={() => void run(false)}
            className='rounded border px-3 py-1.5 text-sm disabled:opacity-50'
          >
            只建箱、先不出貨
          </button>
          {shipBlocker !== null && blocker === null && (
            <span className='text-muted-foreground text-xs'>{shipBlocker}</span>
          )}
          {busy && <span className='text-muted-foreground text-xs'>送出中…</span>}
        </div>
      </div>
    </div>
  );
}
