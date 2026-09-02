// app/search/page.tsx — 搜尋結果頁(搜尋線 第一刀)
//
// 🔴 **為什麼是新的一頁,不是 `/products?search=`**(主視窗 2026-09-02 判 A 案):
//    `/products` 的商品資料走 RPC `search_catalog_by_vehicle`,而那支**沒有關鍵字參數**
//    (repo 裡 8 個定義點全掃零命中,數法在 `lib/search.ts` 檔頭)。
//    ⇒ 塞進 `/products` 只有兩條路:改 RPC(= migration,本片不碰)、或同一頁跑兩條資料路。
//    後者的代價逐字:「關鍵字 + 品牌篩選」點下去會**安靜地丟掉一半條件**,而畫面上完全正常。
//    ⇒ 判準:**一個看得見的缺,永遠優於一個安靜的錯。**
//
// ⚠️ **所以本頁【沒有】側欄篩選 / 排序 / 分頁**(`/products` 有)—— 那是**被決定的缺**,不是漏做。
//    要補的話是下一刀,而它需要先決定關鍵字要不要下推 RPC。
//
// 🔴 **天地要自己 import**:本站 `app/` 底下無 nested layout,`Header` / `HomeFooter` 由各頁
//    各自 import(同 `app/stores/page.tsx` 檔頭那條)。少了它們客人點進來就出不去。
//
// 內容分級 L1(字面全部寫死、無後台 CRUD 需求)。

import type { Metadata } from 'next';

import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { ProductCard } from '@/components/ProductCard';
import { searchProducts, SEARCH_PAGE_LIMIT } from '@/lib/search';

// 搜尋字隨 URL 變動、結果隨每日目錄同步變動 ⇒ 不做靜態化。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '搜尋 — PCM重機零件販售',
  description: '搜尋 PCM 的高端機車零件:依商品名稱、副標與說明找貨。',
  // 🔴 搜尋結果頁不進索引:同一批商品會長出無限多組 `?q=` 網址,而它們的內容互相重疊。
  robots: { index: false, follow: true },
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchRoute({ searchParams }: Props) {
  const sp = await searchParams;
  // 重複參數取首值(對齊 `/products` route 既有 idiom)。
  const raw = sp.q;
  const q = (typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] ?? '' : '').trim();

  const { items, total, error } = await searchProducts(q, SEARCH_PAGE_LIMIT);

  return (
    <>
      <Header currentPage="products" />
      <main className="pp-page" style={{ padding: '32px 20px 64px', maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ font: '400 22px/1.3 var(--font-sans)', marginBottom: 6 }}>
          {q === '' ? '搜尋' : `「${q}」的搜尋結果`}
        </h1>

        {/* 🔴 三種空狀態畫三種字,不共用一句:
            ① 沒打字 ② 打了而查不到 ③ 這次撈失敗(≠ 我們沒有這件商品)。 */}
        {q === '' ? (
          <p style={{ color: 'var(--c-text-3)', marginTop: 24 }}>
            上面的搜尋框輸入商品名稱、品牌或車款,例如「排氣管」、「Öhlins」。
          </p>
        ) : error ? (
          <p style={{ color: 'var(--c-text-3)', marginTop: 24 }} role="status">
            搜尋暫時無法使用,請稍後再試一次,或用 LINE 直接問我們。
          </p>
        ) : items.length === 0 ? (
          <p style={{ color: 'var(--c-text-3)', marginTop: 24 }}>
            沒有找到「{q}」相關結果。試試「排氣管」、「Öhlins」、或你的車款名稱。
          </p>
        ) : (
          <>
            {/* ⚠️ 一頁 25 筆、目前**不分頁** ⇒ 總數比顯示數多時要講出來,否則客人會以為只有這些。
                🔴 而 `total === null` = **不知道總數**(不是 0)⇒ 整行不印,不要編一個數字給客人。
                   印「共 0 件」而下面就是卡片,比不印還糟。 */}
            {total !== null && (
              <p style={{ color: 'var(--c-text-3)', font: '13px/1 var(--font-sans)', marginBottom: 20 }}>
                共 {total} 件{total > items.length ? `,顯示前 ${items.length} 件` : ''}
              </p>
            )}
            <div
              className="pp-grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(256px, 1fr))', gap: 14 }}
            >
              {items.map((p) => (
                <ProductCard key={p.id} p={p} href={`/products/${p.slug}`} />
              ))}
            </div>
          </>
        )}
      </main>
      <HomeFooter />
    </>
  );
}
