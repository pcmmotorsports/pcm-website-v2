import { isSourceMissing, resolveListingSetBy, resolveListingState, type AdminProductListRow } from '../../lib/products/product-repository';

// product-status-caps.tsx —— 商品的狀態標示(上架中 / 已下架、缺貨、手動 / 自動、原廠已無此品)。
// 商品頁乙 E1(2026-09-28)從 products-table.tsx 的「狀態」欄原樣搬出來, 表格與卡片共用同一份(進度 86 同意)。
// 🔴 本檔同表格的規矩:不直接讀 row.delisted_at / row.listing_set_by / row.source_missing_at,
//    一律經 resolveListingState / resolveListingSetBy / isSourceMissing。

/**
 * 「誰決定的」標記(`#20` 片2c;文案為 Sean 2026-08-15 拍板字面,**不得自行改寫**)。
 *
 * 🔴 **每一列都必須顯示其一。** 這不是排版偏好 —— Sean 把文案從「員工設定」改成「手動/自動」,
 *    理由就是**兩種狀態都要有名字**:只有一種有標記時,「空白」會同時代表「自動」與「資料壞了」。
 * ⇒ 值不在白名單時顯示「⚠ 資料異常」,**不得靜靜落回「自動」**(負測釘住)。
 *
 * ⚠️ **上線初期會全部是「自動」、「手動」chip 篩出 0 筆** —— 因為寫入 `staff` 的員工入口
 *    在後續片才做(plan §5 `Q3=乙`)。**那不是壞掉**,空狀態文案要講清楚。
 */
const SET_BY_LABEL = { staff: '手動', sync: '自動', unknown: '⚠ 資料異常' } as const;

/** 🔴 「已下架」要看得出來 —— 後台存在的理由之一就是把下架的那批找回來上架。 */
export function ProductStatusCaps({ row }: { row: AdminProductListRow }) {
  return (
    <span className='flex flex-wrap items-center gap-1.5'>
      {/* 2026-09-14:方角 cap(稿 .cap);上架中 綠 / 已下架 灰,顏色走 token */}
      {resolveListingState(row) === 'listed' ? (
        <span className='pcm-cap pcm-cap--on'>上架中</span>
      ) : (
        <span className='pcm-cap'>已下架</span>
      )}
      {/* 商品頁乙 A4:缺貨另外標,不跟「已下架」「原廠已無此品」合併 —— 缺貨的可能還在架上。 */}
      {resolveListingState(row) === 'listed' && row.availability === 'out-of-stock' && (
        <span className='pcm-cap'>缺貨</span>
      )}
      <span className='text-muted-foreground text-xs'>
        {SET_BY_LABEL[resolveListingSetBy(row)]}
      </span>
      {/* 🔴 「原廠已無此品」≠「已停產、不能賣」——
          Sean 的規則正好相反:原廠停產但他有現貨時,商品要繼續賣。
          文案只陳述來源端的事實,不暗示能不能賣(migration 20260815030000 欄位註解同字面)。 */}
      {isSourceMissing(row) && (
        <span className='text-muted-foreground text-xs'>原廠已無此品</span>
      )}
    </span>
  );
}
