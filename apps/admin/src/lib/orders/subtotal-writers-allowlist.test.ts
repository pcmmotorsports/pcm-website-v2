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
 *
 * 🔴 2026-08-29 折入(線F,CI 紅追因):單引號字串**原本只被追蹤、內容照樣輸出**
 *    ⇒ 掃描器看得到字串字面裡的字。實錘:`20260828100000`(B1 稅務片)被判成第 14 個寫入者,
 *    而它對 subtotal/line_total **一個寫入都沒有** —— 唯一命中是 `COMMENT ON COLUMN` 字串裡的
 *    一句中文散文,內容是「排除註解行之後 14 處具名 `INSERT INTO public.orders`」。
 *    📌 **一句在講「我很小心地排除了註解」的話,被一把【排除註解但不排除字串】的尺當成了 INSERT。**
 *    ⇒ 改法:字串內容以空白替換(換行保留,行號不漂),開閉引號留著避免左右 token 黏成一個字。
 *    ⚠️ **`$$`/`$tag$` 那一格刻意沒動** —— 動它的誤傷方向是**漏檢**,那是最壞的方向。
 *    ⚠️ 代價寫明:單引號一旦落單(奇數個),之後的真 SQL 會被當字串抹掉 ⇒ **漏檢**。
 *       本檔的驗收本身擋得住:抹掉任何一個真寫入者 ⇒ 清單掉到 12 ⇒ 本格紅。
 */
