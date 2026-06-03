# 購物網站「結構化商品內容模型」設計建議草案

> **狀態**:🟡 草案、核心方向已與 Sean 討論拍板、**未實作**。
> **產出者**:網站 repo 審查 session(2026-06-03、寫審分離 ROLE=A)。
> **用途**:① 給 Sean 過目;② 交**報價單 session** 當 PRD 起點(報價單側動 schema=鐵則 8、內容=鐵則 9 L3)。
> **範圍**:報價單 B 庫(`pcm-quote-v2`/`dllwkkfanaebrsuyuedy`,內容唯一真相)+ 購物網站(`pcm-website-v2`/`bmpnplmnldofgaohnaok`,前台門面)。
> **關聯**:backlog #209(本草案升級它)、memory `tw-marketplace-copy-conventions`、`quote-website-integration-phase1`。

---

## ✅ 已拍板決策(2026-06-03 與 Sean 討論)

1. **路線 = 結構化賣場內容生成,非 prose 翻譯**。理由:賣場文案要的是「消四怕的硬資訊」,不是漂亮翻譯;且原文有 bug(見下)、5 家無原文,純翻譯走不通。
2. **🔴 車種正確性鐵律**:AI 生成文案**完全不碰車種**;車款/年式/廠牌 100% 走報價單已校正的車款表(`fitment_parsed`)直出。標題可提一個主車型(SEO),完整適用清單一律靠「適用車款表」。(Sean 拍 A)
3. **適用車款表絕對強制**:每個商品都顯示車款區塊;DB 無車款資料的(極少)也顯示「適用車款請 LINE 詢問」兜底。(Sean 拍 B)
4. **文案末尾標準句**:`✅ 完整適用車款與年式,請見上方「適用車款」對照表,或 LINE 聯繫詢問`。
5. **動態狀態(現貨/預購/工期)不每件硬填**:用品牌通則(預購約 2–6 週)+ 「以詢問時為準」+ LINE 兜底;只標少數現貨例外。
6. **pilot 先做 RPM**(原文 100% 在手、料最齊);其他 5 家補原文是平行工程。
7. **做成 PCM 專屬 skill**(封裝賣場規則 + 品牌通則 + 濾 bug),不靠外面現成 skill。

**尚待 Sean 最終拍**:① pilot→skill 的正式啟動時機(再多 pilot 幾件 vs 直接做 skill)② 品牌故事(brand_story)第一版要不要納入 ③ 其他 5 家「爬官網補原文」何時排入(報價單側)。

---

## 1. 現況資料流地圖

```
9 家供應商爬蟲（Python，/Users/sean_1/API大量上架/PCM報價單-V2/fetchers/，launchd 排程）
   ▼ 每天自動抓
報價單 B 庫 products（16,361 列：rpm 9124 / eazigrip 5188 / gbracing 939 / motogadget 917 / front3d 105 / materya 88）
   ├ product_name_zh ……… ✅ ~100% 已翻
   ├ category_zh ………… ◐ 部分（rpm 無、eazigrip/materya 有）
   ├ description_zh …… ❌ 6 家全 0（AI 翻譯腳本存在但 run_pipeline.py 傳 claude=None、從沒跑）
   ├ description_origin … ✅ RPM 100%（平均 760 字、從 RPM Shopify 抓）／❌ 其他 5 家 0
   ├ spec(jsonb) ……… ◐ rpm=weave+finish 100%；其他家部分（lib/product_spec.py 各家組裝、英文短碼）
   ├ fitment_parsed …… ✅ 經 /audit 多重校正 + manually_corrected 鎖（= 全公司最可信車種來源）
   └ 🔒 translation_locked / manually_corrected … ✅ 人工值爬蟲重跑不覆蓋（fetchers/base.py supabase_upsert_respect_protected）
   ▼ S0 view storefront_catalog_v（21 欄、零敏感；含 zh名/zh分類/spec；⚠️ description 未投射 description_origin）
   ▼ rpm-import 每天批次（網站 scripts/rpm-*.ts；目前只撈 RPM）
購物網站庫 products(1,123、全 RPM)+ variants
   ├ title=中文部位詞 ✅ / subtitle=「車型 · 碳纖維」✅ / spec→變體層 ✅
   └ description=舊933英文 / 新190空 ❌
   ▼
前台 ProductTabs：介紹=碳纖維通用 placeholder ❌ / 規格=「真碳/泰國/紋路」RPM 寫死 ❌（OD-8 已去鋁合金）/ 保固=共用 rpm-policies ✅
適用車款表 ProductFitments(OD-12)：✅ DB fitment_parsed 直出、分組顯示廠牌/車款/年式
```

