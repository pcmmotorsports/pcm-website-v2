import { describe, expect, it } from 'vitest';
import {
  classifyCancelLedger,
  type CancelLedgerInput,
  type CancelLedgerVerdict,
} from './cancel-ledger-classifier';

// cancel-ledger-classifier.test.ts — A13b D3 驗收:五分類各一格 + fail-closed 三格 + 閘序 + 大小寫。
//
// 🔴 **突變清單 —— 字面 = 實跑過的那一行**(**八發**全部轉紅、零存活;跑法 = 改壞值、保留選擇器)。
//    ⚠️ 這個數字自己就中過一次:補上 M7/M8 兩發時**只改了清單、沒改這句「六發」**
//       —— codex R2 抓到的 nit。同族 memory `feedback_claimed-sync-but-only-patched-touched-lines`。
//    ⚠️ 每一發都先確認**突變真的落到磁碟**再看紅綠(`E-041-STOP:17` 的教訓,該處字面是
//       「第一次跑出全綠,我**差點**讀成『沒事』」—— 引用不放大)。
//   M1 `return cancellationsTruncated ? … : 'miss_complete';` → `return 'miss_complete';`
//      → 只紅「沒命中且歷程被截斷」(plan §3 D3 逐字指定的那一發)。
//   M2 在 `if (matched)` 之前插 `if (cancellationsTruncated) return 'miss_truncated';`
//      → 只紅「截斷但命中」。⚠️ 第一版寫成 `if (cancellationsTruncated && !matched)`,
//        那與原式**語意相同** = 語意 no-op 突變,零紅不代表有守門;已改成無條件版才有判別力。
//   M3 `actor !== null && matched.actor === actor` → `matched.actor === actor || actor === null`
//      → 只紅「actor 為 null」。
//   M4 `const wanted = normalizeToken(requestToken);` → `const wanted = requestToken;`
//      → 只紅大小寫那格。
//   M5 `if (cancellations === null)` → `if (!cancellations || cancellations.length === 0)`
//      → 只紅「空陣列 = 真的沒被取消過」。
//   M6 拿掉 `|| !isCancelRequestToken(requestToken)`(只留 typeof)
//      → 紅**兩條**(「rt 非 uuid」與「rt 非 uuid 時不得命中」)。同一道閘的兩個面,
//        刻意不強求單條紅 —— 兩條各自問的事不同(回哪一格 / 會不會被拿去比對)。
//   M7 `normalizeToken(entry.idempotencyKey)` → `entry.idempotencyKey`(只拿掉 entry 那一側)
//      → 只紅「rt 小寫 / 帳本大寫」。🔴 **這一發是 R1 must-fix 1**:補這條測試之前它**存活**,
//        14 條全綠 —— 兩側正規化只有 rt 那側被釘住,entry 側零守門。
//   M8 `typeof requestToken !== 'string'` → `requestToken == null`(讓陣列漏過形狀閘)
//      → 只紅「rt 是陣列」。搭配 must-fix 3 的型別放寬,那道閘才從死的變活的。

// 🔴 **必須帶十六進位字母**(memory `feedback_fixture-value-makes-guard-vacuous` 的實例):
//    第一版寫成全數字的 `1111…`,`toUpperCase()` 是 no-op ⇒ 大小寫那條測試恆綠、M4 突變零紅。
//    是突變驗抓到的,四閘與 14 條測試當時全綠。
const TOKEN = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const OTHER_TOKEN = 'f9e8d7c6-b5a4-4392-8180-7f6e5d4c3b2a';
const ACTOR = 'staff-alice';
const OTHER_ACTOR = 'staff-bob';

/** 帳本裡「別人送的另一筆」。存在 = 讓「沒命中」不是因為帳本空的(否則 miss 那兩格判別力減半)。 */
const OTHER_ENTRY = { actor: OTHER_ACTOR, idempotencyKey: OTHER_TOKEN };

/**
 * 🔴 基準的每個值都被刻意選過(memory `feedback_fixture-value-makes-guard-vacuous`):
 * - `cancellationsTruncated: false` —— 恆 true 會讓 `miss_complete` 那格構造不出來。
 * - `actor: ACTOR` 非 null —— null 會讓 `match_same_actor` 恆假、M3 那發突變零紅。
 * - `cancellations` 非空且**不含** `TOKEN` —— 空陣列會讓「命中」與「沒命中」的差異退化成
 *   「帳本有沒有東西」,測不出比對邏輯本身。
 */
const BASE: CancelLedgerInput = {
  requestToken: TOKEN,
  actor: ACTOR,
  cancellations: [OTHER_ENTRY],
  cancellationsTruncated: false,
};

function classify(patch: Partial<CancelLedgerInput>): CancelLedgerVerdict {
  return classifyCancelLedger({ ...BASE, ...patch });
}

