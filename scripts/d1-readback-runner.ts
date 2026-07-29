/**
 * D1t2:`runReadback` 的兩個實作 —— 真 TapPay 版(production)與 fixture 版(rehearsal)。
 *
 * 🔴 介面合約(d1-orchestrator.ts deps.runReadback JSDoc):只收五筆有鍵 facts、
 * 必須以 `fact.recTradeId` 為查詢鍵逐筆對應 —— 0052 的零命中出口在判定層驗不到
 * 「查的鍵對不對」,鍵綁錯會靜默落成「正式商戶查無」⇒ 本檔測試斷言 fetch body 的
 * `rec_trade_id === fact.recTradeId`。
 *
 * 🔴 fixture 版(rehearsal 專用;production 帶 fixture = CLI 層拒收):
 * - key set 必須恰等於五筆 keyed displayId(0101 出現 = 拒 —— 無鍵單物理上不進查詢層);
 * - 每筆過 `assertStrictRecordWire` + `parseTapPayRecordResponse` + `assertRecordsMerchant`
 *   (假資料不得比正式路徑寬鬆);merchant 基準 = fixture 檔內自帶的 `merchantId` 宣告
 *   (形狀紀律、非身分證明)。
 */
import { readFileSync } from 'node:fs';

import type { TapPayRecordResponseWire } from '../packages/adapters/src/tappay/wire';
import { parseTapPayRecordResponse } from '../packages/adapters/src/tappay/wire';
import type { D1KeyedAttemptFact } from './d1-readback';
import {
  assertRecordsMerchant,
  assertStrictRecordWire,
  queryRecordByRecTradeId,
  type D1TapPayClientConfig,
  type FetchLike,
} from './d1-tappay-client';

export type D1RunReadback = (
  facts: readonly D1KeyedAttemptFact[],
  abortSignal: AbortSignal,
  deadlineAt: number,
) => Promise<ReadonlyMap<string, TapPayRecordResponseWire>>;

/** 真 TapPay 版:五筆逐筆查(共享 deadline 與 abort signal;任何 throw = 整批 abort、不重試)。 */
export function makeLiveReadback(
  config: D1TapPayClientConfig,
  fetchImpl?: FetchLike,
): D1RunReadback {
  return async (facts, abortSignal, deadlineAt) => {
    const results = new Map<string, TapPayRecordResponseWire>();
    for (const fact of facts) {
      const wire = await queryRecordByRecTradeId(config, fact.recTradeId, {
        deadlineAt,
        abortSignal,
        fetchImpl,
      });
      results.set(fact.displayId, wire);
    }
    return results;
  };
}

export type D1ReadbackFixture = Readonly<{
  /** fixture 的商戶宣告 —— 每筆 record 的 merchant_id 必須等於它(形狀紀律)。 */
  merchantId: string;
  /** displayId → Record API raw 回應(過 strict wire 檢查與 parser 的原始形狀)。 */
  responses: Readonly<Record<string, unknown>>;
}>;

/** fixture 版:讀檔驗形狀;key set 恰等於五筆 keyed facts。 */
export function makeFixtureReadback(fixturePath: string): D1RunReadback {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as D1ReadbackFixture;
  if (!fixture.merchantId || typeof fixture.responses !== 'object' || fixture.responses === null) {
    throw new Error('D1:readback fixture 缺 merchantId 或 responses;拒繼續');
  }
  return async (facts) => {
    const fixtureKeys = Object.keys(fixture.responses).sort();
    const factKeys = facts.map((f) => f.displayId).sort();
    if (fixtureKeys.join() !== factKeys.join()) {
      throw new Error(
        `D1:fixture key set(${fixtureKeys.join(',')})必須恰等於五筆有鍵單(${factKeys.join(',')});拒繼續`,
      );
    }
    const results = new Map<string, TapPayRecordResponseWire>();
    for (const fact of facts) {
      const raw = fixture.responses[fact.displayId];
      assertStrictRecordWire(raw);
      const wire = parseTapPayRecordResponse(raw);
      assertRecordsMerchant(wire, fixture.merchantId);
      results.set(fact.displayId, wire);
    }
    return results;
  };
}