## 2. 重大發現:骨架大半已就緒

| 原以為要做 | 實際現況 |
|---|---|
| 中文名/分類欄 | 已存在、已翻、已上線網站 title |
| 規格彈性袋 | `spec` jsonb 已存在、已流到網站變體層 |
| 人工填不被爬蟲覆蓋 | `translation_locked`/`manually_corrected` 已運作 |
| 報價單編輯介面 | Next.js dashboard 已有 /translations、/audit |
| 英文原文(以為要爬官網) | **RPM 爬蟲早抓了**、100% 在 `description_origin`(只是 view 沒投射) |
| 適用車款強制顯示 | OD-12 適用車款表已對每件 DB 直出 |

→ 工作從「鐵則 8 全新 schema」降級為「補 2-3 欄/表 + 填內容 + 接線去 RPM 化」。

## 3. 精確缺口

- **A 賣場描述**:`description_zh` 全空;RPM 有英文原文可當素材(但有 bug、需結構化改寫),其他 5 家無原文(需爬官網補)。`/translations` 無 description 編輯欄。
- **B spec 太薄**:只有物理屬性(紋路/表面);缺乾式開模製程、抗UV、孔位直上、工期、保固例外、產地。
- **C 品牌故事**:`suppliers` 表無行銷文案欄。
- **D 去 RPM 化**:ProductTabs 寫死「真碳/泰國/紋路」,多品牌要改吃真欄位;網站現只 RPM。

## 4. 🔴 車種正確性鐵律(本案最重要原則)

**背景**:RPM 原文車種**經常寫錯**——實證 bug:① 「OEM **BMW** Carbon」出現在 Aprilia/Suzuki 商品(複製貼上、成百上千件)② 年份自己打架(同件 2009-2018 vs 2019)③ product_name 是 Radiator Guard 但描述寫 Front Fender(名稱≠描述)。Sean 在報價單側對車種做了多重認證校正(`/audit` + `fitment_parsed` + `manually_corrected`)。

**鐵律**:
```
文案內文（AI 生成）   → 只講「功能 / 工藝 / 賣點」，可參考原文
                        ❌ 不准列車種清單、不准寫年份（AI 不碰車種 = 永遠不會寫錯車種）
                        ✅ 末尾固定句指向車款表 + LINE

適用車款（DB 直出）   → 100% 來自校正過的 fitment_parsed
                        ✅ 精確含年份、逐筆人工核對、絕對強制（無資料顯示「LINE 詢問」）
```

**車款三層呈現**(現況已具備):① 副標題主車型(SEO/第一眼)② 適用車款表(OD-12、強制、DB 直出)③ 文案內文不碰車種。

## 5. 三層內容模型

| 層 | 性質 | 存哪(B 庫) |
|---|---|---|
| ① 共通決策欄 | 所有品牌都有、穩定 | products typed 欄(產地 / 工期通則 / 直上與否) |
| ② 品牌特有規格 | 隨品牌長 | `spec` jsonb 擴 key(製程等級 / 抗UV / 紋路…)+ 商品標 `panel_type` |
| ③ 品牌級內容 | 同品牌共用 | `suppliers` 加欄(brand_story / craft_note / trust_badges) |

**動態狀態(現貨/預購/工期)**:不每件填;品牌通則 + 「以詢問為準」+ LINE 兜底。

## 6. 內容怎麼填(對應「牽扯爬蟲」顧慮)

| 內容 | 來源 | 機制 |
|---|---|---|
| 名/分類/物理 spec | 爬蟲自動 | 已運作 |
| 賣場描述/製程/抗UV/品牌故事 | AI 生成 + 人工校 | 填欄 → `translation_locked=true` 鎖 → 爬蟲不覆蓋(機制已存在) |
| 車種/年式 | DB fitment_parsed | 鐵律:AI 不碰 |

**🐛 bug 濾除**:結構化生成時,工藝/功能吸收原文,但**車種一律用 DB 校正值**,並濾掉 BMW 複製貼上、年份打架等原文錯誤。

## 7. Pilot 範例(2026-06-03 網站審查 session 手做、原文+DB 事實驗證;= skill 的目標產出樣板)

三件皆套用車種鐵律(標題提主車型、內文不碰車種年份、末尾固定句指向車款表)。

