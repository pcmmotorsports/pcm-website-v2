import { createSupplierAction } from '../../lib/supplier-actions';
import type { SupplierRow } from '../../lib/supplier-repository';
import { AdminForm } from '../shared/admin-form';
import { SupplierLabelInput } from './supplier-label-input';

// supplier-create-form.tsx — M-4b E10 S3b-3:新增供應商。
// server component:`action` 與表單外框留在 server,只有名稱輸入框(需要 typeahead 狀態)
// 是 client island(見 `supplier-label-input.tsx` 檔頭)。
//
// 🔴 **呼叫端有義務在讀取失敗時不渲染本元件**(plan **§3.1** 的 `[K1-M7]`,`page.tsx` 已實作):
//    名單載不出來 ⇒ 候選恆為空 ⇒ 員工看不到「這家已經有了」⇒ 建一筆**永久刪不掉**的重複列。
//    這是本片**刻意偏離** staff 樣板的地方(`app/settings/staff/page.tsx:47-55` 是照樣渲染的)。

export function SupplierCreateForm({
  rows,
  resultCode,
}: {
  rows: readonly SupplierRow[];
  /** 本次 PRG 回來的結果碼(`?r=`);只用來決定「這次要不要清空輸入框」。 */
  resultCode?: string;
}) {
  return (
    <AdminForm
      action={createSupplierAction}
      variant='card'
      heading='新增供應商'
      footerHint='建立後不可刪除,只能改名或停用。'
      actions={
        <button
          type='submit'
          className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
        >
          新增供應商
        </button>
      }
    >
      {/* 🔴🔴 **這個 key 要同時滿足兩個互相拉扯的反例,少一個都不行。**
          PRG redirect 回同一路由是 soft navigation ⇒ client 元件實例位置不變
          ⇒ `useState` 會留著剛送出的名字。兩輪審查各給了一個反例:

          · codex K2:`key={rows.length}` 不行 —— A 打了「X」還沒送、B 先建好**別家**,
            A 送出撞名回 `duplicate`,此時列數已 `N→N+1` ⇒ key 變 ⇒ 輸入被清空,
            與「撞名要保留輸入讓他改一下再送」**正好相反**。
          · Fable R4:完全不用 key 也不行 —— 新增**成功**後輸入框留著那個名字,
            而名單現在**含**那一家 ⇒ 候選面板在綠色「已新增供應商」底下寫
            「名單裡已經有這 1 家,確認不是同一家再新增」。**每次成功新增都會發生。**
            我上一版只推理了 state 保留的前一個後果,沒推理這一個。

          ⇒ 解法 = **只有 `created` 那條路才把列數當作重建訊號**:
            · `r=created` ⇒ key = 新的 `rows.length` ⇒ 重建 ⇒ 清空(連續新增也成立,列數每次 +1)
            · 其他任何碼(含 `duplicate`)⇒ key 恆為 `'keep'` ⇒ **與列數無關** ⇒ 別人同時新增
              不會把我的輸入清掉。
          🔴 **前提**:「soft nav 保留 client state」這件事本身**在真環境從未驗證過**
          (D3=B 禁止按新增)⇒ 這個 key 的必要性也還沒被真環境證實,只有推理與 jsdom。 */}
      <SupplierLabelInput
        key={resultCode === 'created' ? `created-${rows.length}` : 'keep'}
        rows={rows}
      />
    </AdminForm>
  );
}
