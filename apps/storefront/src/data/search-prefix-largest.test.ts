// search-prefix-largest.test.ts — ⟦search-PREFIXWRONGCAT⟧ 的守門
//
// 🔴🔴 **這一格守的東西【沒有人打算做出來】** —— 那正是它需要守門的理由。
//    Sean 2026-09-04 的推 main 放行條件逐字:「乙 那 3 組跳過, 修剩下 22 組就可以推」。
//    而 2026-09-04 線【身分】重量時發現:**那 22 組已經全部落在最大的分類了** ——
//    🛑 **而不是有人去修它們**, 是線【前台】改分類比對的排序與 `pickLargest` 時**順手蓋掉的**。
//    ⇒ 🎯 **一個沒有人打算修的東西被修好了 ⇒ 沒有任何人有理由去保護它** ⇒ 它會靜靜壞回去。
//
// ✅ **本檔餵的是【真的兩支】**:`buildCategoryTree`(真的目錄樹, 只留有商品的)
//    → `parseSearchFacets`(真的解析器)。
//    ⛔ ~~初版我餵的是我自己用正式庫資料造的【平的清單】~~ ⇒ 主視窗指出:
//    📌 **那樣它守的是我的清單, 不是產品行為。**(而 `buildCategoryTree` 是純函式 ⇒ 餵得進去。)
//
// ⚠️ **天花板:下面那份分類快照會過期。**
//    它是 2026-09-04 從唯讀正式庫拉的(id / name / parent / sort_order / 件數)。
//    🔴 **而它過期的方向是【單向的好消息】**:分類改名或件數變動 ⇒ 這一格還在守一個舊世界,
//       **而它照樣全綠** ⇒ 📌 所以它證的是「規則對這份分類長這樣時是對的」, 不是「線上現在是對的」。
//    ✅ 重拉法(一句 SQL, 唯讀):
//      select c.id, c.name, coalesce(c.parent_category_id::text,''), coalesce(c.sort_order,0), count(p.id)
//        from public.categories c left join public.products_public p on p.category_id = c.id
//       group by c.id, c.name, c.parent_category_id, c.sort_order order by c.sort_order, c.name;

import { describe, expect, it } from 'vitest';
import { buildCategoryTree } from '@/lib/category-taxonomy';
import { parseSearchFacets } from '@/lib/parse-search-facets';
// 🔴 這個常數住在 `products-url-parsers.ts`, 不是解析器那支。
//    ⛔ ~~初版我從 '@/lib/parse-search-facets' import 它~~ ⇒ 那個名字在那支檔【不存在】
//    ⇒ 拿到 `undefined` ⇒ `split(undefined)` **不報錯**, 回整串 ⇒ 18 格紅而【落點其實全對】。
//    📌 一個不存在的具名 import 在這條路上是【安靜的】, 而它的症狀讀起來像被測對象壞了。
import { CATEGORY_URL_SEPARATOR } from '@/components/products-url-parsers';
import { foldSearchTerm } from '@/lib/search-terms-fold';

// 🔴 型別【從那支函式自己推出來】, 不要另外 import 一個名字 ——
//    `CategorySummary` 在 `category-taxonomy.ts` 裡是 local 的、沒有 export。
//    ⛔ 初版我直接 `import { type CategorySummary }` ⇒ **vitest 全綠而 typecheck rc=2**
//    ⇒ 📌 vitest 走 esbuild【不做型別檢查】⇒ 一個型別錯誤在測試那一層是【安靜的】。
//    ✅ 而這樣寫還多一個好處:那支函式改簽章時, 這裡跟著紅。
type Summary = Parameters<typeof buildCategoryTree>[0][number];

/** 2026-09-04 唯讀正式庫快照(117 列, 含 3 個同名分類)。
 *  🔵 `path` 那一欄是 DB 的 `raw_path` 真值 —— **`buildCategoryTree` 一次都沒有讀它**(grep ⇒ 0),
 *     而型別要求它(`CategoryPath = { raw, segments }`)。
 *     ⚠️ **仍然填真值(DB 的 `raw_path` / `segments`), 不填假的** —— 一份會說謊的 fixture 是下一個人的陷阱。 */
