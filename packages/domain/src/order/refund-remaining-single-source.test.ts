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
      t.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
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
