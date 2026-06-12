// node env;mock 'server-only'(PaymentConfirmerAdapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';
import { toMoneyAmount, PaymentConfirmError, type ConfirmOrderPaymentInput } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { PaymentConfirmerAdapter, buildPgConfig, type PgClientLike } from './PaymentConfirmerAdapter';
import { SUPABASE_ROOT_CA_2021 } from './supabase-ca';

const INPUT: ConfirmOrderPaymentInput = {
  orderId: 'order-uuid-1',
  amount: { amount: toMoneyAmount(1050), currency: 'TWD' },
  recTradeId: 'D20260612001234567',
};

type QueryRows = { rows: Array<Record<string, unknown>> };

function makeClient(opts: {
  connect?: () => Promise<void>;
  query?: (text: string, values: unknown[]) => Promise<QueryRows>;
}) {
  const connect = vi.fn(opts.connect ?? (async () => {}));
  // 顯式 call signature:令 query.mock.calls[0] 為 [text, values] tuple(非空 tuple、可解構 sql/values)。
  const query = vi.fn<(text: string, values: unknown[]) => Promise<QueryRows>>(
    opts.query ?? (async () => ({ rows: [] })),
  );
  const end = vi.fn(async () => {});
  const client = { connect, query, end } as unknown as PgClientLike;
  return { client, connect, query, end };
}

function pgError(code: string): Error {
  return Object.assign(new Error('pg error'), { code });
}

describe('buildPgConfig — 剝 SSL 參數 + 強制 CA 驗證(codex 關卡2 修正)', () => {
  const BASE = 'postgresql://payment_confirmer.refxyz:p%40ss@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

  it('離散欄位解析正確(host/port/database/user/password〔URL-decode〕)', () => {
    const c = buildPgConfig(`${BASE}?sslmode=no-verify`);
    expect(c.host).toBe('aws-1-ap-southeast-1.pooler.supabase.com');
    expect(c.port).toBe(5432);
    expect(c.database).toBe('postgres');
    expect(c.user).toBe('payment_confirmer.refxyz');
    expect(c.password).toBe('p@ss'); // %40 → @ 解碼
  });

  const POOLER_HOST = 'aws-1-ap-southeast-1.pooler.supabase.com';
  const expectedSsl = {
    ca: SUPABASE_ROOT_CA_2021,
    rejectUnauthorized: true,
    servername: POOLER_HOST, // 🔴 顯式 servername=host(MITM 縱深)
  };

  it('🔴 adapter 唯一指定 CA 驗證 + 顯式 servername、不傳 connectionString(防 pg 用 URL sslmode 弱化)', () => {
    const c = buildPgConfig(`${BASE}?sslmode=no-verify`) as Record<string, unknown>;
    expect(c.ssl).toEqual(expectedSsl);
    expect((c.ssl as { servername: string }).servername).toBe(c.host); // servername === host
    expect(c.connectionString).toBeUndefined(); // 不可同傳 connectionString
    expect(c.sslmode).toBeUndefined();
  });

  it('🔴 sslmode=no-verify/disable/require 皆不能弱化(ssl 恆 {ca, rejectUnauthorized:true, servername})', () => {
    for (const mode of ['no-verify', 'disable', 'require']) {
      const c = buildPgConfig(`${BASE}?sslmode=${mode}`);
      expect(c.ssl).toEqual(expectedSsl);
    }
  });

  it('無 sslmode 也強制 CA 驗證 + servername', () => {
    const c = buildPgConfig(BASE);
    expect(c.ssl).toEqual(expectedSsl);
  });

  it('🔴 合法 pooler host(aws-0 / aws-1 多區域)通過 + ssl.servername === host', () => {
    for (const h of [
      'aws-0-ap-northeast-1.pooler.supabase.com',
      'aws-1-ap-southeast-1.pooler.supabase.com',
      'aws-1-us-east-2.pooler.supabase.com',
    ]) {
      const c = buildPgConfig(`postgresql://u:p@${h}:5432/postgres`);
      expect(c.host).toBe(h);
      expect((c.ssl as { servername: string }).servername).toBe(h);
    }
  });

  // 🔴 host allowlist 安全邊界 table-driven(codex 關卡2:鎖死 MITM 繞過面、非僅手動驗)。
  it.each([
    ['IPv4 literal', 'postgresql://u:p@1.2.3.4:5432/postgres'],
    ['IPv6 literal(bracket)', 'postgresql://u:p@[2001:db8::1]:5432/postgres'],
    ['空 host', 'postgresql://u:p@/postgres'],
    ['非-pooler 網域', 'postgresql://u:p@evil.example.com:5432/postgres'],
    ['prefix 攻擊(...com.attacker.com)', 'postgresql://u:p@evil.pooler.supabase.com.attacker.com:5432/db'],
    ['尾綴攻擊(...com.evil.com)', 'postgresql://u:p@aws-1-x.pooler.supabase.com.evil.com:5432/db'],
    ['多層子網域(SAN 一層不涵蓋)', 'postgresql://u:p@a.b.pooler.supabase.com:5432/db'],
    ['尾點 FQDN', 'postgresql://u:p@aws-1-x.pooler.supabase.com.:5432/db'],
    ['前綴非 aws-N', 'postgresql://u:p@notaws-1-x.pooler.supabase.com:5432/db'],
    ['大寫(fail-closed、不正規化)', 'postgresql://u:p@AWS-1-X.POOLER.SUPABASE.COM:5432/db'],
    ['仿冒主網域(pooler.supabase.co 非 .com)', 'postgresql://u:p@aws-1-x.pooler.supabase.co:5432/db'],
  ])('🔴 拒絕 host:%s → buildPgConfig throw', (_label, url) => {
    expect(() => buildPgConfig(url)).toThrow();
  });
});

