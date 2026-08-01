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
  // 🔴 **必須用 hasOwn 查表,不能直接索引**(S3b-2 的 banner 測試抓到):
  //    `code` 來自 URL 的 `?r=`,是任意字串。`messages['__proto__']` / `['constructor']`
  //    / `['toString']` 會取到**原型鏈上的屬性**且為 truthy ⇒ 下一行的 `if (!msg)` 放行
  //    ⇒ 畫出一個 `class="… undefined"` 的空框(`msg.text` 是 undefined ⇒ 不會注入文字,
  //    但守門的名字與它的實際能力不符)。目前呼叫端 = `settings/staff/page.tsx:42` 與
  //    `settings/order-statuses/page.tsx:40` **兩頁**(suppliers 那頁 S3b-3 才建),兩頁都中。
  //    回歸守門 = `lib/supplier-result-messages.test.tsx` 的未知碼那組。
  const msg = Object.hasOwn(messages, code) ? messages[code] : undefined;
  if (!msg) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {msg.text}
    </div>
  );
}
