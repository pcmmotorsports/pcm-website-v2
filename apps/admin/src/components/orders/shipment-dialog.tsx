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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unstable_isUnrecognizedActionError } from 'next/navigation';
import { ReceiptPanel, useReceiptEntry } from './receipt-panel';
import { toMessage } from '../../lib/shipping/error-message';
import { parseShipmentError } from '../../lib/shipping/shipment-error-view';
import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';
import { blockedText, emptySelectionMessage, staleDeploymentMessage } from './shipment-dialog-copy';
import { submitShipment, type SubmitShipmentResult } from '../../lib/shipping/shipment-actions';
import { CARRIER_LABEL, CARRIER_OPTIONS } from '../../lib/shipping/carrier-label';
import type { CarrierCode } from '../../lib/shipping/shipment-repository';

// 🔴 驗證文案裡的貨運商名也讀同一份表(R1 nit 10):原本硬寫「新竹或順豐」,
//    標籤改字時它不跟、而且沒有任何守門會紅 —— 那正是本片要消滅的症狀。
const NON_OTHER_NAMES = CARRIER_OPTIONS.filter((c) => c.code !== 'other')
  .map((c) => c.label)
  .join('或');

type Recipient = { name: string | null; phone: string | null; line: string | null };

// 🔴 標籤表已抽到 `lib/shipping/carrier-label.ts`(#10 片3)。
//    **本檔抽走的是【兩份】:`CARRIERS` 下拉表 + `useState` 那個 union**
//    (數法與完整的四份清單寫在 `carrier-label.ts` 檔頭)。
//    症狀是「下拉選單寫一個、訂單卡片寫另一個」,而**沒有任何守門會紅**。
//    ⚠️ 下拉選單的**順序**沿用抽出前的 `hct / sf / other`,釘在 `carrier-label.test.ts`。

