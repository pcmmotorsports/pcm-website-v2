// @vitest-environment node
//
// #216:運費門檻雙處 hardcode(domain shipping.ts FREE_SHIPPING_THRESHOLD/HOME_SHIPPING_FEE
//   ↔ create_order RPC §7 `CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END`)原無 CI gate、
//   改一處忘另一處會靜默漂移(顯示運費 ≠ 實際成交運費)。本測補對比守門。
//
// 純讀已 commit 的 .sql(非連線 live DB)→ 抓**最新一支定義 create_order 的 migration**的 §7 運費 CASE、
// assert == TS 常數。取「最新」(時戳前綴最大者)= 當前生效定義
// (後者勝:同簽章走 CREATE OR REPLACE;🔴 M-4a B-2 起改參數數量的片走 DROP + CREATE ——
//  PG 不允許用 CREATE OR REPLACE 改參數數量,那會產生 overload 而非取代);故未來運費若調整,
// superseded 舊 migration 保留舊值不誤紅。改運費須同步「TS 常數 + 新 migration」兩處,本 gate 即攔任一處漏改。
//
// 🔴 **anchor = 「定義 create_order」而非「命中運費 CASE regex」**(2026-07-25 codex 關卡2 R3 複驗抓出、
//   Sean 拍 A 當場修):舊版是「由新往舊翻、第一個**命中 CASE regex** 的檔就採用」。實查當時 7 支
//   migration 都定義 create_order 且 7 支都命中 regex ⇒ 一旦最新那支把 CASE 寫成 regex 抓不到的形狀
//   (**RF2a-0/RF2b 正要把運費改成讀凍結欄位/變數**,例如 `v_subtotal >= v_free_threshold`),
//   gate 會**靜默退回已被取代的舊 migration**、永遠綠,而真正生效的運費已漂走 = 假綠。
//   現行語意:最新那支**抓不到 CASE 就直接紅**(附指示訊息),不准回退。
//   ⚠️ 另有 1 支(`20260612150000_m3_s2d_charge_attempts.sql`)只在 DROP/GRANT 提到 create_order、
//   並未定義它 ⇒ anchor regex 必須要求 `CREATE [OR REPLACE] FUNCTION`,不能只比對函式名。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { calculateShippingFee, FREE_SHIPPING_THRESHOLD, HOME_SHIPPING_FEE } from './shipping';
import { toMoneyAmount } from '../shared/types';

// packages/domain/src/order/ → repo root 上 4 層 → supabase/migrations
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');
// §7 運費 CASE:`v_subtotal >= <門檻> THEN 0 ELSE <未滿運費> END`
const SHIPPING_CASE = /v_subtotal\s*>=\s*(\d+)\s*THEN\s*0\s*ELSE\s*(\d+)\s*END/;
// 🔴 anchor:必須是「定義」create_order 的檔(排除只 DROP/GRANT/COMMENT 提到函式名的 migration)
const CREATE_ORDER_DEF = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.create_order\s*\(/i;

/**
 * 引號感知的單次掃描:剝註解、並分離「字串/dollar-quote 內容」與「真正的 DDL 文字」。
 *
 * 🔴 為何不能用「一律 regex 剝掉 dash-dash 到行尾」(codex 關卡2 R2 抓出):單引號字串**裡面**的 `--`
 *   是資料、不是註解;粗暴 replace 會把該行後面的**真 DDL 吃掉** → anchor 回退舊 migration = 假綠。
 * 🔴 dollar-quote tag 允許數字(`$fn$` / `$func1$`);舊版 regex `[A-Za-z_]*` 讀不到 `$func1$`。
 *
 * 回傳三種視角:
 *   · `code`          = 剝掉註解、**保留**字串與 dollar-quote 內容(create_order 的運費 CASE 就在 `$$…$$` 裡)
 *   · `codeNoLiterals`= 再把字串與 dollar-quote 整塊清空(判斷「真的寫在 DDL 上」用)
 *   · `literals`      = 每一段字串/dollar-quote 內容(逐段判斷動態 DDL 用)
 * ⚠️ dollar-quote 內容視為「程式碼」(PL/pgSQL 本體)→ 遞迴剝它裡面的 `--` 註解。
 */
function scanSql(sql: string): { code: string; codeNoLiterals: string; literals: string[] } {
  let code = '';
  let codeNoLiterals = '';
  const literals: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      let depth = 1; // PG 的 block comment 可嵌套
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2; continue; }
        if (sql.slice(i, i + 2) === '*/') { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; } // '' = 轉義的單引號
          j++;
          break;
        }
        j++;
      }
      const lit = sql.slice(i, j);
      literals.push(lit);
      code += lit; // 保留(字串內的 dash-dash 不得被當註解)
      codeNoLiterals += ' ';
      i = j;
      continue;
    }
    const dq = /^\$([A-Za-z_][A-Za-z0-9_]*|)\$/.exec(sql.slice(i));
    if (dq) {
      const tag = dq[0];
      const end = sql.indexOf(tag, i + tag.length);
      const inner = sql.slice(i + tag.length, end === -1 ? sql.length : end);
      const innerCode = scanSql(inner).code; // 內容當程式碼:遞迴剝其註解
      // 🔴 推「已剝註解」的版本(Fable nit):否則 DO block 內一行提到 ALTER…SET DEFAULT 的
      //   **註解**就會讓下游的動態 DDL 偵測假陽性轉紅。
      literals.push(innerCode);
      code += innerCode;
      codeNoLiterals += ' ';
      i = end === -1 ? sql.length : end + tag.length;
      continue;
    }
    code += sql[i];
    codeNoLiterals += sql[i];
    i++;
  }
  return { code, codeNoLiterals, literals };
}

