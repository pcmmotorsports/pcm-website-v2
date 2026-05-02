# PCM 全專案 audit 報告 — 2026-05-02

> **角色:** 第一次完整 audit、findings 對應 Sean 三維 prompt(10w 商品 / 種類多 / 難搞客人)
> **觸發:** M-0-06 完成、M-0-02 / M-0-09 啟動前 sanity check
> **方法:** B 路線(主 session 順序跑 2 Skill)、Sean 拍板 Q1=A3 / Q2=B3 / Q3=C1
> **層級:** docs/audits/、本檔不取代 ADR / NORTHSTAR、findings 進 phase-1-backlog.md 條目本體
>
> 配合閱讀:
> - `docs/phase-1-backlog.md` 條目 #32-#74(本 audit findings 落地)
> - `docs/PHASE-1-MILESTONES.md`(各 milestone trigger 引用)
> - `docs/architecture/medusa-schema-design.md` Part 1 + Part 2(Order / Product schema)
> - `docs/architecture/security-timeline.md`(安全 timeline 30 條)
> - `docs/decisions/0002-architecture-pivot.md`(9 contexts + Medusa-as-API)
> - `docs/decisions/0003-domain-entity-naming.md`(命名規則 + 9 衝突處置)

---

## §1 範圍與方法論

### §1.1 三維 prompt 拆解

#### 10w 商品(scale)

對應 Sean「販售上架破 10w 商品」訴求、focus:

- fitment 索引 / search index / sitemap 規模
- image CDN / storage scale
- 上架 pipeline 瓶頸(種子 → ongoing import)
- 後台 CRUD 效能 / 部署 region / capacity
- DB / Vercel / Railway 容量規劃

#### 種類多(多維過濾)

對應 Sean「種類多」訴求、focus:

- 巢狀分類(category 樹)
- 車型 × 品牌 × fitment 多維過濾
- 篩選器 UX / source-of-truth(design mock vs Medusa)
- 商品 metadata 一致性(多廠商同步衝突)
- SEO facet / 多語系預留

#### 難搞客人(高觸控 / dispute)

對應 Sean「客人也很難搞」訴求、focus:

- 訂單追溯 / line-level breakdown
- PII 處理 / log mask 規範
- 客服歷史 / dispute SOP(production 24-48h 必回)
- 退款 / 儲值金 / B2B 月結對帳
- 個資法資料權利(取出 / 刪除)
- SLA / oncall / incident response 流程

### §1.2 audit 邊界

**在範圍:**

- packages/{domain,ports,use-cases,adapters,ui,schemas} 6 packages(domain + ports 已 type-stub、其他空殼)
- apps/{storefront,medusa} 已建 + apps/{admin,sync-engine} 未建(M-0-02 待補)
- docs/{architecture,decisions,patterns,features,recon}
- 部署 plan(Vercel / Railway / Supabase / GCP)
- 流程 / SOP / runbook 缺位

**Phase 2 影響、僅標 trigger 點不深入:**

- Vehicle / Booking / Wallet / Shop 4 contexts(Phase 2 主、Phase 1 schema 預留)

**不在範圍:**

- 已 commit 但未 push 的內容(無此情況、HEAD 481b9f9 已 push)
- 外部 SaaS 內部安全(信任供應商)
- 視覺 / 結構 / 路由 / 元件命名衝突(走 design-reference 真權威、不是 audit 範圍)
- 員工內部安全教育(Sean 內部訓練負責)

### §1.3 方法論(B 路線、Sean 拍板 Q1=A3 / Q2=B3 / Q3=C1)

主 session 順序跑兩 skill、不開 subagent(Sean 拍板 Q3=C1):

**Phase 1:engineering:tech-debt skill audit**

- focus 6 類:Code / Architecture / Test / Dependency / Documentation / Infrastructure debt
- 評分公式:`(Impact + Risk) × (6 - Effort)`(skill framework)
- 抓 25 條 findings(編號 T1-T25)

**Phase 2:operations:risk-assessment skill audit**

- focus 6 類:Operational / Financial / Compliance / Strategic / Reputational / Security risk
- 評分:Risk Matrix(Impact × Likelihood)→ Critical / High / Medium / Low
- 抓 19 條 findings(編號 R1-R19)

**Phase 3:三視角 filter + 三維分類 + 去重**

- 三視角 filter:擴充性 / 可維護性 / bug 可追蹤性 過 filter
- 三維分類:每條 finding 至少標一維
- 優先級重排:🔴 Critical / 🔴 High / 🟠 Medium / 🟡 Low / 🟢 觀察
- 去重對照:既有 backlog #1-#31 不重複本體、partial overlap 標引用
- 互補不重疊:T 系與 R 系合併 1 條(T13+R16)、其他 partial overlap 2 條保留各自獨立

### §1.4 findings summary 數字

| skill | 抓條數 | 過 filter 留 |
|---|---|---|
| engineering:tech-debt | 25 | 25 |
| operations:risk-assessment | 19 | 19 |
| **合計** | **44** | **44**(T13 合併 R16 後 43 條進 backlog) |

優先級分布(過 filter 後):

- 🔴 Critical: 1
- 🔴 High: 13
- 🟠 Medium: 22
- 🟡 Low: 6
- 🟢 觀察: 2

三維分布(可多標、加總大於總條數):

- 10w 商品: 13 條
- 種類多: 7 條
- 難搞客人: 17 條
- 跨維: 12 條

---

## §2 三維對應總覽

### §2.1 10w 商品(scale)findings 索引

🔴 Critical:

- F1 R1 Supabase free tier 容量限制

🔴 High:

- F17 T2 IInventoryRepository 缺位
- F18 T4 search engine plan 未拍
- F11 R4 Railway free tier cold start
- F9 R2 sync-engine 本機 redundancy(共標難搞客人)

🟠 Medium:

- F21 T12 image CDN strategy
- F6 T13 種子 → ongoing import transition(合併 R16)
- F27 R9 Vercel / Railway 部署 region
- F35 R18 sync-engine race condition

🟡 Low:

- F39 T20 list 三方法分頁 TODO 一致性

### §2.2 種類多(多維過濾)findings 索引

🔴 High:

- F3 T7 listByFitment 單數 vs 多選

🟠 Medium:

- F24 T16 三層折扣 schema 預留(共標難搞客人)
- F34 R17 篩選器 source-of-truth

🟡 Low:

- F37 T18 MotoBrand 升級 trigger

### §2.3 難搞客人(高觸控 / dispute)findings 索引

🔴 High:

- F2 T3 Order.total breakdown
- F7 T6 OrderItem lineTotal + tierAtCheckout
- F8 T11 logging strategy / PII utility
- F10 R3 TapPay sandbox→production 切換
- F12 R5 TapPay production 申請時序
- F13 R6 客服退款 SOP
- F14 R7 dispute / chargeback SOP

🟠 Medium:

- F4 T8 Order.fulfillmentMethod
- F20 T9 Customer phoneNumber + address
- F5 T10 ChargeStatus disputed
- F30 R12 oncall runbook
- F31 R13 個資法資料權利
- F32 R14 B2B 月結對帳 SOP
- F33 R15 TapPay 商家合約

🟡 Low:

- F38 T19 SyncResult.errors 結構化

🟢 觀察:

- F44 T25 disaster recovery plan

### §2.4 跨維度(影響 ≥ 2 維)findings 索引

🔴 High:

