// result-banner.tsx — 改單 PRG 結果提示(M-4a Slice C;server action redirect 帶 ?r=<code> 後顯示)。
// server-render;code 由頁面從 searchParams.r 讀入。未知/缺 → 不顯示。

const MESSAGES: Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }> = {
  saved: { text: '已儲存變更。', tone: 'ok' },
  noop: { text: '沒有變更(內容與原本相同)。', tone: 'ok' },
  conflict: { text: '這張單在你編輯期間被改過了,已重新載入最新狀態,請確認後再存一次。', tone: 'warn' },
  invalid: { text: '表單內容不正確,未儲存。', tone: 'warn' },
  denied: { text: '沒有權限或登入狀態已失效,未儲存。', tone: 'error' },
  not_found: { text: '找不到對象資料(可能已被移除),未儲存。', tone: 'warn' },
  error: { text: '儲存失敗,請稍後再試或聯絡系統維護。', tone: 'error' },
};

const TONE = {
  ok: 'border-green-500/30 bg-green-500/5 text-green-700',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
} as const;

export function ResultBanner({ code }: { code: string | undefined }) {
  if (!code) return null;
  // 🔴🔴 **已知缺陷,Sean 2026-08-02 拍板 B 刻意退回、不是沒發現**:
  //    `code` 來自頁面的 `searchParams.r`,是**任意字串**。直接索引時
  //    `MESSAGES['__proto__']` / `['constructor']` / `['toString']` 取到的是
  //    **原型鏈上的屬性**且為 truthy ⇒ 下一行的 `if (!msg)` 這道守門形同虛設
  //    ⇒ 畫出一個 `class="… undefined"` 的空框。
  //    **無注入風險**(`msg.text` 是 undefined ⇒ React 不渲染任何文字),
  //    純粹是「守門的名字大於它的實際能力」。
  //    修法是 `Object.hasOwn(MESSAGES, code)`,S3b-2(`4833cae`)曾修過並已上線,
  //    Sean 08-02 拍板退回 —— 理由是它不在該片的產物表內、屬鐵則 8「動共用元件」灰區。
  //    ⇒ 受影響頁面 **6 個**:orders 列表 / 訂單詳情 / 客戶詳情(本元件)
  //      + staff / order-statuses / suppliers(姊妹元件 `settings-result-banner.tsx`)。
  //    要再修的話,兩支要一起、並且走 plan。
  const msg = MESSAGES[code];
  if (!msg) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {msg.text}
    </div>
  );
}
