import { cancelOrderAction } from '../../lib/orders/cancel-actions';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_MODE_FIELD,
  CANCEL_ORDER_ID_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REASON_DETAIL_FIELD,
  CANCEL_REQUEST_TOKEN_FIELD,
  generateCancelRequestToken,
} from '../../lib/orders/cancel-action-state';
import { CANCEL_REASON_CODES, CANCEL_REASON_LABEL } from '../../lib/orders/cancel-form';
import { isItemSelectable, type CancelItemView } from '../../lib/orders/cancel-view';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// cancel-order-forms.tsx — M-4b E10 **A13b D4**:取消訂單的**兩支獨立表單**(整單 / 部分)。
//
// 🔴🔴 **兩支 form 是安全機制,不是排版選擇**(plan §2-3;`E-022-A` Q1=A 已裁)。
//    舊形狀是單一 form + `full`/`partial` radio,而 React 19 的 form reset 競態
//    (加上返回鍵的表單狀態復原)會把 radio 勾回 `full` ⇒ **員工以為在送部分取消,實際送出整單取消**
//    (四輪修不穩,`E-011-STOP`)。v3 改成「**形狀上不存在那條路**」:
//    - 部分那支**沒有任何控制項的值可以變成 `full`** —— 零 radio,`cancel_mode` 只有 hidden。
//      hidden input **不屬於瀏覽器表單狀態復原的範圍**(D6 真瀏覽器負測要釘死這句)。
//    - 整單那支**根本沒有品項欄** —— 「切回 full 時怎麼排除殘留 `cancel_item`」那題因此消失。
//    - 送出鈕文字各自寫死 ⇒ **員工按的那顆決定送什麼**,不存在「以為在 A 卻送出 B」。
//    🔴 這兩支**不得合併回單一 form**。要合併的人先讀 `E-011-STOP` 與 plan §2-3。
//
// 🔴 **零 client state、零 `'use client'`**(刻意):全部用原生 form + server action。
//    沒有 `useActionState` / `useState` ⇒ 沒有「client 記著一份、server 記著另一份」的分岔面。
//    ⚠️ 這也是為什麼失敗後**輸入不保留**(`E-014-A` Q2=A):畫面狀態一律由 server 從帳本重建。
//
// 🔴 **server 端第二道仍在**:`cancel-form.ts:203`(`parseOrderCancelForm` 的 full 分支)的「`full` 卻帶品項 ⇒ `{ok:false}`」
//    保留為第二道。本檔的形狀是第一道,不是唯一一道。
//
// 🔴🔴 **本檔的形狀防的是「意外」,不是「故意」**(R2 codex must-fix,誠實邊界、已升 `E-047-Q`)。
//    codex 構造:用 DevTools 把部分表單的 hidden `cancel_mode` 改成 `full`、且不勾任何品項
//    ⇒ 解析器會把它當**合法的整單取消**收下並送 RPC —— `:31` 那道只擋「full 卻帶品項」,
//    擋不到「full 且沒帶品項」,因為那本來就是整單取消的正常形狀。
//    ⇒ **成立,而且本檔擋不住**:`cancel_mode` 是 client 送的欄位,server 沒有第二個來源可以對。
//    ⚠️ **但它與本片要防的不是同一件事**:本片防的是 `E-011-STOP` 那種**員工沒有察覺**的誤送
//    (form reset 競態 / 返回鍵把 radio 勾回去);改 DevTools 是**明確的故意行為**,
//    對象是已登入的後台員工,而且 RPC 端有授權閘 + `admin_audit_log` 同交易留痕。
//    🔴 **真要關掉這一面**:拆成兩支 server action(full / partial),模式由 **server 綁定**、
//    不讀 client 送的 `cancel_mode`。那是 plan §2-3 的形狀變更(動 action 簽章 + 解析器 + 既有測試)
//    ⇒ **不在 D4 片界內,已落 `E-047-Q` 請 Sean 裁**。
//
// 🔴 **已知未解:勾了零個品項仍按得下送出**(R2 codex must-fix;與「一顆都勾不動」不同格)。
//    有品項可勾、但員工一個都沒勾就送出 ⇒ 「至少一筆」擋下 ⇒ `invalid` ⇒ 導頁,
//    且 `E-014-A` Q2=A 之下**原因欄不保留**、要整份重填。
//    ⚠️ 原生 HTML **沒有**「checkbox 群組至少勾一個」的宣告式驗證(`required` 只作用在單顆)
//    ⇒ 零 client state 之下做不出可操作的前置守門 ⇒ **認列、不是已修**,同落 `E-047-Q`。
//    與「選了『其他』卻沒填說明」同族(原生 `required` 做不到條件必填)。
//
// 🔴🔴 **已知未解:返回鍵(`goBack()`)帶回來的是「上一次那顆」token**(R1 must-fix 4,誠實邊界)。
//    plan `2026-08-09-e10-a13b-prg-rework-plan.md:123-124` 的探針結論逐字:
//    「radio 復原 ✅ / 文字欄復原 ✅ / **hidden input 維持 markup 值** ✅」
//    ⇒ 送出失敗 → 按返回 → 改原因或改勾選 → 再送,用的是**同一顆 token 配不同 payload**
//    ⇒ 撞 `payload_hash`(`20260805100000:195-198`)⇒ 回 `rejected`,而那句話是
//    「這張單目前不能取消」—— 員工「再改改看」永遠過不了。這正是
//    `cancel-action-state.ts:14-20` 說要避開的那條路。
//    ⚠️ **備註線把同一件事列成債④、用 client 端 `pageshow` 換鍵解決**
//    (`note-compose-form.tsx:32-36`);取消線**刻意零 client state**(那是誤送整單取消的修法本體),
//    所以這裡不能照抄那個解法 ⇒ **現階段是認列、不是已修**。
//    ⇒ 接手點:**D6 的真瀏覽器負測要把這條量出來**(返回 → 改值 → 送出 → 觀察 POST body 的 token
//      與伺服器回應),再決定要不要為它破例引進最小的 client 行為。