- F16 T1 IPricingRepository 抽象
- F19 T5 monitoring / alerting plan
- F15 R8 發票自動化(STATUS #1 補三視角)

🟠 Medium:

- F22 T14 testing-strategy.md
- F23 T15 bounded-contexts.md
- F25 T17 adapters 子目錄結構
- F26 T23 admin/sync-engine ESLint dry-run 補
- F28 R10 Medusa-as-API spike verification
- F29 R11 submodule design-reference fallback
- F36 R19 admin/sync-engine 部署 plan

🟡 Low:

- F40 T21 Order.total JSDoc drift
- F41 T22 packages 空殼 README

🟢 觀察:

- F43 T24 contract test 框架

---

## §3 Findings 詳述(按優先級 / 三維 / 類別排序)

### §3.1 🔴 Critical(1 條)

#### Audit-F1 / R1:Supabase free tier 容量限制

- **Risk Level:** Critical(High Likelihood × High Impact)
- **三維:** 10w 商品(PrimaryDriver:scale)
- **位置:** 無對應檔(setup §10.x 隱含 free tier 假設)
- **問題:** Supabase 免費版 500MB DB / 5GB bandwidth / socket 連線限制。10w 商品 + 50w image refs + Phase 2 訂單 + 客人 row 上看 1M+。Phase 1 階段 1 上線 200 SKU 看不出問題、上線後 SKU 上千接近 quota 靜默崩。
- **不修會痛在:**
  - 擴充性:Phase 2 加 Vehicle / Booking / Wallet 表、row 數爆、不升級無法擴
  - 可維護性:免費版突 quota、Sean 不會立即知道直到 user 抱怨
  - bug 可追蹤性:quota 紅燈在 Supabase Dashboard、admin / Sean 沒看、靜默 fail
- **推薦處置:** M-1-16(200 SKU 種子)落地前 Sean 拍板升 Supabase Pro($25/mo);M-6-08 上線前 checklist 加 quota 驗證
- **對應 milestone trigger:** M-1-16 啟動前
- **對應 backlog:** #57

### §3.2 🔴 High(13 條)

#### Audit-F2 / T3:Order.total 缺 breakdown

- **三維:** 難搞客人(PrimaryDriver:退款 / dispute / 發票)
- **位置:** `packages/domain/src/order/types.ts:76-77`
- **問題:** Order.total 只一條、退款 / dispute 時無法拆 subtotal / shipping / discount / tax;發票自動化拆 line 也無法依靠。
- **不修會痛在:**
  - 擴充性:A3 發票自動化拍板要做時、發票拆 line 必有金額 breakdown、Order.total 一條無法切
  - 可維護性:M-3-08 partial refund 跑 amount 計算複雜
  - bug 可追蹤性:客服「我的訂單退款少 300」、查 Order.total 看不到拆解、必須 grep TapPay rec_trade_id 找原始 amount
- **推薦處置:** M-3-02 加 `subtotal / shippingFee / discount / total` 4 個 Money 欄位
- **對應 milestone trigger:** M-3-02
- **對應 backlog:** #34

#### Audit-F3 / T7:listByFitment(spec) 單數 vs 多選衝突

- **三維:** 種類多(PrimaryDriver:多維 fitment 過濾)
- **位置:** `packages/ports/src/IProductRepository.ts:18`
- **問題:** Product.fitments 是 array、但 query 介面 spec 單數;design 篩選器(VehicleFinder + FilterSide cascade)允許「Yamaha CBR600RR + Honda CB1000R」多選 OR、需 specs[]。
- **不修會痛在:**
  - 擴充性:Phase 1 storefront 4 篩選器只能單車型搜、客人多車主場景搜不出
  - 可維護性:M-1-03 adapter wire query 改一次
  - bug 可追蹤性:無
- **推薦處置:** 改 `listByFitment(specs: FitmentSpec[]): Promise<Product[]>` 表達 OR 多選
- **對應 milestone trigger:** M-1-03 / M-1-12
- **對應 backlog:** #38

#### Audit-F4 / T8:Order.fulfillmentMethod 欄位缺

- **三維:** 難搞客人(出貨追溯)、種類多(SecondaryDriver:寄店家 36 筆)
- **位置:** `packages/domain/src/order/types.ts:69-78`、schema-design §8.4
- **問題:** M-3-05 calculate-shipping 「滿 4000 免運 + 偏遠 + 寄店家固定 100」需知道客人選哪種運送、但 Order entity 無 fulfillmentMethod 欄位。
- **不修會痛在:**
  - 擴充性:Phase 2 加宅配 / 超商 / 機車快遞、enum migrate 成本高
  - 可維護性:calculate-shipping 內 hardcode 三 case、Order 看不到 admin 詳情頁要 derive
  - bug 可追蹤性:客人「我選寄家但收到簡訊去店家領」、Order 無紀錄
- **推薦處置:** M-3-02 加 `Order.fulfillmentMethod: 'home' | 'shop' | 'pickup'`
- **對應 milestone trigger:** M-3-02
- **對應 backlog:** #39

#### Audit-F5 / T10:ChargeStatus 缺 disputed / chargedBack

- **三維:** 難搞客人(PrimaryDriver:dispute)
- **位置:** `packages/domain/src/payment/types.ts:18`
- **問題:** TapPay sandbox sync(prime → result 立即回)、production 銀行 dispute 是非同步、可能 2 週後 issuer 撤回。`'succeeded' | 'failed'` 不夠用。
- **不修會痛在:**
  - 擴充性:Phase 2 dispute production 場景、enum 加值零成本、現加比後改
  - 可維護性:M-3-08 sandbox 沒問題、production dispute 漏處理
  - bug 可追蹤性:dispute 發生時、admin 看 ChargeStatus 仍 succeeded 但實際銀行已撤回、PCM 收不到錢
- **推薦處置:** M-3-08 落地前加 `'succeeded' | 'failed' | 'pending' | 'disputed' | 'chargedBack'`
- **對應 milestone trigger:** M-3-08
- **對應 backlog:** #41

#### Audit-F6 / T13+R16:種子 200 SKU → ongoing import transition(合併 conflict 風險)

- **三維:** 10w 商品(PrimaryDriver:上架 pipeline)、種類多(資料完整性)
- **位置:** `docs/PHASE-1-MILESTONES.md` §4 M-1-16 + §8 M-5
- **問題:** M-1-16 規劃 200 SKU 手動 + Sheets 一次性 import、M-5-03 才落 sync-engine ongoing。中間 M-1 ~ M-4 期間(估 6-9 週)、Sean 想加新 SKU 走哪個流程?無規範。同一商品在「種子」與「sync-engine 寫候選」兩流程觸發、可能重複建商品。
- **不修會痛在:**
  - 擴充性:Phase 2 加 vendor crawler、source-of-truth 衝突更多
  - 可維護性:M-1 ~ M-4 期間若有新品上架、員工沒流程、走成 ad-hoc 慣例
  - bug 可追蹤性:重複商品出現時、查哪邊是 source 不易;某 SKU 是 M-1-16 一次性還是 M-3 員工手動 admin 上、無 trace
- **推薦處置:** M-1-16 啟動前寫 `docs/runbooks/manual-product-upload.md`(M-1 ~ M-4 期間 Medusa Admin 直接上)+ dedupe key(SKU code)、sync-engine 同 key matcher 不重建
- **對應 milestone trigger:** M-1-16 啟動前
- **對應 backlog:** #44(本條合併 T13 + R16)

#### Audit-F7 / T6:OrderItem 缺 lineTotal + tierAtCheckout

- **三維:** 難搞客人(PrimaryDriver:dispute / B2B 月結對帳)
- **位置:** `packages/domain/src/order/types.ts:42-51`
- **問題:** OrderItem 結帳當下 customer.tier 未記錄、tier 變動歷史對帳找不出。客訴「我那時是 store tier、admin 看到我訂單 unitPrice 是 retail price?」無法回溯。
- **不修會痛在:**
  - 擴充性:Phase 2「premium_store 自動降級」業務(累積消費低於閾值降回 store)、查歷史訂單 tier 變動軌跡需 OrderItem.tierAtCheckout
  - 可維護性:M-3-11 premium_store 自動升級邏輯依賴歷史訂單金額、若 unitPrice 是 retail 但客人那時是 store、計算錯
  - bug 可追蹤性:稽核時「為何同商品同時段 admin 看到的 unitPrice 不同」、無 tier 紀錄找不到 root cause
- **推薦處置:** M-3-02 加 `OrderItem.lineTotal: Money` + `OrderItem.tierAtCheckout: MemberTier`
- **對應 milestone trigger:** M-3-02
- **對應 backlog:** #37

#### Audit-F8 / T11:logging strategy / PII masking utility

- **三維:** 難搞客人(audit log)、跨維(全系統)
- **位置:** `docs/architecture/`(無 logging-strategy.md)、security-timeline §C7 / §C8(PII 遮蔽提及但無集中 utility)
- **問題:** TapPay charge / Customer 註冊 / Order 創建 各 adapter 各自 log、無集中 logging 規範(level / format / 敏感欄位 mask)。
- **不修會痛在:**
  - 擴充性:Phase 2 加 LINE / 物流 / claude-api adapter、各 adapter 各 log 不一致格式
  - 可維護性:每個 adapter 自己決定 mask 邏輯、改 mask 規則(例追加身分證遮蔽)散在多處
  - bug 可追蹤性:dispute 客訴「PCM 把我電話 log 出來」、grep log 找不到統一遮蔽點
- **推薦處置:** M-3-08 啟動前寫 `packages/use-cases/src/utils/log-masking.ts`(maskPhone / maskEmail / maskAddress)+ 各 adapter 必呼叫
- **對應 milestone trigger:** M-3-08(對應 backlog #16 命中前)
- **對應 backlog:** #42(範圍擴展 #16 TapPay PII)

#### Audit-F9 / R2:sync-engine 本機 redundancy(F1 雙保險不夠)

- **Risk Level:** High(Medium-High Likelihood × High Impact)
- **三維:** 10w 商品(資料持續同步)、難搞客人(SecondaryDriver:報價變動延誤)
- **位置:** `docs/PHASE-1-MILESTONES.md` §8.7 風險 1
- **問題:** F1 兩層保險(被動紅燈 + daily email)只是「告警」、不是「continuity」。電腦壞 / 停電 / Sean 出差中斷數天、商品候選不更新 / 報價不告警 / 庫存不自動更新。
- **不修會痛在:**
  - 擴充性:Phase 2 多 adapter(LINE / 物流 / 廠商爬蟲)進來、本機機器更不能停
  - 可維護性:Sean 出差時無人 sync、員工只能等
  - bug 可追蹤性:電腦失聯時、admin 看到紅燈但不知為何、Sean 回家確認
- **推薦處置:** M-5-09 daily summary email 加「2 hr 無 ping → SMS 通知 Sean」+ Phase 2 移雲端(GCP Cloud Run cron)
- **對應 milestone trigger:** M-5-09 / Phase 2
- **對應 backlog:** #58

#### Audit-F10 / R3:TapPay sandbox→production 切換漏(免費送商品)

- **Risk Level:** High(Medium Likelihood × High Impact)
- **三維:** 難搞客人(金流安全)、跨維(部署)
- **位置:** NORTHSTAR §1.2、security-timeline §3 #F5
- **問題:** Phase 1 用 sandbox、上線時切 production。Vercel + Railway 兩處 env vars 改、漏一處 production 走 sandbox = 付款不收錢 + 客人收貨。
- **不修會痛在:**
  - 擴充性:Phase 2 加 LINE Pay / Apple Pay 同類風險、無自動化驗證機制
  - 可維護性:無 production cutover 自動化驗證
  - bug 可追蹤性:charge 0 元異常時、查 logs 才知道走 sandbox、上線當天才發現
- **推薦處置:** M-6-08 上線前 checklist 加「TapPay env var = production key 自動驗證」(curl TapPay verify endpoint、回 production confirm)
- **對應 milestone trigger:** M-6-08
- **對應 backlog:** #59

#### Audit-F11 / R4:Railway free tier cold start(凌晨下單失敗)

- **Risk Level:** High(High Likelihood × Medium-High Impact)
- **三維:** 難搞客人(下單失敗)、10w 商品(SecondaryDriver:請求量)
- **位置:** 無對應檔(setup §10.x 隱含 Railway free tier)
- **問題:** Railway 免費版 $5/mo credit、Medusa 啟動 RAM ~512MB、idle 限制、container 自動 sleep。客人凌晨下單、Medusa cold start 30s、TapPay redirect 超時。
- **不修會痛在:**
  - 擴充性:Phase 2 後台流量上升、free tier 完全不夠
  - 可維護性:cold start 是 silent fail、客人不投訴看不出問題範圍
  - bug 可追蹤性:「凌晨下單失敗」無 log、reproduce 困難
- **推薦處置:** M-3-01 啟動前升 Railway Pro($20/mo、no sleep)
- **對應 milestone trigger:** M-3-01 啟動前
- **對應 backlog:** #60

#### Audit-F12 / R5:TapPay production 申請時序卡上線

- **Risk Level:** High(Medium Likelihood × High Impact)
- **三維:** 難搞客人(金流啟用)、跨維(營運)
- **位置:** PHASE-1-MILESTONES §11、STATUS Sean 待決策 #3
- **問題:** TapPay production 申請流程 1-2 週、上線當下若沒批 = 上線只能 sandbox(實際不收錢)、客人下單免費送商品。STATUS #3 涵蓋 sandbox 沿用、但 production 啟用時序不在表內。
- **不修會痛在:**
  - 擴充性:Phase 2 加新支付 channel 同類問題
  - 可維護性:無 production 拿到時程、其他 milestone 收尾不明
  - bug 可追蹤性:無
- **推薦處置:** M-3 啟動時 Sean 同步申請 production TapPay(申請 ≠ 啟用、可平行 backend dev)
- **對應 milestone trigger:** M-3 啟動前
- **對應 backlog:** #61

#### Audit-F13 / R6:客服退款 SOP 缺

- **Risk Level:** High(High Likelihood × Medium-High Impact)
- **三維:** 難搞客人(PrimaryDriver:dispute SOP)
- **位置:** 無對應檔、屬流程漏
- **問題:** M-3-08 TapPay refund 介面落地、但「客服收到客訴 → 判斷 → 退款 → 通知客人」整套 SOP 缺。員工不知:多久內回應 / 哪些情況可全退 / 哪些部分退 / 誰拍板 / 退款後客人通知 channel。
- **不修會痛在:**
  - 擴充性:Phase 2 多 channel 客訴(LINE / Email / 電話)、SOP 沒先定、各 channel 處理不同
  - 可維護性:員工換人 / 訓練成本高
  - bug 可追蹤性:客訴歷史散在 channel、無系統紀錄
- **推薦處置:** M-4a-12 客服 inbox 落地時同步寫 `docs/runbooks/customer-refund-sop.md`
- **對應 milestone trigger:** M-4a-12
- **對應 backlog:** #62

#### Audit-F14 / R7:dispute / chargeback SOP 缺

- **Risk Level:** High(Medium Likelihood × High Impact)
- **三維:** 難搞客人(PrimaryDriver:dispute)
- **位置:** 無對應檔、屬流程漏
- **問題:** Phase 1 sandbox 不會遇 dispute、production 上線後客人銀行 dispute 發生、PCM 員工 24-48h 內必回應(銀行限時)。無 SOP = 員工不知怎回 = 預設輸 = TapPay 強制扣回 + 商品已出 = PCM 雙輸。
- **不修會痛在:**
  - 擴充性:Phase 2 訂單量上升、dispute 頻率必升、無 SOP 各個臨機
  - 可維護性:員工不知收哪些證據(出貨單 / 簽收單 / 客人通訊紀錄)
  - bug 可追蹤性:dispute 失敗後、無 retrospective 找改善點
- **推薦處置:** M-6-08 上線前寫 `docs/runbooks/dispute-response-sop.md`(48h response template + 證據清單)
- **對應 milestone trigger:** M-6-08
- **對應 backlog:** #63

#### Audit-F15 / R8:發票自動化未拍 — STATUS #1 補三視角

- **Risk Level:** High(High Likelihood × High Impact)
- **三維:** 跨維(B2B 月結 + B2C 都需發票)
- **位置:** STATUS.md Sean 待決策 #1、PHASE-1-MILESTONES §11 拍板項目 A3
- **問題:** Phase 1 階段 1 不做 = 員工每天額外 1-2 hr 開發票、累積成本爆;B2B 月結客戶要求合併發票、手動易錯。
- **不修會痛在:**
  - 擴充性:Phase 2 訂單量上升、手動成本指數上升
  - 可維護性:漏開 / 開錯統編 / 跳號成本高
  - bug 可追蹤性:發票號碼跳號 / 漏號、國稅局查時無法解
- **推薦處置:** M-3 啟動前 Sean 拍板選綠界(產業標)、自動串接、估 1 週 dev 成本
- **對應 milestone trigger:** M-3 啟動前
- **對應 backlog:** #64
- **partial overlap:** STATUS Sean 待決策 #1(本表補三視角 + 痛點)

#### Audit-F16 / T1:IPricingRepository / IPricingService 抽象

- **三維:** 跨維(難搞客人 PrimaryDriver:VIP 客制定價 / 種類多 SecondaryDriver:廠牌折扣)
- **位置:** `packages/ports/src/`(5 ports 不含 Pricing)、`packages/domain/src/catalog/types.ts:76`(PriceByTier 落 catalog 但無 Pricing context)
- **問題:** schema-design §5 / 0003 ADR §4 #6 規劃 Pricing 走 Medusa price_list + customer_group、但無對應 port。storefront server-side render 時讀 `priceByTier[customer.tier]` 直接從 Product 對象、邏輯散在 storefront / use-case / adapter、無集中 PricingService。Phase 2 三層折扣疊加(0002 §4.3)上線時、回頭抽 service 成本爆炸。
- **不修會痛在:**
  - 擴充性:Phase 2 「廠牌折扣 + VIP + tier」三層 stack、無 IPricingService = storefront 直 import use-case 算、storefront server bundle 含計算邏輯
  - 可維護性:M-2-09 / M-3-06 兩處算 price 邏輯、改規則(例 NT$ 1000 滿減運費)需改兩處
  - bug 可追蹤性:客人客訴「某商品價格不對」、查 storefront log / use-case log / adapter log 三處才能定位
- **推薦處置:** M-2-08 落地時抽 `IPricingService.computePriceForCustomer(productId, customerId): Money`、storefront 走 service 不直接讀 Product.priceByTier
- **對應 milestone trigger:** M-2-08 啟動前拍板
- **對應 backlog:** #32

#### Audit-F17 / T2:IInventoryRepository 缺位

- **三維:** 10w 商品(PrimaryDriver:庫存批次同步)、難搞客人(SecondaryDriver:缺貨告知)
- **位置:** `packages/ports/src/`(5 ports 不含 inventory)、`packages/domain/src/catalog/types.ts:79-94`(Product entity 不含 inventory 欄位)
- **問題:** PHASE-1-MILESTONES §8 M-5-05 規劃 auto-update-inventory use-case、schema-design §2.1 寫「inventory 推延到 M-1-02 補」、但無 IInventoryRepository 設計。10w 商品庫存批次同步、靠 IProductRepository.save(product) 整 entity 覆寫、效能差。
- **不修會痛在:**
  - 擴充性:Phase 2 多倉庫(PCM 倉 + 合作店家倉)inventory 分散、無 IInventoryRepository 等於 inventory 跨倉邏輯散
  - 可維護性:sync-engine 改庫存走 IProductRepository.save 整體 update、N 次 round-trip
  - bug 可追蹤性:「客人下單顯示有貨實際缺」、查 product update log 找不到 inventory 變動 trace
- **推薦處置:** M-1-02 / M-5-05 啟動前抽 `IInventoryRepository.updateStock(productId, quantity)` + `getStock(productId)`
- **對應 milestone trigger:** M-1-02 啟動前
- **對應 backlog:** #33

#### Audit-F18 / T4:search engine plan 未拍

- **三維:** 10w 商品(PrimaryDriver:keyword 全文搜尋)
- **位置:** `packages/ports/src/IProductRepository.ts:20`
- **問題:** searchByKeyword 介面已存、但 Phase 1 預期 PG ILIKE 或 metadata 自由字串模糊比對、10w 商品必慢(p99 > 5s)。fitment 篩選 scale(#30)只解 fitment、keyword search 是另一條 query path。
- **不修會痛在:**
  - 擴充性:Algolia / Meilisearch / PG GIN tsvector 三方案、改架構成本不一、不先決就直接 PG ILIKE 上線後爆
  - 可維護性:Phase 2 換 search engine、storefront search bar / VehicleFinder 改寫
  - bug 可追蹤性:客人「搜某商品搜不到」、不知是 ILIKE 大小寫敏感 / encoding / metadata 欄位差異、無 search query log
- **推薦處置:** M-1-03 落地時用 PG `tsvector` + GIN(零外部依賴、TWD 中文需 `pg_jieba`)、Phase 2 觸發再升 Meilisearch
- **對應 milestone trigger:** M-1-03 啟動前
- **對應 backlog:** #35

#### Audit-F19 / T5:monitoring / alerting plan 缺

- **三維:** 跨維(10w 商品慢查詢無預警 / 難搞客人錯誤無 trace)
- **位置:** `docs/architecture/security-timeline.md` §7(劃線)
- **問題:** p99 latency / error rate / 慢查詢 / TapPay 失敗率 / sync-engine 跑批失敗 都無 monitoring。F1 兩層保險只覆蓋 sync-engine、不覆蓋 storefront / Medusa / TapPay。難搞客人客訴時、admin 無 dashboard。
- **不修會痛在:**
  - 擴充性:Phase 2 多 adapter(LINE / 物流 API / 廠商爬蟲)加進來、無 monitoring 框架、新 adapter 各自 print log 散落
  - 可維護性:錯誤分散在 Vercel log / Railway log / sync-engine local log、找 1 個錯走 3 處
  - bug 可追蹤性:客人「下單失敗」、無 distributed tracing、不知是 storefront / Medusa / TapPay / Supabase 哪一段失敗
- **推薦處置:** M-6-08 上線前加 Sentry(error monitoring)+ Vercel Analytics(p99)、最小可行
- **對應 milestone trigger:** M-6-08(可提前到 M-3 啟動前拍板)
- **對應 backlog:** #36

### §3.3 🟠 Medium(22 條)

#### Audit-F20 / T9:Customer phoneNumber + address 欄位缺

- **三維:** 難搞客人(PII)
- **位置:** `packages/domain/src/identity/types.ts:13-17`
- **問題:** 結帳必填 phoneNumber + address、訂單通知簡訊 / LINE 必用、Customer entity 字面無。security-timeline §C7 寫客人手機 / 地址 PII server-side 才查全、但 entity 缺欄位不知哪個 PII 是 customer-level / 哪個 order-level。
- **不修會痛在:** 擴充性 — M-2-04 AccountPage 6 tab(profile / address / vehicles)需 Customer.address 結構;可維護性 — 訂單下單表單 vs Customer profile 兩處填地址不同步;bug 可追蹤性 — 客人「我地址改了但訂單通知用舊地址」、address 是 Customer-level 還是 Order-level snapshot 不清
- **推薦處置:** M-2-04 落地時加 `Customer.phoneNumber + addresses: Address[]` + `Order.shippingAddress(snapshot)`
- **對應 milestone trigger:** M-2-04
- **對應 backlog:** #40

#### Audit-F21 / T12:image CDN / storage strategy

- **三維:** 10w 商品(storage scale)、種類多(SecondaryDriver:篩選頁 N 縮圖)
- **位置:** schema-design §2.1(images 推延 M-1-02、無 CDN 策略)
- **問題:** 10w 商品每個 1-5 張圖 = 50w 圖、PG storage 不適合大量 binary、必走 S3 / Cloudflare R2 / Vercel Blob、無策略。
- **不修會痛在:** 擴充性 — image upload 走哪個 service 不拍、Phase 2 換 CDN 必 migrate 全 image URL;可維護性 — image transform(resize / webp)在 backend 做還是 CDN 做不一致;bug 可追蹤性 — 客人「圖載很慢」無 image performance log
- **推薦處置:** M-1-02 啟動前拍板 Cloudflare R2 + image transform CDN(免費額度大)
- **對應 milestone trigger:** M-1-02 啟動前
- **對應 backlog:** #43

#### Audit-F22 / T14:testing-strategy.md 待寫

- **三維:** 跨維
- **位置:** `docs/architecture/`(無 testing-strategy.md)、0002 ADR §7 列「待寫(M-6 / G2 拍板後)」
- **問題:** M-1-02 InMemoryProductRepository 單元測試、M-1-14 Customer adapter 測試、M-3-02 entity guard 測試 都會跑、但無集中規範(test 位置 / mock 風格 / coverage 目標 / contract test 是否 enforce)。各 slice 自由發揮、test 風格散。
- **不修會痛在:** 擴充性 — Phase 2 9 大 contexts 各自 test 風格、後續整合 E2E 苦;可維護性 — M-1-02 寫的 test 風格 vs M-3-02 寫的不同、回頭 review 不知道誰是對標;bug 可追蹤性 — test 失敗時、不知道測了什麼
- **推薦處置:** M-1-02 啟動前寫 testing-strategy.md(test 位置 / vitest 設定 / mock 風格 / contract test 框架)
- **對應 milestone trigger:** M-1-02 啟動前
- **對應 backlog:** #45
- **partial overlap STATUS #2(G2 測試覆蓋率)**

#### Audit-F23 / T15:bounded-contexts.md 待寫

- **三維:** 跨維
- **位置:** `docs/architecture/`(無 bounded-contexts.md)、0002 ADR §7 列「待寫」
- **問題:** 9 contexts 邊界目前散在 schema-design §8.3(7 條簡述)+ ADR-0003 §3.1(命名規則)+ PHASE-2-VISION + 0002 §4.3、無集中文件。
- **不修會痛在:** 擴充性 — Phase 2 加 Booking / Wallet entity、邊界決策歷史散落、不知為何 Vehicle 走 PCM 自家 / Catalog 走 Medusa-as-API;可維護性 — domain 改命名(motoBrand → vehicleBrand)、要 grep 全 repo + 4 ADR + schema-design + 各 context types.ts、無單一 source;bug 可追蹤性 — bug 「下單後 Vehicle entity 沒 created」、不知 Vehicle 屬 Order 還 Identity context、邊界不明
- **推薦處置:** M-1-02 啟動前寫 bounded-contexts.md(9 contexts × ubiquitous language × Medusa 蓋面 × milestone)
- **對應 milestone trigger:** M-1-02 啟動前
- **對應 backlog:** #46

#### Audit-F24 / T16:Phase 2 三層折扣疊加 schema 預留缺

- **三維:** 種類多(PrimaryDriver:廠牌折扣)、難搞客人(SecondaryDriver:VIP 客制)
- **位置:** 0002 ADR §4.3、ADR-0003 §4 #6
- **問題:** Phase 2 三層折扣疊加(廠牌 + VIP + tier)、Phase 1 schema 無預留 Discount entity / DiscountRule struct。Phase 2 啟用時 Order.total 計算改大、若 Order.total 已上線、歷史 Order 無 discount breakdown 無法回溯。
- **不修會痛在:** 擴充性 — Phase 2 折扣疊加上線時、回頭加 Order.discountsApplied 欄位、歷史 Order 無此欄位;可維護性 — 結帳邏輯重寫、cart / Order entity / TapPay charge amount 三處改;bug 可追蹤性 — 客人「我有 VIP 折扣但沒應用」、Order 無 discount breakdown 找不到
- **推薦處置:** M-3-02 Order entity 加 `discountsApplied: DiscountSnapshot[]`(空 array、Phase 1 不啟用)
- **對應 milestone trigger:** M-3-02
- **對應 backlog:** #47

#### Audit-F25 / T17:adapters 子目錄結構規劃缺

- **三維:** 跨維
- **位置:** `packages/adapters/src/`(空殼)、0002 ADR §4.1
- **問題:** 預期 medusa / supabase / sheets-api / tappay 四 adapter 子目錄、目前空殼無子目錄規劃 README、`packages/adapters/package.json` 無 dependency 預留。M-1-03 第一個 adapter 落地時臨機決定、可能跑出不一致(medusa 嵌 mapper 子目錄、tappay 平鋪)。
- **不修會痛在:** 擴充性 — Phase 2 加 claude-api / image-processor / vendor-crawler、各自取名 random;可維護性 — M-1-03 / M-3-04 / M-3-08 / M-5-02 四 adapter 結構不一致;bug 可追蹤性 — bug「Medusa adapter mapping 錯」要找 mapper 在哪
- **推薦處置:** M-0 收尾前寫 `docs/architecture/ports-and-adapters.md` 含 adapters 子目錄結構模板(對齊 0002 §7 待寫)
- **對應 milestone trigger:** M-1-03 啟動前 / M-0 收尾
- **對應 backlog:** #48
- **partial overlap 0002 ADR §7「ports-and-adapters.md 待寫」**

#### Audit-F26 / T23:apps/admin + sync-engine 未建導致 ESLint dry-run 不全

- **三維:** 跨維
- **位置:** `apps/`(只 storefront / medusa)、`docs/architecture/dependency-rules.md` §3
- **問題:** schema-design / dependency-rules / security-timeline 多處假設 apps/admin / apps/sync-engine 存在、實體未建。dependency-rules.md §3 dry-run 只覆蓋 storefront / medusa 違規、admin / sync-engine 對 packages/* import 邊界守門未驗。
- **不修會痛在:** 擴充性 — M-4a / M-5 啟動時 boundaries 對 admin / sync-engine 未測、可能漏;可維護性 — 現有 ADR 字面假設 4 apps、實體 2 apps、字面 vs 事實 drift;bug 可追蹤性 — M-4a-01 落地時 boundaries 對 admin 失靈、debug 多繞路
- **推薦處置:** M-0-02 啟動時加 admin / sync-engine 對 packages/* 違規 dry-run(對齊現有 7 條 dry-run)
- **對應 milestone trigger:** M-0-02
- **對應 backlog:** #54

#### Audit-F27 / R9:Vercel / Railway / Supabase 部署 region 規劃

- **Risk Level:** Medium(Medium Likelihood × Medium Impact)
- **三維:** 10w 商品(scale + latency)、跨維
- **位置:** 無對應檔(setup §10.x)
- **問題:** Vercel global edge / Railway 預設 US?Supabase SG。Phase 1 客人主要台灣 + 歐洲、跨 region latency 累積。
- **不修會痛在:** 擴充性 — Phase 2 客人量大、p99 latency 上升 200-500ms 客人感受;可維護性 — Railway region 改後 IP / DNS 連帶變;bug 可追蹤性 — 跨 region 慢時、log 在 region A 查 region B 找不到
- **推薦處置:** M-6-06 / M-6-07 啟動前 Sean 拍板部署 region(Railway 改 SG;Vercel 維持 global edge)
- **對應 milestone trigger:** M-6-06 / M-6-07 啟動前
- **對應 backlog:** #65
- **partial overlap STATUS #4(Vercel / Railway 部署是否新建)**

#### Audit-F28 / R10:Medusa-as-API spike verification checklist

- **Risk Level:** Medium(Low-Medium Likelihood × High Impact)
- **三維:** 跨維(基礎架構)
- **位置:** 0002 ADR §6.1 強訊號 #1
- **問題:** 0002 ADR §6.1 列「M-1 spike 出現 Medusa schema 完全無法對應 PCM 業務」為 rollback 強訊號。但 M-0 階段 schema-design 純 docs、未跑 spike 驗證。M-1-02 / M-1-03 落地時若發現 schema mapping 套不上、整 0002 ADR 翻盤、Phase 1 整體延宕 4-6 週。
- **不修會痛在:** 擴充性 — Phase 2 啟動時若 0002 假設仍未驗、Vehicle / Booking 補上時才發現;可維護性 — rollback 路徑 0002 §6.3 已寫、但回退成本 ~1 週是樂觀估;bug 可追蹤性 — spike 失敗時、辨識「設計錯」vs「實作錯」需文件
- **推薦處置:** M-1-02 / M-1-03 落地前 Sean 確認 spike 驗證標準(metadata 套上 = 過 / 套不上 = 觸發 §6.3 rollback)、寫 verification checklist
- **對應 milestone trigger:** M-1-02 / M-1-03 啟動前
- **對應 backlog:** #66

#### Audit-F29 / R11:submodule design-reference 失靈 fallback

- **Risk Level:** Medium(Low Likelihood × High Impact)
- **三維:** 跨維
- **位置:** NORTHSTAR §2.2、CLAUDE.md submodule 操作
- **問題:** design-reference submodule 來自 pcmmotorsports/pcm-website-design repo、若被誤刪 / 改 access / 倉庫 force push、submodule pointer 找不到、storefront 無法 build。
- **不修會痛在:** 擴充性 — Phase 2 design 持續進化、submodule 是長期依賴;可維護性 — 無 submodule fallback 流程;bug 可追蹤性 — submodule 失靈時、新 Claude Code 不知道是 PCM 端錯還 design 端錯
- **推薦處置:** NORTHSTAR §2.2 加「submodule 失靈 fallback」流程(每月 mirror 到 PCM repo `design-reference-snapshot/` 只讀 backup)
- **對應 milestone trigger:** M-1 啟動前 / M-6-08 上線前
- **對應 backlog:** #67

#### Audit-F30 / R12:oncall / incident response runbook

- **Risk Level:** Medium(High Likelihood × Medium Impact)
- **三維:** 難搞客人(SLA)、10w 商品(monitoring 連動)
- **位置:** 無對應檔、屬流程漏
- **問題:** 上線後 production 出事、誰接電話?哪個時段?升級 Sean 的 trigger?無流程。Phase 1 階段 1 員工少 2-3 人、Sean 出差時 production 中斷 4 hr 沒人察覺。
- **不修會痛在:** 擴充性 — Phase 2 員工增加、SLA 流程沒先定、tier-up 時混亂;可維護性 — incident 處理散在 LINE 對話、無 retrospective;bug 可追蹤性 — incident 後找 root cause、無 timeline trace
- **推薦處置:** M-6-08 上線前寫 `docs/runbooks/incident-response.md`(P0/P1/P2 + escalation 階梯)
- **對應 milestone trigger:** M-6-08
- **對應 backlog:** #68

#### Audit-F31 / R13:個資法資料權利(取出 / 刪除)流程缺

- **Risk Level:** Medium-High(Medium Likelihood × High Impact)
- **三維:** 難搞客人(PrimaryDriver:GDPR / 個資法)
- **位置:** 無對應檔、屬流程漏 + 法律
- **問題:** 台灣個資法第 11 條客人有權「請求刪除個資」「請求複本」、PCM 收到後 30 天內回。無流程 = 收到刪除請求時員工不知道:刪 Customer entity?Order 留嗎?支付紀錄 PII?
- **不修會痛在:** 擴充性 — Phase 2 個資量爆增、刪除流程沒自動化、員工每件 30+ 分鐘;可維護性 — 刪除 Customer 時 Order 是否需保留(法律保存 5 年要求)、無規範;bug 可追蹤性 — 法律稽核時、無流程紀錄無法證明合規
- **推薦處置:** M-4a-10(admin/customers)階段寫 `docs/runbooks/data-rights-sop.md`(刪除請求處理 + 保留範圍 + 法律保存規則)
- **對應 milestone trigger:** M-4a-10 / M-6-08
- **對應 backlog:** #69

#### Audit-F32 / R14:B2B 月結對帳 SOP 缺

- **Risk Level:** Medium(Medium-High Likelihood × Medium Impact)
- **三維:** 難搞客人(B2B 對帳)
- **位置:** 無對應檔、屬流程漏
- **問題:** store / premiumStore tier 月結客戶、月底結帳、admin 怎麼產對帳單?無 SOP。對應 backlog #27(markPartiallyPaid 多次累積)是 schema 端、本條是流程端。
- **不修會痛在:** 擴充性 — Phase 2 多店家 tier、月結 SOP 沒先定、各 tier 處理散;可維護性 — 月結對帳每月跑一次、若 SOP 漏定則每月返工;bug 可追蹤性 — 客戶質疑對帳金額、無 query log 還原
- **推薦處置:** M-4a-08(admin 訂單列表)落地時同步寫 SOP(月底跑 listByCustomer + listByDateRange + sum 月結金額)
- **對應 milestone trigger:** M-4a-08
- **對應 backlog:** #70

#### Audit-F33 / R15:TapPay 商家合約限制檢核

- **Risk Level:** Medium(Low-Medium Likelihood × High Impact)
- **三維:** 跨維(法律)
- **位置:** 無對應檔、屬契約 / 法律
- **問題:** TapPay 商家合約有月交易額度上限 / 特定商品(機車改裝零件部分品類可能算高風險)、合約細節 PCM 端應該驗。
- **不修會痛在:** 擴充性 — Phase 2 加新商品類別(可能含禁令)、要重核合約;可維護性 — 無 compliance checklist、員工新增商品不知是否合規;bug 可追蹤性 — 被凍結帳戶時、不知是哪個商品觸發
- **推薦處置:** M-3-08 啟動前 Sean 跟 TapPay 確認商品類別 OK 簽約
- **對應 milestone trigger:** M-3-08 啟動前
- **對應 backlog:** #71

#### Audit-F34 / R17:篩選器資料 source-of-truth 衝突

- **Risk Level:** Medium(Medium Likelihood × Medium Impact)
- **三維:** 種類多(篩選 source-of-truth)
- **位置:** `design-reference/data/*` 與 Medusa schema
- **問題:** design 端有 mock data(brands.js / vehicles.js)、Medusa 端商品建好後實際 brand / motoBrand 來自商品 metadata。Phase 1 早期 storefront 篩選器可能還是直讀 design mock、後期改 fetch Medusa list。Phase 過渡時、篩選器選項與商品實際 metadata 不一致(篩選顯示「Brembo」但 Medusa 沒商品)。
- **不修會痛在:** 擴充性 — Phase 2 加新 brand、篩選器自動同步嗎?可維護性 — design mock 改一處、Medusa 改一處、不同步;bug 可追蹤性 — 客人投訴「篩選沒結果」、查不出是 mock 漏還是 Medusa 漏
- **推薦處置:** M-1-12 落地前明確規範「篩選選項從 IProductRepository.listBrands() 拿、不從 design mock」
- **對應 milestone trigger:** M-1-12
- **對應 backlog:** #72

#### Audit-F35 / R18:sync-engine 寫 Medusa metadata race condition

- **Risk Level:** Medium(Medium Likelihood × Medium Impact)
- **三維:** 10w 商品(資料一致性)
- **位置:** 0002 ADR §6.1 強訊號 #4
- **問題:** sync-engine 跑 hourly cron、若同 hour 內 admin 員工也手動改商品(M-4a-06)、兩個 source 同時寫 Medusa metadata、後寫者覆蓋前者。0002 §6.1 強訊號 #4 已列、但無預防策略。
- **不修會痛在:** 擴充性 — Phase 2 加 vendor crawler、source 變 3 個、race 風險指數上升;可維護性 — 無 audit log policy、覆蓋還原靠 Medusa Admin 歷史(若有);bug 可追蹤性 — metadata 突然變、不知是 sync 還是員工改
- **推薦處置:** M-5-03 落地時加「last-write-wins + audit log」流程、sync-engine 寫前查 timestamp、admin 改後 1 hr 內 sync 跳過該 SKU
- **對應 milestone trigger:** M-5-03
- **對應 backlog:** #73

#### Audit-F36 / R19:apps/admin 與 apps/sync-engine 部署 plan 缺

- **Risk Level:** Medium(Medium-High Likelihood × Medium Impact)
- **三維:** 跨維
- **位置:** 無對應檔(setup §10.x 只規劃 storefront / medusa)
- **問題:** apps/admin 部署在哪?Vercel 同 storefront 還是 Railway?apps/sync-engine 部署本機已知、是否雲端 cron 備援?無規劃、M-4a / M-5 上線時臨機決定。
- **不修會痛在:** 擴充性 — Phase 2 admin 流量上升、若 free tier 不夠回頭遷;可維護性 — 多 app 部署在不同 platform、env vars / secrets 分散;bug 可追蹤性 — cross-app log 散在 Vercel / Railway / local、debug 多走幾處
- **推薦處置:** M-4a-01 啟動前 Sean 拍板部署 plan(admin 走 Vercel、sync-engine 維持本機)、寫進 setup §10
- **對應 milestone trigger:** M-4a-01 / M-5-01 啟動前
- **對應 backlog:** #74

### §3.4 🟡 Low(6 條、不展開、見 backlog 條目)

| # | 標題 | backlog | trigger |
|---|---|---|---|
| F37 | T18 MotoBrand 升級 trigger | #49 | M-1-09 ~ M-1-11 |
| F38 | T19 SyncResult.errors 結構化 | #50 | M-5-03 |
| F39 | T20 list 三方法分頁 TODO 一致性 | #51 | M-0 收尾 / M-1-03 啟動前 |
| F40 | T21 Order.total JSDoc drift | #52 | M-3-02(對齊 T3) |
| F41 | T22 packages 空殼 README / file-level JSDoc | #53 | M-0 收尾 |

(T19 是 5 條中 1 個三維歸難搞客人、其他 4 條歸跨維)

### §3.5 🟢 觀察(2 條)

| # | 標題 | backlog | trigger |
|---|---|---|---|
| F43 | T24 contract test 框架 | #55 | Phase 2 / M-6-08 上線後觀察 |
| F44 | T25 disaster recovery plan | #56 | M-6-08 / Phase 2 |

---

## §4 backlog 對應

### §4.1 新增 backlog 條目(#32 - #74、合計 43 條、本 audit findings 落地)

每條對應 audit §3 編號、本檔不重述條目本體、見 `docs/phase-1-backlog.md`。

| backlog | audit § | 標題 | 優先級 | 對應 milestone |
|---|---|---|---|---|
| #32 | F16 | T1 IPricingRepository 抽象 | 🔴 | M-2-08 |
| #33 | F17 | T2 IInventoryRepository 缺位 | 🔴 | M-1-02 / M-5-05 |
| #34 | F2 | T3 Order.total breakdown | 🔴 | M-3-02 |
| #35 | F18 | T4 search engine plan | 🔴 | M-1-03 |
| #36 | F19 | T5 monitoring / alerting | 🔴 | M-6-08 |
| #37 | F7 | T6 OrderItem lineTotal + tier 紀錄 | 🔴 | M-3-02 |
| #38 | F3 | T7 listByFitment 多選 | 🔴 | M-1-03 / M-1-12 |
| #39 | F4 | T8 Order.fulfillmentMethod | 🔴 | M-3-02 |
| #40 | F20 | T9 Customer phoneNumber + address | 🟠 | M-2-04 |
| #41 | F5 | T10 ChargeStatus disputed | 🔴 | M-3-08 |
| #42 | F8 | T11 logging strategy / PII utility | 🔴 | M-3-08 |
| #43 | F21 | T12 image CDN | 🟠 | M-1-02 |
| #44 | F6 | T13 種子 → ongoing(合併 R16) | 🔴 | M-1-16 |
| #45 | F22 | T14 testing-strategy | 🟠 | M-1-02 |
| #46 | F23 | T15 bounded-contexts | 🟠 | M-1-02 |
| #47 | F24 | T16 三層折扣 schema 預留 | 🟠 | M-3-02 |
| #48 | F25 | T17 adapters 子目錄 | 🟠 | M-0 收尾 / M-1-03 |
| #49 | F37 | T18 MotoBrand 升級 trigger | 🟡 | M-1-09 ~ M-1-11 |
| #50 | F38 | T19 SyncResult.errors 結構化 | 🟡 | M-5-03 |
| #51 | F39 | T20 list 分頁 TODO 一致性 | 🟡 | M-0 收尾 |
| #52 | F40 | T21 Order.total JSDoc drift | 🟡 | M-3-02 |
| #53 | F41 | T22 packages 空殼 README | 🟡 | M-0 收尾 |
| #54 | F26 | T23 admin/sync-engine dry-run 補 | 🟠 | M-0-02 |
| #55 | F43 | T24 contract test 框架 | 🟢 | Phase 2 |
| #56 | F44 | T25 disaster recovery | 🟢 | M-6-08 / Phase 2 |
| #57 | F1 | R1 Supabase free tier | 🔴 Critical | M-1-16 |
| #58 | F9 | R2 sync-engine 本機 redundancy | 🔴 | M-5-09 / Phase 2 |
| #59 | F10 | R3 TapPay env vars 切換 | 🔴 | M-6-08 |
| #60 | F11 | R4 Railway free tier cold start | 🔴 | M-3-01 |
| #61 | F12 | R5 TapPay production 申請時序 | 🔴 | M-3 啟動前 |
| #62 | F13 | R6 客服退款 SOP | 🔴 | M-4a-12 |
| #63 | F14 | R7 dispute / chargeback SOP | 🔴 | M-6-08 |
| #64 | F15 | R8 發票自動化(STATUS #1 補三視角) | 🔴 | M-3 啟動前 |
| #65 | F27 | R9 Vercel / Railway region | 🟠 | M-6-06 / M-6-07 |
| #66 | F28 | R10 Medusa-as-API spike | 🟠 | M-1-02 / M-1-03 |
| #67 | F29 | R11 submodule fallback | 🟠 | M-1 啟動前 / M-6-08 |
| #68 | F30 | R12 oncall runbook | 🟠 | M-6-08 |
| #69 | F31 | R13 個資法資料權利 | 🟠 | M-4a-10 / M-6-08 |
| #70 | F32 | R14 B2B 月結對帳 SOP | 🟠 | M-4a-08 |
| #71 | F33 | R15 TapPay 商家合約 | 🟠 | M-3-08 |
| #72 | F34 | R17 篩選器 source-of-truth | 🟠 | M-1-12 |
| #73 | F35 | R18 sync-engine race condition | 🟠 | M-5-03 |
| #74 | F36 | R19 admin/sync-engine 部署 plan | 🟠 | M-4a-01 / M-5-01 |

### §4.2 既有 backlog 條目引用(本 audit 不改條目本體、只記引用)

本 audit 未發現需更新或推翻 #1-#31 既有條目本體。以下既有條目與本 audit findings 有 partial overlap、列引用對應:

| 既有 # | 本 audit 對應 | 說明 |
|---|---|---|
| #4 GCP JSON key 路徑 | F8 T11 logging strategy | T11 範圍更廣、#4 是 GCP 特定 SA JSON 路徑 |
| #16 TapPay PII logging mask | F8 T11 logging strategy | T11 範圍更廣、#16 是 TapPay 特定 |
| #20 PaginationParams + Paginated<T> | F39 T20 list 分頁 TODO | T20 是文檔層、#20 是 type system 預定義層 |
| #27 markPartiallyPaid 多次累積 | F32 R14 B2B 月結對帳 SOP | #27 schema、R14 流程 |
| #29 Order paymentMethod | F4 T8 fulfillmentMethod | 不同欄位、補完整對(payment vs fulfillment) |
| #30 fitment 篩選 scale | F18 T4 search engine plan | T4 keyword 不只 fitment、本表是補互補 search 範圍 |
| #31 客服 schema 預留 | F13 R6 客服退款 SOP | #31 schema 欄位、R6 流程 |

**STATUS Sean 待決策對應:**

| STATUS # | 本 audit 對應 | 說明 |
|---|---|---|
| #1 發票自動化 | F15 R8(本表補三視角) | STATUS 已列待決、本表補「不拍會痛在哪」 |
| #2 G2 測試覆蓋率 + E2E | F22 T14 testing-strategy(部分 overlap) | T14 是策略文件、#2 是覆蓋率拍板 |
| #3 TapPay sandbox 沿用 | F12 R5 production 申請時序 | #3 sandbox 沿用拍板、R5 production 啟用時序(不同議題) |
| #4 Vercel / Railway 部署 | F27 / F36 R9 / R19(部分 overlap) | #4 是新建 / 沿用拍板、R9 region / R19 admin&sync 部署 plan |

---

## §5 三視角總結

### §5.1 擴充性盲區(找出最痛的 7 個)

1. **R1 Supabase free tier**:Phase 2 加 Vehicle / Booking / Wallet 表、row 數爆、不升級無法擴
2. **T1 IPricingRepository**:Phase 2 三層折扣疊加上線、無 service 抽象、storefront server bundle 含計算邏輯
3. **T2 IInventoryRepository**:Phase 2 多倉庫 inventory 分散、無 IInventoryRepository 等於 inventory 跨倉邏輯散
4. **R2 sync-engine 本機**:Phase 2 多 adapter(LINE / 物流 / 廠商爬蟲)進來、本機機器更不能停
5. **T8 fulfillmentMethod**:Phase 2 加宅配 / 超商 / 機車快遞、enum migrate 成本高
6. **T16 三層折扣 schema**:Phase 2 折扣疊加上線時、回頭加 Order.discountsApplied、歷史無
7. **T13 種子 transition**:Phase 2 加 vendor crawler、source-of-truth 衝突更多

### §5.2 可維護性盲區(找出最痛的 7 個)

1. **T11 logging strategy**:每個 adapter 自己決定 mask 邏輯、改 mask 規則(例追加身分證遮蔽)散在多處
2. **T15 bounded-contexts.md 缺**:domain 改命名(motoBrand → vehicleBrand)、要 grep 全 repo + 4 ADR + schema-design + 各 context types.ts、無單一 source
3. **R6 客服退款 SOP**:員工換人 / 訓練成本高
4. **T17 adapters 子目錄**:M-1-03 / M-3-04 / M-3-08 / M-5-02 四 adapter 落地時、結構不一致
5. **R12 oncall runbook**:incident 處理散在 LINE 對話、無 retrospective
6. **R10 Medusa-as-API spike**:rollback 路徑 0002 §6.3 已寫、但回退成本 ~1 週是樂觀估
7. **T14 testing-strategy**:M-1-02 寫的 test 風格 vs M-3-02 寫的不同、回頭 review 不知道誰是對標

### §5.3 bug 可追蹤性盲區(找出最痛的 7 個)

1. **T5 monitoring**:客人「下單失敗」、無 distributed tracing、不知是 storefront / Medusa / TapPay / Supabase 哪一段失敗
2. **T3 Order.total breakdown**:客服「我的訂單退款少 300」、查 Order.total 看不到拆解、必須 grep TapPay rec_trade_id 找原始 amount
3. **T6 OrderItem lineTotal + tier**:稽核時「為何同商品同時段 admin 看到的 unitPrice 不同」、無 tier 紀錄找不到 root cause
4. **T11 PII utility**:dispute 客訴「PCM 把我電話 log 出來」、grep log 找不到統一遮蔽點
5. **R3 TapPay env vars**:charge 0 元異常時、查 logs 才知道走 sandbox、上線當天才發現
6. **R7 dispute SOP**:dispute 失敗後、無 retrospective 找改善點
7. **R18 sync-engine race**:metadata 突然變、不知是 sync 還是員工改

---

## §6 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-02 | 初始化全專案 audit 報告(M-0-06 完成後 sanity check)、B 路線 主 session 跑 2 Skill(engineering:tech-debt + operations:risk-assessment)、tech-debt 25 + risk-assessment 19、過 filter 留 43 條進 backlog #32-#74(T13 合併 R16)、§4.2 既有條目 partial overlap 引用 7 條 + STATUS Sean 待決策對應 4 條 | Claude Code(全專案 audit slice) |

— END —
