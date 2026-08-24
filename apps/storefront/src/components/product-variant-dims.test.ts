// product-variant-dims.test.ts — `sortDimValues` 的排序守門(#888 刀A 的補洞)
//
// 🔴 **為什麼這支檔存在**:#888 拆檔時當場量到 —— `sortDimValues` / `WEAVE_ORDER` /
//   `FINISH_ORDER` 在全 storefront 只有 8 處命中,**全部在原檔自己檔內、零測試引用**。
//   ⇒ 拆檔前後「3575 格全綠」對「排序有沒有被搬壞」**零判別力**。這支檔就是那一格。
//
// 🔴🔴 **期望值的來源(這是本檔最重要的一句)**:
//   下方每一組期望值都**不是**從搬移後的 `product-variant-dims.ts` 算出來的,
//   而是從 **`ProductInfo.tsx` 搬移【之前】那一份**(git HEAD 版,shasum 對過)
//   抽出 L55-165 獨立跑 `npx tsx` 印出來、**逐字抄進來的**。
//   ⇒ 差別在:期望值若來自搬完的碼,這支檔只守得住「以後別人改壞」,
//     **守不住「這次搬移本身就搬錯了」**。用 pristine 當標準答案,兩件都守得住。
//
// 📌 **要重算這些期望值的人看這裡**(產生器【不在】repo 裡,是刻意的):
//   ① 取搬移前那份:`git show <該片之前的 sha>:apps/storefront/src/components/ProductInfo.tsx`
//      —— 先 `shasum -a 256` 對過,**證明它是那一版,不要假設**。
//   ② 從它抽出 `sortDimValues` 那段(當時是 L55-165)+ 一個 `UIVariant` 型別 stub + 驅動,
//      放進暫存目錄,用 `npx tsx <檔>` 跑,把輸出**逐字**抄回本檔。
//   ③ 產生器**不進 repo**:它一旦進了 repo 就會被當成「現行行為的定義」而跟著被改,
//      而它的全部價值在於**它是那個【已經過去的】版本的行為**。進了 repo 就腐爛。
//
// ⚠️ **這支檔紅了不要改期望值**。期望值是 HEAD 版行為的紀錄;它紅 = 行為真的變了
//   ⇒ 停下來回報(`00-work-rules` R4:想動驗證本身 = 立即停止訊號)。
//
// 🔴 **四格 `pattern` 各守【一個不同的機制】—— 名字看起來都叫「pattern 排序」,而它們不是同一件事。**
//   下一個人動 `sortDimValues` 的任何一塊時,要知道哪一格會替你叫。每一行的括號內是**實跑過的**突變:
//     · 純 weave 排序       ← `WEAVE_ORDER` 那張表    (對調前兩項 ⇒ 這格紅)
//     · special 合併排序    ← 12K/Kevlar 的 `si` 相對序(對調 `WEAVE_ORDER` 前兩項 ⇒ 這格也紅)
//     · 未列 weave 的位置   ← fallback `rank` 的 `50`  (`50` → `-1` ⇒ **只這格紅**)
//     · 未列 special 的位置 ← `si` 的 fallback `2`     (`2` → `0`  ⇒ **只這格紅**)
//   🔴 **「只這格紅」那三個字是承重的** —— 它證的是**歸因**,不只是**偵測**:
//     一發突變只紅它負責的那幾格 ⇒ 這把尺分得出是哪個機制壞了,而不是「有東西壞了」。
//   ⚠️ 而這四格是**四個機制不是一個**這件事,曾經被兩邊各自誤判過:一次把四個當一個而**高估**
//     (推論「動 `WEAVE_ORDER` 會紅在所有 pattern 測項」—— 實測只紅 2 格),
//     一次看到 2/4 不紅就寫「這把尺射程窄」而**低估**(實測那兩格各有自己的守門)。
//     ⇒ 判別句:**先問這裡有幾個機制,再問它紅幾格。**

import { describe, expect, it } from 'vitest';
import { sortDimValues } from './product-variant-dims';

describe('sortDimValues — 期望值取自搬移前的 HEAD 版(見檔頭)', () => {
  it('RPM finish:亂序輸入 → 亮光在前', () => {
    expect(sortDimValues('finish', ['Matt', 'Glossy'], true)).toEqual(['Glossy', 'Matt']);
  });

  it('RPM finish:含未列在 FINISH_ORDER 的值 → 未列值排最後', () => {
    expect(sortDimValues('finish', ['Matt', 'Satin', 'Glossy'], true)).toEqual([
      'Glossy',
      'Matt',
      'Satin',
    ]);
  });

  it('RPM pattern:純 weave 亂序 → 照 WEAVE_ORDER(斜紋/平織/鍛造/蜂巢)', () => {
    expect(sortDimValues('pattern', ['Honeycomb', 'Twill', 'Forged', 'Plain'], true)).toEqual([
      'Twill',
      'Plain',
      'Forged',
      'Honeycomb',
    ]);
  });

  it('RPM pattern:special 合併款一律排在純 weave 之後,且 12K 先於 Kevlar', () => {
    expect(
      sortDimValues('pattern', ['Kevlar|Twill', 'Twill', '12K|Plain', 'Plain', '12K|Twill'], true),
    ).toEqual(['Twill', 'Plain', '12K|Twill', '12K|Plain', 'Kevlar|Twill']);
  });

  it('RPM pattern:未列在 WEAVE_ORDER 的 weave → 排在已列的之後', () => {
    expect(sortDimValues('pattern', ['Zebra', 'Twill'], true)).toEqual(['Twill', 'Zebra']);
  });

  it('RPM pattern:未列的 special → 排在 12K / Kevlar 之後', () => {
    expect(sortDimValues('pattern', ['Foo|Twill', '12K|Twill', 'Kevlar|Twill'], true)).toEqual([
      '12K|Twill',
      'Kevlar|Twill',
      'Foo|Twill',
    ]);
  });

  it('泛型維(rpm=false)完全不重排 —— 維持變體首見序 = 匯入端 sort_order 序', () => {
    expect(sortDimValues('color', ['紅色', '黑色', '白色'], false)).toEqual([
      '紅色',
      '黑色',
      '白色',
    ]);
  });
});
