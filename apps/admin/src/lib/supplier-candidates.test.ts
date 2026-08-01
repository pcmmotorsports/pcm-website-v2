import { describe, expect, it } from 'vitest';

import { filterSupplierCandidates } from './supplier-candidates';

// 驗收 16a-16g(plan v3 §5;16h 元件層那條屬 S3b-3 的 UI 片,本檔不涵蓋)。
// 🔴 向量取自母 plan §11 的**真 seed 名單**,不是編出來的 —— Webike TW/JP/EU 是同公司
//    三個下單管道,正是「機器猜同會給出錯誤建議」那條實證的來源。

const ROWS = [
  { label: '安豐達', is_active: true },
  { label: '阿毅物流', is_active: true },
  { label: 'AKOSO', is_active: true },
  { label: 'Webike TW', is_active: true },
  { label: 'Webike JP', is_active: true },
  { label: 'Webike EU', is_active: false }, // 刻意停用:16e 的承重向量
  { label: 'WRS s.r.l', is_active: true },
] as const;

const labels = (rows: readonly { label: string }[]) => rows.map((r) => r.label);

describe('filterSupplierCandidates', () => {
  // ── 16a:恰 3 筆 ────────────────────────────────────────────
  it('should return exactly the three Webike ordering channels', () => {
    expect(labels(filterSupplierCandidates(ROWS, 'Webike'))).toEqual([
      'Webike TW',
      'Webike JP',
      'Webike EU',
    ]);
  });

  // ── 16b:不存在 ⇒ 0 筆(**不是**擋人,只是沒有提示可給)────────
  it('should return nothing for a string that matches no supplier', () => {
    expect(filterSupplierCandidates(ROWS, 'zzzz')).toEqual([]);
  });

  // ── 16c:大小寫不敏感 ───────────────────────────────────────
  it.each(['webike', 'WEBIKE', 'WeBiKe'])(
    'should be case-insensitive for %s',
    (query) => {
      expect(filterSupplierCandidates(ROWS, query)).toHaveLength(3);
    },
  );

  // ── 16d:前後空白不影響(字面寫在測試裡,不靠 markdown 呈現)──
  it('should ignore surrounding whitespace in the query', () => {
    expect(filterSupplierCandidates(ROWS, '  Webike ')).toHaveLength(3);
  });

  // 🔴 rpcTrim 而非 .trim():零寬空白也要剝掉,否則貼上來的名稱會讓候選整個空掉,
  //    而表單那一側(normalizeLabel 用同一把尺)卻判它合法 ⇒ 兩側對同一輸入不一致。
  it('should strip zero-width whitespace the way the form parser does', () => {
    const zwsp = String.fromCharCode(0x200b);

    expect(filterSupplierCandidates(ROWS, `${zwsp}Webike${zwsp}`)).toHaveLength(3);
  });

  // ── 16e:含已停用的候選(契約債②的送出前防線)─────────────────
  // 🔴 這條的承重點有兩個:①停用的那筆**有出現** ②回傳結構帶得出 is_active
  //    讓 UI 標「(已停用)」。少了它就退回「送出後才撞 DUPLICATE_LABEL」。
  it('should include inactive suppliers and expose their state to the caller', () => {
    const found = filterSupplierCandidates(ROWS, 'Webike EU');

    expect(found).toEqual([{ label: 'Webike EU', is_active: false }]);
  });

  // ── 16f:空 query ⇒ 全部(不是 0 筆)────────────────────────
  it.each(['', '   ', String.fromCharCode(0x3000)])(
    'should return every row for the blank query %j',
    (query) => {
      expect(filterSupplierCandidates(ROWS, query)).toHaveLength(ROWS.length);
    },
  );

  // ── 16g 突變①:改成「前綴」比對 ⇒ 本條轉紅 ────────────────────
  // 🔴 中段字向量是**必要**的:只用 'Webike' 測的話,前綴與包含**行為完全相同**
  //    ⇒ 那個突變殺不掉。
  it('should match on substring, not just prefix', () => {
    expect(labels(filterSupplierCandidates(ROWS, 'bike'))).toEqual([
      'Webike TW',
      'Webike JP',
      'Webike EU',
    ]);
    expect(labels(filterSupplierCandidates(ROWS, '物流'))).toEqual(['阿毅物流']);
  });

  // ── 不排序:保持輸入順序(單一排序來源的前提)──────────────────
  // 🔴 若本函式自己排一次,`sortSuppliersByLabel` 就不再是唯一排序入口,
  //    而結構斷言(collator 恰 1 處)看不見「用 localeCompare 另排一次」這種寫法。
  it('should preserve the caller order instead of sorting again', () => {
    const reversed = [...ROWS].reverse();

    expect(labels(filterSupplierCandidates(reversed, 'Webike'))).toEqual([
      'Webike EU',
      'Webike JP',
      'Webike TW',
    ]);
  });

  it('should not mutate the caller array', () => {
    const rows = [...ROWS];

    filterSupplierCandidates(rows, '');

    expect(rows).toEqual([...ROWS]);
  });
});
