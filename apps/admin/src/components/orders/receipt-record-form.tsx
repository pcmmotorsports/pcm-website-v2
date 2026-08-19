'use client';

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { recordItemReceiptAction } from '../../lib/orders/receipt-actions';
import {
  RCPT_INLINE_FIELD,
  RCPT_NOTE_FIELD,
  RCPT_ORDER_ID_FIELD,
  RCPT_ORDER_ITEM_ID_FIELD,
  RCPT_PROCUREMENT_ID_FIELD,
  RCPT_QUANTITY_FIELD,
  RCPT_RECEIVED_AT_LOCAL_FIELD,
  RCPT_REQUEST_ID_FIELD,
  RCPT_SURPLUS_FIELD,
  RECEIPT_FIELD_OF_CODE,
  type ReceiptActionState,
  type ReceiptFormValues,
} from '../../lib/orders/receipt-action-state';
import { toTaipeiInputValue } from '../../lib/orders/procurement-view';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';
import {
  AdminFormErrorProvider,
  useAdminFieldErrorProps,
} from '../shared/admin-form-errors';
import { ReceiptUndoBar } from './receipt-undo-bar';

/**
 * 一欄輸入框 = 標籤 + 控制項 + **掛在控制項自己身上的錯誤 aria**。
 *
 * 🔴🔴 **為什麼這是一個獨立元件,而不是在 `ReceiptRecordForm` 裡直接算好 props**
 *    —— 這一格是 hook 規則決定的,不是風格:
 *    `AdminFormErrorProvider` 是 `ReceiptRecordForm` **自己渲染的**
 *    ⇒ 在 `ReceiptRecordForm` 的 body 裡呼叫 `useAdminFieldErrorProps` 讀到的是
 *      **provider 上方**的 context(也就是 `null`)⇒ 永遠沒有錯誤。
 *    ⇒ 必須有一層在 provider **底下**的元件來讀。順帶把四段幾乎逐字相同的 JSX 收成一個。
 *
 * 🔴 `aria-invalid` / `aria-describedby` **掛在 `<input>` 上,不是外面包一層**
 *    (2026-08-19 codex K2 finding 2:掛在 div 上報讀器讀不到,等於一個假的無障礙宣稱)。
 */
function ReceiptInput({
  label,
  name,
  ...inputProps
}: { label: string; name: string } & ComponentProps<'input'>) {
  const errorProps = useAdminFieldErrorProps(name);
  return (
    <AdminFormField label={label} name={name}>
      <input className={ADMIN_INPUT_CLASS} name={name} {...errorProps} {...inputProps} />
    </AdminFormField>
  );
}

// M-4b E10 #352-b:單筆採購的「登錄到貨」小視窗。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 🔴 **操作直覺化**(Sean 2026-08-11 常設指令:「系統成不成功、好不好用就看這一塊」):
//    欄位順序照員工心智模型 —— 先「到貨幾件」(預設就是還沒到的那些)、再「什麼時候到的」,
//    溢收與備註是少數情況才碰的東西 ⇒ 收在後面、且用一句話講清楚它是幹嘛的。
//
// 🔴 **`request_id` 是冪等鍵,掛載時產生一次、之後不再變**(plan §5.1 逐字):
//    每次 render 重產會讓「重送」變成新請求、冪等失效 —— 員工手滑按兩次就記兩筆到貨。
//    形狀必須通過 RPC `20260811010000:101-103`(可列印 ASCII、無空白、**全小寫**、≤200):
//    形狀由 `mintRequestId()` 保證(全小寫十六進位加連字號)。
//
// 🔴 **未 hydrate 時送不出去,而且這是刻意的**:`request_id` 由本元件在 client 產生
//    ⇒ SSR 的 HTML 裡那個 hidden 是空的、action 解析會回 `invalid`。
//    ⇒ 送出鈕在 `requestId === ''` 時停用,讓員工看到的是「還在載入」而不是一顆按了會失敗的鈕。

