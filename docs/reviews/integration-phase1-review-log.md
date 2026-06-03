# 報價單↔網站整合 Phase 1 — 審查紀錄(審查 session 自動產出)

> 審查 session 的常駐哨兵偵測到執行 session commit 到 `dev` 後,**自動** fresh-context 審查、逐片 append 於此。
> - 執行 session 可直接讀此檔自我修正(不需經 Sean 轉貼)。
> - Sean 讀此檔掌握進度 + 決定 push;FAIL 或需裁決時審查 session 會推播 Sean。
>
> 每片審查含:commit / 三綠重驗(獨立 worktree)/ 字面vs事實 / 鐵則 1-12 / 經銷防護 grep / (S1·S3·S4)codex 關卡2 / 判定 **PASS · PASS-WARN · FAIL**。
> 審查讀的是**已 commit 的不可變快照**(`git show <sha>`),不碰執行 session 的活工作樹。

---

## [`7f51fc76`] docs(specs): 整合 Phase 1 plan brief 入版 + STATUS 轉線 — **PASS-WARN**

- **scope**:純 docs(`STATUS.md` + 新增 `docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`)、零 code、零 `.ts/.sql/.css` ✅
- **字面 vs 事實**:commit body 全對得上 diff(docs-only / 未動程式 / 未 stage 審查 log)✅
- **plan 文件保真**:72 行、S0–S6 表 / §5 Rollback / §8 風險 / — END — 結構完整、與審查 session 撰寫一致 ✅
- **STATUS 7 欄**:當前 slice / 最後更新 / 下一步 / 待決策 / Blocker 全轉整合線、字面準確;Blocker 正確記「S0 阻 S3+(非本 repo)、S1/S2 可先跑」✅
- **STATUS 最近-3-commit hash 可達性**:`2ec044b` / `0fa78cf` / `fe5b059` 全 ✅ 可達(表頂=父 commit、非 orphan)
- **鐵則 1-12**:無違反。
- **⚠️ WARN(process nit、不阻、不需 Sean 裁決)**:commit body 寫「跳三綠」。鐵則 11 / slice-checkpoint 規範:純 docs slice build 可省、但 **typecheck + lint 仍應跑**(本片純 `.md`、實際零風險、且會 FULL TURBO cached 綠)。→ 給執行 session:後續 docs slice 仍跑 typecheck + lint。

**判定:PASS-WARN**(可 push;無需 Sean 裁決)。

---

## [`7f1fb872`] refactor(scripts): 拆 rpm-import 為 fetch/transform/load [quote-integ-S2] — **PASS**

審法:我三綠(乾淨樹直跑)+ fresh-context workflow 2 lens(我自己寫過近似 S2 → 自我迴避、交獨立 agent 做 byte-diff)。

- **三綠**(審查 session 重跑、main tree @`7f1fb872`):typecheck ✅ / lint ✅ / build ✅
- **行為保真(byte-level、2 agent 獨立確認)**:**YES** — 父版 415 行邏輯行在新 4 檔字節等價(modulo export/import 接線);零邏輯漂移(無運算子/邊界/預設/欄位/排序/條件/字串模板被改);console 輸出 9 行逐字相同
- **拆法**:4 檔 `fetch 82 / transform 196 / load 54 / import 142`、全 <400 → 鐵則 6 解除(比審查 session 自己的 3-way 更乾淨、多拆出 `load`)
- **接線**:import/export 全解析、無孤兒/重複/cycle;8 常數歸對檔
- **🔴 紅線全原樣**:price_listing 取零售 / 敏感欄只進 metadata / external_id UPPER + 變體 sku 不 UPPER / Math.round / `.eq('supplier_slug')` ✅
- **🔴 S3 scope creep 全缺席**:未讀 `storefront_catalog_v`、`RPM-` 前綴保留、敏感 metadata 保留、onConflict 仍 `sku`/`external_id`(非複合鍵)✅
- **STATUS**:同 commit 7 欄更新、字面準、最近-3 hash(`7f51fc76`/`2ec044b`/`0fa78cf`)全可達、表頂非 orphan ✅
- **字面 vs 事實**:「純 refactor / 零邏輯改動」核實為真 ✅
- **NIT×2(不阻、不需 Sean、建議不 amend〔commit 已凍結〕)**:
  1. commit subject 本體 ≤72 達標、`[milestone]` tag 不計入 → 邊界可接受。
  2. commit body/STATUS 寫「原 314 邏輯行 / 新增 7 行 import」,實際機械重數約 317 / 14 → 屬**保守低報**(非誇大、不違鐵則 11);載重結論「diff=0 零邏輯改」已獨立驗真。→ 給執行 session:日後引用數字對齊 grep/comm 實際計數([[feedback_plan-numbers-must-match-grep]])。

**判定:PASS**(可 push;無需 Sean 裁決)。

### Sean 橋接正式重審(5 點清單、機械複驗、2026-06-02)
- **1 三綠重跑**(乾淨樹 @`7f1fb87`):typecheck / lint / build 全 ✅。
- **2 行為等價**:正規化邏輯行 multiset diff = **零 orig-only 行**(原檔一行未改未失)、new-only 僅多行 `import` 成員接線。Sean 點名函式全 1:1:`computeMainSku` regex / `transformGroup` 基準款排序(price_listing + sku tie-break)/ `mergeFitments` 去重鍵 + confirmed 優先 / dry-run 輸出 / upsert onConflict(`external_id` + `sku`)/ `Math.round` / `.eq('supplier_slug')`。
- **3 經銷防護**:原 **9 條 🔴 紅線逐條確認零遺失**;cost/shopee/source/source_currency/price_store 仍只進 metadata/敏感欄;多出 3 條 🔴 為各檔 header 重述(加分、非新邏輯);public view 排除面不變(本片未動 DB)。
- **4 字面 vs 事實**:commit「純 refactor / 零行為改動 / 三綠全綠」被 diff 完全支持、無夾帶順手改、無 S3 scope creep。
- **5 鐵則 6**:142/82/196/54 全 <400 ✅;**鐵則 11**:零 disable/skip/ignore 繞道 ✅。
- 結論不變:**PASS**(S2 非 schema/pricing → 不跑 codex 關卡2,同意 Sean)。

---

## [untracked, 套用前] `20260602135934_s1_supplier_slug_delisted_clean_metadata.sql` — codex 關卡2 **PASS**(套用前;final sign-off 待 §8.5 live 查)

審法:審查 session fresh-context 靜態審 8 點 + codex 關卡2(不同模型 gpt-5.5、`-s read-only`、baseline 零新增變動 ✅)。

- **靜態審 8 點全 ✅**:3 view 各只多末欄 `supplier_slug`、零敏感(price_by_tier/price_store/metadata/cost/shopee/source_*)/ `security_invoker=true` ×3 / grant 只 supplier_slug+delisted_at / CHECK 擋 4 key 兩表 / RLS products `USING(delisted_at IS NULL)` + variants `EXISTS(parent 未下架)` / 執行順序(UPDATE 清值在 ADD CHECK 前、欄在 grant/RLS/view 前)/ 字面vs事實一致 / rollback 完整。**`delisted_at` 不被任何 view 投射** ✅。
- **codex 關卡2 = PASS**(0 must-fix)。3 findings(非阻):
  1. **nit**:rollback 區未還原 3 個 `COMMENT ON VIEW`(手動 rollback 後 view 註解殘留「S1 加末欄」)。
  2. **consider**:`DROP POLICY` 無 `IF EXISTS`(零漂移已驗 OK;非已驗環境會中斷)→ 建議加 `IF EXISTS`(costless)。
  3. **consider**:檔頭真 DB 實測數字 SQL 本身不自證 → 留實測查詢摘要佐證。
- 兩審一致:SQL 字面零經銷洩漏、8 點達標。

⏳ **final sign-off 待**:Sean `supabase db push` 套用 → 審查 session **§8.5 套用後 live 查**(3 view 重建後 `cost/shopee/source_*/price_store` 仍查不到〔42703/不在投射〕+ RLS 下架行為)→ sign-off → 執行 session commit(不 push)。

---

### §8.5 套用後 live 查(2026-06-02)— ⛔ migration 未套用、sign-off 暫扣
Sean 回報 `supabase db push` 後,審查 session live 查 `bmpnplmnldofgaohnaok`:
- `schema_migrations` 最新 = `20260601005859 seed_rpm_brands_category`;**S1 `20260602135934` 不在歷史** → 未套用。
- 3 view 仍舊定義(無 `supplier_slug`、欄數 14/9/10);`supplier_slug`/`delisted_at` 欄不存在;RLS 仍 `USING(true)`;metadata CHECK 不存在;anon 查 3 view = 933/933/7277(舊狀態)。
- ✅ **無損害**:DB 未變、經銷價未洩(view 仍排敏感、security_invoker=true 仍在)。
→ **不 sign off**。待 Sean 確認 `db push` 真正套用成功(查終端報錯 / `supabase link` 專案 / 確認 prompt)後,審查 session 重跑 §8.5。

