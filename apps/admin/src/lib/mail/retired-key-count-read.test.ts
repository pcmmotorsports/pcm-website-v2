import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import {
  RETIRED_KEY_SUFFIXES,
  loadRetiredKeyCount,
  unreadableRetiredKeyCount,
} from './retired-key-count-read';

/**
 * ⟦mail-KEYRETIRECOUNT⟧ 退休鍵計數。
 * 🔴 這一片治的不是 bug —— 換鍵是**設計**;缺的是**沒有人在數**。
 * ⇒ 所以這幾格守的是「數字對」與「讀不到不准印成 0」, 不是「換鍵該不該發生」。
 */

/** 每一次 `.like()` 依序回傳一個結果 —— 那正是「兩個查詢」這個形狀本身。 */
function makeClient(results: ReadonlyArray<{ count: number | null; error: unknown }>) {
  const calls: string[] = [];
  let i = 0;
  const like = vi.fn((_col: string, pattern: string) => {
    calls.push(pattern);
    return Promise.resolve(results[i++] ?? { count: 0, error: null });
  });
  const select = vi.fn().mockReturnValue({ like });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select, like, calls };
}

beforeEach(() => createSupabaseServiceClient.mockReset());

describe('loadRetiredKeyCount', () => {
  it('🔴 兩個後綴各自數, 而且數字不會互相蓋掉', async () => {
    const { client } = makeClient([
      { count: 3, error: null },
      { count: 7, error: null },
    ]);
    createSupabaseServiceClient.mockReturnValue(client);

    // 🔵 兩個數字**故意不相等** —— 相等的話「superseded 印成 voided」這種錯它看不出來。
    await expect(loadRetiredKeyCount()).resolves.toEqual({
      superseded: 3,
      voided: 7,
      unreadableReason: null,
    });
  });

  it('🔴 送出去的 pattern 逐字對得上, 而【左右兩邊是兩份字面】(改任一邊都要紅)', async () => {
    const { client, calls, select } = makeClient([
      { count: 0, error: null },
      { count: 0, error: null },
    ]);
    createSupabaseServiceClient.mockReturnValue(client);
    await loadRetiredKeyCount();

    /**
     * 🔴🔴 **[這一格是【一發活下來的突變】改寫的, 而我原本的註解是【假的】]**
     * ⛔ ~~「兩側不共用一份字面:右邊是模組匯出的常數」~~
     *    🛑 **那正是共用** —— 左邊 `calls` 是模組拿那個常數送出去的, 右邊也是那個常數
     *    ⇒ 📌 **改掉常數, 兩邊【一起動】, 這一格照樣綠。**
     * 🔬 突變實測:把 `superseded` 改成 `'%:zzz_never_matches:%'`
     *    ⇒ 這一格**活下來(rc=0, 7 passed)** —— 而那個改動會讓計數永遠是 0。
     * ✅ 修法:**把兩個字面寫死在這裡**。它們現在是兩份東西, 而改任一邊都會紅。
     * ⚠️ 代價寫出來:改後綴要改兩個地方 —— **而那正是要的**(那是一次要被看見的改動)。
     */
    expect(calls).toEqual(['%:superseded:%', '%:voided:%']);
    // 🟢 而常數那一側也要釘 —— 上面那行守「送出去的對」, 這行守「模組匯出的對」。
    expect(RETIRED_KEY_SUFFIXES.superseded).toBe('%:superseded:%');
    expect(RETIRED_KEY_SUFFIXES.voided).toBe('%:voided:%');
    // 🟢 而 `head: true` 是這一片沒有 SCAN_CAP 上限的原因 —— 它必須真的送出去。
    expect(select).toHaveBeenCalledWith('dedup_key', { count: 'exact', head: true });
  });

  it('🔴 查詢失敗 ⇒ 走【讀不到】那條路, 而不是印 0', async () => {
    const { client } = makeClient([
      { count: null, error: { message: 'boom' } },
      { count: 0, error: null },
    ]);
    createSupabaseServiceClient.mockReturnValue(client);
    const got = await loadRetiredKeyCount();

    // 🔴 這一格是本片最重要的一格:「我沒量到」與「量過了, 是零」在畫面上長一樣,
    //    而只有 `unreadableReason` 分得出來。
    expect(got.unreadableReason).not.toBeNull();
  });

  /**
   * 🔴🔴 **[code-reviewer R1 nit-2 —— 【第四個】同型的, 也是突變活下來找到的]**
   *    把 `return res.count` 改成 `res.count ?? 0` ⇒ **rc=0, 全綠**。
   * 🛑 失敗情境:PostgREST 回 200 而拿不到 count(`error === null` 且 `count === null`)
   *    ⇒ 一次未來「順手防 null」的改寫就把**沒量到印成零把**, 而三綠與全部格子都不會叫。
   * 🔵 前例:`dead-letter-count-read.ts` 對這個世界**有**專屬守門(它回 `'拿不到總數'`),
   *    而這一支原本沒有 ⇒ 這一格就是那道守門。
   */
  it('🔴 沒有 error 而 count 是 null ⇒ 仍然算讀不到(不可以當成零把)', async () => {
    const { client } = makeClient([
      { count: null, error: null },
      { count: 0, error: null },
    ]);
    createSupabaseServiceClient.mockReturnValue(client);
    const got = await loadRetiredKeyCount();

    expect(got.unreadableReason).not.toBeNull();
  });

  it('🔴 只有【第二個】查詢失敗 ⇒ 一樣算讀不到(不可以印一半)', async () => {
    const { client } = makeClient([
      { count: 4, error: null },
      { count: null, error: { message: 'boom' } },
    ]);
    createSupabaseServiceClient.mockReturnValue(client);
    const got = await loadRetiredKeyCount();

    // 🛑 少了這一格, 一個「第一個成功就 return」的實作會全綠, 而畫面會印
    //    「單號被更正 4 次 · 箱被作廢 0 次」—— 那個 0 是編的。
    expect(got.unreadableReason).not.toBeNull();
    expect(got.superseded).toBe(0);
  });

  it('🔴 丟例外 ⇒ 也走【讀不到】, 不讓整頁掛掉', async () => {
    createSupabaseServiceClient.mockImplementationOnce(() => {
      throw new Error('連不上');
    });
    /**
     * 🔴 **`mockImplementationOnce` 不是 `mockImplementation`** —— 而那個差別是量出來的:
     *    用永久版時**這一格紅, 而函式回傳的東西是對的**(我當場印過:
     *    `{"superseded":0,"voided":0,"unreadableReason":"讀取時發生例外"}`)⇒ 紅的不是行為。
     * ⚠️ **而我沒有查出那個紅到底來自哪裡**(兩輪之後停手)⇒ 標**未確認**:
     *    缺的那一道檢查 = 「永久版在哪一個時點被再叫一次」。
     * ✅ 而 `Once` 本身是**更貼近事實**的寫法:這條路上 `createSupabaseServiceClient()`
     *    就是**只會被叫一次**(第一次丟 ⇒ 直接進 catch ⇒ 不會有第二次)。
     */
    const got = await loadRetiredKeyCount();
    expect(got.unreadableReason).toBe('讀取時發生例外');
  });

  it('🔵 正對照:兩個都是 0 而讀得到 ⇒ `unreadableReason` 必須是 `null`', async () => {
    const { client } = makeClient([
      { count: 0, error: null },
      { count: 0, error: null },
    ]);
    createSupabaseServiceClient.mockReturnValue(client);

    // 🟢 沒有這一格, 上面三格可以靠「永遠回讀不到」全部通過。
    await expect(loadRetiredKeyCount()).resolves.toEqual({
      superseded: 0,
      voided: 0,
      unreadableReason: null,
    });
  });

  it('🔵 `unreadableRetiredKeyCount()` 自己也要走同一條契約', async () => {
    expect(unreadableRetiredKeyCount('測試').unreadableReason).toBe('測試');
  });
});
