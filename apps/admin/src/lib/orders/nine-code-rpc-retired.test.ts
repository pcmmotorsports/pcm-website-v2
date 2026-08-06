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
// 🔴 **掃描面為什麼是兩個根**(R1 must-fix 2;我第一版只掃 `apps/admin/src` = 畫錯面):
//   被拆掉的 `updateAdminOrderItemWorkflow` 實作本來就住在 `packages/adapters/src/supabase/`,
//   而 `SupabaseOrderAdapter.ts:473` **至今仍在呼兄弟 RPC** `admin_update_order_workflow`。
//   ⇒ 「在它隔壁把 item 版加回去」是**慣例作法、不是刻意規避**,只掃 admin 抓不到。
//   守門要畫在「不變量成立的面」(應用層全體),不是「我剛好看到實例的那個檔」。
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

/** 應用層可能發起 RPC 呼叫的兩個面:admin app 與共用 adapter。 */
const ADMIN_SRC = path.join(REPO_ROOT, 'apps', 'admin', 'src');
const ADAPTERS_SRC = path.join(REPO_ROOT, 'packages', 'adapters', 'src');
const SCAN_ROOTS = [ADMIN_SRC, ADAPTERS_SRC];

/** 九碼 item writer 的 DB 端 RPC 名(wire 字面;A9v 撤 EXECUTE 前它仍存在於正式站)。 */
const RETIRED_RPC = 'admin_update_order_item_workflow';

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
  return src.replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.(m|c)?[jt]sx?$/.test(rel))
    .map((rel) => path.join(root, rel))
    .filter((abs) => !EXEMPT.has(abs));
}

describe('P3 九碼退場 — 應用層停寫守門', () => {
  it(`🔴 admin 與 adapters 零呼叫 ${RETIRED_RPC}(A9w4a/A9w4c 拆除後不得重新接回)`, () => {
    // 🔴 前提斷言(R1 must-fix 1 + R2 nit 1):沒有這兩行,掃描根一漂就會掃到 0 個檔
    //    ⇒ `offenders` 恆為 `[]` ⇒ 綠燈但零判別力。
    //    🔴 **逐根各斷言一次,不是斷言合計** —— R2 實測:只留 admin 根仍有 207 檔 > 100 ⇒
    //    「有人把 ADAPTERS_SRC 從陣列刪掉」這個改法會被合計門檻放行,而那正是 must-fix 2 修的東西。
    //    門檻遠低於實測值(admin 207 / adapters 78),不會因正常增減檔案而誤觸。
    expect(sourceFiles(ADMIN_SRC).length).toBeGreaterThan(100);
    expect(sourceFiles(ADAPTERS_SRC).length).toBeGreaterThan(30);

    const files = SCAN_ROOTS.flatMap(sourceFiles);

    const offenders = files
      .filter((abs) => stripLineComments(readFileSync(abs, 'utf8')).includes(RETIRED_RPC))
      .map((abs) => path.relative(REPO_ROOT, abs));

    // 列出檔名而不是只斷言數量:回歸時直接看到是誰接回去的。
    expect(offenders).toEqual([]);
  });
});
