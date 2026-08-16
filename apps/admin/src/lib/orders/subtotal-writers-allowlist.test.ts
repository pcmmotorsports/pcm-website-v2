// subtotal-writers-allowlist.test.ts — L1 寫入者 allowlist 守門(M-4b E10 #13 片1c-1;母 plan §6a L1)。
//
// 🔴 **這一格守的是什麼**:片1a 掛了兩支 `DEFERRABLE INITIALLY DEFERRED` constraint trigger,
//    監看 `orders.subtotal` / `order_items.line_total` / `order_items.order_id` 三欄。
//    母 plan 對 L1 的要求逐字:「新增任何會寫這三欄的路徑(片 2 / 片 3 / 匯入工具)⇒ 該格紅」。
//    ⇒ 本格**不判對錯,只判「有沒有新的寫入者出現而沒人登記」**。紅了要人去看,不是自動放行。
//
// 🔴🔴 **它守不住什麼(必須寫在旁邊,否則下一個人會以為都涵蓋了)**:
//    ① **只掃 `supabase/migrations/*.sql`** —— 字集就是這樣,別的目錄一律看不到。
//    ② **是正規式,不是 SQL parser** —— 動態拼字串組出來的 `UPDATE` 掃不到。
//    ③ 🔴 **`supabase/migrations/` 是【歷史】不是【現況】** —— 檔在不代表那個物件還活著
//       (2026-08-15 片1a 的教訓:`20260725130100` 那支函式早被 `20260801120000` DROP 掉了)。
//       ⇒ 本清單能回答「repo 裡多了一個會寫那三欄的檔嗎」,**不能**回答「線上現在有幾個寫入者」。
//    ④ **應用層(TS)沒有掃** —— 依據是 repo 記載的 `orders` 對 service_role 已 REVOKE 直寫
//       (`20260611120000 §4`,由片1b 的 port docstring 引用)。**那是 repo 字面,不是我實查正式庫的 ACL。**
//       ⇒ 這一條是**假設**,不是量測;它若不成立,本格的涵蓋範圍就有一個洞。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations',
);

/**
 * 🔴 掃描字集寫死在這裡,不寫「掃過了」。
 * 兩種形狀:①`SET … subtotal|line_total =`(改) ②`INSERT INTO public.orders|order_items`(建)。
 * ⚠️ `order_id` 沒有單獨列 pattern —— 它只會出現在 `order_items` 的 INSERT/UPDATE 裡,
 *    而那兩種形狀上面都收了。單獨掃 `order_id` 會把每一支讀取用的 WHERE 都撈進來(誤報 > 判別力)。
 */
const WRITER_RE =
  /SET[\s\S]{0,200}?\b(subtotal|line_total)\b\s*=|INSERT INTO public\.(orders|order_items)\b/;

/**
 * 允許寫這三欄的 migration 檔(**登記制**)。
 *
 * 🔴 多一個沒登記的 ⇒ 本格紅 ⇒ **請人去判斷**:
 *    · 它是不是一個新的金額寫入者?是的話,片1a 那兩支 trigger 會在 COMMIT 時擋它 ——
 *      而你要確認的是「它知道自己會被擋」,不是「把它加進這張表就好」。
 *    · 🔴 **把不想處理的檔丟進這張表 = 自己把判別力關掉。** 審查時盯這裡。
 *      (同 `scripts/e13-slice1a-verify.sh` 的 cascade 那句,形狀一樣。)
 *
 * 現況(2026-08-15 實跑得到的清單):九支是 `create_order` 歷代重新定義 —— 它是金額欄
 * **有史以來唯一的寫入者**(母 plan §2 的實查結論);第十支是片1a 新加的改金額 RPC,
 * **也就是那個「讓原本『單一寫入者』前提消失」的第二個寫入者**。
 */
const ALLOWLIST = [
  '20260604130000_m3_s2b1_create_order_rpc.sql',
  '20260613130000_m3_3ds_0b_cart_session_dedup.sql',
  '20260614130000_m3_create_order_stock_snapshot.sql',
  '20260630120000_m3_241_checkout_consent.sql',
  '20260716190000_m4a_v3a_create_order_vehicle_whitelist.sql',
  '20260716200000_m4a_v3a_create_order_vehicle_type_guard.sql',
  '20260719120000_m4a_b2_create_order_notification_email.sql',
  '20260725120000_rf2a0_orders_freeze_shipping_rule.sql',
  '20260730120100_m4b_e10_n3b_create_order_new_display_id.sql',
  '20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql',
  // 🔴 `#518`(2026-08-16 登錄):它是**同一支函式的 CREATE OR REPLACE**,函式本體逐行照抄
  //    前一支的 325-484、只在七處 RAISE 加 `DETAIL`。⇒ 寫那三欄的**路徑沒有變多**,
  //    只是同一條路徑在 repo 裡多了一份新版本的字面。
  //    ⚠️ 本格是「有沒有新寫入者出現而沒人登記」的提醒,不是自動放行 —— 我開檔看過才登。
  '20260816040000_m4b_e10_13_518_p2c13_detail.sql',
] as const;

function scanWriters(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => WRITER_RE.test(readFileSync(join(dir, f), 'utf8')))
    .sort();
}

describe('L1 寫入者 allowlist — 那三欄多一個沒登記的寫入者就紅', () => {
  it('掃描本身是活的(分母非 0,且正向對照命中片1a 那支)', () => {
    // 🔴 先證量具有在讀東西 —— 「零命中」與「掃錯目錄」在畫面上一模一樣。
    const allSql = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(allSql.length).toBeGreaterThan(100);
    expect(scanWriters(MIGRATIONS_DIR)).toContain(
      '20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql',
    );
  });

  it('🔴 掃出來的寫入者恰好等於 allowlist(多一個沒登記的 ⇒ 這一格紅)', () => {
    expect(scanWriters(MIGRATIONS_DIR)).toEqual([...ALLOWLIST].sort());
  });

  it('pattern 有判別力:一支不寫那三欄的 migration 不該被撈進來', () => {
    // 負向對照:片1a 的 down 腳本只有 DROP,沒有任何寫入 ⇒ 必須不命中。
    const down = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../scripts/20260815040000-down.sql'),
      'utf8',
    );
    expect(WRITER_RE.test(down)).toBe(false);
    // 正向對照:一段最小的寫入敘述必須命中(證明上面那個 false 不是 pattern 壞掉)。
    expect(WRITER_RE.test('UPDATE public.orders SET subtotal = 1 WHERE id = x;')).toBe(true);
    expect(WRITER_RE.test('INSERT INTO public.order_items (order_id) VALUES (x);')).toBe(true);
  });
});