/** 最新一支**定義** create_order 的 migration 檔名(= 當前生效定義);查無回 null。 */
function latestCreateOrderFile(): string | null {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 檔名時戳前綴升冪 → 由後往前找,第一個「定義」create_order 的即最新生效定義
  for (let i = files.length - 1; i >= 0; i--) {
    // 🔴 必須剝註解(codex 關卡2 R1):否則較新的 migration 只要**註解裡**出現
    //   `CREATE FUNCTION public.create_order(` 就會被當成當前生效定義 → 三方假綠。
    //   用 `code`(保留 dollar-quote 內容):函式本體與運費 CASE 都在 `$$…$$` 內。
    // 🔴 anchor 判定用 codeNoLiterals(Fable nit):函式頭是頂層 DDL、不會在字串內;
    //   用含字串的版本會讓「COMMENT 文字裡剛好有 CREATE FUNCTION public.create_order(」變成假 anchor。
    if (CREATE_ORDER_DEF.test(scanSql(readFileSync(join(MIGRATIONS_DIR, files[i]!), 'utf8')).codeNoLiterals)) {
      return files[i]!;
    }
  }
  return null;
}

// ── RF2a-0:第三方 = `orders` 兩個凍結欄的欄位 DEFAULT ──
// 🔴 anchor 語意與上面一致(R3-5):對照「最新一支**試圖設定該欄 DEFAULT** 的 migration」;
//   那支解析不出數字 → **回 null 讓 gate 紅**,絕不往舊 migration 回退(回退=對照已作廢規則的假綠)。
//   只是「提到」欄名(建索引、改註解)的檔會被跳過、繼續往舊找 —— 那不是規則變更。
const FROZEN_COLS = ['shipping_free_threshold', 'shipping_home_fee'] as const;

/**
 * 🔴 誠實邊界(codex 關卡2 R1 指出、已評估):本 gate 是**文字比對啟發式**、不是 SQL parser,
 *   非 canonical DDL 寫法理論上仍可能繞過。**不引入 SQL AST 依賴**的理由=範圍擴張;
 *   真正 catalog 層級的權威驗證放在 migration 自己的 §4 自檢(apply 時逐項斷言型別 / NOT NULL /
 *   DEFAULT 逐字 / CHECK convalidated,不符即 RAISE 拒套用)⇒ **CI 文字 gate + apply 時 catalog
 *   自檢** 兩層互補。本函式只負責「離線就能抓到的漏改」。
 */
type FrozenDefaultLookup =
  | { ok: true; value: number; file: string }
  | { ok: false; reason: string };