function stripSqlComments(src: string): string {
  let out = '';
  let inSingle = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inSingle) {
      if (c === "'") {
        if (src[i + 1] === "'") {
          i += 1;
          continue;
        }
        inSingle = false;
        out += c;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
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
  //
  //    🔴 2026-08-29 追記:上面那筆是**同一個 bug 的一半**。08-21 修掉的是「字面住在**註解**裡」,
  //       而「字面住在**單引號字串**裡」同族未查 ⇒ 08-29 由 `20260828100000` 原樣復發
  //       (成因與改法見 `stripSqlComments` 上方那段)。
  //    📌 **⇒ 一個 bug 被修好【一半】之後,那筆修復紀錄會讓下一個人以為整族都處理過了 ——**
  //       **因為紀錄寫的是「已修」,而不是「已修 A,而 B 同族未查」。**
  //    ⇒ 立此為例:修完一個誤報來源,記錄要寫出**這一族還有哪些載體沒查**,
  //       不然那筆紀錄的作用會從「留痕」變成「關掉下一個人的懷疑」。
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
  // 🔴🔴 `20260825130000`(2026-08-25 登錄,下手窗;**登記理由經 code-reviewer R1 推翻後重寫**):
  //    形式上是 `create_order` 的第八次 `CREATE OR REPLACE`(不是第三條建單路徑,實查為真)——
  //    🔴 **而「同族」不等於「無害」。這一支【放寬】了寫進那三欄的值域,不是收緊。**
  //
  //    **它放寬了什麼**(反例一個就夠,而它成立):
  //      · 前一版 `20260730120100` 的單價閘是 `v_unit_price <= 0 ⇒ RAISE`
  //        ⇒ 任何被接受的單,每列 `unit_price >= 1` ⇒ `line_total >= 1` ⇒ `subtotal >= 1`。
  //      · 本支 `:234` 改成 `v_unit_price < 0` ⇒ **0 放行** ⇒ `:244 v_line_total = 0`
  //        ⇒ `:248 v_subtotal += 0` ⇒ 原封寫進 `orders.subtotal` / `order_items.line_total`。
  //      · 反例:**單一 0 元贈品 + 運送方式 <> 'store'** ⇒ `:320` 運費 CASE 給 100
  //        ⇒ `v_total = 100 > 0` ⇒ **通過本支新加的 `:352` 那道閘** ⇒ 寫下 `subtotal = 0`。
  //        🔴 **這張單在前一版根本建不出來。**更寬的一族:任何「贈品 + 正價品」混車、任何運送方式。
  //      · DB 那側收不收:`20260604120000:101/:147/:148` 三條都是 `CHECK (… >= 0)`
  //        ⇒ **0 全部合法,沒有下游擋得回來。**
  //    ⚠️ 本支新加的 `IF v_total <= 0 THEN RAISE`(`:352`)**一格都沒有縮回去** ——
  //      前一版 `v_subtotal >= 1` 且運費 ∈ {0,100} ⇒ `v_total >= 1` ⇒ 那道閘對「前一版能通過的
  //      任何輸入」永遠不觸發。**它的觸發集 ⊆ 本次新開放的區域 ⇒ 淨效果純增、零減。**
  //    ⚠️ `:234` 的「負數仍拒」字面為真,**而它拒的是一個構造不出來的世界** ——
  //      `20260531142533:56` `CHECK (price_general IS NULL OR price_general >= 0)`,
  //      而 `:200/:207` 直接讀 base table ⇒ `v_unit_price < 0` 在資料上不可達。
  //
  //    **量到的**(範圍寫在數字旁邊,不要單獨引用數字):
  //      · 🔴 **增的 33 行裡零寫那三欄的語句** —— 全檔 `INSERT/UPDATE` 只有 `:367 orders`
  //        `:405 order_legal_consents`(不寫那三欄)`:412 order_items`,**零 `UPDATE`**。
  //        ⚠️ **這一項是【新增側】的斷言,必須與下面兩項並列** —— 只證「沒刪、INSERT 沒變」
  //        推不出「沒有新的寫入」:33 行新增裡若藏一句 `UPDATE orders SET subtotal`,
  //        下面兩項**照樣全綠**。**照抄這份清單當 diff 方法的人,會學到一把單向的尺。**
  //      · **函式本體** delta = **34 行**(刪 1 / 增 33)。抽法錨定 `$fn$;`
  //        (錨 `^$$;` 抓不到本體結尾——本體用 `$fn$`——會一路吃到檔尾驗收塊而量出 **145**:
  //        那 145 = 本體 34 + docstring 改寫 + 檔尾 `DO $$` 整段重寫)。
  //      · **那 1 行刪除**逐字是 `IF v_unit_price IS NULL OR v_unit_price <= 0 THEN`
  //        —— **整段 delta 裡唯一被刪掉的可執行碼,而它正是改變寫入值域的那一行。**
  //      · 兩段 INSERT 逐字元相同:`INSERT INTO public.orders …RETURNING` 段
  //        `sha1 8f9b1126fbda7e1a…`、`INSERT INTO public.order_items …END LOOP` 段
  //        `sha1 b259ac2991ad86aa…`(新舊兩側各自 `shasum`,reviewer 獨立重跑亦相同)。
  //
  //    🔴🔴 **這一格真正的限制(比 `#801` 那條嚴重得多,不要拿 `#801` 頂替)**:
  //      本守門**做到了它該做的事** —— 本支是一份**新檔**且內含 writer 語句 ⇒ 它紅了 ⇒
  //      **強制了這次人工複核**(而那次複核抓出第一版註解方向寫反)。**那個貢獻是真的,不要否定。**
  //      🔴 **它做不到的是【語意】**:`WRITER_RE` 比對的是**語句**,而本次改變寫入值域的方式
  //      是**在一個逐字元未變的 `INSERT` 上游放寬前置條件** —— 🔴 **上面那兩對 sha1 恰恰
  //      證明了語句沒變。**⇒ 它紅的理由是「**多了一支帶 writer 的檔**」,不是「值域變了」;
  //      **「變寬還是變窄」它一格都判不出來。**
  //      ⇒ 🔴🔴 **殘留的洞不只一側:任何【不含 writer 語句】的改動,本格皆零訊號。**
  //         已登記檔重編輯 / 新檔只做 `ALTER TABLE orders DROP CONSTRAINT`(拆掉
  //         `20260604120000` 那三條 `CHECK >= 0`)/ 新檔只 `CREATE OR REPLACE` 一支
  //         `create_order` 呼叫的 helper(定價、運費)—— **三種都零 writer 語句 ⇒ 永遠不必登記
  //         ⇒ 全綠,而寫進那三欄的值域照樣變。**檔頭限制 ①-④ 一條都沒涵蓋這型。
  //         🔴 **上一版只寫「洞在已登記檔那一側」—— 一個被精準命名的洞,讀起來像完整的洞清單。**
  //      📌 **給下一個做第九次 `CREATE OR REPLACE` 的人**:diff 的重點是
  //         **`INSERT` 上游的前置條件鏈與 `CHECK`**,不是 writer 語句本身。
  //      ⇒ 「**值域被放寬**」這件事 **100% 靠人在這段註解裡講** —— 而**第一版就講反了**
  //         (寫成「變嚴不是變寬」),由 code-reviewer R1 抓下;本段這句「結構上無效」的講法
  //         **也曾經太滿**,由 codex R2 抓下。**同一段話被兩輪各修正一次,而兩次落在同一條
  //         【座標軸】的兩端:把「人講的那部分」說得比實際更可靠、或更不可靠。**
  //    ⚠️ 上面每一組數字與 sha1 都是**量測結果、有時效**,重驗就重跑那幾發指令。
  '20260825130000_m4b_zero_price_checkout_and_cart_total_gate.sql',
  // 🔴 2026-08-29 登記(線A `-e9`;**不是為了讓紅變綠**)——
  //    它是 `admin_create_manual_order` 的 `CREATE OR REPLACE` 重定義,把 `20260824020000`
  //    那個函式體整段抽出再套兩處改動 ⇒ **建單的 INSERT 整個在裡面** ⇒ 它本來就是寫入者。
  //    命中點親自開檔核過(不是憑掃描結果):`:428` `INSERT INTO public.orders (`,
  //    而欄位表逐字含 `subtotal, shipping_fee, discount_total, total` ⇒ **真 INSERT,不在註解裡**。
  //    🔴 **登記前跑過一發壞形狀**:把 `20260604130000` 那一項從本 ALLOWLIST 拿掉 ⇒ 本格轉紅
  //    並同時報出兩個未登記者 ⇒ **這道守門此刻有判別力**,加這一行不是把它關掉。
  //    ⚠️ 突變刻意做在【本白名單】上,**不往 `supabase/migrations/` 丟檔** ——
  //       八窗共用一棵樹,那幾秒別的窗的 `git status` 會看到一支不是它的野檔
  //       (成因與實例見 `scripts/null-shortcircuit-check-guard.test.ts:41-46`)。
  '20260829140000_m4b_b2c_manual_order_explicit_tax_total.sql',
  // 🔴 `⟦b4-SPEC1⟧`(2026-08-31 登錄,線DB):`admin_create_manual_order` 的**第三代**,
  //    與上一行那支(gen2)是**同一支函式的 CREATE OR REPLACE** —— 寫那三欄的**路徑沒有變多**。
  //
  //    **這一片改的是「規格從哪裡來」,不是金額怎麼算**:
  //      舊 = 相信呼叫端送來的 `spec`;新 = 從 `public.product_variants.spec` 讀權威值。
  //
  //    ✅ **可機械複驗的線索**(注意:是線索,不是證明):
  //      量法(**路徑寫全,`gen2`/`gen3` 不是檔名**;codex R2 must-fix:兩個 grep 都讀不到檔時
  //      `diff` 會比兩份空輸出並回 0 ⇒ 那是一條假綠路徑,所以這裡不留簡寫):
  //        `diff <(grep -hE ':=|SUM\(' supabase/migrations/20260829140000_m4b_b2c_manual_order_explicit_tax_total.sql | sort) \
  //              <(grep -hE ':=|SUM\(' supabase/migrations/20260831180000_m4b_spec1_manual_order_authoritative_spec.sql | sort)`
  //      ⚠️ 跑之前先各自 `wc -l` 確認兩側**都不是 0 行**,否則 `diff` 回 0 的意思是「兩邊都沒讀到」。
  //      ⇒ **差 2 行,而那 2 行都在【前置閘】裡**(`v_src NOT LIKE '%v_spec := …%'` 與
  //        `v_fp := md5(…)` 的指紋計算)。
  //      🟢 正對照 gen2 自己比自己 ⇒ 0 行差(尺會動)。
  //
  //    🔴🔴 **而這把尺【撐不起】「金額算式逐字相同」這句話 —— 上一版我就是那樣寫的**
  //       (codex 2026-08-31 must-fix)。`:=` 與 `SUM(` 兩個形狀**看不到**:
  //       `IF` 值域守門 / `SELECT … INTO` / `INSERT … VALUES` 的欄位對位 / `=` 條件 /
  //       helper 呼叫 / CHECK 與 constraint 改動 —— **其中任何一項都能改變最後寫進去的金額**。
  //       ⚠️ 而本檔 `:211-223` 早就記過同一件事:「writer 的上游條件變了而 INSERT 沒變」正是本 gate 的已知洞。
  //       📌 **⇒ 我用一把已知有洞的尺,去支持一句比它射程更寬的話。**
  //    ⇒ 這一筆能被允許,靠的**不是那個 diff**,是:①它是同一支函式的 CREATE OR REPLACE、
  //      ②金額仍全部 server 自算不收 client 合計欄(開檔讀過)、③它至今未 apply(見下)。
  //    ⇒ 金額仍全部 server 自算(`line_total = unit_price * qty`、`subtotal = Σ line_total`),
  //      **不收 client 送來的任何合計欄** —— 與上一行那筆同理由。
  //
  //    🛑 **而有一格必須寫出來,免得這筆登記被讀成「已放行」**:
  //       **這支 migration 至今【未 apply】,而且是我建議不要 apply 的**(三個理由在片E plan 與
  //       `⟦b4-SPEC1⟧` 那條:①目錄 spec 為空的 13,112 列會吞掉員工手打的規格 ②今天的觸發條件為零
  //       ③前提要 Sean 明白接受)。
  //    📌 **⇒ 本 allowlist 記的是「這支檔在 repo 裡、而它不是新的寫入者」,**
  //       **不是「這支檔可以上正式庫」。兩件事不同,而它們在一行綠底下長得一樣。**
  //    ⇒ 到期條件:哪一天它被 apply 或被改成會自己算金額,這一筆即失效。
  //    🔴🔴 **撞號已解(2026-08-31 19:2x,主視窗發號)—— 而【這是本片第二次改號】,兩個舊號都留著:**
  //         ⛔ ~~`20260831140000`~~ ⇒ 撞線 auth 的 `customers_gender`(**那支已 apply、帳本有鍵** ⇒ 動它要連帳本)
  //         ⛔ ~~`20260831160000`~~ ⇒ 撞線帳戶區的 `m4b_coupon_p2_redeem_rpc`(**兩支皆未 apply**)
  //         ✅ 現行 `20260831180000`
  //       🔴 **兩個舊號刻意留著加刪除線** —— 搜任一個舊號的人要在同一發撞到兩次改號的歷史。
  //       📌 **而形狀值得記:上一次改號(`bb3618b3`,15:28)挑的是「當下看起來空的」160000,**
  //          **2.5 小時後另一條線也挑了它 ⇒ 修撞號的那一顆,自己撞了下一個號。**
  //          ⇒ **一次「挑一個看起來空的號」在單人時安全,在八窗並行時是一次賭。**
  //       🛑 **而那道 pre-commit 撞號閘這次沒有擋** —— 它只看【這一次 commit 的 staged 內容】,
  //          而兩支是在**不同的樹**上各自產生的。
  //          ⇒ **閘的分母是「我這棵樹」,而撞號的分母是「所有樹的聯集」。**
  //          (射程已寫進那道閘的檔頭;改它的行為要另外提。)
  //       🟢 改號後複量:`ls supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort | uniq -d`
  //          ⇒ **零組**(改號前 ⇒ 只有 20260831160000 那一組)。
  //       ⚠️ **不過濾 `.sql` 會得到兩組**(codex R2 抓到我上一版把 `*.sql` 縮寫成 `…` 而讀不出來):
  //          多出來的 `20260820030000` 是「一支 `.sql` + 一支 `_ERRATUM.md`」⇒ **那不是撞號**。
  //          📌 **⇒ 同一句「重複幾組」在兩個分母下答案不同,所以量法要把分母寫進命令裡。**
  //       ⇒ 撞號真正打壞的是**以版本號查帳的那一半**:
  //          🔴 `live`(讀 `APPLIED.tsv`,以版本號認人)⇒ **分不出這兩支**;
  //          ✅ `newest`(以**函式名**掃 migrations)⇒ 分得出來,coupon 那支不定義這支函式。
  //          (上一版我寫「newest/live 都分不出」—— **那是過度宣稱**,codex R2 更正。)
  //       📌 ⇒ 到期條件用 `bash scripts/latest-definition-of.sh admin_create_manual_order`,
  //          **而 live 那一欄仍只是帳本、不是正式庫現況**(那支工具自己的射程聲明)。
  //       🛑 撞號本身是一個**跨線的獨立問題**(不是本筆造成的),已回報主視窗。
  '20260831180000_m4b_spec1_manual_order_authoritative_spec.sql',
  // 🔴 2026-09-01 登記(線【客人帳戶區】`-7a`;券片3a)——
  //    它是 `create_order` 的 `CREATE OR REPLACE` 重定義(第 10 代), 函式本體逐字抄自
  //    `20260825130000`, 只在三處有 delta ⇒ **寫那三欄的路徑沒有變多**, 是同一條路徑的新版本。
  //
  //    🔴 **而本格真正要問的是「寫的值對嗎」, 不是「請把名字加進去」** —— 我逐字比過:
  //      · `INSERT INTO public.order_items (...)` 整段 **逐字相同**
  //        ⇒ `line_total` / `order_id` 兩欄一個字沒動
  //      · `INSERT INTO public.orders (...)` 的差異**只有一格**:`0` ⇒ `v_discount_total`
  //        ⇒ 那是 **`discount_total`** 欄, **不是 `subtotal`**;`subtotal` 仍是 `v_subtotal::integer`
  //    ⇒ ✅ **本片守的那條不變式(`orders.subtotal` = Σ`order_items.line_total`)完全沒被碰到。**
  //    🔵 而本片改動的 `total` / `discount_total` 兩欄**不在這兩支 trigger 的監看範圍內**。
  //
  //    🔴 **登記前跑過一發壞形狀**(照 `20260829140000` 那一筆的做法):
  //      把 `20260730120100` 那一項從本 ALLOWLIST 拿掉 ⇒ 本格轉紅並報出未登記者
  //      ⇒ **這道守門此刻有判別力, 加這一行不是把它關掉。**
  //    ⚠️ 突變刻意做在【本白名單】上, **不往 `supabase/migrations/` 丟野檔**(八窗共用一棵樹)。
  '20260901003000_m4b_coupon_p3_create_order_discount_param.sql',

  // ── 券片 3b(2026-09-01):`create_order` 第 11 代 + 收款扣券 trigger ────────────
  //    **這道閘紅了才發現要登記, 不是我主動想到的** —— 照實記, 因為那正是它的價值。
  //    🔴 而登記前先答它要我答的:我對那三欄做了什麼。**用 diff 對 3a 逐字比, 不憑印象**:
  //      · `INSERT INTO public.order_items (...)` ⇒ **diff 0 行, 逐字相同**
  //      · `INSERT INTO public.orders (...)` 的差異**只有一處**:
  //          欄位清單 `notification_email` ⇒ `notification_email, coupon_id`
  //          值   `p_notification_email` ⇒ `p_notification_email, v_coupon_id`
  //        ⇒ 那是新加的 **`coupon_id`** 欄, **`subtotal` 那一格一個字都沒動**
  //          (仍是 `v_subtotal::integer`)。
  //    ⇒ ✅ **本片守的那條不變式(`orders.subtotal` = Σ`order_items.line_total`)沒被碰到。**
  //    🔵 而本片新加的 trigger `coupon_redeem_on_paid()` **不寫這三欄**
  //      —— 它只寫 `coupon_redemptions` 與 `order_notes`。而它照樣要登記:
  //      **本白名單掃的是【檔】不是【函式】**, 而這支檔裡確實有一個寫 orders 的 INSERT。
  //      📌 分母是檔 ⇒ 一支檔裡混了兩件事, 兩件都要一起被看。
  '20260901021000_m4b_coupon_p3b_create_order_redeem.sql',

  // ── 0 元單片(2026-09-01):`create_order` 第 12 代 + `settle_zero_total_order` ──────
  //    **這道閘也是紅了才發現要登記** —— 而它紅在【主視窗收割時跑全套】,不是我這邊。
  //    🔴 因為那兩支測試住在 `apps/`,而本片那 6 顆一個 `apps/` 檔都沒動
  //      ⇒ **我自己跑「測到我動的那些檔」的分母裡結構上沒有它們。**
  //      📌 鐵則 11 那句的又一發:量具的分母由「我做了什麼」決定,bug 的分母由「誰碰得到」決定。
  //
  //    🔴 **登記前答它要我答的:我對那三欄做了什麼 —— 量的,不是憑印象**
  //      抽法:`awk '/INSERT INTO public\.orders \(/,/RETURNING/'` 與
  //           `awk '/INSERT INTO public\.order_items \(/,/^    \);/'`,兩代各自抽再 `diff`。
  //      · `INSERT INTO public.orders (…)` 段(10 行)⇒ 對 3a **逐字相同**
  //      · `INSERT INTO public.order_items (…)` 段(13 行)⇒ 對 3a **逐字相同**
  //      · 🔵 負對照(防「這把尺恆說相同」):拿本檔的 orders 段去比自己的 items 段 ⇒ **它會叫**
  //    ⇒ ✅ **那三欄的寫入語句一個字元都沒動;`subtotal` 仍是 `v_subtotal::integer`。**
  //
  //    🔴🔴 **而「語句沒變」不等於「值域沒變」—— 這正是 `20260825130000` 那格教過的事,
  //      而本片是同一族的第二例,所以我照那格的要求把改動講明白:**
  //      本片動的是 `INSERT` **上游的前置條件**:原本一條 `IF v_total <= 0 THEN RAISE`
  //      被拆成三條 —— `v_total < 0` 無條件擋 / `v_total = 0 AND v_coupon_id IS NULL` 仍擋
  //      (贈品單那條業務規則的唯一執行者,**一格都沒放寬**)/ 其餘放行。
  //      ⇒ **淨效果:`total = 0` 且帶券的單,從「建不出來」變成「建得出來」。**
  //      ⚠️ **而那三欄的【值域】有沒有跟著變寬 —— 我第一版的理由寫錯了,留著當記號:**
  //        ⛔ ~~「全額券折抵的單 `subtotal` 本來就 > 0(券折的是 total 不是 subtotal)」~~ **作廢**
  //          —— `20260825130000` 已放行 `unit_price = 0` ⇒ **`subtotal = 0` 早就進得來**
  //          (那格自己的反例逐字:0 元贈品 + 非門市取貨 ⇒ 運費 100 ⇒ `total > 0` ⇒ 通過 ⇒
  //           寫下 `subtotal = 0`)⇒ **我那句話的前提本身是假的。**
  //        ✅ 正解:`subtotal` 能取到的**值集合**不變(0 與正整數,兩者本片之前都已可達);
  //          本片新開的是一個**組合** —— `subtotal = 0` **且** `total = 0`(門市取貨 + 帶券)。
  //          ⇒ 🔴 **本片沒有讓那三欄收到任何前一版收不到的【值】,但開了一個新的【狀態組合】。**
  //        📌 **⇒ 而一個對的結論配一個錯的理由,下一個人照著那個理由推別的事會推錯。**
  //          ⇒ 我第一版寫完就是「結論對」而收工的 —— 抓到它的是回頭問「那個前提成立嗎」。
  //      ⇒ ⚠️ **上面這一句是我讀碼推的,不是餵出來的。** 餵出來的只有一格:
  //        不帶券的 0 元車 ⇒ `create_order` 仍 `RAISE`(拋棄式 PG 實跑,見該 migration 檔內註解)。
  //
  //    🔵 而本片新加的 `settle_zero_total_order()` **不寫這三欄** —— 它只改 `orders` 的
  //      `payment_status` / `payment_method` / `paid_at`。它照樣被這張表收,因為
  //      **本白名單的分母是【檔】不是【函式】**,而這支檔裡有 `create_order` 的 INSERT。
  '20260901030000_m4b_zero_total_settle.sql',
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
