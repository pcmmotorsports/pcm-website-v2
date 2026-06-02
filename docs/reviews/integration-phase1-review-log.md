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

_(等待:S0 報價單側 view 就緒 → S3;或執行 session 下一片 commit)_
