import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { stripComments } from '../test-support/strip-comments';

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
const DETAIL_FILE = path.join(
  REPO_ROOT,
  'apps/admin/src/components/products/product-detail.tsx',
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

/**
 * 🔴 **讀取層也要遞迴掃,不能只掃 `REPO_FILE` 一支**(code-reviewer R1 MF3)。
 *
 * 這是 MF5 那個病的**第三個作用域**,三次的位置各不相同,列出來免得下次又只修被指名那處:
 *   · 片1a MF5 —— 消費面的**掃描範圍**(硬寫兩個檔名 → 遞迴)
 *   · 片1b-1 主視窗 MUST-FIX —— 消費面的**掃描字集**(只有設計約束 → 補經銷價)
 *   · 本條 R1 MF3 —— **讀取層的掃描範圍**(只掃 `REPO_FILE` 一支)
 * 具體缺口:片1b-2 只要新增第二支 `lib/products/*.ts`(例如媒體 repository)去撈
 * `price_store` 或 `metadata`,**兩道守門都零命中、沒有一格會紅。**
 *
 * ⚠️ **這道只掃 `LEAK_TOKENS + REPO_ONLY_TOKENS`,不掃 `DESIGN_TOKENS`** ——
 *    讀取層本來就該出現 `price_general` / `delisted_at`(那是它的職責),掃了會恆紅。
 *
 * ⚠️ **已知上限**:這三個根之外的新目錄(例如有人開 `components/product-media/`)仍不在掃描內。
 *    沒有機制保證「未來所有商品相關目錄都被涵蓋」——**這句是限制不是保證**,寫出來不假裝已解決。
 */
const REPO_ROOTS = [path.join(REPO_ROOT, 'apps/admin/src/lib/products')];

function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.includes('.test.'))
    // `parentPath`(Node 20.12+)是現行型別上唯一存在的那個;舊的 `e.path` 已從型別移除
    // ⇒ 寫 `e.parentPath ?? e.path` 會 TS2339(第一版踩到、typecheck 抓出來)。
    .map((e) => path.join(e.parentPath, e.name));
}

/**
 * 🔴 **禁字兩組,用途不同,不要混成一組看**(片1b-1 折主視窗 MUST-FIX):
 *
 * · `DESIGN_TOKENS` —— 釘「B 案只改兩處」那條**設計約束**:消費面不得繞過 `resolvePrice` /
 *   `resolveListingState` 直讀 DB 欄。
 * · `LEAK_TOKENS` —— 釘**經銷價不得外洩**。
 *
 * 🔴 **片1a 的缺口就在這裡**:遞迴掃消費面那道(驗收 5)當時**只掃 `DESIGN_TOKENS`**,
 *    `LEAK_TOKENS` 只在「單掃 repository 一支檔」那道(驗收 4)⇒ **詳情頁印經銷價,沒有一格會紅。**
 *    片1a MF5 修的是**掃描範圍**,這次補的是**掃描字集** —— 同一個病的另一個作用域
 *    (memory `feedback_claim-scope-exceeds-fact-three-shapes`「細緻度被誤讀成覆蓋度」)。
 *    落地前實測過:在 `products-table.tsx` 塞一行 `price_store`,補字集前 **11/11 全綠**。
 */
const DESIGN_TOKENS = ['price_general', 'delisted_at'] as const;
const LEAK_TOKENS = ['price_store', 'price_by_tier', 'cost'] as const;

/**
 * 🔴 **`metadata` 只釘在 repository、不進消費面遞迴掃**,理由要寫清楚:
 * Next.js 頁面本來就有 `export const metadata` 這個官方 API ⇒ 把裸 token `metadata`
 * 加進消費面掃描,會在**完全正當**的寫法上誤報。而它真正的外洩入口是 `select` 欄位清單:
 * 只要 `metadata` 進不了 row 型別,消費面寫 `product.metadata` 就是 **TS2339**、typecheck 會擋
 * ⇒ 那一層已經有人守,不需要在這裡用一個會誤報的字面重守一次。
 */
