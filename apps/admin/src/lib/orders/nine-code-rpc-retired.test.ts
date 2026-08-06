import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

// nine-code-rpc-retired.test.ts — P3 九碼退場的「應用層停寫」守門(M-4b E10;A9w4c 後半收尾同片補)。
//
// 背景:A9w4a 拆了 `updateOrderItemWorkflowAction`、A9w4c 拆了 port/adapter 的
// `updateAdminOrderItemWorkflow`。拆完之後,**全樹再也沒有任何斷言釘住「不准重新接回去」** ——
// 而 RPC `admin_update_order_item_workflow` 在 A9v 撤權前仍活著、`database.types.ts` 的型別也還在
// ⇒ 有人重新接線,typecheck 不會紅、既有測試不會攔(A9w4c 後半 code-reviewer 指出的守門殘缺)。
//
// 🔴 **掃描面為什麼不只一個根**(R1 must-fix 2;我第一版只掃 `apps/admin/src` = 畫錯面):
//   被拆掉的 `updateAdminOrderItemWorkflow` 實作本來就住在 `packages/adapters/src/supabase/`,
//   而 `SupabaseOrderAdapter.ts` **至今仍在呼兄弟 RPC** `admin_update_order_workflow`。
//   ⇒ 「在它隔壁把 item 版加回去」是**慣例作法、不是刻意規避**,只掃 admin 抓不到。
//   守門要畫在「不變量成立的面」(應用層全體),不是「我剛好看到實例的那個檔」。
//   🔴 **A9v 再擴到六根**:plan 與 migration 都宣稱「`apps/` + `packages/` 零 consumer」,
//   而守門只掃兩根 = 字面 > 事實。現掃 admin / adapters / storefront / use-cases / ports / domain。
//   (`apps/api` 與 `apps/sync-engine` 實查為零 `.ts` 空殼;`packages/schemas` 7 檔、`packages/ui` 3 檔
//    皆與訂單 RPC 無關 —— 這是刻意的取捨,寫下來免得下一個人以為「全掃」。)
//
// 🔴 這一條擋得住什麼,講清楚(memory `feedback_control-named-beyond-its-actual-power`):
//   擋的是**無意的回歸** —— 複製舊 action、在既有 adapter 隔壁補一支、順手 `.rpc(...)`。
//   擋不住刻意規避:字串拼接、computed property、把呼叫藏進本檔沒掃的 package。
//   **真正的停寫是 A9v 的 `REVOKE EXECUTE`**;本檔只是它上線前的空窗守門。
//
// 🔴 剝行註解的理由:退場紀錄本身就會提到這個 RPC 名字(本檔、`order-repository.ts`、
//   domain types 的退場註解都是)。註解裡的字面**不可能發起呼叫**,不剝就會把文件寫成違規。

/** repo 根(本檔位於 `apps/admin/src/lib/orders/` ⇒ 上跳五層)。 */
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

/**
 * 應用層可能出現這些字面的全部面。
 * 🔴 **A9v 擴大**(關卡2 codex nit 2):原本只掃 admin + adapters,而 plan 與 migration 都宣稱
 *    「`apps/` + `packages/` 零 consumer」⇒ **字面 > 事實**(誰在 storefront / use-cases /
 *    ports / domain 放回去都不會紅)。六個根全掃,讓宣稱與守門對齊。
 */
const ADMIN_SRC = path.join(REPO_ROOT, 'apps', 'admin', 'src');
const ADAPTERS_SRC = path.join(REPO_ROOT, 'packages', 'adapters', 'src');
const SCAN_ROOTS = [
  ADMIN_SRC,
  ADAPTERS_SRC,
  path.join(REPO_ROOT, 'apps', 'storefront', 'src'),
  path.join(REPO_ROOT, 'packages', 'use-cases', 'src'),
  path.join(REPO_ROOT, 'packages', 'ports', 'src'),
  path.join(REPO_ROOT, 'packages', 'domain', 'src'),
];

/**
 * 九碼退場後**不得再出現在應用層**的 DB 端字面。
 * - `admin_update_order_item_workflow`:item 支 writer RPC(A9w4a/A9w4c 拆掉呼叫端,
 *   **A9v `20260807120000` 撤掉 service_role 的 EXECUTE**)。
 * - `order_status_options`:九碼的狀態詞彙表(A9w2 下架篩選軸、A11a-1 下架列表讀取鏈,
 *   **A9v 撤掉 service_role 的 INSERT 與五個欄級 UPDATE;SELECT 刻意保留**)。
 *   🔴 **這一顆是 A9v 順手補的**:撤權前它零引用是事實,但**沒有任何守門** ——
 *   誰重新接回去都不會有格紅,「撤權」與「不再引用」之間會留一個沒人看的縫。
 */
const RETIRED_WIRE_LITERALS = ['admin_update_order_item_workflow', 'order_status_options'] as const;

/**
 * 豁免兩支,各有理由(**不用「排除所有 `*.test.*`」** —— 那樣的話,把呼叫寫進一支取名
 * `foo.test.ts` 的檔再從 production 檔 import,就整個消失在掃描外)。
 * - 本檔:斷言字面本身就是那個 RPC 名。
 * - `database.types.ts`:supabase 生成檔,那裡的 `admin_update_order_item_workflow` 是
 *   **「DB 端還有這支」的事實紀錄**、不是呼叫端;它要等 A9v DROP/REVOKE 後重 gen 才會消失。
 */
const EXEMPT = new Set([__filename, path.join(ADAPTERS_SRC, 'supabase', 'database.types.ts')]);

