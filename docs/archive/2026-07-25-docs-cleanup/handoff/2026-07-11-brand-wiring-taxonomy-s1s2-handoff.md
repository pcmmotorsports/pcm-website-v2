# SESSION HANDOFF — 2026-07-11 三家串接收工(#274 關閉)+ 分類 v1.2 S1/S2 落地(#276)

> 一句話:ebc/materya/eazigrip 三家全上 prod(**8 家品牌上站、#274 關閉**);分類一致化 v1.2 Sean 批 GO+全 A,S1(DB 三表)已套用驗證、S2(classify_v2 引擎骨架)已落地;**下一 session 主任務=報價單 repo S3/S4 補丁規則 → S5 全量對帳報告交 Sean**。
> 環境:雙 repo。網站 `pcm-website-v2` dev=`6c3296b` 已推;報價單 `/Users/sean_1/API大量上架/PCM報價單-V2` main=`a38bfa7` 已推(本 session Sean 明示「幫我推」)。
> 接手先讀:①報價單 repo `docs/PLAN-category-taxonomy-v12-2026-07-11.md`(**實作真權威**,§7=拍板紀錄)②`docs/taxonomy/taxonomy-v2-rule-layer.md`(S3/S4 的 34 條規則清單)③memory `project_category-taxonomy-unification-2026-07-11`。

## 1. 做了什麼(按時序)

- **三家串接(#274)**:ebc/materya 乾跑全綠→開寫入閘→Sean `--confirm-write` 上 prod(68/112、54/88);eazigrip 乾跑抓到最後 1 筆 handle 撞(`TANKBMW006-` 尾 hyphen)。
- **分類 v1.2 拍板(Sean「依照建議+q5:a」)**:GO / Q1=A 對照落 DB / Q2=A 獨立每日 recompute 腳本 / Q3=A 平行寫入→對帳→一次切離峰 / Q5=A eazigrip 尾 hyphen 回源頭清。
- **eazigrip 源頭修(報價單 `5a23541`)**:實查發現尾 `-` 是原廠「同號重複上架加 `-N`」慣例的髒版(庫內 ~120 個真 `-N` 料號、`TANKBMW006-1` 已被另一 kit 佔用)→ 改名取**下一空索引**(`TANKBMW006-2`/`TANKBMW006M-2`、`PRO441CL-`→`PRO441CL` 併回 TG441);**順帶治系統病**:eazi_merge 剝 `-N` 判 M 再補回=PPF 家族 74 筆消光誤標亮光全正名+亮/消同 wc 成對併卡(679 列影響面全驗零誤併、2 獨苗以原廠 WC store API 逐筆核實)。adversarial R1 FAIL(F2 backfill 不冪等等)→修→R2 PASS;新增防呆:非 PPF 家族取號 raise、backfill 跳過裸 `-` 過渡列、merge_code 一律 eazi_merge(新sku) 重算。
- **eazigrip 收尾**:Sean 雙擊 `.command` 寫入(全家重抓+算價+MV)→ 殭屍 3 筆(翻譯鎖=系統性批次鎖致永不硬刪、view 不濾下架列)Sean SQL Editor 刪除 → 網站乾跑全綠(1,667 群/5,233 變體、handle 全唯一、pv_spec 0)→ 開閘(網站 `d813b7f`)→ Sean `--confirm-write` 上 prod 零異常 → MCP 實查對帳+抽查併卡(tankbmw006-2 亮/消同卡、tankhon002-1 家族修生效、tg441 含 PRO441CL)。
- **分類 S1(報價單 `86bbf2d`+`b89da6f`)**:migration `20260711b_taxonomy_v2_schema.sql`=taxonomy_v2_major(14)/taxonomy_v2_sub(77)/category_taxonomy_map(278 exact)+products 兩 v2 欄;**map 表=調分類 SSoT、seed ON CONFLICT DO NOTHING**(重放不沖手調;審查 F1 擇路,對 Sean 已明示);產生器=`scripts/gen_taxonomy_v2_migration.py` 讀 `docs/taxonomy/category-taxonomy-v12.json`。Sean 雙擊 `分類S1_套用migration_寫入正式庫.command` 套用、驗證 5 條全過(14/77/278/2 欄/RLS)。
- **分類 S2(報價單 `a38bfa7`)**:`lib/taxonomy_v2.py`=cache 載入(offset 分頁、空表 fail-closed)+`classify_v2` 三層(exact→PATCH_RULES 掛點→兜底桶+逐來源計數);8 單元測試+全套 914 綠+真表煙霧過。**未接線(fetcher/recompute 未掛)、零行為變更**。

## 2. Commit 序列(全部已推)

| repo | commit | 內容 |
|---|---|---|
| 網站 | `2715479` | 開 ebc/materya 寫入閘(code-reviewer R1 FAIL 證據缺→補跑留檔→R2 PASS) |
| 網站 | `00b1e58`/`1bb247d`/`6c3296b` | STATUS 之四/之六/S2 收工 |
| 網站 | `d813b7f` | 開 eazigrip 寫入閘+pv_spec 零撞自明輸出(reviewer nit) |
| 報價單 | `5a23541` | eazigrip 尾 hyphen 正規化+PPF 家族消光正名(adversarial R2 PASS) |
| 報價單 | `86bbf2d`/`b89da6f` | 分類 S1 migration+產生器+雙擊套用檔 |
| 報價單 | `a38bfa7` | 分類 S2 classify_v2 引擎骨架 |

⚠️ 網站 repo 有**平行 session**(catalog-ux:`88d14f8`/`31246c8`+工作樹 14 個未 commit 前台檔+1 個 untracked handoff)——非本 session 產物、勿動;本 session 全程精準 add。

## 3. DB / 部署 / 外部足跡

- **報價單 B 庫(dllwkkfanaebrsuyuedy)**:①S1 三表+products 兩欄(Sean .command 套、單交易)②eazigrip 全家重抓寫入(改名 3 筆+家族 74 筆正名併卡)③殭屍 3 筆 DELETE(Sean SQL Editor、刪前逐筆核已下架+接班列在)④MV 已刷。交易模擬/唯讀查證若干(零留痕)。
- **網站庫(bmpnplmnldofgaohnaok)**:三家匯入全由 Sean `--confirm-write`(Claude 被 classifier 擋=合規);MCP 唯讀驗證數量+抽查。
- 部署:網站只推 dev(preview);production/main 未動。報價單 main push 觸發 quote 站 Vercel 部署(本 session 未動其前端 code、行為不變)。
- 新工具檔(報價單 repo 根):`Eazigrip尾hyphen修正_寫入正式庫.command`、`分類S1_套用migration_寫入正式庫.command`(已用過)。

## 4. graphify 地圖增量

未刷。原因:網站 repo 僅動 scripts 2 行+docs;報價單 repo 動 code(lib/fetchers/scripts/supabase)但已深夜、且 S3/S4 明日會再動同批檔——建議 S3/S4 session 收尾時一次刷(報價單 repo 自身圖較新、照該 repo 慣例)。

## 5. 開放項(待辦)

- ⏳ **接手 session 主任務(報價單 repo)**:**S3/S4 補丁規則**——把 `docs/taxonomy/taxonomy-v2-rule-layer.md` 34 條落成 `register_patch_rule` 模組:①rpm+lightech+cnc 碳纖 29 組關鍵字→13 部位子類(覆蓋 97.6%、漏網入「其他碳纖維飾件」)②cnc+lightech 離合器外蓋/機構 8 關鍵字 ③motogadget 912 筆關鍵字桶分家 ④kspeed Brake 品名五路+akrapovic AKRA_RULES regex+samco hose_kit/clamp_kit 用 is_moto(舊 major=四輪 ATV/UTV)雙棲判 ⑤雜物桶清運。規則細節=定稿 spec §7.2(網站 repo `docs/specs/2026-07-11-category-taxonomy-v1-draft.md`)。**接線審查不降級**(資料正確性層)。
- ⏳ **S5**:`scripts/taxonomy_v2_recompute.py`(全量回填 v2 兩欄、冪等、日報「未接住 N 筆」)→ 乾跑對帳四條(NULL=0/大類加總=全量/vs 定稿逐類 diff/兜底量級)→ **報告交 Sean 過目才進 S6+**。
- ⏳ S6-S8:掛每日管線 → view 增欄(Sean SQL Editor)→ 報價單前端切 14 類;網站側(S9+)回網站 repo 另提。
- ⏳ lightech 串接:等 #275(https 圖源重抓、報價單 repo),與分類線無依賴。
- ⏳(擇一時機)`/graphify --update`+`/pcm-roadmap`:#274 milestone 已收,建議明日收工跑。
- carry-over 給 Sean:無待決策;三個 .command/SQL 動作全部完成。

## 6. push 狀態與收尾自檢

兩 repo 全推平(網站 dev=`6c3296b`=origin、報價單 main=`a38bfa7`=origin);secret 0(.env 未讀未貼、SQL 只查 count/分類欄不取金額);網站工作樹殘檔=平行 session 所有。接手 1-2-3:①cd 報價單 repo、讀 plan §2B/§4 與 rule-layer 清單 ②讀定稿 spec §7.2 四補丁點細分 ③從 S3 開工(每片 15-45 分、pytest+對抗驗證)。

## 相關 plan / 記憶 / 文件

- 報價單 repo:`docs/PLAN-category-taxonomy-v12-2026-07-11.md`(真權威)/ `docs/taxonomy/`(JSON+規則層)/ `lib/taxonomy_v2.py`(S2 引擎)
- 網站 repo:`docs/specs/2026-07-11-category-taxonomy-v1-draft.md`(分類定稿)/ `docs/specs/2026-07-11-quote-source-spec-variant-modeling.md`(#274)
- memory:`project_category-taxonomy-unification-2026-07-11`(拍板全紀錄+S1/S2 進度)/ `project_quote-source-spec-variant-modeling`(#274 收工)/ `project_brand-rollout-8plus1-overnight`(8 家上站)