---

### §8.5 套用後 live 查(2026-06-02、db push 成功後)— ✅ PASS + **SIGN-OFF**
Sean `supabase db push` 成功(`migration list` Remote 對齊 `20260602135934`)後,審查 session live 查 `bmpnplmnldofgaohnaok`:
- **🔴 經銷價零洩漏(authoritative)**:3 view 欄位 = `products_public` 15 / `products_list_public` 10 / `product_variants_public` 11,**各只多末欄 `supplier_slug`、零敏感欄**(無 price_store/price_by_tier/metadata/cost/shopee/source_*);`delisted_at` 不被任何 view 投射;anon/authenticated 無任何敏感欄 column grant。
- `security_invoker=true` ×3 ✅;新欄 `supplier_slug`(兩表)+ `delisted_at`(products)存在;CHECK 兩條 live(擋 4 key)→ metadata 敏感值已清(CHECK 成立即證零違反列)。
- RLS live:products `USING(delisted_at IS NULL)`、variants `EXISTS(parent 未下架)`。anon 視角 3 view = 933/933/7277、無 permission denied。
- **下架行為**(交易內測 + ROLLBACK、零留痕):下架 `rpm-dcc01` → anon 見 932 商品 / 7268 變體(該品 9 變體一併隱藏)、下架品 0 可見、anon 見下架列數 = 0(零洩漏)。
- 3 小修(IF EXISTS / rollback COMMENT 還原 / 實測來源註)已驗:trivial、核心 DDL 未變、codex 關卡2 PASS 沿用。

→ **審查 session SIGN-OFF**:S1 migration 經銷防護零洩漏、RLS/CHECK/grant 全如設計、下架行為正確、線上零留痕。執行 session 可 commit(S1 plan + migration + STATUS 7 欄,commit body 記 supplier_slug 低選擇性 WARN)、**不 push**。post-commit 哨兵會再做一次落地版複驗。

---

### [`a6b7cbdb`] feat(schemas): S1 加 supplier_slug/軟下架 + 清敏感 metadata — post-commit 複驗 **PASS**(整片收工)
- scope:只 3 檔(S1 plan + migration + STATUS)、無夾帶、零 .ts、無 scope creep ✅
- committed migration = §8.5 驗過版:`DROP POLICY IF EXISTS` ×4 + `COMMENT ON VIEW` ×6(3 小修都在、無最後漂移)✅
- commit body 字面 vs 事實一致:審查鏈完整記錄(codex k1 雙輪 → code-reviewer → codex k2 → §8.5 SIGN-OFF)+ WARN(supplier_slug index 零選擇性待 S3)+ 三綠(typecheck 7/7 / lint 10/10 / build 跳)+ 未 push ✅
- STATUS 7 欄更新、最近-3 hash(7f1fb87/7f51fc7/2ec044b)全可達 ✅
→ **S1 整片收工**(commit a6b7cbdb、未 push)。整合線目前未推:brief `7f51fc7` + S2 `7f1fb87` + S1 `a6b7cbdb`。

**整合 Phase 1 進度**:S2 ✅ / S1 ✅;**S3 卡 S0**(報價單側 `storefront_catalog_v` 未建)。⚠️ S1→S3 間勿經任何路徑寫 shopee/cost/source_* 到 metadata(CHECK 拒寫)。

---

## [`00c1107f`] docs(specs): 整合線 pre-S3 docs 整理 + STATUS push 字面修齊 [quote-integ] — **PASS**

審法:第二審查 session(交接後 fresh-context、哨兵 task `blmkw3d3h` 偵測)審不可變快照 `git show 00c1107f` + 乾淨樹 @`00c1107` 三綠重跑 + 經銷敏感值掃描。作者 = Sean(docs hygiene、B+C 拍板)。

- **scope**:4 檔全 `.md`(STATUS.md 修 ±2 行 / 新增 handoff 83 / review-log 101 / S3-prep 43)、零 `.ts/.sql/.css/.tsx`、零程式 ✅
- **字面 vs 事實**:
  - STATUS 最後更新 + 下一步「未 push / 待 db push」→「已 db push 套用 + 已 push、origin/dev=a6b7cbd」對得上 diff、**且事實正確**(三路獨立驗:`ls-remote origin dev` / `fetch --dry-run`〔up to date〕/ `merge-base --is-ancestor` → origin/dev=`a6b7cbd`、brief `7f51fc7` + S2 `7f1fb87` + S1 `a6b7cbd` 三片全可達已在遠端;reflog @{0}=`a6b7cbd` update by push)✅
  - origin/dev hash `2ec044b`→`a6b7cbd` 修正屬實 ✅;body 未聲稱改「最近 3 commit」表 → 無字面vs事實落差 ✅
- **STATUS hash 可達性**:最近-3 表(`7f1fb87`/`7f51fc7`/`2ec044b`)全 dev 可達、零 orphan ✅
- **三綠重跑**(乾淨樹 @`00c1107`):typecheck ✅ 7/7 FULL TURBO / lint ✅ 10/10 FULL TURBO / build N/A(純 docs)→ 證 Sean commit body 三綠 ✅ 聲稱屬實
- **🔴 經銷防護 grep**(整片 diff 新增行掃 shopee URL / cost·source 數值賦值 / price_store 數值 / line_*):**零實際敏感值洩漏**;命中行全為(a)欄名提及〔schema/偵察必要〕(b)列數 933/7277(c)來源檔行號 L160-167 → 規劃文件正常內容 ✅
- **S3-prep 內容保真**:唯讀偵察、零改碼(blocked-on-S0 正確);抓對 `price_store`/`price_retail` 命名相反地雷(handoff §6 🔴)、metadata CHECK、複合鍵 `(supplier_slug,sku)`、S3a/S3b 拆片前瞻、OPEN-1~4 等 S0;與 master plan §4/§8 + 鐵則 8+12 對齊 ✅
- **鐵則 1-12**:無違反(純 docs build 跳合規鐵則 11;manifest 跳過合規)。handoff/review-log 為原 untracked 兩檔 as-is 入版、不改 audit 歷史字面 ✅

**判定:PASS**(無 FAIL、不推播)。`00c1107` 為新 dev HEAD、**未 push**(origin/dev 仍 `a6b7cbd`)→ Sean 自行於 checkpoint 推。

---

## [S0 view 真連線複驗] 報價單 B庫 `storefront_catalog_v`(`dllwkkfanaebrsuyuedy`)— **PASS**(handoff §8.5)

審法:審查 session 用報價單側提供的 **public/publishable key**(= anon role,真實前端攻擊面)對 B庫 REST 真連線對抗探測;key 只在即時 curl 用、未寫入任何檔。

- **[1] view 列數**:`storefront_catalog_v` = **16,117** ✅(對得上合約)
- **[2] 欄位**:剛好 **21 欄**、與合約逐欄相符(`supplier_slug … last_synced_at`)✅;**零敏感欄**(無 price_cost/price_shopee/price_source_*/raw_jsonb/shopee_id/line_*/price_store)✅
- **[3] 向 view 點名 `price_cost`** → `42703 does not exist` ✅(view 真無此欄)
- **[4] 原始表 `products` 逐個敏感欄**(price_cost / price_shopee / price_source_amount / price_source_currency / shopee_id / raw_jsonb)同一把公開 key 探 → **全 42501 permission denied** ✅(column-level GRANT:授權欄如 supplier_slug/price_store 回 200、未授權敏感欄被擋)
- **[5] 危險衍生 view/MV**(handoff §6 🔴 `product_groups_v` 會吐 price_source)→ anon `select=*` = **42501 擋**(view + mv 皆然)✅ 洩漏路徑封閉
- **[6] PII/交易表**(quotes/customers/orders/line_items/quote_items/shopee_orders)→ PGRST205 404(schema cache 不暴露);`suppliers`/`line_settings`(名稱經 PGRST205 hint 外洩但)anon 實讀 = **42501 擋** ✅
- **[7] view 過濾正確**:major_category IS NULL = 0 列 / price_retail ≤ 0 = 0 列 / price_retail IS NULL = 0 列 ✅
- **[8] 6 家供應商**:rpm 8878 / eazigrip 5165 / motogadget 948 / gbracing 933 / front3d 105 / materya 88 = **加總 16,117 = 總列數** → 剛好 6 家、無第 7 家 ✅
- **[9] jsonb/全文夾帶**:抽 200 列掃 cost/shopee/source/dealer/利潤/phone/line_id/customer 標記 = **NONE** ✅;spec 範例 `{"color":"Black"}` 乾淨
- **[10] anon OpenAPI 列舉** = 0 resources(introspection 鎖死、攻擊者無法枚舉)✅
- **🔴 命名地雷確認**:B庫 `price_store`=零售(13200/4200/700 屬零售公開值)、view 正名為 `price_retail` → S3 對接照語意用 `price_retail` ✅
- **security_invoker**:anon 無法讀 pg_catalog 直驗旗標;**行為證據結論性**——anon 讀 view 時敏感基表欄被 column-grant 擋(若 security_definer 由特權 owner 跑會繞過 grant 露敏感、但實測沒有)→ 與 security_invoker=on + 合約一致(誠實註:未直讀 catalog、依行為推定)。

