import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type BatchRow,
  checkBatchInput,
  maxRowsForBudget,
  recordsAsUnknown,
  shouldAbortBatch,
  summarizeBatch,
} from './procurement-batch-policy';

// procurement-batch-policy.test.ts — A9h-2 純決策層的守門。
//
// 🔴 這三支的共同點是「**算錯了不會炸、只會給錯數字**」⇒ 每一格都要有負向對照或突變靶,
//    否則它們是「看起來有測」而不是「測得出來」。

/**
 * 🔴🔴 **從源碼取出「全部 20 個碼」當測試宇宙**,不手工列舉。
 *
 * R1 #5 實測:第一版只數「**第一個 `return true` 之前**」的 case ⇒ 在後面另開一個
 * `case 'error': return true;` **16 格全綠**,逐碼格與結構格**同時被繞過**。
 * ⇒ 病根是「守門的宇宙是手工枚舉」——**枚舉寫下即過期**。
 * ⇒ 改成:宇宙從 `procurement-action-state.ts` 的型別定義**當場抽出來**,
 *    再斷言每一個碼落在預期那一側。新增一個碼而沒分類 ⇒ 下面第一格直接紅。
 */
function allFailureCodes(): string[] {
  const src = readFileSync(
    fileURLToPath(new URL('./procurement-action-state.ts', import.meta.url)),
    'utf8',
  );
  const block = src.slice(src.indexOf('export type ProcurementFailureCode'));
  // 🔴 邊界用**空行**不用第一個 `;` —— union 內的註解裡就有 `;`,
  //    第一版照 `;` 切只抽到 11 個碼(而它「看起來」正常運作)。
  const body = block.slice(0, block.indexOf('\n\n'));
  return [...new Set(body.match(/'[A-Za-z0-9_]+'/g) ?? [])].map((m) => m.slice(1, -1)).sort();
}

/** 可以繼續跑下一列的(員工自己改得掉的業務失敗)。 */
const CONTINUABLE = [
  'ALLOCATED_BELOW_RECEIVED',
  'EXPECTED_ARRIVAL_OUT_OF_RANGE',
  'INVALID_ALLOCATED',
  'INVALID_CONTACT_CHANNEL',
  'INVALID_EXCEPTION_REASON',
  'INVALID_REPLY_STATUS',
  'INVALID_SUPPLIER_ORDER_NO',
  'OVER_ALLOCATION',
  'SUBMITTED_AT_IN_FUTURE',
  'SUBMITTED_AT_OUT_OF_RANGE',
  'SUPPLIER_INACTIVE',
].sort();

