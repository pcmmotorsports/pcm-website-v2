// email-verification.test.ts — 板 :437,三種帳號 × 三種狀態。
//
// 🔴 **這支測的不是「函式會回東西」,是【五種情況兩兩分得開】。**
//    一個把每一格都回 'verified' 的實作,在只驗「有回傳」的測試底下**全綠**;
//    而那正是本片要修的病(分不開)。⇒ 所以每一格都釘**它獨有的 kind**,
//    再加一格**全體兩兩相異**的斷言當總結。
import { describe, expect, it } from 'vitest';

import {
  EMAIL_VERIFICATION_LABEL,
  LINE_PROVIDER,
  MANUAL_PROVIDER,
  classifyEmailVerification,
  type EmailVerification,
} from './email-verification';

const CONFIRMED = '2026-08-30T00:00:00Z';

describe('classifyEmailVerification', () => {
  it('一般 email 註冊 + 已驗證 ⇒ verified', () => {
    expect(classifyEmailVerification({ confirmedAt: CONFIRMED, provider: undefined, syntheticAddress: false }).kind).toBe(
      'verified',
    );
  });

  // 🔴 這一格才是客服在找的那個。
  it('一般 email 註冊 + 沒驗證 ⇒ unverified', () => {
    expect(classifyEmailVerification({ confirmedAt: null, provider: undefined, syntheticAddress: false }).kind).toBe(
      'unverified',
    );
  });

  // 🔴🔴 天真版(先看 confirmedAt)會讓這兩格落進 verified —— 那就是本檔存在的理由。
  it('LINE 登入【即使 confirmedAt 有值】⇒ line,不是 verified', () => {
    expect(classifyEmailVerification({ confirmedAt: CONFIRMED, provider: LINE_PROVIDER, syntheticAddress: false }).kind).toBe(
      'line',
    );
  });
  it('後台手動建【即使 confirmedAt 有值】⇒ manual,不是 verified', () => {
    expect(
      classifyEmailVerification({ confirmedAt: CONFIRMED, provider: MANUAL_PROVIDER, syntheticAddress: false }).kind,
    ).toBe('manual');
  });

  // 🔴 三態不得塌成兩態:讀不到 ≠ 未驗證。
  it('讀不到(null 輸入)⇒ unknown,而【不是】unverified', () => {
    const r = classifyEmailVerification(null);
    expect(r.kind).toBe('unknown');
    expect(r.kind).not.toBe('unverified');
  });

  // 🔴 負對照:LINE / manual 在【沒驗證】那一側也要走自己的分支,
  //    否則「先看帳號種類」這個順序只在一半的世界成立。
  it('LINE / manual 在 confirmedAt=null 時仍然是自己那一態', () => {
    expect(classifyEmailVerification({ confirmedAt: null, provider: LINE_PROVIDER, syntheticAddress: false }).kind).toBe(
      'line',
    );
    expect(classifyEmailVerification({ confirmedAt: null, provider: MANUAL_PROVIDER, syntheticAddress: false }).kind).toBe(
      'manual',
    );
  });

  // 🔵 **codex must-fix:沒有 provider 而位址是我們自己產的 ⇒ 孤兒。**
  //    `line-admin.ts:65` 點名 `generateLink` 會誤建這種帳號:合成信箱、空 app_metadata。
  it('合成信箱 + 無 provider ⇒ synthetic,而【不是】verified', () => {
    const r = classifyEmailVerification({
      confirmedAt: CONFIRMED,
      provider: undefined,
      syntheticAddress: true,
    });
    expect(r.kind).toBe('synthetic');
    expect(r.kind).not.toBe('verified');
  });

  // 🔴 正對照:有 provider 時,那個旗標【不奪權】—— LINE 仍然是 line,不是 synthetic。
  it('有 provider 時,syntheticAddress 不改變結論', () => {
    expect(
      classifyEmailVerification({ confirmedAt: CONFIRMED, provider: LINE_PROVIDER, syntheticAddress: true }).kind,
    ).toBe('line');
    expect(
      classifyEmailVerification({ confirmedAt: CONFIRMED, provider: MANUAL_PROVIDER, syntheticAddress: true }).kind,
    ).toBe('manual');
  });

  it('不認得的 provider 走一般路(不要靜靜地變成 unknown)', () => {
    expect(classifyEmailVerification({ confirmedAt: null, provider: 'google', syntheticAddress: false }).kind).toBe(
      'unverified',
    );
  });

  // 🔴 總結格:五種 kind 兩兩相異。少了它,上面每一格單獨看都可以被一個
  //    「永遠回同一個值」的實作騙過去嗎?——不行(每格都釘了字面),
  //    而這一格釘的是【五個字面本身沒有重複】。
  it('五種 kind 兩兩相異', () => {
    const kinds: EmailVerification['kind'][] = [
      classifyEmailVerification({ confirmedAt: CONFIRMED, provider: undefined, syntheticAddress: false }).kind,
      classifyEmailVerification({ confirmedAt: null, provider: undefined, syntheticAddress: false }).kind,
      classifyEmailVerification({ confirmedAt: CONFIRMED, provider: LINE_PROVIDER, syntheticAddress: false }).kind,
      classifyEmailVerification({ confirmedAt: CONFIRMED, provider: MANUAL_PROVIDER, syntheticAddress: false }).kind,
      classifyEmailVerification(null).kind,
    ];
    expect(new Set(kinds).size).toBe(5);
  });
});

describe('EMAIL_VERIFICATION_LABEL', () => {
  it('五句文案兩兩不同(兩句一樣 ⇒ 那兩種帳號在畫面上又分不開了)', () => {
    const labels = Object.values(EMAIL_VERIFICATION_LABEL);
    expect(labels).toHaveLength(6);
    expect(new Set(labels).size).toBe(6);
  });

  // 🔴 負對照式斷言:「讀不到」那一句【不得】含「未驗證」——
  //    客服照著畫面對客人講話,而「我們讀不到」與「你沒驗證」是兩句不同的話。
  it('unknown 那一句不含「未驗證」,而 unverified 那一句含「驗證」(尺是活的)', () => {
    expect(EMAIL_VERIFICATION_LABEL.unknown).not.toContain('未驗證');
    expect(EMAIL_VERIFICATION_LABEL.unverified).toContain('驗證');
  });

  // 🔵 **code-reviewer nit 7 訂正**:~~原句寫「加了新 kind 而忘記寫字 ⇒ 這一格紅」~~
  //    —— 那個世界其實是 **typecheck** 紅(`Record<EmailVerification['kind'], string>` 逼的),
  //    而本格的五個 kind 是**寫死的**、新 kind 根本不在裡面。
  //    ⇒ 它實際抓得到的只有【文案是空字串】。**兩者不是同一個世界,寫清楚免得下一個人依賴錯的那個。**
  it('每一種 kind 的文案都不是空字串', () => {
    const kinds = ['verified', 'unverified', 'line', 'manual', 'synthetic', 'unknown'] as const;
    for (const k of kinds) {
      expect(EMAIL_VERIFICATION_LABEL[k], `${k} 沒有文案`).toBeTruthy();
    }
  });
});