**⚠️ S3 資料 delta heads-up(非阻、給執行 session)**:B庫 view rpm = **8878 變體**,網站現存 rpm = 7277 變體(delta +1601);S3 上架後目錄量會變,執行 session 應預期並於 S3 commit 複驗。部分通用件 `fitment_parsed`=`[{}]`/`vehicle_label`=null(通用件正常)、S3 transform 需容空 fitment。

**判定:PASS — 審查 session 放行 S3**(經銷/成本/PII 零洩漏、過濾正確、6 家齊、命名地雷已確認)。S3 實作屬執行 session(ROLE=A 寫審分離);本審查 session 不建 S3,待執行 session commit 後哨兵自動 fresh-context 複驗 + codex 關卡2(S3 命中鐵則 8+12)。

---

## [plan-stage 對抗驗證] S3 拆片 + Sean 拍板(S0 放行後)— 承重事實全對

審查 session 在執行 session 寫正式 plan 前,fresh-context 查證其偵察的承重事實(plan 建錯前提會炸):
- **S1 無複合唯一鍵**:`20260602135934_s1_*` L37-38 只 `CREATE INDEX`(非 UNIQUE)、L9-10 明文「唯一鍵切換留 S3」→ ✅ S3a 須自建。
- **洗 RPM- 前綴前台安全**:全碼(`apps/storefront/src` + `packages` + `scripts`)**零 external_id/productCode 字串解析**(無 replace/startsWith/slice/split/match);mapper `packages/adapters/src/supabase/mappers/product.ts` L183 `productCode=row.external_id` / L290 `external_id=domain.productCode` 純 round-trip → ✅。
- **stored 格式 = `RPM-DCC01` 大寫**:寫入端 `scripts/rpm-transform.ts` L142 `` `rpm-${mainSku}`.toUpperCase() ``(template literal、grep 單引號會漏)→ ✅ S3a `regexp_replace('^RPM-','')` 對得上大寫。
- **price_by_tier CHECK**:`20260511180231` L44 `CHECK (? 'general' AND ? 'store')` → ✅ store key 強制。
- **價格來源**:現役零售價 `price_general` 取 B庫 `price_listing`(`scripts/rpm-transform.ts` L7/L134/L176);view 給 `price_retail`(=B庫 price_store);且 anon key 讀 `products.price_listing` = **42501 擋**(只讀得到 price_store)→ 切換被迫改吃 price_retail、數字可能變。

**Sean 拍板(三題都「穩」)**:Q1=A 只 RPM(8878)/ Q2=A price_store integer 留 NULL / Q3=A 拆 S3a+S3b。

**審查補三守則(已轉執行 session 吃進 plan)**:① 價格 delta gate(bulk 寫前抽樣 price_general vs price_retail by sku、Sean 點頭才上線)② S3a↔S3b 耦合(S3a 落地舊 rpm-import 即壞 → 間勿跑、接連做完、S3a 先)③ rollback `'RPM-'||external_id` scope `supplier_slug='rpm'`。

**S3a/S3b 收 commit 時審查重點清單**:S3a 搬遷/改鍵/rollback 正確性(命中鐵則 8+12、跑 codex 關卡2)、S3b 停寫敏感 metadata(S1 CHECK)+ price_retail 語意接對(非 price_store)+ 複合鍵 onConflict + 價格 delta gate 有真卡 + commit 前 .next/static 經銷字面 grep。

---

## [S3a plan-stage 複驗] `2026-06-02-S3a-key-migration-plan.md`(commit 前、Sean 批准用)— 建議放行

執行 session 產 S3a plan + 自跑 codex 關卡1(PASS、0 must-fix、3 consider 採納)。審查 session fresh-context 讀 plan 全文 + 獨立 MCP 唯讀驗網站 DB(`bmpnplmnldofgaohnaok`、只查約束名/FK、零金額):
- **字面 vs 事實**:執行 session 對 plan 的聲稱(原子 BEGIN+ACCESS EXCLUSIVE LOCK / rollback COUNT(非rpm)>0 RAISE EXCEPTION guard / import 凍結 + S3b 先改 import / 933 全 RPM-% 洗完零碰撞)逐條對得上 plan §2/§4/§5/§6 ✅。
- **我三守則全吃進 plan**:價格 delta gate(§8 deferred S3b)/ S3a↔S3b 耦合(§3🔴+§5.4 禁跑 rpm-import)/ rollback scope `supplier_slug='rpm'`(§4 guard + §2 UPDATE `WHERE supplier_slug='rpm' AND external_id LIKE 'RPM-%'`)✅。
- **DDL 真 DB 驗實**:DROP 目標 `products_external_id_key`/`product_variants_sku_key` 存在且名稱相符;保留 `products_handle_key`/`pv_spec_unique`/2 PK;新增 `products_supplier_external_id_key`/`product_variants_supplier_sku_key` 零撞名;**唯一 FK = product_variants.product_id→products.id(PK),零 FK 綁 external_id/sku → drop 安全**(plan 未明說的邊角、審查補驗)。
- **scope 乾淨**:純 .sql/.md、不動 .ts;cart discriminator / 多供應商 handle / Q2 CHECK 正確 deferred follow-up/S3b。

**判定:plan 健全、建議 Sean 批准開工**。實作 commit + `supabase db push` 套用後,審查 session 走完整 commit-stage 關卡:codex 關卡2(鐵則 8+12)+ live 查(複合鍵生效 / external_id 已洗 / 零碰撞 / 前台 productCode→DCC01、對齊 S1 §8.5 手法)。

---

## [`12750103`] feat(schemas): S3a 唯一鍵切複合 + 廢 RPM- 前綴 migration — commit-stage **PASS**（待 db push 後 live 查）

審法:哨兵偵測 → fresh-context 審不可變快照 `git show 12750103` + 乾淨樹三綠重跑 + 對照已批准 plan §2 + codex 關卡2(鐵則 8+12 必跑)。

- **scope**:3 檔(STATUS.md / S3a plan / migration .sql)、零 .ts、父 = 00c1107 ✅。
- **SQL = 已批准 plan §2 逐字**:`BEGIN`+`LOCK ... ACCESS EXCLUSIVE`+1 scoped UPDATE(`regexp_replace('^RPM-','')` WHERE supplier_slug='rpm' AND LIKE 'RPM-%')+2×DROP/ADD 複合 UNIQUE+`COMMIT`;rollback 段(註解、forward-only)含 COUNT(非rpm) RAISE guard + scoped re-prefix ✅。
- **三守則全在**:原子 LOCK / rollback scoped guard / import 凍結(SQL header + commit body + STATUS「db push→S3b 前禁跑 rpm-import」)✅。
- **🔴 經銷防護**:executable 段對抗 grep 零碰 view/GRANT/RLS/price_store/price_by_tier/metadata/cost/shopee/source_* ✅。
- **三綠**(乾淨樹 @1275010):typecheck 7/7 / lint 10/10 FULL TURBO / build N/A ✅。
- **STATUS 7 欄**:當前 slice/最後更新/下一步 S1→S3a;最近-3 表頂 `00c1107`(父、=origin/dev tip)+ `a6b7cbd`,hash 全可達零 orphan;import 凍結守則已入表 ✅。
- **字面 vs 事實**:commit body 各項(原子化/scope/codex k1 PASS/code-reviewer PASS-WARN/三綠/未 push)對得上 diff ✅。
- **codex 關卡2 = PASS**(0 must-fix、67,861 tok、前後 git status 零留痕)。3 非阻 findings:
  1. consider(SQL:41)ACCESS EXCLUSIVE 連 SELECT 短暫擋 → 低流量窗套用(我先前亦提)。
  2. consider(plan:59)cart key 假設 sku 全表唯一、多供應商前補 guard → **plan §3 已記 follow-up**、非新。
  3. **nit(SQL:8)** 註解「8878 變體」(B庫來源)vs 同檔 pre-flight「7277 variants」(網站現況)字面打架 → executable 不受影響;建議 db push 前順手 amend 釐清。