function latestFrozenDefault(col: string): FrozenDefaultLookup {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const c = `"?${col}"?`; // 允許 quoted identifier
  // 🔴 `COLUMN` 在 `ALTER TABLE ... ALTER [COLUMN] x SET DEFAULT` 中**可省略**(codex 關卡2 R1:
  //   省略時舊版比對不到 → 被當「只是提到」→ 退回舊 migration = 正是要防的假綠形狀)。
  const setsDefault = new RegExp(`(ADD\\s+COLUMN[^;]*?${c}|ALTER\\s+(?:COLUMN\\s+)?${c}\\s+SET\\s+DEFAULT)`, 'i');
  // 🔴 抓「整個 DEFAULT 值表達式」再驗它是不是純整數(Fable nit):舊版只抓第一個數字,
  //   `SET DEFAULT 100 + 50` 會被讀成 100(實際 150)= 假綠。非純整數 ⇒ 判歧義轉紅。
  const explicitSet = new RegExp(`ALTER\\s+(?:COLUMN\\s+)?${c}\\s+SET\\s+DEFAULT\\s+([^,;]+)`, 'i');
  const addColumn = new RegExp(`${c}[^;,]*?DEFAULT\\s+([^,;]+)`, 'i');
  const pureInt = /^-?\d+$/; // 負號也要吃進來,讓 `-5000` 被看見並在等值斷言轉紅
  // 🔴 拿掉 DEFAULT / 砍掉欄位再他處重建 —— 換個動詞的同一種假綠,一律判歧義(Fable nit)
  //   🔴 `DROP DEFAULT` 必須鎖定欄名(Fable R2 nit):否則未來動 orders **別的欄**的 DROP DEFAULT
  //      會讓兩個凍結欄的 gate 一起誤紅(fail-closed 噪音)。
  const destructive = new RegExp(
    `(ALTER\\s+(?:COLUMN\\s+)?${c}\\s+DROP\\s+DEFAULT|DROP\\s+COLUMN[^;]*?${c})`,
    'i',
  );
  // 🔴 必須限定目標表(codex 關卡2 R2):別的 schema/table 有同名欄位時,它的 SET DEFAULT
  //   會被誤當成 orders 的規則 → 假綠。
  const targetsOrders = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?orders"?\b/i;
  // 動態 DDL:`EXECUTE format('ALTER TABLE ... SET DEFAULT %s', ...)` 靜態讀不出值 ⇒ 一律歧義
  const dynamicDdl = /ALTER\s+TABLE[\s\S]*?SET\s+DEFAULT/i;

  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i]!;
    const { code, codeNoLiterals, literals } = scanSql(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));

    // 🔴 兩邊都 fail-closed(codex 關卡2 R1/R2):剝字串能防「未執行的字串偽造 anchor」,但會有
    //   **反向盲點** —— `EXECUTE 'ALTER TABLE ... SET DEFAULT n'` / `format(...%I...)` 是**真的會執行**
    //   的動態 DDL,剝掉就看不見 = 假綠。靜態分辨不了 ⇒ 只要「設定 DEFAULT 的字樣落在字串/
    //   dollar-quote 內」或「任何一段 literal 自己就是一段設 DEFAULT 的 DDL」就判定歧義 → 紅。
    if (setsDefault.test(code) && !setsDefault.test(codeNoLiterals)) {
      return { ok: false, reason: `${file}:偵測到 literal/dynamic-DDL 歧義(設定 DEFAULT 的字樣只出現在字串或 dollar-quote 內)` };
    }
    if (literals.some((lit) => dynamicDdl.test(lit))) {
      return { ok: false, reason: `${file}:偵測到動態 DDL(literal 內含 ALTER TABLE … SET DEFAULT),靜態無法判定生效值` };
    }

    // 只看「動 orders 的那些 statement」:以 `;` 粗切,再挑目標表正確者
    const ordersStatements = codeNoLiterals.split(';').filter((s) => targetsOrders.test(s));
    if (ordersStatements.length === 0) continue;

    const destroyed = ordersStatements.find((s) => destructive.test(s));
    if (destroyed) {
      return { ok: false, reason: `${file}:偵測到對 ${col} 的 DROP DEFAULT / DROP COLUMN,無法靜態判定生效值` };
    }

    const scoped = ordersStatements.filter((s) => setsDefault.test(s));
    if (scoped.length === 0) continue; // 動了 orders 但沒設這個欄的 DEFAULT(建索引/加別的欄)→ 往舊找

    for (const stmt of scoped) {
      const m = explicitSet.exec(stmt) ?? addColumn.exec(stmt);
      if (!m) continue;
      const raw = m[1]!.trim();
      if (!pureInt.test(raw)) {
        return { ok: false, reason: `${file}:${col} 的 DEFAULT 表達式「${raw}」不是純整數常數,無法靜態判定生效值` };
      }
      return { ok: true, value: Number(raw), file };
    }
    // 🔴 有設定意圖卻解析不出 → 紅、**不回退**舊 migration
    return { ok: false, reason: `${file}:有設定 ${col} DEFAULT 的 statement,但解析不出值(寫法非 canonical?)` };
  }
  return { ok: false, reason: `supabase/migrations 內找不到任何設定 public.orders.${col} DEFAULT 的 statement` };
}

