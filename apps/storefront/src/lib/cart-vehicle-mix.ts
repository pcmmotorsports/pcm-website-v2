// cart-vehicle-mix.ts — 「這一車混了幾台車」判準(純函式、無 React/DOM 依賴)。
//
// plan:`docs/specs/2026-09-03-cart-vehicle-mix-notice-plan.md`(主視窗-87 2026-09-03 批准動工)。
// 無依賴模組供 CartView 共用,對齊 `lib/cart-vehicle-format.ts` 的先例(同檔 :1 逐字「純函式、無
// React/DOM 依賴」)。
//
// ═══ 🔴 這一格為什麼【不比「目前選的車」】—— 那是本片最重要的一個決定 ═══
// 自然的寫法是「這一列的車 ≠ 目前選的車 ⇒ 叫」。**而那個判準會把購物車變成一片紅**:
// 沒選車的客人是多數(`vehicleFromContext` 沒車時回 `null`)⇒ `null ≠ 任何車`
// ⇒ **對他購物車裡的每一件都叫**。
// ⇒ 🎯 改成「**購物車裡有幾台相異的車**」之後,**判準裡根本沒有「目前選的車」這個變數**
//   ⇒ **結構上不可能對沒選車的人叫** —— 那不是一條要人記得遵守的紀律,是一個做不到的形狀。
//
// ═══ 🛑 這一格【不是】在補一道不存在的警語 ═══
// `CartVehicleField.tsx:133-135` **已經有一道在跑**,逐字「可能不適用 · 下單前我們會與您確認」,
// 而它比的是【這一列的車 vs **這件商品的 fitments**】。⇒ R6 的件裝在 R6 上本來就沒問題,
// 客人換去看 Ducati **不會讓那件變錯** ⇒ **那道閘在換車時沒叫是【正確行為】,不是漏叫。**
// 本函式問的是那道閘不會問的另一個問題:**這一車是不是同時裝著兩台車的東西。**
//
// 🔴 **殘餘誤報明寫,不假裝零誤報 —— 兩條,而第二條是【我們自己造成的】**:
//   ① 真的要一次買兩台份的客人**仍然會被叫一次**(一位客人只叫一次、不是每次換車都叫)。
//   ② 🔴🔴 **車庫預填會把【我們自己猜的車】寫進未填列,而它進了相異值分母**
//      (code-reviewer R1 F1;`CartView.tsx:97-114` `resolveGaragePrefillVehicle` 對每一列
//      `if (!l.item.vehicle) setItemVehicle(l.item, gv)`)。
//      失敗情境:會員只選過一台(search 帶入 `MT-09`),另一列被自動補成車庫裡的 `MT-09 SP`
//      ⇒ 相異值 2 ⇒ **對一台車都沒混的人說「有 2 台車」**。現成 fixture `CartView.test.tsx:267-286`。
//      🛑 **而「用 `source:'garage'` 過濾」擋不掉** —— 客人自己按車庫 chip 也是 `'garage'`
//      (`CartVehicleField.tsx:152`)⇒ 那個欄位分不出「他選的」與「我們猜的」。
//      ⇒ 🔵 **本片不修它**:要修得在 `CartItemVehicle` 上多一個「這是誰填的」欄 = 動 `CartContext`,
//        超出本 plan 的批准範圍。⇒ **已知、刻意、寫在這裡**,而下面有一格測試把它釘成可見。
//
// ⚠️ **分母(會過期,而沒有機制會叫)**:主視窗-87 2026-09-03 唯讀正式庫實查
//   `orders` = 1 · `order_items` = 1 ⇒ **這件事在正式站一次都沒發生過**。
//   ⇒ 本片是上線前補坑、做最小版;引用這個分母之前**當場重跑**。

import type { CartItemVehicle } from '@/contexts/CartContext';
import { formatCartVehicle } from '@/lib/cart-vehicle-format';

/** 一列的輸入:車款 + 該列**已經算好的** fitment 判定。
 *  🔴 `fitStatus` 由呼叫端傳入、本檔不自己算 —— 算它的那顆腦是 `CartVehicleField.tsx` 的
 *  `cartVehicleFitStatus`(再往下是 `lib/fitment-match`),而那支住在 `.tsx` 元件檔裡。
 *  本檔要保持「無 React/DOM 依賴」⇒ 不 import 元件、也**不把那段邏輯抄一份**(抄 = 兩份會分家)。 */
export type CartVehicleMixLine = {
  vehicle?: CartItemVehicle;
  /** `'no-match'` = 該列已經自己亮著紅膠囊;其餘值或 null = 沒亮。 */
  fitStatus?: string | null;
};

export type CartVehicleMixResult = {
  /** 相異車款的顯示字面(依首次出現順序;僅 `kind:'dict'`)。 */
  labels: string[];
  /** 要不要出聲。 */
  shouldNotice: boolean;
};

/**
 * 🔴 只認 `kind:'dict'`(字典字面)—— `kind:'free'` 是客人自由打的字,
 * 「Ducati」與「ducati 」在字面上不同而在現實中是同一台車 ⇒ 拿它去數相異值會**多報**。
 * 車種鐵律零猜:數不準就不數(對齊 `CartVehicleField.tsx:25` 逐字「free/無 fitments/無值 → null
 * =不顯示判定(自由輸入=人工確認路、**不誤嚇**)」)。
 */
function dictKey(v: CartItemVehicle | undefined): string | null {
  if (!v || v.kind !== 'dict') return null;
  // 🔴 **年份刻意不進 key**(code-reviewer R1 F2 抓到, 原版含 `v.year ?? null` 是錯的):
  //   頂部「整車套用」寫下的車**沒有年份**(picker 選到車型即 commit,`CartVehicleField.tsx:172`),
  //   客人再替某一列補上 2019 ⇒ 舊 key 會把**同一台 R6** 算成兩台 ⇒ 對只有一台車的人說「有 2 台車」。
  //   ⚠️ 而原本的測試把那個行為**釘成規格** ⇒ 它是錯的而沒有東西會紅(那一格已改寫)。
  // 🛑 代價明寫:真的同時有 R6 '19 與 R6 '21 兩台的客人, 本橫幅**不會**替他分開 ——
  //   那是刻意的保守方向(少報優於誤報);而逐列各自的紅膠囊仍然會依年份判 fitment。
  return JSON.stringify([v.brand, v.model]);
}

export function cartVehicleMix(lines: readonly CartVehicleMixLine[]): CartVehicleMixResult {
  const seen = new Map<string, string>(); // key → 顯示字面(首次出現的那個)
  for (const l of lines) {
    const k = dictKey(l.vehicle);
    if (k !== null && !seen.has(k)) seen.set(k, formatCartVehicle(l.vehicle!));
  }
  // 🔴 已經有列自己亮紅膠囊 ⇒ 不疊第二層(plan §2 條件 2)。
  //   兩句話同時出現時客人不知道該看哪一句,而那一句比本橫幅**更具體**(它指名了某一件)。
  const anyFitWarning = lines.some((l) => l.fitStatus === 'no-match');
  return {
    labels: [...seen.values()],
    shouldNotice: seen.size >= 2 && !anyFitWarning,
  };
}
