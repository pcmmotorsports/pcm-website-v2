import { cancelOrderAction } from '../../lib/orders/cancel-actions';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_MODE_FIELD,
  CANCEL_ORDER_ID_FIELD,
  CANCEL_REQUEST_TOKEN_FIELD,
  cancelItemQtyField,
} from '../../lib/orders/cancel-action-state';
// 🔴 #363:產生器改從**獨立的 server-only 模組**取(client 檔 import 它 = build 期紅)。
//    這一行的 import 來源本身就是守門的一部分,別為了「少一個 import」搬回上面那支。
import { generateCancelRequestToken } from '../../lib/orders/cancel-request-token';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { isItemSelectable, type CancelItemView } from '../../lib/orders/cancel-view';
import { CancelFormBody } from './cancel-form-body';

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
// 🔴🔴 **A13b E1 之後的界線 = 「送出值不由 client state 產生或回寫;原生控制項才是送出來源」**
//    (Sean 08-10 晨拍 Q2=B)。
//    ⚠️ 這一句是**修正**,不是補充 —— 本檔頭在 E1 之前寫的是「零 client state、零 `'use client'`」,
//    而 E1 加進了 `cancel-form-body.tsx`。**「零 client state」與「零 client state 承載送出值」
//    兩種寫法都已作廢**(前者是假的、後者與本段自己承認的「reason_code 進 state」打架)。
//    字面必須跟著事實走。
//    現行界線(三條不變式的全文與論證在 `cancel-form-body.tsx` 檔頭,這裡不重抄):
//    - **送出值不由 client state 產生或回寫;原生控制項才是送出來源。**
//      品項 checkbox、數量覆寫欄、原因下拉、說明欄、三顆 hidden 全部未受控。
//      (⚠️ `reason_code` 的值**有**被讀進 state —— 單向投影、只用來決定顯示,不回寫。)
//    - client state 只驅動三件事:說明欄渲不渲染、它帶不帶 `required`、partial 送出鈕停不停用。
//    - 這**三件事**都不可能讓「取消的品項或數量」變多 —— 那才是 `E-011-STOP` 的傷害方向。
//      (第一版這裡寫「這兩件事」與同段的「三件事」自相矛盾,關卡2 codex 第三輪抓到。)
//    ⚠️ 失敗後**輸入仍不保留**(`E-014-A` Q2=A):畫面狀態一律由 server 從帳本重建,E1 沒有改這條。

// 🔴 **server 端第二道仍在**:`parseOrderCancelForm` 的 full 分支(`cancel-form.ts:252`)的「`full` 卻帶品項 ⇒ `{ok:false}`」
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
// 🏁 **已解(A13b E1):勾了零個品項仍按得下送出**(原 `E-047-Q` Q2)。
//    JS 在場 ⇒ partial 的送出鈕 `disabled`;零 JS ⇒ 維持原行為(送出後被解析器擋、導頁 `invalid`)。
//    原生 HTML 沒有「checkbox 群組至少勾一個」的宣告式驗證(`required` 只作用在單顆),
//    所以這格只能靠漸進增強;**解析器那道「至少一筆」仍在,沒有被 UI 取代**。
//
// 🏁 **已解(A13b E1):說明欄只有選「其他」時才在畫面上**(原 `E-046-Q` 附註)。
//    JS 在場 ⇒ 非 `other` 時 textarea **不渲染**(不是藏起來 —— 藏起來照樣會被送出)、
//    選 `other` 時帶原生 `required`;零 JS ⇒ 恆渲染、靠 label 與 placeholder 講清楚(原行為)。

