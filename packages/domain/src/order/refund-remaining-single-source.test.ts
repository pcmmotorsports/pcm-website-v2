// @vitest-environment node
//
// `#473b-1` 機制 2️⃣(plan §2b-2):「還能退多少 / 已退多少」只准有一個算式。
//
// 🔴 **本 gate 存在的理由,是 Sean 同意 Q-473-2=A 的前提條件**:
//    「用**機制**證明沒有任何路能繞過更正、拿到未更正的『還能退多少』。」
//    他明確**不接受**「規定所有讀取都走新入口」這種文字條款 —— 那個形狀本 repo 復發過 9+ 次
//    (memory `feedback_claimed-sync-but-only-patched-touched-lines`)。
//
// 機制的本體在 migration:`pcm_order_refundable_remaining` 用**同簽章 CREATE OR REPLACE**
// 就地改對 ⇒ 既有讀取點零改動就拿到更正後的數,**沒有第二支函式可以繞去**。
// 本 gate 守的是那個機制的破口:有人在別的地方**自己再算一次**。
//
// ── 🔴 v2 改法:SQL 側從「抓 SUM( 的形狀」改成「抓欄位本身」(codex 關卡2 must-fix)──────
// 原版正則是 `sum\(…refund_amount`,codex 指出 `SUM(r1.refund_amount)`(alias 帶數字)、
// `SUM(CASE … refund_amount …)`、quoted identifier 都能繞過而守門維持綠。**開檔查證屬實。**
// ⇒ 改成數**裸欄位 `refund_amount` 本身**:凡是碰到這個欄位的 migration 都要被列管。
//    寬 = fail-closed = 免疫「換個寫法」的規避;代價是新 migration 用到該欄就要補一行 allowlist,
//    而那一步**正是我們要的停點**(migration append-only ⇒ 既有檔永不變,不會有無謂 churn)。
//
// ── 🔴 v2 新增:第二個載體 = TS 側(codex 關卡2 must-fix:原版只掃 migrations)──────────
// codex 指出「TS 直接讀 order_refunds 再 reduce 就完全繞過」。**開檔查證:真的有,而且我漏了。**
//   · `refund-recovery-read.ts:119` — `confirmed.reduce((sum, row) => sum + row.refund_amount, 0)`
//   · `refund-recovery-actions.ts:203` — `row.ledgerConfirmedSum + row.refundAmount`
// 這兩處是 plan §2a 反向盤點**沒抓到的 R12 / R13** —— 我當時的關鍵字是
// 「已退 / 可退 / 未登記額 / refundedAmount / totalRefunded」,而它叫 `ledgerConfirmedSum`,一個都沒對上。
// ⚠️ 兩處都**不在本片修**(理由見 plan §6-4),但必須被列管、不能再靜默增生。
//
// ── ⚠️ 這道守門的先天上限(寫出來、不藏)────────────────────────────────────
// ① migration forward-only ⇒ 每次 `CREATE OR REPLACE` 都在 allowlist 留一筆永久命中。
//    它擋的是「**冒出新的檔**」,不是「同一支改了幾版」。
// ② **TS 側是啟發式**(抓聚合字樣),比 SQL 側弱 —— 換個寫法仍可能繞過。
//    不做成「凡提到 refundAmount 都列管」的理由:那是 35 個檔,churn 大到沒人會看 = 更糟的守門。
// ③ 掃描範圍**不含 `scripts/`**:`scripts/473b1-down.sql` 也有一處(回退時寫回舊定義),那是刻意的。
// ④ 文字比對啟發式、不是 SQL parser(同 `sql-scan.ts` 檔頭);catalog 層權威驗證在 migration
//    自己的 apply 時斷言,兩層互補。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { scanSql } from './sql-scan';

// packages/domain/src/order/ → repo root 上 4 層
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase/migrations');

/** 裸欄位本身。寬 = fail-closed,免疫 alias / CASE / quoted identifier 的規避。 */
const REFUND_AMOUNT_COL = /"?\brefund_amount\b"?/g;

/**
 * 🔴 **期望值寫死、不由掃描結果推導**(防同源假綠 —— 沿用 `shipping-rpc-drift.test.ts` 的紀律)。
 * 每一筆都要能回答「這個檔為什麼可以碰這個欄位」。
 */
// 🔴🔴 **這道守門【不驗行為】** —— 它比對的是「最新定義 remaining 的那支 migration 的函式本體字面」。
//   「那支 RPC 做對事了沒」(冪等 / 換人必拒 / 作廢後可退餘額差額正好等於那一筆)
//   住在 **`scripts/d3b-void-probe.sh`**(拋棄式 PG,零參數,跑完自己收攤)。
//   ⇒ **本檔紅的時候你正好在現場** ⇒ 若你正在動那支函式或 admin_void_manual_refund,順手跑一下它。
//   ⚠️ 它**不在 CI**,不會自己紅。這一行就是它的兩個落點之一(另一個在該 RPC 的 COMMENT ON FUNCTION)。

