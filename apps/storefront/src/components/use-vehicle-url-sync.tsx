// use-vehicle-url-sync.tsx — #341-B:從 `products-url-state.tsx` **原樣搬出**(純位移)。
//
// 🔴 hook 本體一個字元都沒改。它與 `use-catalog-filter-url-sync.tsx` 是**同一場競態的兩端**
//    (Q28① 的 vehicle 讓路守衛住在那一支)⇒ 動這裡之前先讀那一支的 Q28① 段,理由正本在那裡。
// 🔴 副檔名 `.tsx`:含 hook 的檔要 .tsx 才受 eslint react-hooks 規則保護(沿用原檔頭理由)。
// 回歸鎖:`use-vehicle-url-sync.test.tsx`。

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { CascadeFilterState } from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { clearVehicleContext, writeVehicleContext } from '@/lib/vehicle-context';
import { parseVehicleFromUrl, resolveVehicleForUrl, type SearchParamsLike } from '@/lib/vehicle-url';



/**
 * S1(2026-07-12):cascade.vehicle → URL `?vehicle=brandId:modelId[:year]`(短版)→ server 重查。
 *
 * 車款篩選下推 DB 的 client 半邊:vehicle 變動時 `router.replace`(非 replaceState —— 這裡
 * **就是要** server 往返:/products force-dynamic、server 依 vehicle 走 RPC
 * `search_products_by_vehicle`〔product_fitments ∪ effective 去重、繼承件也命中〕重撈 products
 * prop;其餘瀏覽狀態 page/sort/per 仍走 useBrowseUrlSync 的零往返 replaceState、兩機制並存)。
 *
 * - 名稱→slug id:對照 motoBrands(= server fetchVehicleTaxonomy、與 parseVehicleFromUrl 同源;
 *   查無〔資料缺/清單未含〕→ 不寫不清、保守 no-op)。
 * - 品牌-only 選擇 → 單段 `?vehicle=brandId`(parseVehicleFromUrl parts[1] 空 → model null;
 *   RPC p_model NULL = 整品牌相容商品)。
 * - vehicle 清除 → 刪 `vehicle` key;長版遺留 key(?brand=&model=&year= 書籤)在兩方向皆一併清
 *   (`brand` 僅在與 `model` 同在=車輛長版語意時清;?brand= 單獨=商品品牌 filter、不可誤刪)。
 * - URL 無變化即 no-op(mount 還原波、StrictMode 雙跑安全);與現值比對後才 replace。
 * - V-2c:寫 URL 同一時機同步 vehicle-context 鏡(鏡恆跟隨 URL 真相;真清除才清鏡、
 *   mount 無車不清 — 詳 effect 內註解)。
 */
export function useVehicleUrlSync(
  vehicle: CascadeFilterState['vehicle'],
  motoBrands: MockMotoBrand[],
): void {
  const router = useRouter();
  // 🔴 還原窗口守衛:mount 時 useDeepLinkRestore 的 dispatch 尚未 flush、本 effect 首輪
  // 閉包 vehicle 仍 null —— 若 URL 帶可解析的車輛參數,此時清 URL = 深連結被自己打掉。
  // 規則:vehicle=null 且 URL 車輛參數可解析且還原未消化(pendingRestore≠false)→ skip;
  // vehicle 首次非 null(還原 flush 或使用者自選)→ 標記消化,之後的 null 才是真清除。
  const pendingRestoreRef = useRef<boolean | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (vehicle) {
      pendingRestoreRef.current = false; // 還原已消化(或使用者自選)
    } else if (pendingRestoreRef.current !== false) {
      const restorable = parseVehicleFromUrl(
        { get: (n) => params.get(n) },
        motoBrands,
      );
      if (restorable) return; // 還原窗口:URL 車輛待 restore dispatch flush、勿清
    }
    let next: string | null = null;
    if (vehicle) {
      // Q28① R1 MF-1:解析抽到 lib/vehicle-url.resolveVehicleForUrl(邏輯零動),
      // 讓 useCatalogFilterUrlSync 能用**同一個**判斷決定要不要讓路,見該 hook 的 hold 守衛。
      const resolved = resolveVehicleForUrl(vehicle, motoBrands);
      if (!resolved) return; // taxonomy 查無(清單空/資料缺)→ 保守不動 URL(鏡同、不寫不清)
      const { brandObj, modelObj } = resolved;
      next = resolved.segment;
      // V-2c R2:鏡恆跟隨 URL 真相 — 與寫 URL 同一時機單點寫鏡(避免雙寫競態);修「型錄換車/
      // 清車不寫鏡 → PDP §7 顯舊車+購物車帶錯車」。名稱字面自 taxonomy(brandName/modelName=
      // V-2a REQUIRED-3 additive 欄);brand-only 也寫(鏡跟 URL、消費端名稱不齊自然零猜)。
      // deep-link 入站水合同輪重寫同值=冪等無害(URL 本為真相)。
      writeVehicleContext({
        brandId: brandObj.id,
        modelId: modelObj?.id,
        year: modelObj != null && vehicle.year != null ? vehicle.year : undefined,
        label: [brandObj.name, modelObj?.name, modelObj != null ? vehicle.year : undefined]
          .filter((s) => s != null)
          .join(' '),
        brandName: brandObj.name,
        modelName: modelObj?.name,
      });
    } else if (pendingRestoreRef.current === false) {
      // V-2c R2:真清除(本 mount 曾有車、使用者清車)→ 清鏡。mount 無車(ref 仍 null)不清:
      // 直接逛 /products 不得洗掉首頁/他頁寫的鏡(URL 無車≠使用者清車)。
      clearVehicleContext();
    }
    const hadLongVehicle = params.get('brand') != null && params.get('model') != null;
    if (next !== null) params.set('vehicle', next);
    else params.delete('vehicle');
    if (hadLongVehicle) params.delete('brand');
    params.delete('model');
    params.delete('year');
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      router.replace(url, { scroll: false });
    }
  }, [vehicle, motoBrands, router]);
}
