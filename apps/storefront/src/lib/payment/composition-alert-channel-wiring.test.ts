// @vitest-environment node
// composition-alert-channel-wiring.test.ts — 告警兩管道【接線】層的守門(2026-08-21,窗 G;codex R2 MF-3)
//
// 🔴 **為什麼兩支 adapter 各自的單元測試不夠**:
//    那兩格分別斷言「LINE adapter 印 LINE 標記」「Email adapter 印 Email 標記」——
//    而**它們都在假設組裝層各接一支**。
//    ⇒ 若有人把 LINE adapter 接兩次(或 Email 接兩次),兩支單元測試**照樣全綠**,
//      而實際寄出去的兩封會帶【同一個標記】⇒ 收件人一樣分不出來
//      ⇒ 那正是這整片要解的東西,而它在單元測試的視野之外。
//    📌 母題(本 repo `docs/patterns/guard-and-instrument-traps.md`):
//       **綠燈由被斷言性質【以外】的東西產生。**
//
// 🔴 **本檔刻意【不】抄同資料夾 `composition-tappay-wiring.test.ts` 的形狀** ——
//    那支讀 `composition.ts` 的**原始碼字面**來斷言接線。那對它那一題夠用,
//    而對本題不夠:**「原始碼裡出現兩個不同的 class 名」推不出「跑起來會產生兩個不同的標記」。**
//    ⇒ 本檔**實際建構 deps、實際呼叫 notify、比對真正送出去的兩份文字**。
//
// 🔴🔴 **本檔的天花板 —— 這一段不是免責聲明,是【下一步在哪裡】**(codex R4 MF-5):
//   本檔證明的是【接線正確】:兩支不同的 adapter、各自打到各自寫死的 endpoint、
//   收件對象不相同、標記互斥、一邊設定不全時另一邊仍照送。
//   🔴 本檔【證明不了】設定值本身是對的 —— 那些值是本檔自己 stub 進去的,
//      **正式環境兩個收件人都填錯而彼此不同時,本檔仍然全綠。**
//   ⇒ 那一格只有【真的送一封出去、而收信人把它貼回來】能證明,而那件事有一份可執行的單子:
//      `~/pcm-mailbox/G-c0-9b-明天0900管道標記驗收單-20260822.md`
//   ⇒ **兩者是一組:本檔守【接線】,那份單子守【設定值】。少任何一半,另一半的綠都不完整。**
//   ⚠️ **而那份單子裡也寫著本檔的路徑** —— 兩邊互指是刻意的:
//      **否則其中一份被搬走時,另一份會安靜地變成「全部」。**
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getAnomalyAlertDeps } from './composition';

const ENV = {
  PAYMENT_CONFIRMER_DB_URL: 'postgres://u:p@localhost:5432/x',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token-xxxxxxxx',
  LINE_ALERT_TO: 'Uline000000000000',
  RESEND_API_KEY: 're_xxxxxxxx',
  ALERT_EMAIL_FROM: 'alert@example.com',
  ALERT_EMAIL_TO: 'ops@example.com',
} as const;

