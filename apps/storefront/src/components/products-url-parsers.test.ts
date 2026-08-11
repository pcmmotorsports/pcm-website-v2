import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PER_PAGE,
  DEFAULT_SORT,
  parseBrandFiltersFromUrl,
  parsePageParam,
  parsePerPageParam,
  parseSortParam,
} from './products-url-state';
import { parseBrandSlugsFromUrl } from '@/lib/catalog-query';

// #341-A 回歸鎖 —— **拆檔之前先立**(主視窗裁定「先立回歸鎖再拆」)。
//
// 🔴 為什麼是這四支:實查 `products-url-state.tsx` 的 11 個匯出,
//    `parseBrandFiltersFromUrl` / `parseSortParam` / `parsePerPageParam` / `parsePageParam`
//    是**全樹零測試命中**的四支(數法:
//    `grep -rl <名字> apps/storefront/src --include='*.test.ts*' | wc -l` 逐支跑 = 0);
//    其餘七支各有 1-4 個測試檔碰到。⇒ 拆檔時最可能靜默壞掉的就是這四支。
// ⚠️ 本檔是**特徵測試**(characterization):它釘的是**今天的行為**,不主張今天的行為都是對的。
//    例:`parseBrandFiltersFromUrl` 濾掉認不得的 slug —— 那正是 backlog #315 要改的東西。
//    #315 動它時**這裡會紅,而且紅得對**;那時要改的是這裡的期望值 + 條目,不是繞過。

const sp = (qs: string) => new URLSearchParams(qs);

describe('#341-A parseBrandFiltersFromUrl —— 濾表 + 去重 + legacy 相容', () => {
  const table = [{ id: 'akrapovic' }, { id: 'rizoma' }];

  it('多個 ?pbrand= 全部保留,順序照 URL', () => {
    expect(parseBrandFiltersFromUrl(sp('pbrand=akrapovic&pbrand=rizoma'), table)).toEqual([
      'akrapovic',
      'rizoma',
    ]);
  });

  it('🔴 不在對照表裡的 slug 會被濾掉(= #315 的病灶,今天的行為)', () => {
    // 🔴 這格**不是**在說這個行為是對的 —— 它是 #315 要修的那一條。
    //    寫在這裡是為了讓「拆檔」與「改行為」兩件事分得開:拆檔不該讓它變。
    expect(parseBrandFiltersFromUrl(sp('pbrand=akrapovic&pbrand=dbk'), table)).toEqual(['akrapovic']);
    expect(parseBrandFiltersFromUrl(sp('pbrand=dbk'), table)).toEqual([]);
  });

  it('重複值去重(?pbrand=a&pbrand=a → 一個)', () => {
    expect(parseBrandFiltersFromUrl(sp('pbrand=rizoma&pbrand=rizoma'), table)).toEqual(['rizoma']);
  });

  it('🔴 legacy `?brand=` 只在完全沒有 pbrand 時才吃(P4 前的深連結相容)', () => {
    expect(parseBrandFiltersFromUrl(sp('brand=rizoma'), table)).toEqual(['rizoma']);
    // 兩者並存時以 pbrand 為準 —— legacy 不得混進來(混進來會與車款軸的 ?brand= 打架)。
    expect(parseBrandFiltersFromUrl(sp('pbrand=akrapovic&brand=rizoma'), table)).toEqual([
      'akrapovic',
    ]);
  });

  it('沒有 getAll 的 SearchParamsLike(server 端形狀)不炸,走 legacy 路徑', () => {
    const params = sp('brand=akrapovic');
    const noGetAll = { get: (k: string) => params.get(k) };
    expect(parseBrandFiltersFromUrl(noGetAll, table)).toEqual(['akrapovic']);
  });
});

