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
// 🔴 **也不收 `customerUserId`。** 第一版收了,而那等於「箱子掛誰」的唯一來源是瀏覽器裡的
//    一個字串(改成另一位合法客人 ⇒ 先替錯的人建出空箱,要到掛品項才被 DB 擋)。
//    現在客人由 `submitShipment` **從送出的品項自己反查**,client 沒有這個欄位可以送。
//
// 🔴 **送出中不給關窗**(`busy` 時 ✕ disabled)。允許關窗會開出兩個洞:
//    ①關掉再開 ⇒ 新的冪等鍵 ⇒ 同一批貨真的建出第二箱;
//    ②飛在半空的那次送出回來後仍會呼叫 `onDone`,把**新開的**彈窗關掉。
//    ⚠️ 這道鎖的**代價**:`busy` 一旦回不來,彈窗就關不掉 ⇒ `run()` 的 `finally` 是承重的(見下)。
//    🔴 **剩下的天花板**:請求真的永遠不回(網路吊死)時仍然只能重整頁面 —— 這裡**沒有** timeout。
//    不做 timeout 是刻意的:計時器到了要嘛謊稱失敗(其實可能成功了)、要嘛解鎖讓人再按一次
//    (那就回到重複建箱)。兩個都比「重整一次、去出貨卡看箱子在不在」更糟。
//
// 🔴 **同一個品項只有一列 + 數量框**:`admin_add_shipment_items` 會退回同一份清單裡
//    重複的 `order_item_id` 並要求合併數量 ⇒ 畫面上不提供「再加一次」。
//
// ⚠️ 這裡的表單檢查是**體驗層不是正確性層**:真正擋住壞資料的是 DB 的 CHECK。
//    先擋只是不要讓員工按了才看到錯誤。

import { useCallback, useMemo, useState } from 'react';
import { toMessage } from '../../lib/shipping/error-message';
import { parseShipmentError } from '../../lib/shipping/shipment-error-view';
import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';
import { submitShipment, type SubmitShipmentResult } from '../../lib/shipping/shipment-actions';

type Recipient = { name: string | null; phone: string | null; line: string | null };

const CARRIERS = [
  { code: 'hct', label: '新竹物流' },
  { code: 'sf', label: '順豐' },
  { code: 'other', label: '其他' },
] as const;

/**
 * 出不了的原因 → 給員工看的一句話(#351②)。
 *
 * 🔴 **用 switch 不用查表物件**:`TABLE[reason]` 那種寫法在 `reason` 是非預期字串時會取到
 *    原型鏈上的東西(`constructor` / `toString` 都是 truthy),本 repo 為這個形狀修過 6 頁
 *    (memory `reference_js-index-lookup-hits-prototype-chain`)。switch 沒有這個面。
 * 🔴 `default` 走「數量資料尚未就緒」而不是「未到貨」:漏帶或非預期值代表**我們不知道**,
 *    此時編一個具體的原因給員工 = 把不知道偽裝成事實,他會照著去做錯的下一步。
 */
function blockedText(reason: ShipmentCandidateItem['blockedReason']): string {
  switch (reason) {
    case 'cancelled':
      return '已取消';
    case 'all_boxed':
      return '已全數配箱';
    case 'not_arrived':
      return '未到貨';
    default:
      return '數量資料尚未就緒';
  }
}

