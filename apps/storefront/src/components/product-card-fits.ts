// product-card-fits.ts — 目錄卡片「適用 …」字串組裝(S4:同名不同年商品在卡片可區分)。
//
// 顯示規則(docs/specs/2026-07-12-search-vehicle-work-plan.md §5、Sean 拍板):
//   - 單一車款:「{品牌} {車型} {年份}」,年份兩位數緊湊 '18–'24(與 PDP 4 位數值一致、格式較緊)。
//   - 多車款(Sean Q1=A):「{N} 款車型」——不挑代表款(PCM 既有鐵則)。
//   - 缺年份(真實 case、例 bonamici rc08_dv4):降級只顯車款、不杜撰年份。
//   - 無 fitment 陣列:回退 RPC 衍生 `fits`(第一款字串或 '通用款')。
//
// 年份三態忠實 UIFitment.yearEnd(對齊 ProductFitments.formatYears 語意):
//   null=開放式('YY+)/ 省略(undefined)=單年 / number=明確迄年。

import type { UIFitment } from '@/data/mock-products';

/** 急件2 防呆:車款名欄位 jsonb 直透可為 null/非字串(prod 實證)→ 非 string 一律視為 ''。 */
function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 兩位數年份:2018 → '18(負模數保護,理論上年份恆正)。 */
function twoDigit(year: number): string {
  return `'${String(((year % 100) + 100) % 100).padStart(2, '0')}`;
}

/**
 * 單一車款(可能含多筆年段)的緊湊年份摘要;無任何 yearStart → null(降級不顯、不杜撰)。
 * 任一開放式(yearEnd===null)→ "'YY+";否則 min 起年 – max 迄年(迄年 = yearEnd ?? yearStart,單年壓平)。
 */
function summarizeModelYears(fitments: UIFitment[]): string | null {
  const starts = fitments
    .map((f) => f.yearStart)
    .filter((y): y is number => y != null);
  if (starts.length === 0) return null;
  const minStart = Math.min(...starts);
  const hasOpenEnded = fitments.some((f) => f.yearStart != null && f.yearEnd === null);
  if (hasOpenEnded) return `${twoDigit(minStart)}+`;
  const ends = fitments
    .filter((f) => f.yearStart != null)
    .map((f) => (f.yearEnd != null ? f.yearEnd : (f.yearStart as number)));
  const maxEnd = Math.max(...ends);
  return maxEnd === minStart ? twoDigit(minStart) : `${twoDigit(minStart)}–${twoDigit(maxEnd)}`;
}

/**
 * 卡片「適用 」後半段字串(呼叫端保留「適用 」前綴,對齊 design 字面)。
 * @param fitments 白名單後的適用車款陣列(catalogRowToUIProduct / toUIProduct 皆填);缺 → 走 fallback。
 * @param fallback RPC 衍生的 `fits` 字串(第一款或 '通用款')。
 */
export function formatCardFits(fitments: UIFitment[] | undefined, fallback: string): string {
  if (!fitments || fitments.length === 0) return fallback;

  const byModel = new Map<string, UIFitment[]>();
  for (const f of fitments) {
    // 急件2 belt(資料進入點已消毒、此為第二層保未來呼叫端):非 string 車款名視為 ''、
    // 雙空條目略過(降級不炸頁);略過後 byModel 空 → 走下方 fallback。
    const brand = cleanName(f.motoBrand);
    const model = cleanName(f.modelCode);
    if (!brand && !model) continue;
    // 同一車款的 direct + inherited(matchSource 不同)歸同款、不重複計數。
    const key = `${brand} ${model}`;
    const list = byModel.get(key);
    if (list) list.push(f);
    else byModel.set(key, [f]);
  }

  if (byModel.size > 1) return `${byModel.size} 款車型`;

  const only = [...byModel.values()][0];
  const first = only?.[0];
  if (!only || !first) return fallback;
  const label = `${cleanName(first.motoBrand)} ${cleanName(first.modelCode)}`.trim();
  if (!label) return fallback; // 防禦:車款名皆空 → 回退,不顯空「適用 」

  const years = summarizeModelYears(only);
  return years ? `${label} ${years}` : label;
}
