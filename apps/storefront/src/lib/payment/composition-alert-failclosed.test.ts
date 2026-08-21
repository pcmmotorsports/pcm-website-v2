// @vitest-environment node
// composition-alert-failclosed.test.ts — 🔴 fail-closed 守門(2026-08-21,窗 G;codex R4 MF-1)
//
// 🔴 **為什麼獨立一支檔**:本格必須讓 adapter 的 constructor 丟一個【非設定】的例外,
//    而那要 `vi.mock` 掉 `@pcm/adapters/server` —— 那會讓同資料夾
//    `composition-alert-channel-wiring.test.ts` 的「用真 adapter 驗接線」失效。
//    **一支檔只能有一份 vi.mock ⇒ 兩件事要分兩支檔。**
//
// 🔴 **它在守什麼**:R3 我把建構改成並聯時用了 `try { … } catch { 記下來,繼續 }`,
//    而那個 catch **吞掉所有例外** ⇒ constructor 裡的程式錯誤(TypeError 之類)
//    會被誤報成 `missing_env`,並且**降級成單管道繼續跑**
//    ⇒ **非設定錯誤的 fail-closed 就這樣被弄丟了**,而外面看起來一切正常(信照寄,只是少一封)。
//    ⇒ 現行作法是【事前檢查 env、完全不 catch】,而本格釘住「不 catch」這件事。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// ⚠️ class 必須定義在 factory【裡面】—— `vi.mock` 會被提升到檔首,
//    引用外面的 top-level 變數會炸 `Cannot access ... before initialization`。
//    (我第一版寫在外面,而它的症狀是「no tests」而不是斷言失敗 —— 那種紅很容易被讀成環境問題。)
vi.mock('@pcm/adapters/server', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    LineAlertNotifierAdapter: class {
      constructor() {
        // 🔴 這【不是】env 缺失,是程式錯誤 —— 它必須往外拋,不得被當成「這個管道沒設定」
        throw new TypeError('adapter 建構期程式錯誤(非設定問題)');
      }
    },
  };
});

import { getAnomalyAlertDeps } from './composition';

const ENV = {
  PAYMENT_CONFIRMER_DB_URL: 'postgres://u:p@localhost:5432/x',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token-xxxxxxxx',
  LINE_ALERT_TO: 'Uline000000000000',
  RESEND_API_KEY: 're_xxxxxxxx',
  ALERT_EMAIL_FROM: 'alert@example.com',
  ALERT_EMAIL_TO: 'ops@example.com',
} as const;

describe('fail-closed:constructor 的非設定錯誤必須往外拋', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('🔴 LINE adapter constructor 丟 TypeError ⇒ getAnomalyAlertDeps 必須爆,不得降級成單管道', () => {
    // 🔴 兩件事一起釘:①它要 throw ②而且要是【那個 TypeError】,
    //    不是被包裝成「缺少必要環境變數」之類的設定錯誤訊息。
    expect(() => getAnomalyAlertDeps()).toThrow(TypeError);
    expect(() => getAnomalyAlertDeps()).toThrow(/非設定問題/);
  });
});
