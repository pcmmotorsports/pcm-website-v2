'use client';

// #10 片1:列印鈕。
//
// 🔴 為什麼要有這顆鈕、而不是叫員工按 Ctrl+P:後台的常設準則是「不用人教能做對嗎」
// (memory `project_admin-ux-operation-intuitiveness`)。一張專門用來印的頁面上沒有列印鈕,
// 就是把「你現在該做什麼」這件事丟給員工自己猜。
//
// 🔴 `print:hidden`:鈕自己不能印在紙上。這是本檔唯一一個「壞了不會有人發現」的地方 ——
//    它壞掉的症狀是紙上多一個框,而那要真的印出來才看得到 ⇒ 交件有真瀏覽器實測。
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type='button'
      onClick={() => window.print()}
      className='border-border bg-card hover:bg-muted text-foreground rounded-md border px-3 py-1.5 text-sm print:hidden'
    >
      {label}
    </button>
  );
}
