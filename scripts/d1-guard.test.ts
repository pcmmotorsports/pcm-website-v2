import { describe, expect, it } from 'vitest';

import {
  D1_COHORT,
  D1_COHORT_MD5,
  D1_COHORT_WITH_MEMBERSHIP,
  D1_DELETE_COHORT,
  D1_RETAIN_COHORT,
  d1CohortFingerprint,
} from './d1-cohort';
import { assertRunbookConnection, D1_TRANSACTION_GUARD_SQL } from './d1-guard';

// 🔴 Sean 07-29 拍板 A:sslmode=verify-full 是必要條件 ⇒ 正例一律帶上它。
const DIRECT_BASE =
  'postgresql://postgres:direct-secret@db.bmpnplmnldofgaohnaok.supabase.co:5432/postgres';
const POOLER_BASE =
  'postgresql://postgres.bmpnplmnldofgaohnaok:pooler-secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const DIRECT_URL = `${DIRECT_BASE}?sslmode=verify-full`;
const POOLER_URL = `${POOLER_BASE}?sslmode=verify-full`;

function captureConnectionError(connectionString: string): Error {
  try {
    assertRunbookConnection(connectionString);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error('測試前提失效:連線守門未拋錯');
}

describe('D1 cohort freeze', () => {
  it('固定為 26 筆待刪、3 筆留存，共 29 個不重複 UUID', () => {
    expect(D1_DELETE_COHORT).toHaveLength(26);
    expect(D1_RETAIN_COHORT).toHaveLength(3);
    expect(D1_COHORT).toHaveLength(29);
    expect(new Set(D1_COHORT.map(({ id }) => id))).toHaveLength(29);
  });

  it('指紋釘死 production 實查值 — 改動任何一碼字面即紅', () => {
    expect(d1CohortFingerprint()).toBe('ba1e416a8fc20c3afa76f6e19bc283af');
    expect(D1_COHORT_MD5).toBe('ba1e416a8fc20c3afa76f6e19bc283af');
  });

  // 🔴 codex R2 C5:上面那條單獨存在時,把 d1CohortFingerprint 整個掏空成
  //    `return D1_COHORT_MD5` 照樣全綠(掏空版永遠等於釘值)。餵資料進去要求
  //    算出不同結果,才真的在驗「它有在算」而不是「它會回傳正確答案」。
  it('C5 指紋函式必須真的在算 — 掏空成回傳釘值即紅', () => {
    const swapped = D1_COHORT_WITH_MEMBERSHIP.map((row) =>
      row.displayId === 'PCM-2026-0052'
        ? { ...row, membership: 'delete' }
        : row.displayId === 'PCM-2026-0001'
          ? { ...row, membership: 'retain' }
          : row,
    );

    expect(swapped).toHaveLength(29);
    expect(d1CohortFingerprint(swapped)).not.toBe('ba1e416a8fc20c3afa76f6e19bc283af');

    // 順序無關(canonical 自己排序),但內容一致就必須算出釘值。
    expect(d1CohortFingerprint([...D1_COHORT_WITH_MEMBERSHIP].reverse())).toBe(
      'ba1e416a8fc20c3afa76f6e19bc283af',
    );
  });

  it('C4 cohort 陣列在 runtime 被凍結', () => {
    expect(Object.isFrozen(D1_DELETE_COHORT)).toBe(true);
    expect(Object.isFrozen(D1_RETAIN_COHORT)).toBe(true);
    expect(Object.isFrozen(D1_COHORT_WITH_MEMBERSHIP)).toBe(true);
  });

  it('F1 指紋含陣列歸屬 — 留存單被移進待刪組必須算出不同指紋', () => {
    const canonicalWithout = (rows: readonly { id: string; displayId: string }[]) =>
      [...rows]
        .sort((a, b) => a.displayId.localeCompare(b.displayId))
        .map(({ id, displayId }) => `${id},${displayId}`)
        .join('\n');

    // 0052(留存、已付款)與 0001(待刪)整組互換:兩陣列長度不變、29 個 UUID 不變。
    const swappedDelete = [
      ...D1_DELETE_COHORT.filter((r) => r.displayId !== 'PCM-2026-0001'),
      ...D1_RETAIN_COHORT.filter((r) => r.displayId === 'PCM-2026-0052'),
    ];
    const swappedRetain = [
      ...D1_RETAIN_COHORT.filter((r) => r.displayId !== 'PCM-2026-0052'),
      ...D1_DELETE_COHORT.filter((r) => r.displayId === 'PCM-2026-0001'),
    ];

    expect(swappedDelete).toHaveLength(26);
    expect(swappedRetain).toHaveLength(3);

    // 舊版(不含歸屬)的 canonical 對互換完全無感 —— 這就是 F1 的破口。
    expect(canonicalWithout([...swappedDelete, ...swappedRetain])).toBe(
      canonicalWithout([...D1_DELETE_COHORT, ...D1_RETAIN_COHORT]),
    );

    // 現行版本必須看得出差別。
    const withMembership = (
      del: readonly { id: string; displayId: string }[],
      ret: readonly { id: string; displayId: string }[],
    ) =>
      [
        ...del.map((r) => ({ ...r, m: 'delete' })),
        ...ret.map((r) => ({ ...r, m: 'retain' })),
      ]
        .sort((a, b) => a.displayId.localeCompare(b.displayId))
        .map(({ id, displayId, m }) => `${id},${displayId},${m}`)
        .join('\n');

    expect(withMembership(swappedDelete, swappedRetain)).not.toBe(
      withMembership(D1_DELETE_COHORT, D1_RETAIN_COHORT),
    );
  });
});

describe('assertRunbookConnection', () => {
  it('接受 direct host 含 production project ref', () => {
    expect(() => assertRunbookConnection(DIRECT_URL)).not.toThrow();
  });

  it('接受 pooler host 搭配 username 的 production project ref 後綴', () => {
    expect(() => assertRunbookConnection(POOLER_URL)).not.toThrow();
  });

  // 🔴 每條負例都必須「除了受測的那一項之外全部合法」,否則會被前面的關卡先擋掉、
  //    測試名字說在驗 A、實際驗到的是 B(突變測試在拍板 A 之後抓到三條這種假綠)。
  //    ⇒ 凡走到 sslmode 之後那些檢查的負例,一律自帶 sslmode=verify-full。
  it.each([
    [
      '別的 project ref',
      'postgresql://postgres:wrong-secret@db.aaaaaaaaaaaaaaaaaaaa.supabase.co:5432/postgres?sslmode=verify-full',
    ],
    [
      'pooler username 沒有 project ref 後綴',
      'postgresql://postgres:wrong-secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
    ],
    [
      'pooler host 含 project ref 但 username 沒有後綴',
      'postgresql://postgres:wrong-secret@bmpnplmnldofgaohnaok.pooler.supabase.com:6543/postgres?sslmode=verify-full',
    ],
    ['空字串', ''],
    ['格式壞掉', 'not-a-postgres-url'],
    [
      'F2 query param 覆蓋 host(守門看到正式站、pg 實連別處)',
      'postgresql://postgres:x@db.bmpnplmnldofgaohnaok.supabase.co:5432/postgres?sslmode=verify-full&host=evil.example.com',
    ],
    [
      'F2 query param 覆蓋 user(繞過 pooler username 檢查)',
      'postgresql://postgres:x@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full&user=postgres.otherprojectref',
    ],
    [
      'F2 query param 覆蓋 hostaddr',
      'postgresql://postgres:x@db.bmpnplmnldofgaohnaok.supabase.co:5432/postgres?sslmode=verify-full&hostaddr=203.0.113.1',
    ],
    [
      'F5 夾帶 project ref 的他方 host',
      'postgresql://postgres:x@db.bmpnplmnldofgaohnaok.supabase.co.evil.example:5432/postgres?sslmode=verify-full',
    ],
    // 🔴 codex R2 C7:原本負測只涵蓋 host/user/hostaddr,denylist 裡其餘四個鍵
    //    被刪掉測試照樣全綠。逐鍵鎖住。
    ['C7 denylist port', `${DIRECT_BASE}?sslmode=verify-full&port=6543`],
    ['C7 denylist options', `${DIRECT_BASE}?sslmode=verify-full&options=-c%20role%3Dpostgres`],
    ['C7 denylist service', `${DIRECT_BASE}?sslmode=verify-full&service=somewhere-else`],
    ['C7 denylist dbname', `${DIRECT_BASE}?sslmode=verify-full&dbname=shadow_clone`],
    ['C7 denylist database', `${DIRECT_BASE}?sslmode=verify-full&database=shadow_clone`],
    // 🔴 codex R2 C3:不驗伺服器身分的 sslmode。
    // 🔴 Sean 07-29 拍板 A:只有 verify-full 會驗主機名 ⇒ 其餘一律拒,含未帶。
    ['拍板A sslmode=disable', `${DIRECT_BASE}?sslmode=disable`],
    ['拍板A sslmode=no-verify', `${DIRECT_BASE}?sslmode=no-verify`],
    ['拍板A sslmode=prefer', `${DIRECT_BASE}?sslmode=prefer`],
    ['拍板A sslmode=require(只加密、不驗身分)', `${DIRECT_BASE}?sslmode=require`],
    ['拍板A sslmode=verify-ca(驗CA但不驗主機名)', `${DIRECT_BASE}?sslmode=verify-ca`],
    ['拍板A 完全未帶 sslmode', DIRECT_BASE],
    ['拍板A pooler 未帶 sslmode', POOLER_BASE],
    // 🔴 codex R2 C1:同專案下的別的 database(演練 clone 會含相同 29 筆 UUID)。
    [
      'C1 同專案的 shadow clone database',
      'postgresql://postgres:x@db.bmpnplmnldofgaohnaok.supabase.co:5432/shadow_clone?sslmode=verify-full',
    ],
    [
      'C1 路徑留白(會回頭吃 PGDATABASE)',
      'postgresql://postgres:x@db.bmpnplmnldofgaohnaok.supabase.co:5432?sslmode=verify-full',
    ],
  ])('拒絕%s', (_label, connectionString) => {
    expect(() => assertRunbookConnection(connectionString)).toThrow();
  });

  it('只有 sslmode=verify-full 放行(拍板 A)', () => {
    expect(() => assertRunbookConnection(`${DIRECT_BASE}?sslmode=verify-full`)).not.toThrow();
    expect(() => assertRunbookConnection(`${DIRECT_BASE}?sslmode=VERIFY-FULL`)).not.toThrow();
  });

  it('錯誤訊息不含密碼或完整連線 URL', () => {
    const unsafeUrl =
      'postgresql://postgres:do-not-leak-this@db.aaaaaaaaaaaaaaaaaaaa.supabase.co:5432/postgres?sslmode=verify-full';
    const error = captureConnectionError(unsafeUrl);

    expect(error.message).not.toContain('do-not-leak-this');
    expect(error.message).not.toContain(unsafeUrl);
  });
});

describe('D1 transaction SQL guard', () => {
  it('第一個 statement 就是可執行的 DO 守門', () => {
    expect(D1_TRANSACTION_GUARD_SQL.trimStart()).toMatch(/^DO \$\$/);
  });

  it('照既有先例拒絕非 postgres 身分', () => {
    expect(D1_TRANSACTION_GUARD_SQL).toContain("IF current_user <> 'postgres' THEN");
    expect(D1_TRANSACTION_GUARD_SQL).toMatch(
      /RAISE EXCEPTION 'D1:runbook 必須以 postgres 執行\(實 %\);拒繼續', current_user;/,
    );
  });

  it('逐筆帶入 29 個 UUID，數量不足即 RAISE abort', () => {
    for (const { id } of D1_COHORT) {
      expect(D1_TRANSACTION_GUARD_SQL).toContain(`'${id}'::uuid`);
    }
    expect(D1_TRANSACTION_GUARD_SQL).toContain('IF v_cohort_count <> 29 THEN');
    expect(D1_TRANSACTION_GUARD_SQL).toMatch(/RAISE EXCEPTION 'D1:cohort 應有 29 筆/);
  });

  // 🔴 codex R2 C6:上面那些 toContain 是「有沒有出現」,不是「有沒有別的東西被插進來」。
  //    在 IF 之前插一行 `v_cohort_count := 29;`,所有 toContain 照樣全綠,而正式守門
  //    會在資料庫 0 筆 cohort 的情況下放行。⇒ 把 UUID 區塊挖掉後整段逐字比對,
  //    任何多出來的語句都會讓這條紅。
  // 🔴 codex R2 C6:toContain 只驗「有沒有出現」,不驗「有沒有多出別的東西」。
  //    在 IF 之前插一行 `v_cohort_count := 29;`,所有 toContain 照樣全綠,而正式守門
  //    會在資料庫 0 筆 cohort 的情況下放行。
  //    ⇒ 剝掉註解與空行後,對「語句序列」逐字比對:改註解不會誤紅,插入語句一定紅。
  it('C6 守門 SQL 的語句序列逐字釘死 — 插入任何一行語句即紅', () => {
    const statements = D1_TRANSACTION_GUARD_SQL.replace(
      /(WHERE id = ANY \(ARRAY\[\n)[\s\S]*?(\n {3}\]\);)/,
      '$1<<UUIDS>>$2',
    )
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('--'))
      .join('\n');

    expect(statements).toBe(`DO $$
DECLARE
  v_cohort_count integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'D1:runbook 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;
  IF session_user <> 'postgres' THEN
    RAISE EXCEPTION 'D1:登入身分必須是 postgres(實 %);拒繼續', session_user;
  END IF;
  IF (SELECT system_identifier FROM pg_control_system()) <> 7632885393857617092 THEN
    RAISE EXCEPTION 'D1:叢集識別碼不符 production;拒繼續';
  END IF;
  SELECT count(*)
    INTO v_cohort_count
    FROM public.orders
   WHERE id = ANY (ARRAY[
<<UUIDS>>
   ]);
  IF v_cohort_count <> 29 THEN
    RAISE EXCEPTION 'D1:cohort 應有 29 筆，實際 % 筆;拒繼續', v_cohort_count;
  END IF;
END $$;`);
  });

  it('R3 釘死正式站叢集識別碼 — 邏輯還原出來的新叢集不會是同一個值', () => {
    expect(D1_TRANSACTION_GUARD_SQL).toContain(
      '(SELECT system_identifier FROM pg_control_system()) <> 7632885393857617092',
    );
  });

  it('C2 同時驗 session_user — 只驗 current_user 擋不住 SET ROLE', () => {
    expect(D1_TRANSACTION_GUARD_SQL).toContain("IF session_user <> 'postgres' THEN");
    expect(D1_TRANSACTION_GUARD_SQL.indexOf('current_user')).toBeLessThan(
      D1_TRANSACTION_GUARD_SQL.indexOf('session_user'),
    );
  });
});
