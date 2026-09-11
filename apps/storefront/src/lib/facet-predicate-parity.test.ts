// @vitest-environment node
//
// facet-predicate-parity.test.ts — 側欄件數與列表的過濾條件要是【同一組】(2026-09-12)。
//
// `catalog_facet_counts`(側欄件數)的述詞是從 `search_catalog_by_vehicle`(列表)**抄**的 ⇒ 兩份會漂。
// 本檔讀兩支函式在 `supabase/migrations/` 裡**最新那一代**的定義,斷言那幾段過濾條件兩邊都在。
// 以後有人改了列表的過濾而沒動件數那支 ⇒ 這裡紅 ⇒ 側欄數字與點下去的件數不會安靜地分岔。
//
// 🛑 它只擋「漏改一邊」,擋不住「兩邊一起改錯」—— 那一半由 `scripts/20260912010000-verify.sh`
//   (拋棄式 PG 逐格對照 + 突變)與 migration 尾段的行為閘擋。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');

/** 最新一支 `CREATE [OR REPLACE] FUNCTION public.<name>(` 的本體(到 `$function$;` 為止)。 */
function latestBody(name: string): { file: string; body: string } {
  const opener = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files.reverse()) {
    const src = readFileSync(join(MIGRATIONS, file), 'utf8');
    const m = opener.exec(src);
    if (!m) continue;
    const end = src.indexOf('$function$;', m.index);
    if (end < 0) throw new Error(`${file}:找到 ${name} 的開頭但找不到 $function$; 結尾`);
    return { file, body: src.slice(m.index, end) };
  }
  throw new Error(`migrations 裡找不到 ${name} 的定義`);
}

/** 剝行註解、拿掉表別名前綴(`p.` / `g.` / `m.`…)、壓空白 ⇒ 只剩要比的形狀。 */
function normalize(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join(' ')
    .replace(/\b[a-z]{1,2}\./g, '')
    .replace(/\s+/g, ' ');
}

const FITMENT_WHERE =
  'WHERE moto_brand = p_brand AND (p_model IS NULL OR model_code = p_model) ' +
  'AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year) AND (year_end IS NULL OR year_end >= p_year)))';

/** 兩邊都必須逐字(正規化後)含有的片段。 */
const SHARED = [
  // 分類:大類涵蓋子類(`=` 與 `LIKE 父 · %` 兩個分支)
  "category_raw = vc OR category_raw LIKE vc || ' · %'",
  // 品牌
  'brand_slug = ANY(',
  // 已選分類的正規化(btrim 寫回、丟空字串)
  'array_agg(DISTINCT btrim(x))',
  "WHERE btrim(x) <> ''",
  // 車:兩張 fitments 表、同一組年份條件、UNION 去重
  `FROM public.product_fitments ${FITMENT_WHERE} UNION SELECT product_id FROM public.product_fitments_effective ${FITMENT_WHERE}`,
  // 同一個公開投影
  'FROM public.products_list_public',
];

const missing = (body: string) => SHARED.filter((s) => !normalize(body).includes(s));

describe('側欄件數 × 列表:過濾條件同一組', () => {
  const list = latestBody('search_catalog_by_vehicle');
  const facet = latestBody('catalog_facet_counts');

  it.each(SHARED.map((s) => [s]))('片段兩邊都在:%s', (snippet) => {
    expect(normalize(list.body), `列表 ${list.file} 缺這段`).toContain(snippet);
    expect(normalize(facet.body), `件數 ${facet.file} 缺這段`).toContain(snippet);
  });

  it('件數那支的【分類面板】用的 key 比對,與上面那段同形(只差變數名 kt / vc)', () => {
    // 🔵 SHARED 釘到的是品牌面板那一處(已選分類 vc);分類面板比的是每個 key(kt),要另外釘。
    expect(normalize(facet.body)).toContain("category_raw = kt OR category_raw LIKE kt || ' · %'");
  });

  it('自檢:比對器真的會紅(拿掉子類那個分支 / 拿掉 effective 那張表)', () => {
    expect(missing(facet.body)).toEqual([]);
    expect(missing(facet.body.replaceAll("LIKE vc || ' · %'", "LIKE vc || '%'"))).toHaveLength(1);
    expect(
      missing(facet.body.replace('FROM public.product_fitments_effective', 'FROM public.product_fitments')),
    ).toHaveLength(1);
  });
});