// ── #287:品牌軸改單值逗號分隔 `?pbrands=a,b`;讀取端兩種格式都要吃 ──────────────────
//
// 🔴 相容不是可選項:客人已經分享出去的 `?pbrand=a&pbrand=b` 連結、以及站內品牌頁到目錄的
//   連結(`lib/brand-url.ts` 仍產 `?pbrand=X`,那同時是 `BrandAboutRedirect` 的設計稿契約)
//   都是舊格式。**站內連結測不出舊格式的回歸**,所以這裡要逐格釘。
describe('#287 parseBrandSlugsFromUrl —— 新舊格式、聯集、去重', () => {
  const table = [{ id: 'akrapovic' }, { id: 'rizoma' }];

  it('新格式 `?pbrands=a,b` 解析出兩個 slug', () => {
    expect(parseBrandSlugsFromUrl(sp('pbrands=akrapovic,rizoma'))).toEqual(['akrapovic', 'rizoma']);
  });

  it('舊格式 `?pbrand=a&pbrand=b` 解析出**同一組**', () => {
    expect(parseBrandSlugsFromUrl(sp('pbrand=akrapovic&pbrand=rizoma'))).toEqual([
      'akrapovic',
      'rizoma',
    ]);
  });

  it('兩種混雜(手打才產得出來)→ 取聯集、不靜默丟掉任何一邊', () => {
    expect(parseBrandSlugsFromUrl(sp('pbrands=akrapovic&pbrand=rizoma'))).toEqual([
      'akrapovic',
      'rizoma',
    ]);
  });

  it('去重(跨格式也去):`?pbrands=a,a&pbrand=a` → 一個', () => {
    expect(parseBrandSlugsFromUrl(sp('pbrands=rizoma,rizoma&pbrand=rizoma'))).toEqual(['rizoma']);
  });

  it('空值不產生空字串 slug:`?pbrands=` / `?pbrands=a,,b` / 完全沒帶', () => {
    // 🔴 空字串 slug 會一路流到 server 的 `p_brand_slugs`(SAFE_SLUG 擋得掉,但 client 端的
    //   `parseBrandFiltersFromUrl` 是拿它去比對照表 ⇒ 不擋就是一個永遠 miss 的幽靈值)。
    expect(parseBrandSlugsFromUrl(sp('pbrands='))).toEqual([]);
    expect(parseBrandSlugsFromUrl(sp('pbrands=akrapovic,,rizoma'))).toEqual(['akrapovic', 'rizoma']);
    expect(parseBrandSlugsFromUrl(sp(''))).toEqual([]);
  });

  it('🔴 **不吃** legacy 單值 `?brand=` —— 那條 fallback 只活在 client 的對照表驗證後面', () => {
    // 病灶:`?brand=Yamaha&model=…` 是**選車長版**網址。server 端只驗 slug 形狀、驗不了品牌
    // 對照表,若這支把 `?brand=` 也吃進來,選車網址會被誤當品牌篩選 ⇒ 那頁 0 筆。
    expect(parseBrandSlugsFromUrl(sp('brand=rizoma'))).toEqual([]);
    // 對照:同一個網址走 client 的 parseBrandFiltersFromUrl(有對照表)仍要吃得到。
    expect(parseBrandFiltersFromUrl(sp('brand=rizoma'), table)).toEqual(['rizoma']);
  });

  it('新格式也吃得到對照表過濾(parseBrandFiltersFromUrl 的新舊等價)', () => {
    expect(parseBrandFiltersFromUrl(sp('pbrands=akrapovic,dbk'), table)).toEqual(['akrapovic']);
    expect(parseBrandFiltersFromUrl(sp('pbrands=akrapovic,rizoma'), table)).toEqual([
      'akrapovic',
      'rizoma',
    ]);
  });
});

describe('#341-A parseSortParam / parsePerPageParam / parsePageParam —— 值域與 fail-safe', () => {
  it('sort:白名單內原樣,白名單外與 null 一律回預設', () => {
    expect(parseSortParam('price-asc')).toBe('price-asc');
    // 🔴 認不得就回預設(不是丟錯、也不是原樣傳下去)——排序值會直接進 server 查詢。
    expect(parseSortParam('bogus')).toBe(DEFAULT_SORT);
    expect(parseSortParam(null)).toBe(DEFAULT_SORT);
  });

  it('perPage:只認白名單那幾個數;字串數字算數,其餘回預設', () => {
    expect(parsePerPageParam('50')).toBe(50);
    // 🔴 `30` 不在白名單 ⇒ 回預設。放行任意數字等於讓人用網址對 DB 要任意大小的頁。
    expect(parsePerPageParam('30')).toBe(DEFAULT_PER_PAGE);
    expect(parsePerPageParam('abc')).toBe(DEFAULT_PER_PAGE);
    expect(parsePerPageParam(null)).toBe(DEFAULT_PER_PAGE);
  });

  it('page:只驗 ≥1 的整數;0 / 負數 / 非數 / null 一律回 1', () => {
    expect(parsePageParam('2')).toBe(2);
    // 🔴 上界**刻意不在這裡驗**(超出總頁數由 ProductsPage 收斂 + useBrowseUrlSync 自癒);
    //    在這裡加上界會與那條自癒路徑重複,而兩份規則會各自漂。
    expect(parsePageParam('99999')).toBe(99999);
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('-3')).toBe(1);
    expect(parsePageParam('abc')).toBe(1);
    expect(parsePageParam(null)).toBe(1);
  });

  it('🔴 page 吃 `2abc` 這種前綴數字(parseInt 語意)—— 釘住今天的寬鬆面', () => {
    // 特徵測試:不主張這是對的,但拆檔不該改變它。真要收緊是另一條 backlog。
    expect(parsePageParam('2abc')).toBe(2);
  });
});