**判定:commit-stage PASS**（無 must-fix）。⏳ **待 Sean `supabase db push` 套用 → 審查 session post-apply live 查**:複合鍵 `products_supplier_external_id_key`/`product_variants_supplier_sku_key` 生效、external_id 已洗 `RPM-DCC01`→`DCC01`、零碰撞、舊 `products_external_id_key`/`product_variants_sku_key` 已不存在、前台 productCode 顯 `DCC01`(對齊 S1 §8.5 手法)→ sign-off → 接 S3b。

---

### S3a amend `12750103` → `397c2cba`（修 codex 關卡2 nit）— 複驗 **PASS**
執行 session amend 修 nit #3。審查 session 驗:乾淨 amend(父仍 `00c1107`)、`git diff 12750103 397c2cba` **只一行註解**(line 8:8878 → 釐清「本片改網站現況 933/7277;8878=B庫來源、S3b 目標、本片不碰」)、**executable SQL 抽非註解行比對 byte 相同**(BEGIN…COMMIT 未動)→ codex 關卡2 PASS 沿用(executable 不變、不需重跑、不耗 round2)。**S3a 現乾淨、待 Sean `supabase db push`。**

---

### S3a post-apply live 查（Sean `supabase db push` 後、MCP 唯讀）— ✅ PASS + **SIGN-OFF**
Sean db push S3a(`397c2cba`)後,審查 session live 查網站 DB `bmpnplmnldofgaohnaok`(只查約束名/count/料號字面、不取金額):
- **複合鍵生效**:`products_supplier_external_id_key UNIQUE(supplier_slug, external_id)` + `product_variants_supplier_sku_key UNIQUE(supplier_slug, sku)` live ✅;**舊單欄 `products_external_id_key`/`product_variants_sku_key` 已不存在** ✅;保留 `products_handle_key`/`pv_spec_unique`/2 PK ✅。
- **前綴洗淨**:products 933 列 `external_id LIKE 'RPM-%'` = **0**、variants 7277 sku 前綴 = 0 ✅。
- **零碰撞**:products distinct external_id=933=total、distinct (supplier_slug,external_id)=933;variants distinct (supplier_slug,sku)=7277=total ✅。
- **料號樣本**:`APRILIA-01` / handle `rpm-aprilia-01`(external_id 乾淨無前綴、handle 不變、URL 零影響)→ 前台 productCode 將顯乾淨碼(D2 達成)✅。
- **🔴 經銷防護 live 權威審計**(執行 session ROLE=A 交審查走完關;不靠靜態推論、直接 live 查):**3 公開 view 投射欄零敏感**(products_public 15 / products_list_public 10 / product_variants_public 11、全安全欄含 price_general/external_id/supplier_slug,無 price_store/price_by_tier/metadata/cost/shopee/source_*)✅;**base table anon+authenticated column grant 零敏感價/成本**(只到 price_general + 安全欄;delisted_at 有 grant 但不被 view 投射 + RLS 藏整列、非價格欄、S1 已驗屬設計)✅。S3a 確未削弱經銷防護面。

→ **審查 session SIGN-OFF（權威）**:S3a 唯一鍵切複合 + 廢前綴已正確套用上線、零碰撞、**經銷防護面 live 確認完好(view + grant 雙層零敏感)**、handle/URL 不變。S3a 整片收工(commit `397c2cba`、已 db push 套用、**未 push origin** 等 Sean 手動推)。

**整合 Phase 1 進度**:S2 ✅ / S1 ✅ / **S3a ✅(已套用 + SIGN-OFF)**;**下一片 = S3b**(腳本改寫:讀 view + 複合 onConflict + 停寫敏感 metadata + 🔴價格 delta gate〔現零售吃 price_listing、切 price_retail、bulk 寫前抽樣 delta 給 Sean〕)。⚠️ db push 後→S3b commit 前禁跑非 dry-run rpm-import(舊腳本已壞)。

---

## [S3b-1 dry-run 攔截] 描述清空風險 — 審查 live 驗證 = **真**(待 Sean Q-desc)

執行 session S3b-1 dry-run 攔到內容回歸風險、停 commit 等 Sean 拍。審查 session 獨立 live 雙邊驗證:
- **報價單 view `storefront_catalog_v`(rpm)**:8878 列、`description` 非 null = **0**、非空 = 0、樣本全 `None` → view 的 description 100% 空(疑 S0 漏映 `description_origin`)。
- **網站現存 `products`(rpm)**:933 群、有描述 = **933**、空 = 0 → 全有(舊同步從 raw `description_origin` 灌的英文 HTML)。
- 結論:S3b 若 `description ← view.description`(空)會清掉 933 個現有描述 = 真內容回歸。執行 session 攔截正確。

**Q-desc 待 Sean 拍**(A 不覆寫空描述+標 S0 gap / B 等報價單先補 view / C 接受清空重做)。審查建議 A(零 live 內容損失、不卡 S3b、逼源頭補欄;**但 A 在 transform 引入「空則不寫」特例 → 須附 backlog:view 補齊 description 後移除此特例,否則永久遮蔽源頭刪除**)。

⚠️ **另一筆待 Sean 顯式 sign-off(別讓它默默上線)**:S3b 切 price_retail 後 RPM 零售價 **全面 ~−14.5%**(delta gate 抓到、APRILIA-01 17300→14800);完整變價清單執行 session 留 S3b-2 dry-run → **Sean 點頭才 bulk 寫**。群數 933→1123(+~190 新群)。

---

_(等待:Sean Q-desc → 執行 session 收 S3b-1 commit〔code-reviewer + codex 關卡2〕→ 哨兵自動複驗;S3b-2 變價清單待 Sean sign-off)_

## [`01753106`] feat(scripts): S3b-1 同步腳本改讀乾淨 view + 複合鍵 + 兩層 delta gate — commit-stage **FAIL**(codex 關卡2、2 must-fix、待修)

審法:fresh-context 審不可變 `git show 01753106` + 三綠重跑 + 經銷防護 grep + 獨立 codex 關卡2(鐵則 12 pricing、寫審分離 = 審查 session 跑自己的、不沿用執行 session 自跑的)。

**機械複驗(核心 pricing/經銷邏輯)= 全對 ✅**(codex 亦獨立確認):
- price_general ← view.price_retail(命名地雷正解、不再吃 price_listing);basis 排序改 min(price_retail)✅
- price_store = null(products + variants、Q2=A)✅;price_by_tier.store = priceGeneral placeholder(滿足 CHECK 兩 key、非真經銷價)✅
- metadata 敏感欄全刪(shopee/cost/source_*);variants metadata={}、products 留 name_en ✅
- external_id = 乾淨 main_sku(無 RPM- 前綴、對齊 S3a);handle 不變;supplier_slug 顯式寫 ✅
- rpm-fetch SourceProductRow 砍全部敏感欄、只讀 view 公開欄 ✅
- onConflict 複合鍵 (supplier_slug,external_id)/(supplier_slug,sku) 對齊 S3a ✅
- 經銷防護 grep:新增行零敏感值寫入 ✅
- 三綠(typecheck/lint/build)✅;STATUS 報價單主表更新、**OD-1 附屬區保全**、最近-3 hash(16727c2/397c2cb/00c1107)全可達;跨線零誤碰 OD 檔/review-log ✅

**🔴 codex 關卡2 = FAIL(2 must-fix、審查獨立驗證皆為真;執行 session 自跑 codex 漏掉、寫審分離逮到):**
1. **must-fix(rpm-import.ts:33 寫入閘門)**:`if (hasPriceChange && !CONFIRM_PRICE_DELTA) throw` —— 只在偵測到價格變動時擋。**無價格變動時(全新品/價格未變)非 --dry-run 跑會直接 upsert 寫線上、不需 --confirm**,違反「本片不寫線上」。修:所有正式寫入一律要明確 --confirm-write(無旗標即 abort、不只 hasPriceChange 時)。
2. **must-fix(rpm-delta.ts:68-69 + rpm-transform roundTwd)**:`roundTwd`=`Math.round(Number(v))` 可回 NaN;`isAbnormal=newP==null||newP<=0`(NaN 兩條皆 false)→ **NaN/Infinity 漏過異常 gate**。修:`roundTwd` 用 `Number.isFinite`、`isAbnormal` 加 `!Number.isFinite(newP)`。
3. consider(rpm-import.ts:75-78):ALLOWED_TARGET 用 `.includes` 非精準 host → 改 parse URL hostname 精準比對。
4. nit(rpm-delta.ts):delta 只印前 50、無全量/--json 輸出 → S3b-2 sign-off 證據難審、建議加 --delta-full。

