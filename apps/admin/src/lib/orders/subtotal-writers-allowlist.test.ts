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
 *
 * 🔴 codex 對抗審查 MF-4(2026-08-21 折入):
 *   ①大小寫敏感 ⇒ 小寫 SQL 零命中仍綠 ⇒ 加 `i` flag。
 *   ②只認 `public.orders` 不認加引號的 `public."orders"` ⇒ 欄名/表名都容許可選雙引號。
 *   ③原本裸 `SET` 後只看 200 字元 ⇒ 較長的欄位清單會漏檢。**改法不是單純放寬視窗**——
 *     試過放寬到 2000 字元後,`ON DELETE SET NULL`/`SET search_path` 這類無關的 `SET` 會
 *     跨到幾百行外一個 CHECK 約束裡的 `line_total = unit_price * quantity`,造成假陽性
 *     (2026-08-21 實測:`20260604120000` 被誤抓)。⇒ 改成錨定在**真正的 `UPDATE ... SET`**,
 *     裸 `SET`(DEFAULT/DELETE/search_path/NOT NULL 那些)不再算數,視窗維持適中(500)。
 */
const WRITER_RE =
  /UPDATE\s+(?:public\.)?"?\w+"?\s+SET[\s\S]{0,500}?"?(subtotal|line_total)"?\s*=|INSERT\s+INTO\s+public\."?(orders|order_items)"?\b/i;

/**
 * 🔴 codex 對抗審查 MF-7(2026-08-21 折入):剝註解的技巧抄自
 * `apps/storefront/src/lib/auth/login-next-guard.test.ts` 的 `stripComments`(逐字元、看引號),
 * 語法換成 SQL 版本 —— 不重寫技巧,只換掉要剝的註解記號:
 * `--` 行註解 / `/* *\/` 區塊註解 / 單引號字串(`''` 為跳脫,不是關閉)。
 * 不處理 `$$`/`$tag$` 美元字串邊界本身 —— 那些邊界內的 SQL 字面就是我們要掃的目標,不需要特殊處理。
 */
function stripSqlComments(src: string): string {
  let out = '';
  let inSingle = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inSingle) {
      out += c;
      if (c === "'") {
        if (src[i + 1] === "'") {
          out += src[i + 1];
          i += 1;
          continue;
        }
        inSingle = false;
      }
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

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
  // 🔴 `20260725120000` 已移出(2026-08-21,codex MF-4/MF-7 折入時發現):它從沒真的寫過
  //    subtotal/line_total/order_id 三欄——原本命中的原因是 :13 一句**註解**裡原文引用了
  //    另一支檔的 `INSERT INTO public.orders` 字面(舊 WRITER_RE 不剝註解,連註解都算命中)。
  //    本檔實際唯一的 UPDATE 是 `SET shipping_method_at_checkout = shipping_method`,不在
  //    三欄之列。剝註解 + 錨定真正的 `UPDATE ... SET` 後不再命中,是修對而不是漏登記。
  '20260730120100_m4b_e10_n3b_create_order_new_display_id.sql',
  '20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql',
  // 🔴 `#518`(2026-08-16 登錄):它是**同一支函式的 CREATE OR REPLACE**,函式本體逐行照抄
  //    前一支的 325-484、只在七處 RAISE 加 `DETAIL`。⇒ 寫那三欄的**路徑沒有變多**,
  //    只是同一條路徑在 repo 裡多了一份新版本的字面。
  //    ⚠️ 本格是「有沒有新寫入者出現而沒人登記」的提醒,不是自動放行 —— 我開檔看過才登。
  '20260816040000_m4b_e10_13_518_p2c13_detail.sql',
  // 🔴 `20260820020000`(2026-08-21 登錄):probe-only INSERT(片A8a3-G世界一/世界二的
  //    fixture),跑在savepoint內、必回滾,不是持久寫入者;subtotal/shipping_fee/
  //    discount_total/total皆寫死常數,不受外部輸入影響;另有本檔下方第三個it斷言這支
  //    migration的INSERT欄位值不是變數/運算式,把檔案級登記交出去的判別力換回一部分。
  //    🔴 已知限制(W3 2026-08-20指出):allowlist粒度是檔案不是語句——若這支migration在
  //    commit前被再編輯、加入與fixture無關的orders寫入,本守門看不到。migration
  //    forward-only慣例下commit後不會再被編輯,但commit前(現在到commit之間)這個窗口
  //    是真實存在的,不是已消除的風險。
  //    📌 backlog #801(2026-08-21 主視窗開,codex 對抗審查 MF-5 折入):同一個限制的正式條目。
  '20260820020000_m4b_e10_a8a3g_cancel_guard_sibling_dedup.sql',
  // 🔴🔴 `#858`(2026-08-24 登錄,線C):**這一筆與上面每一筆都不同族。**
  //    上面十一支是「`create_order` 的歷代重新定義」+「改既有單金額的 RPC」+「probe fixture」。
  //    這一支是 `admin_create_manual_order` —— **第二條【建單】路徑**,後台手動幫客人開單用的。
  //    ⇒ 本檔上面那句「`create_order` 是金額欄**有史以來唯一的寫入者**」**從今天起不再成立**。
  //      (那句留著沒改,因為它記的是 2026-08-15 實跑當下的事實;這一格就是它的失效點。)
  //
  //    **為什麼這個寫入者是安全的**(我開檔看過才登,不是因為它紅了才登):
  //      · 金額**全部由 server 自算**:`line_total = unit_price * qty`、`subtotal = Σ line_total`、
  //        `total = subtotal + shipping_fee` —— **不收 client 送來的任何合計欄**。
  //      · 逐筆驗 `qty > 0`、`unit_price >= 0`,並有筆數(50)與單筆數量(9999)上限。
  //      · 跨列去重:同 variant(或代購品的同料號+同品名)送兩列 ⇒ 拒絕,
  //        擋掉「一次手滑把 subtotal 與可退金額變兩倍」。
  //      · 冪等格比對**內容指紋**:同一顆 `manual_request_id` 裝不同內容 ⇒ 拒絕,不覆蓋、不回舊單。
  //    🔴 **已知限制與 `#801` 同一格**:本 allowlist 的粒度是**檔案**不是語句 ——
  //      這支 migration 在 commit 前若被再編輯、加進與建單無關的 orders 寫入,本守門看不到。
  '20260824020000_m4b_858_admin_create_manual_order.sql',
] as const;

