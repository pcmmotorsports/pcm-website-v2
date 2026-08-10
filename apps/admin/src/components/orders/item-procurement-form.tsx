'use client';

import { readSingle } from '../../lib/forms/single-value';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminOrderItemProcurement } from '@pcm/domain';
import { upsertItemProcurementAction } from '../../lib/orders/procurement-actions';
import {
  PROC_ALLOCATED_FIELD,
  PROC_CONTACT_CHANNEL_FIELD,
  PROC_EXCEPTION_REASON_FIELD,
  PROC_EXPECTED_ARRIVAL_FIELD,
  PROC_HYDRATED_FIELD,
  PROC_ORDER_ID_FIELD,
  PROC_ORDER_ITEM_ID_FIELD,
  PROC_REPLY_STATUS_FIELD,
  PROC_STALE_FIELD,
  PROC_SUBMITTED_AT_FIELD,
  PROC_SUBMITTED_AT_LOCAL_FIELD,
  PROC_SUPPLIER_ID_FIELD,
  PROC_SUPPLIER_ORDER_NO_FIELD,
  type ProcurementActionState,
  type ProcurementFormValues,
} from '../../lib/orders/procurement-action-state';
import { PROCUREMENT_REPLY_STATUSES } from '../../lib/orders/procurement-form';
import {
  REPLY_STATUS_LABEL,
  hydrateFormValues,
  toTaipeiInputValue,
  type ProcurementSupplierChoice,
} from '../../lib/orders/procurement-view';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// M-4b E10 A10b:單一品項的採購表單(upsert;master plan `:404` row 57)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 🔴 **一個品項一份表單、由「選供應商」決定新建或編輯** —— 這不是省事,是照 A5a 的模型畫:
//    它的 upsert 鍵就是 `(order_item_id, supplier_id)`(`20260803160000:15`)⇒ 選到已有的那家
//    = 編輯那一列、選到新的一家 = 新建。畫成「每列一個編輯鈕 + 另一個新增表單」反而要自己
//    再發明一套「這是新增還是編輯」的狀態,而那套狀態跟 DB 的真相可以不一致。
//
// 🔴 **hydrate 是全量 payload 的承重**(`20260803160000:19-24`):切換供應商時整份表單重填
//    自 `procurements[]` 那一列。少一欄 = 送 NULL = 靜默清掉既有事實 ⇒ 逐欄在
//    `procurement-view.ts:hydrateFormValues` 做,不在這裡臨時湊。
//
// 🔴 **截斷 = 拒送**(A9a-2 MF1 的下游義務):清單不完整時 hydrate 不可信,
//    整組欄位 `disabled` + 送出鈕拿掉 + hidden `stale=1`(action 端第二道)。
//
// 🔴 **hydration 前不給送**(關卡2 code-reviewer Critical;PROC_HYDRATED_FIELD 的 docstring 有完整因果):
//    React 19 的 form action 在 hydration 完成前就送得出去,那一刻 `onChange` 沒接上 ⇒
//    選到既有供應商但選填欄全空送出 ⇒ 全量 payload 把單號/異常原因/預計到貨/送出時間/管道全清成 NULL。
//    ~~原本這裡寫「安全底 = 解析器 fail-closed + RPC 第二道」~~ **是錯的**:兩道都認為空白是合法的「沒填」。
//    ⇒ 掛載前不渲染送出鈕 + hidden 旗標,action 端 fail-closed 再擋一次(沒帶旗標也擋)。
//    ⚠️ 代價 = 本表單放棄無 JS 的漸進增強,知情取捨。
//
// 🔴 **失敗回來的值要真的進畫面**(關卡2 code-reviewer finding 2):`useState` 初值只在首次掛載求值,
//    只寫 `useState(carried ?? …)` 的話 `state.values` **永遠不會被任何一次 render 消費**
//    ⇒ 「保留輸入」是空頭支票(受控欄位剛好自己活著,所以看起來沒事)。用 effect 明確套用。
//
// 🔴 **bfcache 返回鍵要重取**(關卡2 code-reviewer finding 3):A5a 無 version/CAS,
//    「全欄 hydrate 自**最新**列」的「最新」只到頁面載入那一刻;返回鍵還原會拿到更舊的快照
//    ⇒ `pageshow persisted` 時 `router.refresh()`。**這只縮小窗口、不消滅它**(頁面開著的整段時間
//    仍可能被別人改掉),誠實邊界寫在 handoff。