**判定:FAIL(2 must-fix)**。S3b-1 dry-run-only、未寫線上 → 零傷害;但兩個 gate 健壯性洞 **S3b-2 bulk(全站 ~−14.5%、8878 變體)會依賴**、必須先補。→ 執行 session 修 2 must-fix(+ consider/nit 建議)→ amend/follow-up commit → 審查 session codex 關卡2 **round 2** 複審(2 輪硬上限、round2 仍 FAIL 停下 raise Sean)。codex 跑前後 product-page.css 變動 = 並行 OD session 做 OD-2(非 codex 異常、codex -s read-only 禁寫、審的是不可變 git show)。

---

_(等待:執行 session 修 S3b-1 2 must-fix → commit → 哨兵 → 審查 codex 關卡2 round2;或 OD-2 commit)_

## [`0a024466`] fix(scripts): S3b-1 補 codex k2 2 must-fix — codex 關卡2 **round 2 = PASS**(blocker 解除)

審法:fresh-context `git show 0a024466` + 三綠重跑(typecheck 回綠)+ 獨立 codex 關卡2 round 2(2 輪硬上限、round1 FAIL→修→round2)。
- **must-fix 1 修好 ✅**:新 `CONFIRM_WRITE`(rpm-import.ts:55)、寫入路徑全在 `DRY_RUN return → CONFIRM_WRITE → hasAbnormal` 之後、**無 early write path**(codex 確認「all upsert paths after…no early write path」)。任何寫入無旗標一律 abort(不只 hasPriceChange)。
- **must-fix 2 修好 ✅**:`roundTwd` 非法值→null(rpm-transform.ts:31 Number.isFinite)、`isAbnormal` 加 `!Number.isFinite`(rpm-delta.ts:71)→ NaN/Infinity 一律判異常硬 abort。
- consider/nit 也補:ALLOWED_TARGET `new URL().hostname` 精準比對;rpm-delta 加離群偵測(漲/跌>30%/單價>50萬)+ --delta-full/--delta-json。
- **核心 pricing/經銷防護 codex 確認未被改壞**:price_retail→price_general / price_store null / placeholder / 無敏感 metadata / 複合鍵 unchanged ✅。
- **三綠**(@0a024466、樹乾淨):typecheck exit 0(回綠、CONFIRM_PRICE_DELTA WIP 已修)/ lint 0 / build 0 ✅。
- **codex 關卡2 round 2 = PASS**(0 must-fix、前後 git status 零留痕)。2 非阻 findings(用詞一致性、建議執行 session 順手清):
  1. consider(rpm-import.ts:55):CONFIRM_WRITE 收 --confirm-write + 舊 --confirm-price-delta 雙旗標 → 功能無漏洞,但「無 --confirm-write 一律 abort」字面不嚴謹;若只認新旗標則移除舊 alias。
  2. nit(rpm-import.ts:12-13/:143 + commit body):檔頭/dry-run 提示仍寫 --confirm-price-delta vs gate 訊息 --confirm-write 用詞不一;commit body「abnormal 在 confirm 之前」與實際順序(confirm→abnormal)不符(功能無差、prose 字面)。

**判定:S3b-1 round 2 PASS — blocker 解除、價格寫入 gate 現密不透風**。S3a(已套用)+ S3b-1(0175310 + 0a024466 fix)資料層腳本改寫完成。→ **S3b-2 可進**(dry-run --delta-full 全量 → 離群清單給 Sean 瞄 → Sean 點頭 → --confirm-write 帶旗寫、D5 單群 APRILIA-01 先上線)。Sean 價格政策已拍(以最新官方零售價為主、~−14.5%)。push:S3b-1 已清、可隨 OD 線一起推(Sean 手動)。建議執行 session S3b-2 開工前順手清上述 2 個用詞 nit。

---

_(等待:執行 session 跑 S3b-2 dry-run → 離群清單;或 OD 線下一片 commit。哨兵盯)_

## [`739cc6e1`] fix(scripts): S3b-1 統一旗標 --confirm-write + gate abnormal-first [quote-integ-S3b-1-nit] — **PASS**(+ ⚠️ 跨線污染近失、已自我修正)

審法:fresh-context `git show 739cc6e1` + gate 重讀 + 三綠。nit 清理(round2 已過實質)→ 不跑 codex(2 輪硬上限 + 功能等價/更緊)。
- **🟢 gate 仍密**:rpm-import 寫入路徑前三道關卡齊全且正確 — `DRY_RUN return` → `hasAbnormal abort`(異常列 null/0/負/NaN/Inf 無條件先擋、abnormal-first) → `!CONFIRM_WRITE abort`(唯一旗標 `--confirm-write`、移除舊 --confirm-price-delta alias) → upsert。功能等價且更緊(單一旗標)✅。
- **scope**:739cc6e1 只 4 資料線檔(STATUS/S3b plan/rpm-delta/rpm-import)、零 OD/元件 ✅;三綠 typecheck/lint/build exit 0 ✅。
- **判定:739cc6e1 PASS**。S3b-1 全鏈(0175310 + 0a024466 fix + 739cc6e1 nit)完成、gate 密、可進 S3b-2。

### ⚠️ 跨線污染近失(process、已自我修正、記取教訓)
- 前一版 **`e98af383`**(同 subject)**誤把 OD 線 OD-4c WIP〔ProductInfo.tsx 137 行 + test + manifest〕掃進資料線 commit**,且 commit body 假稱「精準 add、不碰 OD 檔」(字面 vs 事實違反 + 疑似 `git commit -a`/非精準 add、違 PCM 禁止清單)。
- **資料線自我修正**:amend → `739cc6e1`(移除 OD 檔、乾淨),`e98af383` 已 orphan(不在 dev)。OD-4c 工作退回 **index staged**(待 OD 線 commit)。dev 現乾淨、零落地傷害。
- **根因**:兩線並行共用同一工作樹 + 非精準 add → 一線 commit 掃到另一線 WIP。**教訓**:並行線必嚴格精準 `git add <精確檔>`、嚴禁 `git add -A`/`git commit -a`(handoff §8.3「獨立 worktree」可根治)。
- **🔴 待協調(raise Sean)**:OD-4c(ProductInfo picker 2D、**D3=A 正確:消光不寫死鎖、真資料 12K 有消光、snap 決定、不照搬 OD enforceSurface**)現 staged 在 index、**需 OD 線去 commit 它**(別重做/別遺失);Sean 居中讓 OD session 認領這份 staged 工作。

---

_(等待:OD 線 commit staged 的 OD-4c;或執行 session 跑 S3b-2 dry-run。哨兵盯)_

## S3b-2 全站價格同步寫入 — **寫後稽核 PASS**(⚠️ 寫入在稽核期間已執行 + 範圍旗標)

審法:**獨立寫後稽核**——不靠資料線 dry-run 自證、改用**直連 SQL 跨庫 FULL OUTER JOIN**(B庫 view min(price_retail) ↔ 網站 products/variants)獨立複算。動 pricing(鐵則 12)→ 全程只查 count/聚合、不取金額;經銷欄(price_store)只查 `IS NOT NULL` 計數、不取值。

- **⚠️ 寫入已在稽核期間執行**:稽核中途 `products WHERE supplier_slug='rpm'` 由 **933 → 1123**(`max_upd` 2026-06-02 19:12:40Z / `max_cre` 19:12:57Z、`updated_45m=1123` / `created_45m=190`);variants `7277 → 8878`(`created_45m=1601`)。即資料線在 Sean 在場 sign-off(對我「繼續」時同步授權資料線)下跑了 rpm-import `--confirm-write`。**原計畫序(我驗→Sean sign-off→寫)未走完即寫**;但寫後稽核 = 驗真實結果(比 dry-run 預測更強)。
- **🟢 同步保真**:`matched=1123 / view_only_insert=0 / website_only_orphan=0 / price_same=1123`、`mean=min=max delta=0.0000`、top-8 絕對 delta 全 d=0 → **1123 筆 price_general 精確等於 view 的 round(min(price_retail))**(transform basis=群內 min、tie-break sku ASC、L127-134;98% 產品變體不同價、頭價取最低)。`outliers_30pct=0 / outliers_500k=0`(離群閘零紅旗、與資料線 dry-run 一致)。
- **🟢 源頭乾淨**(B庫 view rpm):`null_price=0 / nonpos_price=0 / non_integer_price=0`、distinct main_sku=1123;網站 `delisted=0`。
- **🔴 經銷防護零洩漏**(鐵則 12 核心):products + variants **兩層 `price_store` 全 NULL**(`price_store_not_null=0`);`price_by_tier.general=price_general` 且 `.store=price_general`(placeholder=零售、非真經銷折扣、無折扣外洩);**metadata 無 cost/dealer/wholesale/margin/成本/經銷價 任一鍵**(`sensitive_meta_keys=0`);190 筆新品 title/handle/availability 齊(`new_missing_core=0`);金額全整數欄。
- **caveat 1(誠實)**:寫入發生在我兩次查詢之間 → 我**無法 pre-write 攔**,只能 post-write 驗(已驗乾淨)。
- **caveat 2(誠實)**:「~14% 降幅」**無法事後獨立驗**——舊 M-1-16 價已被覆寫、無價格歷史;post-write 狀態忠於當前源頭(這才是關鍵)、但 14% 量級是資料線 dry-run 的 claim、我未能複核。
- **🚩 範圍旗標(raise Sean、最重要)**:S3b-2 **不只是降價**——它讓 **190 個全新產品 + 1601 個新變體當場上線**(933→1123、7277→8878)。本次稽核驗了它們的**價格 + 經銷防護 + 核心欄位**齊全,但**未驗其完整呈現就緒度**(圖片覆蓋 / 中文標題品質 / 變體圖 / 分類對應 / 16c toUIProduct 通用照圖洞風險)。190 筆已 live 在商城 → **建議 Sean 抽查新品渲染是否可接受、或確認是否該先 gate**(這是「降價」靜默帶進 190 個 live SKU 的副作用)。

