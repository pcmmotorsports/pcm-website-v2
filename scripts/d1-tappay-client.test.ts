/**
 * D1t1:獨立 runbook TapPay client。
 * 🔴 本檔在純 node(vitest node 環境)import 受測模組 = 「node 可載入」的實證
 * (TapPayChargeAdapter 因 server-only 在這裡 import 會直接炸;這正是要獨立 client 的原因)。
 */
import { describe, expect, it } from 'vitest';

import { tapPayUrlsFor } from '../apps/storefront/src/lib/payment/tappay-endpoints';

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

describe('endpoint 字面單一事實(防與 storefront 漂移)', () => {
  // 2026-08-03 退款線第一片:URL 字面自 composition.ts 移到 tappay-endpoints 純模組(單一來源),
  // 本守門改為 import 比對模組回傳值。🔴 誠實邊界(codex 關卡2):本格只證「scripts 與 endpoints
  // 模組一致」,證不了「composition 真的用該模組」—— 那半由 tappay-endpoints.test.ts 的
  // composition 源碼守門(展開注入 + 零 tappaysdk 字面)承接,兩格合起來才等價於舊 regex 守門。
  it('與 apps/storefront tappay-endpoints 的 production Record URL 逐字一致', () => {
    expect(tapPayUrlsFor('production').recordQueryUrl).toBe(PROD_RECORD_QUERY_URL);
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
    // #301:全額退款紀錄的形狀。`amount=0` / `refunded_amount=101` / `record_status=3` /
    //   `is_captured=false` 取自 2026-07-30 正式商戶實測 0102;**`original_amount` 與 `time`
    //   的值未被觀察過、此處為合成值**(關卡2 R2-13)。
    amount: 0,
    original_amount: 101,
    currency: 'TWD',
    record_status: 3,
    is_captured: false, // 實測:已全額退款筆為 false
    refunded_amount: 101,
    time: 1753000000000,
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
