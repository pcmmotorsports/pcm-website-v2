'use client';

// shipment-hct-handover-confirm-button.tsx — P0-1 片 5(plan 3.4):管理者「確認已交貨」。
//
// 🔴 只給「叫過新竹(佔位寫了)、而派遣成功沒記下來」的箱:貨其實交給司機了, 系統卻不知道。
//    按下去 = 記下交貨時間 + 誰 + 理由(RPC `admin_confirm_hct_handover` 寫 `hct_dispatched_at` 與稽核列)。
// 🛑 顯示條件(管理者 / 叫過車 / 沒記派遣 / 沒作廢)只是 UX —— 真權威在 RPC:非管理者、沒理由、狀態不對一律被擋。
// 🔵 形狀照隔壁 `shipment-hct-reset-button.tsx`(展開 → 填 → 確認)。

import { useCallback, useState } from 'react';
import { confirmHctHandoverAction } from '../../lib/shipping/shipment-handover-action';

export function ShipmentHctHandoverConfirmButton({
  shipmentId,
  shipmentReference,
}: {
  shipmentId: string;
  shipmentReference: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const out = await confirmHctHandoverAction({ shipmentId, shipmentReference, reason });
    setBusy(false);
    if (out.ok) {
      setDone(true);
      return;
    }
    setMessage(out.message);
  }, [shipmentId, shipmentReference, reason]);

  if (done) {
    return (
      <p className='text-muted-foreground mt-1 text-xs' role='status'>
        已記下交貨。
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type='button'
        className='text-muted-foreground mt-1 text-xs underline'
        onClick={() => setOpen(true)}
        aria-label={`確認已交貨 ${shipmentReference}`}
      >
        確認已交貨(管理者)
      </button>
    );
  }

  return (
    <div className='mt-1 space-y-1'>
      <p className='text-destructive text-xs font-bold'>
        只在確定貨<span className='underline'>已經交給新竹司機</span>時才按。
      </p>
      <p className='text-muted-foreground text-xs'>
        系統會記錄交貨時間、操作人員及確認理由。若不確定是否已交貨，請先向新竹確認，暫勿送出。
      </p>
      <label className='block text-xs' htmlFor={`handover-${shipmentId}`}>
        理由(例:司機簽收單號、跟新竹哪位確認、幾點)
      </label>
      <input
        id={`handover-${shipmentId}`}
        className='border-input w-full rounded-md border p-1 text-xs'
        maxLength={200}
        autoComplete='off'
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className='flex gap-2'>
        <button
          type='button'
          className='border-input rounded-md border px-2 py-1 text-xs'
          disabled={busy || reason.trim() === ''}
          onClick={() => void onSubmit()}
        >
          {busy ? '處理中…' : '確認已交貨'}
        </button>
        <button
          type='button'
          className='text-muted-foreground px-2 py-1 text-xs underline'
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
      {message !== null && (
        <p className='text-destructive text-xs' role='status'>
          {message}
        </p>
      )}
    </div>
  );
}
