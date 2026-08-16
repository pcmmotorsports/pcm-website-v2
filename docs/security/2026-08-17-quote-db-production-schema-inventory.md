# 報價單庫 production schema 盤點(**production 側**)

- **窗**:E(資安稽核,唯讀)  **日期**:2026-08-17  **庫**:`pcm-quote-v2` production
- **憑證**:`pcm_audit_ro`,真登入(`current_user`=`session_user`)
- **來源**:`pg_catalog`,**不是** `information_schema`(後者對零權限稽核帳號會系統性回 0)

## 🔴 這份只有【一半】,而缺的是哪一半要講清楚

B 窗要的 `#4` 是「production schema **與 repo** 一致性」。**repo 那一半不在這台機器上。**

量法(附正向對照):
```
find /Users/sean_1 -maxdepth 3 -type d -name migrations -path "*supabase*"
  ⇒ 10 個命中,【全部】都是 pcm-website-v2 的工作樹,零個是報價單 repo
正向對照:test -d /Users/sean_1/pcm-website-v2/supabase/migrations ⇒ 有 ⇒ find 是活的
```
📎 與 memory `reference_quote-repo-truth-moved-to-mac-mini` 一致:報價單 repo 真身在 mac mini。

⇒ **我能給的是 production 這一側的事實。比對要有 repo 那半的人來做。**
⚠️ **不要拿本機任何東西當 repo 半** —— 那份 clone 不存在;若日後找到一份,**先 `git fetch` 對 `origin/main` 驗新舊再比**,否則會比出一堆假差異。

## public schema 關聯清單

```
m | model_family_closure_mv | RLS=false | 欄數=4
m | product_groups_mv | RLS=false | 欄數=32
r | akrapovic_pricing_configs | RLS=true | 欄數=4
r | audit_results | RLS=true | 欄數=10
r | audit_results_backup_20260715 | RLS=true | 欄數=10
r | auth_state | RLS=true | 欄數=8
r | backup_cleared_locked_at_20260717 | RLS=true | 欄數=7
r | backup_cleared_sean_manual_20260717 | RLS=true | 欄數=7
r | bonamici_pricing_configs | RLS=true | 欄數=4
r | category_dictionary | RLS=true | 欄數=7
r | category_taxonomy_map | RLS=true | 欄數=5
r | category_variant_rule | RLS=true | 欄數=5
r | category_variant_rule_override | RLS=true | 欄數=6
r | category_zh_backup | RLS=true | 欄數=4
r | cncracing_pricing_configs | RLS=true | 欄數=4
r | content_templates | RLS=true | 欄數=9
r | dictionary_change_receipts | RLS=true | 欄數=11
r | dictionary_write_leases | RLS=true | 欄數=4
r | eazigrip_pricing_configs | RLS=true | 欄數=4
r | ebc_pricing_configs | RLS=true | 欄數=4
r | evotech_pricing_configs | RLS=true | 欄數=4
r | extreme_pricing_configs | RLS=true | 欄數=4
r | fitment_year_extend | RLS=true | 欄數=9
r | fitment_year_extend_candidate | RLS=true | 欄數=17
r | front3d_pricing_configs | RLS=true | 欄數=4
r | front3d_sku_cache | RLS=true | 欄數=4
r | gbracing_pricing_configs | RLS=true | 欄數=4
r | impex_pricing_configs | RLS=true | 欄數=23
r | kspeed_pricing_configs | RLS=true | 欄數=4
r | lightech_pricing_configs | RLS=true | 欄數=4
r | line_brand_aliases | RLS=true | 欄數=6
r | line_conversations | RLS=true | 欄數=14
r | line_faq | RLS=true | 欄數=8
r | line_message_insights | RLS=true | 欄數=14
r | line_messages | RLS=true | 欄數=4
r | line_pending_reply | RLS=true | 欄數=5
r | line_qa_pairs | RLS=true | 欄數=18
r | line_settings | RLS=true | 欄數=3
r | login_attempts | RLS=true | 欄數=6
r | login_rate_buckets | RLS=true | 欄數=3
r | major_category_def | RLS=true | 欄數=4
r | materya_pricing_configs | RLS=true | 欄數=4
r | model_dictionary | RLS=true | 欄數=19
r | model_dictionary_honda_at_backup_20260524 | RLS=true | 欄數=19
r | model_dictionary_honda_cbhornet_backup_20260524 | RLS=true | 欄數=19
r | model_dictionary_honda_dct_backup_20260525 | RLS=true | 欄數=19
r | model_dictionary_yamaha_backup_20260521 | RLS=true | 欄數=19
r | model_dictionary_yamaha_tracer_backup_20260524 | RLS=true | 欄數=19
r | motogadget_pricing_configs | RLS=true | 欄數=4
r | orphan_review | RLS=true | 欄數=14
r | pending_reparse_tasks | RLS=true | 欄數=15
r | pricing_recompute_audit | RLS=true | 欄數=7
r | pricing_rules | RLS=true | 欄數=7
r | product_hard_delete_audit | RLS=true | 欄數=7
r | products | RLS=true | 欄數=57
r | products_corrected_backup_20260715 | RLS=true | 欄數=12
r | products_daily_snapshot | RLS=true | 欄數=9
r | quote_snapshots | RLS=true | 欄數=28
r | recovery_codes | RLS=true | 欄數=7
r | reparse_runtime_state | RLS=true | 欄數=5
r | rpm_collection_generations | RLS=true | 欄數=9
r | rpm_pricing_configs | RLS=true | 欄數=4
r | samco_feed_sku | RLS=true | 欄數=2
r | samco_pricing_configs | RLS=true | 欄數=4
r | sso_codes | RLS=true | 欄數=7
r | supplier_freeze | RLS=true | 欄數=8
r | supplier_freeze_ledger | RLS=true | 欄數=8
r | supplier_freeze_manifest | RLS=true | 欄數=5
r | supplier_freeze_repair_lease | RLS=true | 欄數=7
r | suppliers | RLS=true | 欄數=10
r | taxonomy_v2_major | RLS=true | 欄數=2
r | taxonomy_v2_sub | RLS=true | 欄數=3
r | term_synonyms | RLS=true | 欄數=7
r | totp_devices | RLS=true | 欄數=13
r | translation_cache | RLS=true | 欄數=8
r | translation_stale_candidates | RLS=true | 欄數=7
r | zz_backup_lightech_version_20260626 | RLS=true | 欄數=7
r | zz_backup_samco_images_20260626 | RLS=true | 欄數=5
r | zz_backup_variant_merge_20260704 | RLS=true | 欄數=52
r | zz_backup_variant_merge_r2_20260704 | RLS=true | 欄數=52
v | dealer_price_v | RLS=false | 欄數=5
v | line_insight_category_rank_v | RLS=false | 欄數=3
v | line_insight_inquiry_type_dist_v | RLS=false | 欄數=3
v | line_insight_model_rank_v | RLS=false | 欄數=3
v | line_insight_monthly_trend_v | RLS=false | 欄數=3
v | line_insight_overview_v | RLS=false | 欄數=9
v | line_insight_part_brand_rank_v | RLS=false | 欄數=3
v | line_insight_vehicle_brand_rank_v | RLS=false | 欄數=3
v | model_family_closure_v | RLS=false | 欄數=4
v | model_family_health | RLS=false | 欄數=6
v | product_brand_models_v | RLS=false | 欄數=2
v | product_brands_v | RLS=false | 欄數=1
v | product_categories_v | RLS=false | 欄數=1
v | product_groups_v | RLS=false | 欄數=32
v | product_suppliers_v | RLS=false | 欄數=1
v | product_years_v | RLS=false | 欄數=1
v | storefront_catalog_v | RLS=false | 欄數=30
v | storefront_fitments_v | RLS=false | 欄數=8
```

