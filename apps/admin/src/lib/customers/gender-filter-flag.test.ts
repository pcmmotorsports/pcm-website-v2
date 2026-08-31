// @vitest-environment node
//
// `:573` 段③ 的【部署順序閘】—— 這支只驗那顆旗標本身的白名單語意。
// 🔴 而**把「下拉」與「查詢」兩半綁在一起**的是隔壁那支
//    `../../components/customers/customer-gender-filter-flag.test.tsx`。
//    兩支都要,理由:本支證得出「旗標會分辨開與關」,
//    **證不出「關的時候那兩半真的都關了」** —— 那是兩個宣稱。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { genderFilterEnabled, applyGenderGate } from './gender-filter-flag';

const KEY = 'ADMIN_CUSTOMER_GENDER_FILTER';

describe('genderFilterEnabled — 白名單語意', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("只有逐字 '1' 算開", () => {
    process.env[KEY] = '1';
    expect(genderFilterEnabled()).toBe(true);
  });

  // 🔴 這一格是本支的**主要判別力**:如果實作寫成「有設就算開」,
  //    下面每一個值都會讓它回 true ⇒ 一個打錯的值會靜靜地把閘打開,
  //    而那時 view 上還沒有 gender 欄 ⇒ 員工按下去炸頁。
  it.each(['0', 'true', 'TRUE', 'yes', '', ' 1', '1 ', 'on'])(
    "「%s」不算開(白名單, 不是『有設就算』)",
    (v) => {
      process.env[KEY] = v;
      expect(genderFilterEnabled()).toBe(false);
    },
  );

  it('沒設 ⇒ 關(預設安全:忘了設 ⇒ 下拉不出現 ⇒ 沒有人受傷)', () => {
    delete process.env[KEY];
    expect(genderFilterEnabled()).toBe(false);
  });
});

// ══ 🔴🔴 這一段守的是【那個呼叫還在不在】,不是【那支函式對不對】═══════════════
//   codex R1(2026-09-01)逐字:「刪掉正式頁面的抹除,這支仍全綠」——
//   抽出 `applyGenderGate` 之後,函式本身測得到了,**而「`page.tsx` 有沒有呼叫它」
//   仍然沒有任何東西在看。** 那一句被刪掉 ⇒ 手打 `?gender=male` 就會走到
//   `.eq('gender', …)` ⇒ view 上還沒有那一欄 ⇒ **42703 炸頁**,而三綠全綠。
//
//   ⚠️ **這是原始碼字面掃描,不是行為測試** —— 它的已知限制:
//     ① 有人把呼叫改寫成等價的別種寫法(解構、包一層)⇒ **會假紅**。
//        ⇒ 那時**改這支測試是對的**,而改的人必須在 commit body 說明為什麼。
//     ② 它證不出「跑起來真的有抹除」—— 只證得出那個字面在檔裡。
//     📌 而它仍然值得裝:**它擋的是「整行刪掉」,那是這一族最常見的死法。**
describe('部署順序閘 — `page.tsx` 真的有呼叫那道閘(原始碼掃描)', () => {
  const PAGE = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../app/customers/page.tsx',
  );
  const src = readFileSync(PAGE, 'utf8');

  it('🔴 page.tsx 仍然呼叫 applyGenderGate(整行被刪掉 ⇒ 手打網址就會炸頁)', () => {
    expect(src, 'page.tsx 沒有 import applyGenderGate').toContain('applyGenderGate');
    expect(src, 'page.tsx 有 import 卻沒有真的呼叫它').toMatch(/applyGenderGate\(/);
  });

  it('🔴 page.tsx 仍然讀那顆旗標(不是寫死 true)', () => {
    expect(src).toMatch(/genderFilterEnabled\(\)/);
    expect(src, '把閘寫死成 true = 沒有閘').not.toMatch(/applyGenderGate\([^,]+,\s*true\s*\)/);
  });

  // 🔵 負對照 —— 沒有它的話, 上面兩格在「檔案讀成空字串」時也會…紅, 但理由完全不同。
  //    這一格證明我讀到的是【那支檔】而不是別的東西。
  it('🔵 負對照:讀到的確實是客戶頁(而不是一個空檔或別支檔)', () => {
    expect(src).toContain('parseCustomerListSearchParams');
    expect(src).not.toContain('zzq0901-not-in-this-file');
  });
});

describe('applyGenderGate — 產品那一份抹除邏輯', () => {
  it('關 ⇒ gender 被抹掉, 其餘軸原封不動', () => {
    const got = applyGenderGate({ tier: 'store', gender: 'male', birthMonth: 7 }, false);
    expect(got.gender).toBeUndefined();
    expect(got.tier).toBe('store');
    expect(got.birthMonth).toBe(7);
  });
  it('🟢 開 ⇒ 原樣帶過去(沒有它, 上一格在「永遠抹掉」時也綠)', () => {
    expect(applyGenderGate({ gender: 'undisclosed' }, true).gender).toBe('undisclosed');
  });
});
