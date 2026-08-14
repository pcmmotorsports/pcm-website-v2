import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// 受測檔頂層 `import 'server-only'`(它是 server-only 模組,這是對的)⇒ 測試裡要 stub 掉,
// 否則整支載入即炸(同 `app/customers/page.test.tsx:10` 紀律)。
vi.mock('server-only', () => ({}));

import {
  resolveListingState,
  resolvePrice,
  type AdminProductRow,
} from './product-repository';

// M-4b #20 片1a 的守門。plan = docs/specs/2026-08-14-products-admin-slice1a-plan.md 驗收 4 / 5。
//
// 🔴 這兩格釘的是「B 案(Q-B1 覆寫層)落地時只要改兩處」這句話。plan §3 逐字:
//    「沒有那條測試的話,『只改兩處』就只是我說說而已」——本檔就是兌現那句。

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const REPO_FILE = path.join(REPO_ROOT, 'apps/admin/src/lib/products/product-repository.ts');
const TABLE_FILE = path.join(
  REPO_ROOT,
  'apps/admin/src/components/products/products-table.tsx',
);

/**
 * 🔴 **消費面掃整個目錄樹,不硬寫檔名**(code-reviewer MF5)。
 * plan §3 釘的命題是「B 案只要改兩處」= repo 級全稱句;第一版硬寫兩個檔路徑
 * ⇒ 片1b 的 `app/products/[id]/page.tsx` 一落地就**靜默擴大缺口、沒有一格會紅**。
 */
const CONSUMER_ROOTS = [
  path.join(REPO_ROOT, 'apps/admin/src/app/products'),
  path.join(REPO_ROOT, 'apps/admin/src/components/products'),
];

function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.includes('.test.'))
    // `parentPath`(Node 20.12+)是現行型別上唯一存在的那個;舊的 `e.path` 已從型別移除
    // ⇒ 寫 `e.parentPath ?? e.path` 會 TS2339(第一版踩到、typecheck 抓出來)。
    .map((e) => path.join(e.parentPath, e.name));
}

/**
 * 剝註解 —— 形狀沿用 `lib/orders/nine-code-rpc-retired.test.ts:76-88`。
 *
 * 🔴 **本檔非剝不可**:`products-table.tsx` 的註解裡逐字寫著「不得直接讀 `row.price_general`」,
 *    不剝的話這格會**被自己的註解命中** = 假紅(memory `feedback_assertion-measures-the-wrong-thing`
 *    的「偵測字串自命中」)。
 * 只剝「行首 `//`」與「行首 `*` 且後接空白或 `/`」,不剝整個 `/* … *\/` 區塊(後者會吃掉真程式碼)。
 */
function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*[\s/].*$/gm, '');
}

describe('#20 片1a — 讀取層守門', () => {
  it('🔴 驗收 4:select 逐欄指名,且零經銷價 / 成本欄', () => {
    const src = readFileSync(REPO_FILE, 'utf8');
    // 前提斷言:檔真的讀到了。少了這條,路徑一漂就掃到空字串 ⇒ 下面全部恆綠。
    expect(src.length > 500).toBe(true);
    const code = stripComments(src);
    expect(code.includes('PRODUCT_LIST_COLUMNS')).toBe(true);

    // 🔴 **釘的是傳進 select() 的「值」,不是 `.select('*')` 這個呼叫字面**(code-reviewer MF2)。
    //    第一版只禁呼叫字面 ⇒ 把 PRODUCT_LIST_COLUMNS 改成 `'*'` 照樣全綠 = 恆綠格。
    //    實測:reviewer 把該常數改成 `'*' as const` 後,舊版五條斷言全過。
    expect(code).toContain("'id, title, external_id, price_general, delisted_at'");
    expect(code.includes(".select('*')")).toBe(false);
    expect(code.includes('select("*")')).toBe(false);
    for (const forbidden of ['price_store', 'price_by_tier', 'cost', 'supplier_slug']) {
      expect({ [forbidden]: code.includes(forbidden) }).toEqual({ [forbidden]: false });
    }
  });

  it('🔴 驗收 5:頁面與表格零次直讀 price_general / delisted_at(B 案只改兩處的機制擔保)', () => {
    const files = CONSUMER_ROOTS.flatMap(sourceFiles);
    // 🔴 前提斷言:掃描根一漂就會掃到 0 個檔 ⇒ 下面的迴圈恆綠。逐根各斷言一次。
    for (const root of CONSUMER_ROOTS) {
      const rel = path.relative(REPO_ROOT, root);
      expect({ [rel]: sourceFiles(root).length >= 1 }).toEqual({ [rel]: true });
    }
    expect(files.length >= 2).toBe(true);

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // 🔴 前提斷言逐檔各一次(不是斷言合計):只斷言合計的話,「其中一個檔被換成空檔」
      //    仍會通過,而那正是這格要擋的事。
      const rel = path.relative(REPO_ROOT, file);
      expect({ [rel]: src.length > 500 }).toEqual({ [rel]: true });

      const code = stripComments(src);
      for (const raw of ['price_general', 'delisted_at']) {
        expect({ [`${rel}:${raw}`]: code.includes(raw) }).toEqual({
          [`${rel}:${raw}`]: false,
        });
      }
    }

    // 🔴 **反面對照只釘在表格上,而且要說清楚為什麼不釘頁面。**
    //    第一版我對兩個檔都要求「必須用到那兩支具名函式」,**跑起來紅了** ——
    //    `page.tsx` 根本不顯示售價/狀態(那是 `ProductsTable` 的職責)⇒ 它對那兩欄的禁令
    //    **今天是空的(vacuous)**:沒有東西會讓它紅。我把這件事寫出來而不是把斷言放寬到假裝有效:
    //    · 對 `products-table.tsx`:禁令有判別力,反面對照證明它不是「因為根本沒顯示」才綠。
    //    · 對 `page.tsx`:禁令是**預防性**的 —— 哪天有人把售價搬到頁面層直讀,它才會紅。
    const tableCode = stripComments(readFileSync(TABLE_FILE, 'utf8'));
    expect(tableCode.includes('resolvePrice')).toBe(true);
    expect(tableCode.includes('resolveListingState')).toBe(true);
  });

  it('前提斷言:剝註解本身有效(用合成字串驗,不拿 production 註解當供應者)', () => {
    expect(stripComments('// price_general\nconst a = 1;')).not.toContain('price_general');
    expect(stripComments(' * delisted_at\nconst b = 2;')).not.toContain('delisted_at');
    // 🔴 反面:真程式碼不得被剝掉,否則上面兩格會變成「什麼都掃不到」的假綠。
    expect(stripComments('const c = row.price_general;')).toContain('price_general');
  });
});

describe('#20 片1a — 取值落點的行為', () => {
  const base: AdminProductRow = {
    id: 'p1',
    title: '測試商品',
    external_id: 'RPM-001',
    price_general: 1200,
    delisted_at: null,
  };

  it('resolvePrice 回售價;無價回 null(不編一個假的 0)', () => {
    expect(resolvePrice(base)).toBe(1200);
    expect(resolvePrice({ ...base, price_general: null })).toBeNull();
    // 0 是合法售價,不得被當成「沒價」。
    expect(resolvePrice({ ...base, price_general: 0 })).toBe(0);
  });

  it('resolveListingState:delisted_at 為 null = 上架中,有值 = 已下架', () => {
    expect(resolveListingState(base)).toBe('listed');
    expect(resolveListingState({ ...base, delisted_at: '2026-08-01T00:00:00Z' })).toBe(
      'delisted',
    );
  });
});
