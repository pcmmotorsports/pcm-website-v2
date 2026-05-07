import { resolveEnd, type FitmentSpec } from '@pcm/domain';

/**
 * fitment 結構化 helpers(對齊 docs/specs/M-1-03-main-b-PRD.md §5.2 / §5.3 / §5.5
 * + docs/architecture/supabase-schema-design.md §2.4 + ADR-0003 §4 #3 + ADR-0004 wrs Q1=A1)。
 *
 * 三 helper 用途:
 * - fitmentToWireString:domain → wire string 顯示(storefront ProductPage / FilterSide)
 * - parseWireFitment:wire string → domain(M-5 sync engine 廠商輸入解析、Phase 1 簡版正則)
 * - matchFitmentYear:listByFitment client-side filter 年份範圍重疊
 *   (規則 3、對齊 InMemoryProductRepository.matchFitment 重構後等價)
 *
 * regex / format 字面為 Code 設計選擇(對齊 lessons §12-3 維度 A:implementation
 * detail 不歸給 PRD 字面源、§5.2 / §5.3 spec 精神涵蓋)。
 *
 * @see docs/specs/M-1-03-main-b-PRD.md §5.2 / §5.3 / §5.5
 * @see docs/architecture/supabase-schema-design.md §2.4 4 種狀態表
 * @see packages/adapters/src/in-memory/InMemoryProductRepository.ts matchFitment
 */

/**
 * domain FitmentSpec → wire string(顯示用)。
 *
 * Format: `{motoBrand} {modelCode} {yearPart}`、空段過濾、trim。
 *
 * yearPart 規則(對齊 supabase-schema-design.md §2.4 4 種狀態):
 * - yearStart undefined → 省略年份段
 * - yearEnd null → "YYYY+"(開放式範圍)
 * - yearEnd undefined / === yearStart → "YYYY"(單年)
 * - else → "YYYY-YYYY"(範圍)
 *
 * @example
 * ```ts
 * fitmentToWireString({ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2018, yearEnd: 2024 })
 * // → 'Yamaha CBR600RR 2018-2024'
 *
 * fitmentToWireString({ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2025, yearEnd: null })
 * // → 'Yamaha MT-09 2025+'
 *
 * fitmentToWireString({ motoBrand: 'Honda', modelCode: 'CB650R' })
 * // → 'Honda CB650R'
 * ```
 */
export function fitmentToWireString(spec: FitmentSpec): string {
  const parts = [spec.motoBrand, spec.modelCode];
  const yearPart = formatYearPart(spec.yearStart, spec.yearEnd);
  if (yearPart) parts.push(yearPart);
  return parts.filter(Boolean).join(' ').trim();
}

/** fitmentToWireString 內部 helper:format yearPart 段(對應 4 種 yearEnd 狀態)。 */
function formatYearPart(yearStart?: number, yearEnd?: number | null): string {
  if (yearStart === undefined) return '';
  if (yearEnd === null) return `${yearStart}+`;
  if (yearEnd === undefined || yearEnd === yearStart) return `${yearStart}`;
  return `${yearStart}-${yearEnd}`;
}

/**
 * wire string → domain FitmentSpec(M-5 sync engine 廠商輸入解析時擴展)。
 *
 * Phase 1 簡版正則:取年份段(YYYY / YYYY-YYYY / YYYY+)、剩前 2 段為
 * motoBrand + modelCode。
 *
 * @example
 * ```ts
 * parseWireFitment('Yamaha CBR600RR 2018-2024')
 * // → { motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2018, yearEnd: 2024 }
 *
 * parseWireFitment('Yamaha MT-09 2025+')
 * // → { motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2025, yearEnd: null }
 *
 * parseWireFitment('Honda CB650R')
 * // → { motoBrand: 'Honda', modelCode: 'CB650R' }
 * ```
 */
export function parseWireFitment(str: string): FitmentSpec {
  const yearRegex = /(\d{4})(?:-(\d{4})|(\+))?/;
  const yearMatch = str.match(yearRegex);

  let yearStart: number | undefined;
  let yearEnd: number | null | undefined;
  let remaining = str;

  if (yearMatch) {
    // defaults 對齊 noUncheckedIndexedAccess、narrowing 而非 ! assertion
    const [fullMatch = '', startStr = '', endStr, plus] = yearMatch;
    if (startStr) {
      yearStart = parseInt(startStr, 10);
      if (endStr) {
        yearEnd = parseInt(endStr, 10);
      } else if (plus === '+') {
        yearEnd = null;
      }
      remaining = str.replace(fullMatch, '').trim();
    }
  }

  const segments = remaining.split(/\s+/).filter(Boolean);
  const motoBrand = segments[0] ?? '';
  const modelCode = segments[1] ?? '';

  return { motoBrand, modelCode, yearStart, yearEnd };
}

/**
 * 年份範圍重疊判定(規則 3、對齊 InMemoryProductRepository.matchFitment 重構後等價)。
 *
 * 規則:
 * - 任一邊 yearStart undefined → return true(無年份限制 = 不限年份)
 * - 否則:actualEnd / specEnd 用 resolveEnd 解析
 *   (actual / spec 兩端對稱處理 yearEnd null/undefined、對齊 backlog #94)
 * - 範圍重疊判定:actual.start ≤ spec.end 且 spec.start ≤ actual.end
 *
 * **使用前提:** 本 helper 只負責年份範圍判定、**不**比對 motoBrand / modelCode。
 * 預期搭配 listByFitment SQL `.contains('fitments', [{motoBrand, modelCode}])` server-side
 * prefilter 後使用;若孤立呼叫(例 InMemory 走規則 1+2+3 全部 in-memory、見其 matchFitment private),
 * 必須上游自行處理 motoBrand / modelCode 配對、否則回傳 true 不代表整體 match。
 *
 * @see resolveEnd(packages/domain/src/catalog/year-range.ts)
 * @see packages/adapters/src/in-memory/InMemoryProductRepository.ts matchFitment 規則 3
 */
export function matchFitmentYear(actual: FitmentSpec, spec: FitmentSpec): boolean {
  if (actual.yearStart === undefined || spec.yearStart === undefined) return true;
  const actualEnd = resolveEnd(actual.yearStart, actual.yearEnd);
  const specEnd = resolveEnd(spec.yearStart, spec.yearEnd);
  return actual.yearStart <= specEnd && spec.yearStart <= actualEnd;
}
