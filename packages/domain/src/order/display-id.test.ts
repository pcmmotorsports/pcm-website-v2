import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isValidDisplayId, assertDisplayId } from './display-id';
import { OrderError } from './errors';

// N2(2026-07-30):display-id 從「產生 + 驗證舊格式」改成「只驗證、兩格式並存」。
// 🔴 兩種格式永久並存(Sean 拍板 Q1=A):正式站 30 張舊格式單不改號,
//    而新單由 DB 的 pcm_generate_display_id() 產 6 碼亂碼。
//
// 🔴 突變紀律(feedback_negative-test-harness-self-false-green):
//    「新格式 accept」與「舊格式 accept」必須是**兩條獨立斷言**,
//    且各自配一個只紅它的突變 —— 若把 assertDisplayId 的 regex 改成只留一種,
//    必須只有對應那一條紅。兩個突變紅在同一條 = 測試只是陪襯。

describe('isValidDisplayId — 新格式(6 碼、§5.4a 合約)', () => {
  it('合法新格式回 true', () => {
    expect(isValidDisplayId('K7MTQ3')).toBe(true);
    expect(isValidDisplayId('BCDFGH')).toBe(true);
    expect(isValidDisplayId('234567')).toBe(true);
    expect(isValidDisplayId('ZZZZZZ')).toBe(true);
  });

  it('易混淆字元 0 O 1 I L 一律 false(字母表刻意去掉)', () => {
    expect(isValidDisplayId('K7MTQ0')).toBe(false);
    expect(isValidDisplayId('K7MTQO')).toBe(false);
    expect(isValidDisplayId('K7MTQ1')).toBe(false);
    expect(isValidDisplayId('K7MTQI')).toBe(false);
    expect(isValidDisplayId('K7MTQL')).toBe(false);
  });

  it('母音 A E U 一律 false(字母表刻意去掉、避免湊出字詞)', () => {
    expect(isValidDisplayId('K7MTQA')).toBe(false);
    expect(isValidDisplayId('K7MTQE')).toBe(false);
    expect(isValidDisplayId('K7MTQU')).toBe(false);
  });

  it('長度必須恰為 6', () => {
    expect(isValidDisplayId('K7MTQ')).toBe(false);
    expect(isValidDisplayId('K7MTQ33')).toBe(false);
  });

  it('小寫 false(合約是大寫 only)', () => {
    expect(isValidDisplayId('k7mtq3')).toBe(false);
  });
});

describe('isValidDisplayId — 舊格式(PCM-YYYY-NNNN)必須永久接受', () => {
  it('🔴 正式站現存 30 張都是這個形狀,擋掉它們就是把真實訂單判成非法', () => {
    expect(isValidDisplayId('PCM-2026-0001')).toBe(true);
    expect(isValidDisplayId('PCM-2026-0105')).toBe(true);
    expect(isValidDisplayId('PCM-2026-12345')).toBe(true);
  });

  it('形狀不符的舊格式變體回 false', () => {
    expect(isValidDisplayId('PCM-2026-1')).toBe(false); // 序號不足 4 位
    expect(isValidDisplayId('PCM-26-0001')).toBe(false); // 年非 4 位
    expect(isValidDisplayId('pcm-2026-0001')).toBe(false); // 小寫前綴
    expect(isValidDisplayId('ORD-2026-0001')).toBe(false); // 錯前綴
    expect(isValidDisplayId('PCM-2026-0001-x')).toBe(false); // 多餘尾段
  });
});

describe('isValidDisplayId — 共同拒絕', () => {
  it('空字串與雜訊', () => {
    expect(isValidDisplayId('')).toBe(false);
    expect(isValidDisplayId('bad')).toBe(false);
    expect(isValidDisplayId('   ')).toBe(false);
  });

  it('🔴 換行不得繞過錨點(D0 migration 也對 CHECK 驗過同一形狀)', () => {
    expect(isValidDisplayId('K7MTQ3\nBAD')).toBe(false);
    expect(isValidDisplayId('BAD\nK7MTQ3')).toBe(false);
    expect(isValidDisplayId('PCM-2026-0001\nBAD')).toBe(false);
  });
});