const SQL_ALLOWLIST: Record<string, { count: number; why: string }> = {
  // ── 2026-09-05 · 線【信】`-mail` 補(⟦b4-NCPCRONRACE⟧;**作者就是我**;
  //    鐵則 12①③ 的 codex 對抗審查兩輪已跑, 見該 migration 檔頭)──
  '20260905070000_m4b_pending_refund_on_late_payment.sql': {
    count: 2,
    why:
      // 🔴 why 要答的是「gate 為什麼對【正確的東西】報紅」。
      // 本檔那兩處**都在 `COMMENT ON COLUMN` 的字串裡**, 一行可執行的碼都沒有碰那個欄位。
      // 🛑 而它非在不可:`COMMENT ON` 是**覆寫不是追加** ⇒ 要在那段 COMMENT 上補一個新角落
      //   (⟦b4-NCPCRONRACE⟧:錢比取消晚到時開出的那一列裝什麼金額), 就必須把
      //   `20260901080000` 的原文【整段帶回來】, 而原文裡就寫著那個口徑公式。
      //   ⇒ 刪掉它們會讓那個欄位的合約在線上消失 —— 那比報紅糟。
      // ✅ 結構性反面證據(量到的):本檔零 `order_refunds`(不含 manual_);
      //   金額**全部**委託 `public.pcm_pending_refund_amounts(p_order_id)` —— 那正是本 gate 保護的單一算式。
      //
      // 🔴🔴 **而我第一版把 count 寫成 7, 兩句佐證也都是錯的 —— 成因值得留在這裡**:
      //   我用【自己的 grep】去數, 得到 7:多出來的 5 個是**函式名 `pcm_pending_refund_amounts`
      //   撞到子字串**(它含 `refund_amount` + s), 而我還為此寫了一整段分析。
      //   我另外寫「本檔零 `SUM(`」—— 實測是 **2**(兩個都在同一段 COMMENT 字串裡)。
      //   ⇒ 📌 **我用自己的尺, 去填一個【別人的閘】要的數字。** 而那道閘的尺比我的準。
      //   ✅ 判別句:**寫 allowlist 的 count 之前, 先讓那道閘自己報數**(跑它, 讀 diff 的 `+` 那一行),
      //     不要用自己的 grep 推。
      '兩處都在 COMMENT ON COLUMN 的字串裡, 零可執行碼碰那個欄位;' +
      'COMMENT ON 是覆寫不是追加 ⇒ 要補新角落就得把 20260901080000 的原文整段帶回來。' +
      '本檔零 order_refunds(不含 manual_), 金額全部委託 pcm_pending_refund_amounts —— 那正是本 gate 保護的單一算式。',
  },
  // ── 2026-09-05 · 線【信】`-mail` 補(⟦b4-MANREFUNDNOOWNER2⟧;**作者就是我**, 寫在這裡
  //    免得下一個人以為有第三方審過 —— 而 codex 對抗審查(鐵則 12①)有跑, 見該 migration 檔頭)──
  '20260905010000_m4b_manual_refund_syncs_payment_status.sql': {
    count: 2,
    why:
      // 🔴 why 要答的是「gate 為什麼對【正確的東西】報紅」。
      // 本 gate 掃 `refund_amount` 這個【欄位字面】(寬 = fail-closed)
      // ⇒ 它分不出「有人自己再算一次【還能退多少】」與「有人在算【另一個問題】而剛好碰到同一個欄」。
      '本檔算的是【另一個問題】:這張單的退款【總額】有沒有達到 total ——' +
      '答案只用來決定 payment_status 該是 partiallyRefunded 還是 refunded。它不回答「還能退多少」。' +
      // ✅ 結構性反面證據(不是宣稱, 是量到的):
      //   🔬 被保護的 `pcm_order_refundable_remaining`(最新代 20260820100000, 函式體 932 字元):
      //        order_refunds = 2 · order_manual_refunds = 1 · **payment_status = 0**
      //   🔬 而本檔改的 `pcm_sync_order_refund_payment_status`(函式體 1,474 字元):
      //        order_refunds = 1 · order_manual_refunds = 1 · **payment_status = 8**
      //   ⇒ ⇒ **兩支讀同樣兩張表, 而【輸出端完全不相交】** —— 一支回數字給人決定「還能退多少」,
      //      一支只寫 payment_status。本檔**從不回傳金額給任何呼叫端**(RETURNS text, 回的是狀態字串)。
      //   ⇒ 📌 而那正是本 gate 要防的形狀(「另一份算式看不到更正 ⇒ 報出的數比實際多 ⇒ 重複退款」)——
      //      **一個不回傳金額的函式, 結構上沒有那個出口。**
      '兩處分兩種:`:122` 是【原文逐字】(卡片軌那半, 2026-08-23 就在, 本片一字未改);' +
      '`:126` 是本片新增的那一句(加總 order_manual_refunds, voided_at IS NULL)。' +
      // ⚠️ 而本片存在的理由就是那個 gate 防不到的另一半:
      //   人工退款登記進去之後 payment_status 從來沒有被改過(掃描:全 repo 六支活寫入端
      //   對 order_manual_refunds 全部 0 次)⇒ 本片讓它開始被算進來。
      '⚠️ 本 allowlist 只涵蓋「本檔加總退款金額」這件事;它【不背書】本檔的並發、ACL 或前置閘 —— 那些走 codex 與拋棄式庫。',
  },
  // ── 2026-09-02 · 線【出貨】`-0e` 補(而**那支 migration 不是我寫的** ——
  //    `3b546a59` 才是它的第一顆, 而我今晚的錨一個都沒命中它。
  //    `-5b` 請我寫這一筆, 理由是那個技術判斷要有人做; 我做, 而**作者不是我**這件事寫在這裡,
  //    免得下一個人以為「作者自己審自己」。) ────────────────────────────────
  '20260901080000_m4b_autorefund_pending_refunds.sql': {
    count: 3,
    why:
      // 🔴 why 要答的是「gate 為什麼對【正確的東西】報紅」。
      // 本 gate 掃的是 `refund_amount` 這個【欄位字面】(檔頭第④點:寬 = fail-closed)
      // ⇒ 它分不出「有人自己再算一次【還能退多少】」與「有人在算【另一個問題】而剛好碰到同一個欄」。
      '本檔算的是【另一個問題】：訂單被取消時，我們手上還握著多少【非卡】的錢。' +
      // ✅ 反面證據(這才是關鍵, 而它是【結構性】的不是宣稱):
      //   🔴 本檔的算式【從頭到尾沒有讀 order_refunds】——
      //      而 gate 保護的那支 `pcm_order_refundable_remaining` 的三段【全部】以 order_refunds 為主體,
      //      「更正成 money_moved 的 failed 列」那一段更是只存在於卡片帳本。
      //   ⇒ ⇒ 一份【不讀那張表】的算式, **結構上不可能「看不到更正」** —— 它從來不在那條路上。
      //   ⇒ 而那正是本 gate 要防的形狀(「另一份算式看不到更正 ⇒ 報出的數比實際多 ⇒ 重複退款」)。
      '三處分兩種：兩處在 `COMMENT ON` 的字串裡寫口徑（:308 / :313），一處是真的加總（:439）。' +
      // ⚠️ 而那兩處【不是 `--` 註解】—— 它們是 `COMMENT ON` 這個 SQL 陳述的字串內容
      //    ⇒ 剝 `--` 之後它們【仍然在】(實測 refund_amount 原始 3 / 剝註解後仍 3)。
      //    ⇒ 📌 「註解」在這支檔裡有兩種, 而它們對任何文字尺的行為【不一樣】。
      '而那一處加總的口徑逐字寫在它自己的 COMMENT 裡：' +
      'SUM(order_payments.amount 同軌) − SUM(order_manual_refunds.refund_amount 同軌且未作廢)。' +
      // 🔴 可證偽的那一半(照本檔的規矩, 不留一句只能相信的話):
      //   ① 本檔若哪天開始讀 order_refunds ⇒ 那就是它跨進卡片帳本 ⇒ **這一筆 allowlist 立刻失效**。
      //   🔴🔴 而這個檢查【要剝掉 `--` 註解才算數】—— 我第一版寫「引用數必須維持 0」,
      //      **而當場實測是 1** ⇒ 我自己的可證偽宣稱, 在寫下的三十秒後被自己打臉。
      //      成因:那 1 處是 `:39` 的一句【註解】, 內容逐字是「隔壁 order_refunds 也不行」——
      //      **它是在解釋為什麼【不】用那張表**, 而裸 grep 把它算成「用了」。
      //      ⇒ 📌 這正是本 repo 記過的那一條:**比對整包字串時, 註解與 code 是同一種東西。**
      //      ✅ 量法(剝註解):
      //         `python3 -c "import re,io;s=io.open(F,encoding='utf-8').read();
      //                      print(re.sub(r'--[^\n]*','',s).count('order_refunds'))"`
      //         ⇒ **今日實測:原始 1 · 剝註解後 0。**
      //         🟢 正對照(證明沒有剝過頭):同一發剝完之後 order_payments 仍有 6 處。
      //   ② 它是【軌別範圍內】的:同軌相減 ⇒ 卡片退款不會被它算進來, 反之亦然。
      '可證偽:本檔【剝掉 -- 註解之後】對 order_refunds 的引用數必須維持 0' +
      '(今日實測 原始 1 / 剝註解後 0;那 1 處是 :39 一句「隔壁 order_refunds 也不行」的註解。' +
      '🟢 正對照:同一發剝完 order_payments 仍有 6 處 ⇒ 沒有剝過頭)。' +
      // ⚠️ 而一個【未來會撞到】的點, 先寫在這裡:
      //   `⟦b4-MANREFUNDNOOWNER⟧` 那片(2026-09-02 封存, codex R2 FAIL)也會 SUM order_manual_refunds。
      //   ⇒ 它若哪天上線, 這個欄位就會有【兩個】加總者 —— 而那時要回來問:
      //     它們算的是不是同一件事? 今天不是(一個算「手上還有多少錢」, 一個算「狀態該是什麼」),
      //     而【兩個各自正確的算式】正是今晚一再撞到的那個形狀。
      '⚠️ 未來:⟦b4-MANREFUNDNOOWNER⟧ 若上線，這個欄位會有第二個加總者 ⇒ 屆時要回訪本筆。' +
      // ══ 🔵 以下由線 `-5b` 併入(2026-09-02)—— **兩個窗各自判過這一支, 而我們把兩份都留著** ══
      //   🛑 我原本另外加了一筆同鍵的 entry ⇒ `TS1117: 同名屬性` ⇒ push 被擋。
      //   📌 **而那個重複本身是訊號**:如果 TS 沒擋, JS 會【安靜地用後面那一個】
      //      ⇒ 前面那一筆的 why 就消失了, 而它**仍然看得到**(還在檔案裡、有理由)
      //      ⇒ ⇒ 那正是「寫對了而沒接上, 與沒寫的行為相同, 而前者更貴」的又一個載體。
      //   ✅ 處置(主視窗裁):**合併成一筆而兩個理由都寫**, 不是挑一個 —— 兩份判斷的角度不同。
      //
      // 🔴 **`-5b` 獨有的那一格:它有一個【本 gate 看不到】的風險, 而它不是本 gate 的射程**
      //   `:439` 算的是「**每一條軌**的淨實收」, 而 `pcm_manual_refund_rail_cap`(`20260824010000`)
      //   算的是「**兩軌合計**的淨實收」⇒ **同一個公式的兩份實作, 只差一個 group by。**
      //   ⇒ 一邊改了(作廢語意、或新增第四條軌)⇒ 另一邊不會紅。
      //   ⇒ 🔵 而該檔 `:441-442` **自己就記了那一半**(rail 值域是手抄副本, 加軌的人要回來改這裡)。
      //   ⇒ 📌 **所以這不是「無害」, 是【害的是另一件事, 而那件事不歸本 gate 管】。**
      //   ⇒ ✅ 已開列 `⟦5b-RAILCAPTWICE⟧`, **不在本筆解決**。
      '⚠️ 而它與 pcm_manual_refund_rail_cap 是同一個公式的兩份實作（差在 group by rail）' +
      '⇒ 會漂移而本 gate 看不到 —— 已開列 ⟦5b-RAILCAPTWICE⟧，不在本筆解決（-5b 併入）。',
  },
  // ── 2026-08-20 W1 補(片 D3-b 沖銷;主視窗批,W4 唯讀對抗審查) ─────────────────
  '20260820100000_m4b_e10_d3b_void_manual_refund.sql': {
    count: 9,
    why:
      // 🔴 why 要答的是「gate 為什麼對【正確的東西】報紅」,不是「這一筆無害」。
      // 本 gate 是文字比對啟發式(檔頭第④點)⇒ 它掃的是 `refund_amount` 這個欄位字面,
      // 而它分不出「有人自己再算一次可退餘額」與「有人在維護那支唯一該算它的函式」。
      // ⇒ **報紅的原因是分母裡出現了一支新的 migration 提到那個欄,不是有人繞過那支函式。**
      '片 D3-b：把 `AND m.voided_at IS NULL` 加進 pcm_order_refundable_remaining 的第三段。' +
      // ✅ 反面證據(這才是關鍵):本檔【沒有】在任何地方自己算「已退 / 還能退」。
      //    七處逐一交代,而它們分成三種、沒有一種是「另一份算式」:
      //      143/148/167 = 那支函式本體的三段 SUM —— 而本檔對它的唯一改動是【第三段加一個 WHERE】，
      //                    ①②兩段是程式抽取自 20260820010000 的原文，diff 只有一行變兩行。
      //      294/297/301 = §4 後置斷言，比對那支函式的 prosrc 三段字面 —— 那是【保護】它，不是重算。
      //      340        = 後置負測在交易模擬裡借一列 order_manual_refunds（refund_amount=1），全程回滾。
      // 📌 count 7 → 10（codex R1 之後）：P4/P5/P6b 從「片段存在性」改成「**整段字面**」比對
      //    ⇒ §0 前置閘也各多引用一次三段的字面。三處新增全部是【比對那支函式】,不是新算式。
      // ⚠️ **這裡刻意不寫行號** —— 上一版寫了(143/148/167…),而改了兩輪之後全部漂掉(現行 200/205/224…)。
      //   行號是會過期的座標,而「分三種」這個**形狀**不會。
      '九處分三種：三段 SUM（函式本體）／六道字面斷言（§0 前置三道 + §4 後置三道，都在保護它）。'
      + '⚠️ 原本還有一列負測 fixture，隨 A3 交易模擬整段移出 migration（改住 scripts/d3b-void-probe.sh）而消失 ⇒ 10 → 9。' +
      // 🔴 可證偽的那一半:若本檔真的另立了一份算式,那份算式不會出現在
      //    `pcm_order_refundable_remaining` 的 prosrc 裡 —— 而 §4 A1 三道斷言【逐字比對那支函式】,
      //    任何「本檔自己算一份」的版本都無法讓那三道同時通過。⇒ 這個 allowlist 不是靠宣稱撐著。
      // 🔴 **原本這裡寫「另立算式無法讓 §4 A1 三道同時通過」—— 那句話是【錯的】,codex R2 構造了反例並實跑三個 regex 得 true。**
      //   成因:A1 是三個**各自獨立**的 NOT LIKE ⇒ 一個「三段都在 + 另外多算一份」的版本三道全過。
      //   ⇒ 🔴 而那句話的形狀值得記:**我寫「這個 allowlist 不是靠宣稱撐著」的那一句,本身就是一句宣稱。**
      //   ⇒ 修法不是刪掉那句,是**把它變成可執行的**:見同檔下方那格
      //     「函式本體的**正規化全形狀**」比對 —— 多算一份會讓全形狀對不上,三個獨立子字串不會。
      '可證偽：由同檔「正規化全形狀」那一格承擔（另立算式會讓全形狀對不上）。原本寫「三道獨立斷言擋得住」是錯的，已改。' +
      // ⚠️ 本 gate 對本檔的先天上限(檔頭第①點):它擋的是「冒出新的檔」,不是「同一支改了幾版」
      //    ⇒ 擋住「下次又有人改那支函式」的是該 migration §0 的指紋三道(P4/P5/P6),不是本 gate。
      '上限：本 gate 擋新檔、不擋同檔改版；擋改版的是 D3-b §0 的 P4/P5/P6 指紋。',
  },
  // ⚠️ 下面每個數字都是**剝掉註解之後實測**的(2026-08-14),不是拿 `grep -c` 的粗數 ——
  //    粗數含註解,兩者不同(例:20260801120000 粗數 18、實測 12;20260810140000 粗數 1、
  //    實測 **0** ⇒ 那一處只出現在註解裡,整個檔不列入 allowlist)。
  // 🔴 2026-08-20 W5 補(主視窗批、W6 審)。**why 要答的不是「這一筆無害」,是「gate 為什麼對正確的東西報紅」**:
  //   gate 是**文字比對啟發式、不是 SQL parser**(本檔檔頭第④點)⇒ 它分不出
  //   `order_refunds.refund_amount` 與 `order_manual_refunds.refund_amount`(新表自己的金額欄)。
  //   ⇒ 報紅的原因是【分母裡出現了一種它出生時不存在的來源】,不是【有人繞過那支函式】。
  // ✅ **反面證據(這才是關鍵)**:本檔沒有在任何地方自己算「已退 / 還能退」——
  //   它對那個數字的唯一改動,就是把第三段 SUM 加進 `pcm_order_refundable_remaining` 本身,
  //   而那正是本 gate 要保護的機制。
  // 🔴 **可證偽的那一半**:本 gate 原本對這支檔紅【兩格】——
  //   ②「最新定義 remaining 的檔裡函式本體沒有 join order_refund_effective」。
  //   修完之後 ②【消失】⇒「函式確實少了東西」這個可能性是**量到的不存在**,不是宣稱的。
  // ⚠️ 本 gate 對本檔的先天上限(檔頭第①點):它擋的是「冒出新的檔」,不是「同一支改了幾版」
  //   ⇒ 擋住「我下次又改一次那支函式」的**不是**本 gate,是該 migration §0 的前置斷言
  //     (要求現行 `prosrc` 必須含 `order_refund_effective_verdict`,否則 apply 當場炸)。
  // 📌 count 6 → 9(2026-08-20,同日稍後):codex 對抗審查 must-fix ② 之後,§5e 從
  //   「有沒有提到那兩個表名」改成【比對正規化後的整段字面】⇒ 斷言字串本身含 3 個 refund_amount。
  //   🔴 而 count 從 6 變 9 是**本 gate 自己抓到的**(它比對次數,不只比對檔名)——
  //     那正是它該做的事:同一支檔多冒出幾處,不會靜默溜過去。
  '20260820010000_m4b_manual_refunds.sql': {
    count: 9,
    why: '非卡退款登記表(現金/匯款)自己的金額欄 + 在 pcm_order_refundable_remaining 內加第三段 SUM。零自算路徑;詳見上方三段。',
  },
  // 🔴 2026-08-20 W1 補(主視窗批)。**why 要答的是「gate 為什麼對正確的東西報紅」**,不是「這一筆無害」:
  //   與上面那則同因 —— gate 是文字比對啟發式(檔頭第④點)⇒ 它分不出
  //   `order_refunds.refund_amount` 與 `order_manual_refunds.refund_amount`。
  // ✅ **反面證據(可驗,而且是那道 gate 真正在問的那一格)**:本檔對「還能退多少」的唯一動作是
  //   **呼叫** `pcm_order_refundable_remaining`(3 次);**自己對退款表 `SUM(` 的次數 = 0**。
  //   ⇒ 它沒有第二個算式,也沒有碰 `order_refunds` —— 那個表名只出現在兩句
  //     「card 軌走它」的散文裡(RAISE 訊息與 COMMENT 各一)。
  // 📌 四處命中逐處歸屬:三處是 `order_manual_refunds` 自己的欄(冪等比對樹的 SELECT、比對條件、
  //   INSERT 欄位清單),一處在 `COMMENT ON FUNCTION` 的**字串常值**裡(散文,而對掃描器是 code)。
  //   ⚠️ 那一處**刻意不改寫** —— 改寫是為了讓掃描器好看,而那正是檔頭警告的「換個寫法」的形狀。
  '20260820021000_m4b_e10_d1_record_manual_refund.sql': {
    count: 4,
    why: '非卡退款【登記】RPC:三處是 order_manual_refunds 自己的 refund_amount 欄(冪等比對樹 SELECT/條件、INSERT 欄位清單),一處在 COMMENT 字串常值裡。零自算路徑:呼叫 pcm_order_refundable_remaining 3 次、自己 SUM( 0 次。',
  },
  '20260725130100_m3_rf2a2_order_refunds_ledger.sql': {
    count: 5,
    why: '建表本身:refund_amount 欄定義 + RF1 公式 CHECK',
  },
  '20260731120000_m4b_e10_a7b_m_refund_jobs.sql': {
    count: 6,
    why: 'A7b 退款工作佇列:搬運欄位、不做「還能退多少」的判斷',
  },
  '20260801120000_m4b_e10_a7c_refund_ledger_guards.sql': {
    count: 12,
    why: 'A7c 帳本守門 + R3 = pcm_order_refundable_remaining 初版(已被 20260803150000 取代)',
  },
  '20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql': {
    count: 19,
    why: 'RW1a 寫入 RPC 群 + R1 的 RW1a 版(已被 #473b-1 取代)+ 🔴 R2 = admin_finalize_order_refund 步 7 自己 SUM 決定 payment_status(已立案 #497,刻意不在本片修)',
  },
  '20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql': {
    count: 9,
    why: 'L5b2 發起前置諮詢:讀帳本做建議,不改「還能退多少」的定義',
  },
  '20260814190000_m4b_e10_473b1_refund_manual_corrections.sql': {
    count: 2,
    why: '🔴 R1 現行生效版(本片):兩段 SUM 值域互斥(processing/confirmed vs 被更正成 money_moved 的 failed)',
  },
  // ── 2026-09-02 線 `-5b` 補(445b 那支 trigger 的三代 CREATE OR REPLACE)────────────
  // 🔴 **這三筆補得晚了, 而【晚了多久】要照實寫**:前兩支在 2026-09-02 凌晨就 commit 並推上
  //    `origin/dev`, 而本 allowlist 沒跟 ⇒ **本 gate 從那時起一直紅著, 而我兩次回報「三綠全綠」。**
  // 🔴🔴 **而成因是結構性的, 不是誰偷懶 —— 而本檔 :169 早就寫著同一句**:
  //    「純 `.sql` 片的三綠**不跑 vitest**」。
  //    ⇒ 而我的測試分母是 `grep 誰 import / 測到我改的那幾支檔` ——
  //      **本 gate 不 import 任何東西, 它掃一個目錄** ⇒ 對那種分母【結構上不可見】。
  //    ⇒ 📌 **可機械化的補法**:凡動 `supabase/migrations/*.sql` 的片, 測試分母另外加
  //      `grep -rl "supabase/migrations" --include='*.test.ts' packages apps`
  //      —— 那撈得到「掃目錄型」的 gate, 而 `vitest related` 與「誰 import 我」都撈不到。
  //
  // ✅ **三支共同的反面證據(這才是 why 要答的)**:三支都**沒有自己算「已退 / 還能退」**——
  //    它們讀的是 `pcm_order_refundable_remaining()`(前兩支)與 `pcm_manual_refund_rail_cap()`
  //    (第三支)的回傳值, 而那正是本 gate 要保護的那兩支唯一算式。
  //    ⇒ 🔴 **可證偽的那一半**:若它們真的另立算式, 那份算式會出現在檔內而**不會**呼叫上面那兩支函式
  //      ⇒ 量法 `grep -c 'pcm_order_refundable_remaining\|pcm_manual_refund_rail_cap' <該檔>` ⇒ 三支皆 ≥ 1。
  '20260902000000_m4b_capmsgnum_pcm04_detail.sql': {
    count: 3,
    why:
      '⟦b4-CAPMSGNUM⟧:445b trigger 的 CREATE OR REPLACE,唯一改動是 PCM04 的 RAISE 加 DETAIL/HINT。' +
      '三處全是 `NEW.refund_amount`(與 v_cap 比較一次、人話訊息一次、DETAIL 的 asked 一次)——' +
      '而 v_cap 來自 pcm_order_refundable_remaining()。**讀它,不是另算一份。**',
  },
  '20260902010000_m4b_pcm05split_order_not_found.sql': {
    count: 3,
    why:
      '⟦b4-PCM05SPLIT⟧:同一支 trigger 的下一代,唯一改動是「查無訂單」的 SQLSTATE 由 PCM05 拆成 PCM07。' +
      '三處與上一筆【逐字相同】(本支沿用它的函式本體)⇒ 同樣是讀 pcm_order_refundable_remaining()。',
  },
  // ── 2026-09-02 線 `-5b` 補(跨軌修法與它的觀眾)──────────────────────────────
  // 🔵 **兩支的 why 都指向同一件事:它們算的是【非卡兩軌】, 而本 gate 保護的是【卡片帳本】。**
  //   ⇒ 而那不是「它們比較小」—— 是**兩本不同的帳**:
  //     `pcm_order_refundable_remaining` 三段全部以 `order_refunds` 為主體(卡片, 含更正);
  //     這兩支讀的是 `order_payments` + `order_manual_refunds`, **一次都沒有 FROM `order_refunds`**。
  //   ⇒ 🔵 **可證偽**:`grep -c 'FROM public.order_refunds' <該檔>` ⇒ 兩支皆 0。
  '20260902030000_m4b_crossrail_pending_refund_net.sql': {
    // 🔵 3 ⇒ 4(2026-09-02):後置斷言加了**世界E 同軌部分退款**(`-c7` 指出的缺口)。
    // 🔴 **4 ⇒ 1(2026-09-02 稍晚):那整段後置斷言【拿掉了】**(Sean 拍板「依照推薦」)——
    //    codex 抓到 8 條 must-fix, 而決定性的兩條是:那段測試要 `DELETE` 掉自己造的假資料,
    //    而 `order_manual_refunds` / `order_payments` **只准新增不准刪**(append-only / no-delete trigger)。
    //    ⇒ 📌 而那道守門是刻意的(金流紀錄不准刪)⇒ 為了跑測試去繞它是本末倒置。
    //    ⇒ ⇒ 所以剩下的 1 處在 `pcm_pending_refund_amounts()` 的減法裡(真的碼)。
    //    ⛔ ~~原本寫「在 pcm_pending_refund_on_cancel 裡」~~ 🔴 **位置寫錯了**(codex 更正)。
    //       📌 而兩支函式都在同一支檔裡 ⇒ 「哪一支」這個錯【grep 抓不到】, 只有開檔看得到。
    // 🎯 而這道閘【兩次都當場紅】(3⇒4 那次、4⇒1 這次)⇒ 它逐檔比計數, 不只比檔名集合
    //    ⇒ **而增加與減少它都抓得到** —— 後者更容易被當成「清理」而放過。
    count: 1,
    why:
      '⟦b4-CROSSRAILNET⟧ 修一個【已在正式庫上】的多報缺陷:取消時逐軌算而把負的那一軌丟掉,' +
      '跨軌退款(匯款收的錢用現金退 —— Sean 2026-09-02 拍甲說那是合法的)會讓待退款偏高。' +
      '⛔ 原本寫「三處」⇒ 2026-09-02 拿掉後置斷言之後【剩 1 處】。' +
      '🔴 而那 1 處在 `pcm_pending_refund_amounts()` 的那一段減法裡(SUM(m.refund_amount))——' +
      '**不是**在 `pcm_pending_refund_on_cancel()`(codex 2026-09-02 must-fix 更正我寫錯的位置)。' +
      '⇒ 它算的是【非卡兩軌的淨實收】, 不是「卡片還能退多少」。' +
      '🔵 實跑重現+修好:9 個世界(缺陷本體 / 同軌無回歸 / 兩軌分配 / 走 trigger 那條路 / ' +
      '收過錢而算不出欠款要出聲 / 零收款不准出聲)⇒ scratchpad/crossrail-verify.sh。',
  },
  // ⛔ ~~'20260902040000_m4b_railcap_red_counts.sql': { count: 2, … }~~
  // 🔴 **2026-09-02 移除:那支檔的後置斷言【整段拿掉了】**(Sean 拍板「依照推薦」,
  //    與姊妹檔 20260902030000 同一刀)—— 它造假訂單再靠一發刻意的 EXCEPTION 回滾,
  //    而 `orders` 有 NOT NULL 無 default 共 10 欄 + 三條 CHECK + 外鍵一路指到 auth.users
  //    ⇒ 那段在【正式庫】上跑不起來。
  // 🎯🎯 **而這一條的 `why` 自己【預言了這件事】, 逐字**:
  //    「🔵 可證偽:把後置斷言整段拿掉,這個 count 會變成 0 ⇒ 它與那支函式的算式無關。」
  //    ⇒ 📌 而它成真了 —— 拿掉之後這道閘當場紅, 而紅的正是那個 0。
  //    ⇒ ⇒ **所以那句可證偽不是裝飾:它把一次【清理】變成一次【確認】。**
  //    ⇒ ⇒ ⇒ 沒有它, 這一刀看起來只是「少了兩處字面」, 而不是「證實了那兩處與算式無關」。
  '20260902020000_m4b_pcm01_record_not_block.sql': {
    count: 3,
    why:
      '⟦b4-PCM01RECORD⟧(Sean 2026-09-02 拍甲「記得下來但標紅」):' +
      'pcm_manual_refund_rail_cap_guard 的 CREATE OR REPLACE,唯一改動是 PCM01 由 EXCEPTION 改 WARNING。' +
      '三處:①`v_headroom := v_cap + OLD.refund_amount`(UPDATE 時把被改的那一列加回餘裕,' +
      '這是 2026-08-24 codex 抓到的洞的修法,不是第二份算式)②比較一次 ③警告訊息帶那個數字一次。' +
      '⚠️ 而 v_cap 來自 pcm_manual_refund_rail_cap() —— 那是【現金/匯款軌】的唯一算式,' +
      '與本 gate 保護的 pcm_order_refundable_remaining()(卡片帳本)是兩條軌、不是兩份算式。',
  },
  // ── 2026-08-24 主視窗第三班補(退款通知信 片1 / 片2a;兩支【都已在正式庫】,見 supabase/APPLIED.tsv 同版本號兩列) ──
  // 🔴 這兩筆補得【晚了】:兩支在 2026-08-23 就 commit 且 apply,而 allowlist 沒跟 ⇒ 本 gate 從那天起一直紅著。
  // 🔴🔴 **而「為什麼沒跟」的第一版答案是【錯的】,留痕在此**(Fable R2 2026-08-24 抓到):
  //    第一版寫「片1 檔頭 :39 逐字寫著『allowlist 必達』⇒ 寫的人知道要補這一行,而那一行沒被補」。
  //    ⚠️ **那是一句不成立的指控。** `20260823010000:36-40` 的「allowlist 必達」講的是
  //    **函式體內【來源態 allowlist 分支】的可達性證明**(早退不可達 ⇒ 那個分支必達),
  //    與本檔的 `SQL_ALLOWLIST` **毫無關係** —— 只是字面撞名。
  //    量法:`grep -n 'SQL_ALLOWLIST\|refund-remaining-single-source\|473b' <那兩支 migration>`
  //    ⇒ 唯一命中是 020000:71,而那是引用另一支檔的死結形狀,不是本 gate。
  //    ⇒ 形狀:**同字面、異物。** 而它的方向與本檔其餘更正相反 —— 那幾條是把事情寫得比實際【乾淨】,
  //       這一條是把人寫得比實際【糟】。同一族病,兩個方向都會發生。
  // ✅ **真正的成因是結構性的,不是誰偷懶**(同次 R2 F2):純 `.sql` 片的三綠**不跑 vitest**
  //    (片1 commit `21cb9ca2` 的三綠段只有 typecheck + lint;鐵則 11 對 `.sql` 只有語法守門)
  //    ⇒ `packages/domain/` 裡**所有「掃 migration 的閘」對 migration-only 的 commit 一律隱形**。
  //    ⇒ **之後每一支純 SQL 片都會重演這件事。** 已立 backlog(見該條)。補完 allowlist 不等於修好它。
  // ✅ **[2026-09-01 回填 · 線【帳號】`-7a`]** 那個「見該條」**指的是 backlog `#863`**
  //    (標題逐字「純 `.sql` 的 commit 不跑 vitest ⇒ 所有『掃 migration 的閘』對它們【一律隱形】」)。
  // 🔴 **為什麼要補**:「見該條」看起來有指標, 而它**沒有說是哪一條** ——
  //    那比完全不寫更難查, 因為讀的人會以為自己漏看了。⇒ 同族 `⟦5b-REPORTEDNOTLANDED1⟧`。
  // 🔴🔴 **本兩筆的第一版被 code-reviewer 判 FAIL(6 must-fix),而錯的方向全部是【把它寫得比實際乾淨】。**
  //    最重的一條:第一版寫「沒有一種是新算式」,而同表 :148 對 `20260803150000` 逐字標著
  //    「🔴 R2 = admin_finalize_order_refund 步 7 自己 SUM 決定 payment_status(**已立案 #497,刻意不在本片修**)」
  //    —— 那段 code 正是被片1 搬走的那一段。⇒ 正確說法是**承接 R2**,不是「沒有 R2」。留痕在此,不改成看起來對的版本。
  '20260823010000_m4b_refund_notify_p1_extract_sync_fn.sql': {
    count: 4,
    why:
      // why 要答的是「gate 為什麼對【正確的東西】報紅」(照同表既有體例)。
      '片1:把 admin_finalize_order_refund 步 7(G8 翻轉)整段搬進 pcm_sync_order_refund_payment_status。' +
      // 🔴 **本檔承接 R2(#497),不是消滅它** —— R2 的住址從 20260803150000:776 搬到本檔。
      //    同表 :148 那筆的 why 仍指著舊住址;查 #497 的人要知道現行實作在這裡。
      '🔴 承接 R2(#497):那段「自己 SUM 決定 payment_status」的算式**住址從 20260803150000 搬到本檔**，' +
      '算式一個字未改、刻意不在本片修(片3 才換)。同表 :148 那筆指的是舊住址。' +
      // 四處分三種(1+2+1=4),沒有一種是【新的】算式:
      //   ① 一處 SUM(refund_amount) WHERE status='confirmed' —— 就是 R2 本體,程式抽取自
      //      20260803150000 的原文。憑據=本檔事後自檢 3f 逐字比對新函式 prosrc 必須含
      //      `WHERE order_id = p_order_id AND status = 'confirmed';`(改了算式那格會紅)。
      //   ② 兩處前置斷言(ILIKE 樣板 + RAISE 訊息)—— 驗 refund_amount > 0 那道 CHECK 還在且 convalidated。保護,不是計算。
      //   ③ 一處 CAS 分支 v_row.refund_amount —— G7 拿 TapPay 回報金額比對該列自己的金額。單列比對、零聚合。
      '四處分三種:一處 SUM(= R2 本體，程式抽取非新寫)／兩處前置斷言(保護 CHECK)／一處單列 G7 比對。' +
      // 🔴 可證偽的那一半 —— **降級後的誠實版本**(第一版寫「另立算式必須出現 total 減 moved 的形狀」,
      //    code-reviewer 構造了三種不長那形狀的反例:應退基數改從別處取 / 先存負值再相加 / 在 TS 側相減
      //    ⇒ 那句話是假的可證偽性,比沒有更糟)。
      '可證偽(限定版):本檔現況零減式(量法 grep -c 減式形狀 ⇒ 0)，' +
      '而此證明**不涵蓋「換一個應退基數來源再相減」的寫法** —— 那族要靠片3 的三段聚合改寫來收。' +
      // ⚠️ 上限(同本檔檔頭①):本 gate 擋「冒出新檔」,不擋「同一支改了幾版」。
      '上限:本 gate 擋新檔、不擋同檔改版;擋改版的是片1 §0 的 md5 前置閘' +
      '(2026-08-24 實際擋下一次重複 apply)，而**那道閘只在 apply 當下跑一次、不在 CI**。',
  },
  '20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql': {
    count: 4,
    why:
      '片2a:非卡退款登記 RPC(識別字刻意省略,見下方註記)接上片1 抽出的共用 helper。' +
      // 🔴 **本段刻意不寫那支登記 RPC 的完整識別字**,而這【不是】遺漏:
      //    同目錄 `manual-refund-caller-gate.test.ts` 是一道**字面掃描**的觸發器,
      //    它分不出【呼叫它】與【在註解裡提到它】⇒ 2026-08-24 本筆第一版寫了全名,
      //    那道閘當場把**本檔**報成新呼叫端(實際零呼叫)。
      //    ⇒ 正確處置是改措辭,**不是**把本檔加進那邊的 CALLER_ALLOWLIST(本檔不是呼叫端)。
      //    ⚠️ 下一個人若「順手補上完整名字」⇒ 那道閘會再紅一次。請不要補。
      // ✅ 餘額走正版:v_remaining := public.pcm_order_refundable_remaining(p_order_id)(:435),
      //    然後 :440 IF p_refund_amount > v_remaining THEN 拒絕超額。更正被扣掉之後本檔拿到的餘額跟著變小。
      '反面證據:超額判斷的餘額走 pcm_order_refundable_remaining(:435)，本檔零自算餘額。' +
      // 🔴 **但它同樣承接 R2(#497)**:本檔 :239 重寫 helper,helper 內那段 SUM 就是 R2。
      //    ⇒ 「零自算」只涵蓋【還能退多少】那一半;【已退多少】那一半本檔照樣有一份,與片1 同源。
      '🔴 而本檔同樣承接 R2(#497):它 :239 重寫 helper，helper 內那段 SUM 就是 R2 本體。' +
      '「零自算」只涵蓋【還能退多少】，不涵蓋【已退多少】。' +
      // 四處分三種(1+2+1=4):
      '四處分三種:一處 helper 內 SUM(= R2 本體)／**兩處**冪等重放比對(:393 取欄 + :399 IS NOT DISTINCT FROM)／一處 INSERT 欄位清單。' +
      // 🔴 證據等級:本檔【已在正式庫】,而那是 2026-08-24 事後以 prosrc 指紋反推的。
      '證據等級:本檔已 apply，而該結論是事後指紋反推、非現場見證(全文與量法見 APPLIED.tsv 20260823020000 列)。' +
      // ⚠️ 上限同片1 那筆(code-reviewer E3:第一版只有片1 寫了、片2a 漏了,補齊)。
      '上限:本 gate 擋新檔、不擋同檔改版;擋改版的是本檔 §0 的 md5 前置閘，而它只在 apply 當下跑一次、不在 CI。',
  },

  // ── 2026-08-24 窗 A 補(`#866` 人工退款軌別上限;R2 findings 修完後由主視窗 commit)────
  // 🔴 **count 是本窗自己數的,不是抄本 gate 的錯誤訊息**。兩把尺:
  //    ① 本 gate 自己的 `scanSql(...).code`(剝註解、**保留**字串與 dollar-quote)
  //    ② `grep -n refund_amount <檔>` 之後剔掉行首 `--` 的行
  //    ⇒ 兩把各自得到 **3 / 3**,一致才寫進來。
  //
  // ⚠️ **2026-08-24 這兩個數字過期過一次,而過期的原因值得留著**:
  //    010000 原本登記 `1`。同日本窗往那支加了**前置閘**(驗 `refund_amount > 0` 那道 CHECK)
  //    ⇒ 那個欄名在**程式碼裡**多出現兩次(`:74` 的 `ILIKE` 樣板、`:75` 的 RAISE 訊息)
  //    ⇒ **碼變了而描述碼的數字沒跟著走。**
  //    📌 這正是本 gate 存在的價值之一:**它會替你發現「你改了東西而忘了說」。**
  //    🔴 而處置**不是**抄它報的數字(那等於把期望值改成觀察值)——
  //       是**讀它怎麼數、自己數一次、兩個數一致才寫**。
  // ── 2026-08-30 線【DB 與金流】補(`#445b` 刷卡軌退款金額上限;`-48` 批片、code-reviewer + codex 審)──
  // 🔴 **count 是本窗自己數的,不是抄本 gate 的錯誤訊息**(照上面那條紀律)。兩把尺:
  //    ① 自己剝註解(逐字元走、字串內的 `--` 不算註解)⇒ **5**
  //    ② `grep -n refund_amount` 剔掉行首 `--` 的行,再**逐行數出現次數**(行數 ≠ 次數)⇒ **5**
  //    負對照:同一把尺數一個現造字面(`zzq_no_such_column`)⇒ **0** ⇒ 尺是活的。
  //    ⇒ 兩把一致才寫進來。**本 gate 自己報的也是 5,而那是第三份,不是我的依據。**
  '20260830210000_m4b_445b_order_refund_cap.sql': {
    count: 5,
    why:
      // 🔴 why 要答的是「gate 為什麼對【正確的東西】報紅」,不是「這一筆無害」。
      // 本 gate 是文字比對啟發式 ⇒ 它掃的是 `refund_amount` 這個欄位字面,分不出
      // 「有人自己再算一次可退餘額」與「有人拿那支唯一該算它的函式去比一個值」。
      // ⇒ **報紅的原因是分母裡冒出一支新的 migration 提到那個欄,不是有人繞過那支函式。**
      '片 445b:在 order_refunds 上加一道 BEFORE INSERT 上限閘,擋「退超過還能退的錢」。' +
      // ✅ 反面證據(這才是關鍵):本檔【零處】自己算「已退 / 還能退」——
      //    它**呼叫** `pcm_order_refundable_remaining(NEW.order_id)`(`:267`),那正是單一算式本身。
      //    五處分兩種、沒有一種是另一份算式:
      //      三處(§0 前置閘)= 驗 `refund_amount` 欄位是不是 NOT NULL,以及在 RAISE 訊息與
      //                        既有 UPDATE 面的說明字串裡提到欄名 —— 那是**檢查欄位**,不是算錢。
      //      兩處(trigger 本體)= 拿 `NEW.refund_amount` 與那支函式回傳的 `v_cap` **比大小**。
      //                        📌 **「比」與「算」是兩件事** —— 被比的那個數字整個來自單一算式。
      // ⚠️ **這裡刻意不寫行號**(照 D3-b 那一格的教訓):行號是會過期的座標,「分兩種」這個形狀不會。
      '五處分兩種:三處 §0 前置閘檢查欄位 NOT NULL 與訊息字串／兩處 trigger 本體拿 NEW 值與 v_cap 比大小。' +
      // 🔴 可證偽的那一半(而它必須是【可執行的】,不是一句宣稱):
      //    本檔一旦自己寫一份 SUM,`refund_amount` 的出現次數就會離開 5 ⇒ **本 gate 當場紅**
      //    (本 gate 逐檔比對次數,不只比對檔名集合)。
      // ⚠️ **而那條可證偽有一個上限,寫出來**:一個「多算一份、同時少提一次」的改法可以維持 5。
      //    ⇒ 真正擋那種的是 §0 前置閘 `to_regprocedure('public.pcm_order_refundable_remaining(uuid)')`
      //      那一道(`:129-130`):本檔若不再依賴那支函式,那道閘就沒有存在的理由,會被一起刪掉 ⇒ diff 上看得見。
      '🔴 可證偽:本檔一旦多提或少提一次 refund_amount,count 就不再是 5 ⇒ 本 gate 當場紅。' +
      '⚠️ 上限:「多算一份 + 少提一次」可維持 5;擋那種的是 §0 那道 to_regprocedure 前置閘(它的存在本身就宣告了依賴)。',
  },

  '20260824010000_m4b_866_manual_refund_rail_cap.sql': {
    count: 3,
    why:
      // why 要答的是「gate 為什麼對【正確的東西】報紅」(照同表既有體例)。
      '`#866` 片1:建 pcm_manual_refund_rail_cap(p_order_id)，算【現金 / 匯款兩軌的淨實收】。' +
      // 🔴 **照實寫:那一處【就是】一個新的 SUM(refund_amount)** —— 不粉飾。
      //    它可以被允許,靠的不是「它沒聚合」,是**它聚合的是另一本帳、而且輸出只用來拒絕**。
      '三處分兩種:**一處** SUM(算式本體)+ **兩處**前置閘(:74 ILIKE 樣板 / :75 RAISE 訊息)。' +
      // 前置閘那兩處是 2026-08-24 codex must-fix 加的:驗 `refund_amount > 0` 那道 CHECK 還在,
      // 因為少了它,一筆**負的**人工退款會讓扣減變加法 ⇒ **反向增加上限**。
      '前置閘那兩處是【保護那道 CHECK】,不是計算 —— 與同表 :177 那筆的②同型。' +
      '🔴 而 SUM 那一處確實是新的聚合,不辯稱「零聚合」。可允許的理由有二,兩條都要成立:' +
      // ① 不同的帳本:order_manual_refunds ≠ order_refunds。兩本帳的分界寫在
      //    20260820010000 建表的 CHECK (rail IN ('bank_transfer','cash')) 裡 —— 值域刻意不含 card。
      '①【不同帳本】它 SUM 的是 order_manual_refunds(rail 值域不含 card，見 20260820010000 建表 CHECK)，' +
      '不是 order_refunds ⇒ 它算不出、也不打算算出「這張單還能退多少」。' +
      // ② 輸出只往「拒絕」流,不往「顯示」或「可退金額」流。
      '②【輸出只用來拒絕】唯一消費端是片2 的 BEFORE INSERT OR UPDATE trigger，用來擋超額;' +
      '零處把它的回傳值當作可退餘額顯示或寫入。' +
      // 🔴 可證偽(說清楚哪一天這筆 why 會變成假的)——
      '🔴 這筆 why 的到期條件:**哪一天有人把這支函式的回傳值渲染成「可退餘額」或拿它決定放款金額**，' +
      '它就變成第二個真相來源、本筆即失效。查法 = grep pcm_manual_refund_rail_cap(2026-08-24 量:' +
      '除本片兩支 migration 與 scripts/866-rail-cap-verify.sh 外零命中)。' +
      // ⚠️ 上限:同表既有兩筆的那條,原樣適用。
      '上限:本 gate 擋新檔、不擋同檔改版;而本片**沒有** md5 前置閘那種東西 ⇒ 改版這一面目前無人看守。',
  },
  // 🔴🔴 **這個數字在 2026-08-24 一天之內過期【兩次】,而兩次都是同一個動作造成的:**
  //    我改了那支 migration,而**描述它的數字沒跟著走**。
  //      第一次 3→(片1)登記 1 ⇒ 實際 3   加了前置閘
  //      第二次 3→5(本檔)              加了 F4 的 NOT NULL 前置閘(+2:EXISTS 條件與 RAISE 訊息)
  //    📌 **同一個病兩次 ⇒ 把次數寫進去。** 而它每次都被這道 gate 抓到 ——
  //       **這道 gate 真正的用途之一,是替你發現「你改了東西而忘了說」。**
  //    🔴 而處置永遠不是抄它報的數字(那等於把期望值改成觀察值),
  //       是**讀它怎麼數 ⇒ 自己數一次 ⇒ 兩把尺一致才寫**。本次兩把尺皆得 5。
  '20260824011000_m4b_866_manual_refund_rail_cap_enforce.sql': {
    count: 5,
    why:
      '`#866` 片2:把片1 的上限掛成 order_manual_refunds 的 BEFORE INSERT OR UPDATE trigger。' +
      // 三處逐一交代,而三處都是【比大小】,沒有一處是聚合:
      //   :85 v_headroom := v_cap + OLD.refund_amount  ← UPDATE 的餘裕還原(單列取欄)
      //   :88 IF NEW.refund_amount > v_headroom        ← 比大小
      //   :95 RAISE 訊息帶出 NEW.refund_amount          ← 只是把數字印給人看
      '五處全是【單列取欄 / 比大小 / 保護既有約束】,零聚合:' +
      '一處 UPDATE 餘裕還原(OLD 單列)／一處 > 比較／一處錯誤訊息帶值／' +
      // 🔴 後兩處是 2026-08-24 R3(Fable)F4 加的前置閘:`refund_amount` 的 NOT NULL
      //    是這道 trigger 比較式的**承重件**(NULL > x 回 NULL ⇒ IF 不成立 ⇒ 靜靜放行),
      //    而那道 NOT NULL 寫在【別人的檔】(20260820010000)⇒ 讓依賴變成會執行的東西。
      '兩處前置閘(驗 refund_amount 的 NOT NULL 還在 —— 那是本比較式的承重件,寫在別支 migration 裡)。' +
      // 🔴 承接關係:聚合在片1,本檔不重算。
      '聚合住在片1 那支函式，本檔一次都沒有自己算 —— 它呼叫 pcm_manual_refund_rail_cap 取值。' +
      // 🔴 可證偽:本檔若哪天自己寫 SUM,count 會從 3 變大,本 gate 會紅。
      '🔴 可證偽:本檔一旦自己寫 SUM，count 就不再是 3 ⇒ 本 gate 當場紅(逐檔數比對，非只比檔名集合)。' +
      // ⚠️ 而本 gate 對這兩支的**盲點**要寫出來,不然這兩筆讀起來像「已審過所以安全」。
      '⚠️ 盲點:本 gate 是文字比對，它看不出 trigger 的【觸發面】對不對 —— ' +
      '2026-08-24 R2 抓到的 `UPDATE OF refund_amount` 漏掉復活路徑那個洞，' +
      '本 gate 全綠、三綠也全綠,**唯一叫的是 scripts/866-rail-cap-verify.sh 的 M4**。動這支請跑它。',
  },
  // ── 2026-08-30 線A `-e9` 補(片 D3-d 帳不塗改;Sean 拍板 Q4=甲、主視窗 `-48` 裁範圍乙)──
  // 🔴 **這一筆的成因,上一筆的盲點那段【已經預言過了】**:
  //    它逐字寫著「2026-08-24 R2 抓到的 `UPDATE OF refund_amount` 漏掉**復活路徑**那個洞」——
  //    而 D3-d 就是去把那條復活路徑關掉的那一片。⇒ 本筆不是新問題,是那句話的下游。
  '20260830050000_m4b_e10_d3d_manual_refund_immutable.sql': {
    count: 5,
    why:
      // why 要答的是「gate 為什麼對【正確的東西】報紅」,不是「這一筆無害」(照同表體例)。
      // 本 gate 是文字比對啟發式:它掃 `refund_amount` 這個**欄位字面**,
      // 而那個字面在**兩張不同的表**上都存在 ——
      //   `order_refunds.refund_amount`(卡片退款帳本 = 本 gate 要保護的那一張)
      //   `order_manual_refunds.refund_amount`(現金/匯款登記 = 本片唯一碰的那一張)
      // ⇒ **報紅的原因是分母裡冒出一支新 migration 提到那個字面,不是有人另算一份餘額。**
      '片 D3-d:在 order_manual_refunds 掛 BEFORE UPDATE trigger,讓帳體九欄不可變、作廢成終態。' +
      // ✅ 反面證據(可機械複驗,量法附在括號裡):
      //    · `order_refunds`  ⇒ **0 次**(本片從頭到尾沒有提過本 gate 要保護的那張表)
      //    · `SUM(`           ⇒ **0 次**
      //    · `refundable` / `remaining` / 「已退」/「可退」 ⇒ 各 **0 次**
      //    ⇒ 本片沒有、也無處自己算一份「已退 / 還能退」。
      '反面證據(量法 grep -o … | wc -l):order_refunds ⇒ 0、SUM( ⇒ 0、' +
      'refundable/remaining/已退/可退 ⇒ 各 0 ⇒ 本片零自算餘額,也沒提過本 gate 保護的那張表。' +
      // 五處分三種(刻意不寫行號 —— 行號會漂,「分三種」這個形狀不會):
      //   ① 欄位分母陣列裡的一個**字串常量**('refund_amount')
      //   ② trigger 內的 `NEW.refund_amount IS DISTINCT FROM OLD.refund_amount`(**兩次出現在同一行**)
      //   ③ COMMENT ON FUNCTION 裡的一段**說明文字**
      // ⚠️ codex R2 nit #8 更正:那三個不是「三道比較」,是**同一道** `IS DISTINCT FROM` 比較裡的
      //    三個 token(`NEW.refund_amount` / `OLD.refund_amount` / 回傳的欄名字串)。
      '五處分三種:欄位分母的字串常量 ×1 / **同一道** IS DISTINCT FROM 比較裡的三個 token / COMMENT 說明 ×1。' +
      // 🔴 方向:本片對這個欄的作用是**讓它改不動**,與「繞過那支唯一該算它的函式」方向相反。
      '🔴 方向相反:本片對 refund_amount 的唯一作用是【讓它不可變】(改它 ⇒ P2B45),不是寫它、更不是重算它。' +
      // 🔴 可證偽(而且限定範圍,不寫成假的可證偽性):
      //    本片若哪天自己寫 SUM 或引入 order_refunds,count 會離開 5 ⇒ 本 gate 當場紅(逐檔數比對)。
      //    ⚠️ **而它不涵蓋**「換一個名字自己算一份」的寫法 —— 那族本 gate 本來就掃不到。
      // 🔴 **codex R2 nit #7 更正:上一版寫「一旦寫 SUM 或引入 order_refunds,count 就離開 5」——**
      //    **那句話證不到。** 它給的反例可執行:加一行 `SELECT SUM(1) FROM public.order_refunds;`
      //    ⇒ `refund_amount` 的 count **仍然是 5** ⇒ 本 gate 維持綠。
      //    ⇒ 本 gate 數的是 `refund_amount` 這個字面, **它與「有沒有 SUM」「有沒有 order_refunds」無關**。
      '🔴 可證偽(收窄後):本片一旦**多提或少提一次 refund_amount**,count 就不再是 5 ⇒ 本 gate 當場紅。' +
      '⚠️ 而它**不涵蓋**:寫 SUM、引入 order_refunds、換個名字自己算一份 —— 那三族本 gate 都掃不到' +
      '(前兩族是 codex R2 給的可執行反例,不是我推測的)。' +
      // ⚠️ 一格誠實更正:我第一版想寫「零算術符號」,而機械量到 1 —— 那是 COMMENT 裡
      //    `refund_amount/reason` 的**斜線分隔**,不是除法。⇒ 寫成「零算術」會是一句我證不到的話。
      '⚠️ 「refund_amount 後接運算子」機械量到 1 處,實查是 COMMENT 裡 `refund_amount/reason` 的斜線分隔、非除法。' +
      // ⚠️ 盲點(照同表體例寫出來,免得這一筆讀起來像「已審過所以安全」):
      '⚠️ 盲點:本 gate 不驗行為 —— 「D3-d 的 trigger 觸發面對不對」它答不出來。' +
      '那一半的證人是 scripts/d3d-immutable-verify.sh(拋棄式 PG,**36 格**含逐欄突變、TRUNCATE 突變、' +
      '欄位分母突變與量具自檢),而它**不在 CI**。' +
      // ⚠️ codex R2 nit #9:上一版寫「25 格」—— 那是加 TRUNCATE 節與逐欄突變之前的數字。
      //    📌 **一個寫死在別的檔裡的格數, 它的失效方式是【我把測試補得更完整】。**
      '⚠️ 這個格數會隨 harness 增修而過期 —— 以那支自己印的 `結果:PASS=` 為準。' +
      // 🔴 結構性成因(同表 :169-172 已記):純 .sql 片的三綠不跑 vitest ⇒ 本 gate 對它隱形。
      // 🔴 **codex R2 nit #10 更正**:上一版寫「本片是純 .sql + .sh」——
      //    **而我正在改的這支就是 `.ts`** ⇒ 那句話在寫下它的當下就不成立了。
      //    ✅ 正確的說法是:**觸發本 gate 的那兩支是 .sql + .sh** ⇒ 若我沒有回來補這一筆,
      //       三綠(typecheck/lint)不跑 vitest ⇒ 這道紅會**在 CI 之外被發現**, 或根本沒被發現。
      //    📌 而這一次它是**被別的窗跑 greenlight --tests 撈到的**, 不是我自己的三綠叫的。
      // ══ 🔴🔴 而這一筆順帶照出本 gate 自己的一個形狀(線C `-b4` 2026-08-30 指出)══
      //    本 gate 的錨是**欄名** `refund_amount`,而**欄名不是唯一鍵** ——
      //    `order_refunds.refund_amount`(它要保護的)與
      //    `order_manual_refunds.refund_amount`(本片碰的)**同名不同表**。
      //    ⇒ 它的分母被悄悄放大成「**所有叫這個名字的欄**」。
      //    🔴 **而危險的方向是【放行】不是【誤擋】**:
      //      真的有人在 `order_refunds.refund_amount` 上自己算一份餘額,
      //      只要那支檔的 count 湊得上 allowlist 裡的數字,**這道 gate 會全綠**。
      //      (誤擋那一側只是噪音 —— 像本片這樣被叫來寫一筆 why;放行那一側沒有人會知道。)
      //    ⚠️ **本片刻意不收窄它** —— 那是這道 gate 自己的片,而它守的是別人的錢。
      //      要收窄的話:錨改成「**表名 + 欄名**相鄰」的字面,
      //      🔴 **而收窄的那一天必須補一發突變** —— 拿 `order_refunds.refund_amount`
      //      現造一行塞進某支 migration,**那道 gate 必須紅**。**今天它不會。**
      //    📌 這一格記在這裡而不是別處,因為**下一個被它叫來寫 why 的人,一定會讀到這裡**。
      '🔴 觸發本 gate 的那兩支是 .sql + .sh ⇒ 若不回來補這一筆, 三綠(typecheck/lint)不跑 vitest、' +
      '這道紅不會在本片的三綠裡出現(同表 :169-172 已記的結構性成因, 本片再次示範);' +
      '本次是別的窗跑 greenlight --tests 撈到的。',
  },
  // ── 2026-08-31 線DB 補(片E `20260831010000`;**這一筆是上一筆那句話的下游**)──
  // 🔴 上一筆逐字寫著:「本 gate 擋新檔、不擋同檔改版」+「純 .sql 片的三綠不跑 vitest ⇒ 本 gate 對它隱形」。
  //    ⇒ 而本片正是**同一族的下一支新檔**,而且**同樣沒有被我自己的三綠叫出來** ——
  //       它是主視窗跑全套件撈到、隔了約 6 小時才回到我手上。
  //    📌 **⇒ 這不是新問題,是那兩句話各自的第二個實例。**
  '20260831010000_m4b_866_manual_refund_raise_plaintext.sql': {
    // 🔴 這個 3 是**本 gate 自己印的**(剝註解後),不是我 grep 的 ——
    //    我先 grep -c 得 5、grep -o 得 6,兩個都錯:前者數行、後者含註解。
    //    📌 **量具的數,要由量具自己給。**(memory `feedback_let-the-tool-compute-the-test-denominator`)
    count: 3,
    why:
      // why 要答的是「gate 為什麼對【正確的東西】報紅」,不是「這一筆無害」(照同表體例)。
      // 🔴 **上一版這句寫「PCM01/PCM02 兩碼不變」—— 錯的**(codex 2026-08-31 must-fix)。
      //    實查 `grep -o "ERRCODE = 'PCM[0-9]*'"` ⇒ **PCM01 / PCM02 / PCM03 各 1**,是三碼不是兩碼。
      //    📌 **我在一張要求附證據的表裡,填了一個沒有量過的數。**
      '`#866` 片E:把人工退款上限閘的 RAISE 訊息改成員工讀得懂的白話;' +
      'SQLSTATE 三碼(PCM01/PCM02/PCM03)本身不變,改的是訊息字面。' +
      // ✅ 反面證據(量法 grep -oF … | wc -l,原文含註解一起算 ⇒ 0 就一定是真 0):
      '反面證據(量法 grep -oF … | wc -l,含註解一起算):order_refunds ⇒ 0、SUM( ⇒ 0、' +
      'refundable ⇒ 0、remaining ⇒ 0。' +
      // 🔴 **上一版由這四個 0 推出「本片沒有第二個算式」—— 推不出來**(codex must-fix)。
      //    換一張表、換一個 helper、換一個變數名、換一種算術形狀,這四個字面照樣全是 0。
      //    📌 **零命中證明的是【這四個字面不在】,不是【那件事沒發生】。**
      '🔴 而這四個 0 【推不出】「沒有第二個算式」—— 它只證明那四個字面不在本片;' +
      '換表 / 換 helper / 換變數名 / 換算術形狀都能繞過它。這一格的真正證人是開檔讀那 3 處(見下)。' +
      // 🔴 **與同表前兩筆不同的一格,照實寫出來,不要照抄前例那句「已退/可退 各 0」**:
      //    本片機械量到 `已退` ⇒ 1(註解)、`可退` ⇒ 2(**RAISE 訊息字串**)。
      '🔴 與前兩筆不同:本片「可退」機械量到 2 處,而它們在 **RAISE 訊息字串裡**、不在算式裡 ——' +
      '`:161` 逐字「這張單在【現金 / 匯款】上目前只剩 % 元可退」⇒ **它確實把一個餘裕數字顯示給人看**。' +
      '可允許的理由:那個數是 `GREATEST(v_headroom,0)` = **order_manual_refunds 那本帳的餘裕**,' +
      '而同一句訊息下一行就逐字聲明「卡片刷的錢不算在這裡 —— 那要走卡片退款」' +
      '⇒ 它不宣稱、也答不出 `pcm_order_refundable_remaining` 那個數。' +
      // 三處分兩種(不寫行號 —— 行號會漂):
      '三處分兩種:**一處**是 UPDATE 時把自己那列加回餘裕(`v_cap + OLD.refund_amount`,標準的排除自己)' +
      '+ **兩處**是比較與 RAISE 的參數(`NEW.refund_amount`)⇒ 零聚合、零寫入。' +
      // 🔴 上游同表已允許:
      '🔴 上限來源是 `pcm_manual_refund_rail_cap`(同表 `20260824010000` 那筆已允許並載明理由),' +
      '本片沒有自己再算一次 ⇒ 它與那筆是**同一條鏈的下游**,不是第二個真相來源。' +
      // 🔴 可證偽(收窄,照同表 codex R2 nit #7 的教訓 —— 不寫證不到的可證偽性):
      '🔴 可證偽(收窄):本片一旦**多提或少提一次 refund_amount**,count 就不再是 3 ⇒ 本 gate 當場紅。' +
      '⚠️ 不涵蓋:寫 SUM、引入 order_refunds、換個名字自己算一份 —— 那三族本 gate 都掃不到。' +
      // 🔴 codex 2026-08-31 補一族,比上面三族更難看見:
      '🔴 也不涵蓋【抵銷】:同檔刪掉一處舊命中、同時新增一處危險命中 ⇒ count 仍是 3 ⇒ 全綠。' +
      '⇒ 逐檔數比對擋的是「數量變了」,不是「內容變了」——兩者在同一個 3 底下長得一樣。' +
      // ⚠️ 盲點:
      '⚠️ 盲點:本 gate 只比對字面,**答不出「這道 trigger 的觸發面對不對」**;' +
      '那一半的證人是本片自帶的前置/後置斷言與 `scripts/866-*`,而它們不在 CI。',
  },
};

