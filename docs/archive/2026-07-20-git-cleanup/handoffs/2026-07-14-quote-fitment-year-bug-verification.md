# 報價單側查證紀錄:官網 fitment 年份來源有已確認的上游 bug

> 日期:2026-07-14
> 來源:PCM 報價單 V2 的 fitment Phase 0 slice(Claude 執行 session)
> 性質:唯讀查證紀錄;本 session 未修改 pcm-website-v2 任何程式、資料或既有 dirty 檔
> 對應報價單側文件:`PCM報價單-V2/docs/superpowers/plans/2026-07-14-fitment-phase0-evidence-plan.md` §2.3、`PCM報價單-V2/docs/reviews/2026-07-14-storefront-fitments-v-livedef.sql`

## 查證結論

1. 官網車款搜尋(RPC `search_products_by_vehicle`,UNION `product_fitments` 與 `product_fitments_effective`;見本 repo `docs/reviews/2026-07-12-s1-apply-sql.sql:116-157`、`packages/adapters/src/supabase/helpers/fitment-queries.ts:141-160,188-208`)的 inherited/展開 fitment 年份,最終來源是報價單 B 庫 view `storefront_fitments_v`,經 `PCM報價單-V2/scripts/sync_storefront_fitments.py` 每日 16:10 同步進 `product_fitments_effective`。
2. 該 view 的 live 定義(報價單側已 dump 版控)對每個展開車款一律投影**商品群層級的 min/max 聯集年份**(`product_groups_v.year_start/year_end`),不是該車款自己的年份。唯讀比對:88,846 筆 direct row 中 80,256 筆與 per-model `fitment_parsed` 年份不符,涉及 12,083 個群。
3. 因此官網 `product_fitments_effective` 的年份篩選資料含系統性偏差(年份範圍被放大到整群聯集),屬**已確認、會影響顧客搜尋結果的 production bug**,傳導延遲為每日批次。

## 邊界與下一步

- 修復屬報價單側獨立 slice(修 view 年份語意+把 view 收編進 migration 版控),已在報價單側提報 Sean 排優先序;修復後下一次每日同步會自動更正網站庫資料,網站端預期**不需要改程式**。
- 網站端若要先行緩解,唯一影響面是 `product_fitments_effective` 的年份可信度;`product_fitments`(direct 表)不受此 bug 影響。
- 本檔僅為跨 repo 查證紀錄,依報價單側 CURRENT handoff「跨 repo 只讀查證並在兩邊 handoff 記錄」要求留存;未動本 repo 其他 session 的任何 dirty 檔案,也未 commit。
