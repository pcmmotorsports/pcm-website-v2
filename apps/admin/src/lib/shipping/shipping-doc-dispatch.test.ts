import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shippedDateText, trackingDisplay } from './shipping-doc-dispatch';

// #10 片3 驗收 ③ ④ ⑤(plan `2026-08-16-shipping-doc-carrier-tracking-plan.md` §6)。
//
// 🔴 **2026-08-17 起,本檔的「紙上」要讀成「呈現給客人時」。**
//    `Q-C5`=丙:出貨明細單**不印追蹤碼** ⇒ `trackingDisplay` 目前**零消費端**
//    (理由在該函式 docstring;三種 `null` 的分法保留給 `Q-C9` 的出貨通知信)。
//    ⚠️ **本檔一格都沒刪、一個斷言都沒改** —— 它測的是**判斷本身**,那件事沒有作廢。
//    ⇒ 下面的測試名稱與註解仍用當時的語境(「印出來」「紙上」),**刻意不改寫**:
//      改字面會讓 `git log -S` 找不到它們與那次拍板的關係,而語境已在這裡交代清楚。

describe('追蹤碼:三種 null 在紙上不可以長成同一個樣子(plan §3.1)', () => {
  const base = { carrierCode: 'hct', trackingNumber: null, shippedAt: null };

  it('有追蹤碼 ⇒ 印出來,而且標籤帶貨運商名(plan §4:三個號碼並排)', () => {
    const r = trackingDisplay({ ...base, trackingNumber: '1234567890', shippedAt: '2026-08-16T02:00:00Z' });
    expect(r).toEqual({ kind: 'number', label: '新竹物流追蹤碼', value: '1234567890' });
    // 🔴 光寫「追蹤碼」不夠 —— 只有這個號碼是拿去【別人家網站】查的。
    expect(r.kind === 'number' && r.label).toContain('新竹物流');
  });

  it('🔴 情形① 箱還沒標出貨 ⇒ 【空白】(Q-C9b=乙,Sean 逐字「什麼都不寫 ,空格」)', () => {
    expect(trackingDisplay({ ...base, shippedAt: null })).toEqual({ kind: 'pending' });
    // 🔴 R2 F5:`pending` 那一支【刻意沒有 `text`】—— 給它一個永遠空的欄位會誘導畫面端寫 fallback,
    //    而那個 fallback 會印出「追蹤碼:」加空白 = 一個看起來壞掉的欄位。型別自己擋住比註解可靠。
    // 🔴 負向:填回「尚未出貨,出貨後補」之類的字 ⇒ 本格紅。
    //    那句話承諾的「補」目前【沒有管道】(通知信暫緩、沒有會員訂單頁)= 對客假承諾。
  });

  it('🔴🔴 情形①(空白)與情形③(fail-loud)【必須是兩條分支】—— 差別只在 shippedAt', () => {
    // ⚠️ 兩者在資料上都是「沒有追蹤碼」,長得一模一樣。
    //    合併成「都留空」會把一個資料鏈的洞變成看不見的 —— 那正是情形③ 存在的理由。
    const noTracking = { carrierCode: 'sf', trackingNumber: null };
    const pending = trackingDisplay({ ...noTracking, shippedAt: null });
    const missing = trackingDisplay({ ...noTracking, shippedAt: '2026-08-16T02:00:00Z' });
    expect(pending.kind).toBe('pending');
    expect(missing.kind).toBe('missing');
    // 🔴 釘「不同」這個性質,不只釘各自的值 —— 有人把它們合併時這一行會紅。
    expect(pending.kind).not.toBe(missing.kind);
    // 🔴 `text` 不在 `number` 那一支上 ⇒ 用 kind 收窄再讀,不要 cast 繞過型別。
    //    (型別在這裡是幫手不是障礙:它逼我證明「我拿到的真的是這兩支」。)
    // 🔴 `pending` 沒有 `text` 可讀(F5)⇒ 這裡改釘「它就是那一支」,而下面釘 missing 有內容。
    expect(pending).toEqual({ kind: 'pending' });
    expect(missing.kind === 'missing' && missing.text.trim()).not.toBe('');
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
