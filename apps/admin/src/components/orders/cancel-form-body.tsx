'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REASON_DETAIL_FIELD,
} from '../../lib/orders/cancel-action-state';
import { CANCEL_REASON_CODES, CANCEL_REASON_LABEL } from '../../lib/orders/cancel-form';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// cancel-form-body.tsx — M-4b E10 **A13b E1**:兩支取消表單的**漸進增強層**(Sean 08-10 晨拍 Q2=B)。
//
// 🔴🔴 **這是取消線上唯一一個「承載表單控制項」的 client 檔**,而取消線的修法本體是
//    「**送出值不由 client state 產生或回寫;原生控制項才是送出來源**」
//    (`cancel-order-forms.tsx` 檔頭:`E-011-STOP` 誤送整單取消)。
//    ⚠️ 不要寫「零 client state」—— 那句在 A13b E1 之後是假的(本檔就有 state)。
//    ⚠️ **不要寫成「唯一一個 client 檔」**:取消線還有 `cancel-result-url-cleanup.tsx`(網址清除)
//    也是 client,它只是不碰表單控制項。
//    🔴 **`order-cancel-block.tsx` 不是 client 檔** —— 它第一行是 `import 'server-only'`。
//    R1 reviewer 把它列成 client、我沒親驗就照抄,R2 才抓出來
//    (memory `feedback_verify-subagent-function-behavior-before-decision-question`:
//     審查者給的外部事實同樣會錯)。**用 `grep 'use client'` 數這件事會騙人** ——
//    它會命中註解裡提到這五個字的檔;要數就數「第一行是不是 `'use client'`」。
//    ⇒ 破例的條件寫死在下面三條不變式,**測試逐條釘住**。要加任何 state 的人先讀完。
//
// 🔴 **不變式(i):送出值一律**不由 client state 產生或回寫**;原生控制項才是送出來源。**
//    ⚠️ **字面第三次收窄**(關卡2 codex 第三輪 #3)。前兩版寫「client state 不承載任何會被
//    送出的值」—— **那是假的**:`reasonCode` 就是一個會被送出的值,而它確實存在 state 裡(`:90`)。
//    真正成立的是**方向**:state 只從 DOM 讀進來(單向投影),沒有任何一條路徑把 state 寫回
//    控制項的 value、也沒有拿 state 去組另一個送出值。
//    🔴 取消的「品項」與「數量」更嚴一格:本檔連讀都只讀 `:checked`(算鈕停不停用),
//    數量欄的名字在本檔**一次都沒出現**(有原始碼層守門釘住)。
//    品項 = `cancel_item` checkbox(值在 server 端組好)、數量 = `cancel_item_qty__<id>` 文字欄
//    (`defaultValue`,非受控)。
//    ⚠️ **字面精確**(code-reviewer F4):`syncFromDom` 確實**讀**了 checkbox 的 `:checked` ——
//    但只拿來算「鈕停不停用」,不回寫、不組值。第一版寫成「一行都不碰」是說滿了。
//    ⇒ **client 層不製造「畫面顯示的取消量 < 送出的取消量」這個差距** —— 不是靠小心,是沒有那條路。
//    ⚠️ 不要把這句擴大成「整條線上不存在」:解析器那邊還有一格竄改才到得了的回退
//    (uuid 大小寫變體 ⇒ 覆寫查不到 ⇒ 沿用 checkbox 的量),見 `cancel-form.ts` 的
//    `applyQuantityOverride` 誠實邊界②。
//
// 🔴 **不變式(ii):state 只做三件事 —— 讓 `reason_detail` 不渲染、給它 `required`、
//    讓 partial 的送出鈕 `disabled`。這三件事都不可能讓「取消的品項或數量」變多。**
//    (code-reviewer F9:第一版寫「兩件事」卻標「精確到這裡為止」—— 漏了 `required`。)
//    ⚠️ **字面精確到這裡為止**(我前兩版把它寫成「不可能讓 body 變多」,codex 兩輪各打對一次):
//    React 19 在 function action 完成後會 reset 表單,而 reset **不觸發** `change` / `pageshow`
//    ⇒ 存在「DOM 的 reason_code 已被 reset 成空、但 state 還記得 `other`」的窗口,
//    此時 `reason_detail` 會**留在 DOM 裡**、body 反而多一欄。
//    🔴 **那一格是 fail-closed、不是漏洞**:reason_code 為空 ⇒ 原生 `required` 先擋,
//    真的送出去也會被解析器七碼白名單擋成 `{ok:false}`(`cancel-form.ts`),到不了 RPC。
//    ⚠️ **同一個 reset 窗口還有第二格**(code-reviewer F9):`hasItem` 也會停在 `true`
//    ⇒ 零勾選時鈕仍可按。同為 fail-closed(解析器「至少一筆」)。**兩格都已知、已認列,不宣稱不可能。**
//    🔴🔴 **這兩格是「推論級」,不是實測級**(Fable 假設審查 C1):本片的真瀏覽器 harness 沒有
//    React runtime、跑不到 function-action 的 reset 路徑 ⇒ **要等片 2 才量得到**。
//    🔴 **而且其中「數量回彈 + 重勾」那個構型,現在是被 `#357` 的 stale token 意外擋住的** ——
//    返回/重送帶的是同一顆 token,撞 `payload_hash` 就被拒了。
//    ⇒ **修 `#357`(換鍵)的人必須連動重驗這一格**:那道意外的守門會跟著消失。
//
// 🔴 **不變式(iii):state 是 DOM 的單向投影 —— mount 與 `pageshow` 一律從 DOM 重讀一次。**
//    只靠 `onChange` 累積會在返回鍵 / bfcache 還原後留下「state 比 DOM 舊」的窗口:
//    瀏覽器把 select 復原成 `other`,而 state 還是空 ⇒ 說明欄不渲染 ⇒ 員工看到選了「其他」卻沒有欄位可填。
//
// 🔴 **`disabled` 只套 partial**(關卡1 R2 #3):整單那支**天生零 `cancel_item`** ——
//    若把「零勾選就 disabled」套上去,整單取消鈕會在 hydration 之後**被永久鎖死**。
//    測試那邊配了整單鈕的正向對照(恆可按),不是只測 partial 那一格。
//
// ⚠️ **零 JS 退化 = 逐字現狀**:`enhanced` 初值 false(server 與 hydration 第一輪都是 false)
//    ⇒ 說明欄恆渲染、不帶 `required`、鈕恆可按。三格全部退回本片之前的行為。

