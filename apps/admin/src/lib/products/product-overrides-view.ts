// products.staff_overrides(jsonb)→ 後台畫面用的形狀(商品編輯丙方案片 2)。
// 資料庫 CHECK 已經限制了形狀(20260927040000),這裡仍然防禦性收斂:讀到非預期形狀就當「沒填」,不讓頁面壞掉。

export interface ProductOverrides {
  readonly title: string | null;
  readonly subtitle: string | null;
  readonly highlights: readonly string[] | null;
}

export function readProductOverrides(raw: unknown): ProductOverrides {
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const list =
    Array.isArray(o.highlights) && o.highlights.length > 0 && o.highlights.every((x) => typeof x === 'string')
      ? (o.highlights as string[])
      : null;
  return { title: text(o.title), subtitle: text(o.subtitle), highlights: list };
}
