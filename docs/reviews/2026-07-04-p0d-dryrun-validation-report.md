# P0-D 試點乾跑驗證報告 — gbracing / bonamici

> **交付對象**:Sean(Phase 1 試點寫入前的 go/no-go 依據)
> **一句話結論**:gbracing + bonamici 去碳管線端到端**乾跑通過**,分類 100% 對上(P0-B seed live 後)、副標全量零「碳纖維」命中、價格全整數零異常、經銷價零外洩、首載零誤刪;**唯二 Phase 1 寫入前必處置** = ① gbracing 25 筆 handle charset(小數點/空格/斜線)② bonamici spec 碰撞 3 群(C3)。RPM **全量**零回歸(1117 群/8983 變體 price delta=0、下架 0、副標唯一授權偏離「碳纖維部品」如預期)。
> **性質**:100% 唯讀、零 DB 寫入、零 migration、零 schema。金流 flag 全 false。
> **真權威 plan**:`docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md` §4 P0-D。

---

## 1. 執行環境與唯讀證明

- **執行命令**(全量、無 `--confirm-write`):

  ```bash
  pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=gbracing
  pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=bonamici
  pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=rpm            # RPM 全量零回歸對照(1117 群/8983 變體)
  ```

- **來源**:報價單 B 庫 `dllwkkfanaebrsuyuedy` 乾淨公開 view `storefront_catalog_v`(anon publishable key、物理無 cost/蝦皮/經銷欄)。
- **唯讀保證**:`--dry-run` 分支在任何 upsert 前 `return`(`rpm-import.ts:234-252`);target client 僅做讀查(resolveId / handle preflight / spec preflight / delta 全 SELECT)。乾跑全 **exit=0**,無寫入路徑觸及。缺圖/fitment/描述非空/碳纖維全量掃描等統計,另由兩支臨時唯讀腳本(重用生產 `transformGroup`/`transformVariant` 函式、跑完即刪、未 commit)計算,亦零寫入。

---

## 2. 驗收清單(plan §4 P0-D 8 項)逐條核

