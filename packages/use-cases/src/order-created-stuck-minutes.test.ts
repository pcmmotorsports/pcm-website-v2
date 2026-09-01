import { describe, expect, it } from 'vitest';

import { readOrderCreatedStuckMinutes } from './order-created-stuck-minutes';

/**
 * 🔴 板 ⟦b4-SIG4ERRORS⟧ 的三態閘。
 * 🛑 **`unset` 那一格的驗收是「行為與今天逐字相同」** —— 而那不是宣稱:
 *    它回 `{kind:'unset'}` ⇒ 呼叫端不查 ⇒ 沒有任何新的告警路徑被走到。
 */
describe('readOrderCreatedStuckMinutes', () => {
  it('unset:env 沒設 ⇒ 還沒上膛(這一格保「落地零風險」)', () => {
    expect(readOrderCreatedStuckMinutes(undefined)).toEqual({ kind: 'unset' });
  });

  // 🔴 這一格是 readDeployCutoff 用 codex must-fix 換來的:
  //    寫成 `!raw` 的話, 空字串會被判成「沒設」⇒ 有人貼成空值而整件事安靜地沒發生。
  it('invalid:空字串【不是】unset —— 它要吵得出來', () => {
    expect(readOrderCreatedStuckMinutes('')).toEqual({ kind: 'invalid' });
  });

  it('ok:Sean 2026-09-01 拍「甲 1 小時」⇒ 那顆 env 填 60', () => {
    expect(readOrderCreatedStuckMinutes('60')).toEqual({ kind: 'ok', minutes: 60 });
  });

  // 🛑 0 與負數在 DB 那側會 RAISE;這裡先擋 ⇒ 一個「設定填錯」不該長得像「資料庫壞了」。
  it.each(['0', '-1', '-60'])('invalid:%s(<= 0 會讓每一筆新訂單都算卡住 = 對常態發警報)', (raw) => {
    expect(readOrderCreatedStuckMinutes(raw)).toEqual({ kind: 'invalid' });
  });

  // 🔴 這些值 Number() 都吃得下 —— 而它們代表「填的人心裡想的不是這一格」。
  it.each(['60.0', '6e1', '+60', ' 60', '60 ', '六十', 'sixty'])(
    'invalid:%s(不猜他的意思, 讓他重填)',
    (raw) => {
      expect(readOrderCreatedStuckMinutes(raw)).toEqual({ kind: 'invalid' });
    },
  );

  it('invalid:超過一年 ⇒ 那是「這條線實際上是關的」, 而那該用 unset 表達', () => {
    expect(readOrderCreatedStuckMinutes('525601')).toEqual({ kind: 'invalid' });
    expect(readOrderCreatedStuckMinutes('525600')).toEqual({ kind: 'ok', minutes: 525_600 });
  });
});