export function ShipmentDialog({
  candidates,
  recipient,
  idempotencyKey,
  onClose,
  onDone,
  onRefreshCandidates,
}: {
  candidates: readonly ShipmentCandidateItem[];
  recipient: Recipient;
  /** 🔴 由呼叫端生成、整段重試沿用同一把(見檔頭)。 */
  idempotencyKey: string;
  /**
   * 關窗。參數 = **這個彈窗從開到關有沒有建出過箱子**(半成品箱:建箱成功、掛品項失敗)。
   * 🔴 是「曾經」不是「這次」—— 來源是 `everCreatedRef`,理由見它的宣告處(codex R1 MF1)。
   *
   * 🔴 呼叫端要拿它決定「關窗後要不要重取頁面」:半成品箱走的是**失敗路徑**,
   * 而失敗路徑不會呼叫 `onDone`(那是成功才走的收尾)⇒ 頁面上的出貨卡是舊的,
   * 空箱區不會出現。上面那句文案叫員工「到訂單頁找『未收尾的空箱』」,
   * 他關掉視窗卻看不到 = 字面與事實不符,而這正是 #351③ 當初刪掉地點的那個病。
   */
  onClose: (createdShipment: boolean) => void;
  onDone: () => void;
  /**
   * 登錄到貨成功後重取候選(驗收 23a)。回傳新的清單;呼叫端負責把它換進 state。
   *
   * 🔴 **不能只靠 `revalidatePath`** —— 彈窗是 client 狀態,#351④ 肉眼驗已實錘
   * 「作廢空箱後列不會從當下明細頁消失、要重整才消」⇒ 必須**明確重取**,
   * 不是假設頁面刷新會帶到。
   */
  onRefreshCandidates?: () => Promise<void>;
}) {
  /** 每個品項要出的數量;0 = 這次不寄。預設全出。 */
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(candidates.map((c) => [c.orderItemId, c.remaining])),
  );
  const [carrier, setCarrier] = useState<CarrierCode>('hct');
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState('');
  /** 🔴 員工**親手動過**的品項(R2 N2)。用 ref:它不影響渲染,只用來決定「這格能不能自動補」。 */
  const touchedRef = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitShipmentResult | null>(null);
  /**
   * 🔴 **這個彈窗到目前為止有沒有建出過箱子** —— 只增不減(false → true,永不回頭)。
   *
   * 🔴 **為什麼不能直接看 `result`**(codex R1 MF1):`result` 是**這一次送出**的結果,
   * 而 `run()` 開頭就 `setResult(null)`、`catch` 寫回的 result 帶 `shipmentReference: null`。
   * ⇒ 「半成品箱 → 再按一次 → 這次撞傳輸層斷線」之後,`result` 已經不記得箱號了,
   *   關窗會回報「沒建出箱」⇒ 不重取 ⇒ 員工照文案回訂單頁,那個**真的存在**的箱不在畫面上。
   * ⇒ 判準是「**曾經**建出過」,不是「這次的結果裡有沒有箱號」。
   * 用 ref:它不影響渲染,只在關窗那一刻被讀一次。
   *
   * ⚠️ **殘留邊界(R2 nit①,記著不假裝沒有)**:「**第一次**送出就撞傳輸層 throw」時,
   * 建箱可能**已經在 server 端成立**、而箱號從來沒回到瀏覽器 ⇒ 這顆旗標認不得它,關窗不重取。
   * 兜住它的是 `catch` 那段文案(叫他**用同一把鍵再按一次** —— 重送會被認成重放、不會多一箱),
   * 不是這顆旗標;旗標**做不到**,因為 client 手上根本沒有那一次的結果。
   */
  const everCreatedRef = useRef(false);
  /**
   * 🔴 **有沒有任何一次送出「結果不明」**(R3 F1)—— 傳輸層 throw 時設 true,只增不減。
   *
   * 為什麼不能用 `everCreatedRef` 代替:那顆只在**拿到回傳**時才變 true,而傳輸層 throw
   * 的定義就是「沒拿到回傳」—— 那一次 server 端可能**已經 commit 了箱**(見上面那條殘留邊界)。
   * ⇒ 「這個彈窗有沒有可能已經在後端留下一個箱」= `everCreatedRef || unknownOutcomeRef`,
   *   而不是單看前者。換版文案的「不會多出一箱」就是掛在這個判準上。
   */
  const unknownOutcomeRef = useRef(false);

  // 入口 2(#352-b-2):狀態機抽到 `receipt-panel.tsx`(鐵則 6,見該檔頭)。
  const { receiptFor, choices, choicesState, openReceipt, closeReceipt, refreshChoices } =
    useReceiptEntry();

  // ⚠️ **這裡的 `useCallback` 並沒有讓身分真的穩定**(R2 更正,別照句拿掉別處的 ref):
  //    deps 含 `candidates`,而 23a 成功後 `candidates` 就會換一份 ⇒ 這顆回呼照樣換身分。
  //    真正擋住 C1 那條迴圈的是 **`receipt-record-form.tsx` 那邊的 `onRecordedRef`**;
  //    這顆 `useCallback` 只是少掉「每次 render 都重建」的雜訊,不是防線。
  const handleRecorded = useCallback(() => {
    void onRefreshCandidates?.();
    // M2:採購列的 `received` 剛被推上去了 ⇒ 一起重抓,否則第二批的預設值是舊的。
    const item = candidates.find((c) => c.orderItemId === receiptFor);
    if (item) void refreshChoices(item.orderId, item.orderItemId);
  }, [onRefreshCandidates, candidates, receiptFor, refreshChoices]);

  // 🔴 **M1:重取之後,剛登錄那件的數量框要跟著補上** —— `qty` 只在掛載時初始化,
  //    23a 重取後該品項 `remaining` 由 0 變 N 但框裡還是 0 ⇒ 員工讀成**按了沒生效**。
  //    🔴🔴 **判準是「員工碰過沒有」,不是「值是不是 0」**(R2 N2)。
  //    上一版寫 `(prev[id] ?? 0) === 0` 才補,並在註解宣稱「手動調過的不會被蓋掉」——
  //    那句話**對 1 成立、對 0 不成立**:員工刻意把某件改成 0(這箱不出這件)會被當成
  //    「還沒填」而**靜默補回滿量**,他不重看一眼就會把不該出的東西裝進箱子。
  //    ⇒ 用 ref 記下他真的動過哪些,填補時跳過。
  useEffect(() => {
    setQty((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of candidates) {
        if (touchedRef.current.has(c.orderItemId)) continue;
        if ((prev[c.orderItemId] ?? 0) === 0 && c.remaining > 0) {
          next[c.orderItemId] = c.remaining;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [candidates]);

  const chosen = useMemo(
    () =>
      candidates
        .map((c) => ({ orderItemId: c.orderItemId, quantity: qty[c.orderItemId] ?? 0 }))
        .filter((i) => i.quantity > 0),
    [candidates, qty],
  );

  // 🔴 送出前的體驗層檢查。每一條都對應一個 DB 端的 CHECK,措辭盡量貼近 DB 的訊息。
  const blocker = useMemo<string | null>(() => {
    if (chosen.length === 0) {
      return emptySelectionMessage(candidates);
    }
    if (carrier === 'other' && note.trim() === '')
      return `快遞商選「${CARRIER_LABEL.other}」時必須填寫送法說明。`;
    if (carrier !== 'other' && note.trim() !== '')
      return `說明欄只給「${CARRIER_LABEL.other}」用,選${NON_OTHER_NAMES}時請清空。`;
    return null;
  }, [chosen.length, carrier, note, candidates]);

  /** 標出貨還多一道:非「其他」必須有單號。只建箱不受這條限制。 */
  const shipBlocker = useMemo<string | null>(
    () =>
      carrier !== 'other' && tracking.trim() === ''
        ? `快遞商是${NON_OTHER_NAMES}時,標出貨前必須填貨運單號。`
        : null,
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
        // 🔴 成功或半成品都算「建出過箱」;之後任何一次重試都不得把它抹回 false(見宣告處)。
        if (r.shipmentReference !== null) everCreatedRef.current = true;
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
        // 🔴🔴 **換版與斷線要分流,因為「再按一次」在換版下是錯的指示。**
        //    部署換版後,這個分頁載入的是舊 build,它編出來的 action id 在新 deployment 上不存在
        //    ⇒ Next 在**收到回應標頭之後**丟 `UnrecognizedActionError`
        //    (`server-action-reducer.js:94-100`;自動重送只涵蓋離線那條 `:78-90`)。
        //    再按一次送的是**同一個 id**(id 綁在已載入的 bundle 裡)⇒ 永遠拿到同一顆錯誤。
        //    ⇒ 唯一出路是重新整理讓瀏覽器換到新 build。
        // 🔴 文案本體(含「什麼都沒送出去」的原始碼依據、以及半成品箱那條分岔)在
        //    `shipment-dialog-copy.ts` 的 `staleDeploymentMessage()` —— 抽出去的理由同本檔其他文案:
        //    鐵則 6(本檔已過 400 行),而且文案這種東西要能被單獨測、不必先 render 整個彈窗。
        if (unstable_isUnrecognizedActionError(e)) {
          setResult({
            ok: false,
            // 🔴 判準是「**可能**建出過」(R1 must-fix 1 + R3 F1):確定建出過(半成品箱)
            //    與結果不明(前一次撞斷線)兩種都會讓「不會多出一箱」變成假話。
            message: staleDeploymentMessage(everCreatedRef.current || unknownOutcomeRef.current),
            shipmentReference: null,
            code: null,
          });
          return;
        }
        // 🔴 **這一次的結果不明**(R3 F1):沒拿到回傳 ⇒ server 可能已 commit 箱、也可能沒有。
        //    記下來,之後若撞上換版分支,那句「不會多出一箱」才不會說謊。
        unknownOutcomeRef.current = true;
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
        className='bg-card text-foreground mt-8 w-full max-w-2xl rounded-lg border'
        role='dialog'
        aria-label='建立包裹'
      >
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <h3 className='font-semibold'>建立包裹</h3>
          {/* 🔴 送出中不給關 —— 見檔頭那兩個洞。`disabled` 同時擋掉滑鼠與鍵盤(Enter/Space)。 */}
          <button
            type='button'
            disabled={busy}
            onClick={() => onClose(everCreatedRef.current)}
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

          <ul className='divide-y rounded-md border'>
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
                  onChange={(e) => {
                    touchedRef.current.add(c.orderItemId);
                    setQty((p) => ({
                      ...p,
                      [c.orderItemId]: Math.max(0, Math.min(c.remaining, Number(e.target.value) || 0)),
                    }));
                  }}
                  className='w-16 shrink-0 rounded-md border-input border px-2 py-1 text-sm disabled:opacity-50'
                />
                {/* 🔴 入口 2 只給 `not_arrived`(plan §5.2):四個原因各代表完全不同的下一步,
                    給 `all_boxed` 或 `cancelled` 一顆「貨到了」是**假話**,還會把員工指去
                    追一批根本不會來的貨(`shipment-candidates.ts:81-86` 逐字)。 */}
                {c.blockedReason === 'not_arrived' && receiptFor !== c.orderItemId && (
                  <button
                    type='button'
                    onClick={() => void openReceipt(c)}
                    className='shrink-0 rounded-md border-input border px-2 py-1 text-xs'
                  >
                    貨到了
                  </button>
                )}
              </li>
            ))}
          </ul>

          <ReceiptPanel
            candidates={candidates}
            receiptFor={receiptFor}
            choices={choices}
            choicesState={choicesState}
            onCancel={closeReceipt}
            onRecorded={handleRecorded}
          />

          <div className='grid gap-3 sm:grid-cols-2'>
            <label className='text-xs font-semibold'>
              快遞商
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value as CarrierCode)}
                className='mt-1 block w-full rounded-md border-input border px-2 py-1.5 text-sm font-normal'
              >
                {CARRIER_OPTIONS.map((c) => (
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
                className='mt-1 block w-full rounded-md border-input border px-2 py-1.5 text-sm font-normal'
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
                className='mt-1 block w-full rounded-md border-input border px-2 py-1.5 text-sm font-normal'
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
              {/* #351 ③「半成品箱提示保留但精簡」。
                  🔴 **保留的是箱號與「再按一次不會重複建」** —— 前者是 Sean 08-09 逐字
                     「我也找不到那個箱子在哪裡」的答案,後者是解除「不敢再按」的那句;
                     兩句都拿掉就等於叫員工自己猜,那不是精簡是丟資訊。
                  🔴 **地點在 2026-08-12 加回來了**(③ 當初刪掉它,是因為那時空箱在訂單頁
                     結構上畫不出來,指一個找不到東西的地方 = 字面與事實不符)。
                     ④ 已落地(`5d891eb3`:`shipment-section.tsx` 的「未收尾的空箱」區)
                     ⇒ 空箱現在**真的看得到**,不講地點反而變成把答案藏起來。
                  🔴 **講「這位客人任一張訂單頁」不是囉嗦**:空箱掛客人不掛訂單
                     (`shipments` 沒有 order_id),彈窗又可能是從訂單列表勾多張單開的
                     ⇒ 「訂單頁」單講會讓員工不知道該回哪一張。 */}
              {result.shipmentReference !== null && (
                <p>
                  ⚠️ 已建出箱 <b className='font-mono'>{result.shipmentReference}</b>
                  (未出貨)。再按一次沿用同一箱、不會重複建;不要了的話,關掉視窗,
                  到這位客人任一張訂單頁的「出貨」找「未收尾的空箱」作廢它。
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
            className='bg-foreground text-background rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50'
          >
            建箱並標出貨
          </button>
          <button
            type='button'
            disabled={busy || blocker !== null}
            onClick={() => void run(false)}
            className='rounded-md border-input border px-3 py-1.5 text-sm disabled:opacity-50'
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
