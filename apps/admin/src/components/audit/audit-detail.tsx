import type { AuditFieldChange } from '../../lib/audit/audit-diff';

// audit-detail.tsx — `#27` D1c-2b:一筆操作紀錄的「改了哪幾欄」展開檢視。
//
// ── 🔴🔴 本檔的 must:**收合時畫面上不得出現任何「值」** ──────────────────────
//   摘要行(收合時看得到的那行)只寫「**N 個欄位有變動**」。
//   ⇒ **員工不做動作就看不到任何客戶資料 / 成本。** 那是 plan 驗收 9「要有明確的使用者動作」的實作。
//
//   🔴 **而「收合」這件事是 `<details>` 給的,不是我寫的邏輯** —— 我沒有寫任何 JS 去藏它。
//   ⚠️⚠️ **所以這裡有一條真的邊界,不要讀成「已驗證」**(主視窗 2026-08-15 要求寫進 code、不只寫 plan):
//     · **測得到**:jsdom 下的 **DOM 結構** —— `<summary>` 裡有沒有值、`<details>` 有沒有 `open`。
//     · **測不到**:**真實瀏覽器的展開/收合行為** —— 內容在收合狀態下仍在 DOM 裡
//       (`<details>` 就是這樣運作的),**「看不見」是瀏覽器的繪製行為,不是 DOM 狀態。**
//     ⇒ **若哪天有人用 CSS 把 `details` 的預設行為蓋掉,本檔的守門一格都不會紅。**
//       那條要真瀏覽器才驗得到,**本片沒有做**。
//
// 🔴 **`reason` 刻意不顯示,不是漏做**(主視窗要求寫進註解):
//   `reason` 存的是**寫給系統的代碼**(例如 `p_reason_code` ⇒ `admin_cancel`),不是寫給人的句子。
//   把它混進「改了哪幾欄」那張表,員工會以為**那也是一個被改動的欄位**。
//   ⇒ 要顯示 `reason` 是另一個決定,而且它需要一份「代碼 → 中文」字典(D1b 那種工作)。

/** 沒有值的那一側顯示成這個,而不是空白 —— 空白會讀成「這一格壞了」。 */
const NO_VALUE = '(無)';

export function AuditDetail({ changes }: { changes: readonly AuditFieldChange[] }) {
  if (changes.length === 0) {
    // 🔴 **不是空白**:有些寫入端本來就沒有記欄位變動(或前後完全相同)。
    //    顯示空白會被讀成「這頁壞了」,而事實是「這筆沒有可展開的內容」。
    return <span className='text-muted-foreground text-xs'>沒有記錄欄位變動</span>;
  }

  return (
    <details className='text-xs'>
      {/* 🔴 摘要行**只有數字,沒有任何值**。有人把欄名或值放進來,`audit-detail.test.tsx` 會紅。 */}
      <summary className='cursor-pointer underline underline-offset-2'>
        {changes.length} 個欄位有變動
      </summary>
      <table className='mt-2 w-full'>
        <thead>
          <tr className='text-muted-foreground text-left'>
            <th className='py-1 pr-3 font-medium'>欄位</th>
            <th className='py-1 pr-3 font-medium'>原本</th>
            <th className='py-1 font-medium'>改成</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.key} className='align-top'>
              <td className='py-1 pr-3 font-medium break-all'>{change.key}</td>
              <td className='text-muted-foreground py-1 pr-3 break-all'>{change.from ?? NO_VALUE}</td>
              <td className='py-1 break-all'>{change.to ?? NO_VALUE}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
