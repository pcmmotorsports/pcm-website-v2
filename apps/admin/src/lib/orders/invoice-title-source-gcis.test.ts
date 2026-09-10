import { afterEach, describe, expect, it, vi } from 'vitest';
import { gcisFetcher, gcisLookupUrl, pickGcisTitle } from './invoice-title-source-gcis';

// ⟦b4-INVOICE5PCT⟧三 片四的守門 —— 來源那一半。
// 🛑 **一發真的對外請求都不打。** `gcisFetcher` 只是把 URL 交給 `fetch`,
//    而**值得驗的是那個 URL 與那個解析**, 不是 `fetch` 自己。

describe('統編查抬頭 · 經濟部來源', () => {
  describe('gcisLookupUrl', () => {
    it('🔴 `$filter` 是一整個含空白的字串 ⇒ **整串編碼**(空白變 %20)', () => {
      const u = gcisLookupUrl('90003020');
      // 🔴 承重:只編中間那一段 ⇒ 空白原樣送出去 ⇒ 對方回 400 或空, 而我們會讀成「查不到」。
      expect(u).toContain('%24filter=Business_Accounting_NO%20eq%2090003020');
      expect(u).not.toContain(' ');
    });

    it('🔵 端點與必要參數逐字對得上 2026-09-10 實測的那一發', () => {
      const u = gcisLookupUrl('90003020');
      expect(u).toContain(
        'https://data.gcis.nat.gov.tw/od/data/api/9D17AE0D-09B5-4732-A8F4-81ADED04B679',
      );
      expect(u).toContain('%24format=json');
      // 🔵 只要第一筆 —— 統編是唯一鍵, 而多要幾筆只是多花對方的配額。
      expect(u).toContain('%24top=1');
    });

    it('🔴 **[codex R2 nit⑥] URL 要【隨輸入變】** —— 全部用同一個統編的話, 寫死也逃得過', () => {
      // 🔴 承重:把 gcisLookupUrl 改成永遠查 90003020 ⇒ 上面兩格照樣綠, 而這一格紅。
      expect(gcisLookupUrl('22099131')).not.toBe(gcisLookupUrl('90003020'));
      expect(gcisLookupUrl('22099131')).toContain('eq%2022099131');
    });
  });

  describe('pickGcisTitle', () => {
    it('🟢 正向:實測那一發的形狀 ⇒ 取得公司名稱', () => {
      // 🔬 2026-09-10 唯讀實測 90003020 的回傳**逐字**(75 B)。
      const body = [{ Business_Accounting_NO: '90003020', Company_Name: '派達有限公司' }];
      expect(pickGcisTitle(body)).toBe('派達有限公司');
    });

    it('🔴 空陣列 ⇒ `null`(而殼會轉成 `empty`)', () => {
      // 🔴 承重:回一個空字串的話, 殼那邊會判 empty 而不是 ok —— 兩層都擋一次。
      expect(pickGcisTitle([])).toBeNull();
    });

    it('🛑 對方回的形狀變了 ⇒ **一律 `null`, 不 throw**(殼的 fail-open 靠這一格)', () => {
      for (const junk of [null, undefined, 0, 'x', {}, [null], [{}], [{ Company_Name: 123 }]]) {
        expect(pickGcisTitle(junk), JSON.stringify(junk)).toBeNull();
      }
    });
  });

  // 🔴 **[codex R1 nit⑤]** 承接「逾時」與「不快取」的其實是 `gcisFetcher`, 而它先前**一個測試都沒跑到**
  //    ⇒ 📌 拿掉 `signal` 或 `cache:'no-store'`, 原本那些格子照樣全綠。這一組就是那個突變靶。
  //    🛑 **不打真網路** —— 換掉 `globalThis.fetch`。
  describe('gcisFetcher', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('🔴 把【殼給的那一個 signal】原樣交出去 —— 逾時是靠它, 不是靠我們自己計時', async () => {
      const spy = vi.fn().mockResolvedValue({ ok: true } as unknown as Response);
      vi.stubGlobal('fetch', spy);
      const signal = AbortSignal.timeout(1_000);

      await gcisFetcher('90003020', signal);

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(gcisLookupUrl('90003020'));
      // 🔴 承重:換成自己新造的 signal ⇒ 殼那 1,500 ms 的上限就對這一發【失效】。
      expect(init.signal).toBe(signal);
      // 🔴 承重:少了它, Next 的 fetch 會把回應快取起來 ⇒ 「不快取」那個決定被靜靜推翻。
      expect(init.cache).toBe('no-store');
    });

    it('🛑 `fetch` 自己 reject ⇒ **原樣往上丟**(殼負責把它變成值, 不是這裡)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')));
      await expect(gcisFetcher('90003020', AbortSignal.timeout(1_000))).rejects.toThrow('ENOTFOUND');
    });
  });
});