**統計**:`r` 一般表 **78** / `v` view **18** / `m` matview **2** ⇒ 合計 **98**。

## ⚠️ 欄位名疑似含祕密的掃描(**只報數量與分布,不抄名字**)

```
疑似含祕密的欄位名        11 個,分布於 10 個關聯
  pattern: secret|token|password|api_key|apikey|bearer|credential
正向對照(pattern 活著)     同一支換成 id ⇒ 154 個命中

🔴 anon 讀得到的          0 個
   authenticated 讀得到的  0 個
   正向對照 postgres      11 個   ← 判定式是活的,上面兩個 0 才算數
```

🔴 **不抄名字是刻意的**:為了論證某個東西危險而寫下的證據,本身就複製了那個危險。
需要逐一處理時,由**有權限的人**照上面那支 pattern 自己跑一次即可。

## 🟡 一個延遲觸發的坑(**現在不是洞**)

那 10 個關聯裡,**RLS 開著的只有 6 個,4 個是關的**。

**今天沒事**,因為 `anon`/`authenticated` 對它們**零授權**(上面量到 0)。
🔴 **但那是靠【授權】單獨在擋,沒有第二道** —— 日後只要有人給其中一張表一個 `SELECT`,
**RLS 不會在那裡接住他,而且不會有任何東西紅**。
📎 同型:A 庫 `#550`(`vehicle_taxonomy_public` 那支繞過底表 RLS 的 view)——
**引爆它的那次改動看起來會完全無關。**

## 口徑

🔴 本檔每一條只對**報價單庫**成立。A 庫的數字一個都沒有搬進來。
