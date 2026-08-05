import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * service-role-only 營運資料**不得滲入 storefront**(M-4b E10 A9g-3 立;涵蓋 A9a-1/A9a-2/A9g-1/A9g-2)。
 *
 * 🔴 為什麼要**掃全樹**而不是只斷言那個常數:既有守門只比對
 * `SupabaseOrderAdapter.ts` 的 `ORDER_LIST_SELECT` 一條字串(關卡2 R2 codex 對 A9g-2 的 nit3 已點出)。
 * 但客人讀 orders 的路**不只那一條** —— 2026-08-05 實查 storefront 另有兩處 inline `.select()`
 * 直接打 orders(`apps/storefront/src/app/checkout/callback/page.tsx`、
 * `apps/storefront/src/app/api/orders/[orderId]/payment-status/route.ts`),
 * 它們不經過任何具名常數 ⇒ 只盯常數的守門對它們**完全隱形**。
 * ⇒ 本檔盯的是不變量本身:**storefront 的原始碼裡不得出現這些表名**。
 *
 * 🔴 為什麼盯**表名**而不是欄名:`actor` / `reason_code` 這類欄名在一般程式碼裡會誤命中
 * (守門噪音會讓人把它關掉)。而這些欄**只能**經由下列表取得 ⇒ 盯表名既精準又夠強。
 *
 * 🔴 **只掃程式碼行、跳過純註解行**:實跑第一版時命中
 * `apps/storefront/src/lib/cron/rate-limit.ts` —— 那裡是註解拿 `payment_charge_attempts.next_settle_at`
 * 當**設計範例**引用,不是查詢。守門若對註解開火,下一個人就會把它關掉,而不是修它。
 * ⇒ 跳過「以 `//` 開頭的行」;真的洩漏一定寫在程式碼行上,不會出現在那種行。
 *   (原本連 `*` 開頭也跳,關卡2 R2 收窄成只跳 `//` —— 見下方 filter 的理由。)
 *
 * ⚠️ **這道守門攔不住什麼**:
 * - 🔴 **`packages/` 裡的投影常數**(A9d2-2b / Fable 關卡2 F1 補記):本檔的掃描根寫死
 *   `apps/storefront/src/`,而客人真正吃到的 `ORDER_LIST_SELECT` 住在 `packages/adapters` ——
 *   **在掃描根之外**。那一面由 `SupabaseOrderAdapter.test.ts` 的反射式 token 守門負責
 *   (採購 / 三軸 / 扣款 / 取消歷程各一條)。**別把本檔當成那一面的防線。**
 * - 動態組出來的表名(字串拼接)。
 * - 經由 admin 端 API 把資料轉手送到 storefront 的路徑(那是另一個面,不是投影層)。
 * - 表名以外的洩漏(例如把 admin 讀模型整包 serialize 進客人頁面)。
 * - 🔴 **字串混淆**:`from("\\u006frder_cancellations")` 這種用跳脫序列拼出表名的寫法掃不到
 *   (關卡2 R2 提出,**評估後不追**,理由同 GRANT 守門那條:文字層蓋不完等價編碼,
 *   而刻意混淆表名的人已不在本檔的威脅模型內)。真要關掉得換層 —— 對 build 產物或
 *   runtime 查詢做檢查,不屬單元測試層。
 * - 寫在**行尾註解**裡的表名會被當成程式碼(偏保守、寧可誤紅不漏放)。
 * - 🔴 **storefront 呼叫 adapter 的 admin 方法**(R1 nit 9):`apps/storefront` 已 import
 *   `SupabaseOrderAdapter`(`src/lib/auth/composition.ts`),某條 route 若直接呼
 *   `findAdminOrderDetail()`,表名根本不會出現在 storefront 原始碼裡 ⇒ 本守門全綠。
 *   那一層靠的是 **runtime 42501**(storefront 注的是 authenticated client、對這些表零 grant)
 *   與 eslint 的 `/server` 邊界規則,不是本檔。**別把本檔當成那條路的防線。**
 */

/**
 * service-role-only 表:RLS enable + 零 policy + 只授 service_role。
 * 每一條都附建表檔出處,免得日後有人以為是隨手列的。
 */
