// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// page.test.tsx — `#16` 的 **MF6 守門:對帳讀取失敗不得把整頁帶走**。
//
// 🔴 這一格的必要性:`today-read.ts` 寫著「寧可炸也不要顯示少算的數字」,那句只證成
//    **那幾格**該炸。第一版把 `await loadTodaySummary()` 裸放在頁面 body ⇒ 對帳一失敗,
//    連 M0-S2 具名身分(這頁原本**唯一在用**的功能)一起 500。
//    把 try/catch 拿掉、或把身分那塊挪進 try 裡,下面第二格就紅。
//
// 🔴 誠實邊界:這是 **jsdom 下對 server component 回傳樹的渲染**,
//    **不證** Next 真的這樣渲染、不證 server action 真的能送出、也不證 DB 行為。
// 🔴 本檔現在會 `importOriginal` 真的 `freshness-read`(見下方那顆 mock 的理由),
//    而那支檔 `import 'server-only'` ⇒ jsdom 下會拋。全 repo 90 支測試檔用同一句解。
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getSessionActorWithSource: vi.fn(),
  listActiveStaff: vi.fn(),
  loadTodaySummary: vi.fn(),
  loadDataFreshness: vi.fn(),
  loadCronHeartbeats: vi.fn(),
}));
vi.mock('../lib/session/actor-actions', () => ({ selectActorAction: vi.fn() }));
vi.mock('../lib/session/actor', () => ({
  ACTOR_ID_FIELD: 'actor_id',
  getSessionActorWithSource: mocks.getSessionActorWithSource,
}));
vi.mock('../lib/staff', () => ({ listActiveStaff: mocks.listActiveStaff }));
vi.mock('../lib/dashboard/today-read', () => ({ loadTodaySummary: mocks.loadTodaySummary }));
// 🔴 `freshnessLabel` **刻意不 mock** —— 它是那一行字的真正作者。
//    mock 掉它,下面「量不到」那一格就會變成在驗我自己寫的假字串。
vi.mock('../lib/dashboard/freshness-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadDataFreshness: mocks.loadDataFreshness,
}));
// 同上:`unreadableReport` **刻意不 mock** —— 它是「量不到長什麼樣」的唯一作者。
vi.mock('../lib/dashboard/cron-heartbeat-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadCronHeartbeats: mocks.loadCronHeartbeats,
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../lib/test-support/strip-comments';

import AdminHomePage from './page';

const SUMMARY = {
  ymd: '2026-08-14',
  receivedAmount: 12345,
  newOrderCount: 7,
  refundExceptionCount: 2,
  refundExceptionTruncated: false,
  failedSections: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  // 預設 = 第 3 層(旗標關、票非 v:2)+ 已選到人。
  // ⚠️ **不寫「= 今天正式站的世界」**(codex 關卡2 R3 角度A must-fix):
  //    `ADMIN_REQUIRE_REAL_IDENTITY` 的線上值**我們讀不到**,而
  //    `app/settings/audit/page.tsx`(錨 `那句話 2026-08-25 就已經假了`)說它 08-25 起是開的。
  //    ⇒ 這個預設的身分是「**本檔既有各格原本的前提**」,不是一個關於正式站的事實宣稱。
  mocks.getSessionActorWithSource.mockResolvedValue({
    actor: { id: 's1', label: '小陳' },
    source: 'self-selected',
  });
  mocks.listActiveStaff.mockResolvedValue([{ id: 's1', label: '小陳' }]);
  mocks.loadTodaySummary.mockResolvedValue(SUMMARY);
  mocks.loadDataFreshness.mockResolvedValue({ hoursAgo: 3, stale: false, abnormal: false, unreadableReason: null });
  mocks.loadCronHeartbeats.mockResolvedValue({
    jobs: [
      { jobName: 'pcm-settle-sweep', label: '結帳掃描', minutesAgo: 1, consecutiveFailures: 0, abnormal: false, note: '1 分前成功' },
    ],
    neverBeat: [],
    unknownJobs: [],
    unreadableReason: null,
  });
});
afterEach(cleanup);

