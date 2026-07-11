# 報價單源頭變體建模規格 — ebc / eazigrip / materya 撞鍵治本(v1.0、Sean 已拍板)

> 日期:2026-07-11。承接:`docs/handoff/2026-07-11-quote-source-variant-modeling-handoff.md`。
> 實作 repo:報價單 `/Users/sean_1/API大量上架/PCM報價單-V2`(本檔=跨 repo 提案,#267/#268/#274 同線)。
> 真權威上游:`docs/specs/2026-07-04-variant-model-unification-plan.md`(#267 變體統一)。memory:`project_quote-source-spec-variant-modeling`。
> 狀態:**v1.0 — 診斷實查完成 + Q1/Q2/Q3 拍板(見 §6)。下一步=依 §7 實作 plan 動工**。

---

## 0. 一句話總結

三家撞鍵是**三種不同的病**:ebc=缺材質軸(源頭填 spec)/ eazigrip=原廠重複上架+報價單去重沒下沉(view 去重下沉)/ materya=分群 regex 把兩個不同商品併成一群(改分群碼)。網站端一行不改(rpm-transform.ts:398 `spec: v.spec ?? {}` 維持原樣)。

## 1. 共用機制(已實查)

- `storefront_catalog_v.spec` = `products.spec`(GENERATED STORED,源 `raw_jsonb->'spec'`;`supabase/migrations/20260602_storefront_catalog_v.sql:19-21`),view 純透傳。
- samco 樣板:`fetchers/samco.py:308-311` — `raw_jsonb["spec"] = {"color": "經典-經典黑"}`(中文值直接進 spec、網站直接顯示)。
- 分群單一來源:`fetchers/base.py:411 compute_group_code`(11-branch、鏡像線上 `product_groups_v` CASE;ebc/bonamici/kspeed 走 `raw_jsonb.group_code` 欄 COALESCE 口徑=**改欄位免動 view**)。
- 網站撞鍵閘:`scripts/rpm-import.ts:276-281` pv_spec preflight(同商品同 spec → 整家 abort)。

## 2. ebc(35/68 群撞鍵)— 缺材質軸,填 spec 即治本

**實查**:112 列 spec 全 null。SKU 形態=`{前綴}{號碼}{後綴}`,群鍵=`EBC-PAD-{shape}`(fetcher 刻意設計:同 pad 形狀不同材質=同卡變體,`fetchers/base.py:443-447`)。
**驗證**:全 68 群內(前綴×後綴)組合零重複(SQL 實測)→ **填材質後 35 群撞鍵全消**。

**全詞彙 + EBC 官方正名(2026-07-11 官方核實,ebcbrakes.com 親讀)**:

**Q1=A 定案字面(代碼+短中文;GPFAX 不寫「不可上路」)**:客人在變體選擇器看到的 spec 值。**spec key 用 `tier`**(fable 審 F1 修正:網站 `ProductInfo.tsx:65-71 GENERIC_DIM_LABEL` 已有 `tier:'等級'`、eazigrip 也用 tier → EBC 用 tier 真零改且軸名自動顯「等級」;原草案 `grade` 網站無映射會 fallback 顯英文 "grade"、破壞零改)。

| SKU 形態 | 列數 | 官方系列名(親讀 ebcbrakes.com 查證) | spec 顯示值(Q1=A 定案) |
|---|---|---|---|
| `FA###`(無後綴) | 12 | Organic(R90 aramid 街車替換、非燒結) | FA 有機複合 |
| `FA###HH` | 56 | Double-H™ Sintered Superbike | HH 全金屬燒結 |
| `FA###V` | 14 | V-Pads™ Semi-Sintered Touring | V 半燒結 |
| `FA###R` | 6 | "R" Series Sintered(官方歸 ATV/越野線) | R 越野燒結 |
| `FA###TT` | 2 | Carbon-X / TT(motocross/enduro) | TT 碳纖越野 |
| `SFA###` | 1 | SFA Series Organic Scooter | SFA 速克達有機 |
| `SFA###HH` | 3 | SFA + Double-H Sintered | SFA 全金屬燒結 |
| `EPFA###HH` | 1 | EPFA Sintered Fast Street & Trackday | EPFA 街道賽道燒結 |
| `GPFAX###HH` | 17 | GPFAX Sintered Race(官方 RACE ONLY,但依 Q1=A 顯示不帶警語) | GPFAX 賽道專用 |

> 註:官方 organic(FA/SFA)非燒結;忠霖圖字面「有機複合燒結」與原廠矛盾,Q1=A 定案採原廠口徑去「燒結」二字。GPFAX 官方明文 RACE ONLY/上路違法,Sean 拍板顯示層不帶警語(若日後要警語另議、屬內容決策非本規格)。

**修法**:`fetchers/ebc.py` 比照 samco 加 `raw_jsonb["spec"] = {"tier": <上表顯示值>}`;對照函式擴充既有 `lib/ebc_pdf_parser.py:98 ebc_compound_label()`(現只認前綴 GPFAX/GPFA/EPFA/SFA/FA,需補 HH/V/R/TT 後綴判別 → 9 種完整映射)。

- **fable 審 F4(fallback fail-loud)**:映射函式對「落不進 9 類」的 SKU **必 raise / 記 error 名單、不靜默回空**(靜默 spec=null 的單列不撞、湊成對才觸發整家 abort=晚爆)。現況 112 上架列全落 9 類(後綴分佈加總=112、已 SQL 驗)、無漏網;但 `EBC_COMPOUND_PREFIXES` 含 `GPFA`(非 X)9 表無此列、重跑 export 可能進新 SKU → fail-loud 防未來。
- **前端零改**:EBC spec 值本身已是中文(「FA 有機複合」等)、走 GENERIC 模式「值原字直出」;軸名 `tier` 已有「等級」映射 → `spec-dict.generated.ts` / `ProductInfo.tsx` **都不用改**(原草案誤寫需加 ebc 分支,已修正)。
- **114 vs 112**:products 表 ebc 共 114 列、其中 is_listed 且非 hidden = 112 = storefront view 列數;差 2 = 未上架列(不進 view、不影響撞鍵)。驗收數字用「全上架列 spec 非 null」、不寫死 112(fable F7)。
**禁令範圍已核實**:`fetchers/ebc.py:18/:269`「絕不放 raw_jsonb.spec」對象=卡鉗/Brembo/SBS 對照碼(防競品碼洩進客人 DTO),非材質;opus 審查檔 `docs/reviews/ebc-opus-followup-2026-07-08.md:269` 本就預留「#16/#17 spec 翻譯(若用 spec)」。實作時在該註解旁補一句「材質 compound 走 spec=刻意、卡鉗碼仍禁」防未來誤讀。

## 3. eazigrip(8 群 40 對撞)— 原廠重複上架 + 報價單去重沒下沉(Q3=A:view 去重下沉)

**根因(實查、非爬蟲壞)**:Eazi 原廠把同款貼紙用兩個 WooCommerce 商品頁各上架一次 —— 單設計頁(wc_id 30255 黑/30265 透明)+ Various Designs 總覽頁(wc_id 40896 黑/40950 透明);爬蟲兩頁都抓 → 每個 (tier/color/design) 產生 2 個料號(短碼 vs 長碼+BLK/CLR 尾)。撞鍵全數在 CENTREPAD A–H 八群、每群 5 對(EVO/PRO/SIL × 黑/透明)。
**關鍵發現**:報價單前台**早有去重** `app/quotations/_lib/variant-grouping.ts dedupeEazigripVariants`(key=tier/finish/design/pack/color、同 key 留圖最多那筆;註解明寫此 bug),但那是 **TypeScript 顯示層去重、只在報價單前台生效**——沒寫回 DB、沒進給網站的 `storefront_catalog_v` view。網站吃未去重 view → 撞 `pv_spec_unique`。這就是「報價單看不到重複、卻擋住網站」的真相。
**修法(Q3=A)**:把 dedupeEazigrip 同款去重**下沉進 `storefront_catalog_v` view**(view 內對 eazigrip 同 (main_sku, spec) 去重、留一筆)→ 網站自動吃到去重、**網站 repo 零改**;報價單前台**不受影響**(grep 全 quote repo 無 TS/py 消費該 view、僅 base.py:398 註解,fable 已驗)。優於原「軟下架料號」案:復用既有去重定義、不動 products 表資料。

- **fable 審 F2(決定性 tie-break=must-fix)**:eazigrip 每變體僅 1 張自己色圖 → 雙胞胎圖數幾乎必平手,TS「留圖最多」形同虛設、真正裁決者是 tie-break。TS 版平手留 DB 回列序(未定義)。SQL 化**必須全序決定性**,否則每次查詢吐不同 sku → 網站 variant orphan 對賬(`rpm-import.ts:259-270`)刪建循環、cart/快照引用消失的 sku。定案排序鍵:`ROW_NUMBER() OVER (PARTITION BY supplier_slug, main_sku, spec ORDER BY jsonb_array_length(images) DESC, length(sku) ASC, sku ASC)` 取 rn=1(圖多優先 → 平手留短碼〔單設計頁〕 → 再平手字典序)。實作用 `(main_sku, spec)` jsonb 全等當去重鍵(比 TS 5 欄 key 更保守=多一 key 即不併、安全方向;措辭「語意等價、以 jsonb 全等實作」,fable F6③)。
- **fable 審 F3(同價前置驗證=must-fix)**:短碼(單設計頁)/長碼(總覽頁)是兩個 wc 商品、價格可各自改;去重=任挑一筆的價給客人看(customer-facing 金額)。**已 SQL 驗:現況 40 對雙胞胎 price_general 兩兩全等、零不一致**;驗收保留此 SQL 防未來(不等者列出交 Sean、不靜默挑一)。
- **只對 eazigrip 分岔的誤傷防護(fable F6④)**:view 去重 WHERE 守衛限 `supplier_slug='eazigrip'`;bonamici 3 群「同 spec 不同尺寸」列(`rpm-import.ts:274` 註解 C3)為對照組首選、驗收 §5.3 byte 不變覆蓋;獨苗(SCTP)partition 內 rn=1 必留、不誤刪。variant_count(window count)去重應在 window **之前**做保語意一致(fable F6①;網站刻意不取該欄、低影響但仍對齊)。
**附帶清理(同家、非本撞鍵)**:尾 hyphen SKU 3 筆(`PRO441CL-`/`TANKBMW006-`/`TANKBMW006M-`,不撞 pv_spec,但網站 `normalizeHandleSegment` 去尾 hyphen 後 handle 撞無 hyphen 版、被 handle preflight 攔)。三筆是真實不同商品(不同年份 kit),需乾淨識別碼;另 `TANKBMW006M-` spec=`Gloss` 疑源頭誤標(M 慣例=Matte),實作時查證。

## 4. materya(1 群 4 列撞)— 分群 regex 誤併兩商品,分家非填 spec

**實查**:`MTY059CG/CM`(Seat Cover, 17300)與 `MTY059CG-1/CM-1`(Front Winglet, 19100)是**兩個不同商品**,被 `fetchers/base.py:423` regex `^(MTY[0-9]+)` 全部收進群 `MTY059`(`-1`=供應商的同號第二商品索引、CG/CM=材質碼)。
**🔴 fable 審 F5(兩種 SKU 命名不可一刀切=must-fix,已 SQL 坐實)**:materya 有兩種料號形態,分群規則要分開,否則會誤拆同商品:

- **`MTY{號}{材質碼}[-{索引}]`**(手填正式料號,如 MTY059CG / MTY059CG-1):群鍵=`MTY{號}` + 尾 `-{索引}`(有則帶)、**中間材質碼 CG/CM 剝掉** → `MTY059CG`→`MTY059`、`MTY059CG-1`→`MTY059-1` 分家;CG/CM 是材質變體同群、spec 已有 `{"material":...}`。
- **`MATERYA-{wc}-{var}`**(fabricated fallback,如 MATERYA-3172-3174/3176):群鍵=`MATERYA-{wc}`(**尾段是 variation_id、不是商品索引**),同 wc 同群 → 現有 `base.py:425` 第二分支已正確、**維持不動**。⚠️ SQL 實查:`MATERYA-3172-3174`(黑)/`MATERYA-3172-3176`(紅)是同商品顏色變體、同價 3400、**絕不可拆**——證明一刀切「尾 -N 分家」會誤傷。

**修法**:materya 走 `raw_jsonb.group_code` 欄(fetcher 依上兩形態算好群鍵)→ `compute_group_code` 加 materya `_nonempty("group_code")` 分支置於現有 regex 分支**之前**、view COALESCE(group_code, CASE) 自動生效(**view 免改**、對齊 ebc/bonamici)。**驗收(fable F5③)**:materya 全列 `raw_jsonb.group_code` 非空(漏寫即靜默回歸舊 regex 誤併)。

## 5. 驗收(實作用,每條 yes/no;fable 審後補強)

1. 報價單 DB 實查:ebc **全上架列(現 112)spec 非 null、每群內 spec 值無重複**(不寫死 112、fable F7);eazigrip `storefront_catalog_v` 每 (main_sku, spec) 只剩 1 列(11→6);materya `MTY059`/`MTY059-1` 分屬兩群、`MATERYA-3172` 顏色變體仍同群。
2. 網站端 `rpm-import` 乾跑三家 pv_spec 撞鍵=0、handle duplicate=0;**網站 repo diff=0**(零改)。
3. 三家以外供應商 view 輸出 byte 不變(samco/cnc/gbracing + **bonamici〔同 spec 不同尺寸列、去重誤傷對照組首選〕**抽樣對照 row count + spec)。
4. **eazigrip view 去重同查詢重跑 3 次輸出 byte 相同**(決定性 tie-break、fable F2)。
5. **eazigrip 40 對雙胞胎 price_general 兩兩相等**(不等者列出交 Sean、不靜默挑一;fable F3;現況已驗全等)。
6. **materya 全列 `raw_jsonb.group_code` 非空**(漏寫=靜默回歸誤併;fable F5③)。
7. **EBC 映射零 unmapped**:112 上架列全落 9 類、無 SKU 靜默 spec=null(fable F4)。
8. 尾 hyphen 3 筆有乾淨識別碼;`TANKBMW006M-` finish 誤標查證結果落檔。

## 6. 拍板紀錄(2026-07-11)

- **Q1=A**:EBC spec 顯示「代碼+短中文」(見 §2 表 9 種定案字面);**GPFAX 不寫「不可上路」**;軸名「等級」/**spec key `tier`**(fable 審 F1 修正、原 `grade` 改 tier=網站零改)。
- **Q2=A**:忠霖總代理官方系列圖(chunglin.tw)**不直接放我們網站**(未授權 + 公司貨誤導風險);只取事實資訊(系列名+定位)自行重排版面接品牌形象區。要用圖先取得忠霖/EBC 授權(併入既有品牌圖授權 gate)。
- **Q3=A**:eazigrip 去重走 `storefront_catalog_v` view 下沉方案(§3)。實作=A:直接在報價單 repo 續做、寫正式庫 `.command` 由 Sean 跑。

## 7. 實作 plan(§ 待 explore 摸清報價單三家細節後補;動 view=migration=鐵則 8+Sean db push)

拆三獨立單元(EBC/materya 不動 view 可先做,eazigrip 動 view 需 migration+Sean 手動 SQL Editor):

1. **EBC 填 spec** — `lib/ebc_pdf_parser.py` 後綴→9 種材質映射 + `fetchers/ebc.py` raw_jsonb.spec 寫入(旁註「材質走 spec 刻意、卡鉗碼仍禁」)→ 重跑 fetcher → DB 驗 spec 填滿無撞。
2. **materya 分群** — `fetchers/materya.py` 寫 `raw_jsonb.group_code`=`MTY{號}[-{索引}]` → `compute_group_code` materya 分支改走 group_code COALESCE(對齊 ebc/bonamici) → 驗 MTY059/MTY059-1 分家。
3. **eazigrip view 去重** — `storefront_catalog_v` migration 加 eazigrip 去重(鏡像 dedupeEazigrip、留圖最多)+ 尾 hyphen 3 筆識別碼 → Sean SQL Editor 套用 → 驗 11→6。
每單元完成:報價單端驗 → 網站端乾跑 pv_spec=0 → Sean --confirm-write 匯 prod。

## 8. 對抗審查紀錄(2026-07-11、關卡1 plan 審)

- **codex 最強模型(gpt-5.6-sol)**:codex CLI 0.142.5 版本過舊、伺服器 400 擋(需升級 CLI);零留痕確認 codex 未動任何檔。
- **fable(adversarial-reviewer 跨 context、PCM overlay)**:判定 **FAIL(需修正)**;三家診斷全數成立、方向不推翻;must-fix 3 條(F1 spec key/F2 tie-break/F3 同價)+ consider/nit 若干,皆 plan 層可修、無需 R2 全案重審。
- **本 session 修正(全數落回上文)**:F1→spec key `grade`→`tier`(§2/§6、網站零改);F2→決定性 tie-break `images DESC, len(sku) ASC, sku ASC`(§3、驗收4);F3→同價前置驗證(§3、驗收5、已 SQL 驗全等);F4→映射 fail-loud + 114/112 釐清(§2、驗收7);F5→materya 兩形態分開處理(§4、SQL 坐實 MATERYA-3172 顏色變體不可拆、驗收6);F6/F7 nit→jsonb 全等措辭/variant_count 時序/bonamici 對照組/驗收不寫死數字。
- **翻 PASS 條件(fable WOULD-CHANGE)**:40 對雙胞胎全等價(✅已驗)+ migration 含唯一次序鍵(✅已定案排序鍵)+ F1 拍板(✅採 tier)→ 三項齊、修正版視為 PASS-with-comments。實作階段 eazigrip view migration SQL 出來後跑關卡2 審實作。

— END —