/** 版面用字(結構鎖、字不鎖 —— 中文字面待 Sean 肉眼定稿,同 `cancel-review-section.tsx:26`)。 */
const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-medium';
const SUBMIT_CLASS =
  'bg-destructive text-destructive-foreground h-9 rounded-md px-5 text-sm font-medium';

/**
 * 原因下拉 + 說明欄(兩支表單共用一份)。
 *
 * 🔴 **`<option value=''>請選擇</option>` 是必要的,不是裝飾**(plan §2-3 逐字):
 *    沒有空的 placeholder 時瀏覽器會**自動選第一個選項** ⇒ 員工「重選原因」這件事根本沒發生,
 *    而表單照樣送得出去、帶著他沒看過的原因。配 `required` 才擋得住。
 *
 * ⚠️ **已知 UX 缺口(零 client state 的代價,誠實記載)**:`other` 才准填說明、
 *    其餘填了就是 `{ok:false}`(`cancel-form.ts:185-192` 的型別分流,**刻意不靜默丟掉**——
 *    丟掉會讓員工以為說明存進去了)。沒有 client JS ⇒ 說明欄**藏不起來**,
 *    只能靠 label 講清楚。員工若「先填說明、再改選非 other」會整份被退回且
 *    **輸入不保留**(`E-014-A` Q2=A)⇒ 得整份重填。
 *    要修得加 client state 或 D5 之後改走漸進增強,不在本片(plan 明寫零 client state)。
 */
function CancelReasonFields() {
  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      <AdminFormField label='取消原因'>
        <select
          name={CANCEL_REASON_CODE_FIELD}
          required
          defaultValue=''
          className={ADMIN_INPUT_CLASS}
        >
          <option value='' disabled>
            請選擇
          </option>
          {CANCEL_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {CANCEL_REASON_LABEL[code]}
            </option>
          ))}
        </select>
      </AdminFormField>
      <AdminFormField label='說明(只有選「其他」時才填)'>
        <textarea
          name={CANCEL_REASON_DETAIL_FIELD}
          rows={2}
          className='border-input bg-background rounded-md border px-3 py-2 text-sm'
          placeholder='選「其他」時必填;選其他原因時請留空,填了會被退回。'
        />
      </AdminFormField>
    </div>
  );
}

