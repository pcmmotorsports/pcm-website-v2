// order-detail-summary-cards-fields.test.ts — 2026-08-20 新建。
//
// 🔴 **這支元件在此之前零測試**(量法:`ls apps/admin/src/components/orders/ | grep summary-cards`
//    ⇒ 只有元件本身,無 `.test.`)。而 `W1-065` 驗收 5 逐字寫著
//    「另外三張卡逐欄仍在 —— **這是負向對照,防我順手刪掉**」
//    ⇒ **那條負向對照當時沒有任何東西在執行它。**
//
// 🔴🔴 **而 W6 `P3` 建議的修法(逐欄 `git grep`)是【恆真守門】—— 這是表演出來的,不是推論**:
//    2026-08-20 實測:把 `label='電話'` / `label='Email'` / `label='載具'` / `label='統編 / 抬頭'`
//    四個一起改名(= 模擬刪掉),再跑那個 grep ⇒ **四個仍然全部回 1。**
//    成因:那支檔 `:9` 的**檔頭註解列出了全部欄位名**
//    (逐字「(客人電話/Email、出貨狀態、來源·管道、付款時間、發票需求型式/統編/載具)」)
//    ⇒ 🔴 **就算整組欄位從畫面上消失,grep 照樣命中那行註解。**
//    📌 判別句:**我 grep 到的那一行,是【這個東西存在的原因】,還是【只是提到它】?**
//
// ⚠️ **本檔擋得住 / 擋不住**(不要拿它當更強的東西用):
//    擋得住 —— 任何一個 `<Field>` 的 `label` 被刪掉或改字。
//    **擋不住** —— ①那個 `<Field>` 有沒有真的渲染出來(它可能在一個永遠 false 的分支裡)
//                 ②值對不對 ③版面。要那些得造 fixture 渲染,而多數欄位是條件式的
//                 ⇒ 一組 fixture 蓋不完 ⇒ **本檔刻意停在字面層,並且說出來。**

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, 'order-detail-summary-cards.tsx'), 'utf8');

/** 三張卡上每一個欄位的**渲染字面**。改動這張表 = 改動 Sean 看得到的欄位,要有拍板。 */
const FIELD_LABELS = [
  '姓名',
  '電話',
  'Email',
  '付款狀態',
  '出貨狀態',
  '來源 · 管道',
  '付款時間',
  '需求型式',
  '統編 / 抬頭',
  '載具',
  '開立狀態',
  '發票號碼',
  '發票金額',
] as const;

describe('三張摘要卡的欄位一個都不能靜默消失', () => {
  it.each(FIELD_LABELS)("渲染字面 label='%s' 仍在", (label) => {
    // 🔴 釘的是 `label='…'` 這個**形狀**,不是那兩個字 ——
    //    註解、import、錯誤訊息裡出現同樣的字都不算數。
    expect(SOURCE).toContain(`label='${label}'`);
  });

  it('🔴 這張表本身也要對得上:檔案裡沒有第 14 個 label(多的那個沒進表 = 表過期了)', () => {
    const found = [...SOURCE.matchAll(/label='([^']*)'/g)].map((m) => m[1]);
    expect(new Set(found)).toEqual(new Set(FIELD_LABELS));
  });
});
