import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalogPageText } from './catalog-page-title';

const GENERIC_TITLE = '商品目錄 — PCM重機零件販售';

describe('buildCatalogPageText', () => {
  it('🔴 單一分類 ⇒ 標題就是那個分類,不再是通用的「商品目錄」', () => {
    const { title, description } = buildCatalogPageText(['排氣系統'], false, false);
    expect(title).toBe('排氣系統 — PCM重機零件販售');
    expect(description).toContain('排氣系統');
  });

  it('🔴 ?filter=new ⇒ 「最新上架」;?sort=new 不是新品(它只換排序)', () => {
    expect(buildCatalogPageText([], false, true).title).toBe('最新上架 — PCM重機零件販售');
    expect(buildCatalogPageText([], false, false).title).toBe(GENERIC_TITLE);
  });

  // 🛑 有車款時 h1 印的是車名, 而本檔拿不到車名(不多打一次 taxonomy)⇒ 退回通用。
  //    給「最新上架」會與畫面互相矛盾, 而一個矛盾的標題比一個通用的標題糟。
  it('🔴 有車款 ⇒ 退回通用標題(不會與畫面上的車名互相矛盾)', () => {
    expect(buildCatalogPageText([], true, true).title).toBe(GENERIC_TITLE);
  });

  it('🔵 分類優先於新品(與 h1 的順序同一套)', () => {
    expect(buildCatalogPageText(['排氣系統'], false, true).title).toBe('排氣系統 — PCM重機零件販售');
  });

  it('🔵 兩顆以上分類 ⇒ 通用(「A + B」要叫什麼沒有答案)', () => {
    expect(buildCatalogPageText(['全段排氣管', '尾段排氣管'], false, false).title).toBe(GENERIC_TITLE);
  });

  // ── 第 1.5 片補遺:分頁標題 ────────────────────────────────────────────
  it('🔴 第 1 頁不得出現任何頁碼字樣(/products 與 ?page=1 是同一頁)', () => {
    expect(buildCatalogPageText([], false, false, 1).title).toBe(GENERIC_TITLE);
    expect(buildCatalogPageText([], false, false).title).toBe(GENERIC_TITLE);
    expect(buildCatalogPageText(['排氣系統'], false, false, 1).title).not.toContain('頁');
  });

  it('🔵 第 2 頁起帶頁碼;分類頁與新品頁同理', () => {
    expect(buildCatalogPageText([], false, false, 2).title).toBe('商品目錄（第 2 頁） — PCM重機零件販售');
    expect(buildCatalogPageText(['排氣系統'], false, false, 3).title).toBe(
      '排氣系統（第 3 頁） — PCM重機零件販售',
    );
    expect(buildCatalogPageText([], false, true, 2).title).toBe('最新上架（第 2 頁） — PCM重機零件販售');
  });

  it('🔵 description 不帶頁碼(描述講的是這一頁在賣什麼,不因翻到第幾頁而改變)', () => {
    expect(buildCatalogPageText(['排氣系統'], false, false, 4).description).toBe(
      buildCatalogPageText(['排氣系統'], false, false, 1).description,
    );
  });

  // 🔴 這一條守的是「同一件事兩種說法」:`'最新上架'` 是從 ProductsPageHeader 抄來的,
  //    那支哪天改字而這裡沒跟上, 畫面與 <title> 就會各說各話。**只讀那支、不改那支。**
  it('🔴 「最新上架」與 ProductsPageHeader 的 h1 字面一致', () => {
    const header = readFileSync(
      join(__dirname, '..', 'components', 'ProductsPageHeader.tsx'),
      'utf8',
    );
    expect(header).toContain("'最新上架'");
    expect(buildCatalogPageText([], false, true).title).toContain('最新上架');
  });
});