/**
 * 兩支表單共用的外殼:server action + 三顆 hidden + 原因欄 + 送出鈕。
 *
 * 🔴🔴 **token 在這裡鑄 —— 每一次 server render 一顆新的**(plan D4 驗收⑥,
 *    D2b 刪掉舊 state 族時**搶救出來的義務**,`cancel-action-state.ts:73-79`)。
 *    規則本身寫在 `generateCancelRequestToken` 的 docstring(產生點與快取層),這裡不重抄。
 *    ⚠️ **本檔要守的那一半**:token 的產生點**不得**落進 `unstable_cache` / `React.cache`。
 *
 * 🔴🔴 **守門的真實涵蓋範圍(R1 must-fix 1 更正,原本的宣稱大於事實)**:
 *    「兩次獨立 render 拿到兩顆不同 uuid」那條測試 **只擋得住「整支被凍成同一顆」**,
 *    **擋不住 `React.cache`** —— 實跑證明過:把這行包成 `cache(generateCancelRequestToken)()`,
 *    **17 條測試全綠**。原因是 react 的 client build 裡 `cache` 是**純透傳**
 *    (`react@19.2.6/cjs/react.development.js:917-921`),而 jsdom 測試走的就是那支
 *    ⇒ **行為層在測試環境裡分辨不出來,不是我沒寫斷言**。
 *    ⇒ 剩下那半由**原始碼層守門**接手(測試檔裡「本檔不得 import 任何快取層」那條),
 *      並在下面同時斷言「同一頁兩支表單拿到兩顆不同 token」——
 *      那是 `React.cache`(per-request memo)在真 server 上的**實際症狀**。
 *    ⚠️ 語意精確化(R1 nit):`React.cache` 是 **per-request** memo,不是跨請求凍結;
 *      它的症狀是「同一次請求裡兩支表單共用一顆 token」,`unstable_cache` 才是「兩個人拿到同一把」。
 *    ⚠️ 兩者都守不住**呼叫端**把整棵樹包進快取層 —— 那是 D6 接線時要看的
 *      (頁層 `app/orders/[id]/page.tsx:24` 目前是 `force-dynamic`,已實查)。
 */
