# 跨專案 Plan:報價單源頭變體模型統一修正(#267)

> **狀態**:🎯 **Q 線(報價單側)全部完成(2026-07-04)**。批准記錄:D1-D3 全 A + Q-go=A(遷移真跑)+ Q-fetcher=A(驗證跑)+ **最終通則兩輪確認:CNC 同 var_code=同一顆實體料、名稱差異=應用情境非不同商品 →「同碼一律併」**。
> **Q 線成果(報價單 repo main、5 commit 未 push)**:Q1 合約引擎 `ed00561` / Q2 CNC 合併+名稱閘 `2ecc9b0` / Q3 三家補值 `63ae109` / 名稱閘降級(通則)`72e0527` / Q5 規範落地 `eeb34d8`。**DB 遷移兩輪落地**:R1=43 聚合(backup `zz_backup_variant_merge_20260704` 106 列)+ fetcher 生產自併 9 組(Sean 逐一確認同料、翻譯搬 9/9)+ R2=88 聚合+24 殘影(backup `zz_backup_variant_merge_r2_20260704` 207 列)→ **CNC 4549→4376 列、「同 group 同 spec 同價多列」歸零、139 聚合全收斂、與 fetcher 行為 100% 對齊、launchd 冪等安全**(CNC fetcher 生產實跑驗證過)。防復發:合約 R1-R3 pytest gate + onboarding ③段第4點 + CLAUDE.md 路由行。
> **fetcher 落地驗收(2026-07-04、Sean 終端機跑四家)**:bonamici/materya/cncracing 合約掃描 **0 違規**(目標 12 群歸零)、CNC 冪等(4376 列不變、CA210 10 色 sku=var_code 完好、4 delisted 均為 6 月既有且 stock 已標缺貨);eazigrip 目標 4 群已修、但掃描曝光存量債 137 筆 + lightech 39 筆(feed 重複 SKU/主列空 spec/color:null 三型、全 active 非殘影)→ **#268**(兩家非近程上架線、不擋試點;掃描 gate 信噪比是主要痛點)。
> **W 線完成(2026-07-04、網站側)**:
>
> - **W1 ✅**(commit `075b3ce`):重乾跑 bonamici(pv_spec 碰撞 **3→0**、源頭補值生效)/gbracing(零回歸、handle 25 筆=#266 已知)/rpm(全零 delta、1117 群/8983 變體=P0-D 基線);cncracing 登記 supplier-config **僅乾跑**(brandSlug=cnc-racing MCP 查證)→ 首乾跑全 gate 綠(1978 群/4376 變體、11 分類全對上、0 碰撞)= #267 原始病灶(63 群碰撞 abort)確認歸零。
> - **W2 ✅**:ProductInfo 選擇器泛化 — spec 含 weave/finish/special=RPM 形狀走現行合成維(**輸出 byte 不變、12 舊測一字未動全綠**);否則泛型維(spec key 資料驅動、GENERIC_DIM_LABEL、值原字、序=首見序);SwatchPreview 非 RPM 降級不渲染。雙審:code-reviewer(manifest 補 genericSpecDimFallback)+ adversarial opus(F1 泛型空值濾除已修/F2 magic-key 嗅探=源頭治理:報價單 onboarding 列 weave/finish/special 為 RPM 保留字)。**hex_color 真色塊不在 W2**(需 metadata 三層鏈路、獨立後續工作、見 #265)。
> - **W3 ✅**:變體圖修復 — 根因=view images 欄**兩形狀並存**(rpm=[{url}] 群圖池物件陣列;bonamici/cncracing=**純字串陣列且 per-variant**)+ RPM sku 前綴過濾對非 RPM 檔名永遠 miss(sku 後跟 / . _ 非 '-')→ 變體圖全空=選色不換圖。修:supplier-config 加 `variantImages` 策略欄('sku-prefix-pool'=rpm byte 錨/'per-variant'=非 RPM 直用該列圖)+ mapImages 兼容兩形狀。驗:bonamici 乾跑 images:[] **歸零**、每變體帶自己的圖;rpm 乾跑全零 delta;資料面 bonamici 1710/1710、CNC 4376/4376 變體 images 非空(MCP 統計)。
> - **W 線觀察項**:①CNC 圖池混鄰色情境照(首張 variante/ 乾淨、quote 站同樣呈現;要更純需 CNC-specific 過濾、#212 品牌客製再議)②delisted_at 與 is_listed 語意脫鉤(27 筆 delisted 仍 is_listed=true 流進 view;stock_status 全已標缺貨、網站顯示缺貨傷害有限;rpm 0 筆;Phase 3 寫入前決定 view 是否排除)③非 RPM 泛型值未譯(eazigrip 英文值)留內容輪。
>
> **原始批准記錄**:v1(2026-07-04 Sean:批准開工 + D1=A 治本合併 + D2=A 代表 SKU=COD_COLORE + D3=A zz_backup+模擬→點頭→真跑)
> **拍板依據**(2026-07-04 Sean):Q1=A 源頭統一修;CA210 型 = 一商品多變體(顏色/特仕版=變體、車型=fitments 聯集);報價單合併顯示保留;Fable 領頭多代理、本 session 跨兩專案執行。
> **兩專案**:報價單 `PCM報價單-V2`(`/Users/sean_1/API大量上架/PCM報價單-V2`、branch main、Python fetcher + Next.js quote 站)+ 網站 `pcm-website-v2`(本 repo)。
> **情報來源**:7 路唯讀偵察(2026-07-04、cnc-fetcher/pilot-fetchers/quote-consumers/site-variant-images/daily-sync/blindspot-critic/quote-rules)+ 主對話 MCP 唯讀 DB 驗證。原始輸出:session scratchpad `recon-*.md`。

---

## 1. 問題與根因(已驗證)

**症狀**:11 家供應商中 4 家、75 群「spec 無法區分變體」碰撞(cncracing 63 / materya 5 / eazigrip 4 / bonamici 3);網站 `pv_spec_unique` 會擋整批寫入。rpm/lightech/samco(最大三家多變體)0 碰撞 = 源頭做得到。

**根因 A — fitment-as-axis(cncracing 56/63 群)**:CNC 官方 CSV 把同一實體零件按車型段拆 CODICE(`CA210_01`=Panigale V4 / `_02`=Streetfighter V4 / `_03`=Diavel V4),fetcher 每 CSV 列原樣寫一 DB 列(`sku = CODICE-COD_COLORE`,`cncracing_csv.py:351`),spec 只存 color(`decode_color` 人工色碼字典)→ 同色跨車型段 = 多列同 spec。群組鍵 `group_code='CA210'` 由 `merge_code()` 剝段產生(`cncracing_codes.py:71-72`)——**Sean 的合併意圖已有結構,缺的是「同色跨段聚合 + fitment 聯集」**。已驗:同色跨段**全同價**(139 可合併群、價格衝突 0)、每列 fitment 只含該段車型(2~6 筆)。

**根因 B — spec 值缺漏/壓縮(bonamici/eazigrip/materya + cnc 其餘 7 群)**:
- bonamici:spec 唯一來源 = 官方 xlsx「ITEM CODE」精準比對(`bonamici.py:1006-1032`);**現成的尾碼色碼字典 `_COLOR_SUFFIX_MAP`(:548-552)從未接進 spec fallback** → CHAD18 全 null、PU_001 8 色全同值(xlsx 真值需實抓分辨:源頭同值 vs first-seen-wins 去重誤併 `:897`)。
- eazigrip:CENTREPAD design 判斷「various design」字串短路**優先於** Design A-H 正則(`eazigrip_codes.py:69` vs `:72-74`);DASHKTM 母碼 hardcode pack="1"(`:97`)與 `-1` 尾碼正則(`:92-94`)必然撞值=純邏輯 bug(不需實抓即可定案)。
- materya:spec 唯一來源 = WC Store API `variation` 字串(`materya.py:337-343`),空則 `{}`,**無 SKU 尾碼 fallback**(C/N 尾碼分不出)。
- **機器判別規則(已全量驗)**:同 group 同 spec **同價** = A 類(可合併);**不同價** = B 類(spec 缺軸、必須補值,不可合併)——eazigrip 3 群+materya 3 群屬後者。

**鎖列現況(2026-07-04 MCP 驗)**:cncracing 4549 列全 translation_locked、**1381 列 manually_corrected**(CA210 30 列全帶鎖);bonamici mc=0/tl=1709;eazigrip mc=866;materya mc=8。→ fetcher 的 delete 護欄會跳過保護列,**「改 SKU 靠自然汰換」不可行**(舊列變孤兒),存量必須一次性遷移。

**環境事實**:storefront_catalog_v 已用 group_code 分群(S4 migration 已 apply、MCP 驗 `view_uses_group_code=true`);4 家 group_code 零 null;quote 站前端與 fetcher 同 repo;quote 站 `getVariants()` 前端已按 var_code 去重(UI 早就顯示 10 變體);報價快照凍結(歷史報價安全);CNC/試點兩家**均未上架網站**(external_id 變動零死鏈包袱)——**修源頭的時機正好在 Phase 1 寫入之前,晚了就有包袱**。

---

## 2. 統一變體合約(規範核心、防復發)

> 落地形式:報價單 repo pytest 合約測試(CI-gated)+ CLAUDE.md 路由行 + 網站端既有 preflight 兜底。**不是文字規範,是可執行測試**(blindspot #10)。

- **R1 spec 完整性**:每列 `raw_jsonb.spec` 恆為非空物件、值非 null;無真變體軸的單變體商品 = `{}` 允許(單列群)。多變體群內 spec 必能唯一區分每個「購買選項」。
- **R2 合併律(A 類)**:同 `group_code` 內同 spec 的多列,語意 = 同一變體的多車型鏡像 → **必同價**(pytest assert),fetcher 層合併為單列:fitment_parsed 聯集、images 聯集、價格取代表(斷言同值)、代表列選 manually_corrected 優先。
- **R3 補軸律(B 類)**:同 group 同 spec **不同價** = spec 缺軸,禁止合併,fetcher 必須補真值軸(色碼字典 fallback / 來源欄位 / pack 邏輯修正)。CI 擋:合約測試掃 fetcher 輸出,同 spec 不同價 → 紅。
- **R4 新家上線 gate**:新 fetcher 併入前必過 R1-R3 合約測試(pytest 參數化、每家跑)。

---

## 3. 修正架構(兩層 × 4 家)

**層 1 — fetcher(未來寫入,持續正確)**:
| 家 | 改法 | 錨點 |
|---|---|---|
| cncracing | build_rows 前按 `(merge_code, COD_COLORE)` 分組、聯集 MARCA_MODELLO → 每組一列(cnc-fetcher 偵察推薦切入點 A;聯集必在 `dedupe_rows` 之前,`base.py:117` 只留首筆會靜默丟 fitment);緊固件例外(merge_code 回完整碼)自動保護不誤併 | `cncracing_csv.py:503-524` |
| bonamici | `_COLOR_SUFFIX_MAP` 接進 spec.color fallback + xlsx 實抓驗證 PU_001/CHAD18 根因(同值 vs 去重誤併,修法對應) | `bonamici.py:1006-1091` |
| eazigrip | CENTREPAD:Design A-H 正則優先、"various" 短路降為 fallback(或改讀 WC attributes、實抓定案);DASHKTM:母碼 pack 改為可區分值(如省 key vs "1"×N) | `eazigrip_codes.py:67-97` |
| materya | SKU 尾碼 fallback 補 spec(C/N 等)+ WC API variation 實抓確認 | `materya.py:337-343` |

**層 2 — 存量一次性遷移(migration SQL、報價單側)**:
- 對 A 類群:代表列選定(manually_corrected 優先 → 最早 created_at)、`UPDATE 代表列 SET fitment_parsed=聯集, images=聯集, sku=新代表碼`、`DELETE` 冗餘列。
- **安全程序**(報價單鐵則 11/12 + 本 repo 慣例):先建 `zz_backup_variant_merge_20260704` 備份表(repo 有 zz_backup 前例)→ BEGIN 交易模擬(逐群驗聯集完整、價格斷言、鎖列內容保留)→ ROLLBACK 報告交 Sean → Sean 點頭才真跑。
- B 類 6 群不遷移,由 fetcher 補值後自然更新(upsert 護欄對鎖列的行為,實作片先讀 `base.py` fetch_protected_skus/backfill 確認,fail-closed:鎖列的 spec 補值若被護欄擋,列入遷移 SQL 一併處理)。

**代表 SKU 命名(D2=A 已拍、預檢已過)**:合併列新 sku = `var_code`(=COD_COLORE,如 `CA210B`)。**2026-07-04 MCP 預檢全綠**:可合併 (group,spec) 聚合、每聚合恰 1 個 var_code(n_var>1=0)、新 sku 與 cncracing 全廠既有 sku 零撞、零跨群(118 個跨群 var_code 全在緊固件等不合併群、與合併範圍零交集)→ 無需 fallback,未合併列 sku 原樣不動。**Bonus**:raw_jsonb 有 `hex_color`(CNC 官方色碼 hex)→ W2 網站選色 UI 可做真色塊(SwatchPreview 非 RPM 降級素材)。

**🔴 名稱等價閘(Q2 執行中新增、主對話 DB 人工分類實證)**:139 個同 spec 同價聚合中 **7 個聚合是「不同商品恰好同群同色同價」**——PEA01/04/05/08(騎士腳踏 vs 乘客腳踏、各 1 聚合)+ TF253(後煞車油壺蓋 vs 離合器油壺蓋、3 色=3 聚合)——合併前必過第三道閘:組內英文 product_name 剝除全組 fitment 車輛 token+連接詞後殘句全等才併(CA210 車型尾巴/DP009 XDiavel-Diavel/DP021 跨品牌=放行;PEA/TF253=擋下)。已實作進 Q2(commit 2ecc9b0、對抗審 F1-F4 折入、726 tests)。**Q4 遷移口徑同步修正:合併 132 聚合(非 139)、298 列→132 列(刪 166)、65 聚合含 manually_corrected(代表列 mc 優先)、var_code 歧義 0**。被擋 7 聚合 = spec 缺「部位」軸(driver/passenger、brake/clutch),記 CNC 補軸待辦(Phase 3 放量前、網站上架 CNC 前必處理)。**部署 gate:Q4 存量 re-key 遷移完成前不得跑 cncracing fetcher(launchd 週日 17:00);對抗審 F1 實錘:直接跑會使 312 鎖列被軟下架、人工校正靜默作廢。**

---

## 4. 切片(報價單側 Q1-Q5 → 網站側 W1-W3)

| 片 | 內容 | 驗證 |
|---|---|---|
| Q1 | pytest 變體合約測試地基(R1-R4、參數化 11 家、先紅) | `uv run pytest` 新測試對現況紅=抓到 75 群 |
| Q2 | cncracing fetcher 合併(層1)+ 乾跑 diff 報告 | 合約測試綠 + 乾跑輸出 30→10 型抽驗(CA210 等)+ 306 既有測試綠 + ruff/mypy |
| Q3 | bonamici + eazigrip + materya fetcher 補值(層1;xlsx/WC 實抓定案) | 合約測試綠 + 各家乾跑抽驗 |
| Q4 | 存量遷移 migration(層2:zz_backup → 交易模擬 → 報告 → Sean 點頭 → 真跑) | 模擬報告逐群斷言;真跑後 MCP 驗碰撞歸零 + quote 站零回歸 8 條清單(§6) |
| Q5 | 規範落地:報價單 CLAUDE.md 路由行 + 合約測試進 CI + 手動觸發 4 家 fetcher 重跑驗證 | fetcher 跑後 DB 碰撞維持 0(冪等) |
| W1 | 網站重乾跑 bonamici/gbracing(+cncracing 登記 supplier-config 僅乾跑驗證、不寫入) | spec 碰撞 0/pv_spec preflight 過;RPM byte 不變(golden 測試) |
| W2 | #265 選擇器泛化 + ProductSwatchPreview 非 RPM 降級(圖片連動 UI 端;ProductGallery 免改——偵察證已通用) | 完整 vitest + RPM byte 不變 |
| W3 | 變體圖驗證:非 RPM `ownVariantImages` 前綴規則 vs 實際圖 URL 檔名比對,不匹配則調整過濾邏輯(資料端保證每色 images 非空) | 乾跑抽驗每色變體 images 非空且對色 |

順序:Q1→Q2→Q3(可並行)→Q4(Sean gate)→Q5;W1-W3 在 Q 線完成後、Phase 1 試點寫入前。網站每日排程只跑 rpm、試點手動 → **中間態無網站風險**(quote 站變化即所見)。

## 5. Sean 四注意點答案

1. **變體圖點擊連動**:機制已通用(`ProductGallery` 吃 `selectedVariant.images` 排最前、與 spec 形狀無關)→ 缺的是 ①#265 選擇器泛化(W2)②每色變體 images 非空且對色(W3 資料驗證)。可做到。
2. **quote 站零影響**:底層列合併後——功能不變(搜尋車款靠 fitment 聯集、展開明細本就前端去重、歷史報價快照凍結);**顯示數字會變**:主行「變體 30」→「變體 10」、CSV 匯出列數減少(→ D1 確認)。零回歸驗證 8 條清單見 §6。
3. **防復發規範**:pytest 合約測試(R1-R4)CI-gated + 報價單 CLAUDE.md 路由行「新增 fetcher → 先讀變體合約」;網站端 pv_spec preflight 繼續當最後兜底。**測試是規範、文字只是指路**。
4. **每日新品自動上架**:網站排程現只跑 rpm(`rpm-sync.yml` 單 step);新品路徑本身全自動(upsert 新 external_id + delisted_at=null 即上架),但 gate 全是**整批 abort**(一群髒→當天整家全卡)→ 源頭合約測試把髒資料擋在報價單側,網站 gate 變成純保險絲。試點兩家排入每日 cron = Phase 1 收尾項(加 `--supplier` step + #261 category gate 補上 + 告警升級 LINE 從 GHA email)。

## 6. 風險 / Rollback / 零回歸驗證

**風險與對策**:鎖列孤兒(→ 層2 遷移代替自然汰換、manually_corrected 內容優先保留)/ fitment 聯集不完整 → quote 站車款搜尋塌陷(→ 遷移斷言「合併後 fitment = 合併前聯集、一台不掉」+ 8 條清單)/ 同 spec 不同價誤併(→ R2 同價 assert,衝突即紅)/ dedupe_rows 靜默丟列(→ 聯集在 dedupe 前 + 測試)/ view CASE 與 compute_group_code 鏡像漂移(→ 本輪不動 grouping 語意、只動列粒度;漂移風險註記 backlog)/ 報價單 repo working tree 有既有未收拾檔(→ 精準 add、不碰 `.command`/archive)。

**Rollback**:fetcher 改動 = git revert(下次跑自動回舊粒度、upsert 冪等);遷移 = `zz_backup_variant_merge_20260704` 整表還原 SQL(遷移檔內附)。網站側 W 線全在試點寫入前、git revert 即可。

**quote 站零回歸 8 條**(Q4 真跑後執行):①`product_groups_v` 新舊 FULL OUTER JOIN 逐欄 `IS DISTINCT FROM`,盯 `vehicles/search_vehicles/search_models/all_models` mismatch=0(variant_count 變動=預期)②合併列 fitment=合併前聯集斷言 ③已知跨車型料號前端搜尋「適用 N 款車」不變 ④被合併車型 model 篩選仍中 ⑤變體明細面板色數不變 ⑥`product_groups_mv` REFRESH 正常 ⑦網站 rpm-fetch 乾跑契約不變(RPM byte)⑧CSV 匯出列數變化 = 預期清單。

## 7. 決策題(批 plan 時一併回)

- **D1 quote 站顯示變化**:合併後主行「變體 30→10」、CSV 匯出列數減少(功能/明細/歷史報價不變)。A=接受(推薦、正是「一商品多版本」的形狀)/ B=不接受(退回 view 層聚合、源頭維持 30 列、規範難落地)
- **D2 合併代表 SKU**:A=`COD_COLORE`(CA210B;quote UI SKU 欄現顯此值、官方色碼;唯一性預檢+撞則 fallback)(推薦)/ B=保留首列完整 SKU(CA210_01-CA210B;穩定但含車型段字樣、與「車型=fitment」語意矛盾)
- **D3 存量遷移方式**:A=zz_backup + 交易模擬報告 → 你點頭 → 真跑(推薦;刪冗餘列有備份可整表還原)/ B=軟合併先行(冗餘列先 delist 觀察一週再刪;較慢、quote 站會暫顯 delisted 列殘影)

— 批准 + D1-D3 後開工:Q1 起,每片獨立 commit(報價單 repo 慣例:繁中 ≤72、main 單分支、uv run pytest/ruff/mypy 全綠)+ 雙審。
