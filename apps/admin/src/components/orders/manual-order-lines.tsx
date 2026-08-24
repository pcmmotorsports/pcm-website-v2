'use client';

import { useState } from 'react';
import {
  MANUAL_ORDER_LINE_QTY_BASE,
  MANUAL_ORDER_LINE_SKU_BASE,
  MANUAL_ORDER_LINE_SPEC_BASE,
  MANUAL_ORDER_LINE_TITLE_BASE,
  MANUAL_ORDER_LINE_UNIT_PRICE_BASE,
  MANUAL_ORDER_LINE_VARIANT_BASE,
  MANUAL_ORDER_MAX_LINES,
  manualOrderLineField,
} from '@/lib/orders/manual-order-form';

// manual-order-lines.tsx — M12-A3-c:手動建單的**品項列**(主視窗 2026-08-24 裁「丙」)。
//
// 🔴🔴 **不變式(i),逐字抄自 `cancel-form-body.tsx`,而本檔比它更嚴**:
//    「送出值一律**不由 client state 產生或回寫;原生控制項才是送出來源**」
//    —— 那是 `E-011-STOP` 四輪修不穩 + 一次**誤送整單取消**換來的,不是風格。
//
//    **本檔的 state 只有一個東西:`rows`,一個 id 陣列。**
//    它決定「畫面上有幾列」,**一個值都不讀、不寫、不組**。
//    · 每個 input 都是**非受控**(`defaultValue` 或什麼都不給),沒有 `value=`、沒有 `onChange`
//    · 加一列 = `rows` 多一個 id;刪一列 = 少一個 id ⇒ 那一列的 DOM 消失 ⇒ 它的值自然不送
//    · **沒有任何一條路徑**把 state 寫回控制項、或拿 state 去組另一個送出值
//    ⇒ 「畫面顯示的品項」與「送出去的品項」**沒有可以分岔的地方**,不是靠小心。
//    🔴 有原始碼層守門釘住這件事(`manual-order-lines.test.tsx` 的「本檔不得出現 value=」那一格)。
//
// 🔴 **為什麼是六個平行欄位而不是一個 JSON 欄**:見 `manual-order-form.ts` 欄位常數那一段。
//    一句話:湊 JSON 一定得「讀值再組值」,那正是不變式 (i) 禁止的動作。
//
// ⚠️ **`line_spec` 沒有畫面入口**(任意鍵字典,原生控制項表達不出來)⇒ 送空字串。
//    **這是明說的缺口,不是做完了。** 那個欄位仍然逐列送出 —— 理由**不是**「長度要全等」
//    (那是第一版的形狀,已退場):現在是**這一列在席就六格全部都要在席**,少送任一格 ⇒ 整張表單被拒。
// 🔴🔴 **而這個缺口的真正代價已經量到了, 比「少一個輸入框」大**:
//    RPC 把送進去的 spec 直接寫成不可變的 `product_snapshot.spec`(`20260824020000:422`)
//    ⇒ 有顏色/尺寸的既有 variant, 手動建單之後那份快照**永遠是 `{}` 且補不回來**。
//    主視窗 2026-08-24 裁「乙 = server 依 variant_id 取權威 spec」為**另一片、上線前硬前置**。
//
// 🔴🔴 **React 19 表單 reset 在本檔【不是】取消線那個坑**,而理由要寫清楚,不要靠感覺:
//    取消線踩到的是「reset 把數量欄還原成 `defaultValue`(= 可取消上限)⇒ 第二次送出變多」。
//    本檔的 `defaultValue` 全部是**空的**(或 `0`)⇒ reset 只會把列清空,**不會把數量放大**。
//    而 `createManualOrderAction` 是**全 PRG**(每一條路徑都 `redirect()`)⇒ 送出後畫面本來就換掉。
//    ⚠️ **但 `rows` 是 state ⇒ reset 之後列數還在、值沒了。** 那個狀態是「幾個空列」,
//       而空列會被解析器跳過 ⇒ **不會產生一張少了品項卻說成功的單**。
//
// ⚠️ **本片【不含】「複製上一張單」**(A3-c 原本綁著它)——
//    那需要伺服器端去載上一張單並回填,是另一片。**它欠著,不是做完了。**
//    🔴 而它的坑已經寫在 `manual-order-form.ts` 的 `newManualRequestId` docstring 裡:
//       複製時**必須產新的冪等鍵**,沿用舊的且內容沒改 ⇒ RPC 回 `idempotent:true` + 舊單號
//       ⇒ 員工以為建了第二張,其實沒有,**而那條路回的是成功、不是錯誤**。

