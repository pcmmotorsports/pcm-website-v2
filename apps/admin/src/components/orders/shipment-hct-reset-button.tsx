'use client';

// shipment-hct-reset-button.tsx — ⟦ship-HCTUNKNOWNSTUCK⟧ 片 C
//
// 🔴🔴 **這【不是】一顆「重送」鈕, 而那個差別是這一片的全部。**
//    它做的事是:**把一箱卡在「不知道送出去沒」的箱子, 放回草稿。**
//    ⇒ 放回草稿之後**有人會再按一次送出** ⇒ 🛑 **如果新竹其實收到了, 客人會收到兩箱。**
//
// ══ 為什麼要【打字】不是【打勾】 ═══════════════════════════════════════════
// 佔位是在 HTTP 發出去**之前**寫的 ⇒「有佔位而沒有回應」有**兩個世界**:
//    ① 那一發**從來沒送出去**  ② 送出去了而**回應掉了**
// 🔴 **我們這一端沒有任何量具分得出這兩個** ⇒ 📌 **系統不可以自己判。**
// ⇒ 它要求操作的人**先打電話問新竹**, 並把確認結果**打進去**。
// 🎯 **一個「打勾同意」擋不住習慣性點擊, 一個「要打字」擋得住** ——
//    而這個動作的代價是客人可能收到兩箱, 那值得多花五秒。
// 🔵 而那句話會連同**是誰打的**一起寫進稽核 ⇒ 它把一個機器答不出來的問題,
//    換成一個**有人負責而且查得到**的答案。
//
// ⚠️ **今天按下去會說「找不到那個功能」** —— `20260905320000` 還沒貼進正式庫。
//    ⛔ ~~**那是預期的, 不是 bug**~~ —— 🔴 **2026-09-05 訂正:那句話沒有射程, 而它會誤導。**
//    ✅ **本機開發時**那是預期的;而**在正式站它是一顆按下去回 `PGRST202` 的鈕**, 而**員工不知道那是什麼** ⇒ 📌 **所以這一片【不得先於 `20260905320000` 上線】**。
//    🎯 **抓到這句的是 `deploy-order-gate`**(它擋下第 26 批的 push)——
//      而**三綠、CI、全套測試【全綠】** ⇒ 📌 **「預期的」與「安全的」是兩件事,**
//      **而我用前者的語氣描述了後者。** 貼板在 `~/pcm-mailbox/貼板-0905/30_…sql`。

import { useCallback, useState } from 'react';
import { resetHctUnknownToDraftAction } from '../../lib/shipping/shipment-actions';

export function ShipmentHctResetButton({
  shipmentId,
  shipmentReference,
}: {
  shipmentId: string;
  shipmentReference: string;
}) {
  const [open, setOpen] = useState(false);
  const [attestation, setAttestation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const out = await resetHctUnknownToDraftAction({
      shipmentId,
      shipmentReference,
      attestation,
    });
    setBusy(false);
    if (out.ok) {
      setDone(true);
      setMessage('已放回草稿。');
      return;
    }
    setMessage(out.message);
  }, [shipmentId, shipmentReference, attestation]);

  // 🔴 成功之後【不再給第二次】—— 那一箱已經是 draft, 再按只會拿到一句 DB 的錯誤訊息。
  if (done) {
    return (
      <p className='text-muted-foreground mt-1 text-xs' role='status'>
        已放回草稿 —— 現在可以重新送出。
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type='button'
        className='text-muted-foreground mt-1 text-xs underline'
        onClick={() => setOpen(true)}
        aria-label={`放回草稿 ${shipmentReference}`}
      >
        我已向新竹確認【沒有】這張單 —— 放回草稿
      </button>
    );
  }

  return (
    <div className='mt-1 space-y-1'>
      <p className='text-destructive text-xs font-bold'>
        🔴 先打電話問新竹, 確認他們<span className='underline'>沒有</span>這張單, 再往下做。
      </p>
      <p className='text-muted-foreground text-xs'>
        查不到、電話打不通、或你只是覺得應該沒送出去 —— 都
        <span className='font-bold'>不要</span>放回草稿。放回去之後有人重送, 代價是客人收到兩箱。
      </p>
      <label className='block text-xs' htmlFor={`att-${shipmentId}`}>
        把確認結果打進去(例:14:30 電話向新竹陳小姐確認, 查無此單)
      </label>
      <textarea
        id={`att-${shipmentId}`}
        className='border-input w-full rounded-md border p-1 text-xs'
        rows={2}
        value={attestation}
        onChange={(e) => setAttestation(e.target.value)}
      />
      <div className='flex gap-2'>
        <button
          type='button'
          className='border-input rounded-md border px-2 py-1 text-xs'
          // 🔴 空白就不給按 —— 而 server 與 DB 那兩層【也】各擋一次。
          //    📌 三層擋的不是同一件事:這一層擋誤觸, server 擋繞過 UI, DB 擋繞過 server。
          disabled={busy || attestation.trim() === ''}
          onClick={() => void onSubmit()}
        >
          {busy ? '處理中…' : '確認放回草稿'}
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
