# M-1-03 a2-2 v3 — Sean 拍板共識(2026-05-06)

## 背景

a2-2 v3 是 a2-2(products schema rebuild)的第三版 PRD。v1(5/6 上午)、v2(中段 Code audit)、v3(整合 review)。

當前 session(claude.ai 對話)在 v3 review 階段、發現 4 個矛盾、Sean 拍板 5 Q 後切新 session 落地。本文件記錄 5 Q 拍板共識 + PRD v3 改寫指引 + Slice A 拆法 + 教訓、給新 session 起手讀。

## Sean 5 Q 拍板字面
```

Q1: A2 Q2: B2 Q3: C2 Q4: D1 Q5: E2

```

| Q | 拍板 | 含義 |
|---|---|---|
| Q1 | A2 | 維持 supabase-schema-design.md §5.1 jsonb 三 key 真權威、PRD v3 §2 §3 改寫對齊 |
| Q2 | B2 | 維持 a2-1 service_role 慣例、PRD v3 §7 RLS 改寫對齊(不用 JWT custom claim) |
| Q3 | C2 | 維持同日 a2-2 v1 Q1=A 拍板「customers + customer_groups 推遲 M-1-14 / M-2-01」、PRD v3 §4 改寫推遲 |
| Q4 | D1 | Slice A 拆 A1(migration apply、~45 min)+ A2(trigger / RLS 驗 + STATUS、~40 min) |
| Q5 | E2 | 當前 session busboy-end 收工、新 session 重組 PRD v3 + 落地 |

## PRD v3 改寫指引(新 session 落地時)

新 session 寫 docs/specs/M-1-03-products-schema-prd-v3.md 時、必先請 Code grep 真權威字面再寫(對齊原則 10、不憑記憶):

### Q1=A2 對應改寫(price 設計)

- §2 products 表 retail_price + wholesale_price 兩欄 → 改回 price_by_tier jsonb(對齊 §5.1)
- §3 variants 表 price_override + wholesale_override 兩欄 → 改回 jsonb 設計(細節 grep §5.1 確認 column 命名 + CHECK 約束形式)
- §1 對照表「對齊 §5.1」與 §2 §3 字面一致

新 session 操作:Code 先 grep supabase-schema-design.md §5.1 字面、確認 jsonb CHECK 三 key 約束 + 設計理由(5w SKU × 3 tier = 15w row vs 5w row、節省 join cost)、再寫 PRD v3 §2 §3 字面。

### Q2=B2 對應改寫(RLS 機制)

- §7 RLS policy `TO authenticated USING (auth.jwt() ->> 'role' = 'admin')` → 改 service_role 寫法(對齊 a2-1 brands/categories 已落地慣例 + §9.3 service role key 紀律)

新 session 操作:Code 先 grep a2-1 落地的 brands/categories migration RLS policy 字面、確認 service_role 寫法、再改寫 PRD v3 §7。

### Q3=C2 對應改寫(customer_groups 推遲)

- §4 Phase 1 預留 customers + customer_groups 表 → 整段刪除、改寫成「customers + customer_groups 推遲 M-1-14 / M-2-01、a2-2 v3 不建表」
- a2-2 v3 範圍:只 products + variants + brands / categories FK + products RLS、**不**含 customers / customer_groups / customer.tier 欄位 / customer_group_id FK
- 三層折扣機制 application 計算 → 推到 M-1-14 / M-2-01 統一設計

新 session 操作:Code 確認 a2-2 v3 範圍邊界、不引入 customer.tier / customer_groups FK / 預留欄位。

### Q4=D1 對應改寫(Slice 拆法)

- §10 Slice A 85 min → 拆 Slice A1(~45 min)+ Slice A2(~40 min)
- Slice A1:products + variants migration 寫 + apply、肉眼驗 schema 落地 + 跨表 FK 通(brands / categories)
- Slice A2:trigger 落地(colors_aggregate 等)+ RLS policy 落地、肉眼驗 trigger 行為 + RLS 行為、STATUS amend

對齊鐵則 4(每 slice 15-45 min、超 90 min 拒)。

## 4 矛盾揭示(Code 整合 review 抓到、認可)

| # | 字面 | 事實 | 解決 |
|---|---|---|---|
| P1.1 | PRD §1 寫「對齊 §5.1」 | §2 §3 用 integer 兩欄、違背 §5.1 jsonb 真權威 | Q1=A2、§2 §3 改回 jsonb |
| P1.2 | PRD §7 用 JWT custom claim | a2-1 已落地 service_role 慣例 | Q2=B2、§7 改 service_role |
| P1.3 | PRD §4 寫 Phase 1 預留 customer_groups | 同日 a2-2 v1 Q1=A 拍板字面是「推遲」 | Q3=C2、§4 改寫推遲 |
| P1.4 | Slice A 估時 85 min | 鐵則 4 上限 45 min | Q4=D1、拆 A1 + A2 |
| 字面 placeholder | Sean 訊息結尾 `===== PRD V3 字面起 =====` 之間 | placeholder「[Sean:把我上一輪訊息...複製貼到這裡]」未填 | Slice 0 落地暫停、本決策文件記錄共識、新 session 重組 PRD 字面 |

## Claude.ai 自查違規(原則 10)

寫 PRD v3 §2 §3 §7 字面時、憑記憶寫 schema 細節(integer 兩欄 / JWT RLS / Phase 1 預留 customer_groups)、**沒先請 Code grep §5.1 / §9 / Q1=A 真權威字面**、導致 PRD 內部矛盾。

trigger 補:重大 schema PRD 改寫前、Claude.ai 必先請 Code grep 既有真權威字面(§5 / §9 / 同日拍板)再寫、不憑記憶。M-0-09 完工 trigger 補進 docs/working-style.md 自檢清單第 11 條。

## Code 抗住 placeholder(認可)

Code 在 Slice 0 落地前發現 Sean 訊息分隔線之間是 placeholder、抗住不執行、屬「字面 vs 事實」鐵則 11 精準應用範例。Code 沒越權給推薦、列 5 Q 選項給 Sean 拍板、屬實作 / 規劃分工正確。

## 新 session 起手 checklist

1. 前置 4 綠(cd / branch=dev / git status clean / git log 對齊 STATUS.md)
2. 讀 STATUS.md 對齊當前狀態
3. **讀本文件 docs/specs/M-1-03-a2-2-v3-decisions.md** 拿拍板共識
4. 按 Q1-Q4 拍板改寫 PRD v3 字面 + Slice A 拆 A1 + A2、Code grep 真權威字面再寫(原則 10)
5. PRD v3 落地進 docs/specs/M-1-03-products-schema-prd-v3.md
6. Slice A1 起手:products + variants migration 寫 + apply

## 變更紀錄

| 日期 | 版本 | 內容 |
|---|---|---|
| 2026-05-06 | v1 | 初版、記錄 a2-2 v3 review 階段 5 Q 拍板共識 + PRD 改寫指引 + 教訓 |