/** 測試斷言用:取值,取不到就用 reason 直接 fail(訊息說清楚是哪一種失敗)。 */
function frozenDefaultValue(col: string): number {
  const r = latestFrozenDefault(col);
  if (!r.ok) {
    throw new Error(
      `#216 三方 gate 無法取得 public.orders.${col} 的 DEFAULT —— ${r.reason}。` +
        '🔴 若你剛改了運費規則,請同步更新本 gate 的 regex 或改為對照 catalog;' +
        '**不要**讓它退回舊 migration 對照:那會變成拿已作廢的規則對帳(假綠)。',
    );
  }
  return r.value;
}

/**
 * 最新生效 create_order 的 §7 運費兩數。
 * 🔴 **不回退**:最新那支定義檔抓不到運費 CASE 就回 null(→ gate 紅),
 *    絕不改去讀舊 migration(那會產生「對照已作廢定義」的假綠)。
 */
function latestCreateOrderShipping(): { threshold: number; fee: number; file: string } | null {
  const file = latestCreateOrderFile();
  if (!file) return null;
  // 同樣剝註解:防「新 migration 的註解裡貼了舊 CASE」被當成生效值
  const m = scanSql(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')).code.match(SHIPPING_CASE);
  if (!m) return null;
  return { threshold: Number(m[1]), fee: Number(m[2]), file };
}

describe('運費門檻 TS ↔ create_order RPC §7 drift gate(#216)', () => {
  it('gate 已接線:最新 create_order 定義檔存在,且其 §7 運費 CASE 可解析(🔴 抓不到就紅、不回退舊檔)', () => {
    const file = latestCreateOrderFile();
    expect(file, 'supabase/migrations 內找不到任何定義 public.create_order 的 migration').not.toBeNull();

    const sql = latestCreateOrderShipping();
    expect(
      sql,
      `最新 create_order 定義檔「${file}」內解析不到 §7 運費 CASE(regex=${SHIPPING_CASE})。` +
        '🔴 這代表運費算法已改寫形狀(例如 RF2a-0/RF2b 改讀 orders 凍結欄位或用變數)—— ' +
        '請同步改本 gate(更新 SHIPPING_CASE,或改為對照欄位 DEFAULT),' +
        '**不要**讓它退回舊 migration 對照:那會變成「拿已作廢定義對帳」的假綠。',
    ).not.toBeNull();

    // 三方 gate 的對照基準必須就是那支最新定義檔(防未來又被改成回退式搜尋)
    expect(sql!.file).toBe(file);
  });

  it('最新 create_order migration §7 門檻 == domain FREE_SHIPPING_THRESHOLD', () => {
    const sql = latestCreateOrderShipping();
    expect(sql?.threshold).toBe(FREE_SHIPPING_THRESHOLD);
  });

  it('最新 create_order migration §7 未滿運費 == domain HOME_SHIPPING_FEE', () => {
    const sql = latestCreateOrderShipping();
    expect(sql?.fee).toBe(HOME_SHIPPING_FEE);
  });

  // ── RF1 擴充:gate 由「TS 常數 ↔ SQL」兩方擴為「TS 常數 ↔ 預設規則 ↔ SQL」三方 ──
  //
  // 🔴 為何必須加(codex 關卡1 R2-F1):RF1 給 calculateShippingFee 加了選填第三參數 `rule`,
  //   預設值為模組私有的 DEFAULT_SHIPPING_RULE。若該預設值另寫字面數字而非由常數衍生,
  //   它可獨立漂走 —— 而「兩參呼叫 vs 三參傳 DEFAULT」的等價測試會**同源假綠**
  //   (兩邊都吃同一個錯的 default → 永遠相等),兩方 gate 也抓不到,但 storefront 顯示的運費已變。
  // 🔴 v6(codex 關卡2 R2 must-fix):DEFAULT_SHIPPING_RULE 已改為**模組私有、完全不 export**
  //   (防 RF5 寫 fallback)→ 本 gate 改以**行為**驗證預設值,不直接斷言物件欄位。
  const twd = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });

  it('預設規則的免運門檻(行為驗證)== FREE_SHIPPING_THRESHOLD', () => {
    expect(calculateShippingFee(twd(FREE_SHIPPING_THRESHOLD), 'home').amount).toBe(0);
    expect(calculateShippingFee(twd(FREE_SHIPPING_THRESHOLD - 1), 'home').amount).toBe(HOME_SHIPPING_FEE);
  });

  it('預設規則的未滿運費(行為驗證)== HOME_SHIPPING_FEE', () => {
    expect(calculateShippingFee(twd(0), 'home').amount).toBe(HOME_SHIPPING_FEE);
  });

  it('預設規則 == 最新 create_order migration §7 兩數(行為驗證)', () => {
    const sql = latestCreateOrderShipping();
    expect(calculateShippingFee(twd(sql!.threshold), 'home').amount).toBe(0);
    expect(calculateShippingFee(twd(sql!.threshold - 1), 'home').amount).toBe(sql!.fee);
  });
});

