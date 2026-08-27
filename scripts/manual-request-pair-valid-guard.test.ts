import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// manual-request-pair-valid-guard.test.ts — `#858` 的 `orders_manual_request_pair_valid`
// **內容**守門(窗 B 2026-08-24 的 must-fix,主視窗交回線C 補)。
//
// 🔴 **它補的洞是什麼**:那支 migration 的 apply-time 斷言 `①-d`(:690-695)只
//    `SELECT count(*) … WHERE conname = 'orders_manual_request_pair_valid'`
//    ⇒ **只驗它在不在,從不讓它表演**。窗B 用拋棄式 PG 17.10 做兩個世界對照:
//    裝修好版 ⇒ 印「①-d 通過 (count=1)」;裝壞版(拿掉 `IS NOT NULL`)⇒ **印完全同一句話**,
//    而毒化列存進去了。⇒ 那格對 CHECK 的【內容】零判別力。
//
// 🔴 **為什麼守門住在這裡,不是加在那支 migration 裡面**:
//    `supabase/APPLIED.tsv` 記著那支檔的 sha256(`adcd44c5…`),而
//    `scripts/deploy-order-gate.sh:137,156-158` **會比 sha** ——
//    動它一個位元組 ⇒ 它變回 PENDING ⇒ 那道閘會擋住 `manual-order-repository.ts`
//    (它寫著 `admin_create_manual_order`)⇒ **等於把剛解開的 M12-A1 又鎖回去**。
//    ⇒ 已 apply 且記帳的檔 = 不可改。守門要住在會重跑的地方。
//
// ⚠️ **本檔驗的是【碼的字面】,不是 DB 裡那道 CHECK 的行為。**
//    行為那一半在 `docs/probes/2026-08-24-858-orders-pair-valid-performs.sql`(**未實跑**,需 DB)。
//    兩件事不能互相冒充:本檔全綠**不代表**正式庫那道 CHECK 是對的。

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');
const CONSTRAINT = 'orders_manual_request_pair_valid';

/**
 * 剝掉 `--` 行註解與 `/* *\/` 區塊註解。
 *
 * 🔴 **這一步不是潔癖,是判別力的前提**:守門讀到的常常是【談論那件事的文字】,
 *    而談論它的文字通常就是為了修它才寫下來的 —— 上面那段檔頭註解裡就逐字含著
 *    `manual_request_id IS NOT NULL`。沒剝乾淨 ⇒ 壞版的 CHECK 配一段好版的註解 ⇒ **恆綠**。
 * ⚠️ 本函式**不處理 dollar-quoted 字串**($fn$…$fn$)。目前夠用,因為要驗的
 *    `ALTER TABLE … ADD CONSTRAINT` 是裸 DDL、不在函式本體內。
 *    ⇒ 哪天有人把它搬進 DO 區塊,`assertGuardHasSubjects` 那格會轉紅(找不到定義),**不會靜靜放行**。
 */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** 抽出每一處 `ADD CONSTRAINT <name> CHECK ( … )` 的括號內文(逐字,已剝註解)。 */
