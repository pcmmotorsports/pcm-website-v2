/**
 * D1t1:獨立 runbook TapPay client。
 * 🔴 本檔在純 node(vitest node 環境)import 受測模組 = 「node 可載入」的實證
 * (TapPayChargeAdapter 因 server-only 在這裡 import 會直接炸;這正是要獨立 client 的原因)。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertStrictRecordWire,
  buildD1TapPayConfig,
  PROD_RECORD_QUERY_URL,
  queryRecordByRecTradeId,
  type FetchLike,
} from './d1-tappay-client';

const GOOD_ENV = {
  TAPPAY_ENV: 'production',
  TAPPAY_PARTNER_KEY: 'pk-test',
  TAPPAY_MERCHANT_ID: 'pcm-prod',
};

describe('buildD1TapPayConfig', () => {
  it('production + 雙輸入相符才放行', () => {
    expect(buildD1TapPayConfig(GOOD_ENV, 'pcm-prod')).toEqual({
      partnerKey: 'pk-test',
      merchantId: 'pcm-prod',
    });
  });

  it.each(['sandbox', undefined, 'prod'])('TAPPAY_ENV=%s = 拒(D1 只打正式商戶)', (env) => {
    expect(() => buildD1TapPayConfig({ ...GOOD_ENV, TAPPAY_ENV: env }, 'pcm-prod')).toThrow(
      /TAPPAY_ENV 必須是 production/,
    );
  });

  it('缺 partner key / merchant id = 拒', () => {
    expect(() => buildD1TapPayConfig({ ...GOOD_ENV, TAPPAY_PARTNER_KEY: undefined }, 'pcm-prod')).toThrow(
      /TAPPAY_PARTNER_KEY/,
    );
    expect(() => buildD1TapPayConfig({ ...GOOD_ENV, TAPPAY_MERCHANT_ID: undefined }, 'pcm-prod')).toThrow(
      /TAPPAY_MERCHANT_ID/,
    );
  });

  it('雙輸入不符 / 空 expected = 拒(單一來源自比自 = 沒斷言)', () => {
    expect(() => buildD1TapPayConfig(GOOD_ENV, 'pcm-other')).toThrow(/雙輸入不符/);
    expect(() => buildD1TapPayConfig(GOOD_ENV, '')).toThrow(/雙輸入不符/);
  });
});

describe('endpoint 字面單一事實(防與 composition.ts 漂移)', () => {
  it('與 apps/storefront composition.ts 的 production Record URL 逐字一致', () => {
    const src = readFileSync(
      path.join(__dirname, '../apps/storefront/src/lib/payment/composition.ts'),
      'utf8',
    );
    const m = src.match(/production:\s*'([^']+\/tpc\/transaction\/query)'/);
    expect(m?.[1]).toBe(PROD_RECORD_QUERY_URL);
  });
});

describe('assertStrictRecordWire(R1-17 + R3-F6)', () => {
  it('缺 trade_records ∧ 計數 0 = 合法空回應;計數非 0 = throw', () => {
    expect(() => assertStrictRecordWire({ status: 2, number_of_transactions: 0 })).not.toThrow();
    expect(() => assertStrictRecordWire({ status: 0, number_of_transactions: 1 })).toThrow(/計數非 0/);
  });

  it('trade_records 非陣列 / 長度與計數不符 / 計數非 number = throw', () => {
    expect(() => assertStrictRecordWire({ status: 0, number_of_transactions: 1, trade_records: 'x' })).toThrow(
      /非陣列/,
    );
    expect(() =>
      assertStrictRecordWire({ status: 0, number_of_transactions: 2, trade_records: [{}] }),
    ).toThrow(/不符/);
    expect(() => assertStrictRecordWire({ status: 0, trade_records: [] })).toThrow(/number_of_transactions/);
    expect(() => assertStrictRecordWire(null)).toThrow(/非物件/);
  });
});

describe('queryRecordByRecTradeId', () => {
  const CONFIG = { partnerKey: 'pk-test', merchantId: 'pcm-prod' };
  const REC = {
    rec_trade_id: 'REC1',
    order_number: 'PCM-2026-0102',
    merchant_id: 'pcm-prod',
    amount: 101,
    currency: 'TWD',
    record_status: 3,
    is_captured: true,
    refunded_amount: 101,
    transaction_time_millis: 1753000000000,
  };

  function fakeFetch(
    body: unknown,
    opts: { ok?: boolean; status?: number } = {},
  ): { fetch: FetchLike; calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> } {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok: opts.ok ?? true, status: opts.status ?? 200, json: async () => body };
    };
    return { fetch, calls };
  }

  const OPTIONS = (fetchImpl: FetchLike) => ({
    deadlineAt: Date.now() + 60_000,
    abortSignal: new AbortController().signal,
    fetchImpl,
  });

  it('request 形狀照 adapter:prod URL、x-api-key、merchant_id Array、rec_trade_id 鍵、真的接上 AbortSignal', async () => {
    const { fetch, calls } = fakeFetch({ status: 0, number_of_transactions: 1, trade_records: [REC] });
    const wire = await queryRecordByRecTradeId(CONFIG, 'REC1', OPTIONS(fetch));

    expect(wire.records[0]?.recTradeId).toBe('REC1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(PROD_RECORD_QUERY_URL);
    expect(calls[0]!.init.headers['x-api-key']).toBe('pk-test');
    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
    expect(body.filters).toEqual({ merchant_id: ['pcm-prod'], rec_trade_id: 'REC1' });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('外部 controller 真的接到 fetch(abort 後 signal.aborted = true;非只驗實例形狀)', async () => {
    const { fetch, calls } = fakeFetch({ status: 2, number_of_transactions: 0 });
    const controller = new AbortController();
    await queryRecordByRecTradeId(CONFIG, 'REC1', {
      deadlineAt: Date.now() + 60_000,
      abortSignal: controller.signal,
      fetchImpl: fetch,
    });
    expect(calls[0]!.init.signal.aborted).toBe(false);
    controller.abort();
    // AbortSignal.any 若被換成只留 timeout,外部 abort 不會傳導到這裡 —— 本斷言轉紅。
    expect(calls[0]!.init.signal.aborted).toBe(true);
  });

  it('timeout 腿真的接上:剩餘時間到、外部未 abort,fetch 的 signal 仍會被中止', async () => {
    const fetch: FetchLike = (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason as Error));
      });
    await expect(
      queryRecordByRecTradeId(CONFIG, 'REC1', {
        deadlineAt: Date.now() + 40, // 剩餘 40ms < 30s ⇒ timeout 腿取剩餘時間。
        abortSignal: new AbortController().signal,
        fetchImpl: fetch,
      }),
    ).rejects.toThrow();
  });

  it('整批 deadline 已到 = throw 不發請求(不自動重試)', async () => {
    const { fetch, calls } = fakeFetch({});
    await expect(
      queryRecordByRecTradeId(CONFIG, 'REC1', {
        deadlineAt: Date.now() - 1,
        abortSignal: new AbortController().signal,
        fetchImpl: fetch,
      }),
    ).rejects.toThrow(/deadline/);
    expect(calls).toHaveLength(0);
  });

  it('HTTP 非 2xx = throw;回應含非本商戶紀錄 = throw;缺查詢鍵 = throw', async () => {
    const { fetch } = fakeFetch({}, { ok: false, status: 500 });
    await expect(queryRecordByRecTradeId(CONFIG, 'REC1', OPTIONS(fetch))).rejects.toThrow(/HTTP 500/);

    const foreign = fakeFetch({
      status: 0,
      number_of_transactions: 1,
      trade_records: [{ ...REC, merchant_id: '別家商戶' }],
    });
    await expect(queryRecordByRecTradeId(CONFIG, 'REC1', OPTIONS(foreign.fetch))).rejects.toThrow(/非本商戶/);

    await expect(queryRecordByRecTradeId(CONFIG, '', OPTIONS(fakeFetch({}).fetch))).rejects.toThrow(/查詢鍵/);
  });

  it('嚴格 wire 前置在 parser 之前生效(寬鬆補值不得把格式漂移寫成查無)', async () => {
    const { fetch } = fakeFetch({ status: 0 }); // 缺 number_of_transactions:舊 parser 會自補
    await expect(queryRecordByRecTradeId(CONFIG, 'REC1', OPTIONS(fetch))).rejects.toThrow(/wire 不完整/);
  });
});