const SUMMARIES: Summary[] = [
  {
    id: '1284548e-2bd7-4b97-a958-f904ed206a46',
    name: '操控部品',
    path: { raw: '操控部品', segments: ['操控部品'] },
    parentId: null,
    sortOrder: 1,
    productCount: 0,
  },
  {
    id: 'a87697b5-3d74-4ffd-b95b-f2195f625e31',
    name: '周邊配件',
    path: { raw: '周邊配件', segments: ['周邊配件'] },
    parentId: null,
    sortOrder: 2,
    productCount: 0,
  },
  {
    id: '91c3f5ce-17b7-48ca-9972-c02fe2e1d0ca',
    name: '車殼外觀',
    path: { raw: '車殼外觀', segments: ['車殼外觀'] },
    parentId: null,
    sortOrder: 3,
    productCount: 0,
  },
  {
    id: '1a69615f-0f9b-4b37-9ba9-c15776beb22d',
    name: '引擎部品',
    path: { raw: '引擎部品', segments: ['引擎部品'] },
    parentId: null,
    sortOrder: 4,
    productCount: 0,
  },
  {
    id: '3349c6e1-1d19-430c-ae10-1ff4fe6b5cd0',
    name: '騎士好物',
    path: { raw: '騎士好物', segments: ['騎士好物'] },
    parentId: null,
    sortOrder: 5,
    productCount: 0,
  },
  {
    id: '5e75e08a-c36e-473c-9e96-21375832d8e0',
    name: '後視鏡',
    path: { raw: '後視鏡', segments: ['後視鏡'] },
    parentId: null,
    sortOrder: 6,
    productCount: 0,
  },
  {
    id: '6bf50204-db08-41f9-aa1a-fde462d7abcd',
    name: '電子系統',
    path: { raw: '電子系統', segments: ['電子系統'] },
    parentId: null,
    sortOrder: 7,
    productCount: 0,
  },
  {
    id: 'f61b9bc4-129d-491a-81f8-1726451ccfd7',
    name: '車架',
    path: { raw: '車架', segments: ['車架'] },
    parentId: null,
    sortOrder: 8,
    productCount: 0,
  },
  {
    id: '8fe09773-3dcb-498e-a08c-ba740c849587',
    name: '尾段排氣管(Slip-On)',
    path: { raw: '排氣系統 · 尾段排氣管(Slip-On)', segments: ['排氣系統', '尾段排氣管(Slip-On)'] },
    parentId: '551c3496-d781-45fb-925d-dbf277b06e58',
    sortOrder: 10,
    productCount: 319,
  },
  {
    id: '3c849aba-0ff5-4f8e-9743-1c1266d79c27',
    name: '手機架與導航支架',
    path: { raw: '騎士用品與配件 · 手機架與導航支架', segments: ['騎士用品與配件', '手機架與導航支架'] },
    parentId: '12f598ce-32ac-4e5d-a6a9-261a71ec296d',
    sortOrder: 10,
    productCount: 1326,
  },
  {
    id: 'd93c0211-438a-4d23-b66c-174b724eb18e',
    name: '油杯與油杯蓋',
    path: { raw: '煞車系統 · 油杯與油杯蓋', segments: ['煞車系統', '油杯與油杯蓋'] },
    parentId: '55e4b6bb-96d1-4722-9de6-65e5481dfa3d',
    sortOrder: 10,
    productCount: 226,
  },
  {
    id: '282eb68b-5905-40d8-8396-7c027fe41ac9',
    name: '油箱止滑貼',
    path: { raw: '止滑貼與保護膜 · 油箱止滑貼', segments: ['止滑貼與保護膜', '油箱止滑貼'] },
    parentId: '4bb344e0-d5c6-4044-a247-3ee776171bd9',
    sortOrder: 10,
    productCount: 614,
  },
  {
    id: '55b8da9d-49bf-4657-b32c-be4dd6a0e582',
    name: '煞車離合器拉桿',
    path: { raw: '拉桿與把手 · 煞車離合器拉桿', segments: ['拉桿與把手', '煞車離合器拉桿'] },
    parentId: '7946ce4b-0272-46af-9189-fe83c3398a89',
    sortOrder: 10,
    productCount: 1136,
  },
  {
    id: '506f6173-09d2-4719-9255-0bf41db49ebd',
    name: '燈具方向燈',
    path: { raw: '燈具方向燈', segments: ['燈具方向燈'] },
    parentId: null,
    sortOrder: 10,
    productCount: 0,
  },
  {
    id: '7c600046-ecad-4688-91fa-4da6ef45390d',
    name: '短牌架',
    path: { raw: '外觀與後視鏡 · 短牌架', segments: ['外觀與後視鏡', '短牌架'] },
    parentId: 'fb3e68c3-915b-4c77-a132-bfad4e62ad56',
    sortOrder: 10,
    productCount: 1782,
  },
  {
    id: 'f4bcbda0-8685-4633-b930-244974ea56e8',
    name: '碳纖維土除',
    path: { raw: '碳纖維部品 · 碳纖維土除', segments: ['碳纖維部品', '碳纖維土除'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 10,
    productCount: 245,
  },
  {
    id: '24860eb8-8321-4342-a8b1-32092499fd87',
    name: '碳纖維部品',
    path: { raw: '碳纖維部品', segments: ['碳纖維部品'] },
    parentId: null,
    sortOrder: 10,
    productCount: 291,
  },
  {
    id: '78130df4-96b3-46dc-8a13-f430d6edee3c',
    name: '空氣濾芯',
    path: { raw: '進氣系統 · 空氣濾芯', segments: ['進氣系統', '空氣濾芯'] },
    parentId: '78d3d4af-4b84-4ff4-89a3-493dd295582a',
    sortOrder: 10,
    productCount: 661,
  },
  {
    id: '6cd65e7a-301e-4115-8fd4-939ed2ad368f',
    name: '精品螺絲組',
    path: { raw: '精品螺絲與螺帽 · 精品螺絲組', segments: ['精品螺絲與螺帽', '精品螺絲組'] },
    parentId: 'c37e62a8-3923-4400-b0cc-3aa64c677c94',
    sortOrder: 10,
    productCount: 1765,
  },
  {
    id: 'd83ce275-1dd7-489d-a4c1-809a5c5c87fc',
    name: '維修零件',
    path: { raw: '服務與其他 · 維修零件', segments: ['服務與其他', '維修零件'] },
    parentId: 'e9f18025-dbc5-4aa7-9674-d755549950da',
    sortOrder: 10,
    productCount: 0,
  },
  {
    id: 'ce697b77-b1e4-4072-ac53-f5c78b545ee8',
    name: '維修零件',
    path: { raw: '維修零件 · 維修零件', segments: ['維修零件', '維修零件'] },
    parentId: '69546b21-3261-46af-817a-82d6ada92680',
    sortOrder: 10,
    productCount: 1638,
  },
  {
    id: '61b0d611-b6cc-49e5-9970-4e0a07c11f61',
    name: '腳踏後移組',
    path: { raw: '腳踏後移與傳動 · 腳踏後移組', segments: ['腳踏後移與傳動', '腳踏後移組'] },
    parentId: 'a61cb84a-91f7-4bce-838a-86a89cb1835f',
    sortOrder: 10,
    productCount: 951,
  },
  {
    id: '0b4bcc06-e041-457d-b39f-300731871a5b',
    name: '車架與前叉部品',
    path: { raw: '懸吊與車架 · 車架與前叉部品', segments: ['懸吊與車架', '車架與前叉部品'] },
    parentId: 'd20cdc8d-e23a-422f-9b29-7ddd88e39d16',
    sortOrder: 10,
    productCount: 192,
  },
  {
    id: 'a5cef68b-a2a5-4f9b-8b77-8571f6b4144f',
    name: '車身防倒球與滑塊',
    path: { raw: '車身防護與防摔 · 車身防倒球與滑塊', segments: ['車身防護與防摔', '車身防倒球與滑塊'] },
    parentId: '1bb06d28-f536-46cb-b39d-605be4f8a970',
    sortOrder: 10,
    productCount: 777,
  },
  {
    id: '2d447082-f7e9-41f1-b681-8372bc141dd0',
    name: '防爆水管組',
    path: { raw: '引擎與冷卻 · 防爆水管組', segments: ['引擎與冷卻', '防爆水管組'] },
    parentId: '8c1fc850-ccdb-4a4d-b60c-bf92c83178b7',
    sortOrder: 10,
    productCount: 769,
  },
  {
    id: 'f6b5d9f4-81ee-4ca2-9e25-c8fa479bd1bf',
    name: '防爆水管組',
    path: { raw: '四輪 ATV/UTV · 防爆水管組', segments: ['四輪 ATV/UTV', '防爆水管組'] },
    parentId: '47eef157-3544-4e76-91aa-6dccafe4b0bc',
    sortOrder: 10,
    productCount: 22,
  },
  {
    id: 'a9c2ec43-c04c-425d-a878-74e9e66ffc34',
    name: '電裝與線材',
    path: { raw: '燈具與電子 · 電裝與線材', segments: ['燈具與電子', '電裝與線材'] },
    parentId: '86d457f4-0bc4-4396-bc22-b9b58a436c94',
    sortOrder: 10,
    productCount: 141,
  },
  {
    id: '9742f7bc-dd65-482a-9a73-9ab7620a6d34',
    name: '駐車架',
    path: { raw: '駐車架', segments: ['駐車架'] },
    parentId: null,
    sortOrder: 11,
    productCount: 0,
  },
  {
    id: '14093b56-d49b-4cfa-ac0e-ddd6424ad6a8',
    name: '傳動齒比',
    path: { raw: '傳動齒比', segments: ['傳動齒比'] },
    parentId: null,
    sortOrder: 12,
    productCount: 0,
  },
  {
    id: 'b31c3d69-c369-490d-af59-2ffbac98709a',
    name: '服飾配備',
    path: { raw: '服飾配備', segments: ['服飾配備'] },
    parentId: null,
    sortOrder: 13,
    productCount: 0,
  },
  {
    id: 'b45b4253-6eb2-4c10-b793-806885430da6',
    name: '行李箱包',
    path: { raw: '行李箱包', segments: ['行李箱包'] },
    parentId: null,
    sortOrder: 16,
    productCount: 0,
  },
  {
    id: '42f234c2-1ac9-4583-ad6d-c23c774b0941',
    name: '三角台',
    path: { raw: '懸吊與車架 · 三角台', segments: ['懸吊與車架', '三角台'] },
    parentId: 'd20cdc8d-e23a-422f-9b29-7ddd88e39d16',
    sortOrder: 20,
    productCount: 64,
  },
  {
    id: '7ca108e0-5f51-443f-a6b3-caf4e1ba4641',
    name: '儀表保護貼',
    path: { raw: '止滑貼與保護膜 · 儀表保護貼', segments: ['止滑貼與保護膜', '儀表保護貼'] },
    parentId: '4bb344e0-d5c6-4044-a247-3ee776171bd9',
    sortOrder: 20,
    productCount: 430,
  },
  {
    id: '2942047c-bc12-43fc-8bc0-95d608b9bbd4',
    name: '全段排氣管',
    path: { raw: '排氣系統 · 全段排氣管', segments: ['排氣系統', '全段排氣管'] },
    parentId: '551c3496-d781-45fb-925d-dbf277b06e58',
    sortOrder: 20,
    productCount: 251,
  },
  {
    id: '5b88212e-c5f0-4c24-855f-84d1f1fa0086',
    name: '引擎護蓋與護桿',
    path: { raw: '車身防護與防摔 · 引擎護蓋與護桿', segments: ['車身防護與防摔', '引擎護蓋與護桿'] },
    parentId: '1bb06d28-f536-46cb-b39d-605be4f8a970',
    sortOrder: 20,
    productCount: 688,
  },
  {
    id: 'e2bc7342-1779-4528-b823-3075fe1c7347',
    name: '握把與平衡端子',
    path: { raw: '拉桿與把手 · 握把與平衡端子', segments: ['拉桿與把手', '握把與平衡端子'] },
    parentId: '7946ce4b-0272-46af-9189-fe83c3398a89',
    sortOrder: 20,
    productCount: 343,
  },
  {
    id: '9fd2f989-77c8-462f-89e8-de61bb57132e',
    name: '方向燈',
    path: { raw: '燈具與電子 · 方向燈', segments: ['燈具與電子', '方向燈'] },
    parentId: '86d457f4-0bc4-4396-bc22-b9b58a436c94',
    sortOrder: 20,
    productCount: 369,
  },
  {
    id: '16c42125-3b6a-44aa-926f-e8b350db69da',
    name: '水管束環',
    path: { raw: '引擎與冷卻 · 水管束環', segments: ['引擎與冷卻', '水管束環'] },
    parentId: '8c1fc850-ccdb-4a4d-b60c-bf92c83178b7',
    sortOrder: 20,
    productCount: 690,
  },
  {
    id: '6ad532c0-ff95-49ec-9787-d408c38f1b33',
    name: '水管束環',
    path: { raw: '四輪 ATV/UTV · 水管束環', segments: ['四輪 ATV/UTV', '水管束環'] },
    parentId: '47eef157-3544-4e76-91aa-6dccafe4b0bc',
    sortOrder: 20,
    productCount: 22,
  },
  {
    id: 'f6db7d71-b594-4cb0-916e-f37c5e2e7071',
    name: '油箱罩與側蓋',
    path: { raw: '碳纖維部品 · 油箱罩與側蓋', segments: ['碳纖維部品', '油箱罩與側蓋'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 20,
    productCount: 304,
  },
  {
    id: '288a1f52-b353-4cca-ac0b-3702a0b4c275',
    name: '煞車皮',
    path: { raw: '煞車系統 · 煞車皮', segments: ['煞車系統', '煞車皮'] },
    parentId: '55e4b6bb-96d1-4722-9de6-65e5481dfa3d',
    sortOrder: 20,
    productCount: 68,
  },
  {
    id: '918ff241-d26d-4e69-ba5c-42c44232c9d3',
    name: '煞車皮(來令片)',
    path: { raw: '煞車系統 · 煞車皮(來令片)', segments: ['煞車系統', '煞車皮(來令片)'] },
    parentId: '55e4b6bb-96d1-4722-9de6-65e5481dfa3d',
    sortOrder: 20,
    productCount: 0,
  },
  {
    id: '7361c057-5242-4517-bf07-ac9f913789e2',
    name: '端子後照鏡',
    path: { raw: '外觀與後視鏡 · 端子後照鏡', segments: ['外觀與後視鏡', '端子後照鏡'] },
    parentId: 'fb3e68c3-915b-4c77-a132-bfad4e62ad56',
    sortOrder: 20,
    productCount: 656,
  },
  {
    id: 'c30c7c7f-7dc8-4349-8f8b-e4490f84fa5d',
    name: '精品螺帽',
    path: { raw: '精品螺絲與螺帽 · 精品螺帽', segments: ['精品螺絲與螺帽', '精品螺帽'] },
    parentId: 'c37e62a8-3923-4400-b0cc-3aa64c677c94',
    sortOrder: 20,
    productCount: 92,
  },
  {
    id: 'a61cb84a-91f7-4bce-838a-86a89cb1835f',
    name: '腳踏後移與傳動',
    path: { raw: '腳踏後移與傳動', segments: ['腳踏後移與傳動'] },
    parentId: null,
    sortOrder: 20,
    productCount: 0,
  },
  {
    id: 'f365c61e-1518-4ed4-9ccd-2329b1e3c5fb',
    name: '進氣上蓋',
    path: { raw: '進氣系統 · 進氣上蓋', segments: ['進氣系統', '進氣上蓋'] },
    parentId: '78d3d4af-4b84-4ff4-89a3-493dd295582a',
    sortOrder: 20,
    productCount: 65,
  },
  {
    id: '143aa463-e2ed-462f-a9bd-f7ba502e85e4',
    name: '駐車架與駐車球',
    path: { raw: '騎士用品與配件 · 駐車架與駐車球', segments: ['騎士用品與配件', '駐車架與駐車球'] },
    parentId: '12f598ce-32ac-4e5d-a6a9-261a71ec296d',
    sortOrder: 20,
    productCount: 227,
  },
  {
    id: '21ad3505-2f38-4c33-b5e3-339ae27e6784',
    name: '齒盤與傳動',
    path: { raw: '腳踏後移與傳動 · 齒盤與傳動', segments: ['腳踏後移與傳動', '齒盤與傳動'] },
    parentId: 'a61cb84a-91f7-4bce-838a-86a89cb1835f',
    sortOrder: 20,
    productCount: 143,
  },
  {
    id: '8ef2ebd1-1705-488c-a677-fbcf676783ad',
    name: '儀表與控制器',
    path: { raw: '燈具與電子 · 儀表與控制器', segments: ['燈具與電子', '儀表與控制器'] },
    parentId: '86d457f4-0bc4-4396-bc22-b9b58a436c94',
    sortOrder: 30,
    productCount: 93,
  },
  {
    id: 'f2037b58-c0bd-451d-8566-a706c6d0409b',
    name: '其他配件(待細分)',
    path: { raw: '騎士用品與配件 · 其他配件(待細分)', segments: ['騎士用品與配件', '其他配件(待細分)'] },
    parentId: '12f598ce-32ac-4e5d-a6a9-261a71ec296d',
    sortOrder: 30,
    productCount: 116,
  },
  {
    id: '14740d0f-3dfe-4079-94a9-6bfac2b3ecde',
    name: '卡鉗護蓋與散熱導風罩',
    path: { raw: '煞車系統 · 卡鉗護蓋與散熱導風罩', segments: ['煞車系統', '卡鉗護蓋與散熱導風罩'] },
    parentId: '55e4b6bb-96d1-4722-9de6-65e5481dfa3d',
    sortOrder: 30,
    productCount: 88,
  },
  {
    id: '526526d6-0d05-464e-b894-34d8a5428029',
    name: '尾殼與單座蓋',
    path: { raw: '碳纖維部品 · 尾殼與單座蓋', segments: ['碳纖維部品', '尾殼與單座蓋'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 30,
    productCount: 165,
  },
  {
    id: '7946ce4b-0272-46af-9189-fe83c3398a89',
    name: '拉桿與把手',
    path: { raw: '拉桿與把手', segments: ['拉桿與把手'] },
    parentId: null,
    sortOrder: 30,
    productCount: 0,
  },
  {
    id: '8dcffb0d-b04e-49ad-8636-bf1eea121980',
    name: '拉桿護弓',
    path: { raw: '拉桿與把手 · 拉桿護弓', segments: ['拉桿與把手', '拉桿護弓'] },
    parentId: '7946ce4b-0272-46af-9189-fe83c3398a89',
    sortOrder: 30,
    productCount: 308,
  },
  {
    id: '6048ab1e-a0ab-41f0-b6eb-4907b7996983',
    name: '油箱蓋',
    path: { raw: '外觀與後視鏡 · 油箱蓋', segments: ['外觀與後視鏡', '油箱蓋'] },
    parentId: 'fb3e68c3-915b-4c77-a132-bfad4e62ad56',
    sortOrder: 30,
    productCount: 170,
  },
  {
    id: 'f0f96c56-1d64-46ff-800c-93355b994a24',
    name: '車身保護膜(犀牛皮)',
    path: { raw: '止滑貼與保護膜 · 車身保護膜(犀牛皮)', segments: ['止滑貼與保護膜', '車身保護膜(犀牛皮)'] },
    parentId: '4bb344e0-d5c6-4044-a247-3ee776171bd9',
    sortOrder: 30,
    productCount: 507,
  },
  {
    id: '00e69ffa-3017-4100-aff1-cc5bf518b825',
    name: '輪軸防倒球',
    path: { raw: '車身防護與防摔 · 輪軸防倒球', segments: ['車身防護與防摔', '輪軸防倒球'] },
    parentId: '1bb06d28-f536-46cb-b39d-605be4f8a970',
    sortOrder: 30,
    productCount: 326,
  },
  {
    id: '3d3602d1-38b2-465d-b964-43d88bed7ae2',
    name: '進氣套件',
    path: { raw: '進氣系統 · 進氣套件', segments: ['進氣系統', '進氣套件'] },
    parentId: '78d3d4af-4b84-4ff4-89a3-493dd295582a',
    sortOrder: 30,
    productCount: 36,
  },
  {
    id: 'a516dabe-f34f-4fd4-89c4-4b133fe4ce26',
    name: '避震器',
    path: { raw: '懸吊與車架 · 避震器', segments: ['懸吊與車架', '避震器'] },
    parentId: 'd20cdc8d-e23a-422f-9b29-7ddd88e39d16',
    sortOrder: 30,
    productCount: 38,
  },
  {
    id: 'a3414e38-af11-4b18-9521-9270cd266f91',
    name: '鏈條調整器',
    path: { raw: '腳踏後移與傳動 · 鏈條調整器', segments: ['腳踏後移與傳動', '鏈條調整器'] },
    parentId: 'a61cb84a-91f7-4bce-838a-86a89cb1835f',
    sortOrder: 30,
    productCount: 115,
  },
  {
    id: '15079da8-9569-48de-8c0e-d4a346ed2d36',
    name: '離合器機構與分泵',
    path: { raw: '引擎與冷卻 · 離合器機構與分泵', segments: ['引擎與冷卻', '離合器機構與分泵'] },
    parentId: '8c1fc850-ccdb-4a4d-b60c-bf92c83178b7',
    sortOrder: 30,
    productCount: 196,
  },
  {
    id: 'f8912b6e-e0af-49c0-9551-dbccc3d2934e',
    name: '頭段與中段',
    path: { raw: '排氣系統 · 頭段與中段', segments: ['排氣系統', '頭段與中段'] },
    parentId: '551c3496-d781-45fb-925d-dbf277b06e58',
    sortOrder: 30,
    productCount: 110,
  },
  {
    id: '9109a63f-726e-4758-a102-2a47e7409777',
    name: '保護貼套裝組合',
    path: { raw: '止滑貼與保護膜 · 保護貼套裝組合', segments: ['止滑貼與保護膜', '保護貼套裝組合'] },
    parentId: '4bb344e0-d5c6-4044-a247-3ee776171bd9',
    sortOrder: 40,
    productCount: 112,
  },
  {
    id: '5f8340e4-1366-42bc-b3fe-3996e2f170ef',
    name: '土除與外觀飾蓋',
    path: { raw: '外觀與後視鏡 · 土除與外觀飾蓋', segments: ['外觀與後視鏡', '土除與外觀飾蓋'] },
    parentId: 'fb3e68c3-915b-4c77-a132-bfad4e62ad56',
    sortOrder: 40,
    productCount: 230,
  },
  {
    id: 'ed58793d-8fc7-454f-ac34-5485d38b3a88',
    name: '尾燈',
    path: { raw: '燈具與電子 · 尾燈', segments: ['燈具與電子', '尾燈'] },
    parentId: '86d457f4-0bc4-4396-bc22-b9b58a436c94',
    sortOrder: 40,
    productCount: 55,
  },
  {
    id: '55d10535-d8ea-44d9-9d9b-fbae70f37006',
    name: '把手與分離把',
    path: { raw: '拉桿與把手 · 把手與分離把', segments: ['拉桿與把手', '把手與分離把'] },
    parentId: '7946ce4b-0272-46af-9189-fe83c3398a89',
    sortOrder: 40,
    productCount: 427,
  },
  {
    id: '261a5539-5580-45f8-bf5d-b750cf480c3d',
    name: '排氣管配件',
    path: { raw: '排氣系統 · 排氣管配件', segments: ['排氣系統', '排氣管配件'] },
    parentId: '551c3496-d781-45fb-925d-dbf277b06e58',
    sortOrder: 40,
    productCount: 92,
  },
  {
    id: '551c3496-d781-45fb-925d-dbf277b06e58',
    name: '排氣系統',
    path: { raw: '排氣系統', segments: ['排氣系統'] },
    parentId: null,
    sortOrder: 40,
    productCount: 0,
  },
  {
    id: '8df20d1a-4cdd-4a0f-96e3-cf3db3e29c95',
    name: '攝影機支架',
    path: { raw: '騎士用品與配件 · 攝影機支架', segments: ['騎士用品與配件', '攝影機支架'] },
    parentId: '12f598ce-32ac-4e5d-a6a9-261a71ec296d',
    sortOrder: 40,
    productCount: 153,
  },
  {
    id: '9a23135a-7b70-4aaa-beb4-7370a9a0cee8',
    name: '整流罩與下導流',
    path: { raw: '碳纖維部品 · 整流罩與下導流', segments: ['碳纖維部品', '整流罩與下導流'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 40,
    productCount: 281,
  },
  {
    id: '6a28fbd9-0dfb-47a0-9f91-1ce95cd22624',
    name: '濾芯保養品',
    path: { raw: '進氣系統 · 濾芯保養品', segments: ['進氣系統', '濾芯保養品'] },
    parentId: '78d3d4af-4b84-4ff4-89a3-493dd295582a',
    sortOrder: 40,
    productCount: 8,
  },
  {
    id: '8877d73c-00c3-4ac3-ad62-42943e84fbd7',
    name: '煞車碟盤',
    path: { raw: '煞車系統 · 煞車碟盤', segments: ['煞車系統', '煞車碟盤'] },
    parentId: '55e4b6bb-96d1-4722-9de6-65e5481dfa3d',
    sortOrder: 40,
    productCount: 16,
  },
  {
    id: 'be826bd9-6a21-40cd-9f12-2d749ed27809',
    name: '腳踏配件',
    path: { raw: '腳踏後移與傳動 · 腳踏配件', segments: ['腳踏後移與傳動', '腳踏配件'] },
    parentId: 'a61cb84a-91f7-4bce-838a-86a89cb1835f',
    sortOrder: 40,
    productCount: 459,
  },
  {
    id: 'e2501b8b-0053-4f8c-9d8e-e5d3ac1ffacb',
    name: '車架護蓋與孔塞',
    path: { raw: '車身防護與防摔 · 車架護蓋與孔塞', segments: ['車身防護與防摔', '車架護蓋與孔塞'] },
    parentId: '1bb06d28-f536-46cb-b39d-605be4f8a970',
    sortOrder: 40,
    productCount: 171,
  },
  {
    id: '5159b2df-1b3e-4776-9636-ef1c2e54597e',
    name: '輪圈',
    path: { raw: '懸吊與車架 · 輪圈', segments: ['懸吊與車架', '輪圈'] },
    parentId: 'd20cdc8d-e23a-422f-9b29-7ddd88e39d16',
    sortOrder: 40,
    productCount: 16,
  },
  {
    id: 'bb7ddbb8-7b61-456b-a141-d1d8c4d72811',
    name: '離合器外蓋',
    path: { raw: '引擎與冷卻 · 離合器外蓋', segments: ['引擎與冷卻', '離合器外蓋'] },
    parentId: '8c1fc850-ccdb-4a4d-b60c-bf92c83178b7',
    sortOrder: 40,
    productCount: 112,
  },
  {
    id: '6790a505-cc58-4ee2-a8fd-e3d217f26a4b',
    name: '大燈與護網',
    path: { raw: '燈具與電子 · 大燈與護網', segments: ['燈具與電子', '大燈與護網'] },
    parentId: '86d457f4-0bc4-4396-bc22-b9b58a436c94',
    sortOrder: 50,
    productCount: 96,
  },
  {
    id: 'fa3aadf5-0d1c-49d0-9881-1e27be3cdbf3',
    name: '手把開關與週邊',
    path: { raw: '拉桿與把手 · 手把開關與週邊', segments: ['拉桿與把手', '手把開關與週邊'] },
    parentId: '7946ce4b-0272-46af-9189-fe83c3398a89',
    sortOrder: 50,
    productCount: 154,
  },
  {
    id: '4937fbe0-6693-45a6-9572-d9d8858891bd',
    name: '機油孔蓋',
    path: { raw: '引擎與冷卻 · 機油孔蓋', segments: ['引擎與冷卻', '機油孔蓋'] },
    parentId: '8c1fc850-ccdb-4a4d-b60c-bf92c83178b7',
    sortOrder: 50,
    productCount: 80,
  },
  {
    id: '4bb344e0-d5c6-4044-a247-3ee776171bd9',
    name: '止滑貼與保護膜',
    path: { raw: '止滑貼與保護膜', segments: ['止滑貼與保護膜'] },
    parentId: null,
    sortOrder: 50,
    productCount: 0,
  },
  {
    id: 'cb4a61a5-ab1f-4f98-8206-d56e2ddfc117',
    name: '水箱護網',
    path: { raw: '車身防護與防摔 · 水箱護網', segments: ['車身防護與防摔', '水箱護網'] },
    parentId: '1bb06d28-f536-46cb-b39d-605be4f8a970',
    sortOrder: 50,
    productCount: 228,
  },
  {
    id: '774ece40-f2e1-4a20-a9e9-37b5e0f3f875',
    name: '管束配件',
    path: { raw: '進氣系統 · 管束配件', segments: ['進氣系統', '管束配件'] },
    parentId: '78d3d4af-4b84-4ff4-89a3-493dd295582a',
    sortOrder: 50,
    productCount: 11,
  },
  {
    id: '387dd674-2a8c-411f-b51c-0a6bf93b917a',
    name: '車頭罩與大燈罩',
    path: { raw: '碳纖維部品 · 車頭罩與大燈罩', segments: ['碳纖維部品', '車頭罩與大燈罩'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 50,
    productCount: 78,
  },
  {
    id: '6e0f91bd-26b7-46f8-bdfc-0e57b33047a1',
    name: '鏈條護蓋',
    path: { raw: '腳踏後移與傳動 · 鏈條護蓋', segments: ['腳踏後移與傳動', '鏈條護蓋'] },
    parentId: 'a61cb84a-91f7-4bce-838a-86a89cb1835f',
    sortOrder: 50,
    productCount: 41,
  },
  {
    id: '96b9fde9-7c44-4a0a-b7a2-2a46ca0354be',
    name: '隔熱罩與防燙蓋',
    path: { raw: '排氣系統 · 隔熱罩與防燙蓋', segments: ['排氣系統', '隔熱罩與防燙蓋'] },
    parentId: '551c3496-d781-45fb-925d-dbf277b06e58',
    sortOrder: 50,
    productCount: 37,
  },
  {
    id: 'be42e012-375b-4355-97b0-effa6d103193',
    name: '風鏡與定風翼',
    path: { raw: '外觀與後視鏡 · 風鏡與定風翼', segments: ['外觀與後視鏡', '風鏡與定風翼'] },
    parentId: 'fb3e68c3-915b-4c77-a132-bfad4e62ad56',
    sortOrder: 50,
    productCount: 239,
  },
  {
    id: '02d57dce-0050-4352-b633-e209264b14ad',
    name: '騎士服飾',
    path: { raw: '騎士用品與配件 · 騎士服飾', segments: ['騎士用品與配件', '騎士服飾'] },
    parentId: '12f598ce-32ac-4e5d-a6a9-261a71ec296d',
    sortOrder: 50,
    productCount: 302,
  },
  {
    id: '05db0e6e-23ed-4c37-ad73-551a9bed6345',
    name: '儀表與風鏡外蓋',
    path: { raw: '碳纖維部品 · 儀表與風鏡外蓋', segments: ['碳纖維部品', '儀表與風鏡外蓋'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 60,
    productCount: 88,
  },
  {
    id: '774d6640-2db1-49a5-94cb-f5209ed86b42',
    name: '儀表護蓋',
    path: { raw: '車身防護與防摔 · 儀表護蓋', segments: ['車身防護與防摔', '儀表護蓋'] },
    parentId: '1bb06d28-f536-46cb-b39d-605be4f8a970',
    sortOrder: 60,
    productCount: 43,
  },
  {
    id: '42bff433-f871-42f9-adf2-cade1be773d7',
    name: '座椅與坐墊',
    path: { raw: '外觀與後視鏡 · 座椅與坐墊', segments: ['外觀與後視鏡', '座椅與坐墊'] },
    parentId: 'fb3e68c3-915b-4c77-a132-bfad4e62ad56',
    sortOrder: 60,
    productCount: 203,
  },
  {
    id: 'a374a31d-94b0-4518-a5c2-94c553889f7b',
    name: '引擎精品件',
    path: { raw: '引擎與冷卻 · 引擎精品件', segments: ['引擎與冷卻', '引擎精品件'] },
    parentId: '8c1fc850-ccdb-4a4d-b60c-bf92c83178b7',
    sortOrder: 60,
    productCount: 62,
  },
  {
    id: '8c1fc850-ccdb-4a4d-b60c-bf92c83178b7',
    name: '引擎與冷卻',
    path: { raw: '引擎與冷卻', segments: ['引擎與冷卻'] },
    parentId: null,
    sortOrder: 60,
    productCount: 0,
  },
  {
    id: '107257ac-deff-4dc5-a321-e56c226d7561',
    name: '精品小物',
    path: { raw: '騎士用品與配件 · 精品小物', segments: ['騎士用品與配件', '精品小物'] },
    parentId: '12f598ce-32ac-4e5d-a6a9-261a71ec296d',
    sortOrder: 60,
    productCount: 296,
  },
  {
    id: 'd9670932-8b01-4668-82e1-82f53ad73704',
    name: '觸媒轉換器',
    path: { raw: '排氣系統 · 觸媒轉換器', segments: ['排氣系統', '觸媒轉換器'] },
    parentId: '551c3496-d781-45fb-925d-dbf277b06e58',
    sortOrder: 60,
    productCount: 24,
  },
  {
    id: '78d3d4af-4b84-4ff4-89a3-493dd295582a',
    name: '進氣系統',
    path: { raw: '進氣系統', segments: ['進氣系統'] },
    parentId: null,
    sortOrder: 65,
    productCount: 0,
  },
  {
    id: 'ee8f0a46-1ba4-44cb-ae8a-be3315e6183e',
    name: '定風翼與擾流',
    path: { raw: '碳纖維部品 · 定風翼與擾流', segments: ['碳纖維部品', '定風翼與擾流'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 70,
    productCount: 52,
  },
  {
    id: '224f0849-3269-412b-a6ff-e495fcc209b1',
    name: '後照鏡蓋與配件',
    path: { raw: '外觀與後視鏡 · 後照鏡蓋與配件', segments: ['外觀與後視鏡', '後照鏡蓋與配件'] },
    parentId: 'fb3e68c3-915b-4c77-a132-bfad4e62ad56',
    sortOrder: 70,
    productCount: 23,
  },
  {
    id: '0a76a816-b4bb-438e-84b1-0544ec4278c7',
    name: '機油與濾芯',
    path: { raw: '引擎與冷卻 · 機油與濾芯', segments: ['引擎與冷卻', '機油與濾芯'] },
    parentId: '8c1fc850-ccdb-4a4d-b60c-bf92c83178b7',
    sortOrder: 70,
    productCount: 35,
  },
  {
    id: 'a6ab6ad8-1cc5-441a-a70b-c78c04bda75f',
    name: '消音塞',
    path: { raw: '排氣系統 · 消音塞', segments: ['排氣系統', '消音塞'] },
    parentId: '551c3496-d781-45fb-925d-dbf277b06e58',
    sortOrder: 70,
    productCount: 19,
  },
  {
    id: 'df54eeee-4397-4373-b839-34da30044229',
    name: '行李與包袋',
    path: { raw: '騎士用品與配件 · 行李與包袋', segments: ['騎士用品與配件', '行李與包袋'] },
    parentId: '12f598ce-32ac-4e5d-a6a9-261a71ec296d',
    sortOrder: 70,
    productCount: 118,
  },
  {
    id: '1bb06d28-f536-46cb-b39d-605be4f8a970',
    name: '車身防護與防摔',
    path: { raw: '車身防護與防摔', segments: ['車身防護與防摔'] },
    parentId: null,
    sortOrder: 70,
    productCount: 0,
  },
  {
    id: 'c37e62a8-3923-4400-b0cc-3aa64c677c94',
    name: '精品螺絲與螺帽',
    path: { raw: '精品螺絲與螺帽', segments: ['精品螺絲與螺帽'] },
    parentId: null,
    sortOrder: 80,
    productCount: 0,
  },
  {
    id: 'd36e185e-73be-41a8-b565-25010692d673',
    name: '鏈條蓋與齒盤護蓋',
    path: { raw: '碳纖維部品 · 鏈條蓋與齒盤護蓋', segments: ['碳纖維部品', '鏈條蓋與齒盤護蓋'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 80,
    productCount: 157,
  },
  {
    id: '1ef98e77-b473-4755-b47e-082d14d10d21',
    name: '引擎與排氣護蓋',
    path: { raw: '碳纖維部品 · 引擎與排氣護蓋', segments: ['碳纖維部品', '引擎與排氣護蓋'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 90,
    productCount: 239,
  },
  {
    id: '55e4b6bb-96d1-4722-9de6-65e5481dfa3d',
    name: '煞車系統',
    path: { raw: '煞車系統', segments: ['煞車系統'] },
    parentId: null,
    sortOrder: 90,
    productCount: 0,
  },
  {
    id: 'd20cdc8d-e23a-422f-9b29-7ddd88e39d16',
    name: '懸吊與車架',
    path: { raw: '懸吊與車架', segments: ['懸吊與車架'] },
    parentId: null,
    sortOrder: 100,
    productCount: 0,
  },
  {
    id: 'bd093366-ddf1-4eb3-8d6c-ae16b96470fb',
    name: '車台護蓋',
    path: { raw: '碳纖維部品 · 車台護蓋', segments: ['碳纖維部品', '車台護蓋'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 100,
    productCount: 194,
  },
  {
    id: '86d457f4-0bc4-4396-bc22-b9b58a436c94',
    name: '燈具與電子',
    path: { raw: '燈具與電子', segments: ['燈具與電子'] },
    parentId: null,
    sortOrder: 110,
    productCount: 0,
  },
  {
    id: '7639d5c1-19e4-483b-bcdb-9ed22fbd7d76',
    name: '腳踏翅膀',
    path: { raw: '碳纖維部品 · 腳踏翅膀', segments: ['碳纖維部品', '腳踏翅膀'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 110,
    productCount: 59,
  },
  {
    id: 'fb3e68c3-915b-4c77-a132-bfad4e62ad56',
    name: '外觀與後視鏡',
    path: { raw: '外觀與後視鏡', segments: ['外觀與後視鏡'] },
    parentId: null,
    sortOrder: 120,
    productCount: 0,
  },
  {
    id: '35f8b5ae-6ea7-47db-ab65-b65a212653fb',
    name: '進氣與水箱導管',
    path: { raw: '碳纖維部品 · 進氣與水箱導管', segments: ['碳纖維部品', '進氣與水箱導管'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 120,
    productCount: 110,
  },
  {
    id: '3f981d05-3571-41b9-8689-c43c31174d00',
    name: '其他碳纖維飾件',
    path: { raw: '碳纖維部品 · 其他碳纖維飾件', segments: ['碳纖維部品', '其他碳纖維飾件'] },
    parentId: '24860eb8-8321-4342-a8b1-32092499fd87',
    sortOrder: 130,
    productCount: 379,
  },
  {
    id: '12f598ce-32ac-4e5d-a6a9-261a71ec296d',
    name: '騎士用品與配件',
    path: { raw: '騎士用品與配件', segments: ['騎士用品與配件'] },
    parentId: null,
    sortOrder: 130,
    productCount: 0,
  },
  {
    id: '47eef157-3544-4e76-91aa-6dccafe4b0bc',
    name: '四輪 ATV/UTV',
    path: { raw: '四輪 ATV/UTV', segments: ['四輪 ATV/UTV'] },
    parentId: null,
    sortOrder: 140,
    productCount: 0,
  },
  {
    id: '77785fb5-ea14-4277-ba90-2ea112de64bc',
    name: '未分類',
    path: { raw: '未分類', segments: ['未分類'] },
    parentId: null,
    sortOrder: 999,
    productCount: 0,
  },
  {
    id: 'e9f18025-dbc5-4aa7-9674-d755549950da',
    name: '服務與其他',
    path: { raw: '服務與其他', segments: ['服務與其他'] },
    parentId: null,
    sortOrder: 1000,
    productCount: 1,
  },
  {
    id: '69546b21-3261-46af-817a-82d6ada92680',
    name: '維修零件',
    path: { raw: '維修零件', segments: ['維修零件'] },
    parentId: null,
    sortOrder: 1001,
    productCount: 0,
  },
];

const TREE = buildCategoryTree(SUMMARIES);
const SRC = { motoBrands: [], brands: [], categories: TREE } as unknown as Parameters<
  typeof parseSearchFacets
>[1];

/** 樹上攤平的每一個節點(大類 + 子類), 帶 `buildCategoryTree` 算出來的顯示件數。 */
const FLAT = TREE.flatMap((c) => [
  { name: c.name, count: c.count },
  ...c.children.map((s) => ({ name: s.name, count: s.count })),
]);

/** 客人打 `w` 時, 目錄樹上【可能是他要的】那些分類 —— 名字含這個詞的全部。 */
function candidates(w: string) {
  const f = foldSearchTerm(w);
  return FLAT.filter((c) => foldSearchTerm(c.name).includes(f));
}

describe('⟦search-PREFIXWRONGCAT⟧ 短詞不得落到小分類', () => {
  it('🟢 正對照:這把尺量得到東西(樹非空, 而且它是【只留有商品的】那一份)', () => {
    // 🔴 少了這一格, 樹若變成空的 ⇒ 下面每一格都紅, 看起來像規則壞了(而其實是尺壞了)。
    expect(TREE.length).toBeGreaterThan(5);
    expect(FLAT.length).toBeGreaterThan(50);
    expect(FLAT.every((c) => c.count > 0), '樹上不該有 0 件的節點').toBe(true);
  });

  it.each(['離合', '離合器', '拉桿', '管束', '濾芯', '後照', '後照鏡', '保護', '保護貼', '排氣', '排氣管', '定風', '定風翼', '碳纖', '碳纖維', '水管', '車架', '車架與', '土除', '齒盤', '服飾', '傳動', '大燈', '止滑', '外觀'])(
    '🔴 打「%s」要落到【候選裡件數最大的那個】',
    (w) => {
      const cands = candidates(w);
      // 🔵 這一格順便擋住「快照過期到這個詞已經沒有候選了」—— 那時它會紅, 而紅得對。
      expect(cands.length, `「${w}」在這份快照裡沒有任何候選分類 ⇒ 快照過期了`).toBeGreaterThan(0);
      const best = Math.max(...cands.map((c) => c.count));

      const out = parseSearchFacets(w, SRC) as { category: string | null };
      // 🔴 **兩個都要斷言**(主視窗 2026-09-04 指出):
      //    只斷言「不等於那個小的」⇒ 一個【全部回 null】的實作會通過。
      expect(out.category, `「${w}」解析不出任何分類`).not.toBeNull();
      // 🔴 用【import 進來的那個常數】切, 不要用猜的 '/' ——
      //    初版我猜 '/', 而真值是 ` · ` ⇒ 18 格紅, 而【落點其實全對】, 紅的是我的尺。
      //    📌 今天第三次:我複述了一個我可以直接 import 的東西。
      const leaf = out.category!.split(CATEGORY_URL_SEPARATOR).pop()!.trim();
      const landed = FLAT.filter((c) => c.name === leaf).map((c) => c.count);
      expect(landed.length, `落點「${leaf}」不在樹上 ⇒ 解析器回了一個目錄外的名字`).toBeGreaterThan(0);
      expect(
        Math.max(...landed),
        `「${w}」落到「${leaf}」(${Math.max(...landed)} 件), 而候選裡最大的是 ${best} 件` +
          ` —— 候選:${cands.map((c) => c.name + '(' + c.count + ')').join(' · ')}`,
      ).toBe(best);
    },
  );

  it('🔴 負對照:一個【本來就對】的詞不可以被這道閘弄紅', () => {
    // 完全相同的分類名 —— 它本來就會命中自己, 這一格若紅表示閘寫壞了。
    const out = parseSearchFacets('避震器', SRC) as { category: string | null };
    expect(out.category).not.toBeNull();
    expect(out.category!.split(CATEGORY_URL_SEPARATOR).pop()!.trim()).toBe('避震器');
  });

  it('🔴 負對照:掰一個詞要回 null(證明上面那些非 null 不是恆真)', () => {
    const out = parseSearchFacets('zzqprbxx9999', SRC) as { category: string | null };
    expect(out.category).toBeNull();
  });
});
