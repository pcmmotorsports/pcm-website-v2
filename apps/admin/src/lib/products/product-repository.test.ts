import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from '../test-support/strip-comments';
import { buildProductKeywordOrFilter } from './product-repository';

// 受測檔頂層 `import 'server-only'`(它是 server-only 模組,這是對的)⇒ 測試裡要 stub 掉,
// 否則整支載入即炸(同 `app/customers/page.test.tsx:10` 紀律)。
vi.mock('server-only', () => ({}));

/**
 * 🔴 記錄實際送出的 PostgREST 條件。**加這支的理由是突變測試打臉**:
 * 我原本只在 `page.test.tsx` 驗「頁面把 setBy 傳給 repository」——
 * **把 repository 裡的 `.eq('listing_set_by', …)` 整行刪掉,那些測試全部照樣綠。**
 * ⇒ 「有沒有把參數傳下去」與「參數有沒有變成查詢條件」是兩件事,只驗前者等於沒驗。
 */
const q = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('@pcm/adapters/server', () => {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'range', 'is', 'not', 'in', 'maybeSingle']) {
    builder[m] = (...args: unknown[]) => {
      q.calls.push([m, ...args]);
      return builder;
    };
  }
  (builder as { then: unknown }).then = (f: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(f);
  return { createSupabaseServiceClient: () => ({ from: () => builder }) };
});

