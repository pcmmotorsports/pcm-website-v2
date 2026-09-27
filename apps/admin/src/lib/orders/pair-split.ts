// Ilmberger「左右一對」出貨提示(2026-09-27;主視窗裁 Q1 甲)。
// plan:docs/plans/2026-09-27-ilmberger-pair-shipping-note-plan.md
// 報價單 14 be23d433 把左右兩件合成一張卡, 另產一個「左右一對」虛擬款(sku {群鍵}-PAIR[-G|-M], spec.position = 左右一對)。
// 客人買「一對」⇒ 倉庫要拆成左、右各一件出貨。同步沒有帶 pair_components ⇒ 用同一張商品卡的兄弟款找左右料號;
// 左右各【恰好一個】才印料號, 其餘一律「料號請到報價單確認」, 不猜。

export const PAIR_POSITION = '左右一對';
const SIDES = { left: '左', right: '右' } as const;

export type PairSplit = { left: string | null; right: string | null };
export type VariantLike = { sku: string; spec: Record<string, unknown> | null };

/** 一對款:spec.position 是「左右一對」, 或 sku 以 -PAIR / -PAIR-G / -PAIR-M 結尾(spec 讀不到時的後備)。 */
export function isPairVariant(sku: string, spec: Record<string, unknown> | null): boolean {
  if (spec?.['position'] === PAIR_POSITION) return true;
  return /-PAIR(-[GM])?$/.test(sku);
}

/** spec 去掉 position 之後的字串(比「其他規格是否相同」用;key 排序後比, 與寫入順序無關)。 */
function specWithoutPosition(spec: Record<string, unknown> | null): string {
  const entries = Object.entries(spec ?? {})
    .filter(([k]) => k !== 'position')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/** 在同一張卡的兄弟款裡找左、右:其他規格與一對款相同、position 是 左 / 右;各恰好一個才算。 */
export function resolvePairSplit(pair: VariantLike, siblings: readonly VariantLike[]): PairSplit {
  const want = specWithoutPosition(pair.spec);
  const pick = (side: string): string | null => {
    const hits = siblings.filter((s) => s.spec?.['position'] === side && specWithoutPosition(s.spec) === want);
    return hits.length === 1 ? hits[0]!.sku : null;
  };
  return { left: pick(SIDES.left), right: pick(SIDES.right) };
}

/** 員工看的那一行(出貨彈窗、揀貨單、出貨單同一句)。兩邊都找到才印料號, 不印半套。 */
export function pairNoteText(split: PairSplit): string {
  return split.left !== null && split.right !== null
    ? `一對：出貨時請拆成左、右各一件（左 ${split.left}、右 ${split.right}）`
    : '一對：出貨時請拆成左、右各一件（料號請到報價單確認）';
}
