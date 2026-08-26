'use client';

// order-export-button.tsx — `#24` 片B:把 server 端算好的 CSV 交給瀏覽器存成檔。
//
// 🔴🔴 **本檔【不碰任何訂單資料】** —— 它收到的是一串已經組好的字串。
//    R1 版本收的是整包 `AdminOrderSummary[]`,而 code-reviewer `I3` 指出那件事的性質:
//    **那是整包訂單讀模型第一次跨進 client bundle。**
//    今天不外洩(admin 頁,員工本來就看得到),而風險是**前向且無訊號的**:
//    `AdminOrderSummary` 日後加任何一欄(成本 / 進貨價 / 經銷價 —— 訂單品項正是它們會落的地方)
//    會**自動**進到瀏覽器 payload,而 `CLAUDE.md` Server 端鐵則點名的就是經銷價。
//    ⇒ 改成 server 端組好字串 ⇒ **client 不再持有任何結構化訂單資料**
//      ⇒ 那條前向風險【在結構上消失】,不是靠下一個人記得檢查。
//
// 🔴 而它同時關掉 `C2`:時間戳現在是 **server render 時**填的,與資料同一時刻
//    (舊版在**點擊當下**取時間 ⇒ 員工 11:30 開頁、14:30 才按 ⇒
//     檔案寫「匯出於 14:30」而每一格都是 11:30 的 ⇒ **舊資料蓋上新時間**)。
//
// ⇒ 一致性的宣稱因此升級:不只是「同一個變數」,是**同一次 render 產出的同一份位元組**。

export function OrderExportButton({
  csv,
  filename,
  blockedReason,
}: {
  /** server 端已組好的整份 CSV(含 BOM)。本檔不修改它。 */
  csv: string;
  filename: string;
  /** 非 null ⇒ 這一頁的資料是半份的,不給匯出;字串本身是要給員工看的理由。 */
  blockedReason: string | null;
}) {
  function handleClick() {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* 🔴 **`setTimeout(…, 0)` 不是裝飾**(code-reviewer `I4`):
       下載是**非同步啟動**的 —— 同一個 tick 內就 revoke,在部分瀏覽器 / 大 blob 下
       會得到**0 byte 或靜靜失敗的下載**。
       🔴 而這一類缺陷**我的真瀏覽器實跑量不到**:那一發攔掉了 anchor 的原生 click
       ⇒ 下載從來沒有開始 ⇒ 「revoke 早」與「revoke 晚」在那個世界**印一模一樣的東西**
         (`createObjectURL 1 次 / revokeObjectURL 1 次`,兩邊都是)。
       ⇒ **這一行是照著「我量不到它」修的,不是照著「我量到它壞了」修的。** */
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (blockedReason !== null) {
    /* 🔴🔴 **擋下來的時候要把理由講出來, 不是把按鈕變灰。**
       「變灰」是一個**看起來有處理過**的狀態, 而它讓人以為按下去會有事發生。
       員工要的是「為什麼」與「那我該做什麼」。 */
    return (
      <span className='text-muted-foreground max-w-md text-xs' data-export-blocked>
        {blockedReason}
      </span>
    );
  }

  return (
    <button
      type='button'
      onClick={handleClick}
      data-export-button
      /* 🔴 `h-8` 的兩端都有出處:上界 ≤35(那一列被 `order-toolbar-browser.test.tsx:208` 釘住,
         而 35 是 Sean 2026-08-24 拍板的字級規則撐的);下界 24
         (OD `orders-admin-v2.html:5718` 的 `#od-stage button{min-height:24px}`)。
         📌 我在 `fc6a1edf` 用 `py-2` 撐高過那一列一次(修在 `03f7e27f`)。 */
      className='inline-flex h-8 items-center rounded-md border px-3 text-sm'
    >
      匯出這一頁
    </button>
  );
}