// 🔴🔴 **已知未解:返回鍵(`goBack()`)帶回來的是「上一次那顆」token**(R1 must-fix 4,誠實邊界)。
//    plan `2026-08-09-e10-a13b-prg-rework-plan.md:123-124` 的探針結論逐字:
//    「radio 復原 ✅ / 文字欄復原 ✅ / **hidden input 維持 markup 值** ✅」
//    ⇒ 送出失敗 → 按返回 → 改原因或改勾選 → 再送,用的是**同一顆 token 配不同 payload**
//    ⇒ 撞 `payload_hash`(`20260805100000:195-198`)⇒ 回 `rejected`,而那句話是
//    「這張單目前不能取消」—— 員工「再改改看」永遠過不了。這正是
//    `cancel-action-state.ts` 檔頭「失敗後 token 怎麼處理」那段說要避開的那條路。
//    ⚠️ **備註線把同一件事列成債④、用 client 端 `pageshow` 換鍵解決**(`note-compose-form.tsx:32-36`)。
//    🔴 **E1 之後這條仍是「認列、未修」,而且理由變了,要寫清楚**:E1 已經引進 client 層,
//    「不能有 client 行為」不再是擋路的理由 —— 擋路的是 **E1 的不變式(i)**:
//    token 是**會被送出的值**,一旦由 client 端重鑄,產生點就離開 server 渲染期,
//    直接打爆 `generateCancelRequestToken` 的義務。要修得先想清楚那條義務怎麼辦。
//    D6-a 已用真瀏覽器實測證實兩次 POST 帶同一顆 `rt`(`cancel-forms-browser.test.tsx`),
//    修法屬 `#357` 族,不在 E1 片界內。

/** 版面用字(結構鎖、字不鎖 —— 中文字面待 Sean 肉眼定稿,同 `cancel-review-section.tsx:26`)。 */
const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-medium';

/**
 * 兩支表單共用的外殼:server action + 三顆 hidden + 原因欄 + 送出鈕。
 *
 * 🔴🔴 **token 在這裡鑄 —— 每一次 server render 一顆新的**(plan D4 驗收⑥,
 *    D2b 刪掉舊 state 族時**搶救出來的義務**,`cancel-action-state.ts` 的 `generateCancelRequestToken` docstring)。
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
  returnTo,
  mode,
  submitLabel,
  children,
}: {
  orderId: string;
  /**
   * #350d C1:動作做完回哪裡(整頁 `/orders/{id}` / 面板帶 `panel` 的列表網址)。
   * 🔴 值不可信任(client 送得回來):action 端一律再過 `parseOrderReturnTo`,
   *    非法或指向別張單 ⇒ fail-closed 退回本單明細頁。
   */
  returnTo: string;
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
      {/* 🔴 #350d:多這一顆不會動到 D4 的守門 —— 那組數的是 `[name="cancel_mode"]`,
          而 `parseOrderCancelForm` 只讀具名欄位、多餘欄位無害(契約 §6-2 已確認)。 */}
      <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
      {/*
        🔴 原因欄 + 送出鈕在 `CancelFormBody`(`'use client'`,A13b E1 的漸進增強層)。
           **三顆 hidden 與 token 刻意留在本檔(server)** —— 產生點一旦落進 client 檔,
           token 會變成 client 產、且 hydration 會再產一顆,直接打爆「渲染期鑄」那條義務。
        🔴 `requireItemSelection` 只有 partial 是 true:整單那支天生零 `cancel_item`,
           傳 true 會讓它的送出鈕在 hydration 之後被永久鎖死(關卡1 R2 #3)。
      */}
      <CancelFormBody submitLabel={submitLabel} requireItemSelection={mode === 'partial'}>
        {children}
      </CancelFormBody>
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
export function FullCancelForm({
  orderId,
  returnTo,
}: {
  orderId: string;
  returnTo: string;
}) {
  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>整單取消</h2>
      {/* ⚠️ 畫面文字裡不要寫 markdown 星號 —— JSX 會**逐字印出來**,員工看到的是「**還沒…**」。 */}
      <p className='text-muted-foreground mb-3 text-sm'>
        會把這張單<strong>還沒取消的數量全部</strong>取消掉。取消是永久紀錄,送出後不能刪。
      </p>
      <CancelFormShell orderId={orderId} returnTo={returnTo} mode='full' submitLabel='整單取消' />
    </section>
  );
}

/**
 * 部分取消 —— 勾選要取消的品項。
 *
 * 🔴 **一顆 checkbox = 取消該品項「還能取消」的全部數量**(值 = `<order_item_id>:<數量>`,
 *    形狀逐字對齊 `cancel-form.ts` 的 `parseItemEntry`)。
 * 🏁 **A13b E1 之後,checkbox 不再等於「取消到底」**(Sean 08-10 晨拍 Q2=B「同品項買 3 退 2 會發生」):
 *    checkbox 仍帶 `<id>:<maxCancellable>`(值一個字都沒改),但 `maxCancellable > 1` 的品項
 *    旁邊多一個**數量覆寫欄** `cancel_item_qty__<id>`,解析器以它為準
 *    (規則與兩種空值的分野見 `cancel-action-state.ts` 的 `cancelItemQtyField` docstring)。
 *    ⚠️ **零 JS 也能挑** —— 覆寫欄是原生控制項,沒有任何值由 client 端組出來。
 * 🔴 只列**勾得動**的品項(`maxCancellable` 非 null 且 > 0):`null` = 上限算不出來
 *    (`cancel-view.ts` 的 `SUMMARY_FAIL_CLOSED`)⇒ 一律不給勾,不是畫成 0。
 */