/** 一列的 id。**只用來當 React key 與刪除的標的,永遠不進 FormData。** */
let nextRowId = 0;
const newRowId = () => (nextRowId += 1);

export type ManualOrderLinesProps = {
  /** 一開始擺幾列空白。預設 1 —— 員工進來就看得到一列可以打字的東西。 */
  initialRows?: number;
};

export function ManualOrderLines({ initialRows = 1 }: ManualOrderLinesProps) {
  const [rows, setRows] = useState<number[]>(() =>
    Array.from({ length: Math.max(1, initialRows) }, newRowId),
  );

  const atMax = rows.length >= MANUAL_ORDER_MAX_LINES;

  return (
    <fieldset className='space-y-2 rounded-md border p-3' data-testid='manual-order-lines'>
      <legend className='px-1 text-sm'>品項</legend>

      <p className='text-muted-foreground text-sm'>
        網站上沒有的東西(代購)就把「商品編號」留白,品名跟金額自己打。
      </p>

      {rows.map((id, index) => (
        <div key={id} className='grid grid-cols-12 gap-2' data-testid='manual-order-line-row'>
          <label className='col-span-2 text-sm'>
            <span className='sr-only'>第 {index + 1} 列料號</span>
            <input
              name={manualOrderLineField(MANUAL_ORDER_LINE_SKU_BASE, index)}
              placeholder='料號'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          <label className='col-span-4 text-sm'>
            <span className='sr-only'>第 {index + 1} 列品名</span>
            <input
              name={manualOrderLineField(MANUAL_ORDER_LINE_TITLE_BASE, index)}
              placeholder='品名'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          <label className='col-span-1 text-sm'>
            <span className='sr-only'>第 {index + 1} 列數量</span>
            <input
              name={manualOrderLineField(MANUAL_ORDER_LINE_QTY_BASE, index)}
              inputMode='numeric'
              placeholder='數量'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          <label className='col-span-2 text-sm'>
            <span className='sr-only'>第 {index + 1} 列單價</span>
            <input
              name={manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, index)}
              inputMode='numeric'
              placeholder='單價'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          <label className='col-span-2 text-sm'>
            <span className='sr-only'>第 {index + 1} 列商品編號(代購留白)</span>
            <input
              name={manualOrderLineField(MANUAL_ORDER_LINE_VARIANT_BASE, index)}
              placeholder='商品編號'
              className='block w-full rounded-md border px-2 py-1'
            />
          </label>
          {/* 🔴 規格這一格**沒有畫面入口**(見檔頭),而它仍然逐列送出。
              ⚠️ 用 `type='hidden'` 而不是不渲染:**這一列在席就六格全部都要在席**,
              少送它 ⇒ 解析器判「缺格」⇒ 整張表單被拒(不是靜默補空)。 */}
          <input type='hidden' name={manualOrderLineField(MANUAL_ORDER_LINE_SPEC_BASE, index)} />
          <div className='col-span-1 flex items-center'>
            {/* 🔴 只剩一列時**不出**刪除鈕 —— 刪光之後畫面上沒有東西可以打字,
                而員工看不出下一步是什麼(他會以為壞了)。 */}
            {rows.length > 1 && (
              <button
                type='button'
                aria-label={`刪掉第 ${index + 1} 列`}
                className='rounded-md border px-2 py-1 text-sm'
                onClick={() => setRows((r) => r.filter((x) => x !== id))}
              >
                刪掉
              </button>
            )}
          </div>
        </div>
      ))}

      <div className='flex items-center gap-2'>
        <button
          type='button'
          disabled={atMax}
          className='rounded-md border px-3 py-1 text-sm disabled:opacity-50'
          onClick={() => setRows((r) => [...r, newRowId()])}
        >
          加一列
        </button>
        {/* 🔴 撞到上限要**說出來**,不是讓那顆鈕安靜地按不動 ——
            按不動而沒有話,員工會以為是網頁壞了(`project_admin-ux-operation-intuitiveness`)。 */}
        {atMax && (
          <span role='status' className='text-sm text-amber-700'>
            一張單最多 {MANUAL_ORDER_MAX_LINES} 個品項,再多請拆成兩張單。
          </span>
        )}
      </div>

      {/* ⚠️ 這裡**沒有**小計 —— 金額由 RPC 自己算,它不信任何 client 送的合計
          (`manual-order-form.ts` 那段逐字)。在畫面上算一份會生出「畫面說 A、單子是 B」的第二個真相。 */}
    </fieldset>
  );
}