describe('classifyCancelLedger — 五分類窮舉(plan §1c)', () => {
  it('命中且登記人是本人 → match_same_actor', () => {
    expect(classify({ cancellations: [OTHER_ENTRY, { actor: ACTOR, idempotencyKey: TOKEN }] })).toBe(
      'match_same_actor',
    );
  });

  it('命中但登記人是別人 → match_other_actor', () => {
    expect(
      classify({ cancellations: [{ actor: OTHER_ACTOR, idempotencyKey: TOKEN }] }),
    ).toBe('match_other_actor');
  });

  it('沒命中且歷程被截斷 → miss_truncated(可能在沒列出的那批裡)', () => {
    expect(classify({ cancellationsTruncated: true })).toBe('miss_truncated');
  });

  it('沒命中且歷程完整 → miss_complete(這筆真的沒寫進去)', () => {
    expect(classify({})).toBe('miss_complete');
  });

  it('🔴 空陣列 = 真的沒被取消過 → miss_complete,不是 unreadable', () => {
    // `mappers/order-cancellations.ts:118-120`:`null` 才是「沒讀到」,`[]` 是事實。
    expect(classify({ cancellations: [] })).toBe('miss_complete');
  });
});

describe('classifyCancelLedger — fail-closed 三格(plan §1c)', () => {
  // 🔴 三格都回 `unreadable`,而 `unreadable` 的意思是「**不代表沒送出**」——
  //    D5 拿到它**不得**把表單開回去(`cancel-action-state.ts` 的**義務 B(D5,對帳窗)**那段,
  //    現在從 `:106` 起;原本寫 `:69-71` 已漂,08-10 E 二代更正 —— 錨點以段名為準)。
  it('rt 缺失(undefined)→ unreadable', () => {
    expect(classify({ requestToken: undefined })).toBe('unreadable');
  });

  it('rt 缺失(null)→ unreadable', () => {
    expect(classify({ requestToken: null })).toBe('unreadable');
  });

  it('rt 非 uuid → unreadable', () => {
    expect(classify({ requestToken: 'not-a-uuid' })).toBe('unreadable');
  });

  it('帳本沒讀到(null)→ unreadable', () => {
    expect(classify({ cancellations: null })).toBe('unreadable');
  });

  it('🔴 rt 非 uuid 時即使帳本裡有同字面的列也不得命中', () => {
    // 守的是「先驗形狀」這件事本身:垃圾 rt 不准被拿去比對出一個 match_*。
    expect(
      classify({
        requestToken: 'not-a-uuid',
        cancellations: [{ actor: ACTOR, idempotencyKey: 'not-a-uuid' }],
      }),
    ).toBe('unreadable');
  });
});

describe('classifyCancelLedger — 閘序與比對形狀', () => {
  it('🔴 截斷但命中 → match_same_actor(命中是確定的答案,不得被截斷旗標蓋成「無法斷定」)', () => {
    expect(
      classify({
        cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }],
        cancellationsTruncated: true,
      }),
    ).toBe('match_same_actor');
  });

  it('🔴 認不出本人是誰(actor 為 null)→ match_other_actor,不得宣稱是本人', () => {
    expect(
      classify({ actor: null, cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }] }),
    ).toBe('match_other_actor');
  });

  // 🔴 **大小寫要兩側各釘一條**(R1 must-fix 1):只釘 rt 那側時,把
  //    `normalizeToken(entry.idempotencyKey)` 改成 `entry.idempotencyKey` 會**全綠存活**
  //    —— 因為所有 fixture 的 entry key 都是小寫,rt 正規化完照樣對得上。
  //    entry 側實務上恆小寫(DB `uuid` 欄、PostgREST 吐小寫)⇒ 只能手鑄 fixture,那本來就是本檔的作法。
  it('🔴 大小寫:rt 大寫 / 帳本小寫 → 仍算命中', () => {
    expect(
      classify({
        requestToken: TOKEN.toUpperCase(),
        cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }],
      }),
    ).toBe('match_same_actor');
  });

  it('🔴 大小寫:rt 小寫 / 帳本大寫 → 仍算命中(釘住 entry 那一側)', () => {
    expect(
      classify({
        requestToken: TOKEN,
        cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN.toUpperCase() }],
      }),
    ).toBe('match_same_actor');
  });

  // 🔴 重複 query key(`?rt=a&rt=b`)⇒ 頁層給的是 `string[]`(`page.tsx:52` 實查)。
  //    必須 fail-closed 成 `unreadable`,**不得**挑一顆去比對(R1 must-fix 3)。
  it('🔴 rt 是陣列(重複 query key)→ unreadable,不得挑一顆去比對', () => {
    expect(
      classify({
        requestToken: [TOKEN, OTHER_TOKEN],
        cancellations: [{ actor: ACTOR, idempotencyKey: TOKEN }],
      }),
    ).toBe('unreadable');
  });

  it('不同 token 落到不同格(比對的是整顆值)', () => {
    // 🔴 測試名收窄到斷言真的證得了的範圍(R1 nit 7):原名寫「不是前綴或包含」,
    //    但 uuid 定長 + `===` 之下前綴/包含**根本構造不出來**,那句是名字大於斷言。
    expect(classify({ requestToken: OTHER_TOKEN })).toBe('match_other_actor');
  });
});