describe('告警兩管道接線:兩個 notifier 必須送出【互相分得出來】的標記', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('🔴 兩個 notifier 送出的文字帶【不同】的管道標記(接兩次同一支就會紅)', async () => {
    const sent: string[] = [];
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        urls.push(url);
        sent.push(init.body);
        return { ok: true, status: 200 };
      }),
    );

    const deps = getAnomalyAlertDeps();
    expect(deps.notifiers).toHaveLength(2);
    for (const n of deps.notifiers) {
      await n.notify({ subject: '⚠️ 測試主旨', text: '• 測試內文' });
    }

    expect(sent).toHaveLength(2);
    const marks = sent.map((b) => (/(這封是從 (?:LINE|Email) 送出的)/.exec(b) ?? [])[1]);
    // 兩個都要找得到標記(缺標記 = 另一種壞法)
    expect(marks.filter(Boolean)).toHaveLength(2);
    // 🔴 這一行是本檔第一版存在的理由:接兩次同一支 adapter ⇒ 兩個標記相同 ⇒ 紅
    expect(new Set(marks).size).toBe(2);

    // 🔴🔴 codex R3 MF-1:上面那組**仍然會假綠** —— 它只問「有沒有兩個不同的標記」,
    //    而【接對了支數、接錯了對象】它一格都看不到:
    //    收件人接錯 / endpoint 接錯 / payload 欄位接錯 —— 三種在上面全綠。
    //    ⇒ 所以下面直接釘【每一條打到哪、帶了誰】。env 是本檔 stub 的 ⇒ 值是已知的。
    const byUrl = Object.fromEntries(urls.map((u, i) => [u, JSON.parse(sent[i]!)]));
    // 🔴 codex R4 MF-4:前一版用 `includes` ⇒ **打到同網域的錯誤 path 仍然全綠**
    //    (例:有人把 push 改成 multicast)。而這兩個 endpoint 是【我方寫死的常數】——
    //    `LineAlertNotifierAdapter.ts:30` / `EmailAlertNotifierAdapter.ts:19`
    //    ⇒ **它不在「沒有真實環境」那個天花板底下**,可以直接釘全等。
    const LINE_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
    const RESEND_ENDPOINT = 'https://api.resend.com/emails';
    const lineUrl = urls.find((u) => u === LINE_ENDPOINT);
    const mailUrl = urls.find((u) => u === RESEND_ENDPOINT);
    expect(lineUrl, `LINE 沒有打到 ${LINE_ENDPOINT}(實得 ${JSON.stringify(urls)})`).toBeTruthy();
    expect(mailUrl, `Email 沒有打到 ${RESEND_ENDPOINT}(實得 ${JSON.stringify(urls)})`).toBeTruthy();

    const linePayload = byUrl[lineUrl!];
    const mailPayload = byUrl[mailUrl!];
    // LINE:收件對象 + 訊息本體的位置(欄位接錯 ⇒ 這裡紅)
    expect(linePayload.to).toBe(ENV.LINE_ALERT_TO);
    expect(linePayload.messages[0].text).toContain('這封是從 LINE 送出的');
    // Email:寄件/收件都要對(收件人接成 from、或兩邊接成同一個值 ⇒ 這裡紅)
    expect(mailPayload.to).toBe(ENV.ALERT_EMAIL_TO);
    expect(mailPayload.from).toBe(ENV.ALERT_EMAIL_FROM);
    expect(mailPayload.text).toContain('這封是從 Email 送出的');
    // 🔴 兩條的收件對象不得相同(把 Email 收件人接成 LINE 的 id 之類)
    expect(String(linePayload.to)).not.toBe(String(mailPayload.to));
  });

  // 🔴🔴 codex R3 MF-2:建構必須是【並聯】—— 一邊的設定缺失不得拖垮另一邊。
  //    前一版是串聯:LINE 少一個 env ⇒ 整個 getAnomalyAlertDeps throw ⇒ Email 也不會被建構
  //    ⇒ **這片的目的就是兩管道互為備援,而串聯讓它在最需要的那天退化成一個。**
  it('🔴 LINE 的設定缺一半 ⇒ Email 仍然照送(建構是並聯不是串聯)', async () => {
    vi.stubEnv('LINE_ALERT_TO', '');
    const sent: string[] = [];
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        urls.push(url);
        sent.push(init.body);
        return { ok: true, status: 200 };
      }),
    );

    const deps = getAnomalyAlertDeps();
    // LINE 退場、Email 留下 —— 而不是整個掛掉
    expect(deps.notifiers).toHaveLength(1);
    for (const n of deps.notifiers) {
      await n.notify({ subject: '⚠️ 測試主旨', text: '• 測試內文' });
    }
    expect(urls.some((u) => u.includes('resend'))).toBe(true);
    expect(JSON.parse(sent[0]!).text).toContain('這封是從 Email 送出的');
  });

  // 🔴🔴 codex R4 MF-2:**完全漏設 primary key 的那條路,也要留下退場紀錄。**
  //    前一版被外層 `if` 直接跳過、不進 unconfigured ⇒ 另一管道成功時安靜回傳半套 deps。
  //    📌 **沒有記錄的退場,與沒有退場,在輸出上是同一個畫面。**
  it('🔴 LINE 的 primary key 完全漏設 ⇒ 仍然留下 absent 紀錄,不是安靜跳過', () => {
    vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', '');
    vi.stubEnv('LINE_ALERT_TO', '');
    const logs: string[] = [];
    vi.stubGlobal('console', { ...console, error: (m: string) => logs.push(String(m)) });

    const deps = getAnomalyAlertDeps();
    expect(deps.notifiers).toHaveLength(1); // Email 仍在
    const line = logs.map((l) => JSON.parse(l)).find((o) => o.channel === 'line');
    expect(line, 'LINE 完全漏設時沒有留下任何紀錄').toBeTruthy();
    expect(line.reason).toBe('absent');
    // 🔴 而「設一半」與「完全沒設」必須分得開 —— 前者是誤設,後者可能是刻意只用一個管道
    expect(line.reason).not.toBe('partial');
  });

  // 🔴🔴 codex R4 MF-1(fail-closed 不得被並聯弄丟)**的守門不在本檔** ——
  //    它需要讓 adapter 的 constructor 真的丟一個【非設定】的例外,而那要 mock 模組,
  //    與本檔其餘各格的「用真 adapter 驗接線」互相衝突(同一支檔只能有一份 vi.mock)。
  //    ⇒ 拆到 `composition-alert-failclosed.test.ts`。
  //    🔴 我第一版把它寫在這裡,斷言 `not.toThrow()` + `length === 2` ——
  //       **那是快樂路徑,在正常世界恆綠,證明不了任何事。** 已刪除,不是搬走而已。

  it('🔴 兩個管道都建不起來 ⇒ 才 throw(fail-closed 那一半沒有被改掉)', () => {
    vi.stubEnv('LINE_ALERT_TO', '');
    vi.stubEnv('ALERT_EMAIL_TO', '');
    expect(() => getAnomalyAlertDeps()).toThrow(/沒有任何告警管道建構成功/);
  });
});