// ── RF2a-0 擴充:gate 由「TS 常數 ↔ RPC CASE」擴為「TS 常數 ↔ RPC CASE ↔ orders 欄位 DEFAULT」三方 ──
//
// 🔴 為何必須加:Q6=B 把「下單當時的運費規則」凍結進 `orders` 兩個欄位的 DEFAULT。
//   若日後改運費卻只改了 TS 常數與 create_order、漏改欄位 DEFAULT →
//   新訂單會**凍結到舊規則**,而退款(RF5→RF1)只准讀凍結欄 ⇒ 退款金額用錯規則算 = 算錯錢,
//   且前台顯示與實際成交都還是新規則、完全看不出來。三方任一漏改,本 gate 就紅。
describe('運費規則凍結欄 DEFAULT ↔ TS 常數 ↔ RPC CASE 三方 drift gate(#216 + RF2a-0)', () => {
  it('gate 已接線:兩個凍結欄都找得到「設定 DEFAULT」的 statement 且數字可解析(🔴 抓不到就紅、不回退舊檔)', () => {
    for (const col of FROZEN_COLS) {
      const r = latestFrozenDefault(col);
      expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    }
  });

  it('凍結欄 DEFAULT == TS 常數(FREE_SHIPPING_THRESHOLD / HOME_SHIPPING_FEE)', () => {
    expect(frozenDefaultValue('shipping_free_threshold')).toBe(FREE_SHIPPING_THRESHOLD);
    expect(frozenDefaultValue('shipping_home_fee')).toBe(HOME_SHIPPING_FEE);
  });

  it('凍結欄 DEFAULT == 最新 create_order §7 運費 CASE 兩數(三方閉環)', () => {
    const sql = latestCreateOrderShipping();
    expect(frozenDefaultValue('shipping_free_threshold')).toBe(sql!.threshold);
    expect(frozenDefaultValue('shipping_home_fee')).toBe(sql!.fee);
  });

  it('凍結欄 DEFAULT 寫死期望值 5000 / 100(不由被測常數推導、防同源假綠)', () => {
    expect(frozenDefaultValue('shipping_free_threshold')).toBe(5000);
    expect(frozenDefaultValue('shipping_home_fee')).toBe(100);
  });
});