/**
 * 冪等鍵。🔴 **非 secure context(真機 LAN http)沒有 `crypto.randomUUID`** ——
 * 直接呼叫會 throw 在 `useEffect` 裡,`requestId` 永遠停在空字串 ⇒ 送出鈕永遠是「載入中…」,
 * 而且畫面上看不出任何錯誤。逐字沿用備註線 `note-compose-form.tsx:69-78` 的處置
 * (該處 R1 N4 的原話:token 是冪等鍵、非安全值 ⇒ `Math.random` 版可接受)。
 * 產出恆為小寫十六進位 + 連字號 ⇒ 滿足 RPC `20260811010000:101-103` 的形狀限制。
 */
function mintRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function ReceiptRecordForm({
  orderId,
  orderItemId,
  procurementId,
  returnTo,
  /** 這筆採購還沒到的件數(= `allocated − received`)—— 預設值,不是上限守門(守門在 RPC)。 */
  remaining,
  /**
   * 彈窗模式(#352-b-2 E1):成功時 action **回 state 不 redirect**,由 `onRecorded` 接手就地更新。
   * 不給 = 列表模式(採購區塊),成功照舊 redirect。
   */
  inline = false,
  onRecorded,
}: {
  orderId: string;
  orderItemId: string;
  procurementId: string;
  returnTo: string;
  remaining: number;
  inline?: boolean;
  onRecorded?: () => void;
}) {
  const [state, formAction] = useActionState<ReceiptActionState, FormData>(
    recordItemReceiptAction,
    { status: 'idle' },
  );
  const [requestId, setRequestId] = useState('');
  /**
   * 上一次**成功登錄**用掉的冪等鍵;`null` = 這個表單還沒成功過。
   *
   * 🔴 撤銷入口靠它換 receipt id(逐筆到貨沒被投影,見 `receipt-undo-bar.tsx` 檔頭)。
   *    只在彈窗模式會有值 —— 列表模式成功走 redirect、表單整個重新掛載。
   */
  const [undoKey, setUndoKey] = useState<string | null>(null);
  // 🔴 **四個欄位全部受控**(R1 Important 6)。原本 quantity / surplus / note 走 `defaultValue`,
  //    而 `defaultValue` 只在**掛載那一次**寫進 DOM —— 失敗回來時 `state.values` 根本不會被
  //    任何一次 render 消費 ⇒ 「保留員工輸入」是空頭支票(姊妹片 `item-procurement-form.tsx:57-59`
  //    的關卡2 finding 2 逐字記著同一件事,修法就是受控 + effect 明確套用)。
  const [values, setValues] = useState<ReceiptFormValues>({
    quantity: String(remaining),
    surplusQuantity: '0',
    receivedAtLocal: '',
    note: '',
  });
  const panelId = useId();

  // 🔴 只在掛載時產生一次;`state` 變動(失敗回來)**不重產** —— 重產會讓員工「再按一次」
  //    變成一筆全新的登錄,而他以為自己是在重試同一筆。
  useEffect(() => {
    setRequestId(mintRequestId());
    // 🔴 **用現成的 `toTaipeiInputValue`,不要自己算偏移**(R1 must-fix 1):
    //    我原本寫 `now.getTime() + (8*60 + getTimezoneOffset()) * 60_000` —— 在**台北機器上**
    //    `getTimezoneOffset()` 是 -480,兩者相加恰好是 0 ⇒ 產出的是 UTC 牆鐘、**少 8 小時**。
    //    而且它**沒有症狀**:早 8 小時仍在範圍內、也不是未來 ⇒ 三道守門全部放行,
    //    員工不改就送 = 靜默把到貨時間寫錯。TZ=Asia/Taipei 實跑複現:10:22 → 02:22。
    setValues((v) => ({ ...v, receivedAtLocal: toTaipeiInputValue(new Date().toISOString()) }));
  }, []);

  // 🔴 **`null` 也算本表單的失敗**(R2 nit,與 must-fix ① 同根)。
  //    `denied` 拿不到 procurementId —— 授權閘刻意排在**讀任何欄位之前**(不對未授權者洩漏表單規則),
  //    所以它只能帶 null。若這裡堅持 `=== procurementId`,session 過期的員工按下去會**完全沒有反應**。
  //    這樣放寬是安全的:`useActionState` 的 state **是每個表單實例各自的**,
  //    別份表單的失敗根本進不到這個 state ⇒ 不會出現「一份失敗、全頁都跳紅字」。
  //    (具名 procurementId 的比對仍然留著 —— 它擋的是帶了**別筆**採購 id 的回傳,那才是真的錯位。)
  const failed =
    state.status === 'failed' &&
    (state.procurementId === procurementId || state.procurementId === null);

  /**
   * 🔴 片4:規格 §4-3「**頂部 banner 總結 + 每欄 inline error**;只做一種使用者找不到錯在哪」。
   *
   * · **上層 banner 一個字沒動** —— 它照舊顯示 `state.message`(那是總結,本片不碰)。
   * · **下層**由 `RECEIPT_FIELD_OF_CODE` 決定:**只有【可改輸入型】的碼會指到欄位**;
   *   `denied` / `bug` / `PROCUREMENT_VOIDED` / `DUPLICATE_*` 等**刻意不指**
   *   —— 員工改哪一格都沒用,硬指等於叫他去改一個改不好的地方(理由全文在那張表旁邊)。
   * 🔴 **兩層共用同一句話,不另寫一份文案** —— 兩份會各自漂,而畫面上兩句都合理。
   * 🔴 **一個碼可能指到兩欄**(`INVALID_QUANTITY` 同時管到貨與溢收,RPC 就是這樣判的)
   *    ⇒ 這裡走清單、不是單一欄位。
   */
  const fieldErrors = (() => {
    if (!failed) return null;
    const names = RECEIPT_FIELD_OF_CODE[state.code];
    if (names.length === 0) return null;
    return Object.fromEntries(names.map((n) => [n, state.message]));
  })();

  // 🔴 彈窗模式成功:①通知呼叫端就地重取 ②**換一把新的冪等鍵**。
  //
  //    ⚠️ **兩把鍵語意相反,別混為一談**(主視窗 E1 要求①的釐清):
  //    · 出貨的 `idempotencyKey`(彈窗持有)**不換** —— 彈窗沒關、還是同一箱。我這一層完全沒碰它。
  //    · 到貨的 `request_id`(本表單持有)**必須換** —— 它已經被消費掉了(冪等帳記著)。
  //      不換的話,員工要登錄**第二批**真的到貨時會永遠拿到 `DUPLICATE_REQUEST`、
  //      而畫面會說「先前已經登錄過」⇒ 那批貨再也記不進去。
  //      (列表模式不用管這件事:它 redirect 後整個表單重新掛載,自然就是新鍵。)
  //    🔴 這不會削弱防連點:連點發生在**送出中**,由 pending 狀態擋;換鍵只在**成功之後**。
  //
  // 🔴🔴 **`onRecorded` 走 ref、不進 deps**(R1 Critical C1,實測 321 次重取 / 400ms):
  //    呼叫端每次 render 都會給一個**新的箭頭函式**(彈窗 → launcher 的 `setOpen({...o, data})`
  //    每次也是新物件)⇒ 把它放進 deps 會變成:
  //    成功 → 重取 → setState → re-render → `onRecorded` 換身分 → effect 又跑(`state` 還是
  //    `recorded_inline`)→ 再重取 …… **無窮迴圈**。寫入不會重複(action 只跑一次),
  //    但彈窗失控 + 請求風暴,而且是 Sean 肉眼驗第一下就會撞到的路。
  //    ⇒ deps 只留**真的代表「發生了一件新事」的東西**(`state` / `procurementId`);
  //    回呼本身用 ref 取最新的,身分變動不該重新觸發任何事。
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  });

  // 🔴🔴 **「這件事處理過了沒」用 state 物件本身當身分,不要用資料值**(R2 N1)。
  //    上一版 deps 是 `[state, procurementId, remaining]`,而 M2 成功後會重抓採購列、
  //    把 `received` 推上去 ⇒ `remaining` 跟著變 ⇒ **同一次成功** effect 被觸發第二次,
  //    把四個欄位再重置一遍 —— 員工正在打第二批的數字會被當場清空。
  //    (那不是迴圈、會收斂,所以更難發現;而我 C1b 那格的 mock 兩次回同一份 `received`
  //     ⇒ `remaining` 恆等、第二發永遠不發生 ⇒ **那個「恰 1 次」的斷言在真資料下是假的**。)
  //    ⇒ 判準改成「**這個 `state` 物件我處理過沒有**」:一次成功只有一個 state 物件,
  //    資料值怎麼變都不會讓它變成「新事」。
  const handledRef = useRef<ReceiptActionState | null>(null);

  // 🔴 `remaining` 也走 ref(終輪 nit):它**不在 deps 裡**(在的話就是 N1),
  //    所以 effect body 讀到的會是「`state` 變成 recorded_inline 那一刻」的舊值。
  //    而 M2 緊接著把 `received` 推上去 ⇒ 舊值**偏大** ⇒ 第二批的預設件數填太多、
  //    員工按下去會吃一個 `QUANTITY_EXCEEDS_ALLOCATED`。RPC 會擋住、不會寫壞資料,
  //    但那是**我們預先幫他填錯再讓他撞**,與 M2 修的是同一種帳。
  const remainingRef = useRef(remaining);
  useEffect(() => {
    remainingRef.current = remaining;
  });

  useEffect(() => {
    if (state.status !== 'recorded_inline' || state.procurementId !== procurementId) return;
    if (handledRef.current === state) return;
    handledRef.current = state;
    // 🔴 **把剛剛用掉的那把鍵留下來** —— 撤銷入口唯一拿得到 receipt id 的路就是它
    //    (逐筆到貨沒有被投影,見 `receipt-undo-bar.tsx` 檔頭)。
    // ⚠️ **這裡的正確性不靠兩行的先後順序**(我上一版註解宣稱「順序寫反就會拿到新鍵」——
    //    那句是假的,實測換順序四格照樣綠):`requestId` 是**這次 render 的 closure 值**,
    //    `setRequestId` 只排程下一次 render,不會就地改掉它 ⇒ 兩行怎麼排都捕捉到消費掉的那把。
    //    真正承重的是「**捕捉 closure 值、不要改讀 ref**」 —— 若日後有人為了少一個 deps 警告
    //    把它換成 `requestIdRef.current`,那顆 ref 可能已被下一次 render 更新成新鍵。
    setUndoKey(requestId);
    setRequestId(mintRequestId());
    setValues({
      quantity: String(remainingRef.current),
      surplusQuantity: '0',
      receivedAtLocal: toTaipeiInputValue(new Date().toISOString()),
      note: '',
    });
    onRecordedRef.current?.();
    // 🔴 deps 刻意**不含** `onRecorded`(身分每 render 都變 ⇒ 會變成迴圈)、
    //    也**不含** `remaining`(它會被本次成功自己推動 ⇒ 會變成第二次觸發,見上)。
    //    真正代表「發生了一件新事」的只有 `state` 這個物件。
  }, [state, procurementId]);

  // 🔴 失敗回來時把員工打的四欄**寫回 state**,不是在 `value=` 上三元切換 ——
  //    三元的話輸入框會被 `state.values` 釘死、`onChange` 改不動它(受控值來自一個不會因打字
  //    而變的來源)⇒ 員工修不了輸入、只能重整。以 `state` 為相依:同一次失敗只同步一次,之後打字照常。
  useEffect(() => {
    if (state.status === 'failed' && state.procurementId === procurementId) {
      setValues(state.values);
    }
  }, [state, procurementId]);

  const set = (patch: Partial<ReceiptFormValues>) => setValues((v) => ({ ...v, ...patch }));

  return (
    <details className='mt-2'>
      <summary aria-controls={panelId} className='cursor-pointer text-sm font-medium select-none'>
        登錄到貨
      </summary>
      <form action={formAction} className='mt-2 space-y-3 rounded-md border p-3' id={panelId}>
        {/* 🔴 片4:provider 只包住這一張表單 ⇒ 別份表單的失敗進不到這裡
            (同 `useActionState` 的 state 本來就是每個表單實例各自的,見上面 `failed` 那段)。 */}
        <AdminFormErrorProvider errors={fieldErrors}>
        <input type='hidden' name={RCPT_ORDER_ID_FIELD} value={orderId} />
        <input type='hidden' name={RCPT_ORDER_ITEM_ID_FIELD} value={orderItemId} />
        <input type='hidden' name={RCPT_PROCUREMENT_ID_FIELD} value={procurementId} />
        <input type='hidden' name={RCPT_REQUEST_ID_FIELD} value={requestId} />
        <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
        {inline && <input type='hidden' name={RCPT_INLINE_FIELD} value='1' />}

        {failed && (
          <p
            role='alert'
            className='border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-2.5 text-xs whitespace-pre-line'
          >
            {state.message}
          </p>
        )}

        <ReceiptInput
          label='到貨幾件'
          name={RCPT_QUANTITY_FIELD}
          type='number'
          /* 🔴 `min=0` 不是筆誤:`到貨 0 件 / 溢收 N 件` 是「這張單已收滿或已取消、但貨還是到了」
                的正式登記方式(a1 `20260810230000:82`)。設成 min=1 會讓那條路在畫面上直接死掉。 */
          min={0}
          step={1}
          value={values.quantity}
          onChange={(e) => set({ quantity: e.target.value })}
        />

        <ReceiptInput
          label='什麼時候到的'
          name={RCPT_RECEIVED_AT_LOCAL_FIELD}
          type='datetime-local'
          value={values.receivedAtLocal}
          onChange={(e) => set({ receivedAtLocal: e.target.value })}
        />

        <ReceiptInput
          label='溢收幾件(供應商多送的,不掛回這張單)'
          name={RCPT_SURPLUS_FIELD}
          type='number'
          min={0}
          step={1}
          value={values.surplusQuantity}
          onChange={(e) => set({ surplusQuantity: e.target.value })}
        />

        <ReceiptInput
          label='備註(選填)'
          name={RCPT_NOTE_FIELD}
          type='text'
          maxLength={500}
          value={values.note}
          onChange={(e) => set({ note: e.target.value })}
        />

        <button
          type='submit'
          disabled={requestId === ''}
          className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50'
        >
          {requestId === '' ? '載入中…' : '登錄到貨'}
        </button>
        </AdminFormErrorProvider>
      </form>

      {/* 🔴 **在登錄表單之外**:HTML 不准巢狀 `<form>`,塞進去的話撤銷那顆會變成登錄表單的
          submit(按下去等於再登錄一筆)。⇒ 放 `</form>` 之後、`</details>` 之內。 */}
      {/* 🔴🔴 `key={undoKey}` 是**承重的**(R1 must-fix 1):撤銷列自己有 `useActionState`,
          不換 key 的話那顆終態會**跨批殘留** —— 登錄第 1 批 → 撤銷成功 → 登錄第 2 批,
          畫面仍寫「已撤銷剛剛那筆」而第 2 批其實已寫入且沒被撤銷,連撤銷鈕都不會回來。
          「員工要登錄第二批」是本檔 `:126-131` 自己寫過的設計內路徑,不是邊角。 */}
      {undoKey !== null && (
        <ReceiptUndoBar
          key={undoKey}
          consumedKey={undoKey}
          orderId={orderId}
          orderItemId={orderItemId}
          returnTo={returnTo}
        />
      )}
    </details>
  );
}
