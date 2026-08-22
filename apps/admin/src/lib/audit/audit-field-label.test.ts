import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_FIELD_LABEL,
  AUDIT_VALUE_LABEL,
  WHOLE_PAYLOAD_KEY,
  formatAuditFieldKey,
  formatAuditFieldValue,
} from './audit-field-label';
import { diffAuditPayload } from './audit-diff';

// audit-field-label.test.ts — 「改了什麼」那欄的中文化守門。
//
// 🔴 **本檔擋三件事,而其中兩件的失敗都【看起來完全正常】**:
//   ① 未對照的欄位靜靜印原文 ⇒ 畫面就是今天的樣子,沒有任何東西會紅
//   ② 識別碼被翻掉 ⇒ 中文很好看,而它對不上銀行的帳
//   ③ `(整筆)` 被誤標成「還沒對照」⇒ 那是我們自己產的中文鍵,標了會嚇到人

/**
 * 掃 migrations 裡**真的會執行**的稽核 INSERT,取其 payload 欄位名。
 *
 * 🔴 **只有這樣才是集合比對** —— 抄一份清單進測試,等於把同一個錯誤抄兩遍。
 * ⚠️ **限度寫清楚**:①只認 `jsonb_build_object` 的字面 key(動態組的 key 掃不到)
 *    ②`INSERT` 到下一個 `;` 當作一段(字串裡有分號會切錯,目前無此例)
 *    ③**排除註解與字串常數裡的假 INSERT**(字面 41 段、可執行 29 段)。
 */
function scanMigrationPayloadKeys(): string[] {
  const dir = resolve(__dirname, '../../../../../supabase/migrations');
  const keys = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(resolve(dir, file), 'utf8');
    for (const m of sql.matchAll(/INSERT\s+INTO\s+public\.admin_audit_log/gi)) {
      const lineStart = sql.lastIndexOf('\n', m.index) + 1;
      const prefix = sql.slice(lineStart, m.index);
      // 行內註解 / 落在單引號字串中段 ⇒ 這一段不會執行,不算分母。
      if (prefix.includes('--') || (prefix.split("'").length - 1) % 2 === 1) continue;
      const seg = sql.slice(m.index, sql.indexOf(';', m.index) + 1);
      for (const b of seg.matchAll(/jsonb_build_object\s*\(/gi)) {
        for (const k of oddPositionLiterals(balancedBody(seg, b.index + b[0]!.length))) {
          keys.add(k);
        }
      }
    }
  }
  return [...keys];
}

/** 從 `(` 之後起算,取到**配對的** `)` 為止。 */
function balancedBody(src: string, from: number): string {
  let depth = 1;
  let i = from;
  for (; i < src.length && depth > 0; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') depth -= 1;
  }
  return src.slice(from, i - 1);
}

/**
 * 頂層逗號切開,取**奇數位**(第 1、3、5… 個)的字串字面 = key。
 *
 * 🔴 **不能用「引號包住的小寫字串」當 key 的判準** —— 那會把**值**也撈進來:
 *    `jsonb_build_object('kind', 'full')` 的 `full` 是值,不是欄位名。
 *    ⇒ 撈進來之後,「字典裡有沒有多餘欄位」那格會噴一堆假的 orphan,
 *      而「有沒有漏」那格會**變寬鬆**(分母被灌水,而灌進來的都不在字典裡…
 *      不,更糟:它們會被當成該有中文的欄位)。**兩個方向都會壞。**
 */