function CancelFormShell({
  orderId,
  mode,
  submitLabel,
  children,
}: {
  orderId: string;
  mode: 'full' | 'partial';
  submitLabel: string;
  children?: React.ReactNode;
}) {
  const requestToken = generateCancelRequestToken();
  return (
    <form action={cancelOrderAction} className='space-y-3'>
      <input type='hidden' name={CANCEL_ORDER_ID_FIELD} value={orderId} />
      <input type='hidden' name={CANCEL_REQUEST_TOKEN_FIELD} value={requestToken} />
      {/* 🔴 `cancel_mode` **只有這一顆、且是 hidden**:表單裡沒有任何可編輯控制項叫這個名字。 */}
      <input type='hidden' name={CANCEL_MODE_FIELD} value={mode} />
      {children}
      <CancelReasonFields />
      <div className='flex justify-end'>
        <button type='submit' className={SUBMIT_CLASS}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * 整單取消 —— **不含任何品項欄**。
 *
 * 送出去會把每個品項的**剩餘全部**取消掉(RPC `20260805100000:417-424` 的 `quantity − Σci`)。
 * 🔴 能不能給這支,由 `buildOrderCancelView().fullCancelAllowed` 決定(有到貨就只能逐品項取消),
 *    **本檔不重算那條判定**(同 `cancel-review-section.tsx:22-24` 的紀律:重算一份就會有兩份漂移的規格)。
 */
export function FullCancelForm({ orderId }: { orderId: string }) {
  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>整單取消</h2>
      {/* ⚠️ 畫面文字裡不要寫 markdown 星號 —— JSX 會**逐字印出來**,員工看到的是「**還沒…**」。 */}
      <p className='text-muted-foreground mb-3 text-sm'>
        會把這張單<strong>還沒取消的數量全部</strong>取消掉。取消是永久紀錄,送出後不能刪。
      </p>
      <CancelFormShell orderId={orderId} mode='full' submitLabel='整單取消' />
    </section>
  );
}

/**
 * 部分取消 —— 勾選要取消的品項。
 *
 * 🔴 **一顆 checkbox = 取消該品項「還能取消」的全部數量**(值 = `<order_item_id>:<數量>`,
 *    形狀逐字對齊 `cancel-form.ts:140` 的 `parseItemEntry`)。
 *    ⚠️ **能力邊界寫清楚**:RPC 支援「同一品項只取消其中幾件」,**本表單做不到** ——
 *    零 client state 之下沒有辦法讓員工挑數量:`<select>` 的「不取消」那格必須是空字串,
 *    而空字串會被 `getAll()` 一起收走、讓整份表單變 `{ok:false}`(解析器對空值沒有豁免)。
 *    ⇒ 現況 = 「要取消這個品項就取消到底」。已落 Q 信請 Sean 裁要不要補「挑數量」。
 * 🔴 只列**勾得動**的品項(`maxCancellable` 非 null 且 > 0):`null` = 上限算不出來
 *    (`cancel-view.ts` 的 `SUMMARY_FAIL_CLOSED`)⇒ 一律不給勾,不是畫成 0。
 */
export function PartialCancelForm({
  orderId,
  items,
  itemNames,
}: {
  orderId: string;
  items: readonly CancelItemView[];
  /**
   * `orderItemId` → 給員工看的品名。缺這顆時退回顯示 id 尾八碼。
   *
   * 🔴 **用 `Map` 不用物件字面**:這裡的鍵是**資料來的 uuid**,而 `obj[使用者輸入]` 會取到
   *    原型鏈屬性(`constructor` / `toString` 都是 truthy)⇒ 畫出鬼名字或 `undefined`。
   *    PCM 曾因這個形狀中過 6 頁(memory `reference_js-index-lookup-hits-prototype-chain`);
   *    `Map.get()` 沒有原型鏈這回事。
   * ⚠️ **本片刻意選 optional**:`CancelItemView`(plan 定的形狀)不帶品名,
   *    真正有品名的是 D6 接線時手上的 `AdminOrderDetailItem`。
   */
  itemNames?: ReadonlyMap<string, string>;
}) {
  // 🔴 **「勾得動」的判定共用 `cancel-view.ts` 的 `isItemSelectable`**(R1 must-fix 5):
  //    原本這裡自己寫了一份逐字相同的條件,而本檔同時宣稱「判定不在這裡」——
  //    那正是兩份會漂移的規格。型別述詞也順帶把 `maxCancellable` 收窄成 `number`。
  const selectable = items.filter(isItemSelectable);

  // 🔴 **一顆都勾不動就不要給表單**(R1 must-fix 6):空 fieldset 配一顆按得下去的送出鈕,
  //    按下去必然 `{ok:false}`(部分取消要求至少一筆,`cancel-form.ts:208`)
  //    ⇒ 導頁 `order_cancel_invalid`,而 `E-014-A` Q2=A 之下**原因欄不保留**、要整份重填。
  //    ⚠️ 上游 `canCancel` 本來就會擋掉這張單,但本元件只吃 `items`、不吃 view
  //    ⇒ 不能把這道守門押在「D6 接線的人記得判」。**自己擋住自己**。
  if (selectable.length === 0) return null;

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>取消部分品項</h2>
      <CancelFormShell orderId={orderId} mode='partial' submitLabel='取消勾選的品項'>
        <fieldset className='space-y-2'>
          <legend className='mb-1 text-sm font-medium'>要取消的品項</legend>
          {selectable.map((item) => (
            <label key={item.orderItemId} className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                name={CANCEL_ITEM_FIELD}
                value={`${item.orderItemId}:${item.maxCancellable}`}
              />
              <span>
                {itemNames?.get(item.orderItemId) ?? `品項 …${item.orderItemId.slice(-8)}`}(買{' '}
                {item.quantity} 件,這次可取消 {item.maxCancellable} 件)
              </span>
            </label>
          ))}
        </fieldset>
      </CancelFormShell>
    </section>
  );
}