// ⚠️ **刻意不加 `useFormStatus` 的送出中停用**(code-reviewer F11;repo 別處有此慣例:
//    `customers/tier-edit-submit.tsx` / `wallet-adjust-submit.tsx`)。E1 之前的理由是「沒有 client 層」,
//    那個理由現在消失了 —— 現行理由是:重複送出由**冪等 token** 吸收(同一顆 token 配同一份 payload
//    ⇒ RPC 認得出是同一次請求),而多一顆 pending state 就多一個「畫面狀態 vs 送出內容」的分岔面,
//    那正是本檔要壓到最小的東西。要加的人先確認它不會讓不變式(ii) 的枚舉再長一條。
const SUBMIT_CLASS =
  'bg-destructive text-destructive-foreground h-9 rounded-md px-5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

export function CancelFormBody({
  submitLabel,
  requireItemSelection,
  children,
}: {
  submitLabel: string;
  /** 🔴 只有部分取消是 true。整單那支傳 false,否則送出鈕會被永久鎖死(見檔頭)。 */
  requireItemSelection: boolean;
  /** 品項欄(server 端渲染,原封傳進來 —— 本檔不生成任何會被送出的值)。 */
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [hasItem, setHasItem] = useState(false);

  /** 🔴 不變式(iii):一律**整份從 DOM 重讀**,不從事件參數累積。 */
  const syncFromDom = useCallback(() => {
    const root = rootRef.current;
    if (root === null) return;
    const select = root.querySelector<HTMLSelectElement>(
      `select[name="${CANCEL_REASON_CODE_FIELD}"]`,
    );
    setReasonCode(select?.value ?? '');
    setHasItem(root.querySelectorAll(`input[name="${CANCEL_ITEM_FIELD}"]:checked`).length > 0);
  }, []);

  useEffect(() => {
    setEnhanced(true);
    syncFromDom();
    // bfcache / 返回鍵還原後 DOM 會帶回舊值,但不會發 change ⇒ 這裡補一次。
    window.addEventListener('pageshow', syncFromDom);
    return () => window.removeEventListener('pageshow', syncFromDom);
  }, [syncFromDom]);

  const showDetail = !enhanced || reasonCode === 'other';

  return (
    <div ref={rootRef} onChange={syncFromDom} className='space-y-3'>
      {children}
      <div className='grid gap-3 sm:grid-cols-2'>
        <AdminFormField label='取消原因'>
          {/*
            🔴 `<option value=''>請選擇</option>` 是必要的,不是裝飾(沿用 D4 檔頭逐字):
               沒有空的 placeholder 時瀏覽器會自動選第一個 ⇒ 員工「重選原因」根本沒發生,
               而表單照樣送得出去、帶著他沒看過的原因。配 `required` 才擋得住。
          */}
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
        {showDetail && (
          <AdminFormField label='說明(只有選「其他」時才填)'>
            {/*
              🔴 **不渲染,不是 `display:none`**:藏起來的 textarea 照樣會被送出 ⇒ 「先填說明、
                 再改選別的原因」仍然整份被退回(`cancel-form.ts` 非 other 帶說明 = `{ok:false}`)、
                 且 `E-014-A` Q2=A 之下輸入不保留、要整份重填。不渲染才真的把那條路關掉。
            */}
            <textarea
              name={CANCEL_REASON_DETAIL_FIELD}
              rows={2}
              required={enhanced}
              className='border-input bg-background rounded-md border px-3 py-2 text-sm'
              placeholder='選「其他」時必填;選其他原因時請留空,填了會被退回。'
            />
          </AdminFormField>
        )}
      </div>
      <div className='flex justify-end'>
        <button
          type='submit'
          disabled={enhanced && requireItemSelection && !hasItem}
          className={SUBMIT_CLASS}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