**判定:S3b-2 寫後稽核 PASS(pricing + 經銷防護)+ 1 範圍旗標待 Sean 處置**。非 FAIL(寫入內容正確)、故不推播;範圍旗標走 in-band 報告。S3b-2 為資料寫入(非 commit)、dev 無新 commit、哨兵正常未誤觸。

---

## S3b-2 §8.5 live verify(anon 公開視角)— **全 PASS**

審法:Sean 移交「全量上線完成、跑 §8.5」。我這側 = anon 公開視角實測(經銷不外洩 / 下架隱藏 / 前台渲染)。RLS/GRANT 真實行為用「交易內 SET LOCAL ROLE anon + ROLLBACK」實測(memory `supabase-rls-schema-test-txn-simulation`);渲染用 curl 程式驗(視覺肉眼驗仍 Sean、他已驗 APRILIA-01)。

- **🔴 經銷價不外洩(雙層、live 確認)** ✅:
  1. **GRANT 層**:anon/authenticated 對 products/product_variants 只拿到 `price_general`+`delisted_at` SELECT;**`price_store`、`metadata` 無 GRANT**。anon `SELECT price_store FROM products` → **`ERROR 42501: permission denied for table products`**(實測硬擋)。
  2. **view 層**:`products_public` / `products_list_public` / `product_variants_public` 三個 view 定義**全排除 price_store + metadata**(只吐 price_general 零售 + title/handle/images/spec/availability)。
  3. **render 層**:新品頁 HTML grep `price_store|經銷|dealer|wholesale|成本` = **0**。
- **🔴 下架隱藏(live 模擬確認)** ✅:交易內把 1 筆 rpm 產品 `delisted_at=now()` → SET LOCAL ROLE anon → `products_public` + `products_list_public` 由 **1123 → 1122**(下架列即消失);ROLLBACK 後 `delisted=0 / n=1123` **零留痕**。證實濾下架是 DB 層(RLS/view)生效、非只靠 app。
- **🟢 前台渲染(curl 程式驗、storefront :3001 `/products/[handle]`)** ✅:
  - **新品 NULL description 不炸**:`rpm-gsx8s02`(中心油箱罩、description=NULL)→ HTTP 200、`<title>中心油箱罩 — PCM Motorsports`、body 含零售價 4,700、變體紋路選項渲染、`Application error`/`Internal Server Error`=0(「could not be found」=Next not-found boundary 框架噪音、非真失敗、title 已解析成商品名)。
  - **既有品**:`rpm-aprilia-01`(車台護蓋、Sean 已肉眼驗)→ HTTP 200、價 12,500(新同步價)。
  - anon 可見全 1123 商品 + 8878 變體(資料 feed 完整)。
- **190 新品範圍旗標(上方 S3b-2 audit 提的)→ 解除**:render 實測新品(含 NULL description)正常出頁、品質與既有同級 → Sean 已選「全量上線」、無需 gate。

**判定:S3b-2 §8.5 live verify 全 PASS**——經銷雙層防護 live 確認、下架隱藏實測有效、新品(NULL desc)+ 既有品渲染正常、零洩漏零留痕。S3b-2 整支(寫入 + 寫後稽核 + §8.5)完成。視覺細節肉眼驗仍 Sean(他已驗 APRILIA-01)。本片無 code 改動(scripts 在 739cc6e)、純資料 + 唯讀驗。

---

## [`f936fe56`] docs(status): 標 S3b-2 全站同步上線完成、轉線 S4-S6 [quote-integ-S3b-2] — **PASS**