export function PartialCancelForm({
  orderId,
  returnTo,
  items,
  itemNames,
}: {
  orderId: string;
  returnTo: string;
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
  //    按下去必然 `{ok:false}`(部分取消要求至少一筆,`cancel-form.ts:257`)
  //    ⇒ 導頁 `order_cancel_invalid`,而 `E-014-A` Q2=A 之下**原因欄不保留**、要整份重填。
  //    ⚠️ 上游 `canCancel` 本來就會擋掉這張單,但本元件只吃 `items`、不吃 view
  //    ⇒ 不能把這道守門押在「D6 接線的人記得判」。**自己擋住自己**。
  if (selectable.length === 0) return null;

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>取消部分品項</h2>
      <CancelFormShell
        orderId={orderId}
        returnTo={returnTo}
        mode='partial'
        submitLabel='取消勾選的品項'
      >
        <fieldset className='space-y-2'>
          <legend className='mb-1 text-sm font-medium'>要取消的品項</legend>
          {selectable.map((item) => {
            const name = itemNames?.get(item.orderItemId) ?? `品項 …${item.orderItemId.slice(-8)}`;
            return (
              <div key={item.orderItemId} className='flex items-center gap-2 text-sm'>
                {/*
                  🔴 數量欄放在 `<label>` **外面**。
                  ⚠️ 理由不是「點它會 toggle checkbox」(code-reviewer F3 實測打掉我第一版的說法:
                     label activation 規格上**本來就跳過 interactive content**,放裡面點它也不會 toggle)。
                     真正的理由是**點擊區與無障礙語意**:放在 label 內時,label 的空白區、以及
                     `<label>` 對輔助技術宣告的「這段文字描述那顆 checkbox」會把數量欄一起吞進去。
                     ⇒ 測試因此改成直接斷言 DOM 結構(`closest('label') === null`),不是量 toggle 行為 ——
                       量 toggle 是**恆真格**,搬回 label 內也照樣綠。
                */}
                <label className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    name={CANCEL_ITEM_FIELD}
                    value={`${item.orderItemId}:${item.maxCancellable}`}
                  />
                  <span>
                    {name}(買 {item.quantity} 件,這次可取消 {item.maxCancellable} 件)
                  </span>
                </label>
                {/*
                  🔴 **只有可取消量 > 1 才給數量欄**(A13b E1):`=== 1` 的品項多一個永遠只能填 1 的欄位
                     是純噪音,而且解析器對「欄位不存在」與「欄位是空字串」是**不同處置**
                     (`cancel-action-state.ts` 的 `cancelItemQtyField` docstring)。
                  🔴 **`type='text'` 不是 `type='number'`,而且刻意不掛 `min`/`max`/`step`**
                     (關卡1 R2 #1/#2 各打一次):
                     ① `type=number` 遇到非法輸入會把 value 正規化成**空字串**。
                        ⚠️ 這條在**現行**解析器下只是假設:空字串現在一律 `{ok:false}`,不會變成
                        「沿用 max」。留著是因為它記錄了「若哪天有人把空字串改成沿用 max」的引信,
                        **真正站得住的是理由②**。
                     ② 原生 constraint 會作用在**沒被勾選**的品項上 ⇒ 員工在某個沒要取消的品項裡
                        留下一個壞值,會擋住整張表單送出,而錯誤訊息指向他根本沒選的那一行。
                     ⇒ 驗證**單一判官 = 解析器**;這裡只負責讓員工打得出數字。
                */}
                {item.maxCancellable > 1 && (
                  <input
                    type='text'
                    inputMode='numeric'
                    name={cancelItemQtyField(item.orderItemId)}
                    defaultValue={String(item.maxCancellable)}
                    aria-label={`${name} 要取消幾件`}
                    className='border-input bg-background h-8 w-16 rounded-md border px-2 text-sm'
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      </CancelFormShell>
    </section>
  );
}