describe('assertDisplayId', () => {
  it('新格式合法回原值', () => {
    expect(assertDisplayId('K7MTQ3')).toBe('K7MTQ3');
  });

  it('舊格式合法回原值', () => {
    expect(assertDisplayId('PCM-2026-0105')).toBe('PCM-2026-0105');
  });

  it('非法 throw OrderError invalid_display_id', () => {
    expect(() => assertDisplayId('bad')).toThrow(OrderError);
    try {
      assertDisplayId('bad');
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_display_id');
    }
  });

  it('🔴 String wrapper 被 typeof 擋下(RegExp.test 會把它轉字串而誤判合法)', () => {
    // eslint-disable-next-line no-new-wrappers
    const wrapper = new String('K7MTQ3') as unknown as string;
    expect(() => assertDisplayId(wrapper)).toThrow(OrderError);
  });

  it('非字串輸入(runtime 越界)一律 throw、不當成合法', () => {
    expect(() => assertDisplayId(undefined as unknown as string)).toThrow(OrderError);
    expect(() => assertDisplayId(null as unknown as string)).toThrow(OrderError);
    expect(() => assertDisplayId(123 as unknown as string)).toThrow(OrderError);
  });
});

describe('🔴 regex 單一來源:display-id.ts 必須 import,不得自寫 regex', () => {
  // 🔴 **關卡2-A N9 / 關卡2-B n1**:原本這組寫成
  //      expect(isValidDisplayId(v)).toBe(ORDER_NUMBER_RE.test(v) || LEGACY_ORDER_NUMBER_RE.test(v))
  //    那是**同義反覆** —— 右邊就是 isValidDisplayId 的函式體字面,兩條 regex 一起改壞也不會紅,
  //    而 describe 標題卻宣稱「不自己重寫一份」= 標題大於它實際證明的東西。
  //    ⇒ 改成直接對**原始碼**斷言:有 import、且檔內沒有自寫的字母表 / 舊格式 regex 字面。
  const SRC = readFileSync(
    fileURLToPath(new URL('./display-id.ts', import.meta.url)),
    'utf8',
  );

  it('有從 ./order-number-search import 兩條 regex', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*LEGACY_ORDER_NUMBER_RE[^}]*ORDER_NUMBER_RE[^}]*\}\s*from\s*'\.\/order-number-search'/s,
    );
  });

  it('🔴 檔內沒有自寫的 regex 字面(否則就是第三份、必然漂移)', () => {
    // 只看程式碼:把 block/line 註解與 JSDoc 剝掉再查
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\[23456789BCDFGHJKMNPQRSTVWXYZ\]/); // 新格式字元集
    expect(code).not.toMatch(/PCM-\\d\{4\}/);                       // 舊格式 regex
    expect(code).not.toMatch(/new RegExp/);
  });

  it('兩種格式的判定行為與寫死的期望值一致(不參照實作字面)', () => {
    const cases: Array<[string, boolean]> = [
      ['K7MTQ3', true],
      ['PCM-2026-0105', true],
      ['K7MTQ0', false],
      ['k7mtq3', false],
      ['K7MTQ', false],
      ['PCM-2026-1', false],
      ['', false],
    ];
    for (const [input, want] of cases) {
      expect(isValidDisplayId(input), input).toBe(want);
    }
  });
});

describe('🔴 舊 API 已移除(產號能力不得留在 TS 側)', () => {
  it('display-id 模組不再匯出 formatDisplayId / parseDisplayId / DISPLAY_ID_PATTERN', async () => {
    const mod = await import('./display-id');
    expect(Object.keys(mod).sort()).toEqual(['assertDisplayId', 'isValidDisplayId']);
  });

  it('domain barrel 也不再匯出它們', async () => {
    const barrel = await import('../index');
    expect('formatDisplayId' in barrel).toBe(false);
    expect('parseDisplayId' in barrel).toBe(false);
    expect('isValidDisplayId' in barrel).toBe(true);
    expect('assertDisplayId' in barrel).toBe(true);
  });
});