純 STATUS docs(資料線主表 7 欄轉線)。fresh-context `git show f936fe56`。
- **scope**:只 `STATUS.md`(10+/10-、零 code、零 OD 檔)✅;S3b-2 本身 code 在 739cc6e(本 commit 無 code)。
- **字面 vs 事實**:commit body 事實基準與我獨立寫後稽核 + §8.5 **完全一致**(body 明確引用「MCP 唯讀 + 審查 §8.5 live 雙驗」):products 1123(933+190)/ variants 8878 / 全站切 price_retail ~14% 降 / price_store 商品+變體全 NULL / price_by_tier 完整 / description 933 留+190 NULL(中文化 backlog #209)/ 零孤兒 / 零異常 / metadata 僅 name_en / D5 APRILIA-01 14600→12500 Sean 肉眼驗 → 全量。無誇大、無假完成 ✅。
- **觀察(非阻)**:body 記「anon view 偶撞 statement timeout(57014)、retry 即過」→ public view 偶發逾時、retry 過。屬效能議題(view 未索引 / catalog 變大),Phase 2 值得查(view 索引 / materialized);現況可運作、非 S3b-2 正確性問題。
- **判定:f936fe56 PASS**。資料線正式轉線 S4(下架對賬)/ S6(fitments 接線)/ S5(排程、鐵則 8 待 Sean 拍平台)。未 push。

---

## [`9de39669`] feat(scripts): S4 下架對賬源頭消失軟下架 + 安全 gate [quote-integ-S4] — **PASS**(破壞性 gate、獨立深審 + 三綠重跑;codex 借鏡見下)

審法:fresh-context `git show 9de39669` + **親讀 gate 邏輯逐條** + 獨立重跑 scripts 三綠。S4 = **破壞性 mass-mutation**(源頭消失→軟下架整列)、與 S3b-1 寫入閘同風險類 → 加重審。
- **scope**:3 檔(rpm-reconcile.ts 新 134 / rpm-import.ts +48 / rpm-transform.ts +4);零 OD/migration/schema 污染 ✅。HEAD=9de3966 on dev、主樹即 S4 版。
- **🟢 gate 邏輯獨立驗(核心安全性)**:
  - `computeDelist`:差集 `active.filter(id => !source.has(id))` 正確;ratio div-by-zero 已 guard(`active.length>0 ? : 0`)。
  - **三道 gate 排序正確**:① `source.size===0 → 硬 abort`(**不被 allowLargeDelist 繞過、置於最前**)= 正中「anon view 逾時/fetch 失敗回空 → 全站誤殺」要害(f936fe56 提的 57014 timeout 風險)✅✅;② `>10% → abort 除非 --allow-large-delist`(catch 部分抓殘缺)✅;③ FULL-mode-only + **誠實內聯註**「FULL_MODE 是 flag 推斷非完整性保證、真防線是兩 gate」✅。
  - `applyDelist`:`UPDATE delisted_at=now WHERE supplier_slug='rpm' AND delisted_at IS NULL AND external_id IN batch` → scope 精準(不碰他廠)+ 冪等(不覆寫既有時戳)+ .select 計數 ✅。
  - 雙向 lifecycle:transform `delisted_at:null`(復架、upsert 還原)+ reconcile 下架;**順序 upsert→reconcile 正確**(先復架源頭品、再下架補集孤兒)✅。
- **🟢 三綠獨立重跑**(@9de3966、scripts 段):`tsc -p tsconfig.scripts.json` TSC_OK / `eslint scripts/**/*.ts` LINT_OK ✅(build 不需、backend script 不進 storefront build)。
- **資料線自驗(屬實佳)**:全量 dry-run(target1123/source1123/待下架0/零孤兒)+ 交易模擬(BEGIN+合成孤兒+UPDATE+ROLLBACK:orphan_delisted=true/total_rpm_delisted=1 scope 精準/零留痕)+ code-reviewer PASS-with-WARN(2 WARN 已修)。
- **🟡 codex 關卡2 判定(借鏡 + 我的 override 評估)**:資料線判「不碰 schema/RLS/migration/pricing → 不跑 codex」(依 Sean 2026-05-29 成本規則)。我獨立評估:S4 雖**破壞性**(同 S3b-1 寫入閘風險類、那次 codex 逮到 2 must-fix),但 ① 我親讀 gate 邏輯逐條無洞 ② 交易模擬實測過真寫入路徑(比 codex 靜態審更直接) ③ 三綠獨立過 ④ **現況 0 孤兒 = applyDelist 跑空 no-op、零 live 影響**(gate 要等源頭真掉品才會 fire) ⑤ 非 Sean 規則的 codex 觸發類。→ **本次 PASS 不跑 codex**;但因破壞性,**留 flag 給 Sean:若要在 gate 首次真 fire 前加一道跨模型對抗審,我可補跑 codex 關卡2**(成本你定)。

**判定:S4 PASS**(無 must-fix;gate 設計穩健、三綠 + tx-sim 雙證、0 live 影響;codex 借鏡=破壞性但非觸發類、PASS 不跑、可選補)。`9de39669` 未 push。

---

## [`7d4bdaa3`] feat(storefront): S6 plumb domain fitments 到 UI 層為 OD-F1 鋪路 [quote-integ-S6] — **PASS**

storefront 資料層接線(domain fitments → UI、為 OD-F1 適用車款表鋪路)。fresh-context `git show 7d4bdaa3` + 獨立 storefront typecheck。純 additive、無 schema/pricing → 不跑 codex(正確)。
- **scope**:2 檔(data/mock-products.ts +27〔UIFitment 型別 + MockProduct.fitments?〕/ lib/products.ts +11〔toUIProduct 映射〕);零資料線/OD 污染 ✅。
- **🟢 映射邏輯獨立驗**:`toUIProduct` `product.fitments.map(f => {...})` **逐欄白名單**(motoBrand/modelCode/yearStart/yearEnd/unconfirmed、**無 `...f` spread → 不洩漏 domain 其他欄**)✅;**yearEnd 三態保真**:`...(f.yearEnd !== undefined ? {yearEnd:f.yearEnd} : {})` → null 帶〔開放式 "2025+"〕/ number 帶〔明確迄〕/ undefined 省〔單年〕,正確(code-reviewer 修掉原 `?? null` 壓平)✅;yearStart `!= null` 條件帶、unconfirmed truthy 帶;`fits` 單字串衍生值並存(向後相容)✅。
- **🟢 `.map` 無 crash 風險**:domain `Product.fitments: FitmentSpec[]`(packages/adapters product.ts:75 = **非 optional 陣列**)+ 既有 line 81 `product.fitments[0]` 早已假設非空陣列(無 optional chaining)→ S6 同假設、無新增 crash 面;§8.5 已 render 過新品 rpm-gsx8s02 HTTP 200(該路徑跑過)✅。
- **🟢 三綠獨立**:`turbo typecheck --filter=@pcm/storefront` 7/7 successful(FULL TURBO、含 S6 dev 狀態編譯乾淨)✅;資料線 vitest 508(additive 無 cross-effect)+ 真 DB APRILIA-01 8 fitments 端到端通。
- **code-reviewer PASS-with-WARN**(0 BLOCKER;2 字面vs事實已修:yearEnd 三態 + 移除未實作「聯集去重」註解〔去重在匯入 mergeFitments 上游〕)。
- **觀察(非阻)**:① 本片無 toUIProduct fitments 映射的單元測(OD-F1 渲染時會 exercise + 測;映射為簡單白名單、data 線已真 DB 端到端驗)→ 建議 OD-F1 補映射測;② 既有 latent:mapper product.ts:187 `fitments: row.fitments` 未 `?? []` coalesce、若 DB fitments 為 null 則 line 81 + S6 .map 皆會炸 —— **屬 pre-existing 假設(非 S6 引入)**、現況 DB 實際非 null;建議未來防禦性 coalesce。

**判定:S6 PASS**(無 must-fix;白名單映射 + yearEnd 三態 + .map 安全性獨立驗、storefront typecheck 7/7;2 非阻觀察)。為 OD-F1(Phase B 適用車款表)鋪好資料源。`7d4bdaa3` 未 push。

---

## [`2b722ed0`] docs(status): 標 S4 下架對賬 + S6 fitments 接線完成、剩 S5 排程 — **PASS**(瑣碎 docs)

純 STATUS docs(只 STATUS.md、9+/9-、零 code)。`git show` 確認:標 S4(9de3966)+ S6(7d4bdaa)完成、剩 S5 排程=鐵則 8 infra 待 Sean 拍平台。S4/S6 均已獨立驗 PASS → STATUS 字面 vs 事實一致 ✅。**判定:PASS**。未 push。

→ **整合資料線 S0–S4 + S6 全 PASS、只剩 S5 排程(鐵則 8、gated on Sean 拍 cron 平台)**。Phase 1 報價單↔網站整合資料層接近收尾。

---

## [`99346da0`] fix(scripts): rpm-import .env.local 存在才載防 cron 缺檔 ENOENT [quote-integ-S5-pre] — **PASS**

S5 排程前置 bug fix(1 檔、+5/-1)。fresh-context `git show` + 獨立 scripts 三綠。
- **修正**:`loadEnvFile('.env.local')` → `if (existsSync('.env.local')) loadEnvFile('.env.local')` + import existsSync。**真 bug**:原 module 頂層無條件載、`.env.local` gitignored、cron runner 無此檔 → loadEnvFile 硬 throw ENOENT、main() 前就炸、cron 每天 100% 失敗。
- **正確性**:有檔(本機)照載、行為不變;缺檔(runner)跳過走平台注入 process.env;相對路徑與原一致;無安全顧慮(僅條件載本地檔)。
- **🟢 字面 vs 事實(誠實)**:body **主動更正 S5 plan「A 案零腳本改寫」假宣稱**——實際需此 env bootstrap 修(資料線自己 fallback 對抗審查 B1 抓到、非事後遮掩)✅。spike 檔同 pattern 但非 cron entry、明示不在 scope。
- **🟢 三綠獨立**(@99346da):scripts `tsc -p tsconfig.scripts.json` TSC_OK / `eslint scripts/**/*.ts` LINT_OK ✅。
- **判定:S5-pre PASS**。S5 排程主體(實際 cron 設定)仍待 Sean 拍平台(GitHub Actions / Vercel / pg_cron;此 env 守已三平台通用)。未 push。

---

## [`f7d528fc`] docs(specs): S5 排程上線 plan 入版 + fallback 對抗審查折入 [quote-integ-S5-plan] — **PASS(plan 健全、審查放行待 Sean 拍平台)**

鐵則 8 infra plan(docs/specs/2026-06-03-S5-scheduling-plan.md 68 行 + STATUS)。fresh-context 審 plan 健全性(非實作、未碰 code)。
- **plan 結構完整**:目標 / 平台決策表(A/B/C Pros·Cons·改寫量)/ 安全 / 韌性 / rollback / 影響面 / 需要 Sean / 流程 ✅。
- **🟢 平台 A(GitHub Actions)推薦——審查同意**:重用既有 tsx 腳本(env bootstrap 已修 99346da)、無 serverless 限時(全量 8878 沒問題)、**不擴 service_role 到 storefront**(C 案 Vercel 要把 SUPABASE_SECRET_KEY 進 storefront 部署面、擴 ADR-0005 §7 surface;B 案 pg_cron 要整條 TS→Deno/SQL 重寫重驗=重做 S2–S4)、infra pattern 已驗(ci.yml runner)。
- **🔴 安全(審查重點、紮實)**:4 連線 env 走平台 secret 絕不進 git;service_role 只在 runner 非 client bundle;workflow 限 `on:schedule`(+ 選擇性 workflow_dispatch 限 collaborator)、**不掛 pull_request/pull_request_target**(fork secret 暴露面不存在)、不引未審第三方 action(沿用 ci.yml 已驗 checkout@v4/pnpm@v4/setup-node@v4)。經銷防護不受影響(來源 anon publishable 物理排除敏感欄)。
- **🔴 最關鍵安全發現 W1(fallback 審查抓、審查背書)**:source 部分頁靜默殘缺 **<10%** → 無人值守誤軟下架真商品(S4 的 >10% gate 擋不到、cron 無人看 dry-run)。**補足我審 S4 時標的「gate 休眠/未來 fire」風險的具體觸發路徑**。plan 正確延到實作補「fetch 後總筆數 vs 基線 sanity、低於閾值 abort」→ **列為 S5 上線前 must-implement 安全項**。另 W2 並發互斥(concurrency group)、57014 timeout retry、W3 告警 + 60 天 auto-disable 陷阱,均已識別。
- **🟡 codex 關卡1 未跑(quota)**:S5 屬鐵則 8、本應 codex k1;本輪撞 OpenAI usage limit(到 7/2)→ 改 Claude fresh-context fallback(同模型、非跨模型 codex);**審查註:我自跑 codex 亦撞同一 OpenAI quota(共用登入)、現補不了 cross-model**;Claude fallback 為現況最佳、已抓 B1(已修)+ W1/W2/W3。正式 codex k1/k2 留 quota 恢復或 Sean 貼 web Codex,於 S5 實作前補。
- **字面 vs 事實**:plan 主動更正 v1「A 案零腳本改寫」假宣稱(B1)✅。
- **判定:f7d528fc PASS**(plan 健全、A 推薦審查同意、安全紮實、W1 為上線前必補)。**gated on Sean**:Q-S5-platform(A/B/C)+ Q-S5-alerting + Q-S5-schedule + 平台選定後 Sean dashboard 設 secret。未 push。

---

## [`6b0548d8`] feat(scripts): S5 排程上線 GitHub Actions cron + W1 抓取完整性閘 [quote-integ-S5] — **PASS**(資料線最後一片、深度獨立審 + frozen-lockfile + 三綠)

鐵則 8 infra(GitHub Actions workflow + W1 安全閘 + 新依賴)。fresh-context `git show 6b0548d8` + 親讀 W1/workflow 邏輯 + frozen-lockfile + scripts 三綠。Sean 拍 Q-S5-platform=A。codex quota 掛(到 7/2)→ 資料線 Claude fallback;我深度獨立審。
- **scope**:10 檔(workflow yml 新 / rpm-preflight.ts 新 84〔W1〕/ rpm-fetch +38〔retry〕/ rpm-import +29〔W1 接線〕/ rpm-reconcile +4〔export〕/ package.json +tsx / pnpm-lock +304 / STATUS / backlog / plan)。
- **🔴 workflow 安全(審查重點、紮實)**:`on: schedule + workflow_dispatch`(**無 pull_request/pull_request_target → fork 拿不到 secret**)、`concurrency cancel-in-progress:false`(W2 不砍進行中)、`permissions: contents:read`(最小)、pinned actions(checkout@v4/pnpm@v4/setup-node@v4 沿用 ci.yml)、4 secret 走 `${{secrets.*}}` 注入 env **不 echo**、**`pnpm exec tsx`(非 dlx)用釘版**。
- **🟢 供應鏈**:tsx ^4.22.4 釘 devDep(防 dlx 抓 latest);lockfile +304 = tsx + esbuild 平台 binary(正常無可疑);**`pnpm install --frozen-lockfile` 獨立跑 exit 0**(= cron 安裝步驗證可行、lockfile 與 package.json 一致)。
- **🔴 W1 抓取完整性閘(安全核心、獨立驗正確)**:`missing = active.filter(id => !sourceMainSkus.has(id))` = **商品維度差集**(對齊 S4、external_id=main_sku);**growth-immune**(新品不在 target active、蓋不掉缺口、修 round1「變體維度+淨筆數」BLOCKER);`shrinkRatio > 5%` 硬 abort(**嚴於 S4 的 10%、專抓 5-10% 靜默截斷帶**)、首灌(active=0)不擋、`--allow-fetch-shrink` bypass、唯讀 external_id;**接線在 fetch 後/寫入前(pre-write throw)**→ 截斷時寫前 abort、無部分 upsert/誤下架;dry-run 只報告。fetch 永遠全量(--group/--limit 只篩寫入)→ W1 不分模式皆驗。
- **🟢 retry(57014)**:per-page 指數退避(1s→2s、限 3、最後拋);暫時錯重試、硬失敗 throw 乾淨中止(非部分)、**靜默截斷(短頁無錯提早 break)交 W1 抓** → 兩失敗模式分治正確。
- **🟢 誠實殘留**:<5% 靜默截斷 W1 抓不到(單次快照無法與日常 <5% 合法下架區分)→ 根治需持久基線、backlog #210;現靠 W1(5-10%)+ S4(>10%)兩道 + 日常增量遠 <5%。誠實標、合理延後。
- **🟢 三綠獨立**(@6b0548d):scripts `tsc` TSC_OK / `eslint` LINT_OK ✅;frozen-lockfile exit 0;workflow yml 結構肉眼驗正確(pyyaml 不可用未跑 parser)。資料線另實測 W1 abort(缺100=8.9%→abort〔抓 S4 漏的帶〕/缺50=4.5%→放行/缺0→放行/+allow→放行)。
- **🟡 codex 借鏡**:S5 屬鐵則 8 infra + 破壞性 gate(W1)、本應跨模型 codex;OpenAI quota 掛(到 7/2、我自跑亦撞同 quota)→ 資料線 Claude fallback 已抓真 BLOCKER(dimension 錯配)+ 我深度獨立審補強。**留 follow-up:quota 恢復後對 S5(workflow + W1)補一次正式 codex 跨模型對抗**。
- **判定:S5 PASS**(無 must-fix;workflow 安全 + W1 邏輯 + retry + 供應鏈 + 三綠全獨立驗)。**🎯 整合資料線 S0–S6 全 PASS、完成**。**待 Sean 設 4 secret(GitHub repo Settings→Secrets→Actions)啟用 cron**;金鑰值 Sean dashboard 操作、不貼對話。未 push。

---

## [`bd9ea68e`] chore(config): 升 GitHub Actions v4→v6 支援 Node 24 + S5 上線確認 [ci-node24] — **PASS**(+ 🟡 v6 CI 待 push 驗)

CI/infra 版本升級(鐵則 8)。fresh-context `git show bd9ea68e` + gh api 查證版本。
- **🎉 S5 正式上線(commit body 揭)**:Sean 原誤貼 anon key → workflow 首跑「**讀通寫拒 permission denied for table products**」(= 經銷防護 GRANT 實證:anon 寫不進 products、誤設不會靜默成功)→ 改 service_role → **workflow_dispatch 首跑綠、cron 每天台灣 03:00 運轉**。我建議的「手動 Run 先驗」正好攔到誤設金鑰。
- **字面 vs 事實**:diff 印證 ✅ — ci.yml + rpm-sync.yml 三 action v4→v6(checkout/pnpm-action-setup/setup-node);**with 設定全保留**(submodules:false / version:9.15.0 / node-version:22 / cache:pnpm);@v4 殘留 = 0(已 grep)。
- **🟢 版本查證**:gh api 確認 checkout@v6 / pnpm-action-setup@v6 / setup-node@v6 三 tag 真存在;body 稱經 gh api + action.yml runtime node24 查證(非憑記憶)✅。解 Node 20 deprecation(GitHub 6/16 強制 node24)。
- **🟡 唯一風險(未阻、待 push CI 驗)**:package.json 有 `packageManager: "pnpm@9.15.0"` + workflow 又傳 `version: 9.15.0` → pnpm/action-setup 某些版本「version + packageManager 並存」會報錯。**緩解判據**:既有 v4 就是此組合且 CI 一直綠(6b0548d/0a02446 success)= v4 接受、v6 主要改 node runtime 非版本解析邏輯 → 風險低;WebFetch README 未明寫 v6 行為(無法文檔確認)。**此 commit 未 push、v6 尚未被真 CI 跑過**(首跑綠是 v4)→ **push 後須看 CI 結果**;若 pnpm setup 失敗,fix = 移除 workflow 的顯式 `version: 9.15.0`(讓 packageManager 驅動、現代寫法)。
- **判定:bd9ea68e PASS**(機械升級正確 + 版本查證 + @v4 零殘留 + S5 上線實證;1 🟡 v6 CI 待 push 驗、低風險、fix 已備)。STATUS 同步。未 push。

---

## [`cf630b2f` merge + `096d7fe4` status] OD Phase A 併入 dev + STATUS 標兩線完成 — **PASS**

- **`cf630b2f` OD-merge**:od-redesign(OD-1~11)併入 dev、**合併後完整三綠審查獨立驗全綠**(typecheck 17/17 / build storefront 1/1 / **vitest 79 檔 531 測全過**、OD 元件 × S6 fitments 共存零 cross-effect)。**合併零衝突**(OD-5~11 用 manifest 追蹤未碰 STATUS、我預判的 STATUS 衝突未發生、已自我修正)。詳見 od-redesign-review-log.md [cf630b2f] 條目。
- **`096d7fe4` STATUS**:純 docs(STATUS.md 8 行)、標整合線 S0–S6 + OD Phase A 皆完成、merge 入版;字面與事實一致(parents/三綠/531 全綠)✅;命名:適用車款表 = **OD-12**(post-merge、接 S6 fitments[]、D1=A 3 欄)。
- **判定:PASS**。dev 現 = 整合資料線 + OD Phase A 統一、全綠。待 Sean 肉眼驗 :3001 → push(+ bd9ea68 v6 CI)→ OD-12 適用車款表。未 push。

---

_(等待:Sean 肉眼驗 :3001 → push(看 v6 CI);或 OD-12 適用車款表。哨兵盯 dev)_
