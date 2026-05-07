/**
 * Category path 解析 helper(對齊 docs/architecture/supabase-schema-design.md §4.3
 * + docs/specs/M-1-03-main-b-PRD.md §5.1)。
 *
 * spec:處理「·」與全形空格分隔(對齊 supabase-schema-design.md §4.3 + design 字面
 * 「引擎部品 · 排氣管」);regex 為 Code 設計選擇、§5.1 spec 精神涵蓋
 * (對齊 lessons §12-3 維度 A:implementation detail 不歸給 PRD 字面源)。
 *
 * 用途:save 路徑建 categories 樹時、解析 raw_path 取 segments + 葉節點 name
 * (對齊 supabase-schema-design.md §4.3 parent_category_id 鏈邏輯)。
 *
 * 注:落地後暫無 importer(list 走 raw_path UNIQUE query 不需 segment 解析);
 * save 落地時 import。
 */

const SEPARATOR = /\s*[·]\s*|　/;

/**
 * 將 raw_path 解析成葉節點 name + segments 陣列。
 *
 * @example
 * ```ts
 * parseCategoryPath('引擎部品 · 排氣管')
 * // → { name: '排氣管', segments: ['引擎部品', '排氣管'] }
 *
 * parseCategoryPath('外觀件')
 * // → { name: '外觀件', segments: ['外觀件'] }
 * ```
 */
export function parseCategoryPath(raw: string): {
  name: string;
  segments: string[];
} {
  const segments = raw
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  return { name, segments };
}