import {
  listProductsForAdmin,
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
 * 🔴 **本段原本有一句假的「構造不出來」,已作廢,原句留著當反例**(R3 F1):
 *    原句 = 「沒有機制保證『未來所有商品相關目錄都被涵蓋』—— 這句是限制不是保證」。
 *    **那是假的。** 機制存在(掃全樹)、成本是一次目錄走訪、實測零誤報 ——
 *    我當時沒去量就寫「沒有機制」,而它讀起來像誠實申報。
 *    memory `feedback_false-unconstructible-claim-is-worse-than-false-verified` 逐字:
 *    **假的「構造不出來」比假的「已驗證」更毒 —— 它披謙虛外衣把工作從 plan 裡拿掉。**
 *    我甚至在同一段裡**自己舉了 `components/product-media/` 當例子**,還是沒去做。
 *
 * ⇒ **經銷價那三個 token 現在掃全樹**(見下方「外洩守門」那格),枚舉問題只剩下面兩個窄用途:
 *    `REPO_ROOTS` 只負責 `metadata`(它不能掃全樹 —— Next 頁面有官方的 `export const metadata`)。
 */
const REPO_ROOTS = [path.join(REPO_ROOT, 'apps/admin/src/lib/products')];

/** 🔴 F1 的掃描根:整個 admin src。非測試 `.ts`/`.tsx` 全收。 */
const ADMIN_SRC_ROOT = path.join(REPO_ROOT, 'apps/admin/src');

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

/**
 * 🔴 **經銷價字集。掃 `apps/admin/src` 全樹,不是枚舉目錄**(code-reviewer R3 F1)。
 *
 * ⚠️ **R3 找的是病根,不是第四個症狀。** 前三輪(片1a MF5 / 主視窗 MUST-FIX / R1 MF3)
 * 都是同一類病:**守的命題是 repo 級全稱句(「經銷價不出現在任何消費面」),
 * 守門的宇宙卻是逐片手工枚舉的目錄清單** ⇒ 每開一片就要有人記得擴清單,忘了就是靜默缺口。
 * 補第四個枚舉項只會讓第五片再踩一次;**改成全樹,病類整個消失。**
 *
 * 落地依據(**量過的,不是推的**;數法附在下面 `leakMatcher` 的註解):
 * 全樹非測試檔 **196 支**,三個 token 的原始命中共 **4 行,全部在註解裡**
 * (`orders-table.tsx:513` JSX 註解 / `product-repository.ts:20,47,133`)
 * ⇒ 剝註解後 code 層**零命中、零誤報**。
 *
 * 🔴 **三個 token 不同級:`cost` 不是欄,是 `metadata` 這個 jsonb 裡的一個 key。**
 * 這道守門讀起來像「守三個欄」,實際是「守**兩個欄** + **一個 jsonb key**」。實查:
 * `products` 表**沒有 `cost` 欄**(數法 `grep -rnE "^\s+cost\s+|ADD COLUMN cost" supabase/migrations/`
 * ⇒ 零命中);它出現在 `20260602135934:80-82`(**products** 的洗值 —— `:84-86` 是
 * `product_variants` 的、不是這張表)與 `:88-90`
 * (`CHECK (NOT (metadata ?| array[…'cost'…]))` ⇒ **DB 端已禁止它回到 metadata**)。
 * ⇒ 守它的形狀是**字串 `'cost'` 與 `metadata.cost` 取值**,不是 select 欄名。
 *
 * ⇒ 這也解釋了為什麼 `cost` 與 `REPO_ONLY_TOKENS` 的 `metadata` **守備範圍天然重疊** ——
 *   **那是縱深不是重工**。寫出來,免得下一個人來把其中一個「收斂」掉。
 */
const LEAK_TOKENS = ['price_store', 'price_by_tier', 'cost'] as const;

/**
 * 🔴 **`cost` 用字界比對,其餘用子字串**(R3 n2 —— 與 F1 是同一個動作的兩半)。
 *
 * 理由:`price_store` / `price_by_tier` 是夠獨特的全名;但裸子字串 `cost` 在**全樹**尺度下
 * 會咬到 `shippingCost` / `costOfGoods` 這種完全正當的識別字。
 * **今天全樹零命中**(量過)⇒ 現在不改就沒事,但**加寬的那一刻**它就會誤紅
 * ⇒ 兩件事必須同一次做完。`\b` 兩側:`_` 與大小寫字母都是 word char
 * ⇒ `cost_price` / `shippingCost` 都**不會**命中,`row.cost` / `'cost'` 會。
 */
function leakMatcher(token: string): RegExp {
  return token === 'cost' ? /\bcost\b/ : new RegExp(token);
}

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
    // 🔴 片2c 加兩欄。**逐字釘住整串**(不是只檢查「有沒有 price_store」)——
    //    釘整串的價值是:任何人加欄都會撞紅,被迫回來想一次「這欄該不該給後台看」。
    expect(code).toContain(
      "'id, title, external_id, price_general, delisted_at, listing_set_by, source_missing_at'",
    );
    // 片1b-1 新增的詳情欄位清單,同樣釘值不釘呼叫字面。
    expect(code).toContain('supplier_slug, handle, brand_id, category_id');
    expect(code.includes(".select('*')")).toBe(false);
    expect(code.includes('select("*")')).toBe(false);
    // 🔴 `supplier_slug` 已從禁字移出(nit N2:唯一鍵是複合鍵 ⇒ 料號非全域唯一,詳情頁必顯供應商)。
    for (const forbidden of [...LEAK_TOKENS, ...REPO_ONLY_TOKENS]) {
      expect({ [forbidden]: code.includes(forbidden) }).toEqual({ [forbidden]: false });
    }
  });

  it('🔴🔴 R3 F1:經銷價三個 token 在 `apps/admin/src` **全樹** code 層零命中', () => {
    const files = sourceFiles(ADMIN_SRC_ROOT);

    // 🔴 前提斷言 ①:真的掃到一整棵樹,不是空陣列(空陣列 ⇒ 下面整格恆綠)。
    //    數法:`find apps/admin/src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' | wc -l`
    //    ⇒ 落筆當下 196 支。這裡用寬鬆下界,不釘死數字(釘死等於每加一支檔就要改測試)。
    expect({ 全樹檔數至少100: files.length >= 100 }).toEqual({ 全樹檔數至少100: true });

    // 🔴 前提斷言 ②:掃描範圍**真的涵蓋本片以外的目錄** —— 只掃到 products 樹的話,
    //    這格跟舊的枚舉版沒有差別,F1 等於沒折。
    const rels = files.map((f) => path.relative(REPO_ROOT, f));
    expect(rels.some((r) => r.includes('/orders/'))).toBe(true);
    expect(rels.some((r) => r.includes('/customers/'))).toBe(true);

    const hits: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const token of LEAK_TOKENS) {
        if (leakMatcher(token).test(code)) {
          hits.push(`${path.relative(REPO_ROOT, file)}:${token}`);
        }
      }
    }
    // 🔴 印出**命中清單**而不是只印數字 —— 數字對不上時要能一眼看到是哪一行
    //    (「`grep -c` 的數字要能指出第幾行」那條)。
    expect(hits).toEqual([]);
  });

  it('前提斷言:F1 那格的偵測器真的會吐東西(拿合成字串驗,不靠 production 檔)', () => {
    // 🔴 沒有這格,「全樹零命中」與「偵測器根本沒在偵測」長得一模一樣。
    expect(leakMatcher('price_store').test('const a = row.price_store;')).toBe(true);
    expect(leakMatcher('price_by_tier').test("select('price_by_tier')")).toBe(true);
    expect(leakMatcher('cost').test('const c = row.cost;')).toBe(true);
    // 🔴 n2 的反面:字界比對**不得**咬到正當識別字,否則 F1 加寬那刻就誤紅。
    expect(leakMatcher('cost').test('const s = shippingCost;')).toBe(false);
    expect(leakMatcher('cost').test('const p = cost_price;')).toBe(false);
  });

  it('🔴 驗收 4b(R1 MF3):`lib/products` 目錄樹不得出現 metadata(經銷價已由 F1 全樹接手)', () => {
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
      // 🔴 **也不再掃 LEAK_TOKENS** —— R3 F1 之後那三個由全樹那格接手,這裡重複掃只是雜訊。
      for (const raw of [...REPO_ONLY_TOKENS]) {
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
      // 🔴 這裡只剩 **設計約束**(`resolvePrice`/`resolveListingState` 是唯一取值落點)。
      //    經銷價外洩那三個 token **已由 R3 F1 的全樹那格接手** —— 同一件事不守兩次,
      //    否則哪天兩邊字集漂開,沒有人知道該信哪一份。
      for (const raw of [...DESIGN_TOKENS]) {
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

    // 🔴 **正向對照(R2 nit-d)**:上面那條是「零命中」型斷言 ⇒ `@pcm/adapters/server` 哪天把
    //    `createSupabaseServiceClient` 改名,禁令會**靜默變恆綠**(掃一個沒人再用的字面)。
    //    這條證明那個字面此刻**真的是取數的入口**、掃的是活的東西。
    const repoCode = stripComments(readFileSync(REPO_FILE, 'utf8'));
    expect(repoCode.includes('createSupabaseServiceClient')).toBe(true);

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

  });

  // 🔴 **共用版的兩個已知上限。這是「特徵測試」不是「規格」**(R1 N-g 提出,R2 nit-f 修正形狀)。
  //
  // ⚠️ R2 nit-f 指出我上一版把它們寫成一般斷言的問題:那是**修好就會紅**的格子 ——
  //    有人哪天把 `strip-comments.ts:13` 補完(例如讓 `(?<!:)` 也擋 `//cdn`),
  //    會看到紅並讀成「我造成回歸」。改用 `it.fails`:**行為修好時這格自己會紅**,
  //    而紅的訊息會把人帶到這段字,他就知道**該做的事是刪掉這格**、不是回退他的修好。
  it.fails('已知上限①:protocol-relative URL 被當行註解吃掉(修好了就刪這格)', () => {
    expect(stripComments("const u = '//cdn/x/price_store';")).toContain('price_store');
  });

  it.fails('已知上限②:字串內的 /* … */ 會把中間真程式碼吃掉(修好了就刪這格)', () => {
    expect(
      stripComments("const a = '/*'; const b = row.price_store; const c = '*/';"),
    ).toContain('price_store');
  });
});