describe('shouldAbortBatch — 哪些碼要讓整批停下', () => {
  it('🔴🔴 宇宙是 20 個碼,而且每一個都被分類過(新增未分類的碼 ⇒ 這格紅)', () => {
    const codes = allFailureCodes();
    // 正向對照:證明真的抽到東西、而且抽到的是那個型別(否則下面全是空集合上的恆真)。
    expect(codes).toContain('error');
    expect(codes).toContain('INVALID_INPUT');
    expect(codes).toHaveLength(20);
    // 每個碼都要有明確答案,而「可繼續」那側必須逐字等於 CONTINUABLE。
    const continuable = codes.filter((c) => !shouldAbortBatch(c as never)).sort();
    expect(continuable).toEqual(CONTINUABLE);
  });

  it('🔴🔴 **誤停面 = 0**:`classifyResult` 定義域那 14 個碼,fail-closed 之後答案一個都沒變', () => {
    // 🔴 這格答的是「把 default 反過來,有沒有把原本該繼續的情境誤判成中止」。
    //
    // 🔴🔴 **R2 MF1:第一版這段的理由是錯的,結論才是對的 —— 錯的理由會誤導下一個人。**
    // 原寫「本層閘 5 碼與 `'error'` 批次路徑**產不出來**」⇒ **反證在相鄰實作**:
    // `procurement-actions.ts:213-251` —— **同一支 `upsertItemProcurement()` 的 try/catch**
    // 把 `ProcurementCallerBugError` → `'bug'`(`:241`)、一般例外 → `'error'`(`:250`);
    // 母 plan `:171-172` 明文要 coordinator 處理這兩類例外 ⇒ **它必然產出同一組碼。**
    //
    // ⇒ **正確的說法(本格現在驗的)**:這 14 個碼是 **`classifyResult` 的定義域**
    //   (`shouldAbortBatch` 的定義域是 20),而**在這 14 個上面,新舊版答案逐個相同**。
    //   答案真正改變的是 `'error'` 與 `'bug'` —— 它們**到得了**,而**新答案正是母 plan `:172` 要求的**
    //   (「一般 DB/網路例外 ⇒ 記 `RESULT_UNKNOWN`、**中止整批**」)。
    // ⇒ **誤停面仍是 0**,但理由是「改變的那兩個本來就該改」,不是「它們到不了」。
    const src = readFileSync(
      fileURLToPath(new URL('./procurement-result.ts', import.meta.url)),
      'utf8',
    );
    const fn = src.slice(src.indexOf('export function classifyResult'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    const reachable = [...new Set(body.match(/case '[A-Z_]+'/g) ?? [])]
      .map((m) => m.slice(6, -1))
      .filter((c) => !['CREATED', 'UPDATED', 'NO_CHANGE'].includes(c))
      .sort();
    // 🔴🔴 **可達宇宙本身要被驗**(E 窗 R2 前指出):
    //    `toHaveLength(14)` 守的是「**數字是 14**」,**不守「這 14 個就是對的那 14 個」** ——
    //    抽錯來源(例如抽到另一個函式的 case)照樣可能剛好 14 個,而誤停面就會被算成 0 而實際不是。
    // ⇒ 改成**兩個獨立來源的結構關係**,不是一個數字、也不是手抄清單:
    //    ① 全宇宙 = `procurement-action-state.ts` 的型別(20)
    //    ② 可達集 = `procurement-result.ts` 的 switch(本格)
    //    斷言 ②⊂① 且「①−②」**恰好是那 6 個非 RPC 來源的碼**。
    //    任一邊漂移(新增碼、改 switch、改型別)⇒ 這格紅,而**不需要有人記得更新一份清單**。
    const universe = allFailureCodes();
    expect(reachable.every((c) => universe.includes(c))).toBe(true);
    expect(universe.filter((c) => !reachable.includes(c)).sort()).toEqual(
      ['bug', 'denied', 'error', 'invalid', 'not_hydrated', 'stale'].sort(),
    );
    // 🔴 **跨檔內容檢查**(上面那條結構關係擋不住「手抄推導」——實測:把 `reachable` 改成
    //    `universe - 那 6 個`,結構關係會變成**循環恆真**、29 格照樣全綠)。
    //    這條問的是**內容**:每個可達碼都必須**真的出現在 `procurement-result.ts` 的 switch 裡**。
    //    ⇒ 有人從 `classifyResult` 拿掉一個 case 時:真推導會縮到 13(上面那條紅);
    //      手抄推導仍是 14,但**那個碼在 `procurement-result.ts` 裡找不到** ⇒ 本條紅。
    // 🔴🔴 **R2 N4:讓本條紅的是「兩件事同時發生」,不是一件。**
    //    在**真推導**下 `reachable` 就是從 `body` 抽的 ⇒ 本條**恆真**;
    //    只有「①測試改成手抄推導 **且** ②實作漂移(`classifyResult` 少一個 case)」**同時**成立才紅
    //    (E 窗 M2/M3 實測:單獨①⇒29 格全綠、①+②⇒本條紅並逐字點名)。
    //    ⇒ **不要把它讀成「擋得住手抄推導」** —— 它擋的是「手抄推導**之後**實作再漂移」。
    //    單獨的手抄推導**目前沒有任何一格擋得住**,那是已知缺口。
    for (const code of reachable) {
      expect(body, `${code} 不在 classifyResult 的 switch 裡`).toContain(`case '${code}'`);
    }
    // 保留數字當第三道(便宜)。
    expect(reachable).toHaveLength(14);
    // 🔴 本體:到得了的碼裡面,中止的**只有那 3 個呼叫端 bug 型**。
    const abortsAmongReachable = reachable.filter((c) => shouldAbortBatch(c as never)).sort();
    expect(abortsAmongReachable).toEqual([
      'INVALID_INPUT',
      'ORDER_ITEM_NOT_FOUND',
      'SUPPLIER_NOT_FOUND',
    ]);
    // 🔴 `'error'` / `'bug'` 確實不在**這個**宇宙裡 —— 但那只代表「不是 RPC 回傳碼」,
    //    **不代表批次路徑產不出來**(MF1:它們由 catch 產出)。這兩條釘的是**宇宙的邊界**,
    //    不是可達性。它們的中止/未知判定由 `recordsAsUnknown` 那組格子守。
    expect(reachable).not.toContain('error');
    expect(reachable).not.toContain('bug');
  });

  it('🔴🔴 `error` 必須中止 —— 它的訊息逐字是「採購可能已經寫進去了」', () => {
    // R1 #3/#4:第一版 default 回 false ⇒ `error` 答「繼續」,與母 plan :172 相反。
    // 失敗情境:寫入結果未知卻繼續跑,而那一列可能已經寫進去了。
    expect(shouldAbortBatch('error')).toBe(true);
  });

  it('🔴 三個呼叫端 bug 型必須中止', () => {
    expect(shouldAbortBatch('INVALID_INPUT')).toBe(true);
    expect(shouldAbortBatch('ORDER_ITEM_NOT_FOUND')).toBe(true);
    expect(shouldAbortBatch('SUPPLIER_NOT_FOUND')).toBe(true);
  });

  it('🔴 `EXPECTED_ARRIVAL_OUT_OF_RANGE` **不得**中止 —— 它是可改輸入型', () => {
    // `procurement-result.ts:34` 特地警告過「別一起收進去」。
    // 失敗情境:員工一批 50 列,其中一列日期打錯 ⇒ 整批停住,另外 49 列白等。
    expect(shouldAbortBatch('EXPECTED_ARRIVAL_OUT_OF_RANGE')).toBe(false);
  });

  it('🔴 default 的方向必須是「中止」(fail-closed)—— 源碼契約', () => {
    // R1 #3 的病根是方向寫反。這格釘方向本身,不釘清單內容。
    // 突變靶:把 `default: return true` 改回 `return false` ⇒ 這格紅(上面第一格也會紅)。
    const src = readFileSync(
      fileURLToPath(new URL('./procurement-batch-policy.ts', import.meta.url)),
      'utf8',
    );
    const fn = src.slice(src.indexOf('export function shouldAbortBatch'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/default:[\s\S]*return true;/);
    expect(body).not.toMatch(/default:[\s\S]*return false;/);
  });
});

describe('recordsAsUnknown — 哪些結局要記「結果未知」而不是「失敗」', () => {
  it('🔴🔴 三個為真,共同點是「RPC 可能已跑完 commit 而我們沒收到答案」', () => {
    expect(recordsAsUnknown('error')).toBe(true);
    expect(recordsAsUnknown('CALLER_BUG_WRITE_UNKNOWN')).toBe(true);
    expect(recordsAsUnknown('RESULT_UNKNOWN')).toBe(true);
  });

  it('🔴🔴 `CALLER_BUG_NOT_WRITTEN` 為假 —— RPC RAISE ⇒ **確定沒寫** ⇒ 記 failed', () => {
    // 🔴 這格是本輪修法的核心。上一版讓整個 `'bug'` 一律算「未知」⇒ **過寬**:
    //    RAISE 那條確定沒寫,卻被畫成「狀態未知,請重新整理確認」
    //    ⇒ 員工看到「不確定」而其實是**明確失敗** = 反方向的傷害。
    // 突變靶:把它收進 `recordsAsUnknown` ⇒ 這格紅。
    expect(recordsAsUnknown('CALLER_BUG_NOT_WRITTEN')).toBe(false);
  });

  it('🔴🔴 **前置條件守門**:repository 的 CallerBug 形狀未變 —— 一旦有人讓兩個擲點可分辨就紅', () => {
    // 🔴 **R3 F4:上一版釘的是「一種寫法」不是「那件事」,R3 用三個綠色反例證了它有洞**:
    //    ①`(this as …).kind = 'x'` cast ⇒ 舊 regex `this\.[A-Za-z_]+\s*=` 抓不到 ⇒ 全綠
    //    ②constructor parameter property(`readonly kind:`)⇒ 全綠
    //    ③🔴 **我自己在檔頭列的第二條滿足路徑「拆成兩個 error 類別」⇒ 舊格完全盲**
    // ⇒ 改成**釘整個類別的 shape**:正規化空白後與預期字面逐字比對 ⇒ **任何改動都紅**,
    //   不論它用哪種寫法。再加一條「同名類別恰 1 個」擋「拆成兩個類別」。
    const src = readFileSync(
      fileURLToPath(new URL('./procurement-repository.ts', import.meta.url)),
      'utf8',
    );
    const start = src.indexOf('export class ProcurementCallerBugError');
    expect(start).toBeGreaterThan(-1); // 正向對照:真的抓到那個類別
    const cls = src.slice(start, src.indexOf('\n}', start) + 2).replace(/\s+/g, ' ').trim();
    // 🔴 本體:整個類別的形狀,逐字。加欄位 / 改 constructor / 用 cast / 用 parameter property ⇒ 全部紅。
    expect(cls).toBe(
      "export class ProcurementCallerBugError extends Error { constructor(message: string) { super(message); this.name = 'ProcurementCallerBugError'; } }",
    );
    // 🔴🔴 **R4 MF1:上一版這裡釘的是「名字以 ProcurementCallerBug 開頭」= 又一次釘寫法不釘那件事。**
    //    R4 實測突變:`export class ProcurementRpcRaiseError extends ProcurementCallerBugError {}`
    //    (**最自然的命名**)⇒ **34 格全綠**。⇒ 這是 R3 F4 同一個病的第二次,
    //    而我上一輪**只折了被指名的那三種寫法**。
    //
    // ⇒ 改成釘**擲出面**:呼叫端能不能分辨,取決於「這支檔到底擲出哪些類別」。
    //    不論用子類別、平行新類別、還是改名,**擲出面的集合都會變**。
    const thrown = [...new Set((src.match(/throw new ([A-Za-z]+)/g) ?? []).map((m) => m.slice(10)))].sort();
    expect(thrown).toEqual(['ProcurementCallerBugError']);
    // 第二層(E 給的一行):擋「繼承既有類別」這條特定路徑,即使它沒被 throw 到。
    expect(src.match(/extends ProcurementCallerBugError/g) ?? []).toHaveLength(0);
    // 第三層:同名前綴的平行類別仍然只有一個(保留上一版那條,它擋得住同前綴那種)。
    expect(src.match(/class ProcurementCallerBug[A-Za-z]*\b/g) ?? []).toHaveLength(1);
    //
    // 🔴🔴 **誠實界(R5 MF 改寫;主視窗裁「縮宣稱、不准加第五層」)**
    //
    // **本格釘住的是四項**:①`ProcurementCallerBugError` 類別本體逐字(shape)
    // ②被 `throw new` 的類別集合 ③有無 `extends ProcurementCallerBugError` ④同前綴類別數。
    // ⇒ **動到這四項的做法,本格都紅。**
    //
    // 🔴 **守不住的,逐字列出(不是「可能還有別的」)**:
    //   **(a) 在擲點對 instance 掛欄位** —— R5 實測:
    //       `const bug = new ProcurementCallerBugError(…); (bug as unknown as {written:boolean}).written = false; throw bug;`
    //       ⇒ 四項**全不動**,而呼叫端讀 `.written` **真的分得出來** ⇒ **本格全綠。**
    //   **(b) 判別通道放在這支檔以外** —— 呼叫端自己 parse `error.message` 前綴,或另開 helper 做同樣的事。
    //
    // ⚠️ **為什麼不加第五層去擋 (a)**:要擋它得比對**任意屬性賦值**,那是**無界的**;
    //    而會誤報的守門最後一定被人放寬或刪掉。⇒ **裁定是縮宣稱,不是加層。**
    //
    // 🔴 **所以本格的宣稱只到這裡**:**「這四項沒被改」**。
    //    **它不宣稱「前置條件沒被滿足」** —— (a) 就是一條「前置條件被滿足而本格不紅」的路。
  });

  it('🔴 A5a 的成功碼與業務失敗碼一律為假(它們都有明確答案)', () => {
    for (const c of ['CREATED', 'UPDATED', 'NO_CHANGE', 'OVER_ALLOCATION', 'INVALID_INPUT'] as const) {
      expect(recordsAsUnknown(c), `${c} 不該算未知`).toBe(false);
    }
  });

  it('🔴 失敗碼 bug **不是**合法 outcome —— 型別強迫呼叫端在分得出來的地方講清楚', () => {
    // 源碼契約:`BatchRowOutcome` 不得直接放行 `ProcurementFailureCode`(那會讓 `'bug'` 合法)。
    // 突變靶:把 `| ProcurementFailureCode` 加回去 ⇒ 這格紅。
    const src = readFileSync(
      fileURLToPath(new URL('./procurement-batch-policy.ts', import.meta.url)),
      'utf8',
    );
    const block = src.slice(src.indexOf('export type BatchRowOutcome ='));
    const body = block.slice(0, block.indexOf(';'));
    expect(body).not.toContain('ProcurementFailureCode');
    // 正向對照:證明真的抓到那個型別區塊。
    expect(body).toContain('CALLER_BUG_NOT_WRITTEN');
    expect(body).toContain('CALLER_BUG_WRITE_UNKNOWN');
  });
});

describe('maxRowsForBudget — 上限由預算反推,不是常數', () => {
  it('照預算算:60 秒 × 0.8 ÷ 400ms = 120 列', () => {
    expect(maxRowsForBudget({ maxDurationSec: 60, p95MsPerRow: 400, safetyFactor: 0.8 })).toBe(120);
  });

  it('無條件捨去,不四捨五入(寧可少一列也不要壓線)', () => {
    // 60 × 1000 × 0.8 ÷ 700 = 68.57…
    expect(maxRowsForBudget({ maxDurationSec: 60, p95MsPerRow: 700, safetyFactor: 0.8 })).toBe(68);
  });

  it('🔴 預算連一列都跑不完 ⇒ 回 1 不回 0', () => {
    // 上限 0 = 批次永遠什麼都不做,而那是**看起來很安靜的壞法**;
    // 跑一列然後逾時至少會留下訊號。
    expect(maxRowsForBudget({ maxDurationSec: 1, p95MsPerRow: 99999, safetyFactor: 0.5 })).toBe(1);
  });

  it('🔴 輸入不是正數 ⇒ 擲,不得算出一個看起來合理的上限', () => {
    expect(() => maxRowsForBudget({ maxDurationSec: 0, p95MsPerRow: 400, safetyFactor: 0.8 })).toThrow();
    expect(() => maxRowsForBudget({ maxDurationSec: 60, p95MsPerRow: 0, safetyFactor: 0.8 })).toThrow();
    expect(() =>
      maxRowsForBudget({ maxDurationSec: 60, p95MsPerRow: Number.NaN, safetyFactor: 0.8 }),
    ).toThrow();
  });

  it('🔴 `safetyFactor` 必須落在 (0, 1] —— 大於 1 等於把預算灌水', () => {
    expect(() => maxRowsForBudget({ maxDurationSec: 60, p95MsPerRow: 400, safetyFactor: 1.5 })).toThrow();
    expect(() => maxRowsForBudget({ maxDurationSec: 60, p95MsPerRow: 400, safetyFactor: 0 })).toThrow();
    // 正向對照:1 是合法的(整份預算吃滿),證明上面擋的是 >1 不是「所有邊界」。
    expect(maxRowsForBudget({ maxDurationSec: 60, p95MsPerRow: 400, safetyFactor: 1 })).toBe(150);
  });

  it('🔴🔴 **行為**守門:省略 `p95MsPerRow` 必須擲 —— 不得有任何來源的預設值', () => {
    // R1 #6 實測:第一版用兩條 regex 只認**數字字面** ⇒ 改成選填 + 具名常數
    // `ASSUMED_P95_MS = 400` ⇒ **16 格全綠、typecheck 也不紅**(今天零呼叫端)。
    // ⇒ 病根是**拿文字去守一個行為**。改成直接把那個行為做出來:
    //    不管預設值是字面、具名常數、環境變數還是解構預設,只要「省略也能算出答案」就紅。
    expect(() =>
      maxRowsForBudget({ maxDurationSec: 60, safetyFactor: 0.8 } as never),
    ).toThrow();
    // 正向對照:同一組輸入補上 p95 就算得出來 ⇒ 證明上面紅的是「缺 p95」而不是別的原因。
    expect(maxRowsForBudget({ maxDurationSec: 60, p95MsPerRow: 400, safetyFactor: 0.8 })).toBe(120);
  });

  it('🔴 源碼契約:本檔不得出現模組層的批次上限常數(**抓的是行為守門抓不到的那種**)', () => {
    // 🔴 **這格不是次要、更不是恆綠格 —— 它守的是另一個突變**(2026-08-15 實測):
    //   · 上一格(行為)抓的是「**函式**被加了預設值」⇒ 省略 p95 卻算得出答案。
    //   · **本格**抓的是「另開一個 `export const MAX_BATCH_ROWS = 120`」——
    //     那顆常數會讓 coordinator **繞過這個函式**直接用它,
    //     於是「上限由預算反推」整條規格被架空,而**行為守門一格都不會紅**(函式本身沒被動)。
    // **會讓本格紅的狀態**:本檔出現任何模組層全大寫常數宣告。實測加 `MAX_BATCH_ROWS = 120` ⇒ 只有本格紅。
    // ⚠️ **它擋不住小寫區域常數**(如 `const assumedP95 = 400`)—— 那種由上一格擋。
    //    兩格是**互補**、不是主次:各自抓對方看不見的一種。
    const src = readFileSync(
      fileURLToPath(new URL('./procurement-batch-policy.ts', import.meta.url)),
      'utf8',
    );
    // 只抓**模組層的全大寫常數**(`const rows = …` 這種函式內區域變數不算)。
    expect(src).not.toMatch(/^(export )?const [A-Z][A-Z0-9_]*\s*=/m);
    // 正向對照:證明掃得到本檔真的有 `p95MsPerRow` 這個字(否則對空字串恆真)。
    expect(src).toContain('p95MsPerRow');
  });
});

describe('summarizeBatch — 加總,而且分得出「新建」與「更新」', () => {
  const row = (orderItemId: string, outcome: BatchRow['outcome']): BatchRow => ({
    orderItemId,
    outcome,
  });

  it('🔴🔴 新建要回 id 清單(已作廢的採購會走新建路徑,員工看不出差別)', () => {
    // A5a `20260814100000:29-33`:已作廢列**視同不存在、走新建路徑** ⇒ 回 `CREATED` 不是 `UPDATED`。
    // 一次 N 筆時,畫面必須講得出「這幾列是新建」,否則員工以為只是更新。
    const out = summarizeBatch(
      [row('a', 'CREATED'), row('b', 'UPDATED'), row('c', 'CREATED')],
    );
    expect(out.created).toEqual(['a', 'c']);
    expect(out.updated).toBe(1);
    expect(out.written).toBe(3);
  });

  it('🔴 `NO_CHANGE` 算「零寫入」,不算 written、更不算失敗', () => {
    const out = summarizeBatch([row('a', 'NO_CHANGE'), row('b', 'CREATED')]);
    expect(out.unchanged).toBe(1);
    expect(out.written).toBe(1);
    expect(out.failed).toEqual([]);
    // 負向對照:若有人把 NO_CHANGE 當失敗,員工會亂改一個欄位再送一次 ——
    // 把「什麼都沒發生」變成一次真的寫入(`procurement-result.ts:25-27`)。
  });

  it('失敗列帶 id 與碼;中止後沒跑到的列分開列', () => {
    const out = summarizeBatch(
      [row('a', 'CREATED'), row('b', 'OVER_ALLOCATION'), row('c', 'NOT_ATTEMPTED')],
    );
    expect(out.failed).toEqual([{ orderItemId: 'b', code: 'OVER_ALLOCATION' }]);
    expect(out.notAttempted).toEqual(['c']);
    expect(out.written).toBe(1);
  });

  it('🔴 沒跑到的列**不得**被算成成功或失敗(它什麼都沒發生)', () => {
    const out = summarizeBatch([row('a', 'NOT_ATTEMPTED'), row('b', 'NOT_ATTEMPTED')]);
    expect(out.notAttempted).toHaveLength(2);
    expect(out.written).toBe(0);
    expect(out.failed).toEqual([]);
    expect(out.unchanged).toBe(0);
  });

  it('🔴🔴 `CALLER_BUG_NOT_WRITTEN` 進 failed(碼記 `bug`),**不進 unknown**', () => {
    // 本輪修法在彙總層的對應面:兩種 CallerBug 必須落在**不同的桶**。
    const out = summarizeBatch([
      row('a', 'CALLER_BUG_NOT_WRITTEN'),
      row('b', 'CALLER_BUG_WRITE_UNKNOWN'),
    ]);
    expect(out.failed).toEqual([{ orderItemId: 'a', code: 'bug' }]);
    expect(out.unknown).toEqual(['b']);
    // 突變靶:把兩者併回同一桶 ⇒ 這格紅(不論併去哪一邊)。
  });

  it('🔴🔴 `RESULT_UNKNOWN` 進 unknown 桶,**絕不可以**落進 failed', () => {
    // 母 plan `:145-146` 逐字:必須畫成「狀態未知,請重新整理確認」而**不是**失敗 ——
    // **畫成失敗會誘發重送**,而那一列可能已經寫進去了 ⇒ 重複採購。
    // 突變靶:把 `RESULT_UNKNOWN` 那個 `continue` 拿掉 ⇒ 它會掉進失敗分支 ⇒ 這格紅。
    const out = summarizeBatch(
      [row('a', 'CREATED'), row('b', 'RESULT_UNKNOWN'), row('c', 'NOT_ATTEMPTED')],
    );
    expect(out.unknown).toEqual(['b']);
    expect(out.failed).toEqual([]);
    // 也不得被當成成功:它沒有「寫進去了」這個保證。
    expect(out.written).toBe(1);
    expect(out.unchanged).toBe(0);
  });

  it('🔴 unknown 與 failed 是兩個桶(同一批可以同時有)', () => {
    const out = summarizeBatch(
      [row('a', 'OVER_ALLOCATION'), row('b', 'RESULT_UNKNOWN')],
    );
    expect(out.failed).toEqual([{ orderItemId: 'a', code: 'OVER_ALLOCATION' }]);
    expect(out.unknown).toEqual(['b']);
  });

  it('空批次 ⇒ 全零,不出現 NaN / undefined', () => {
    const out = summarizeBatch([]);
    expect(out).toEqual({
      written: 0,
      created: [],
      updated: 0,
      unchanged: 0,
      failed: [],
      unknown: [],
      notAttempted: [],
    });
  });

  it('🔴 每一列都必須被算進恰好一個桶(不漏、不重複)', () => {
    const rows: BatchRow[] = [
      row('a', 'CREATED'),
      row('b', 'UPDATED'),
      row('c', 'NO_CHANGE'),
      row('d', 'SUPPLIER_INACTIVE'),
      row('e', 'NOT_ATTEMPTED'),
      row('f', 'RESULT_UNKNOWN'),
    ];
    const out = summarizeBatch(rows);
    const counted =
      out.created.length +
      out.updated +
      out.unchanged +
      out.failed.length +
      out.unknown.length +
      out.notAttempted.length;
    // 突變靶:任何一個 `continue` 被拿掉、或某個分支忘記記錄 ⇒ 這格紅。
    expect(counted).toBe(rows.length);
  });
});

// 🔴 母 plan §11 條件 8 的純判定半(A-032 主視窗批准補做)。
//    每格都附「讓它紅的突變」—— 這一族的錯法是**騙人的成功訊息**,不是當機。
describe('checkBatchInput — 送出之前擋掉會騙人的輸入', () => {
  const r = (orderItemId: string) => ({ orderItemId });

  it('🔴🔴 同一個 `orderItemId` 出現兩次 ⇒ **整批拒收**,並點名是哪幾個', () => {
    // 失敗情境:不擋的話,第二次覆蓋第一次的分配數量,而**兩列都回 `UPDATED`**
    // ⇒ 彙總說「2 列成功」,實際只留最後一列的值。**員工看到的是兩列都成功。**
    // 突變靶:把 `dupes.size > 0` 改成 `false`、或改成「跳過重複列」⇒ 這格紅。
    const v = checkBatchInput([r('a'), r('b'), r('a')]);
    expect(v.ok).toBe(false);
    expect(v).toEqual({ ok: false, reason: 'duplicate_order_item', duplicates: ['a'] });
  });

  it('🔴 多組重複都要點名,而且**排序固定**(否則畫面順序會在重整之間跳動)', () => {
    // 突變靶:拿掉 `.sort()` ⇒ 這格會在 Set 插入序與字典序不同時紅。
    const v = checkBatchInput([r('z'), r('m'), r('z'), r('m'), r('a')]);
    expect(v).toEqual({ ok: false, reason: 'duplicate_order_item', duplicates: ['m', 'z'] });
  });

  it('🔴 出現三次也只點名一次(清單是「哪些 id 重複」,不是「重複了幾次」)', () => {
    const v = checkBatchInput([r('a'), r('a'), r('a')]);
    expect(v).toEqual({ ok: false, reason: 'duplicate_order_item', duplicates: ['a'] });
  });

  it('🔴 空批次 ⇒ `empty`,而**不是** ok —— 呼叫端不得進寫入迴圈', () => {
    // 條件 8 後半。突變靶:把空陣列判斷拿掉 ⇒ 會回 `{ ok: true, rowCount: 0 }` ⇒ 這格紅。
    expect(checkBatchInput([])).toEqual({ ok: false, reason: 'empty' });
  });

  it('正向對照:沒有重複、非空 ⇒ ok 且帶筆數(證明上面幾格不是恆假)', () => {
    expect(checkBatchInput([r('a'), r('b'), r('c')])).toEqual({ ok: true, rowCount: 3 });
  });

  it('🔴 單列也要過(批次上限那條不歸這裡管,別順手把 coordinator 的事吞進來)', () => {
    expect(checkBatchInput([r('only')])).toEqual({ ok: true, rowCount: 1 });
  });
});
