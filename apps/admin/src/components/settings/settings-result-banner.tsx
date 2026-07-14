// settings-result-banner.tsx — 設定頁 PRG 結果提示(M-4a Slice D-3;server action redirect 帶 ?r=<code> 後顯示)。
// server-render;code 由頁面從 searchParams.r 讀入。未知/缺 → 不顯示。tone 鏡像 orders/result-banner。

const MESSAGES: Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }> = {
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

export function SettingsResultBanner({ code }: { code: string | undefined }) {
  if (!code) return null;
  const msg = MESSAGES[code];
  if (!msg) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {msg.text}
    </div>
  );
}