/** TS 側「自己聚合退款金額」的字樣(啟發式,見檔頭上限 ②)。 */
const TS_AGGREGATION =
  /(?:reduce|\bsum\b|Sum|total|Total)[^;\n]{0,140}refund_?[aA]mount|refund_?[aA]mount[^;\n]{0,60}(?:reduce|\+)/g;

const TS_ALLOWLIST: Record<string, { count: number; why: string }> = {
  'apps/admin/src/lib/payment/refund-recovery-read.ts': {
    count: 1,
    why: '🔴 R12 = ledgerConfirmedSum,在 TS 裡 reduce 只算 confirmed 列。#473b-1 plan §2a 反向盤點漏抓、codex 關卡2 補上;不在本片修(見 plan §6-4)',
  },
  'apps/admin/src/lib/payment/refund-recovery-actions.ts': {
    count: 1,
    why: '🔴 R13 = ledgerConfirmedSum + refundAmount 的「恢復後累計」推算,吃 R12 的值;同樣不在本片修',
  },
};

/** 逐檔數「剝掉註解之後」的裸欄位命中數;0 的不列入。 */
function refundAmountByMigration(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    // 用 `code`:保留 dollar-quote 內容(函式本體在 `$$…$$` 裡),但註解已剝掉
    // ⇒ 只在**註解裡**提到欄名的檔不會誤紅。
    const { code } = scanSql(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    const n = code.match(REFUND_AMOUNT_COL)?.length ?? 0;
    if (n > 0) out[f] = n;
  }
  return out;
}

