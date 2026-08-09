'use client';

// shipment-void-button.tsx — 出貨卡上的「作廢 / 復原」按鈕(片 2c 的 client island)。
//
// 🔴 **props 只收純量**(`shipmentId` / `shipmentReference` / `voided`),同 2b-1 紅線:
//    訂單詳情的讀模型帶成交價與 PII,整包不得進 client props。
//
// 🔴 **冪等鍵在「按下去」那一刻生成一次,存進 state;重試沿用同一把。**
//    與建箱彈窗同一條紀律 —— 若每次送出各生一把,連按兩次會真的作廢兩次
//    (第二次會撞「已作廢」而報錯,看起來像壞掉,其實是我們自己把冪等弄丟了)。
//
// 🔴 作廢**必須填原因**(`admin_void_shipment` 的 `p_void_reason` 是必填參數)。
//    這裡先擋是體驗層;真正擋住的是 DB。

import { useCallback, useState } from 'react';
import { unvoidShipmentAction, voidShipmentAction } from '../../lib/shipping/shipment-actions';

export function ShipmentVoidButton({
  shipmentId,
  shipmentReference,
  voided,
}: {
  shipmentId: string;
  shipmentReference: string;
  voided: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 🔴 一次操作一把鍵:按下「確認」時生成、失敗重按沿用同一把(直到成功或關閉)。 */
  const [key, setKey] = useState<string | null>(null);

  const run = useCallback(
    async (fn: 'void' | 'unvoid') => {
      const k = key ?? crypto.randomUUID();
      setKey(k);
      setBusy(true);
      setError(null);
      const r =
        fn === 'void'
          ? await voidShipmentAction({ idempotencyKey: k, shipmentId, voidReason: reason.trim() })
          : await unvoidShipmentAction({ idempotencyKey: k, shipmentId });
      setBusy(false);
      if (r.ok) {
        setOpen(false);
        setReason('');
        setKey(null); // 成功 ⇒ 下一次是另一個操作,要新的鍵
      } else {
        setError(r.message);
      }
    },
    [key, shipmentId, reason],
  );

  if (voided) {
    return (
      <span className='flex items-center gap-2'>
        <button
          type='button'
          disabled={busy}
          onClick={() => void run('unvoid')}
          className='rounded border px-2 py-1 text-xs disabled:opacity-50'
        >
          復原作廢
        </button>
        {error !== null && <span className='text-destructive text-xs'>{error}</span>}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='text-destructive border-destructive/40 rounded border px-2 py-1 text-xs'
      >
        作廢這箱
      </button>
    );
  }

  return (
    <span className='flex flex-wrap items-center gap-2'>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`作廢 ${shipmentReference} 的原因(必填)`}
        aria-label={`作廢 ${shipmentReference} 的原因`}
        className='w-56 rounded border px-2 py-1 text-xs'
      />
      <button
        type='button'
        disabled={busy || reason.trim() === ''}
        onClick={() => void run('void')}
        className='bg-destructive rounded px-2 py-1 text-xs text-white disabled:opacity-50'
      >
        確認作廢
      </button>
      <button
        type='button'
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className='rounded border px-2 py-1 text-xs'
      >
        取消
      </button>
      {error !== null && <span className='text-destructive w-full text-xs'>{error}</span>}
    </span>
  );
}
