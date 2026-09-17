import { describe, expect, it } from 'vitest';
import { parseCatalogQuery } from './catalog-query';
import { buildCatalogIndexing, CATALOG_MAX_INDEXABLE_PAGE } from './catalog-canonical';

const BASE = 'https://www.pcmmotorsports.com';

function canonicalOf(query: string): string | undefined {
  return buildCatalogIndexing(parseCatalogQuery(new URLSearchParams(query)), BASE).canonical;
}
function noindexOf(query: string): boolean {
  return buildCatalogIndexing(parseCatalogQuery(new URLSearchParams(query)), BASE).noindex;
}

describe('buildCatalogIndexing', () => {
  it('🔴 sort / per 只換排列, 不進 canonical(它們是同一份商品集合)', () => {
    const plain = canonicalOf('');
    expect(canonicalOf('sort=price-asc')).toBe(plain);
    expect(canonicalOf('sort=price-desc&per=100')).toBe(plain);
    expect(plain).toBe(`${BASE}/products`);
  });

  // 🔴 這一格是主視窗點名的陷阱:`?filter=new` 是**真篩選**(近 7 天),`?sort=new` 只是排序。
  //    兩個長得像而語意不同 —— 一律洗掉參數的寫法會把它們併成同一頁,那是錯的。
  it('🔴 filter=new 與 sort=new 的 canonical 不同', () => {
    expect(canonicalOf('filter=new')).toBe(`${BASE}/products?filter=new`);
    expect(canonicalOf('sort=new')).toBe(`${BASE}/products`);
  });

  it('🔵 ?categories=b,a 與 ?categories=a,b 收斂到同一個 canonical', () => {
    expect(canonicalOf('categories=尾段排氣管,全段排氣管')).toBe(
      canonicalOf('categories=全段排氣管,尾段排氣管'),
    );
  });

  // 舊格式(`?category=` 單值 / `?pbrand=` 重複鍵)讀得懂, 而寫出端只產新格式 ⇒ 兩種網址收斂成一個。
  it('🔵 舊格式 ?category= 與 ?pbrand= canonical 到新格式', () => {
    expect(canonicalOf('category=全段排氣管')).toBe(canonicalOf('categories=全段排氣管'));
    expect(canonicalOf('pbrand=akrapovic')).toBe(canonicalOf('pbrands=akrapovic'));
  });

  it('🔴 價格區間與自由關鍵字 ⇒ noindex(組合無限 / 內容與整頁不同, 不用 canonical 假裝)', () => {
    expect(noindexOf('pmin=3000&pmax=10000')).toBe(true);
    expect(noindexOf('price=NT$ 3,000 – 10,000')).toBe(true);
    expect(noindexOf('search=拉桿')).toBe(true);
    expect(noindexOf('categories=全段排氣管&sort=new&page=2')).toBe(false);
  });

  // 🔴 noindex 與「指去別頁的 canonical」同時出現 ⇒ Google 會把 noindex 沿 canonical 傳給
  //    `/products` 本身。守這一格,不是守風格。
  it('🔴 noindex 的頁不產 canonical(不把 noindex 沿著 canonical 傳給 /products)', () => {
    expect(canonicalOf('pmin=3000&pmax=10000')).toBeUndefined();
    expect(canonicalOf('search=拉桿')).toBeUndefined();
  });

  // 🔴🔴 **[2026-09-17 逐項刪除掃出來的既有破洞 —— 不是本片造成的]**
  //   原本的測試**每一格都同時帶 `pmin` 與 `pmax`** ⇒ 兩項【互相遮掩】:
  //   把 `priceMin` 那一項單獨刪掉 ⇒ `priceMax` 仍然接住 ⇒ **18 格全綠**;反之亦然。
  //   ⇒ 📌 而單邊是走得到的:價格滑桿只拉一端就是 `?pmin=3000`。
  //   🔬 做法本身值得記:**把判準的每一項【單獨刪掉】跑一次** ——
  //     而那不是用想的, 是真的刪掉跑。⚠️ 刪之前要確認【檔真的變了】:
  //     我第一輪有一格因為中間夾了註解而沒套用成功, 它印出來的綠**與「這一項沒被守」長得一模一樣**。
  it('🔴 價格區間的兩端【各自】都要能單獨觸發 noindex(它們原本互相遮掩)', () => {
    expect(noindexOf('pmin=3000'), 'priceMin 單獨沒被守').toBe(true);
    expect(noindexOf('pmax=10000'), 'priceMax 單獨沒被守').toBe(true);
    expect(canonicalOf('pmin=3000')).toBeUndefined();
    expect(canonicalOf('pmax=10000')).toBeUndefined();
  });

  it('🔵 page 留在 canonical、不折回第 1 頁;第 1 頁不帶 page', () => {
    expect(canonicalOf('page=2')).toBe(`${BASE}/products?page=2`);
    expect(canonicalOf('page=1')).toBe(`${BASE}/products`);
  });

  it('🔵 認不得的參數天然消失(白名單只有 parseCatalogQuery 一份)', () => {
    expect(canonicalOf('from=catalog&utm_source=line')).toBe(`${BASE}/products`);
  });

  // ══ ⟦seo-FILTERCRAWLBUDGET⟧ 2026-09-17:多重篩選不收錄 ═══════════════════
  //
  // 🔴🔴 **下面【第一格是正對照, 而它才是這個決定的價值所在】**:
  //   這一片的目的是省爬蟲預算, 而**代價不能是把「某品牌的完整目錄」一起關掉** ——
  //   那是最可能有人從 Google 搜進來的一種。
  //   ⇒ 📌 一個寫錯的門檻(例如把 `>= 2` 打成 `>= 1`)會**同時**讓負對照那格變綠、
  //     而畫面上完全看不出來 ⇒ **沒有正對照, 這一片可以壞得無聲無息。**

  it('🔵🔵 正對照:單一篩選【仍然可索引】—— 這一格垮了, 這一片就沒有價值了', () => {
    for (const q of ['pbrands=gilles', 'categories=拉桿與把手', 'filter=new']) {
      expect(noindexOf(q), `單一篩選 ${q} 被關掉了`).toBe(false);
    }
    // 而它們的 canonical 仍然是自我指涉(那是本檔原本就寫過理由的決定)
    expect(canonicalOf('pbrands=gilles')).toBe(`${BASE}/products?pbrands=gilles`);
  });

  it('🔵 正對照:`page` 不算一個維度 ⇒ 單一篩選的第 2 頁照樣可索引', () => {
    expect(noindexOf('pbrands=gilles&page=2')).toBe(false);
    expect(canonicalOf('pbrands=gilles&page=2')).toBe(`${BASE}/products?pbrands=gilles&page=2`);
  });

  it('🔴 負對照:兩個以上的篩選 ⇒ noindex, 而且【不產 canonical】', () => {
    // Sean 2026-09-17 匯出的那四筆裡, 這一種就是被這條收掉的
    const r = buildCatalogIndexing(
      parseCatalogQuery(new URLSearchParams('categories=拉桿與把手&pbrands=gilles')),
      BASE,
    );
    expect(r.noindex).toBe(true);
    // 🔴 兩個訊號不准同時出現 —— 理由在被測檔:Google 會把 noindex 沿著 canonical 傳給目標頁
    expect(r.canonical).toBeUndefined();
  });

  // 🔴🔴 **[對抗審查 MF-1]** 多選同一種篩選 —— 而**那一邊的組合空間大得多**
  //   23 個品牌的非空子集 = 8,388,607 個。第一版把它算成「1 個維度」⇒ 全部可索引。
  //   而那是站上真的在產的網址(客人點三顆品牌膠囊)。
  it('🔴 負對照:多選同一種篩選也算多個 —— 這一格是第一版做反的那一塊', () => {
    expect(noindexOf('pbrands=akrapovic,gilles'), '兩個品牌仍可索引 ⇒ 8,388,607 個子集全開著').toBe(true);
    expect(noindexOf('categories=拉桿與把手,煞車系統')).toBe(true);
    // 🔵 而單選必須仍然過(這一片的價值)
    expect(noindexOf('pbrands=akrapovic')).toBe(false);
    expect(noindexOf('categories=拉桿與把手')).toBe(false);
  });

  // 🔴🔴 **[對抗審查 MF-2:這一格補的是一個【假綠】]**
  //   原本 5 格裡 `filter` **從來沒有跟別的維度一起出現過**
  //   ⇒ 把判準裡 `(query.filter ? 1 : 0)` 整項刪掉, **14 格照樣全綠**(2026-09-17 實跑證實)
  //   ⇒ 而 `?filter=new&pbrands=gilles` 是走得到的:導覽列「新品」再點一顆品牌膠囊。
  //   📌 **判別句:正對照抓得到「門檻打錯」, 抓不到「少數一項」—— 而後者比較可能發生。**
  it('🔴 負對照:filter=new + 品牌 ⇒ noindex(少了這格, 刪掉 filter 那項也會全綠)', () => {
    expect(noindexOf('filter=new&pbrands=gilles')).toBe(true);
    expect(noindexOf('filter=new&categories=拉桿與把手')).toBe(true);
  });

  it('🔴 負對照:車款 + 分類 / 車款 + 品牌 也是兩個維度', () => {
    expect(noindexOf('vehicle=honda:cb1000-hornet:2026&categories=拉桿與把手')).toBe(true);
    expect(noindexOf('vehicle=honda:cb1000-hornet:2026&pbrands=gilles')).toBe(true);
  });

  // 🔴 **[對抗審查 SF-1]** 頁碼沒有上界 ⇒ `?page=9999` 是空清單卻可索引。
  it('🔴 負對照:頁碼超過上界 ⇒ noindex 且不產 canonical', () => {
    const over = `pbrands=gilles&page=${CATALOG_MAX_INDEXABLE_PAGE + 1}`;
    const r = buildCatalogIndexing(parseCatalogQuery(new URLSearchParams(over)), BASE);
    expect(r.noindex).toBe(true);
    expect(r.canonical).toBeUndefined();
  });

  it('🔵🔵 正對照:上界【之內】的頁照舊可索引 —— 這一格守的是「別把真實的頁一起關掉」', () => {
    // 🔬 真實最大頁數 = ceil(25,402 / 100) = 255(2026-09-17 實量)⇒ 255 必須過
    expect(noindexOf('pbrands=gilles&page=255')).toBe(false);
    // 邊界本身:等於上界要過, 上界 +1 才關(差一錯會被這兩格夾住)
    expect(noindexOf(`page=${CATALOG_MAX_INDEXABLE_PAGE}`)).toBe(false);
    expect(noindexOf(`page=${CATALOG_MAX_INDEXABLE_PAGE + 1}`)).toBe(true);
  });

  // ⚠️ **這一格記錄的是【現況】, 不是主張它是對的。**
  //   `?vehicle=` 單獨一個仍然可索引, 而車款分類表有 12,482 列
  //   ⇒ 📌 它是這一片【沒有關掉】的最大一塊, 已回報主視窗待裁。
  //   若日後決定連它一起關, 這一格要跟著改成 `true` —— 而那時它會提醒你這是一個【被改過的決定】。
  it('⚠️ 現況記錄:單獨 ?vehicle= 仍可索引(12,482 列的那一塊, 待裁)', () => {
    expect(noindexOf('vehicle=honda:cb1000-hornet:2026')).toBe(false);
  });

  // 🔴 prod 未設 NEXT_PUBLIC_SITE_URL ⇒ 整個省略 canonical(絕不吐 localhost),但 noindex 照算。
  it('🔴 base 未設 ⇒ 不產 canonical, 而 noindex 仍然有效', () => {
    const r = buildCatalogIndexing(parseCatalogQuery(new URLSearchParams('search=拉桿')), undefined);
    expect(r.canonical).toBeUndefined();
    expect(r.noindex).toBe(true);
  });
});
