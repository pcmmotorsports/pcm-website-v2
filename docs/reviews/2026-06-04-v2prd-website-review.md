# 審查記錄:報價單 v2 PRD(網站端整合)+ LINE CTA slice(2026-06-04)

> 網站審查 session(寫審分離 ROLE=A)。本檔為精簡版(完整 workflow 輸出 2.6M token 在 /tmp、會被清);保留審查結論供追溯。
> 對象:① 報價單 `PRD-storefront-content-pipeline-v2-2026-06-04.md`(對抗 workflow `w7jl8441m`、35 agents)② 網站 LINE CTA commit `ce36e50`(fresh-context 重驗)。

---

## A. 報價單 v2 PRD 對抗審查(workflow w7jl8441m)

**範圍**:網站審查 session 的聚焦對抗審(不重跑報價單側已做兩輪 PRD 內部審),5 維度:fixes-landed / website-consumption-gap / doc-consistency / ironrule-architecture / adversarial-gaps,每條對抗驗證。
**結果**:30 findings、**0 blocker**(兩個原標 blocker 經驗證降級 should-fix)、19 should-fix、10 nit、1 refuted。
**commit 結論**:v2 PRD 可 commit(純規劃 docs、低風險、可 revert;在報價單 repo、不碰網站 repo)。

### A.1 最高價值發現(網站端、沒人查過、PCM-1~5 + C-1)

| ID | 嚴重度 | 域 | 結論 |
|---|---|---|---|
| PCM-1 | blocker→should-fix | both | 網站**不直接讀** `storefront_catalog_v`。兩個 Supabase 庫(報價單 `dllwkkfanaebrsuyuedy` / 網站 `bmpnplmnldofgaohnaok`),中間隔每夜同步腳本 `rpm-import.ts`/`rpm-transform.ts`。PRD 改 view = **必要非充分**,網站側須改 5 斷點(VIEW_COLS / transform / 網站 migration+view / adapter+mapper / UI)。PRD §16 一句話嚴重低估。→ backlog #212 |
| PCM-2 | should-fix | both | 新內容欄(summary_zh/highlights_zh/panel_type/spec_marketing)網站 transform+UI **零接線**;且 description **刻意停同步**(`rpm-fetch.ts:50` + Sean Q-desc 舊拍板)→ 上中文文案須先確認推翻該拍板 |
| PCM-3 | should-fix | both | 網站 spec 渲染寫死 RPM key(`ProductInfo.tsx` weave/finish/special)+ `ProductTabs.tsx` 規格表靜態 JSX 字面(真碳纖維/泰國)。去 RPM 化是**元件級重構**;放量到非 RPM 家前必須先做、否則 RPM 字面張冠李戴 |
| PCM-4 | should-fix | both | 下架網站側 **by-construction 安全**(網站庫自有 `delisted_at` + RLS `USING(delisted_at IS NULL)` + `rpm-reconcile` S4 已上線)。但與報價單側 v2 §11 下架機制**會疊加**→ 需釘死「缺席判定權威在哪側、N 天怎麼算」 |
| PCM-5 | nit | both | 群 grain 內容一致 by-construction 安全(內容欄在群代表 product、變體只差 spec);無破綻 |
| C-1 | should-fix | both | 合約「版本化」是 prose 口號;網站 VIEW_COLS 寫死白名單 → 新欄靜默漏接(不報錯、不 build 紅、前台空白且無人察覺)。建議 contract-drift 測試 + 合約 doc 加 version/changelog |

### A.2 文件一致性(doc-consistency,網站 repo 域內、已執行對齊)

- **F1**(blocker→should-fix):網站設計 doc「標題主車型」後門 vs v2 §5.2 三叉規則衝突 → **Sean 2026-06-04 拍 A(三叉為準)**;已對齊設計 doc 三處 + backlog #209。
- **F2/F3**(should-fix):設計 doc 停在「逐件 / 逐件 AI」,v2 升維「群 / 範本工廠打底+AI頭部」→ 已加 banner + 內文註記。
- **F4/F5/F6/F8**(nit):範本鍵 major_category / product_name_zh token guard / 5 家無原文 / GEO 去重 → 已補設計 doc 指針。
- **F7**(should-fix):backlog #209 權威指針 B→v2 → 已更新。

### A.3 鐵則/架構 + 盲點(報價單側 should-fix,已轉報價單 session)

