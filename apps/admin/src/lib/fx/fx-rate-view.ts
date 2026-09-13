// fx-rate-view.ts — 後台「設定 › 匯率」的純函式(無 server-only、可在 jsdom 測)。
// plan `docs/plans/2026-09-13-fx-rate-settings-plan.md`;表 `fx_rates`(`20260913070000`)。
//
// 🔴 匯率一律【字串】不是 number:numeric 過 PostgREST 會變 JSON number 而丟精度,
//    所以讀的時候 `rate_to_twd::text`、寫的時候原字串送 RPC(RPC 端是 numeric)。CLAUDE.md「金額禁 number」同一條。

/** 稿上的十個幣別(`build-v10.py:469` 逐字;順序照稿)。TWD 固定 1、沒有表列、不可改(CHECK `fx_rates_twd_is_one`)。 */
export const FX_CURRENCIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'EUR', label: '歐元' },
  { code: 'IDR', label: '印尼盾' },
  { code: 'GBP', label: '英鎊' },
  { code: 'THB', label: '泰銖' },
  { code: 'AUD', label: '澳幣' },
  { code: 'USD', label: '美元' },
  { code: 'TWD', label: '新台幣' },
  { code: 'JPY', label: '日圓' },
  { code: 'CNY', label: '人民幣' },
  { code: 'SGD', label: '新加坡幣' },
];

export const FX_FIXED_CODE = 'TWD';

export type FxRateRow = {
  id: number;
  currency_code: string;
  /** numeric 的字串形態(`::text`)。 */
  rate_to_twd: string;
  effective_from: string;
  created_by: string;
  created_at: string;
};

export type FxCurrentRate = {
  code: string;
  label: string;
  /** null = 還沒設過(TWD 永遠 '1')。 */
  rate: string | null;
  effectiveFrom: string | null;
  by: string | null;
  fixed: boolean;
};

/**
 * 每個幣別「現在」生效的那一列:`effective_from <= now` 之中最新的(與 RPC 讀 before 的規則同一條)。
 * 未來生效的列不算現在 —— 它在歷史清單裡看得到。
 */
export function currentFxRates(rows: readonly FxRateRow[], now: Date): FxCurrentRate[] {
  const nowMs = now.getTime();
  return FX_CURRENCIES.map(({ code, label }) => {
    if (code === FX_FIXED_CODE) return { code, label, rate: '1', effectiveFrom: null, by: null, fixed: true };
    let best: FxRateRow | null = null;
    for (const r of rows) {
      if (r.currency_code !== code) continue;
      const t = Date.parse(r.effective_from);
      if (Number.isNaN(t) || t > nowMs) continue;
      if (best === null || t > Date.parse(best.effective_from)) best = r;
    }
    return {
      code,
      label,
      rate: best?.rate_to_twd ?? null,
      effectiveFrom: best?.effective_from ?? null,
      by: best?.created_by ?? null,
      fixed: false,
    };
  });
}

/** 表單值 → 送 RPC 的字串;不合格回 null。只認 1–9 位整數 + 最多 6 位小數,不做任何算術。 */
export function parseFxRateInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(s)) return null;
  if (/^0+(\.0+)?$/.test(s)) return null; // 0 不是匯率(RPC 也會擋,這裡先給一句看得懂的話)
  return s;
}

export function isKnownFxCode(raw: unknown): raw is string {
  return typeof raw === 'string' && raw !== FX_FIXED_CODE && FX_CURRENCIES.some((c) => c.code === raw);
}
