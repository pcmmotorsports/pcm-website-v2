// result-banner.tsx — 改單 PRG 結果提示(M-4a Slice C;server action redirect 帶 ?r=<code> 後顯示)。
// server-render;code 由頁面從 searchParams.r 讀入。未知/缺 → 不顯示。

const MESSAGES: Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }> = {
  saved: { text: '已儲存變更。', tone: 'ok' },
  noop: { text: '沒有變更(內容與原本相同)。', tone: 'ok' },
  conflict: { text: '這張單在你編輯期間被改過了,已重新載入最新狀態,請確認後再存一次。', tone: 'warn' },
  invalid: { text: '表單內容不正確,未儲存。', tone: 'warn' },
  denied: { text: '沒有權限或登入狀態已失效,未儲存。', tone: 'error' },
  error: { text: '儲存失敗,請稍後再試或聯絡系統維護。', tone: 'error' },
};

const TONE = {
  ok: 'border-green-500/30 bg-green-500/5 text-green-700',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
} as const;

export function ResultBanner({ code }: { code: string | undefined }) {
  if (!code) return null;
  const msg = MESSAGES[code];
  if (!msg) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {msg.text}
    </div>
  );
}
