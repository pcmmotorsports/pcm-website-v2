'use client';

import { useState } from 'react';
import { filterSupplierCandidates } from '../../lib/supplier-candidates';
import {
  SUPPLIER_LABEL_FIELD,
  SUPPLIER_LABEL_MAX,
  rpcTrim,
} from '../../lib/supplier-form';
import type { SupplierRow } from '../../lib/supplier-repository';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

// supplier-label-input.tsx — M-4b E10 S3b-3:新增供應商的名稱輸入框 + typeahead 候選提示。
//
// 🔴 **為什麼只有這一小塊是 client island,而不是整張表單**:
//    repo 既有慣例(`tier-edit-submit.tsx` / `wallet-adjust-submit.tsx`)是
//    「form 與 server action 留在 server component,只有需要狀態的那一小塊下放 client」。
//    照著做的好處是 **server action 不必被 client 模組 import** ⇒ client 邊界只多一個
//    `useState` 與一支純函式,零 IO、零 action 引用。
//
// 🔴 **本元件不含任何比對邏輯**(plan §4 的明文約束):候選一律由
//    `filterSupplierCandidates` 算出來。元件自己寫一套 `includes` 會讓
//    「打 Webike 恰 3 筆」那條單元測試變成擺設 —— 它測的純函式不再是畫面上跑的那一份。
//    ⇒ 驗收 16h 就是釘這件事:畫面上的候選數必須等於純函式對同一輸入的回傳數。
//
// 🔴 **候選是提醒,不是選擇器,而且刻意不可點**:
//    ①員工無視它照樣送得出去 —— 那正是 Sean 拍板 1「供應商可自行再增加」的字面要求;
//    ②點一下把候選填進輸入框看似方便,但那個名字送出去必定撞 `DUPLICATE_LABEL`
//      ⇒ 等於做一顆「按了保證失敗」的按鈕。撞名之後該做什麼(按那一列的「啟用」)
//      由清單那一側提供,而 Sean Q2=A 明文「啟用是要員工自己按的動作」。
//
// 🔴 **它擋不住什麼**(不得說成「重複問題解決了」):大小寫變體、內部連續空白、標點差異
//    造成的實質重複,DB 一律當成兩家(`suppliers_label_unique` 是區分大小寫的普通 UNIQUE)
//    ⇒ `akoso` 與 `AKOSO` 會乾脆建立成功、零錯誤、且**永久刪不掉**。
//    真正的防線是**人眼**;本元件的工作只是讓那雙眼睛看得到東西。

/** 候選清單的無障礙標籤;測試用它把候選 `<li>` 與表格手機卡片的 `<li>` 分開。 */
export const SUPPLIER_CANDIDATE_LIST_LABEL = '名單裡已有的相似供應商';

export function SupplierLabelInput({ rows }: { rows: readonly SupplierRow[] }) {
  const [query, setQuery] = useState('');

  const candidates = filterSupplierCandidates(rows, query);
  // 🔴 用 `rpcTrim` 而不是 `.trim()`:同一把尺(31 碼位全集)。
  //    只打了空白(含零寬空白)時,純函式的 needle 是 `''` ⇒ 回**全部** —— 若這裡用
  //    `query !== ''` 判斷,打一個零寬空白就會攤開整份名單,看起來像「全部都是候選」。
  // 🔴 這個條件**只決定面板出不出現**,不參與比對 ⇒ 面板一旦出現,
  //    畫面上的候選數恆等於純函式的回傳數(驗收 16h 的成立前提)。
  const showCandidates = rpcTrim(query) !== '';

  return (
    <div className='flex flex-col gap-1 text-sm sm:col-span-2'>
      <label className='flex flex-col gap-1'>
        <span className='text-muted-foreground text-xs font-medium'>
          供應商名稱
        </span>
        <input
          name={SUPPLIER_LABEL_FIELD}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={SUPPLIER_LABEL_MAX}
          required
          autoComplete='off'
          placeholder='例如:Webike TW'
          className={ADMIN_INPUT_CLASS}
        />
      </label>

      {showCandidates && (
        <div
          className='rounded-md border bg-card p-2 text-xs'
          role='status'
          aria-live='polite'
        >
          {candidates.length === 0 ? (
            <p className='text-muted-foreground'>
              名單裡沒有相符的供應商,送出後會建立成新的一家。
            </p>
          ) : (
            <>
              <p className='text-muted-foreground mb-1'>
                名單裡已經有這 {candidates.length} 家(含已停用),確認不是同一家再新增:
              </p>
              {/* aria-label 同時是無障礙標籤與測試錨點:表格的手機卡片也是 `<ul><li>`,
                  沒有它,「畫面上的候選數」會把整份名單的卡片一起數進去(驗收 16h 會假綠)。 */}
              <ul className='space-y-0.5' aria-label={SUPPLIER_CANDIDATE_LIST_LABEL}>
                {candidates.map((row) => (
                  <li key={row.id}>
                    <span
                      className={
                        row.is_active ? undefined : 'line-through opacity-70'
                      }
                    >
                      {row.label}
                    </span>
                    {!row.is_active && (
                      <span className='text-muted-foreground ml-1'>
                        (已停用)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
