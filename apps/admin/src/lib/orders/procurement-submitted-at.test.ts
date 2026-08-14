// 🔴🔴 **釘一個「不是台北」的時區**(理由同 `procurement-view.test.ts` 檔頭):本檔的契約是
//    「一律用 Asia/Taipei」,而測試機器本來就在台北 ⇒ 「用裝置時區」的壞實作與正解完全重合、
//    斷言零判別力。釘非台北才量得到。
process.env.TZ = 'America/New_York';

import { describe, it, expect } from 'vitest';
import { composeSubmittedAt, secondsOf } from './procurement-submitted-at';

// ╔═ `#476` 拆檔片(2026-08-14):本檔存在的理由就是「這段原本測不到」════════════════════
// ║ `composeSubmittedAt` 原本是 `item-procurement-form.tsx` 的 `useActionState` wrapper 裡
// ║ 一段內嵌三元式 ⇒ 只能繞著整張表單打(render → 選供應商 → 改欄位 → submit → 讀 FormData)。
// ║ 那三格元件測試**仍然留著**(它們證的是「接線對」),本檔證的是「算式對」。兩者不重複。
// ║
// ║ ⚠️ **本函式不是純搬家** —— 原本是內嵌式,這裡是新的具名形狀 ⇒ 要用真值表逐輸入釘住,
// ║   不能靠「三綠還是綠的」宣稱行為沒變。(純搬家的是 `secondsOf`,逐字剪貼。)
// ╚═══════════════════════════════════════════════════════════════════════════════════

describe('secondsOf — 台北牆上時間的秒(純搬家,行為必須與搬移前逐字相同)', () => {
  it.each([
    ['2026-08-04T06:30:45.123Z', '45'],
    ['2026-08-04T06:30:00.000Z', '00'],
    ['2026-08-04T06:30:07Z', '07'],
    // 🔴 跨日邊界:UTC 16:00:59 = 台北隔日 00:00:59 ⇒ 秒不受日期進位影響
    ['2026-08-04T16:00:59.000Z', '59'],
  ])('%s → %s', (iso, expected) => {
    expect(secondsOf(iso)).toBe(expected);
  });

  it('null / 壞字面 → "00"(不丟例外 —— 呼叫端在送出路徑上,丟了就整張表單掛掉)', () => {
    expect(secondsOf(null)).toBe('00');
    expect(secondsOf('not-a-date')).toBe('00');
  });
});

describe('composeSubmittedAt — 送進 RPC 的 submitted_at 字面(真值表)', () => {
  // UTC 06:30:45 = 台北 14:30:45 ⇒ `toTaipeiInputValue` 回 '2026-08-04T14:30'
  const ORIG = '2026-08-04T06:30:45.123Z';

  it.each([
    // [情境, local(可見欄), originalSubmittedAt, 預期送出]
    ['同一分鐘 + 原值正常 ⇒ 把原值的秒補回去', '2026-08-04T14:30', ORIG, '2026-08-04T14:30:45'],
    ['真的改了時間 ⇒ 送新值,不死抱原始 ISO', '2026-08-04T15:00', ORIG, '2026-08-04T15:00'],
    ['員工清空 ⇒ 回空字串(合法的「清成 NULL」路徑,不得擋)', '', ORIG, ''],
    ['沒有原值(新建)⇒ 原樣送出', '2026-08-04T14:30', null, '2026-08-04T14:30'],
    ['原值是壞字面 ⇒ 退回 local,不合成', '2026-08-04T14:30', 'not-a-date', '2026-08-04T14:30'],
    ['兩邊都空 ⇒ 空字串', '', null, ''],
    // 🔴 秒為 00 的原值也要走合成那條(否則「原本就是整分」會被當成沒有原值)
    ['同一分鐘 + 原值秒為 00 ⇒ 補回 :00', '2026-08-04T14:30', '2026-08-04T06:30:00.000Z', '2026-08-04T14:30:00'],
  ])('%s', (_name, local, original, expected) => {
    expect(composeSubmittedAt(local as string, original as string | null)).toBe(expected);
  });

  it('🔴 結果與**裝置**時區無關:斷言用固定字面、不從 Date 的本地欄位推導', () => {
    // 檔頭把 TZ 釘成 America/New_York;若實作誤用裝置時區,上面那組會整組偏 12-13 小時。
    expect(process.env.TZ).toBe('America/New_York');
    expect(composeSubmittedAt('2026-08-04T14:30', ORIG)).toBe('2026-08-04T14:30:45');
  });
});
