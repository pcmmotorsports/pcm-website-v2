'use client';

// shipment-hct-uncertain-exits.tsx —— 「叫車結果未確認」的兩個出口(2026-09-28 出貨流程乙第 8 項;計畫第二節第 8 項)。
// 員工先打電話問新竹, 再依新竹的回答按其中一顆:
//   ① 新竹說已收走 ⇒ 一鍵標記出貨(單號用這一箱的新竹貨號, 等同勾了「新竹已經把貨收走了」)。
//      退款或取消的單由伺服器擋下, 這裡原話顯示。
//   ② 新竹說沒派到車 ⇒ 重新叫車。上一次叫車超過 10 分鐘才顯示(用伺服器時間算;真正的判準在資料庫)。
//      按下去先問一次, 再按「確認」才送出。

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markShipmentShippedAction } from '../../lib/shipping/shipment-actions';
import { redispatchShipmentAction } from '../../lib/shipping/shipment-redispatch-hct-action';

const REDISPATCH_WAIT_MS = 10 * 60 * 1000;
const BTN = 'border-border bg-card hover:bg-muted text-foreground inline-flex items-center rounded-md border px-2.5 py-1 text-xs disabled:opacity-50';

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });

export function ShipmentHctUncertainExits({
  shipmentId,
  shipmentReference,
  edelno,
  lastAttempt,
  serverNow,
}: {
  shipmentId: string;
  shipmentReference: string;
  /** 這一箱的新竹貨號(hct_request_id)。 */
  edelno: string | null;
  /** null = 讀不到叫車紀錄 ⇒ 不給重新叫車。 */
  lastAttempt: { lastNo: number; lastAt: string } | null;
  /** 伺服器畫這一頁的時間(ISO)。 */
  serverNow: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [markKey, setMarkKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [redispatchLocked, setRedispatchLocked] = useState(false);

  const allowedAt = lastAttempt === null ? null : new Date(lastAttempt.lastAt).getTime() + REDISPATCH_WAIT_MS;
  const canRedispatch = allowedAt !== null && new Date(serverNow).getTime() >= allowedAt;

  const markShipped = () =>
    start(async () => {
      const k = markKey ?? crypto.randomUUID();
      setMarkKey(k);
      setMsg(null);
      const r = await markShipmentShippedAction({
        idempotencyKey: k,
        shipmentId,
        ...(edelno === null ? {} : { trackingNumber: edelno }),
        hctPickedUpConfirmed: true,
      });
      // await 之後的狀態更新要再包一次 transition(React 19 規則):不包的話訊息先畫出來、按鈕下一次畫面才解除停用,
      // 員工(與測試)在中間那一刻按下去會沒反應。包起來 ⇒ 訊息與按鈕解除停用在同一次畫面(2026-09-28 偶發測試紅的根因)。
      start(() => {
        setMsg(r.ok ? { ok: true, text: '已標記出貨。' } : { ok: false, text: r.message });
        if (r.ok) router.refresh();
      });
    });

  const redispatch = () =>
    start(async () => {
      setMsg(null);
      const r = await redispatchShipmentAction({ shipmentId, expectedAttemptNo: lastAttempt!.lastNo });
      // 同上:await 之後的更新包進 transition, 與按鈕狀態同一次畫面。
      start(() => {
        setConfirming(false);
        setRedispatchLocked(true);
        setMsg(r.ok ? { ok: true, text: `已叫到車（貨號 ${r.edelno}），系統已標記出貨。` } : { ok: false, text: r.message });
        router.refresh();
      });
    });

  return (
    <span className='flex flex-col items-end gap-1.5' data-testid='hct-uncertain-exits'>
      <button
        type='button'
        disabled={busy || edelno === null}
        onClick={markShipped}
        aria-label={`新竹說已收走，標記出貨 ${shipmentReference}`}
        className={BTN}
      >
        新竹說已收走：標記出貨
      </button>
      {canRedispatch ? (
        confirming ? (
          <span className='flex flex-col items-end gap-1' data-testid='redispatch-confirm'>
            <span className='text-right text-xs font-medium text-orange-700'>
              會再向新竹物流叫一次車。請確定新竹說沒派到車才按，否則可能來兩台車。
            </span>
            <span className='flex gap-2'>
              <button type='button' disabled={busy} onClick={() => setConfirming(false)} className={BTN}>
                取消
              </button>
              <button
                type='button'
                disabled={busy}
                onClick={redispatch}
                className='bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50'
              >
                {busy ? '叫車中…' : '確認'}
              </button>
            </span>
          </span>
        ) : (
          <button
            type='button'
            disabled={busy || redispatchLocked}
            onClick={() => setConfirming(true)}
            aria-label={`新竹說沒派到車，重新叫車 ${shipmentReference}`}
            className={BTN}
          >
            新竹說沒派到車：重新叫車
          </button>
        )
      ) : (
        <span className='text-muted-foreground text-right text-xs'>
          {allowedAt === null
            ? '讀不到這一箱的叫車紀錄，暫時不能重新叫車。請重新整理頁面。'
            : `上一次叫車在 ${hhmm(lastAttempt!.lastAt)}，${hhmm(new Date(allowedAt).toISOString())} 以後（重新整理頁面）才能重新叫車，避免叫來兩台車。`}
        </span>
      )}
      {msg !== null && (
        <span role='status' className={`text-right text-xs ${msg.ok ? 'text-emerald-700' : 'font-medium text-orange-700'}`}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
