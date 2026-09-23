// search-vehicle.ts — 讀全站選車 context → 購物車車款(V-2a 帶入路徑1「搜尋情境自動帶」)。
//
// V-2h/MF-4 抽出:原邏輯內嵌 ProductInfo.addToCart,但手機 sticky buybar(ProductPage.addToCart)
// 加購時未帶車款 = 同一商品經不同入口加購、車款有無不一致。抽成純函式供兩入口共用單一來源。
//
// 🔴 車種鐵律零猜:名稱字面欄齊全(brandName+modelName,REQUIRED-3 additive 欄)才帶入 kind:'dict'
// source:'search';舊 context 缺名稱欄 → undefined(不自動帶、禁 label 反解析)。

import type { CartItemVehicle } from '@/contexts/CartContext';
import { readVehicleContext } from '@/lib/vehicle-context';
import { looseVehicleKey } from '@/lib/vehicle-match';
import { getCommittedVehicleIntent, getUnverifiedUrlVehicle } from '@/lib/vehicle-intent';

/** 讀選車 context → CartItemVehicle(kind:'dict' source:'search');名稱不齊 → undefined(零猜)。 */
export function readSearchVehicle(): CartItemVehicle | undefined {
  // :901(plan §3-5 C1、§3-6):按下加入購物車的【當下】以車款意圖為準(客人剛選 / 剛清,網址可能還沒落地)。
  //   意圖還沒初始化(伺服器、第一次 render)才退回選車鏡。
  // 🔴 網址指名了一台車,而這一頁沒有車款清單可以驗(Codex 總審必修 2)。
  //   這時退回選車鏡**要先確認鏡裡就是網址上那一台** —— 不確認的話會變成
  //   「網址上寫 R7、購物車帶 MT-07」,而客人不會發現。
  //   🔵 比對不需要車款清單:兩邊都是網址用的 id,只差空白 / 橫線 / 大小寫算同一台(與網址判斷同一把尺)。
  //   對不起來就不帶車:看得見的缺優於安靜的錯。
  const unverified = getUnverifiedUrlVehicle();
  if (unverified !== null) {
    const ctx = readVehicleContext();
    if (!ctx?.brandName || !ctx.modelName) return undefined;
    const mirrored = [ctx.brandId, ctx.modelId, ctx.year].filter((x) => x != null && x !== '').join(':');
    if (looseVehicleKey(mirrored) !== looseVehicleKey(unverified)) return undefined;
    return { kind: 'dict', brand: ctx.brandName, model: ctx.modelName, year: ctx.year, source: 'search' };
  }
  // 讀【已經畫到畫面上】的那一份:還沒提交的 render 改的值不算(理由見 `getCommittedVehicleIntent`)
  const intent = getCommittedVehicleIntent();
  if (intent) {
    return intent.kind === 'vehicle' && intent.brandName && intent.modelName
      ? { kind: 'dict', brand: intent.brandName, model: intent.modelName, year: intent.year, source: 'search' }
      : undefined;
  }
  const ctx = readVehicleContext();
  return ctx && ctx.brandName && ctx.modelName
    ? { kind: 'dict', brand: ctx.brandName, model: ctx.modelName, year: ctx.year, source: 'search' }
    : undefined;
}