function oddPositionLiterals(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = '';
  for (const c of body) {
    if (c === "'") inQuote = !inQuote;
    if (!inQuote) {
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      else if (c === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  parts.push(cur);
  return parts
    .filter((_, i) => i % 2 === 0)
    .map((p) => /^\s*'([^']+)'\s*$/.exec(p)?.[1])
    .filter((k): k is string => k !== undefined);
}

/**
 * app 層寫入端產生、而 migrations 掃不到的欄位。
 * 🔴 **只掃 migrations 會少這幾個** —— 而 Sean 2026-08-22 看到的那一列**整筆都是 app 層寫的**。
 * 來源:`payment/refund-unknown-state-audit.ts` `buildAfter()` 與 `staff-repository.ts` `StaffRow`。
 */
const APP_WRITER_KEYS = [
  'site',
  'error_class',
  'resolved_status_type',
  'resolved_status_length',
  'id',
  'is_manager',
];

describe('欄位名稱 → 中文', () => {
  it('已登記的欄位回中文、known=true', () => {
    expect(formatAuditFieldKey('refund_amount')).toEqual({ label: '退款金額', known: true });
    expect(formatAuditFieldKey('rec_trade_id')).toEqual({ label: 'TapPay 交易編號', known: true });
  });

  it('🔴 未登記的欄位:原代碼原樣回傳,而且 known=false', async () => {
    // 🔴 **兩件事一起斷言,少一件都不夠**:
    //   只斷言 `known:false` ⇒ 有人把 label 改成「未知欄位」照樣綠,而**追查用的代碼被吃掉了**;
    //   只斷言原樣回傳 ⇒ 那就是今天的行為(靜靜印原文),這格會恆綠。
    expect(formatAuditFieldKey('a_key_nobody_registered')).toEqual({
      label: 'a_key_nobody_registered',
      known: false,
    });
  });

  it('🔴 `(整筆)` 是我們自己產的中文鍵 ⇒ 不得被標成未對照', () => {
    // `audit-diff.ts` 在 payload 不是物件時產這個鍵。它本來就是中文,
    // 標上「還沒對照成中文」會讓員工去回報一個不存在的問題。
    expect(formatAuditFieldKey(WHOLE_PAYLOAD_KEY).known).toBe(true);
  });

  it('🔴 前提:`(整筆)` 的字面與 `audit-diff` 真的產出的那個一致(兩支檔各寫一份)', () => {
    // 🔴 這格擋的是**兩支檔各自為真而沒人對過**:`audit-diff.ts:118` 有一份字面,
    //    本模組有一份。改了其中一份,上面那格照樣綠(它用的是本模組自己的常數)。
    //    ⇒ 這裡拿 `diffAuditPayload` **真的跑出來**的鍵去比。
    const changes = diffAuditPayload('舊的整包', '新的整包');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.key).toBe(WHOLE_PAYLOAD_KEY);
    expect(formatAuditFieldKey(changes[0]!.key).known).toBe(true);
  });
});

describe('🔴🔴 值:識別碼不得被翻到', () => {
  it('沒有值字典的欄位 ⇒ 值原樣輸出(識別碼那一族)', () => {
    // 三個都是真的會出現在畫面上的識別碼形狀(Sean 2026-08-22 截圖)。
    expect(formatAuditFieldValue('bank_refund_id', 'D20260819P8ZewM')).toBe('D20260819P8ZewM');
    expect(formatAuditFieldValue('rec_trade_id', 'JtI9i1rusy9SQaCCBXVj')).toBe(
      'JtI9i1rusy9SQaCCBXVj',
    );
    expect(formatAuditFieldValue('order_id', '11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('🔴🔴 識別碼剛好長得像列舉值時,仍原樣輸出(全域字典會在這裡出事)', () => {
    // 🔴 **這格是本檔最重要的一條。** 若哪天有人把值字典攤平成一張全域
    //    `Record<值, 中文>`,上面那格仍然全綠(那三串不是任何列舉值),
    //    **只有這一格會紅** —— 而它模擬的正是全域表必然踩到的那一步。
    expect(formatAuditFieldValue('bank_refund_id', 'partial')).toBe('partial');
    expect(formatAuditFieldValue('tappay_refund_id', 'full')).toBe('full');
  });

  it('🔴 同一個字面在兩個欄位下必須翻成不同的中文(這就是不能用全域表的原因)', () => {
    // `partial` 是 `kind` 與 `reply_status` 的共同合法值,而中文不一樣。
    expect(formatAuditFieldValue('kind', 'partial')).toBe('部分退款');
    expect(formatAuditFieldValue('reply_status', 'partial')).toBe('只能供應一部分');
  });
});

describe('值:登記過的列舉值要翻', () => {
  it('Sean 螢幕上那三個英文值都有中文', () => {
    expect(formatAuditFieldValue('error_class', 'error_unclassified')).toBe('有錯誤,但分不出是哪一類');
    expect(formatAuditFieldValue('site', 'adapter_threw')).toBe('打 TapPay 的時候就出錯了');
    expect(formatAuditFieldValue('kind', 'partial')).toBe('部分退款');
  });

  it('布林欄的 true/false 也要翻(`display()` 序列化成字串)', () => {
    // ⚠️ 樣本一律用**真的是布林**的欄位。原本這裡用 `record_refunded_before`,
    //    而它是 `bigint`(見下一格)⇒ **測試全綠,卻在保護一個錯的語意。**
    expect(formatAuditFieldValue('has_bank_reference', 'true')).toBe('是');
    expect(formatAuditFieldValue('has_note', 'false')).toBe('否');
  });

  it('🔴🔴 `record_refunded_before` 是【金額】⇒ 值不得被翻成是/否', () => {
    // `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:159` `bigint NOT NULL`。
    // 🔴 這格擋的是**回歸**:它一度被登記成布林欄,而那時這支測試是綠的
    //    (因為當時的樣本就是拿它去測布林)。⇒ **樣本錯了,守門就跟著錯。**
    expect(formatAuditFieldValue('record_refunded_before', '0')).toBe('0');
    expect(formatAuditFieldValue('record_refunded_before', '50000')).toBe('50000');
    // 連 `'true'` 這種字面餵進去也不准變 —— 它不在任何值字典裡。
    expect(formatAuditFieldValue('record_refunded_before', 'true')).toBe('true');
  });

  it('🔴 登記過的欄位遇到【字集外】的值 ⇒ 原樣輸出,不亂猜', () => {
    // 字集會漂移(DB 端加一個新的 outcome,沒有人會來改這裡)。
    // 原樣輸出至少讓員工看得到真正的值;硬套一個中文才是把資訊弄丟。
    expect(formatAuditFieldValue('kind', 'something_new')).toBe('something_new');
  });
});

describe('🔴🔴 prototype 的洞:`constructor` / `toString` 不得被判成已對照', () => {
  // 稽核的 key 與值來自 **DB 的自由 jsonb**(`audit-diff.ts` 檔頭:每個寫入端形狀不同)
  // ⇒ 這不是理論輸入,是外部可控的輸入。
  it('key = `constructor` ⇒ 判成未對照,label 原樣回字串', () => {
    const r = formatAuditFieldKey('constructor');
    expect(r.known).toBe(false);
    expect(r.label).toBe('constructor');
    // 🔴 型別也要斷言:舊寫法回的是**函式**,而 `toBe('constructor')` 那條就已經會紅了,
    //    這條是為了讓紅的時候看得出「回的根本不是字串」。
    expect(typeof r.label).toBe('string');
  });

  it('key = `toString` / `hasOwnProperty` 同樣判成未對照', () => {
    expect(formatAuditFieldKey('toString').known).toBe(false);
    expect(formatAuditFieldKey('hasOwnProperty').known).toBe(false);
  });

  it('值 = `toString` ⇒ 原樣回傳,不得回一個函式', () => {
    const v = formatAuditFieldValue('kind', 'toString');
    expect(v).toBe('toString');
    expect(typeof v).toBe('string');
  });

  it('欄位不在值字典裡、而值是 `constructor` ⇒ 一樣原樣回傳', () => {
    expect(formatAuditFieldValue('bank_refund_id', 'constructor')).toBe('constructor');
  });

  it('🔴 正向對照:正常的 key/值仍然查得到(證明上面幾格不是把查找關掉了)', () => {
    expect(formatAuditFieldKey('refund_amount').known).toBe(true);
    expect(formatAuditFieldValue('kind', 'full')).toBe('全額退款');
  });
});

describe('字典本身的形狀', () => {
  it('🔴🔴 分母**集合比對**:每一個真的會被寫進稽核的欄位,都要有中文', () => {
    // 🔴 **原本這格只斷言「有 69 個」,而那是恆綠型守門**(codex R1 must-fix,它對):
    //    刪掉一個真欄位、再補一個假欄位,數字仍是 69 ⇒ **全綠,而畫面上那一欄退回英文。**
    //    ⇒ 改成拿**真的寫入端**當分母,逐一比對。這樣才擋得住「刪一個補一個」。
    //
    // ⚠️ **本格的分母是掃出來的,不是抄的** —— 掃法與 `audit-field-label.ts` 檔頭同一套,
    //    而**掃法本身若壞掉會安靜地回空集合** ⇒ 下面第一條是前提斷言,先證明掃得到東西。
    const scanned = scanMigrationPayloadKeys();
    expect(scanned.length, '前提:掃描器要真的掃得到東西(回空集合代表掃法壞了)').toBeGreaterThan(50);

    const missing = [...scanned, ...APP_WRITER_KEYS].filter((k) => !AUDIT_FIELD_LABEL[k]);
    expect(missing, '這些欄位會被寫進稽核,而字典裡沒有中文').toEqual([]);
  });

  it('🔴 反面:字典裡不得有【任何寫入端都不會產生】的欄位', () => {
    // 這一半擋的是「補一個假欄位把數字湊回去」。
    const known = new Set([...scanMigrationPayloadKeys(), ...APP_WRITER_KEYS]);
    const orphan = Object.keys(AUDIT_FIELD_LABEL).filter((k) => !known.has(k));
    expect(orphan, '字典裡有沒有任何寫入端會產生的欄位(拼錯?已移除?)').toEqual([]);
  });

  it('🔴 每個有值字典的欄位,自己也必須有中文名稱', () => {
    // 否則畫面會出現「英文欄名 + 中文值」的半套,而那比全英文更難讀。
    const missing = Object.keys(AUDIT_VALUE_LABEL).filter((k) => !AUDIT_FIELD_LABEL[k]);
    expect(missing).toEqual([]);
  });

  it('🔴 沒有任何欄位的中文名稱是空字串(空字串會靜靜變成空白格)', () => {
    const blank = Object.entries(AUDIT_FIELD_LABEL).filter(([, v]) => v.trim() === '');
    expect(blank).toEqual([]);
  });
});