export function extractCheckBodies(sql: string, constraint: string): string[] {
  const stripped = stripSqlComments(sql);
  const needle = `ADD CONSTRAINT ${constraint} CHECK`;
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = stripped.indexOf(needle, from);
    if (at === -1) break;
    const open = stripped.indexOf('(', at + needle.length);
    if (open === -1) break;
    let depth = 0;
    let i = open;
    for (; i < stripped.length; i += 1) {
      if (stripped[i] === '(') depth += 1;
      else if (stripped[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(stripped.slice(open + 1, i));
    from = i;
  }
  return out;
}

/**
 * 一道合格的定義要同時含這三句。**三句缺一,毒化列就進得來**:
 *   · 少了 `IS NOT NULL` ⇒ `NULL ~ '…'` 得到 NULL,而 **CHECK 只擋 FALSE、放行 NULL**
 *   · 少了 regex     ⇒ 指紋可以是任何字串 ⇒ 內容比對靜靜失效
 *   · 少了 both-NULL ⇒ 所有既有的 web 單全部違規
 */
const REQUIRED = [
  /manual_request_id\s+IS\s+NULL\s+AND\s+manual_request_payload_sha256\s+IS\s+NULL/i,
  /manual_request_id\s+IS\s+NOT\s+NULL\s+AND\s+manual_request_payload_sha256\s+IS\s+NOT\s+NULL/i,
  /manual_request_payload_sha256\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i,
] as const;

export function missingClauses(body: string): number[] {
  return REQUIRED.map((re, i) => (re.test(body) ? -1 : i)).filter((i) => i >= 0);
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

describe(`${CONSTRAINT} —— 任何一支 migration 定義它, 都要含齊三句`, () => {
  const found = migrationFiles()
    .map((f) => ({ file: f, bodies: extractCheckBodies(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'), CONSTRAINT) }))
    .filter((x) => x.bodies.length > 0);

  it('🔴 分母不得為 0 —— 一個掃不到東西的守門與一個全過的守門印同一句話', () => {
    // 這一格擋的是「有人把定義搬走 / 改名 / 塞進 DO 區塊」⇒ 上面那個 filter 變空
    // ⇒ 下面的 it.each 一格都不跑 ⇒ **全綠**。那個綠是「沒檢查」不是「過了」。
    expect(found.length).toBeGreaterThan(0);
  });

  it.each(found.map((x) => [x.file, x.bodies] as const))('%s 的定義含齊三句', (_file, bodies) => {
    for (const body of bodies) expect(missingClauses(body)).toEqual([]);
  });
});

// ── 守門自己的證人:少了這一段,上面全綠可能只是尺死了 ──────────────────────────
describe('🔴 這把尺會不會叫 —— 兩個方向都要表演', () => {
  const GOOD = `ALTER TABLE public.orders ADD CONSTRAINT ${CONSTRAINT} CHECK (
    (manual_request_id IS NULL     AND manual_request_payload_sha256 IS NULL)
    OR
    (manual_request_id IS NOT NULL AND manual_request_payload_sha256 IS NOT NULL
                                   AND manual_request_payload_sha256 ~ '^[0-9a-f]{64}$')
  );`;

  it('正對照:修好版 ⇒ 零缺句(少了這格,「永遠說缺」也會全綠)', () => {
    expect(missingClauses(extractCheckBodies(GOOD, CONSTRAINT)[0]!)).toEqual([]);
  });

  it('負測:窗B 那個【壞版】(拿掉兩個 IS NOT NULL)⇒ 必須指出缺第 2 句', () => {
    const bad = GOOD.replace(
      'manual_request_id IS NOT NULL AND manual_request_payload_sha256 IS NOT NULL',
      'manual_request_id IS NOT NULL',
    );
    expect(missingClauses(extractCheckBodies(bad, CONSTRAINT)[0]!)).toEqual([1]);
  });

  it('負測:regex 被拿掉 ⇒ 必須指出缺第 3 句', () => {
    const bad = GOOD.replace(/AND manual_request_payload_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/, '');
    expect(missingClauses(extractCheckBodies(bad, CONSTRAINT)[0]!)).toEqual([2]);
  });

  it('🔴 **我有沒有吃到註解** —— 壞版的 CHECK 配一段好版的註解, 不准過', () => {
    // 這一格是本檔最重要的負對照:那段真的存在的檔頭註解逐字含著 `manual_request_id IS NOT NULL`
    // ⇒ 沒剝註解的話, 壞版會被那段【談論它的文字】救活 ⇒ 恆綠。
    const bad = GOOD.replace(
      'manual_request_id IS NOT NULL AND manual_request_payload_sha256 IS NOT NULL',
      'manual_request_id IS NOT NULL',
    );
    const withKindComment = `-- 正確版應為 manual_request_id IS NOT NULL AND manual_request_payload_sha256 IS NOT NULL
/* 也可寫成 manual_request_id IS NOT NULL AND manual_request_payload_sha256 IS NOT NULL */
${bad}`;
    expect(missingClauses(extractCheckBodies(withKindComment, CONSTRAINT)[0]!)).toEqual([1]);
  });

  it('剝註解不得把碼一起吃掉(反向:好版 + 註解 ⇒ 仍零缺句)', () => {
    const withComment = `-- 說明\n/* 區塊 */\n${GOOD}`;
    expect(missingClauses(extractCheckBodies(withComment, CONSTRAINT)[0]!)).toEqual([]);
  });

  it('多處定義都會被抽出來(不是只看第一處)', () => {
    expect(extractCheckBodies(`${GOOD}\n${GOOD}`, CONSTRAINT)).toHaveLength(2);
  });
});