describe('AdminHomePage', () => {
  it('正常時:三格數字與身分選單都在(正向對照,證明下一格的斷言真的看得到東西)', async () => {
    const { container } = render(await AdminHomePage());
    expect(container.textContent).toContain('今日實收');
    expect(container.textContent).toContain('NT$ 12,345');
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.textContent).toContain('切換');
    expect(container.textContent).not.toContain('今日對帳載入失敗');
    // 🔴 灰字那一行是【常亮的值】⇒ 正常時它就要在畫面上,不是只有出事才出現。
    expect(container.textContent).toContain('供應商資料最後更新:3 小時前');
    expect(container.querySelector('[data-testid="data-freshness"]')?.className).toContain(
      'text-muted-foreground',
    );
  });

  // ══ 資料新鮮度那一行的兩個世界(`q1: 甲`,Sean 2026-08-28)══════════════════
  it('🔴 資料舊了 ⇒ 同一行字轉成 destructive 色(而字照樣在)', async () => {
    mocks.loadDataFreshness.mockResolvedValue({ hoursAgo: 40, stale: true, abnormal: true, unreadableReason: null });
    const { container } = render(await AdminHomePage());
    expect(container.textContent).toContain('供應商資料最後更新:40 小時前');
    expect(container.querySelector('[data-testid="data-freshness"]')?.className).toContain(
      'text-destructive',
    );
  });

  it('🔴🔴 R1 must-fix:時間戳在未來 ⇒ 也要用警示色(它【不是】stale,而它是唯一確定有東西寫錯的世界)', async () => {
    // 這一格是補上來的:原本三發突變沒有任何一發碰到這條路,
    // 而漏掉它的時候「文字層印了、顏色層把它藏回去」全綠。
    mocks.loadDataFreshness.mockResolvedValue({
      hoursAgo: -3.2,
      stale: false,
      abnormal: true,
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const line = container.querySelector('[data-testid="data-freshness"]');
    expect(line?.textContent).toContain('未來');
    expect(line?.className).toContain('text-destructive');
    expect(line?.className).not.toContain('text-muted-foreground');
  });

  it('🔴 新鮮度讀取拋錯 ⇒ 印「量不到」,**不得留白**,而其他區照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadDataFreshness.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    const line = container.querySelector('[data-testid="data-freshness"]');
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain('量不到');
    expect(line?.textContent?.trim()).not.toBe(''); // 空白 = 與「還沒載完」同形,那是這片在修的病
    expect(line?.className).toContain('text-destructive');
    // 這一格掛掉不得把對帳與身分帶走
    expect(container.textContent).toContain('今日實收');
    expect(container.querySelector('select#actor_id')).not.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ══ 排程心跳那一區(3a)══════════════════════════════════════════════════
  it('🔴 正常時那一區就在畫面上(常亮的值,不是只有出事才出現)', async () => {
    const { container } = render(await AdminHomePage());
    expect(container.querySelector('[data-testid="cron-health"]')).not.toBeNull();
    const row = container.querySelector('[data-testid="cron-job-pcm-settle-sweep"]');
    expect(row?.textContent).toContain('結帳掃描');
    expect(row?.className).toContain('text-muted-foreground');
  });

  it('🔴 某一支異常 ⇒ 那一列轉 destructive 色(而字照樣在)', async () => {
    mocks.loadCronHeartbeats.mockResolvedValue({
      jobs: [
        { jobName: 'pcm-settle-sweep', label: '結帳掃描', minutesAgo: 99, consecutiveFailures: 0, abnormal: true, note: '已經 99 分沒成功(門檻 6 分)' },
      ],
      neverBeat: [],
      unknownJobs: [],
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const row = container.querySelector('[data-testid="cron-job-pcm-settle-sweep"]');
    expect(row?.textContent).toContain('99 分沒成功');
    expect(row?.className).toContain('text-destructive');
    expect(row?.className).not.toContain('text-muted-foreground');
  });

  it('🔴 兩種漂移印【不同的句子】,而且各自附「該怎麼辦」', async () => {
    mocks.loadCronHeartbeats.mockResolvedValue({
      jobs: [],
      neverBeat: ['pcm-expire-unpaid-orders'],
      unknownJobs: ['pcm-brand-new-job'],
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="cron-health"]')?.textContent ?? '';
    expect(t).toContain('從來沒寫過心跳');
    expect(t).toContain('pcm-expire-unpaid-orders');
    expect(t).toContain('接線了沒');            // 該怎麼辦①
    expect(t).toContain('沒在看的心跳');
    expect(t).toContain('pcm-brand-new-job');
    expect(t).toContain('白名單過期');          // 該怎麼辦②
  });

  it('🔴 心跳讀取拋錯 ⇒ 印「量不到」,不得留白,而其他區照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadCronHeartbeats.mockRejectedValue(new Error('boom'));
    const { container } = render(await AdminHomePage());
    const box = container.querySelector('[data-testid="cron-health"]');
    expect(box?.textContent).toContain('量不到');
    expect(box?.textContent?.trim()).not.toBe('');
    expect(container.textContent).toContain('今日實收'); // 沒有把別區帶走
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 MF6:對帳讀取拋錯 ⇒ 只有那一區變失敗卡,身分選單照樣可用', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadTodaySummary.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    expect(container.textContent).toContain('今日對帳載入失敗');
    // 🔴 這三條才是 MF6 的本體:身分那塊**沒有**被一起帶走。
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('select#actor_id')).not.toBeNull();
    expect(container.textContent).toContain('切換');
    // 數字不得留在畫面上(免得員工看到一個沒更新的舊值當今天的)。
    expect(container.textContent).not.toContain('今日實收');

    // 失敗要留痕:靜默吞掉的話,線上永遠不知道這一區壞了。
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── `:247`(⟦b4-MGR0-COPY⟧)三個世界,三句話 ────────────────────────────────
//
// 🔴 **改之前這些格全部會綠** —— 那句話是無條件印的,而每個世界印同一句。
//    ⇒ 下面每一格都附「它在哪個世界翻面」,不要只讀斷言。
//
// ✅ **這一節有多少判別力,是【量到的】不是估的**(2026-08-29,codex 關卡2 R3 角度B 要求):
//    把 `{ACTOR_SOURCE_COPY[copyKey]}` 換回舊的無條件字串、其餘一律不動,實跑 ⇒
//    **本檔 6 紅 / 17 過**(紅的是下面除「第 3 層 + 已選人」之外的每一格)。
// 🔴 **而 `b5a-identity-acceptance.test.ts` 同一發是【40 全過、0 紅】** ——
//    那 10 格守的是 `actor.ts` 的 `source`,**與文案分岔一格都不相干**。
//    📌 **⇒ 不要把兩邊的格數加起來當成「守這句話的有 N 格」** ——
//    那是兩個不同的宣稱,而它們印同一種綠。
// ⚠️ 「第 3 層 + 已選人」那格**不紅是對的**:它守的正是「那個世界一個字都沒變」。
describe(':247 具名身分那句話 —— 六個世界各講各的話', () => {
  const copyOf = async (
    source: 'ticket' | 'self-selected' | 'none' | 'stale-ticket',
    actor: unknown,
  ) => {
    mocks.getSessionActorWithSource.mockResolvedValue({ actor, source });
    const { container } = render(await AdminHomePage());
    return container.textContent ?? '';
  };

  it('第 1 層(票是 v:2)⇒ 說身分來自那張票,而【不再】說是你自己選的', async () => {
    const text = await copyOf('ticket', { id: 's1', label: '小陳' });
    expect(text).toContain('經過簽章驗證的票');
    // 🔴 這一行才是本片的本體:舊字面**不得**出現在這個世界。
    //    翻面條件:把分岔拆掉、或把三句合回一句 ⇒ 紅。
    expect(text).not.toContain('這個身分是你自己選的');
  });

  it('第 3 層(旗標關、票非 v:2)+ 已選人 ⇒ 一個字都不改,舊字面照舊', async () => {
    const text = await copyOf('self-selected', { id: 's1', label: '小陳' });
    // 🔴 這格是**負向守門**:本片宣稱「今天正式站那個世界零改動」,而這裡就是那句宣稱的量具。
    expect(text).toContain('這個身分是你自己選的、系統並未驗證');
    expect(text).not.toContain('經過簽章驗證的票');
  });

  it('none(共用密碼 / 首次建置)⇒ 選單不會生效,而復原步驟是【改用個人帳號】', async () => {
    const text = await copyOf('none', null);
    expect(text).toContain('選了不會生效');
    // 🔴 codex R3 角度D:這半的人**重登沒有用** ⇒ 不得叫他去重登。
    expect(text).toContain('請改用個人帳號登入');
    expect(text).not.toContain('請登出後重新登入');
    // 🔴 codex 關卡2 must-fix:只守前半 ⇒ 有人把「會被擋下」那句刪掉或說反,這格照樣綠。
    //    而那半才是員工需要知道的後果。
    expect(text).toContain('會被擋下');
    expect(text).not.toContain('這個身分是你自己選的');
    // 這個世界 actor 是 null ⇒ 畫面照舊印「尚未選擇」(那一格本片沒動)。
    expect(text).toContain('尚未選擇');
  });

  // 🔴🔴 codex 關卡2 must-fix:`source==='ticket'` **不保證票上那個人還在**
  //    (`lib/staff.ts` 的 `resolveStaff` 對停用/查無回 null)。
  //    翻面條件:把 `copyKey` 那一行拿掉 ⇒ 畫面同時印「尚未選擇」與「這個身分來自那張票」⇒ 紅。
  it('🔴 票上有身分而現在對不到人(actor=null)⇒ 不得說「身分來自那張票」,也不得斷言原因', async () => {
    const text = await copyOf('ticket', null);
    expect(text).toContain('系統現在對不到那個人');
    expect(text).toContain('會被擋下');
    // 🔴 codex 關卡2 R2 must-fix:**不得斷言原因** —— DB 名單這一趟沒讀到也走這條路,
    //    而那個人的帳號其實好好的。翻面條件:有人把話改回「你的帳號被停用了」⇒ 紅。
    expect(text).not.toMatch(/帳號(已)?被停用了/);
    // 這一句是矛盾的來源:畫面上方已經印「尚未選擇」,不得再說「這個身分來自…那張票」。
    expect(text).not.toContain('這個身分來自你登入時那張經過簽章驗證的票');
    expect(text).not.toContain('這個身分是你自己選的');
  });

  // 🔴🔴 codex 關卡2 R2 must-fix:第五個世界 —— `self-selected` 而還沒選人。
  //    舊字面在這裡也是假的:畫面連著印「尚未選擇。稽核 log 會把【這個身分】記成操作者」。
  //    翻面條件:把 `self-selected-unset` 那一支拿掉、退回共用 B 版 ⇒ 紅。
  it('🔴 還沒選人(self-selected + actor=null)⇒ 不得說「會把這個身分記成操作者」', async () => {
    const text = await copyOf('self-selected', null);
    expect(text).toContain('尚未選擇');
    expect(text).toContain('你還沒有選具名身分');
    expect(text).toContain('會被擋下');
    // 🔴 這一行是本格的本體:沒有身分可記,就不能說會記。
    expect(text).not.toContain('稽核 log 會把這個身分記成操作者');
  });

  // 🔴🔴 codex 關卡2 R3「災難當天」must-fix:第 2 層(旗標開 + 舊 v:1 票)**重登就會拿到新票**,
  //    而 `none`(共用密碼/首次建置)重登沒有用。合成一句 ⇒ **兩邊各被叫去做錯的事一半。**
  // 🔴🔴 codex 關卡2 R4 must-fix:**不得叫他直接登出重登**。
  //    `app/api/sso/callback/route.ts:156-163`:旗標開而上游沒送 `sub` ⇒ **500、不發新票**
  //    ⇒ 他登出就回不來,而他現在這張舊票還讀得到東西。
  //    翻面條件:有人把話改回無條件「請登出後重新登入一次」⇒ 紅。
  it('🔴 stale-ticket(舊票)⇒ 要先叫他【不要登出】,不得無條件叫他重登', async () => {
    const text = await copyOf('stale-ticket', null);
    expect(text).toContain('請先不要登出');
    expect(text).toContain('會被擋下');
    expect(text).not.toContain('請改用個人帳號登入');
    // 🔴🔴 **這一句釘【整段逐字】,不是釘關鍵字**(codex 關卡2 R5 must-fix)。
    //    上一版只禁「請登出後重新登入」這六個字 ⇒ 改寫成「請登出再登入一次」**照樣全綠**,
    //    而那個改寫**一樣會把人鎖在門外**。📌 **一把綁單一字面的尺,防得住還原、防不住同義改寫。**
    //    ⚠️ **代價明寫**:這一格對**任何**字面改動都會紅,包含無害的潤稿 ——
    //    **那是刻意的**:這句話的安全性住在「先不要登出」那個前提上,
    //    ⇒ 動它就該有人重新讀一遍,而不是靜悄悄通過。改文案 = 連這一格一起改。
    expect(text).toContain(
      '🔴 請先不要登出:要等你的個人帳號在報價單端接上之後,重新登入才會拿到新票。先找管理員確認,確認了再登出重登。',
    );
  });

  it('🔴 六個世界必須印【六句不一樣的話】—— 合併回一句就紅', async () => {
    const [a, b, c, d, e, f] = await Promise.all([
      copyOf('ticket', { id: 's1', label: '小陳' }),
      copyOf('self-selected', { id: 's1', label: '小陳' }),
      copyOf('none', null),
      copyOf('ticket', null),
      copyOf('self-selected', null),
      copyOf('stale-ticket', null),
    ]);
    // 🔴 為什麼要這一格:上面每一格是**各自**檢查一個字串在不在。
    //    有人把四句話改成同一句、而那句話剛好同時含每一個關鍵字 ⇒ 上面每一格**全綠**。
    //    這一格量的是「它們互不相同」,那是上面那些格合起來也答不出的問題。
    expect(new Set([a, b, c, d, e, f]).size).toBe(6);
  });

  it('🔴 本頁不得自己讀那顆旗標 —— 決定文案的是【票】不是 ADMIN_REQUIRE_REAL_IDENTITY', async () => {
    // 翻面條件:有人把分岔改寫成 `requireRealIdentity() ? A : B` ⇒ 紅。
    // 那個寫法在「旗標關而票已是 v:2」的世界會印錯,而**畫面看起來完全正常** ——
    // 沒有這一格,那個回歸沒有任何東西會叫。
    // 🔴 **必須 `stripComments`** —— 本檔的說明註解**本來就會提到那顆旗標的名字**
    //    (它在講「不要照旗標分岔」)⇒ 不剝註解,這一格會因為一段正確的註解而紅。
    //    做法逐字抄同 repo 既有形狀 `lib/session/actor-actions.test.ts:126-128`,不自創第二種。
    // ⚠️ **不能用 `import.meta.url`** —— 本檔是 `@vitest-environment jsdom`,
    //    那顆在 jsdom 下不是 `file:` scheme(實測 `TypeError: The URL must be of scheme file`);
    //    `actor-actions.test.ts` 用得成是因為它跑 node 環境。**同一句話在兩個環境不同義。**
    //    改用 vitest root(= repo 根)。路徑打錯 ⇒ `readFileSync` 直接拋 ⇒ 紅得很大聲,不會靜默恆真。
    const src = stripComments(
      readFileSync(resolve(process.cwd(), 'apps/admin/src/app/page.tsx'), 'utf8'),
    );
    // 正對照先跑:確定真的讀到那支檔、而且是改過的那一版(否則下面兩條恆真)。
    expect(src).toContain('ACTOR_SOURCE_COPY');
    expect(src).toContain('actorSource');
    expect(src).not.toContain('requireRealIdentity');
    expect(src).not.toContain('ADMIN_REQUIRE_REAL_IDENTITY');
  });
});