describe('PaymentConfirmerAdapter.confirm — 成功路徑', () => {
  it('回 {confirmed:true, idempotent:false}(真翻 unpaid→paid)', async () => {
    const { client } = makeClient({
      query: async () => ({ rows: [{ result: { confirmed: true, idempotent: false } }] }),
    });
    const res = await new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT);
    expect(res).toEqual({ confirmed: true, idempotent: false });
  });

  it('回 {confirmed:true, idempotent:true}(重放冪等 no-op)', async () => {
    const { client } = makeClient({
      query: async () => ({ rows: [{ result: { confirmed: true, idempotent: true } }] }),
    });
    const res = await new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT);
    expect(res).toEqual({ confirmed: true, idempotent: true });
  });

  it('query 參數 = [orderId, amount.amount 整數, recTradeId] + connect/end 各呼一次', async () => {
    const { client, connect, query, end } = makeClient({
      query: async () => ({ rows: [{ result: { confirmed: true, idempotent: false } }] }),
    });
    await new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('confirm_order_payment');
    expect(values).toEqual(['order-uuid-1', 1050, 'D20260612001234567']); // p_amount 整數、無浮點
  });
});

describe('PaymentConfirmerAdapter.confirm — 失敗分類(SHOULD ③)', () => {
  it('RPC RAISE(SQLSTATE P0001)→ PaymentConfirmError(rejected)', async () => {
    const { client, end } = makeClient({
      query: async () => {
        throw pgError('P0001');
      },
    });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      name: 'PaymentConfirmError',
      code: 'rejected',
    });
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放連線
  });

  it('connect 失敗 → PaymentConfirmError(unreachable)', async () => {
    const { client, end } = makeClient({
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      code: 'unreachable',
    });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('statement_timeout(57014 語句取消)→ unreachable(可重 confirm)', async () => {
    const { client } = makeClient({
      query: async () => {
        throw pgError('57014');
      },
    });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('RPC 回應格式異常(空 rows)→ unreachable', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [] }) });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('RPC 回應 result 形狀不符(缺 idempotent)→ unreachable', async () => {
    const { client } = makeClient({
      query: async () => ({ rows: [{ result: { confirmed: true } }] }),
    });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toBeInstanceOf(
      PaymentConfirmError,
    );
  });

  it('壞連線字串(invalid URL、buildPgConfig throw)→ PaymentConfirmError(unreachable)、不誤映 rejected', async () => {
    // 用預設 factory(無注入)→ buildPgConfig 在 try 內 throw → classifyPgError 歸 unreachable(設定層、非孤兒)。
    await expect(new PaymentConfirmerAdapter('not-a-valid-url').confirm(INPUT)).rejects.toMatchObject({
      name: 'PaymentConfirmError',
      code: 'unreachable',
    });
  });

  it('連線字串 port 非法 → unreachable(設定層、非 rejected)', async () => {
    await expect(
      new PaymentConfirmerAdapter('postgresql://u:p@host:notaport/postgres').confirm(INPUT),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('🔴 IP-literal host → confirm 歸 unreachable(host 釘死、MITM 縱深、非孤兒)', async () => {
    await expect(
      new PaymentConfirmerAdapter('postgresql://u:p@1.2.3.4:5432/postgres').confirm(INPUT),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('🔴 非-pooler host → confirm 歸 unreachable', async () => {
    await expect(
      new PaymentConfirmerAdapter('postgresql://u:p@evil.example.com:5432/postgres').confirm(INPUT),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('🔴 空 host → confirm 歸 unreachable', async () => {
    await expect(
      new PaymentConfirmerAdapter('postgresql://u:p@/postgres').confirm(INPUT),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('end() 自身 throw 不蓋過主錯誤(吞掉)', async () => {
    const connect = vi.fn(async () => {});
    const query = vi.fn(async () => {
      throw pgError('P0001');
    });
    const end = vi.fn(async () => {
      throw new Error('end failed');
    });
    const client = { connect, query, end } as unknown as PgClientLike;
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      code: 'rejected', // 主錯誤(RPC RAISE)仍傳出、非 end 的 'end failed'
    });
  });
});