**① 車台護蓋(Aprilia)** — 原文普通+BMW bug → 濾 bug、補消四怕:
> **Aprilia RSV4｜碳纖維車台護蓋**
> 專為車台側面打造的碳纖維護蓋,真碳開模、非貼皮仿碳。原廠側蓋是塑件,跑山或進場磕碰易刮花;換上真碳護蓋把車側質感拉起來,碳纖比塑件更輕更耐刮,紋路在陽光下透層次,不是貼皮那種死板假紋。
> - 真碳非貼皮:乾式開模真碳(DryCarbon)+ 抗UV處理,不易發黃
> - 直上免改:對應原廠孔位、鎖點一致,不需改線組或鑽孔(建議交技師對角分段鎖緊)
> - 四款紋路 × 兩款表面:斜紋/平織/鍛造/蜂巢 × 亮光/消光(消光蜂巢特殊訂製、工期較長)
> - ✅ 完整適用車款與年式,請見上方「適用車款」對照表,或 LINE 聯繫詢問
> - 預購品,工期約 2–6 週,實際以詢問為準

**② 加大油箱罩(BMW S1000RR)** — 原文有真功能 → 賣點放大,不只講好看:
> **BMW S1000RR｜碳纖維加大油箱罩(WSBK 賽車型)**
> 賽道導向的碳纖維油箱罩,箱身加高收窄,重煞時大腿能更穩地夾住油箱,激烈操駕特別有感。乾式真碳開模、對應原廠孔位直接替換。
> - 賽道夾持設計 ・ 乾式真碳+抗UV不發黃 ・ 直上免改 ・ 紋路表面可選
> - ✅ 完整適用車款與年式,請見上方「適用車款」對照表,或 LINE 聯繫詢問
> - 預購品,工期約 2–6 週

**③ 油冷排前飾蓋(Yamaha R1)** — 原文有安裝依賴 → 改寫成「購買前必看」消「裝不上」:
> **Yamaha R1｜碳纖維油冷排前飾蓋(V 字三角盾)**
> ⚠️ **購買前必看**:這片的作用是把側整流罩下緣與車底銜接起來。若你裝的是 RPM 的 R1 碳纖維側整流罩,會需要這片來收尾;單買請先確認需求,不確定就 LINE 問。
> - 乾式真碳+抗UV ・ 對應原廠孔位 ・ 紋路表面可選
> - ✅ 完整適用車款與年式,請見上方「適用車款」對照表,或 LINE 聯繫詢問
> - 預購品,工期約 2–6 週

三件共證:不同類型/車款/料量都接得住;原文越多 bug(BMW複製貼上/年份打架/名稱≠描述),越證明要結構化生成而非直翻。skill 應把這三件當「目標品質樣板 + 風格基準」。

## 8. 撈到網站 + 前台接線

- view 加投射 description_zh/summary_zh/新欄 + suppliers join。
- `rpm-import`(rpm-transform.ts)map 新欄。
- ProductTabs 去 RPM 化:介紹吃 description_zh、規格吃 spec+產地欄+panel_type 模板。
- 保固已是共用 rpm-policies(不動)。

## 9. 分階段 + 影響面

**階段**:① RPM pilot 跑通整鏈(生成→校→鎖→撈→前台)② 報價單側 schema 落地(欄/spec/suppliers/translations UI/生成腳本)③ 網站去 RPM 化 ④ 放量 RPM → 多品牌。

**報價單側(報價單 session)**:migration 加欄 + spec 擴 key + suppliers 加欄 + /translations 加 description 編輯 + 生成 skill + fetcher 補爬其他家原文 + view 投射。
**網站側(執行 session、我審)**:rpm-transform map 新欄 + ProductTabs 去 RPM 化 + 對齊 tw-marketplace 官網模板。

## 10. 其他 5 家補原文(平行工程)

5 家爬蟲已每天在跑(抓名/價/規格/圖),**加抓 description 即可**(非從零建)。⚠️ 各家網站可爬性不同(有些 B2B 站描述簡略)→ 報價單側逐家評估。**與 RPM pilot 解耦、不互卡**。

## 11. 注意事項

- L3 內容(賣場文案=週多次)→ 報價單側必後台 CRUD。
- GEO/SEO:描述前 1-2 句自包含事實句、每件獨一無二禁照抄、SSR 出原始 HTML、Product/FAQPage schema。
- rpm-import 單向(B庫→網站),人工內容鎖在 B 庫源頭、不被覆寫。

---

_(草案更新於 2026-06-03 討論後。待 Sean 拍 §0 三個尾項 → 交報價單 session 開 PRD。)_