/** 遞迴列出 apps/ 與 packages/ 下的 .ts/.tsx(排除測試與產生的型別檔)。 */
function tsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', '.next', '.turbo'].includes(e.name)) continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== 'database.types.ts') {
        out.push(p);
      }
    }
  };
  for (const root of ['apps', 'packages']) {
    const d = join(REPO_ROOT, root);
    try { if (statSync(d).isDirectory()) walk(d); } catch { /* 目錄不在就跳過 */ }
  }
  return out;
}

function aggregationByTsFile(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of tsFiles()) {
    const src = readFileSync(p, 'utf8');
    // 剝掉 `//` 行註解:本 repo 的註解常常引述欄名與公式,不剝會整片誤紅。
    const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
    const n = code.match(TS_AGGREGATION)?.length ?? 0;
    if (n > 0) out[relative(REPO_ROOT, p)] = n;
  }
  return out;
}

/** 最新一支**定義** pcm_order_refundable_remaining 的 migration;查無回 null。 */
const REMAINING_DEF = /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.pcm_order_refundable_remaining\s*\(/m;

function latestRemainingFile(): string | null {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const { codeNoLiterals } = scanSql(readFileSync(join(MIGRATIONS_DIR, files[i]!), 'utf8'));
    if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.pcm_order_refundable_remaining\s*\(/i.test(codeNoLiterals)) {
      return files[i]!;
    }
  }
  return null;
}