| # | 驗收項 | gbracing | bonamici | 結果 |
|---|---|---|---|---|
| 1 | brand 映射 | `gb-racing` 解析命中 | `bonamici` 解析命中 | ✅ |
| 2 | category 映射 | 942/942 群對上、0 未對上 | 1252/1252 群對上、0 未對上 | ✅ **P0-B seed 後全對上** |
| 3 | 中文描述接上 | 描述非空 941/942 群(1 空) | 描述非空 1251/1252 群(1 空) | ✅ 全量(空的 1 群=#260 混批 NULL 對象) |
| 4 | 無碳纖維字樣(去碳) | **副標 0/942 含碳纖維** | **副標 0/1252 含碳纖維** | ✅ 全量掃描零命中(去碳目標面=副標;title 見 §8) |
| 5 | 價格 round | 全整數 50~23550、0 小數、0 異常 | 全整數 300~81400、0 小數、0 異常 | ✅ |
| 6 | 變體/色彩 | 單變體(942 群=942 變體) | 色彩變體(1252 群=1710 變體) | ✅ |
| 7 | 缺圖/無 fitment 統計 | 缺圖 49 群、無 fitment 192 群 | 缺圖 1 群、無 fitment 439 群 | ✅(見 §3) |
| 8 | handle preflight + spec 碰撞群 | 🔴 handle 25 筆髒 | 🔴 spec 碰撞 3 群 | ⚠️ 見 §5(Phase 1 gate) |

---

## 3. 兩家詳細數據

### gbracing(942 群 / 942 變體、1:1 單變體)

| 面向 | 數字 | 備註 |
|---|---|---|
| 抓取完整性 | 來源 942 / target 現存 0 / 缺少 0(0.0%) | 首載、零缺 |
| 分類解析 | 942 對上 / 0 未對上 | 全對上 16 大類 |
| 缺圖群 | 49(落 placeholder)/ 893 有代表圖 | 缺圖率 5.2% |
| fitment | 192 無 fitment(通用件)/ 750 有 fitment | 🔴 config 註解稱「無 fitment」**不準**(實際 750 群有);年式多為 null(#211) |
| spec | 942 變體全空 `{}` | 單變體無 spec、乾跑不寫 null(#264 註:空 `{}` 非 NULL) |
| 價格 | 0 小數 / 0 null / 0 異常 / 0 離群 | 範圍 50~23550 TWD |
| 描述 | 941 非空 / 1 空 | 空的 1 群 = #260 混批 NULL 對象 |
| 副標碳纖維 | 0/942 命中(title 亦 0/942) | ✅ 去碳目標面全量零命中 |
| price_store | null(全) | ✅ 經銷價零外洩 |
| 下架對賬 | 待下架 0(0.0%) | 首載天然免疫誤刪 |
| **handle preflight** | 🔴 **25 筆 charset 髒** | 見 §5-A |

樣本群 `BA-675-LHS-GBR`:title「替換用前輪軸防倒球 (左)」/ 副標「Triumph Daytona 675 · 駐車架」/ 繁中描述完整 / price_general=650 / price_store=null / fitments 3 筆(Triumph、年式 null)/ 1 代表圖。

### bonamici(1252 群 / 1710 變體、色彩變體)

| 面向 | 數字 | 備註 |
|---|---|---|
| 抓取完整性 | 來源 1252 / target 現存 0 / 缺少 0(0.0%) | 首載、零缺 |
| 分類解析 | 1252 對上 / 0 未對上 | 全對上(前序 seed 前「操控部品」未對上、今已解決) |
| 缺圖群 | 1(落 placeholder)/ 1251 有代表圖 | 缺圖率 0.08% |
| fitment | 439 無 fitment(通用件)/ 813 有 fitment | 通用件比例高於 gbracing |
| spec | 1710 變體全有 spec `{color,material}` | 資料驅動(P0-C-b2 buildSpecRows 消費) |
| 價格 | 0 小數 / 0 null / 0 異常 / 0 離群 | 範圍 300~81400 TWD |
| 描述 | 1251 非空 / 1 空 | 空的 1 群 = #260 混批 NULL 對象 |
| 副標碳纖維 | **0/1252 命中** | ✅ 去碳目標面全量零命中 |
| title 碳纖維 | 70/1252 命中 | ⚠️ 非違規:真碳纖商品/配件本名(如「碳纖維腳跟護片」「碳纖維與 EVO 拉桿護弓專用轉接座」)、來源真實品名、詳見 §8 |
| price_store | null(全) | ✅ 經銷價零外洩 |
| 下架對賬 | 待下架 0(0.0%) | 首載天然免疫誤刪 |
| handle preflight | ✅ 1252 群全合法且唯一 | 底線放寬(P0-A-4c)生效、PU_001 系列通過 |
| **spec 碰撞** | 🔴 **3 群撞鍵** | 見 §5-B |

樣本群 `0025`:title「鋁合金駐車球」/ 副標「操控部品」/ 繁中描述完整 / 8 變體(黑/藍/古銅…)/ spec `{color,material}` 逐變體不同 / price_general=1900 / price_store=null / fitments=[](通用件)。

---

## 4. RPM 零回歸對照(`--supplier=rpm` **全量**、1117 群 / 8983 變體)

> 全量跑(非抽樣),涵蓋 RPM 現行 prod 全部 1117 群 8983 變體。

| 面向 | 結果 | 判讀 |
|---|---|---|
| 價格 delta | 商品 **0** 變價 / 變體 **0** 變價 / **0** 新商品 / **0** 新變體 / 0 異常 / 0 離群 | ✅ **RPM 全量輸出與 prod 現況零差**(參數化管線未動 RPM 任一價) |
| 下架對賬 | target 現存 1117 / source 1117 / 待下架 **0**(0.0%) | ✅ 全量 reconcile 零下架、零孤兒 |
| 副標 | 「Aprilia RSV4 · 碳纖維部品」(抽樣) | ✅ **唯一授權偏離**(碳纖維→碳纖維部品、2026-07-03 Sean 拍 A、plan §6-3;下次 rpm `--confirm-write` 套用 ~1,117 頁) |
| description 欄 | 不存在於 product 物件(抽樣) | ✅ F2 byte-safe(rpm syncDescription=false、省 key 不覆寫現有英文描述) |
| spec 形狀 | `{weave,finish}` 保留(抽樣) | ✅ 變體 sort 未被通用化重排(plan §2.1 #13) |
| handle | 1117 群全合法且唯一 | ✅ |

**結論**:RPM 路徑**全量零回歸**(delta=0 / 下架=0 涵蓋全部 8983 變體),唯一預期變動為已授權的副標詞(此為語意變動、非價格,不入 price delta;由 CI byte 回歸鎖 `rpm-transform.test.ts` 逐欄守)。試點兩家的參數化未污染 RPM scope。

---

## 5. 🔴 Phase 1 寫入前必處置(gate)

### A. gbracing 25 筆 handle charset(**新發現、需 Sean 決策**)

全量乾跑首次揭露:gbracing 25 個 SKU 產生的 handle 含 URL 危險字元,**寫入模式(`--confirm-write`)會 abort 整批 gbracing**(F4 preflight `rpm-import.ts:215`)。三類:

- **小數點**(19 筆):`M10X1.25` → `gbracing-m10x1.25`、`M12X1.25X40` 等(螺牙規格件,牙距 1.25/1.5 的點)。
- **空格**(5 筆):`M6 HEX HEAD`/`M6 TORX`/`M6 COUNTER SINK`/`M6 SOCKET CAP HEAD`/`M12 ZINC CAP HEAD`。
- **斜線**(1 筆):`FS-CBR600-2008-R/L`(R/L=左右)。

**⚠️ 24 筆(小數點 19 + 空格 5)為 M6/M10/M12 五金螺絲件(非主力商品線);但斜線那 1 筆 `FS-CBR600-2008-R/L` 型態不同 —— GB Racing「FS」= Frame Slider(車架保護滑塊、Honda CBR600 2008 左右套組),屬主力商品線。** 故若走選項 C(排除試點),排掉這 1 筆 = 排掉一個主力 SKU,商業重要性高於其餘 24 筆,Sean 決策時應單獨看待。dry-run 只列清單不阻,寫入才 abort。**選項(Phase 1 試點寫入前擇一)**:
- **A**:handle 正規化(小數點/空格/斜線 → 移除或轉 hyphen)——需重跑 preflight 驗正規化後無新碰撞,handle 偏離原 SKU。
- **B**:修來源 SKU(報價單 B 庫清這 25 筆)——handle 對齊 SKU、根治,但動來源。
- **C**:這 25 群排除試點(先上 917 群、25 群留後處理)——最小風險、最快上線。

→ 已記 backlog(見 §7);**非本報告決策項**,Phase 1 gbracing 寫入啟動前提出。

### B. bonamici spec 碰撞 3 群(C3、已知)

`pv_spec_unique` preflight 撞鍵 3 群(寫入模式 abort):

| externalId | spec | 變體數 | 問題 |
|---|---|---|---|
| `CHAD18` | `{color:null, material:null}` | 5 | spec 全 null、5 變體無法區分 |
| `PSD2` | `{color:null, material:null}` | 2 | 同上 |
| `PU_001` | `{color:黑色, material:鋁合金}` | 8 | 8 變體 spec **完全相同**、真正區分軸(尺寸)不在 spec |

plan §5 已定調:C3 3 群「真正區分軸是尺寸、不在 spec」→ Phase 1 處置。dry-run 不阻、留全清單。

### C. #260 描述混批 NULL(已知、已記 backlog)

試點 `syncDescription=true` 但來源部分 null → postgrest upsert `?columns` 聯集 + defaultToNull 會把省 key 列寫 NULL。乾跑零寫入不觸發;**試點 `--confirm-write` 前必依 #260 處置**。

---

## 6. 安全 / 正確性不變式核對(plan §6)

| 不變式 | 乾跑證據 | 狀態 |
|---|---|---|
| 1 軟下架隔離 | 兩家下架對賬各自 scope、待下架 0 | ✅ |
| 2 首載免疫誤刪 | target 現存 0 → 待下架 0(0.0%) | ✅ |
| 3 RPM 零回歸 | price delta=0、唯副標授權偏離 | ✅(§4) |
| 4 經銷價零外洩 | price_store 全 null、來源 view 無經銷欄 | ✅ |
| 5 F3 bypass 護欄 | 乾跑未帶 `--allow-*` | ✅(不適用) |
| 6 F4 handle preflight | gbracing 25 筆攔下、bonamici 全過 | ✅ 攔截有效(§5-A) |

---

## 7. 待辦(Phase 1 寫入前 / 上架時)

- 🆕 **gbracing 25 handle charset 處置**(§5-A、A/B/C 三選一)→ backlog 新增 #266。
- #260 描述混批 NULL / #261 category null gate(P0-B seed 後乾跑 0 未對上、gate 仍留寫入前)/ #264 變體 spec=NULL→adapter 500 / #265 ProductInfo 選擇器泛化 / bonamici spec 碰撞 3 群(C3)。
- 🔴 前台目錄接線(#205/#220c)——寫入 ≠ 瀏覽可見(plan §5 C1),試點商品映射新分類後不會自動出現在首頁/列表,需 Phase 1 補接線。

---

## 8. 誠實邊界

- **去碳的精確語意(全量掃描佐證)**:去碳的目標面是**副標**(原硬寫「碳纖維」的注入點)——全量掃描 gbracing **0/942**、bonamici **0/1252** 含「碳纖維」,注入面乾淨。**title / description = 來源真實品名與文案,非去碳目標面**:bonamici 有 **70/1252 群 title 含「碳纖維」**,但那是真碳纖商品或其配件的正確名稱(如「碳纖維腳跟護片(右側)」、「鋁合金轉接座(碳纖維與 EVO 拉桿護弓專用)」),**移除反而會誤述商品** —— 屬準確資料、非違規。gbracing title 0/942、兩家 description 亦為來源真實文案(材質提及=事實)。**判準:去碳 = 移除硬寫/注入的碳纖框架(副標/模板區塊),不是清洗真實品名**。
- **統計為觀察值**:§2-3 數字全來自實跑乾跑輸出 + 唯讀統計腳本(重用生產 transform 函式),非估算。
- **fitment「有/無」**指群層 `mergeFitments` 是否為空(通用件無 fitment);有 fitment 群的年式多為 null(#211 匯入端未正規化、非本報告範圍)。
- **gate 未消**:本報告是「乾跑通過」不是「可寫入」;§5 三項處置未完成前,gbracing/bonamici **不得 `--confirm-write`**。