const SERVICE_ROLE_ONLY_TABLES = [
  // 內部備註(含內部留言)—— `20260729030000:17-19` 明文「一個 byte 都不能放 orders」
  'order_notes',
  // 採購真相(供應商 / 單號 / 異常原因)—— `20260729020000:16-18`,洩漏 = 客人可繞過 PCM
  'order_item_procurement',
  // 三軸數量衍生快取 —— 客人看得到「已向上游訂了幾件」= 看得到採購節奏
  'order_item_quantity_summary',
  // 扣款嘗試(帶 rec_trade_id / fallback_token_hash)—— `20260612150000:115-121`
  'payment_charge_attempts',
  // 取消歷程 + 明細(帶 actor=staff id、idempotency_key、payload_hash)—— `20260730130000:200-203`、`:265-268`
  'order_cancellations',
  'order_cancellation_items',
] as const;

/**
 * 🔴 **欄名層(A9d2-2b 加)**:`idempotency_key` 從「內部機制、不投影」改判成後台投影欄
 * (`A-203-STOP` ③ 主視窗裁示 A;`AdminOrderCancellation.idempotencyKey`)——
 * **它進得了後台,不代表進得了 storefront**。上面的表名層擋得住「storefront 直接查那張表」,
 * 擋不住「有人把後台讀模型的這顆欄手抄/轉手進客人頁面」(型別上它現在是合法的 domain 欄)。
 * ⇒ 這一層盯**欄名字面本身**,snake 與 camel 兩種形狀都盯(mapper 兩邊都出現過)。
 *
 * ⚠️ **本層的誤報天花板**(本檔上面那段「盯表名不盯欄名」的理由仍然成立,這是**刻意的例外**):
 * 下面三個字面在 storefront 裡今天都是 **0 命中**(2026-08-05 實查),所以不會製造噪音。
 * 🔴 但若日後 storefront 真的需要**自己的**冪等鍵(例如結帳重送防護 —— 現行走的是
 * `cart_session_id`、不叫這個名字),正解是**把那顆改名或把本層收窄到取消歷程的形狀**,
 * **不是刪掉本層**:刪掉等於把 A9g 那條路重新打開。
 */
const CANCELLATION_INTERNAL_COLUMNS = [
  'idempotency_key',
  'idempotencyKey',
  // 同表另一顆內部欄,連後台都不投影 ⇒ 出現在 storefront 只可能是抄錯或轉手。
  'payload_hash',
] as const;

const STOREFRONT_SRC = fileURLToPath(new URL('../apps/storefront/src/', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    // 🔴 副檔名要含 JS 家族(關卡2 must-fix):原本只掃 `.ts/.tsx`,
    //    但 Next.js 照樣吃 `.js/.jsx/.mjs/.cjs` ⇒ 一支 `route.js` 直接查那些表就完全隱形
    //    (codex 探針實測 scanned=false)。
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry) ? [full] : [];
  });
}

describe('storefront 投影洩漏守門(service-role-only 表)', () => {
  const files = walk(STOREFRONT_SRC).map((path) => ({
    path: path.slice(STOREFRONT_SRC.length),
    source: readFileSync(path, 'utf8')
      .split('\n')
      // 🔴 **只剝 `//` 開頭的行**(R1 nit 8 收窄):原本連 `*` 開頭也剝,
      //    會把 template literal 裡跨行 SQL 的 `  * from order_cancellations` 整行當註解刪掉
      //    ⇒ 真的寫了 raw SQL 的洩漏反而隱形。實測會誤命中的那一筆是 `//` 註解,剝這個就夠。
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n'),
  }));

  it('前提:真的掃到 storefront 原始碼(否則本檔是恆真的空守門)', () => {
    expect(files.length).toBeGreaterThan(50);
    // 釘住那兩處 inline select 確實在掃描範圍內 —— 它們正是本檔存在的理由。
    const paths = files.map((f) => f.path);
    expect(paths).toContain(join('app', 'checkout', 'callback', 'page.tsx'));
    expect(paths).toContain(join('app', 'api', 'orders', '[orderId]', 'payment-status', 'route.ts'));
  });

  for (const table of SERVICE_ROLE_ONLY_TABLES) {
    it(`🔴 storefront 原始碼不得出現 ${table}`, () => {
      const offenders = files.filter((f) => f.source.includes(table)).map((f) => f.path);
      expect(offenders, `${table} 出現在 storefront ⇒ 客人可能讀得到營運內部資料`).toEqual([]);
    });
  }

  for (const column of CANCELLATION_INTERNAL_COLUMNS) {
    it(`🔴 storefront 原始碼不得出現 ${column}(取消歷程的內部冪等欄)`, () => {
      const offenders = files.filter((f) => f.source.includes(column)).map((f) => f.path);
      expect(
        offenders,
        `${column} 出現在 storefront ⇒ 內部冪等機制走上了對客的路`,
      ).toEqual([]);
    });
  }
});
