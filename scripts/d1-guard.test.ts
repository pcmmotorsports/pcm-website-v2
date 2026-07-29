import { describe, expect, it } from 'vitest';

import { D1_COHORT, D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';
import { buildD1PgConfig, D1_TRANSACTION_GUARD_SQL } from './d1-guard';

const VALID =
  'postgresql://postgres.bmpnplmnldofgaohnaok:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

describe('D1 cohort', () => {
  it('26 待刪 + 3 留存,29 個不重複 UUID', () => {
    expect(D1_DELETE_COHORT).toHaveLength(26);
    expect(D1_RETAIN_COHORT).toHaveLength(3);
    expect(new Set(D1_COHORT.map(({ id }) => id)).size).toBe(29);
  });

  // 🔴 D1a3:N3c 收窗後,舊格式單號會被 CHECK 擋住 ⇒ 還原需要預備的新號。
  //    這裡只驗形狀與不相撞;**與現網的碰撞必須在 restore 執行當下重驗**
  //    (N3b 之後現網會長出新的 6 碼單號,凍結的映射可能過期)= D1a5 驗收條件。
  it('26 組還原用新號:符合 §5.4a 格式、彼此不重複、不撞留存 3 張的新號', () => {
    const codes = D1_DELETE_COHORT.map(({ restoreDisplayId }) => restoreDisplayId);

    expect(codes).toHaveLength(26);
    expect(new Set(codes).size).toBe(26);
    for (const code of codes) {
      expect(code).toMatch(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/);
    }
    for (const taken of ['YWP3PC', 'BKPR5M', 'ZNHY8B']) {
      expect(codes).not.toContain(taken);
    }
  });

  // 🔴 F1:配對比對證明不了歸屬 —— 把 0052 與某張待刪單互換,兩邊配對仍成立、
  //    數量仍 29,但 D1c 會照 D1_DELETE_COHORT 刪掉有真錢的 0052。歸屬只能釘死。
  it('留存名單釘死三張已付款單', () => {
    expect(D1_RETAIN_COHORT.map(({ displayId }) => displayId)).toEqual([
      'PCM-2026-0052',
      'PCM-2026-0102',
      'PCM-2026-0104',
    ]);
  });
});

describe('buildD1PgConfig', () => {
  it('合法 pooler 連線字串產出離散欄位 + 強制 CA 驗證', () => {
    const config = buildD1PgConfig(VALID);

    expect(config.host).toBe('aws-0-ap-southeast-1.pooler.supabase.com');
    expect(config.user).toBe('postgres.bmpnplmnldofgaohnaok');
    expect(config.database).toBe('postgres');
    expect(config.ssl.rejectUnauthorized).toBe(true);
    expect(config.ssl.servername).toBe(config.host);
    expect(config.ssl.ca).toContain('BEGIN CERTIFICATE');
  });

  // 🔴 傳離散欄位是為了讓 query param 完全不參與 —— 直接把 connectionString 丟給 pg 的話,
  //    `?host=` 會覆蓋位置參數(repo 內 pg-connection-string 2.13.0 實跑複驗)。
  it('回傳值不含 connectionString,query param 無從覆蓋', () => {
    const config = buildD1PgConfig(`${VALID}?host=evil.example.com&user=postgres.other`);

    expect(config.host).toBe('aws-0-ap-southeast-1.pooler.supabase.com');
    expect(config.user).toBe('postgres.bmpnplmnldofgaohnaok');
    expect(config).not.toHaveProperty('connectionString');
  });

  // 🔴 SSL 參數是攻擊面不是防線:pg 8.21 會讓連線字串的 sslmode 覆蓋掉程式指定的 ssl 物件
  //    (repo 實測:假 CA + sslmode=no-verify 竟連得上)⇒ 一律剝除,寫什麼都不影響。
  it.each([['disable'], ['no-verify'], ['require'], ['verify-full']])(
    'sslmode=%s 一律被剝除、不影響強制 CA 驗證',
    (mode) => {
      const config = buildD1PgConfig(`${VALID}?sslmode=${mode}`);

      expect(config.ssl.rejectUnauthorized).toBe(true);
      expect(config.ssl.ca).toContain('BEGIN CERTIFICATE');
    },
  );

  it.each([
    [
      '直連 host(IPv6-only、實測連不上)',
      'postgresql://postgres.bmpnplmnldofgaohnaok:x@db.bmpnplmnldofgaohnaok.supabase.co:5432/postgres',
    ],
    [
      '別的專案 ref',
      'postgresql://postgres.aaaaaaaaaaaaaaaaaaaa:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ],
    [
      'username 沒有專案 ref',
      'postgresql://postgres:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ],
    [
      '夾帶 pooler 字樣的他方 host',
      'postgresql://postgres.bmpnplmnldofgaohnaok:x@aws-0-ap-southeast-1.pooler.supabase.com.evil.example:5432/postgres',
    ],
    [
      'IP literal(verify-full 對 IP 不成立)',
      'postgresql://postgres.bmpnplmnldofgaohnaok:x@203.0.113.1:5432/postgres',
    ],
    [
      '同專案的別的 database',
      'postgresql://postgres.bmpnplmnldofgaohnaok:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/shadow_clone',
    ],
    [
      '路徑留白(會回頭吃 PGDATABASE)',
      'postgresql://postgres.bmpnplmnldofgaohnaok:x@aws-0-ap-southeast-1.pooler.supabase.com:5432',
    ],
    ['空字串', ''],
    ['格式壞掉', 'not-a-postgres-url'],
  ])('拒絕%s', (_label, connectionString) => {
    expect(() => buildD1PgConfig(connectionString)).toThrow();
  });

  it('錯誤訊息不含密碼', () => {
    const leaky =
      'postgresql://postgres.other:do-not-leak-this@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

    try {
      buildD1PgConfig(leaky);
      throw new Error('測試前提失效:守門未拋錯');
    } catch (error) {
      expect((error as Error).message).not.toContain('do-not-leak-this');
      expect((error as Error).message).not.toContain(leaky);
    }
  });
});

describe('D1_TRANSACTION_GUARD_SQL', () => {
  it('29 組 (id, display_id) 配對逐組入 SQL', () => {
    for (const { id, displayId } of D1_COHORT) {
      expect(D1_TRANSACTION_GUARD_SQL).toContain(`('${id}'::uuid, '${displayId}')`);
    }
  });

  // 🔴 toContain 只驗「有沒有出現」,不驗「有沒有多出別的東西」—— 在 IF 前插一行
  //    `v_cohort_count := 29;` 會讓守門在資料庫 0 筆時放行,而 toContain 照樣全綠。
  //    剝掉註解與空行後對語句序列逐字比對:改註解不會誤紅,插入語句一定紅。
  it('語句序列逐字釘死 — 插入任何一行語句即紅', () => {
    const statements = D1_TRANSACTION_GUARD_SQL.replace(
      /(JOIN \(VALUES\n)[\s\S]*?(\n {4}\) AS c)/,
      '$1<<PAIRS>>$2',
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
    FROM public.orders o
    JOIN (VALUES
<<PAIRS>>
    ) AS c(id, display_id) ON c.id = o.id AND c.display_id = o.display_id;
  IF v_cohort_count <> 29 THEN
    RAISE EXCEPTION 'D1:cohort 配對應有 29 筆,實際 % 筆;拒繼續', v_cohort_count;
  END IF;
END $$;`);
  });
});