/**
 * 只剝**整行** `//` 註解(錨在行首)。
 * 刻意不剝 `/* *\/` 區塊:字串裡合法出現的 `"/*"` 會讓那種 regex 把中間的真程式碼一起吃掉
 * (同 `lib/payment/composition-tappay-wiring.test.ts` 的既有結論,不重犯)。
 */
function stripLineComments(src: string): string {
  return (
    src
      .replace(/^\s*\/\/.*$/gm, '')
      // 🔴 A9v 加:**doc-comment 的續行**(行首是 `*`)也剝掉。
      //    `packages/domain/src/order/types.ts:260` 在 `/** */` 裡寫著 `soft-ref order_status_options.code`
      //    —— 那是型別說明、不是呼叫,不剝的話擴大掃描面之後會**假紅**。
      //    刻意只剝「行首 `*`」而非整個 `/* … *\/` 區塊:後者遇到字串裡合法出現的 `"/*"`
      //    會把中間的真程式碼一起吃掉(檔頭既有結論),逐行剝沒有那個風險。
      //    🔴 `*` 後面**必須接空白或 `/`**(階段 C N3):不加這個限制的話,generator 方法
      //    `*items() {}` / `*[Symbol.iterator]()` 這種**真程式碼**會被誤剝 ⇒ 藏在裡面的字面看不見(假綠)。
      .replace(/^\s*\*[\s/].*$/gm, '')
  );
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.(m|c)?[jt]sx?$/.test(rel))
    .map((rel) => path.join(root, rel))
    .filter((abs) => !EXEMPT.has(abs));
}

describe('P3 九碼退場 — 應用層停寫守門', () => {
  it('🔴 六個原始碼根零引用九碼 DB 字面(A9w4a/A9w4c/A11a-1 拆除、A9v 撤權後不得重新接回)', () => {
    // 🔴 前提斷言(R1 must-fix 1 + R2 nit 1):沒有這些前提斷言,掃描根一漂就會掃到 0 個檔
    //    ⇒ `offenders` 恆為 `[]` ⇒ 綠燈但零判別力。
    //    🔴 **逐根各斷言一次,不是斷言合計** —— R2 實測:只留 admin 根仍有 207 檔 > 100 ⇒
    //    「有人把 ADAPTERS_SRC 從陣列刪掉」這個改法會被合計門檻放行,而那正是 must-fix 2 修的東西。
    //    門檻遠低於實測值(admin 207 / adapters 78),不會因正常增減檔案而誤觸。
    //    🔴 **A9v:六根各一條、不是只保 admin/adapters 兩條** —— 我擴大掃描面時原本只留舊的兩條,
    //       那等於新加的四根「被從陣列刪掉」也不會紅,正是 R2 當初修掉的同一個洞。
    //       門檻遠低於實測(admin 209 / adapters 79 / storefront 449 / use-cases 49 / ports 21 / domain 39)。
    const MIN_FILES: ReadonlyArray<readonly [string, number]> = [
      [ADMIN_SRC, 100],
      [ADAPTERS_SRC, 30],
      [path.join(REPO_ROOT, 'apps', 'storefront', 'src'), 200],
      [path.join(REPO_ROOT, 'packages', 'use-cases', 'src'), 20],
      [path.join(REPO_ROOT, 'packages', 'ports', 'src'), 10],
      [path.join(REPO_ROOT, 'packages', 'domain', 'src'), 15],
    ];
    // 🔴 逐一比對**路徑本身**,不只比長度(階段 C N1):只比長度的話,「把 storefront 換成
    //    第二個 ADMIN_SRC」長度仍是 6、而前提是拿 MIN_FILES 自己的路徑去數 ⇒ 照樣全綠,
    //    但 storefront 已經不在掃描面上。比路徑才擋得住「換一根」。
    expect(MIN_FILES.map(([root]) => root)).toEqual(SCAN_ROOTS);
    for (const [root, min] of MIN_FILES) {
      expect({ [path.relative(REPO_ROOT, root)]: sourceFiles(root).length > min }).toEqual({
        [path.relative(REPO_ROOT, root)]: true,
      });
    }

    const files = SCAN_ROOTS.flatMap(sourceFiles);
    const sources = files.map((abs) => [abs, stripLineComments(readFileSync(abs, 'utf8'))] as const);

    // 🔴 前提斷言:剝註解真的有作用。用**合成字串**驗、不拿 production 註解當供應者
    //    (拿它當供應者的話,哪天那些「撤權歸 A9v」的註解被清掉,這道前提就變假紅)。
    expect(stripLineComments("const a = 1;\n  // order_status_options\n")).not.toContain(
      'order_status_options',
    );
    expect(stripLineComments("/**\n   * soft-ref order_status_options.code\n   */\n")).not.toContain(
      'order_status_options',
    );
    // 🔴 負向前提:generator 方法**不得**被誤剝(否則藏在裡面的字面會看不見)
    expect(stripLineComments("  *items() { rpc('order_status_options'); }\n")).toContain(
      'order_status_options',
    );

    // 逐字面各報各的:回歸時直接看到是「哪一顆」被接回去、由誰接的。
    for (const literal of RETIRED_WIRE_LITERALS) {
      const offenders = sources
        .filter(([, src]) => src.includes(literal))
        .map(([abs]) => path.relative(REPO_ROOT, abs));
      // ⚠️ 誠實界(關卡2 codex nit 4):本守門擋的是**無意的回歸**。
      //    `'order_' + 'status_options'` 這種拼接字面繞得過去 —— 它不是語意級分析。
      //    真正的停寫由 A9v 的 DB 撤權承重,這裡只是「別再接回來」的早期訊號。
      expect({ [literal]: offenders }).toEqual({ [literal]: [] });
    }
  });
});