function scanWriters(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => WRITER_RE.test(stripSqlComments(readFileSync(join(dir, f), 'utf8'))))
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

  it('🔴 020000 兩段 INSERT INTO orders 的金額欄位值都是寫死整數字面(不是變數/運算式)', () => {
    // 🔴 codex 對抗審查 MF-7(2026-08-21 折入):先剝註解再比對,不然被保留的舊 INSERT
    // 註解字面 + 一段正規式看不到的新寫法,四個命中可能全是註解、整格照樣綠。
    const sql = stripSqlComments(
      readFileSync(
        join(MIGRATIONS_DIR, '20260820020000_m4b_e10_a8a3g_cancel_guard_sibling_dedup.sql'),
        'utf8',
      ),
    );

    // 🔴 非貪婪吃到「) 後面接 VALUES」那個組合,不受欄位清單/VALUES 中途出現的 ) 影響。
    const INSERT_RE =
      /INSERT INTO public\.orders\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:RETURNING|;)/g;

    // 深度感知逗號分割(VALUES 裡的 jsonb_build_object(...) 內部逗號不能被切開)。
    function splitTopLevel(s: string): string[] {
      const parts: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of s) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
          parts.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      parts.push(cur.trim());
      return parts;
    }

    const MONEY_COLS = new Set(['subtotal', 'shipping_fee', 'discount_total', 'total']);
    const matches = [...sql.matchAll(INSERT_RE)];
    // 正向對照(量具自檢,不是 allowlist 計數):4 = 兩個世界 × 每個世界一組 v_a/v_b。
    // 世界一(:102 起)的 fixture 在自己的 savepoint 裡就回滾掉了 ⇒ 世界二(:474 起)
    // 必須重造一組,不能沿用世界一那組——這是結構上必須,不是重複。
    // 這一格紅了代表「造單的段數變了」:去看是不是有人加了世界三、或有人把某個世界拿掉了;
    // 不是「量具壞了就把期望值改成實得值」——拿掉這道自檢,量具切壞成 0 命中時下面的迴圈
    // 一圈都不跑、整格照樣綠,那就是恆真守門。
    expect(matches.length).toBe(4);

    for (const m of matches) {
      const colsRaw = m[1];
      const valsRaw = m[2];
      // 正規式的兩個捕獲群組在 noUncheckedIndexedAccess 下型別是 string | undefined
      // ——這裡明確失敗而不是用 !/as 壓過去:拿不到捕獲群組本身就是正規式沒切對。
      if (colsRaw === undefined || valsRaw === undefined) {
        throw new Error('INSERT_RE 沒有捕獲到欄位清單或 VALUES 清單,正規式沒切對');
      }
      const cols = splitTopLevel(colsRaw).map((c) => c.trim());
      const vals = splitTopLevel(valsRaw).map((v) => v.trim());
      expect(cols.length).toBe(vals.length); // 對照組:兩邊長度對不上代表正規式切錯了
      cols.forEach((col, i) => {
        // 🔴 codex 對抗審查 MF-6(2026-08-21 折入):欄名比對前先剝掉可能的雙引號、轉小寫
        // ——否則 `SUBTOTAL` 或加引號的 `"subtotal"` 不會命中 MONEY_COLS,對應值改成變數/
        // 運算式也會被這個迴圈靜默跳過,而那正是這條斷言要擋的事。
        const normalized = col.replace(/^"|"$/g, '').toLowerCase();
        if (!MONEY_COLS.has(normalized)) return;
        const val = vals[i];
        // 上面已斷言 cols.length === vals.length,這裡拿到 undefined 代表正規式切錯了
        // ——寫成明確失敗而不是型別斷言(!/as),因為這支測試存在的理由就是「切錯了要有人知道」。
        if (val === undefined) {
          throw new Error(`${col} 在索引 ${i} 沒有對應的 VALUES(cols/vals 長度已知相等,拿不到值代表正規式切錯了)`);
        }
        expect(val, `${col} 的值「${val}」不是寫死整數字面`).toMatch(/^\d+$/);
      });
    }
  });
});