export function ShipmentDialog({
  candidates,
  recipient,
  idempotencyKey,
  onClose,
  onDone,
}: {
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
      try {
        const r = await submitShipment({
          idempotencyKey, // 🔴 不重生:重試沿用同一把
          recipient: { name: recipient.name ?? '', phone: recipient.phone ?? '', line: recipient.line ?? '' },
          carrierCode: carrier,
          ...(carrier === 'other' ? { carrierNote: note.trim() } : {}),
          items: chosen,
          ...(markShipped && tracking.trim() !== '' ? { trackingNumber: tracking.trim() } : {}),
          markShipped,
        });
        setResult(r);
        if (r.ok) onDone();
      } catch (e) {
        // 🔴🔴 **這個 catch 是承重的。** `submitShipment` 是 server action:它**自己內部**的錯誤
        //    會被包成 `{ok:false}` 回來,但**傳輸層**失敗(斷網、部署換版、RSC 回應壞掉)是直接 throw。
        //    少了它,`busy` 永遠停在 true,而 ✕ 是 `disabled={busy}` ⇒
        //    **員工被鎖在一個關不掉的彈窗裡,只能重整頁面** —— 那正是我為了擋「送出中關窗」
        //    而親手做出來的回歸(codex R2 抓到)。
        // 🔴🔴 **這句話要叫他「再按一次」,不是「關掉重整」。** 第一版寫成後者,而那是**最糟**的動作:
        //    ①冪等鍵存在這個彈窗的 state 裡 ⇒ **關窗就丟了**,下次開窗是新鍵 ⇒ 真的建出第二箱。
        //    ②`createShipment` 成功、`addShipmentItems` 之前斷線的話,那是一個**沒有品項的空箱** ——
        //      而訂單詳情頁的出貨卡是「由品項反查箱」畫出來的(`loadOrderShipments`)
        //      ⇒ **空箱在出貨卡上根本看不到**,叫他去那裡找等於叫他去看一個不會顯示的東西。
        //    ⇒ 正解就是本檔開頭那條紀律:**同一把鍵再送一次**,建箱會被認成重放(不會多一箱),
        //      掛品項接著補上。(codex R3 抓到:我的文案與本檔自己寫的復原路徑互相矛盾。)
        setResult({
          ok: false,
          message: `${toMessage(e)}(送出中斷線或伺服器沒回應。⚠️ 請**直接再按一次同一顆按鈕** —— 這個視窗還握著同一把冪等鍵,重送不會重複建箱。🔴 不要關掉視窗重來:關掉就換一把鍵了,那才會真的多出一箱。)`,
          shipmentReference: null,
          // 傳輸層失敗(斷網 / 部署換版)⇒ 沒有 SQLSTATE。白話層會退回吐上面那段(它本來就是人話)。
          code: null,
        });
      } finally {
        // 🔴 一定要在 `finally`:寫在 try 尾巴的話,上面那條 throw 路徑會跳過它、鎖死照舊。
        setBusy(false);
      }
    },
    [idempotencyKey, recipient, carrier, note, chosen, tracking, onDone],
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
          {/* 🔴 送出中不給關 —— 見檔頭那兩個洞。`disabled` 同時擋掉滑鼠與鍵盤(Enter/Space)。 */}
          <button
            type='button'
            disabled={busy}
            onClick={onClose}
            className='text-muted-foreground px-2 disabled:opacity-40'
            aria-label={busy ? '送出中,請等結果出來再關閉' : '關閉'}
            title={busy ? '送出中,關掉會讓同一批貨可能被建成兩箱' : undefined}
          >
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
                {/* 🔴 2026-08-09 Sean 實測後追加:一列要**三件都在** —— 訂單編號 + 商品名稱 + 料號。
                    料號另起一行而不是擠在品名後面:品名長、擠同一行會被 truncate 先吃掉料號,
                    而料號正是員工對著實物核對的那一欄。 */}
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm'>{c.title ?? '—'}</span>
                  <span className='text-muted-foreground block truncate font-mono text-xs'>
                    {c.variantSku}
                  </span>
                </span>
                {/* 🔴 2026-08-10 #351②:出不了的品項**留在清單裡並說明原因**,不是整列消失。
                    改成「到貨量起算」之後「可出 0」是常態(貨還沒到),整列不見會讓員工
                    以為系統壞了 —— 那正是 #351 這條 backlog 的來源。
                    🔴 三個原因不可合併成一句「未到貨」:對已全數配箱的品項那是假話,
                    而且員工的下一步動作不同(去看採購 vs 去看既有包裹 vs 找人修資料)。 */}
                {/* 🔴 判「能不能出」一律看 `remaining`,**不看 `blockedReason`** —— 下方的 `disabled`
                    也看 `remaining`。兩者共用同一個來源,否則「標籤說出不了、框卻打得進去」這種
                    自相矛盾的畫面會在某個欄位漏帶時無聲出現(R2 在 launcher 的 fixture 上抓到過)。
                    `blockedReason` 只負責**選哪句話**。 */}
                <span className='text-muted-foreground shrink-0 text-xs'>
                  {c.remaining > 0 ? `還能出 ${c.remaining}` : blockedText(c.blockedReason)}
                </span>
                {/* 🔴 數量框,不是「再加一次」—— 同一份清單裡重複的 order_item_id 會被 DB 退件 */}
                <input
                  type='number'
                  min={0}
                  max={c.remaining}
                  disabled={c.remaining === 0}
                  value={qty[c.orderItemId] ?? 0}
                  aria-label={`${c.title ?? '品項'} 要出的數量`}
                  onChange={(e) =>
                    setQty((p) => ({
                      ...p,
                      [c.orderItemId]: Math.max(0, Math.min(c.remaining, Number(e.target.value) || 0)),
                    }))
                  }
                  className='w-16 shrink-0 rounded border px-2 py-1 text-sm disabled:opacity-50'
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
            /* #351 ①(Sean 08-09 逐字「這個文字太難懂,精簡一點」):
               認得的 DB 拒因 → **一句人話 + 一句該怎麼辦**;原始訊息收進「詳細」摺疊。
               🔴 認不得的 → 照舊吐原文,**不吃掉**。安靜地少講一句話比講錯話更難查。 */
            <div className='text-destructive space-y-1 text-xs'>
              {(() => {
                const parsed = parseShipmentError(result.code, result.message);
                if (parsed.copy === null) return <p>{result.message}</p>;
                return (
                  <>
                    <p className='font-medium'>{parsed.copy.what}</p>
                    <p>{parsed.copy.next}</p>
                    <details>
                      {/* 🔴 標題是「詳細」**不是**「給工程師看」(code-reviewer 2026-08-10):
                          DB 原文帶**逐品項的實際數字**(可出幾件、你要出幾件),那正是員工要的答案;
                          標成給工程師看等於明示他不用看。 */}
                      <summary className='cursor-pointer select-none opacity-70'>詳細(每個品項可出幾件)</summary>
                      <p className='mt-1 font-mono break-all opacity-80'>{parsed.raw}</p>
                    </details>
                  </>
                );
              })()}
              {result.shipmentReference !== null && (
                <p>
                  ⚠️ 箱子 <b className='font-mono'>{result.shipmentReference}</b>{' '}
                  已經建出來了(還沒出貨)。再按一次會沿用同一箱、不會重複建;不寄的話請去訂單頁作廢它。
                </p>
              )}
            </div>
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
