# 2026-07-25 docs 清理封存

本目錄收錄 2026-04-30 至 2026-07-20 期間、對應 slice 均已收工的一次性過程產物，
共 66 個檔案。2026-07-25 由 Sean 拍板執行「保留式整理」——**全部用 `git mv` 搬移、零刪除**，
目的是讓 `docs/` 只留下現行有效的規則與規格，避免下一個 session 把舊 plan／舊 packet
誤認為目前指令。

## 篩選方法（機械判定，非人工逐檔閱讀）

1. 將 repo 內所有 git 追蹤的文字檔（`.md` / `.ts` / `.tsx` / `.json` / `.sql` / `.yml` 等，
   排除本 archive 目錄）讀為單一語料。
2. 逐一檢查每個 `docs/` 檔案的**檔名**與**完整路徑**是否出現於該語料。
3. 零命中 = 全 repo 無任何引用 → 列為候選。
4. 候選再依「所屬目錄性質 + 最後 commit 日期」分組，僅搬移一次性產物類。

⚠️ **本方法未逐檔閱讀內容**。若日後發現某檔仍有價值，直接 `git mv` 搬回原路徑即可。

## 使用規則

- 本目錄所有內容**只供追溯，不是開工入口**。
- 當前進度以根目錄 `STATUS.md` 為準；當次交接讀 `docs/handoff/CURRENT.md`。
- 有任何 inbound 引用的檔案一律未移動，仍在原路徑。
- `docs/specs/` 下 6 個零引用的 plan **刻意未移動** — 日期較近、需人工確認對應 slice 是否收工。
- 未移動 `docs/patterns/index.md` 與 `docs/runbooks/supplier-storefront-onboarding.md`：
  兩者雖零引用但內容現行有效，處置方式為**補進 `CLAUDE.md` 路由表**（同批完成），非封存。

## 已知副作用

- `graphify-out/`（未納入 git 追蹤的知識圖譜）內含指向舊 `docs/` 路徑的節點，本次搬移後該批節點失效。
  **本次未自動重刷** —— 刷圖有「dedup fuzzy 吃掉真節點」的已知風險，需單獨作業並於刷前備份。

## 分類與原始路徑

### recon／8 個

偵察報告 — 全數為 M-1 里程碑時代產物，整個目錄最後異動 2026-05-23、停用逾兩個月。

- `2026-05-21` `docs/recon/M-1-04-slice-4-recon-supplement.md`
- `2026-05-21` `docs/recon/M-1-04-slice-4-recon.md`
- `2026-05-16` `docs/recon/M-1-05-slice-1-spike-postgrest-view-join.md`
- `2026-05-20` `docs/recon/M-1-13-product-page-recon.md`
- `2026-05-21` `docs/recon/M-1-13f-decision-packet.md`
- `2026-04-30` `docs/recon/design-reference-pages-deepdive-2026-04-30.md`
- `2026-05-12` `docs/recon/m-1-03-main-a-recon.md`
- `2026-05-23` `docs/recon/m-1-14-customer-schema-recon-2026-05-23.md`

### reviews／10 個

審查 Packet — Packet 制度已於 2026-07-21 拍板停用（改直呼 codex CLI，見鐵則 12），本批為歷史格式。

- `2026-06-01` `docs/reviews/2026-06-01-16c-2-plan-k1.md`
- `2026-06-01` `docs/reviews/2026-06-01-16c-3-plan-k1.md`
- `2026-06-01` `docs/reviews/2026-06-01-16c-4b-plan-k1.md`
- `2026-06-24` `docs/reviews/2026-06-23-3ds-yi-r1-canonical-plan-codex-packet.md`
- `2026-07-12` `docs/reviews/2026-07-12-s1-apply-sql.sql`
- `2026-07-12` `docs/reviews/2026-07-12-s1-effective-fitment-db-packet.md`
- `2026-07-20` `docs/reviews/2026-07-16-m4a-v-line-packet.md`
- `2026-07-19` `docs/reviews/2026-07-19-m4a-b2-create-order-9param-packet.md`
- `2026-07-20` `docs/reviews/2026-07-20-288a-prod-e2e-packet.md`
- `2026-05-22` `docs/reviews/M-1-13H-codex-review-packet-2026-05-22.md`

### audits／1 個

一次性稽核報告。

- `2026-05-24` `docs/audits/2026-05-24-graphify-structural-audit.md`

### handoff／47 個

交接檔 — 本質是寫給下一個 session 的一次性便條，對應 slice 收工後即失效。`docs/handoff/CURRENT.md` 是唯一活的入口，未移動。

