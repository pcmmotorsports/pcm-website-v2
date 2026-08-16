import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shippedDateText, trackingDisplay } from './shipping-doc-dispatch';

// #10 片3 驗收 ③ ④ ⑤(plan `2026-08-16-shipping-doc-carrier-tracking-plan.md` §6)。

describe('追蹤碼:三種 null 在紙上不可以長成同一個樣子(plan §3.1)', () => {
  const base = { carrierCode: 'hct', trackingNumber: null, shippedAt: null };

  it('有追蹤碼 ⇒ 印出來,而且標籤帶貨運商名(plan §4:三個號碼並排)', () => {
    const r = trackingDisplay({ ...base, trackingNumber: '1234567890', shippedAt: '2026-08-16T02:00:00Z' });
    expect(r).toEqual({ kind: 'number', label: '新竹物流追蹤碼', value: '1234567890' });
    // 🔴 光寫「追蹤碼」不夠 —— 只有這個號碼是拿去【別人家網站】查的。
    expect(r.kind === 'number' && r.label).toContain('新竹物流');
  });

  it('情形① 箱還沒標出貨 ⇒ 尚未出貨,出貨後補', () => {
    expect(trackingDisplay({ ...base, shippedAt: null })).toEqual({
      kind: 'pending',
      text: '尚未出貨,出貨後補',
    });
  });

  it('🔴 情形① 對 other 也成立 —— 還沒出貨的自取箱不該講「自取自送」', () => {
    // 順序題:實作若把 other 判在 shippedAt 之前,這格紅。
    expect(trackingDisplay({ ...base, carrierCode: 'other', shippedAt: null }).kind).toBe('pending');
  });

  it('情形② 已出貨 + other ⇒ 說明本來就沒有,而且【不重印 carrierNote】', () => {
    // 🔴 R1 must-fix 4:`carrierNote` 已經印在「貨運商」那格,這裡再印一次
    //    會讓同一句話在同一張紙出現兩次 ⇒ 讀的人以為是兩件事。
    expect(trackingDisplay({ ...base, carrierCode: 'other', shippedAt: '2026-08-16T02:00:00Z' })).toEqual(
      { kind: 'selfService', text: '無追蹤碼(自取 / 自送)' },
    );
  });

  it('🔴 情形③ 已出貨 + 非 other + 沒追蹤碼 ⇒ fail-loud,不留白(plan §6 ④)', () => {
    const r = trackingDisplay({ ...base, carrierCode: 'sf', shippedAt: '2026-08-16T02:00:00Z' });
    expect(r).toEqual({ kind: 'missing', text: '追蹤碼缺漏 —— 系統已記為已出貨,請立即回報' });
    // 負向(plan §6 ④):實作改成回 `{ kind: 'selfService', text: '' }` 或留白 ⇒ 本格紅。
    expect(r.kind).not.toBe('selfService');
    // 🔴 `kind` 與**印出去的字**要分開釘:只釘 kind 的話,實作把 text 改成 `''`
    //    仍然全綠,而紙上就是一片留白 —— 那正是本格要擋的東西。
    expect(r.kind === 'missing' && r.text.trim()).not.toBe('');
  });

  it('🔴 全是空白字元的追蹤碼算「沒有」,不是「有一個看不見的號碼」', () => {
    expect(
      trackingDisplay({ ...base, carrierCode: 'sf', trackingNumber: '   ', shippedAt: '2026-08-16T02:00:00Z' })
        .kind,
    ).toBe('missing');
  });

  it('未知代碼也照樣印得出標籤(不留白)', () => {
    const r = trackingDisplay({ ...base, carrierCode: 'xyz', trackingNumber: 'A1', shippedAt: '2026-08-16T02:00:00Z' });
    expect(r).toEqual({ kind: 'number', label: 'xyz追蹤碼', value: 'A1' });
  });
});

describe('出貨日:Asia/Taipei 曆面(plan §6 ⑤)', () => {
  // 🔴🔴 **本 describe 的判別力【只在 TZ=UTC 下存在】。**
  //    `vitest.config.ts`(錨點 `env: { TZ:`)把測試時區釘死成 Asia/Taipei,
  //    而 plan §8.1 實測過:在台北時區下掃 960 個整點,「有指定時區」與「沒指定時區」
  //    **不同的時刻 = 0** ⇒ **換測資完全救不了這格,只能換環境。**
  //    ⇒ 下面在執行期把 TZ 切成 UTC(= production 伺服器的樣子)再跑。
  const original = process.env.TZ;

  beforeAll(() => {
    // 🔴 **前提斷言**:沒有這一半的話,哪天 vitest.config.ts 那行被拿掉,
    //    這族會【靜默】變成在測一個沒被釘住的環境,而且不會有任何東西轉紅。
    expect(process.env.TZ, 'vitest.config.ts 的 env.TZ 不再是 Asia/Taipei ⇒ 本檔的前提沒了').toBe(
      'Asia/Taipei',
    );
    process.env.TZ = 'UTC';
    // 確認真的切得動(plan §8.1 探針③ 在 vitest 裡實測過;這裡把它變成常駐斷言)。
    expect(new Date('2026-08-16T17:00:00Z').toLocaleDateString('en-CA')).toBe('2026-08-16');
  });

  afterAll(() => {
    process.env.TZ = original;
  });

  // 台北 2026-08-17 01:00 = UTC 2026-08-16 17:00 ⇒ 兩邊的「今天」差一天。
  const crossesMidnight = new Date('2026-08-16T17:00:00Z');

  it('🔴 未出貨 ⇒ 印列印當天的【台北】日期,不是伺服器的 UTC 日期', () => {
    expect(shippedDateText(null, crossesMidnight)).toBe('2026-08-17');
    // 負向(plan §6 ⑤):實作拿掉 `{ timeZone: 'Asia/Taipei' }` ⇒ 在此得到 '2026-08-16' ⇒ 紅。
  });

  it('🔴 已出貨 ⇒ 印 shippedAt 的【台北】日期', () => {
    expect(shippedDateText('2026-08-16T17:00:00Z')).toBe('2026-08-17');
  });

  it('已出貨時不看 now —— 印的是出貨那天,不是列印那天', () => {
    expect(shippedDateText('2026-08-16T02:00:00Z', new Date('2026-12-25T00:00:00Z'))).toBe('2026-08-16');
  });

  it('非法時間戳原樣回傳,不 throw(server component 裡 throw = 整張紙 500)', () => {
    expect(shippedDateText('not-a-date')).toBe('not-a-date');
  });
});
