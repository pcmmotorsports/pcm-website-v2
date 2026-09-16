import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// home-banner-duplicate-sql.test.ts — 釘住板 20260916250000 的 INSERT【哪幾欄帶、哪幾欄不帶】。
//
// 🔴 **先說這支證得到什麼、證不到什麼**(不要讀寬):
//    ✅ 證得到:那支 SQL 的 INSERT **字面**上帶了什麼、沒帶什麼。
//    ⛔ **證不到行為** —— 「複製出來那張(配到 0 件)按發布會被擋」要有資料庫才驗得了。
//       那一格**板貼了之後才跑得動**,現在是【未驗】。
//
// 🔴 而這支刻意**不用** `sql.toContain('…')` 那種寫法。理由是今晚踩過的:
//    `expect(sql).toContain('4194304')` 只證明「這個字串在檔案裡某處出現過」——
//    把真正在用的地方改掉、而別處還留著那個字串, 它照樣綠。
//    ⇒ 這裡把【欄位清單】與【VALUES】各自切出來,分開比。

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260916250000_m4b_home_banner_duplicate.sql'),
  'utf8',
);

/**
 * 🔴 **切片之前先把 `--` 註解整行剝掉**(R2 N-R2-3 抓到)。
 * 不剝的話,這支自己就有它想避開的那個洞:照本 repo 的刪節線房規寫一行
 * `-- ⛔ ~~原本 v_src.source_email_id…~~` 在上面,而把真正的值改回 `NULL, '{}'`
 * ⇒ `toContain` **在註解上被滿足** ⇒ 五格全綠。
 * 📌 **「字串在某處出現過」那個洞,在一個小一號的範圍內原封不動地復活了。**
 */
function stripComments(block: string): string {
  return block.replace(/^\s*--.*$/gm, '');
}

/** 切出 `INSERT INTO public.home_banners ( … )` 的欄位清單那一段(已剝註解)。 */
function columnList(): string {
  const m = SQL.match(/INSERT INTO public\.home_banners\s*\(([\s\S]*?)\)\s*\n\s*VALUES/);
  if (m?.[1] === undefined) throw new Error('切不出 INSERT 的欄位清單 ⇒ 這支的形狀變了, 先看它再改測試');
  return stripComments(m[1]);
}

/** 切出 `VALUES ( … )` 到 `RETURNING` 之間那一段。 */
function valuesBlock(): string {
  const m = SQL.match(/VALUES\s*\(([\s\S]*?)\)\s*\n\s*RETURNING/);
  if (m?.[1] === undefined) throw new Error('切不出 VALUES 那一段 ⇒ 這支的形狀變了, 先看它再改測試');
  return stripComments(m[1]);
}

describe('🔬 正對照:讀到的真的是那支板', () => {
  it('抓得到那支函式與 INSERT', () => {
    expect(SQL).toContain('CREATE FUNCTION public.admin_home_banner_duplicate');
    expect(SQL).toContain('INSERT INTO public.home_banners');
    expect(SQL.length).toBeGreaterThan(2000);
  });
});

describe('🔴 來歷要跟著內容走(R1 MF1;Sean 2026-09-16「甲 = 要」)', () => {
  it('欄位清單裡有 source_email_id 與 matched_variant_ids', () => {
    const cols = columnList();
    expect(cols).toContain('source_email_id');
    expect(cols).toContain('matched_variant_ids');
  });

  it('🔴 而 VALUES 那一側要送【來源那列的值】, 不是 NULL / 空陣列', () => {
    // 📌 這一格才是 MF1 本身:欄位列出來而值送 NULL, 閘一樣會失效
    const vals = valuesBlock();
    expect(vals, 'source_email_id 要帶來源的值').toContain('v_src.source_email_id');
    expect(vals, 'matched_variant_ids 要帶來源的值').toContain('v_src.matched_variant_ids');
  });
});

describe('🔴 而這幾欄【一定不能】被帶過去', () => {
  it('published_by / published_at / archived_by / archived_at 不在欄位清單裡', () => {
    const cols = columnList();
    for (const c of ['published_by', 'published_at', 'archived_by', 'archived_at', 'status']) {
      // 📌 那是一次批准的簽名 —— 複製過去等於偽造一個沒發生過的批准
      expect(cols, `${c} 不可以出現在 INSERT 的欄位清單裡`).not.toContain(c);
    }
  });

  it('🔴 rights_confirmed 送的是 false, 不是來源那列的值', () => {
    const vals = valuesBlock();
    expect(vals, '那是一次人的確認, 不是一個屬性').not.toContain('v_src.rights_confirmed');
    expect(vals).toMatch(/\bfalse\b/);
  });

  it('starts_at / ends_at 不帶來源的值(舊檔期已經開始甚至過了)', () => {
    const vals = valuesBlock();
    expect(vals).not.toContain('v_src.starts_at');
    expect(vals).not.toContain('v_src.ends_at');
  });
});