describe('#20 片1a — 取值落點的行為', () => {
  const base: AdminProductRow = {
    id: 'p1',
    title: '測試商品',
    external_id: 'RPM-001',
    price_general: 1200,
    delisted_at: null,
    listing_set_by: 'sync',
    source_missing_at: null,
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

describe('🔴 #20 片2c:chip 篩選必須變成 DB 查詢條件', () => {
  beforeEach(() => {
    q.calls.length = 0;
  });

  it('setBy=staff → 送出 .eq("listing_set_by", "staff")', async () => {
    await listProductsForAdmin(20, 0, 'staff');
    expect(q.calls).toContainEqual(['eq', 'listing_set_by', 'staff']);
  });

  it('🔴 負向對照:不帶 setBy → **不得**出現該條件(否則等於永遠只看得到一種)', async () => {
    await listProductsForAdmin(20, 0);
    expect(q.calls.map((c) => c[1])).not.toContain('listing_set_by');
  });
});

// ─────────────── `#661`:搜尋詞 → PostgREST `.or()` 條件字串 ───────────────
//
// 🔴 **為什麼這一組直接測純函式而不是透過 mock client**:
//    它有**兩層跳脫**,而兩層的順序不能靠「看起來對」驗。
//    透過 mock 測會把「條件字串長什麼樣」藏在一堆呼叫紀錄裡,而那正是要被斷言的東西。
describe('#661 buildProductKeywordOrFilter', () => {
  it('一般詞:兩個欄位各一個 ilike,前後包 %', () => {
    expect(buildProductKeywordOrFilter('brembo')).toBe(
      'external_id.ilike."%brembo%",title.ilike."%brembo%"',
    );
  });

  it('中文詞照樣過(ilike 不經過 pg_trgm)', () => {
    expect(buildProductKeywordOrFilter('煞車皮')).toBe(
      'external_id.ilike."%煞車皮%",title.ilike."%煞車皮%"',
    );
  });

  /**
   * 🔴 把 PostgREST 的雙引號那一層【解回來】,拿到伺服器實際會餵給 ILIKE 的 pattern。
   *
   * **為什麼要有這支**:只斷言最終字串,等於在斷言「兩層跳脫疊起來長什麼樣」——
   * 那個字串很難用眼睛判對錯(反斜線數量會讓人數錯),而**數錯的方向通常是「看起來合理」**。
   * 解回來之後斷言的是**契約本身**:伺服器收到的 ILIKE pattern 是什麼。
   */
  function ilikePatternOf(orFilter: string): string {
    const m = /^external_id\.ilike\."(.*)",title\.ilike\."\1"$/.exec(orFilter);
    const captured = m?.[1];
    if (captured === undefined) {
      throw new Error(`條件字串形狀不符,兩欄不一致或格式變了:${orFilter}`);
    }
    // PostgREST 雙引號內:`\X` ⇒ `X`
    return captured.replace(/\\(.)/g, '$1');
  }

  it('🔴 ILIKE 萬用字元要跳脫 —— 否則員工搜尋 50% 會比對到「50 開頭的任何東西」', () => {
    // 解回 PostgREST 那層之後,伺服器餵給 ILIKE 的 pattern 應該是 `%50\%%`:
    // 頭尾兩個 `%` 是我們加的萬用字元,中間 `\%` 是**被跳脫的字面 %**。
    expect(ilikePatternOf(buildProductKeywordOrFilter('50%'))).toBe('%50\\%%');
    expect(ilikePatternOf(buildProductKeywordOrFilter('a_b'))).toBe('%a\\_b%');
    // 負向對照:沒跳脫的話 pattern 會是 `%50%%`(= 50 開頭的任何東西)。
    expect(ilikePatternOf(buildProductKeywordOrFilter('50%'))).not.toBe('%50%%');
  });

  it('🔴🔴 `*` 【刻意不跳脫】—— 它是萬用字元,而這是量到的行為不是疏漏', () => {
    // 2026-08-19 對正式庫實測(dev server 連正式站,SQL 跑在 Supabase 的 Linux Postgres):
    //   ?q=brembo ⇒ 35 件 ／ ?q=brembo* ⇒ 35 件 ／ ?q=bremb*o ⇒ 35 件
    // `bremb*o` 若是字面比對應該是 0 ⇒ PostgREST 把 `*` 當成 `%` 的別名,而且【穿透雙引號】。
    // 🔴 它在本層【表達不出來】:用反斜線跳脫會先被替換成 `\%` ⇒ 員工打 `*` 反而搜到字面的 `%`,更錯。
    // ⇒ 現行處置:接受它是萬用字元、寫進輸入框提示。
    // 🔴🔴 **本格釘住的是【我方的處置】,不是 PostgREST 的行為**(R2 must-fix):
    //   本格是單元測試,沒有碰 PostgREST ⇒ **它改掉別名時這一格照樣綠**。
    //   它真守得住的方向:有人把 `*` 加進跳脫字集、或 strip 掉它 ⇒ 紅(R2 兩發突變證過)。
    //   ⇒ **PostgREST 那一側要重跑 probe 才知道,不能等這一格通知。**
    expect(ilikePatternOf(buildProductKeywordOrFilter('bremb*o'))).toBe('%bremb*o%');
    // 對照:`%` 與 `_` 是【有】跳脫的,兩者處置不同不是隨手決定的。
    expect(ilikePatternOf(buildProductKeywordOrFilter('bremb%o'))).toBe('%bremb\\%o%');
  });

  it('🔴 一般詞不應該被加上任何跳脫(過度跳脫會讓它一個都找不到)', () => {
    expect(ilikePatternOf(buildProductKeywordOrFilter('brembo'))).toBe('%brembo%');
    expect(ilikePatternOf(buildProductKeywordOrFilter('煞車皮'))).toBe('%煞車皮%');
  });

  it('🔴🔴 PostgREST 保留字元要靠【雙引號】,不是反斜線 —— 否則 A,B 會被拆成兩個條件', () => {
    // 官方文件逐字:值含 , ( ) " \ 必須 PostgREST 風格雙引號包起來。
    const out = buildProductKeywordOrFilter('A,B');
    // 逗號仍在,而它在引號**內** ⇒ 不會被 .or() 當成條件分隔。
    expect(out).toBe('external_id.ilike."%A,B%",title.ilike."%A,B%"');
    // 🔴 負向對照:若實作改用反斜線跳脫逗號,上面那條會變成 "%A\,B%" ⇒ 這一格會紅。
    expect(out).not.toContain('A\\,B');
  });

  it('🔴 引號本身要在引號內被跳脫,否則它會提早關掉那個引號', () => {
    const out = buildProductKeywordOrFilter('12"');
    expect(out).toBe('external_id.ilike."%12\\"%",title.ilike."%12\\"%"');
  });

  it('🔴 順序:先 ILIKE 跳脫再引號內跳脫 —— 反斜線要被跳兩次', () => {
    // 使用者打一個反斜線 ⇒ ILIKE 層變成 \\ ⇒ 引號層再各跳一次 ⇒ \\\\
    const out = buildProductKeywordOrFilter('a\\b');
    expect(out).toBe('external_id.ilike."%a\\\\\\\\b%",title.ilike."%a\\\\\\\\b%"');
  });
});