/**
 * 現行生效 remaining 的**函式本體**(`AS $tag$` 到收尾 `$tag$`),取不到回 null。
 *
 * 🔴🔴 **為什麼一定要切出本體、不能對整個檔做 includes(定向突變當場抓到的恆綠格)**:
 *    2026-08-14 跑 mutation ②(把本體裡的更正 join 整段刪掉)時,本格**照樣綠** ——
 *    因為 `order_refund_effective_verdict` 這個名字在同一個檔的 `CREATE VIEW` 與兩段
 *    `COMMENT ON` 字串裡都有。對整檔 includes 等於在問「這個檔提過這個名字嗎」。
 * 🔴 **切本體必須用原文**:`scanSql` 會把 dollar-quote 的**分隔符本身吃掉**、只留內容,
 *    剝過的文字裡根本沒有 `$$` 可以當邊界(第一版就踩到,本格當場紅)。切完再 scanSql 剝註解。
 * 🔴 **取同檔的最後一個定義**(codex 關卡2 must-fix):同一支 migration 先寫正確版、
 *    後面再 `CREATE OR REPLACE` 成錯版時,取第一個會驗到已被取代的本體 = 假綠。
 */
function latestRemainingBody(): string | null {
  const file = latestRemainingFile();
  if (!file) return null;
  const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

  // 逐個找「行首 CREATE」的定義,取**最後一個**(同檔可能先寫正確版、後面再 OR REPLACE)。
  // 🔴 `--` 註解不可能長這樣,但 **block comment `/* … */` 裡可以**(codex R2 must-fix)。
  //    靜態分辨「這個 anchor 在不在 block comment 裡」要重寫一個 parser ⇒ 改成 **歧義即紅**:
  //    原文的 anchor 數必須等於「剝掉註解後」的 anchor 數;不等 = 有假 anchor,本 gate 先紅。
  const countIn = (t: string) => (t.match(new RegExp(REMAINING_DEF.source, 'gm')) ?? []).length;
  const rawHeads = countIn(raw);
  const codeHeads = countIn(scanSql(raw).codeNoLiterals);
  if (rawHeads !== codeHeads) return null; // 歧義 ⇒ 交給呼叫端轉紅(訊息在測試裡)

  const heads: number[] = [];
  const re = new RegExp(REMAINING_DEF.source, 'gm');
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) heads.push(m.index);
  if (heads.length === 0) return null;
  const head = heads[heads.length - 1]!;

  const open = /AS\s+\$([A-Za-z_][A-Za-z0-9_]*|)\$/.exec(raw.slice(head));
  if (!open) return null;
  const tag = `$${open[1]}$`;
  const bodyStart = head + open.index + open[0].length;
  const bodyEnd = raw.indexOf(tag, bodyStart);
  if (bodyEnd === -1) return null;
  return scanSql(raw.slice(bodyStart, bodyEnd)).code;
}

