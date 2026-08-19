// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { signSession } from '@/lib/session/session';

import DiagEnvPage from './page';

// 片 0 探針的守門。**兩個世界都要表演** —— 只驗「有值時印得出來」的話,
// 「讀不到」與「頁面沒渲染」在畫面上長一樣,而那正是這支探針要分開的兩件事。
//
// 🔴 誠實邊界(照 page.test.tsx 既有寫法):這是 jsdom 下對 server component 回傳樹的渲染,
//    **不證** Next 在 Vercel 上真的這樣渲染、**不證** VERCEL_ENV 在正式部署讀得到。
//    那一格【只有真的部署一次】才拿得到 —— 那就是這支探針存在的理由。
//
// 🔴 而本檔還有第二個用途:**它是探針退場的機械訊號。**
//    片 1(丁)刪掉 `page.tsx` 而忘了刪本檔 ⇒ import 失敗 ⇒ 測試紅。
//    ⚠️ 反方向擋不住(只刪本檔、留著 page.tsx 不會紅)⇒ 那一半靠 plan §6 那一格的 `test -e`。

describe('片 0 · 環境診斷頁', () => {
  const saved = process.env.VERCEL_ENV;

  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved;
  });

  // 🔴 尺釘在【值那一格】,不是整頁文字 —— 這一條是【實際踩到才改的】,不是預想:
  //    第一版用 container.textContent 全文掃哨兵 ⇒ 永遠命中,因為【頁面自己的說明文字裡
  //    就含那個字面】。⇒「有值」與「沒值」在那把尺下長一樣。
  //    📌 這不是把測試放寬 —— 全文掃描【量錯了對象】,釘 testid 才是那句話的正確寫法。
  it('讀得到 VERCEL_ENV ⇒ 值那一格原樣印出來', () => {
    process.env.VERCEL_ENV = 'production';
    const { getByTestId } = render(<DiagEnvPage />);
    expect(getByTestId('vercel-env').textContent).toBe('production');
  });

  it('🔴 讀不到 VERCEL_ENV ⇒ 值那一格印顯式哨兵,不是空白', () => {
    delete process.env.VERCEL_ENV;
    const { getByTestId } = render(<DiagEnvPage />);
    expect(getByTestId('vercel-env').textContent).toBe('__讀不到__');
  });

  it('🔴 正向對照欄:同一發裡 NODE_ENV 那格【不是】哨兵 ⇒ 分得出「這一格沒值」與「整頁沒跑」', () => {
    delete process.env.VERCEL_ENV;
    const { getByTestId } = render(<DiagEnvPage />);
    expect(getByTestId('vercel-env').textContent).toBe('__讀不到__');
    // 🔴 同一次渲染裡，這一格必須有東西 —— 否則「讀不到」的來源是【整頁沒跑】不是那個變數
    expect(getByTestId('node-env').textContent).not.toBe('__讀不到__');
    expect(getByTestId('node-env').textContent?.length).toBeGreaterThan(0);
  });

  // 🔴🔴 這一格【不是守門,是絆線】—— 它的工作是【在片 1 落地那一刻變紅】。
  //
  // 病:片 1(丁)由【另一個窗】做,而他沒有理由打開 plan §0.1 那張退場清單
  //    ⇒ 探針會留在正式站上,而【沒有任何東西會紅】(W6 R1-M2)。
  //
  // ⛔ ~~第一版用 regex 掃 session.ts 的原始碼字面~~
  // 🔴 **W6 R2 打掉它,而理由是【這個 repo 的寫作習慣】**:丁的作者只要寫一句我們每天在寫的話
  //    —— 例如在改動處留一行劃掉的舊寫法 —— regex 就會在【註解裡】命中 ⇒ 絆線【綠】
  //    ⇒ 丁已落地而探針留在正式站。📌 那是同一支檔今天【第二次】被同一個形狀咬
  //    (第一次:全文掃哨兵永遠命中,因為頁面自己的說明文字含那個字面)。
  //
  // ✅ 改成【行為】絆線:同一顆固定 payload、同一把 secret 簽兩次,中間只翻 VERCEL_ENV。
  //    今天 getKey() 不讀 env ⇒ 兩顆簽章【相同】⇒ 綠
  //    丁落地(金鑰材料含 env)  ⇒ 兩顆簽章【不同】⇒ 🔴 紅
  //    ⇒ 零字面、零路徑解析、零註解問題。
  //
  // ⚠️ 已知不覆蓋的一格(W6 標,照實留著):若丁落地【而 getKey() 的快取鍵沒帶 env】
  //    (plan §3-丁.6 R5-M1 那個 bug)⇒ 快取回舊 key ⇒ 兩顆仍相同 ⇒ 本格不會紅。
  //    那個世界由 plan §3-丁.6 格② 接住 —— 兩格合起來才完整,而它們本來就規定要一起在。
  //
  // 🔴 **而這裡的假紅是【要的】** —— 守門的假紅是成本,**絆線的假紅是它的功能**。
  //    ⇒ 下一個人:不要照「這種測試很脆」把它拿掉。它紅了就是叫你去做那件事。
  it('🔴 退場絆線:片 1 一落地它就該紅', async () => {
    const savedSecret = process.env.ADMIN_SESSION_SECRET;
    const savedVercelEnv = process.env.VERCEL_ENV;
    process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48); // ≥32，否則 signSession 回 null
    try {
      const payload = {
        v: 1 as const,
        sid: 'a'.repeat(32),
        iat: 1,
        exp: 2_000_000_000,
        amr: ['pwd' as const],
        auth_time: 1,
      };
      process.env.VERCEL_ENV = 'aaa';
      const first = await signSession(payload);
      process.env.VERCEL_ENV = 'bbb';
      const second = await signSession(payload);

      // 🔴 這兩步不可省(W6 自己標的坑):secret 沒設時 signSession 回 null
      //    ⇒ null === null ⇒ 恆綠。沒有它們,這條絆線就是它自己要防的那種東西。
      // 🔴 兩顆【都】要擋(W6 N1):只擋 first 的話,second 為 null 時
      //    toBe(second) 會失敗而印出「丁已落地」= 【誤導的紅】。
      //    誤導的紅比不紅更貴 —— 它會派人去做一件沒發生的事。
      expect(typeof first, '簽不出東西 ⇒ 這一格什麼都沒證明').toBe('string');
      expect(typeof second, '簽不出東西 ⇒ 這一格什麼都沒證明').toBe('string');
      expect((first ?? '').length).toBeGreaterThan(0);

      expect(
        first,
        '🔴 翻了 VERCEL_ENV 之後簽出來的東西不一樣 ⇒ 金鑰材料已經含 env ⇒ 片 1(丁)已落地\n' +
          '⇒ 請【刪除】apps/admin/src/app/diag/env/ 這兩支檔(page.tsx 與 page.test.tsx)。\n' +
          '   探針的任務結束了；留著它 = 正式站上多一個沒有人要的頁面。',
      ).toBe(second);
    } finally {
      if (savedSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
      else process.env.ADMIN_SESSION_SECRET = savedSecret;
      // 🔴 VERCEL_ENV 也要自己還原(W6 N2):本格把它留在 'bbb'。
      //    今天沒事,因為 describe 的 afterEach 會還原 —— 而那是【隱性依賴】:
      //    有人移走那個 afterEach,本格就靜靜污染同檔其他測試。
      //    ⇒ 弄髒的人自己收,不要靠別人順手。
      if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = savedVercelEnv;
    }
  });
});