- **ironrule-F2**:`spec_marketing` 無 column lock、只靠每條寫入路徑記得帶 `WHERE translation_locked=false`=脆弱單點;`/translations` 現逐件非群 grain。
- **ironrule-F3/F5**:車種 regression scan 須自動化 CI/排程(clean-by-data);鎖群內文車款 vs 最新 fitment_parsed 漂移建議加告警卡。
- **ironrule-F4 / LVF-02**:§14 P0 驗收只驗既有 description_zh、沒驗新加 summary_zh/highlights_zh → 須三欄逐欄斷言。
- **LVF-01/03**(nit):§8 L224「只做修#2 更嚴重」論證不精確(真正是 no-op、須先擋 DELETE);§11 解鎖後 stamp 復活角落未定義(v1 無解鎖路徑、補一句即可)。
- **C-2~C-6**:P0 上線前「人手鎖內容但 mc=false」空窗;GEO 閘只擋 byte-identical 抓不到近乎逐字;**§17 pilot 先 RPM 反咬**(RPM 唯一有原文,驗不到 5 家空原文+跨家範本,建議納一無原文家);「沿用 v1」隱藏假設(v1 整鏈從沒跑過);下架去抖計數依賴每夜成功跑、fetcher 連續失敗時 `last_absent_count` 語意未定義。

### A.4 唯一 refuted(對抗驗證發揮作用)

- **ironrule-F1**(指控 `product_groups_v` 是舊 5 分支殘版、main_sku 防漂移不足)→ **REFUTED**:唯讀查正式庫 `pg_get_viewdef('product_groups_v')` 實為 **6 分支**(含 `MATERYA-[0-9]+-[0-9]+` fallback)、與 `storefront_catalog_v` 一致。指控的事實前提被 live 證據駁倒。

---

## B. LINE CTA slice(commit `ce36e50`)— **PASS、0 must-fix**

> 註:LINE CTA PASS 已由 Sean 另記於 `od-redesign-review-log.md`(commit `e069167`;`line-cta` 已 ff-merge 進 dev=`e069167`、分支已刪、worktree 已收)。本節為網站審查 session 獨立 fresh-context 重驗的詳版、結論一致。

執行 session 在獨立 worktree `line-cta`(=dev+1 線性)做。fresh-context 對不可變快照 `git show` + 乾淨 worktree 重跑三綠驗證。

**7 審點(對實際碼)**:
| 審點 | 結果 |
|---|---|
| 🔴 零車款字串(車種鐵律) | ✅ `buildPrefillMessage` 只用 name+productCode??slug+pageUrl、**完全不讀 product.fits**、不拼廠牌/車型/年式 |
| 含商品名+料號+URL | ✅ 三行齊全;料號 productCode??slug(對齊 16c-4b vendor 主碼) |
| 車型留空 | ✅ 結尾「我的車是(…):」冒號後空白、test endsWith 守 |
| 手機 deep link + 桌機 QR | ✅ `line.me/R/oaMessage/@pcmmoto/?{urlencode}` 格式正確;桌機 QR modal(role=dialog+ESC+body鎖+遮罩關+onError fallback) |
| RWD 不擋 buybar | ✅ fab z-index 45 夾 tabbar(實測 40)/buybar(實測 50)+ 手機 bottom calc(74px+safe-area)上移 |
| smoke test | ✅ 8 測;車種鐵律測用 fits='CBR600RR' 商品當對抗樣本、斷言 not contain fits/'CBR' |
| 三綠(fresh 重跑) | ✅ typecheck 7/7 + lint + vitest 82 檔 554 測 + build forced 1/1(`/products/[slug]` 正常) |

**manifest 同步**:正確誠實——新功能標 `business_override: lineCtaDeepLinkPrefill` + `authority:「無 design-reference 源」`(鐵則 1 不適用、正確記為 override 非偽造 design 源);hash 用可達祖先 6897324(避 amend orphan)。

**2 NIT(非阻)+ Sean follow-up**:
- modal 無 focus-trap/restore(沿用既有 SwatchLightbox 範式、一致、留 a11y pass)。
- Sean 補 `public/line-qr.png` 真圖(現 placeholder;onError 有 fallback 文字+加好友連結兜底、不破版)。
- :3001 肉眼驗(手機實開 LINE 預填 + 桌機 QR + 窄螢幕不擋購買列)。

**結論**:`ce36e50` PASS、未 push、未 merge,等 Sean :3001 驗 + ff-merge `line-cta`→`dev`。

---

_(本檔 2026-06-04 網站審查 session;v2 PRD 主審在報價單側、本檔為網站側可選審回饋。)_
