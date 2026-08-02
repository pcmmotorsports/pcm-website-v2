// settings-result-banner.tsx — 設定頁 PRG 結果提示(M-4a Slice D-3;server action redirect 帶 ?r=<code> 後顯示)。
// server-render;code 由頁面從 searchParams.r 讀入。未知/缺 → 不顯示。tone 鏡像 orders/result-banner。

export type SettingsResultMessages = Readonly<
  Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }>
>;

const MESSAGES: SettingsResultMessages = {
  saved: { text: '已儲存變更。', tone: 'ok' },
  created: { text: '已新增狀態選項。', tone: 'ok' },
  notfound: { text: '找不到該狀態選項(可能已被移除),未儲存。', tone: 'warn' },
  duplicate: { text: '代碼(code)已存在,請換一個,未新增。', tone: 'warn' },
  invalid: {
    text: '輸入格式不正確(代碼須小寫英數底線、標籤 1–32 字、顏色須 #RRGGBB、排序須非負整數)。',
    tone: 'warn',
  },
  denied: { text: '沒有權限或登入狀態已失效,未儲存。', tone: 'error' },
  error: { text: '儲存失敗,請稍後再試或聯絡系統維護。', tone: 'error' },
};

const TONE = {
  ok: 'border-green-500/30 bg-green-500/5 text-green-700',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
} as const;

export function SettingsResultBanner({
  code,
  messages = MESSAGES,
}: {
  code: string | undefined;
  messages?: SettingsResultMessages;
}) {
  if (!code) return null;
  // 🔴🔴 **已知缺陷,Sean 2026-08-02 拍板 B 刻意退回、不是沒發現**:
  //    `code` 來自 URL 的 `?r=`,是**任意字串**。直接索引時 `messages['__proto__']` /
  //    `['constructor']` / `['toString']` 會取到**原型鏈上的屬性**且為 truthy
  //    ⇒ 下一行的 `if (!msg)` 這道守門形同虛設 ⇒ 畫出一個 `class="… undefined"` 的空框
  //    (`msg.text` 是 undefined ⇒ **不會注入任何文字**,純粹是「守門的名字大於它的能力」)。
  //    修法是 `Object.hasOwn(messages, code)`,S3b-2(`4833cae`)曾修過並已上線,
  //    Sean 08-02 拍板退回 —— 理由是它不在該片的產物表內、屬鐵則 8「動共用元件」灰區。
  //    ⇒ 受影響頁面 **6 個**:staff / order-statuses / **suppliers**(本元件)
  //      + orders 列表 / 訂單詳情 / 客戶詳情(姊妹元件 `orders/result-banner.tsx`)。
  //    🔴 退回時 `lib/supplier-result-messages.test.tsx` 的三個原型鏈向量也一起拿掉了 ——
  //    留著會轉紅,而把它們改成「期望畫出空框」等於用測試把缺陷釘成規格。
  //    要再修的話,兩支元件要一起、並且走 plan。
  const msg = messages[code];
  if (!msg) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {msg.text}
    </div>
  );
}