const REPO_ONLY_TOKENS = ['metadata'] as const;

/**
 * 🔴 **改用共用版剝註解**(片1a nit N3,片1b-1 折):`lib/test-support/strip-comments.ts:13`。
 *
 * 這不是整理,是**修一個真漏洞**:片1a 自己寫的那版只剝行首 `//` 與行首 `*`、
 * **不剝 `/* … *\/` 區塊** ⇒ 把違規那行用區塊註解包起來就能繞過整組守門。
 * 共用版連區塊一起剝,而且用 `(?<!:)` 避免 `https://` 被當行註解截斷。
 *
 * 為什麼非剝不可:`products-table.tsx` / `product-detail.tsx` 的註解裡逐字寫著
 * 「不得直接讀 `row.price_general`」,不剝的話這格會**被自己的註解命中** = 假紅
 * (memory `feedback_assertion-measures-the-wrong-thing` 的「偵測字串自命中」)。
 */

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
    // 片1b-1 新增的詳情欄位清單,同樣釘值不釘呼叫字面。
    expect(code).toContain('supplier_slug, handle, brand_id, category_id');
    expect(code.includes(".select('*')")).toBe(false);
    expect(code.includes('select("*")')).toBe(false);
    // 🔴 `supplier_slug` 已從禁字移出(nit N2:唯一鍵是複合鍵 ⇒ 料號非全域唯一,詳情頁必顯供應商)。
    for (const forbidden of [...LEAK_TOKENS, ...REPO_ONLY_TOKENS]) {
      expect({ [forbidden]: code.includes(forbidden) }).toEqual({ [forbidden]: false });
    }
  });

  it('🔴 驗收 4b(R1 MF3):`lib/products` 整個目錄樹都不得出現經銷價 / metadata', () => {
    const files = REPO_ROOTS.flatMap(sourceFiles);
    // 🔴 前提斷言逐根一次:掃描根一漂就 0 個檔 ⇒ 下面整個迴圈恆綠。
    for (const root of REPO_ROOTS) {
      const rel = path.relative(REPO_ROOT, root);
      expect({ [rel]: sourceFiles(root).length >= 1 }).toEqual({ [rel]: true });
    }

    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      const src = readFileSync(file, 'utf8');
      expect({ [rel]: src.length > 200 }).toEqual({ [rel]: true });

      const code = stripComments(src);
      // 🔴 **不掃 DESIGN_TOKENS** —— 讀取層本來就該有 `price_general`/`delisted_at`,掃了恆紅。
      for (const raw of [...LEAK_TOKENS, ...REPO_ONLY_TOKENS]) {
        expect({ [`${rel}:${raw}`]: code.includes(raw) }).toEqual({
          [`${rel}:${raw}`]: false,
        });
      }
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
      // 🔴 兩組一起掃(片1b-1 折 MUST-FIX):設計約束 + 經銷價外洩。
      //    片1a 這裡只有 DESIGN_TOKENS ⇒ 消費面印經銷價零告警。
      for (const raw of [...DESIGN_TOKENS, ...LEAK_TOKENS]) {
        expect({ [`${rel}:${raw}`]: code.includes(raw) }).toEqual({
          [`${rel}:${raw}`]: false,
        });
      }

      // 🔴 **消費面不得自己開 service client 直接查 DB**(code-reviewer R1 N-a)。
      //    補的是 `metadata` 偏離留下的殘缺口:我的論證靠「`metadata` 進不了 row 型別 ⇒ TS2339」,
      //    但那只擋得住「透過 repository 拿資料」。消費面若自己
      //    `createSupabaseServiceClient().from('products').select('metadata')`
      //    ⇒ **完全不經 row 型別、TS2339 那層失效**,而遞迴掃的字集又刻意不含 `metadata`。
      //    釘這個字面比釘裸 token `metadata` 更準且**零誤報**(Next 的 `export const metadata` 不受影響),
      //    順帶把「消費面只能經 repository 取數」這條分層約束也變成機制。
      expect({ [`${rel}:createSupabaseServiceClient`]: code.includes('createSupabaseServiceClient') }).toEqual({
        [`${rel}:createSupabaseServiceClient`]: false,
      });
    }

    // 🔴 **反面對照只釘在表格上,而且要說清楚為什麼不釘頁面。**
    //    第一版我對兩個檔都要求「必須用到那兩支具名函式」,**跑起來紅了** ——
    //    `page.tsx` 根本不顯示售價/狀態(那是 `ProductsTable` 的職責)⇒ 它對那兩欄的禁令
    //    **今天是空的(vacuous)**:沒有東西會讓它紅。我把這件事寫出來而不是把斷言放寬到假裝有效:
    //    · 對 `products-table.tsx`:禁令有判別力,反面對照證明它不是「因為根本沒顯示」才綠。
    //    · 對 `page.tsx`:禁令是**預防性**的 —— 哪天有人把售價搬到頁面層直讀,它才會紅。
    //    · 片1b-1 起 `product-detail.tsx` 也顯示售價與上架狀態 ⇒ **它也進反面對照**,
    //      否則「詳情頁把售價改成直讀」這件事一樣沒有一格會紅。
    for (const file of [TABLE_FILE, DETAIL_FILE]) {
      const rel = path.relative(REPO_ROOT, file);
      const code = stripComments(readFileSync(file, 'utf8'));
      expect({ [`${rel}:resolvePrice`]: code.includes('resolvePrice') }).toEqual({
        [`${rel}:resolvePrice`]: true,
      });
      expect({
        [`${rel}:resolveListingState`]: code.includes('resolveListingState'),
      }).toEqual({ [`${rel}:resolveListingState`]: true });
    }
  });

  it('前提斷言:剝註解本身有效(用合成字串驗,不拿 production 註解當供應者)', () => {
    expect(stripComments('// price_general\nconst a = 1;')).not.toContain('price_general');
    // 🔴 **這一格是換共用版之後才成立的**:整個 `/* … */` 區塊要被剝掉。
    //    片1a 自己那版只剝行首 `*`,區塊的頭尾留著 ⇒ 把違規那行包進區塊註解就能繞過守門。
    expect(stripComments('/**\n * delisted_at\n */\nconst b = 2;')).not.toContain(
      'delisted_at',
    );
    // 🔴 反面:`https://` 的雙斜線**不得**被當成行註解 —— 被截斷的話那一行後面的內容
    //    會整段從掃描結果消失(= 假綠)。共用版的 `(?<!:)` 就是在擋這個。
    expect(stripComments("const u = 'https://x/price_store';")).toContain('price_store');
    // 🔴 反面:真程式碼不得被剝掉,否則上面兩格會變成「什麼都掃不到」的假綠。
    expect(stripComments('const c = row.price_general;')).toContain('price_general');

    // 🔴 **共用版的兩個已知上限,釘成事實而不是寫成註解**(code-reviewer R1 N-g)。
    //    兩者都是「剝過頭 ⇒ 該掃到的字消失 ⇒ 假綠」,不是漏剝。**不改實作**
    //    (共用版對片1a 版仍是嚴格變強),但要有人記得它們存在 —— 哪天真被踩到,
    //    這兩格會逼下一個人來讀這段,而不是讓他重新發現一次。
    //    ① protocol-relative URL(`//cdn/...`)被當行註解,整行後半消失:
    expect(stripComments("const u = '//cdn/x/price_store';")).not.toContain('price_store');
    //    ② 字串裡有 `/*`、後面某處又有 `*/` ⇒ 中間的真程式碼被整段吃掉:
    expect(stripComments("const a = '/*'; const b = row.price_store; const c = '*/';")).not.toContain(
      'price_store',
    );
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