describe('「還能退多少」單一算式 gate(#473b-1 機制 2️⃣)', () => {
  it('🔴 載體① migrations:沒有新的檔碰 refund_amount(分母:supabase/migrations 全部 .sql)', () => {
    const actual = refundAmountByMigration();
    const expected = Object.fromEntries(Object.entries(SQL_ALLOWLIST).map(([f, v]) => [f, v.count]));

    const unexpected = Object.keys(actual).filter((f) => !(f in SQL_ALLOWLIST));
    expect(
      unexpected,
      `🔴 有新的 migration 碰到 order_refunds.refund_amount:\n` +
        unexpected.map((f) => `  · ${f}(${actual[f]} 處)`).join('\n') +
        `\n\n如果它自己算「已退 / 還能退」,那就是 #473b-1 要防的繞路:更正只會被` +
        `pcm_order_refundable_remaining 扣掉,自己算的地方看不到更正 ⇒ 報出的數比實際多 ⇒ 重複退款。` +
        `\n若確認無害,在本檔 SQL_ALLOWLIST 補一筆並寫清楚 why(而且要有人審過)。`,
    ).toEqual([]);

    // 逐檔數也要對得上 —— 只比對檔名集合的話,同一個檔裡多冒出一處會靜默溜過去。
    expect(actual).toEqual(expected);
  });

  it('🔴 載體② TS:沒有新的地方在 app 層自己聚合退款金額(分母:apps/ + packages/ 全部 .ts/.tsx)', () => {
    const actual = aggregationByTsFile();
    const expected = Object.fromEntries(Object.entries(TS_ALLOWLIST).map(([f, v]) => [f, v.count]));

    const unexpected = Object.keys(actual).filter((f) => !(f in TS_ALLOWLIST));
    expect(
      unexpected,
      `🔴 有新的 TS 位置自己聚合退款金額(reduce / sum / total):\n` +
        unexpected.map((f) => `  · ${f}(${actual[f]} 處)`).join('\n') +
        `\n\nDB 側的更正扣減對 app 層自己算的數**完全無效** —— 這正是 codex 關卡2 指出、` +
        `而 plan §2a 反向盤點漏抓的那一類(R12/R13)。` +
        `\n請改成讀 pcm_order_refundable_remaining,或在 TS_ALLOWLIST 補一筆並寫清楚 why。`,
    ).toEqual([]);

    expect(actual).toEqual(expected);
  });

  it('🔴 現行生效的 remaining 真的把更正扣掉(mutation ②:把 join 拿掉,本格必須紅)', () => {
    const file = latestRemainingFile();
    expect(file, 'supabase/migrations 內找不到任何定義 public.pcm_order_refundable_remaining 的 migration').not.toBeNull();

    const body = latestRemainingBody();
    expect(body, `切不出 ${file} 內 remaining 的函式本體(寫法非 canonical?)⇒ 本 gate 失去判別力,先紅`).not.toBeNull();

    expect(
      body!.includes('order_refund_effective_verdict'),
      `最新定義 remaining 的檔「${file}」裡,**函式本體**沒有 join order_refund_effective_verdict。` +
        `\n🔴 一筆被更正成 money_moved 的退款會重新被算成「還能退」⇒ 重複退款。` +
        `\n若這是刻意的(例如整片被回退),請同步改本 gate,**不要**只把這格刪掉。`,
    ).toBe(true);

    // 🔴🔴 **這裡的 `JOIN`(INNER)是【對的】—— 不要照 view 的 COMMENT 把它改成 LEFT JOIN。**
    //   `order_refund_effective_verdict` 的 COMMENT 逐字寫著(20260814190000 的 `COMMENT ON VIEW`,
    //   錨 = 「消費端用 LEFT JOIN、不要用 INNER」):沒有更正過的 refund **不會出現在本 view**
    //   ⇒ 消費端用 LEFT JOIN、不要用 INNER。
    //   ✅ 那句話**是對的**,而它是給【要列出全部退款】的消費端的。
    //   🔴 **而這一段不是那種消費端** —— 它只想加總「**被更正成 `money_moved`**」的那些列,
    //      本來就該把沒更正過的濾掉 ⇒ **INNER 正是它要的語意。**
    //   ⇒ 改成 LEFT JOIN 並把述詞搬進 `ON`,沒更正過的列會一起進來 ⇒ **算出來的「還能退」會變小**
    //     ⇒ 而那是一個【錢】的缺陷,`CHECK` 不會叫、三綠不會紅。
    //   📌 **一條正確的通則,套在錯的位置上會製造缺陷 —— 而 diff 上它看起來像在遵守規範。**
    //   ⚠️ 這段警語**刻意寫在這裡、不寫在那支 view 的 COMMENT 旁邊**:那支 migration 已 apply,
    //     而 `supabase/APPLIED.tsv` 記著它的 sha256 ⇒ **改它會讓那本帳對不上**。
    //     ⇒ 落點選【會被改動者讀到、而且改得動】的地方(2026-08-30 `-48` 指定要貼在碼旁邊,
    //       原話是貼在 COMMENT 旁 —— 我沒照字面做,理由就是上面這一格)。
    //
    // 🔴 只驗 view 名字會讓「`FROM … v` 但沒用到 v」也綠 ⇒ 連述詞一起釘(codex 關卡2)。
    expect(body!, '本體缺「只扣被更正成 money_moved 的那些」述詞').toContain("v.corrected_to = 'money_moved'");
    expect(body!, '本體缺「只吃 failed 列」述詞 ⇒ 可能與第一段 SUM 重複扣').toContain("r.status = 'failed'");
    expect(body!, '本體缺 manual_failed 限定 ⇒ 會把別種 failed 也扣掉').toContain("r.failed_reason = 'manual_failed'");
    // 🔴 方向:必須是**減**,而且要**綁在更正那一段上**(codex R2 must-fix)——
    //    只數全本體有幾個 `- COALESCE(` 的話,「把更正段改成加號、另外補一個無關的扣減」
    //    總數仍是 2、金額方向已經錯了卻全綠。
    expect(
      body!,
      '更正那一段必須是「減」:`- COALESCE( … order_refund_effective_verdict …`。'
        + '改成加號會讓帳本未登記額變大 ⇒ 退更多錢,是最貴的那個方向。',
    ).toMatch(/-\s*COALESCE\(\s*\(\s*SELECT[\s\S]{0,400}?order_refund_effective_verdict/i);
    // 第一段(processing/confirmed)同樣要是減。
    expect(
      body!,
      '第一段(processing + confirmed)必須是「減」',
    ).toMatch(/-\s*COALESCE\(\s*\(\s*SELECT[\s\S]{0,300}?processing/i);
  });

  // 🔴🔴 這一格是 codex R1 must-fix 補的:**補 allowlist 讓那道守門不紅,而沒有補上「誰來守新的東西」。**
  //   allowlist 的作用是「別對這支新檔報紅」—— 而它不會替代「第三段真的有作廢分流」這件事的守門。
  //   ⇒ 沒有本格的話,片 D3-b 落地之後,**任何人把 `AND m.voided_at IS NULL` 從那支函式刪掉,
  //     repo 裡零測試會紅**(migration 的 §4 A1 只在 apply 當下跑一次,不會在 CI 重跑)。
  it('🔴 現行生效的 remaining 真的排除已作廢的非卡退款(把 voided_at 分流刪掉,本格必須紅)', () => {
    const file = latestRemainingFile();
    expect(file, 'supabase/migrations 內找不到任何定義 public.pcm_order_refundable_remaining 的 migration').not.toBeNull();
    const body = latestRemainingBody();
    expect(body, `切不出 ${file} 內 remaining 的函式本體 ⇒ 本 gate 失去判別力,先紅`).not.toBeNull();

    // ⚠️ 本格的**前提**:最新定義它的那支檔必須已經是 D3-b(或之後)。
    //   若 D3-b 還沒落地,`file` 會是 20260820010000 而本格會紅 —— **那個紅是對的**:
    //   它在說「這個 repo 現在沒有作廢分流」,而不是「有人弄壞了」。
    expect(
      body!,
      `最新定義 remaining 的檔「${file}」裡,**函式本體**的第三段沒有排除已作廢的列。` +
        `\n🔴 一筆已經被作廢(登記錯了)的非卡退款會繼續被當成「已經退掉的錢」扣掉` +
        `\n⇒ 可退餘額變小 ⇒ **客人少拿到錢,而畫面上一切正常**。` +
        `\n若這是刻意的(例如 D3-b 被回退),請同步改本 gate,**不要**只把這格刪掉。`,
    ).toContain('m.voided_at IS NULL');

    // 🔴 只驗字面存在會讓「寫在別段」或「寫成註解」也綠 ⇒ 連**位置**一起釘:
    //   那個條件必須落在第三段(order_manual_refunds 那個 SUM)裡面。
    expect(
      body!,
      '作廢分流必須綁在**第三段(order_manual_refunds)**上 —— 寫在別段等於沒寫',
    ).toMatch(/order_manual_refunds\s+m[\s\S]{0,200}?m\.voided_at\s+IS\s+NULL/i);
    // 第三段同樣必須是「減」(方向與前兩段同一條紀律)。
    expect(
      body!,
      '第三段(非卡退款)必須是「減」',
    ).toMatch(/-\s*COALESCE\(\s*\(\s*SELECT[\s\S]{0,300}?order_manual_refunds/i);
  });

  // 🔴🔴 **這一格取代了一句我寫錯的話。**
  //   allowlist 的 why 原本寫「另立算式無法讓 §4 A1 三道同時通過」—— codex R2 構造反例證偽了它:
  //   A1 是三個**各自獨立**的子字串比對 ⇒ 一個「三段都在 + 另外多算一份」的版本三道全過。
  //   ⇒ 而**修法不是再加一道子字串,是換一種比對**:把整個函式本體正規化之後比對**全形狀**。
  //     多出來的任何一段、少掉的任何一段、改了方向的任何一段 —— 全形狀都會對不上。
  //   ⚠️ **而它的代價要講明**:任何**刻意**的改動也會讓它紅。那是特性不是缺陷 ——
  //     它要求改的人**回來把新的形狀貼進來**,而那一刻正是該有人看一眼的時刻。
  it('🔴 remaining 的函式本體【全形狀】沒有被動過(多算一份/少算一段/改方向,都會讓本格紅)', () => {
    const body = latestRemainingBody();
    expect(body, '切不出函式本體 ⇒ 本 gate 失去判別力,先紅').not.toBeNull();

    // 正規化:剝行註解 + 收斂空白。與 migration 的 §0/§4 用同一套規則,兩邊才比得起來。
    // ⚠️ 結尾分號也要吃掉:切出來的本體帶著它,而 EXPECTED 寫在 TS 樣板字串裡不會有。
    //   第一版沒吃 ⇒ 兩邊只差那一個字元而整格紅 —— **而那個紅是對的**(形狀真的不同),
    //   只是它指的是我的正規化不完整,不是函式被動過。
    const norm = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
    const actual = norm(body!);

    const EXPECTED = norm(`
      SELECT o.total::bigint
           - COALESCE(
               (SELECT SUM(r.refund_amount)
                  FROM public.order_refunds r
                 WHERE r.order_id = o.id
                   AND r.status IN ('processing', 'confirmed')), 0)
           - COALESCE(
               (SELECT SUM(r.refund_amount)
                  FROM public.order_refunds r
                  JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
                 WHERE r.order_id = o.id
                   AND r.status = 'failed'
                   AND r.failed_reason = 'manual_failed'
                   AND v.corrected_to = 'money_moved'), 0)
           - COALESCE(
               (SELECT SUM(m.refund_amount)
                  FROM public.order_manual_refunds m
                 WHERE m.order_id = o.id
                   AND m.voided_at IS NULL), 0)
        FROM public.orders o
       WHERE o.id = p_order_id
    `);

    expect(
      actual,
      '可退餘額函式的本體形狀變了。**本格不判斷那個改動是對是錯 —— 它只要求有人看一眼。**' +
        '\n🔴 若那是刻意的改動:把新的形狀貼進本格的 EXPECTED,並在 commit body 說明改了哪一段、為什麼。' +
        '\n🔴 若你不知道為什麼會紅:**先不要改本格** —— 去 git log 看最近誰動了那支函式。' +
        '\n⚠️ 而行為(這支算式接上 admin_void_manual_refund 之後對不對)在 scripts/d3b-void-probe.sh,本格不驗。',
    ).toBe(EXPECTED);
  });

  it('🔴 view 的「最新一筆說了算」語意有被釘住(排序改 ASC 會讓舊更正生效)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    let viewSql: string | null = null;
    for (let i = files.length - 1; i >= 0; i--) {
      const { code } = scanSql(readFileSync(join(MIGRATIONS_DIR, files[i]!), 'utf8'));
      // 🔴 認 `CREATE OR REPLACE VIEW`,並取**同檔最後一個**定義(codex R2 must-fix:
      //    否則後面用 OR REPLACE 換成錯版時,gate 會驗到前面那個舊的 = 假綠)。
      const re = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.order_refund_effective_verdict[\s\S]*?;/gi;
      const all = code.match(re);
      if (all && all.length > 0) { viewSql = all[all.length - 1]!; break; }
    }
    expect(viewSql, '找不到 order_refund_effective_verdict 的 CREATE VIEW').not.toBeNull();
    expect(viewSql!, 'view 少了 DISTINCT ON(refund_id)⇒ 一筆 refund 會回多列').toMatch(/DISTINCT\s+ON\s*\(\s*c\.refund_id\s*\)/i);
    // 🔴 `seq DESC` 是「最新一筆說了算」(Sean Q-473-1=A)的全部;改成 ASC 會靜默讓**最舊**那筆生效。
    expect(viewSql!, 'view 的排序不是 seq DESC ⇒ 生效的會變成最舊那筆更正').toMatch(/ORDER\s+BY\s+c\.refund_id\s*,\s*c\.seq\s+DESC/i);
  });

  it('gate 自我防呆:兩張 ALLOWLIST 每一筆都要有 why(不准只寫個數字混過去)', () => {
    for (const [f, v] of [...Object.entries(SQL_ALLOWLIST), ...Object.entries(TS_ALLOWLIST)]) {
      expect(v.why.trim().length, `${f} 的 ALLOWLIST 缺 why`).toBeGreaterThan(10);
    }
  });
});