- `2026-05-21` `docs/handoff/2026-05-21-end-of-session.md`
- `2026-05-22` `docs/handoff/2026-05-22-stage-3-codex-fix-cowork-session-end.md`
- `2026-05-22` `docs/handoff/2026-05-22-stage-3-workflow-upgrade-cowork-session-end.md`
- `2026-05-23` `docs/handoff/2026-05-23-codex-inspector-role-handoff.md`
- `2026-05-23` `docs/handoff/2026-05-23-m-1-14c-handoff.md`
- `2026-05-23` `docs/handoff/2026-05-23-m-1-14d-handoff.md`
- `2026-05-23` `docs/handoff/2026-05-23-m-1-14e-handoff.md`
- `2026-05-24` `docs/handoff/2026-05-24-m-1-14e-3-handoff.md`
- `2026-05-27` `docs/handoff/2026-05-27-g-1-plan.md`
- `2026-06-02` `docs/handoff/2026-06-02-16c-4d-kickoff.md`
- `2026-06-03` `docs/handoff/2026-06-03-od-12-13-done-handoff.md`
- `2026-06-03` `docs/handoff/2026-06-03-od-phaseA-done-handoff.md`
- `2026-06-04` `docs/handoff/2026-06-04-review-session-handoff-m3.md`
- `2026-06-19` `docs/handoff/2026-06-15-execution-session-handoff-m3-3ds-4a2.md`
- `2026-06-19` `docs/handoff/2026-06-15-review-session-handoff-m3-3ds4.md`
- `2026-06-19` `docs/handoff/2026-06-16-execution-session-handoff-a-direction-backlog.md`
- `2026-06-19` `docs/handoff/2026-06-16-review-session-handoff-m3-3ds-4b.md`
- `2026-06-19` `docs/handoff/2026-06-16-review-session-handoff-m3-3ds-4c-nit-close.md`
- `2026-06-19` `docs/handoff/2026-06-17-execution-session-handoff-a-direction-remaining.md`
- `2026-06-19` `docs/handoff/2026-06-17-execution-session-handoff-cart-session-commit1.md`
- `2026-06-19` `docs/handoff/2026-06-17-execution-session-handoff-cart-session-commit2-dbpush-ready.md`
- `2026-06-22` `docs/handoff/2026-06-21-3ds-7-execution-review-done.md`
- `2026-06-21` `docs/handoff/2026-06-21-m3-3ds-querystatus-fix-done.md`
- `2026-06-21` `docs/handoff/2026-06-21-m3-3ds-s2b-done-next-slice.md`
- `2026-06-22` `docs/handoff/2026-06-22-3ds7-cleanup-245-246-review-test-done.md`
- `2026-06-30` `docs/handoff/2026-06-28-12h-orphan-b-line-live-handoff.md`
- `2026-07-01` `docs/handoff/2026-07-01-m3-250-anomaly-alert-handoff.md`
- `2026-07-02` `docs/handoff/2026-07-02-m3-252-256-gap2-double-charge-handoff.md`
- `2026-07-02` `docs/handoff/2026-07-02-m3-254-251-gate-shopify-phase2-handoff.md`
- `2026-07-04` `docs/handoff/2026-07-04-catalog-wiring-c3c4c5-kickoff-handoff.md`
- `2026-07-04` `docs/handoff/2026-07-04-p0c-decarbon-done-handoff.md`
- `2026-07-10` `docs/handoff/2026-07-10-brand-rollout-session-handoff.md`
- `2026-07-11` `docs/handoff/2026-07-11-brand-wiring-taxonomy-s1s2-handoff.md`
- `2026-07-12` `docs/handoff/2026-07-11-catalog-fullwidth-ux-handoff.md`
- `2026-07-11` `docs/handoff/2026-07-11-category-taxonomy-v12-handoff.md`
- `2026-07-12` `docs/handoff/2026-07-12-p4-s4-collect-rpc-timeout-handoff.md`
- `2026-07-12` `docs/handoff/2026-07-12-s4-card-year-multisession-wip-handoff.md`
- `2026-07-13` `docs/handoff/2026-07-13-m4a-order-mgmt-fable-review-handoff.md`
- `2026-07-16` `docs/handoff/2026-07-16-m4a-vline-close-next-phase-kickoff.md`
- `2026-07-16` `docs/handoff/2026-07-16-m4a-vline-session-handoff.md`
- `2026-07-16` `docs/handoff/2026-07-16-m4a-wallet-close-production-push-kickoff.md`
- `2026-07-16` `docs/handoff/2026-07-16-m4a-wallet-edit-kickoff.md`
- `2026-07-18` `docs/handoff/2026-07-18-b1-notification-email-handoff.md`
- `2026-07-19` `docs/handoff/2026-07-19-m4a-b2-codex-k2-nogo-handoff.md`
- `2026-07-19` `docs/handoff/2026-07-19-storefront-catalog-lightbox-handoff.md`
- `2026-07-21` `docs/handoff/2026-07-21-eazi-grip-marketing-handoff.md`
- `2026-07-25` `docs/handoff/2026-07-25-rf2a0-freeze-shipping-handoff.md`