const RADIO_ROW = 'flex flex-wrap gap-x-4 gap-y-1';

/** 取台北牆上時間的「秒」兩位(保秒用;台灣固定 UTC+8,無日光節約)。 */
function secondsOf(iso: string | null): string {
  if (iso === null) return '00';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '00';
  return new Date(ms + 8 * 60 * 60_000).toISOString().slice(17, 19);
}

export function ItemProcurementForm({
  orderId,
  returnTo,
  orderItemId,
  procurements,
  supplierChoices,
  truncated,
}: {
  orderId: string;
  /**
   * #350d-3 C1:動作做完回哪裡 = **這個視圖自己的網址**。值不可信任:action 端一律再過
   * `parseOrderReturnTo`(站內白名單 + 剝一次性參數 + §6-1 同單比對)。
   */
  returnTo: string;
  orderItemId: string;
  procurements: readonly AdminOrderItemProcurement[];
  supplierChoices: readonly ProcurementSupplierChoice[];
  /** A9a-2:本品項的採購清單可能不完整(含外層 itemsTruncated;呼叫端已 or 起來) */
  truncated: boolean;
}) {
  // 🔴 **在送出那一刻**從實際的 FormData 取可見欄(關卡2 codex MF4):瀏覽器自動填 / 表單還原
  //    若沒觸發 React `onChange`,靠 state 算的值會是舊的;讀送出的那份 FormData 就不可能分岔。
  // 🔴 **這裡不做時區換算**(關卡2 codex R2 更正):偏移由 **server** 補 Asia/Taipei
  //    (A5a 契約 `20260803160000:475-476`)。瀏覽器換算 = 用裝置時區 ⇒ 非台北機器靜默存錯時刻。
  // 🔴 `datetime-local` 只到分鐘:既有 `14:30:45` 回填成 `14:30`,若原樣送出會把秒改成 `:00`
  //    ⇒ 沒動過時把**帶秒的台北牆上時間**送回去,秒才不會被吃掉。
  const [state, formAction, isPending] = useActionState<ProcurementActionState, FormData>(
    async (prev, formData) => {
      // #365:同名欄位送兩份時不採第一筆(讀成 null)。
      // 🔴 **這一欄下游擋不到**(codex 關卡2 抓到,#365 片② 在這裡修掉):本行讀的是
      //    `submitted_at_local`,而解析器入口清單 `PROCUREMENT_SINGLE_FIELDS` 裡的是
      //    **`submitted_at`** ——**兩顆不同的欄位**。它是**呼叫端合成欄位**:員工填的是這一顆,
      //    送進 RPC 的是下面 `formData.set()` 產出的那一顆 ⇒ 入口擋門看不到它。
      //    ⇒ 形狀錯時若沿用舊寫法的 `?? ''`,下游把空字串當成合法的「沒填」,而 A5a 是全量 payload
      //    ⇒ **既有的送出時間被靜默寫成 NULL**,而員工看到的是「更新成功」。
      // 🔴 修法 = 讀不出「恰一筆字串」就**把 `submitted_at` 整顆刪掉**,走解析器既有的
      //    「這一欄沒送 ⇒ ok:false」出口(`procurement-form.ts` 的 `optionalText` 對 `missing`
      //    回 `undefined`、呼叫端回 `invalid`)。不在 client 這層自己發明第二條失敗路徑。
      // 🔴 **`missing` 與 `invalid` 走同一條**(關卡2 code-reviewer must-fix 2:我第一版只擋了
      //    `invalid`,`missing` 照舊收斂成 `''` ⇒ 同一個「靜默寫 NULL」原地存活)。零 UX 代價:
      //    上面那個 `datetime-local` input **無條件渲染**,員工清空欄位送的是 `value: ''`
      //    (不是 `missing`)⇒ 那條**仍然**照舊走「清成 NULL」的合法路徑,收緊不會把它擋死
      //    (測試釘住,突變 M6d 只紅那一格)。
      // ⚠️ **不寫「真瀏覽器永遠送得出 value」那種全稱句**(R2 nit-3):本表單整個包在
      //    `<fieldset disabled={truncated || isPending || refreshing}>` 內,而 disabled 的控制項
      //    不會進 FormData ⇒ 真瀏覽器也構造得出 `missing`。那種情況下 `supplier_id` 等欄
      //    一起消失、解析照樣 `ok:false`,所以**不開洞** —— 但字面要對得上事實。
      const localRead = readSingle(formData, PROC_SUBMITTED_AT_LOCAL_FIELD);
      if (localRead.kind !== 'value') {
        formData.delete(PROC_SUBMITTED_AT_FIELD);
        return upsertItemProcurementAction(prev, formData);
      }
      const local = localRead.value;
      const originalLocal =
        originalSubmittedAt === null ? '' : toTaipeiInputValue(originalSubmittedAt);
      formData.set(
        PROC_SUBMITTED_AT_FIELD,
        local !== '' && originalLocal === local
          ? toTaipeiInputValue(originalSubmittedAt).length === 16
            ? `${originalLocal}:${secondsOf(originalSubmittedAt)}`
            : local
          : local,
      );
      return upsertItemProcurementAction(prev, formData);
    },
    { status: 'idle' },
  );

  // 🔴 `orderItemId === null` 也算「這張表單要顯示」(關卡2 code-reviewer MF6):`denied` 這類本層閘
  //    拿不到品項 id,若嚴格比對就會**每一張表單都不顯示** ⇒ 員工按下去像沒反應,而其實是 session 失效。
  const failedHere =
    state.status === 'failed' &&
    (state.orderItemId === orderItemId || state.orderItemId === null);
  // 🔴 但**取值**只認自己那一份(denied 帶回的是空值,灌進畫面會清掉員工輸入)。
  const carried: ProcurementFormValues | null =
    state.status === 'failed' && state.orderItemId === orderItemId ? state.values : null;

  const [selectedSupplier, setSelectedSupplier] = useState(carried?.supplierId ?? '');
  const [values, setValues] = useState<ProcurementFormValues>(
    carried ?? hydrateFormValues(procurements, ''),
  );
  const [hydrated, setHydrated] = useState(false);
  /** bfcache 還原後、新 props 到達前:表單鎖住(關卡2 codex R2 MF1) */
  const [refreshing, setRefreshing] = useState(false);
  /** hydrate 當下那一列的原始 `submitted_at`(保秒用;見上面的 action wrapper) */
  const [originalSubmittedAt, setOriginalSubmittedAt] = useState<string | null>(
    procurements.find((p) => p.supplierId === (carried?.supplierId ?? ''))?.submittedAt ?? null,
  );
  const router = useRouter();

  // 掛載後才允許送出(見檔頭 Critical)。
  useEffect(() => {
    setHydrated(true);
  }, []);

  // 失敗回來的值真的套進畫面(見檔頭 finding 2);只在**本品項**的失敗時套。
  //
  // 🔴 `else` 那半不是排版:**React 19 的 form action 完成後會 reset 這個 form**,而 reset 之後
  //    只有在「有一次 re-render」時受控值才會被寫回 DOM。實測(施工當場、由測試逼出來):
  //    文字欄還在,但 `<select>` 被清成「請選擇…」⇒ 畫面上出現「欄位有值、供應商卻沒選」的狀態,
  //    員工再按一次就是 `invalid`,而重選供應商會觸發 hydrate、把他剛打的字全部沖掉。
  //    ⇒ 每次 action 有結果就強制重繪一次(新物件 identity),讓 React 把受控值寫回去。
  useEffect(() => {
    // 🔴 **套值**仍嚴格比對(與上面的顯示條件刻意不同):`denied` 帶回的是空值,
    //    灌進畫面會把員工打的東西清掉 —— 訊息要看得到,值不能被別人的覆蓋。
    if (state.status === 'failed' && state.orderItemId === orderItemId) {
      setValues(state.values);
      setSelectedSupplier(state.values.supplierId);
    } else {
      setValues((prev) => ({ ...prev }));
    }
  }, [state, orderItemId]);

  // bfcache 還原 → 重取 server component(見檔頭 finding 3)。
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // 🔴 只 refresh 不夠(關卡2 codex MF1):server component 重繪會帶來新的 `procurements`,
      //    但本元件的 state 不會跟著重建 ⇒ 員工手上仍是還原前的舊快照,照送就是用舊值覆蓋新資料。
      //    ⇒ 連同選擇與欄位一起清掉,逼他重新選一次(= 重新 hydrate 自新 props)。
      //    代價 = 還原前打到一半的內容會不見;這比「靜默覆蓋掉別人剛改的採購事實」好。
      // 🔴 `router.refresh()` 是非同步的:只清狀態不鎖表單的話,**refresh 還在飛的時候**
      //    員工可以拿仍是舊的 `procurements` 重新選一次再送 ⇒ 又用舊值覆蓋新資料(R2 MF1)。
      //    ⇒ 鎖住,直到新的 props 進來(下面那個 effect 解鎖)。
      setRefreshing(true);
      router.refresh();
      setSelectedSupplier('');
      setValues(hydrateFormValues([], ''));
      setOriginalSubmittedAt(null);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);

  // 新的 `procurements` 到達(= server component 重繪完成)⇒ 解鎖。
  useEffect(() => {
    setRefreshing(false);
  }, [procurements]);

  function onSupplierChange(nextId: string) {
    setSelectedSupplier(nextId);
    // 切換目標 = 換一筆紀錄 ⇒ 整份重填(含清掉上一筆的值)。
    setValues(hydrateFormValues(procurements, nextId));
    setOriginalSubmittedAt(procurements.find((p) => p.supplierId === nextId)?.submittedAt ?? null);
  }

  function setField(field: keyof ProcurementFormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  const editing = procurements.some((p) => p.supplierId === selectedSupplier);
  const chosen = supplierChoices.find((c) => c.id === selectedSupplier);

  return (
    <form action={formAction} className='mt-3 border-t pt-3'>
      <input type='hidden' name={PROC_ORDER_ID_FIELD} value={orderId} />
      <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
      <input type='hidden' name={PROC_ORDER_ITEM_ID_FIELD} value={orderItemId} />
      <input type='hidden' name={PROC_STALE_FIELD} value={truncated ? '1' : '0'} />
      <input type='hidden' name={PROC_HYDRATED_FIELD} value={hydrated ? '1' : '0'} />

      {failedHere && (
        <div
          role='alert'
          className='border-destructive/30 bg-destructive/5 text-destructive mb-3 rounded-md border p-2.5 text-xs'
        >
          {state.message}
        </div>
      )}

      {/* 🔴 三個鎖:截斷 / 送出中 / bfcache 重取中。
          **送出中也要鎖欄位**(R2 MF5):送出後才改的內容不在那份 FormData 裡,
          成功跳頁或失敗套回 state 都會讓它靜默消失。 */}
      <fieldset disabled={truncated || isPending || refreshing} className='contents'>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          <AdminFormField label='供應商'>
            <select
              name={PROC_SUPPLIER_ID_FIELD}
              className={ADMIN_INPUT_CLASS}
              value={selectedSupplier}
              onChange={(e) => onSupplierChange(e.target.value)}
              required
            >
              <option value=''>請選擇…</option>
              {supplierChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.inactive ? `${choice.label}(已停用)` : choice.label}
                </option>
              ))}
            </select>
          </AdminFormField>

          <AdminFormField label='訂購數量'>
            <input
              type='number'
              name={PROC_ALLOCATED_FIELD}
              className={ADMIN_INPUT_CLASS}
              min={1}
              max={100000}
              step={1}
              value={values.allocatedQuantity}
              onChange={(e) => setField('allocatedQuantity', e.target.value)}
              required
            />
          </AdminFormField>

          <AdminFormField label='預計到貨日'>
            <input
              type='date'
              name={PROC_EXPECTED_ARRIVAL_FIELD}
              className={ADMIN_INPUT_CLASS}
              value={values.expectedArrivalDate}
              onChange={(e) => setField('expectedArrivalDate', e.target.value)}
            />
          </AdminFormField>

          <AdminFormField label='聯絡管道'>
            <input
              type='text'
              name={PROC_CONTACT_CHANNEL_FIELD}
              className={ADMIN_INPUT_CLASS}
              maxLength={200}
              value={values.contactChannel}
              onChange={(e) => setField('contactChannel', e.target.value)}
            />
          </AdminFormField>

          <AdminFormField label='供應商單號'>
            <input
              type='text'
              name={PROC_SUPPLIER_ORDER_NO_FIELD}
              className={ADMIN_INPUT_CLASS}
              maxLength={200}
              value={values.supplierOrderNo}
              onChange={(e) => setField('supplierOrderNo', e.target.value)}
            />
          </AdminFormField>

          <AdminFormField label='送出採購的時間'>
            <input
              type='datetime-local'
              name={PROC_SUBMITTED_AT_LOCAL_FIELD}
              className={ADMIN_INPUT_CLASS}
              value={values.submittedAtLocal}
              onChange={(e) => setField('submittedAtLocal', e.target.value)}
            />
          </AdminFormField>
        </div>

        <div className='mt-3'>
          <span className='text-muted-foreground text-xs font-medium'>回覆狀態</span>
          <div className={`${RADIO_ROW} mt-1.5`}>
            {PROCUREMENT_REPLY_STATUSES.map((code) => (
              <label key={code} className='flex items-center gap-1.5 text-sm'>
                <input
                  type='radio'
                  name={PROC_REPLY_STATUS_FIELD}
                  value={code}
                  checked={values.replyStatus === code}
                  onChange={() => setField('replyStatus', code)}
                  required
                />
                {REPLY_STATUS_LABEL[code]}
              </label>
            ))}
          </div>
        </div>

        <div className='mt-3'>
          <AdminFormField label='異常原因(內部;告知客人另走備註)'>
            <textarea
              name={PROC_EXCEPTION_REASON_FIELD}
              className='border-input bg-background min-h-16 rounded-md border p-2 text-sm'
              maxLength={500}
              value={values.exceptionReason}
              onChange={(e) => setField('exceptionReason', e.target.value)}
            />
          </AdminFormField>
        </div>
      </fieldset>

      <div className='mt-3 flex items-center justify-end gap-2'>
        {chosen?.inactive && (
          <span className='mr-auto text-xs text-amber-700'>
            這家供應商已停用:可以更新紀錄欄,但不能新建採購、也不能調高訂購數量。
          </span>
        )}
        {!truncated &&
          (hydrated && !refreshing ? (
            <button
              type='submit'
              disabled={isPending}
              className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
            >
              {isPending ? '儲存中…' : editing ? '更新這筆採購' : '新增採購'}
            </button>
          ) : (
            // 掛載前不給送(見檔頭 Critical);顯示成停用的鈕而不是整個消失,
            // 否則員工會以為「這張單不能改採購」。
            <button
              type='button'
              disabled
              className='bg-muted text-muted-foreground h-9 rounded-md px-4 text-sm font-medium'
            >
              {refreshing ? '重新載入中…' : '載入中…'}
            </button>
          ))}
      </div>
    </form>
  );
}
