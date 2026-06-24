# M-3 3DS 雙扣 anomaly / 退款 dedicated PRD(乙路·退款版)v0.3

> **狀態:** 🟢 **`prd_review` 通過(codex K1 round3 = PASS、0 must-fix、findings 無,2026-06-24)**;§14 步 12 達成。待 Sean 拍板開工 R1b1a(§14 步 13)。
> **這是什麼:** canonical plan §14 步 11 的 L3 PRD gate 交付物。canonical plan **不等同 PRD**(§14 步 12 明訂)→ 本檔把 canonical 散落於 §2.6 / §3 / §4 R1b1a·R1b1b·R1b1c / §7 / §8 / §10.8 / §12 的「雙扣 anomaly + 退款 lifecycle」設計**收斂成單一可審 PRD**,過 `prd_review` 後才能實作 R1b1a / R1b1b / R1b1c / W1。
> **真權威:** `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`(v9、已過 Codex round11)。**本 PRD 不新增設計、不偏離 canonical**;任何與 canonical 衝突處以 canonical 為準、回報修本檔。
> **不授權任何實作:** 本檔僅供審查;未過 `prd_review` 前不得開 R1b1a。守線 = 不 push / merge / db push / 開 flag(`TAPPAY_3DS_ENABLED` 全程 false)。

---

## §0 背景與為何 L3

### 0.1 業務問題(雙扣從何而來)
乙路·立即重刷(§0 Sean 拍板)為了讓放棄 3DS 的客人**馬上重買**,放寬付款鎖:客人放棄該次付款、且 Record 確認當下為 `auth_or_pending(4)` 時,server-only CAS 把舊 attempt 從 `pending` 轉 `released`,退出去重 / in-flight 鎖讓重刷(R1a3 已實作)。

`released` 的語意是「真失敗未定」——TapPay 沙盒已實證 **late success 為真**(離開 3D 後複製 payment_url 貼新分頁可重開完成、舊單變 paid,canonical 附錄 A / PCM-2026-0052)。因此會出現:**舊 released attempt 事後在銀行端成功扣款(late success)→ 舊單 paid;同時客人重刷的新單也 paid**=**同一筆消費被扣兩次**。這是 §0 informed-accept 的「極罕見雙扣窗」。

### 0.2 為何必須有這個子系統
canonical §2.4/§2.6:乙路安全性**不依賴「record_status 4 不會晚扣」假設**,而是靠「對帳集留 released → late success 由 markCharged 自動捕捉 → **雙扣明確化** → 強制偵測 + Sean 手動退款」這條鏈。**沒有 anomaly 偵測 + 退款流程,乙路的雙扣窗就只剩『扣兩次』沒有『退一次』** → 子系統是乙路成立的必要條件,不是 optional。

### 0.3 為何分級 L3(鐵則 9)
| 判據 | 本子系統 |
|---|---|
| 異動頻率 | 退款由人(Sean / 未來 staff)**操作、屬持續營運動作**(每偵測到一筆雙扣就退一次)→ 非年度級 hardcode |
| 資料性質 | 真錢退款 + **稽核軌跡**(誰在何時 claim / 退 / reopen)→ 必 DB-backed、不可 hardcode |
| 風險 | 退款金額、重複退款、退錯目標 → 法遵 / 對帳 / 信任風險 |

canonical §9 line 286 明列:**「anomaly / 退款候選資料 = L3(必 DB-backed)」**;§9 line 290 / §14 步 11 將 R1b1a / R1b1b / R1b1c / W1 標 **L3🔴PRD 前置**。本檔即該前置 PRD。

---

## §1 範圍與目標

### 1.1 包含(本 PRD 覆蓋、對應 4 個 slice)
| slice | 內容 | migration | 估時 |
|---|---|---|---|
| **R1b1a** | anomaly 主表 + append-only event 表 + constraints + 兩表 RLS/table ACL | 1 migration | 30–45m |
| **R1b1b** | anomaly claim/resolve owner-only RPC(resolve 內含 reopen / unknown 分支)+ 同交易寫 event + ACL/CAS tests | 1 migration | 30–45m |
| **R1b1c** | `mark_charge_attempt_charged` `released→charged` + **同交易建 open anomaly**(anomaly genesis) | 1 migration | 25–40m |
| **W1** | open anomaly 退款候選報表 + 7 步人工退款 runbook | report + docs | 35m |

### 1.2 不包含(明確排除、勿在本批做)
- **自動退款(TapPay Refund API)** — adapter 現 stub;§0 Q1 拍板「過渡 = Sean Dashboard 手動退」,自動退款 = **上線前 backlog**、本批不做。
- **後台 admin 退款操作介面 + 正式 staff / admin 身分模型** — 🔴 Sean 2026-06-24 拍板:退款操作**日後一定走後台給員工用**;但**本批 Phase 1 不做**——縮為 owner-only RPC + SQL 報表 + runbook,Phase 1 owner-only RPC 以 `session_user` 記 DB session role(非人類 staff ID)。後台 admin UI + 真正的 staff actor / 權限模型 = **已定的緊接下階段獨立 milestone**(見 §9.3;canonical §3 round7 二「未來獨立 migration」)。🔴 **操作面**(兩表 / 狀態機 / claim·resolve RPC)**UI-agnostic**:日後後台 admin 直接呼同一批 RPC,**現在做 SQL 不擋未來做 UI**;⚠️ 但「記真人 staff actor」未必免改資料層(見 §9.3)。
- **自動 close released** — 是否在取得 TapPay 官方終局契約後做「自動 close released」= Phase 1 不做、未來獨立 migration(canonical §13)。
- **released 生命週期本體**(R1a1–a3 / R1b2 / R1b3 / R1c1–c3)— 已在 canonical 定稿、非本 PRD;本 PRD 只接 R1b1c 的「genesis」交界。
- **塊A 前端 3DS UX / 三事件分流 / fallback(A1/A2/A3)** — L2、canonical §6;非本 PRD。
- **退款金額 ≠ 訂單金額的部分退款 / 多幣別 / 手續費拆分** — 不在 Phase 1 雙扣場景(雙扣 = 兩張同額 paid,退舊那張全額)。

### 1.3 目標(可驗收)
1. 雙扣事件**100% 留痕**:每筆 `released→charged` late success 同交易建一筆 `open` anomaly;NOT NULL 欄齊填(否則 INSERT RAISE → 寧可 markCharged 失敗也不漏記)。
2. 退款工作**系統內序列化**:同一 anomaly 平行 claim 只一人成功;狀態機單向、終態不可逆;退款結果不確定時 **fail-closed 保持 `refunding`**。
3. **稽核 append-only(application/RPC 路徑)**:所有狀態轉移同交易寫 event;**無 UPDATE/DELETE RPC + table ACL 全 REVOKE**(reopen 清主表 claimed 欄但 event 歷史保留)。🔴 誠實:append-only 由「無改/刪 RPC + ACL」保證,**owner/postgres 物理上仍可直接改表、非 DB 強制不可竄改**(canonical line 162 僅要求無 UPDATE/DELETE RPC)。
4. **零外洩 / 零越權**:兩表 RLS zero-policy + table ACL 對 5 角色全 REVOKE;`payment_confirmer` 零 table 權限;只 owner/postgres 經受控 SECDEF RPC 寫。

---

## §2 資料模型(R1b1a)

> 逐欄定稿自 canonical §4 R1b1a(line 156–164);**不裸列、不增刪欄**。

### 2.1 主表 `public.payment_double_charge_anomalies`

```sql
CREATE TABLE public.payment_double_charge_anomalies (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  old_attempt_id            uuid        UNIQUE NOT NULL REFERENCES public.payment_charge_attempts(id),
  old_order_id              uuid        NOT NULL REFERENCES public.orders(id),
  user_id                   uuid        NOT NULL,
  cart_session_id           uuid        NOT NULL,
  rec_trade_id              text        NOT NULL,
  refund_target_rec_trade_id text       NOT NULL,        -- 固定 = 舊 attempt 的 rec、建立後不可改
  released_at               timestamptz NOT NULL,         -- 取自 attempt.released_at
  charged_at                timestamptz NOT NULL,
  amount                    integer     NOT NULL CHECK (amount >= 0),  -- 取 orders.total 整數快照、禁浮點
  status                    text        NOT NULL DEFAULT 'open',
  refund_claimed_at         timestamptz,
  refund_claimed_by         text,
  resolved_at               timestamptz,
  resolved_by               text,
  resolution_note           text,
  refund_provider_reference text,
  created_at                timestamptz NOT NULL DEFAULT now()
);
```

**status CHECK** = `open` | `refunding` | `refunded` | `dismissed`。
- `refunded` / `dismissed` = **不可逆終態**。
- `refund_target_rec_trade_id` 建立後**不可被 claim/resolve 修改**(固定為 `released→charged` 舊 attempt 的 rec、**絕不指向新訂單**)。

**主表一致性 CHECK constraints**(round8 二:reopen note 移 event 表後,主表 open 維持乾淨):
| status | 約束 |
|---|---|
| `open` | `refund_claimed_at/by` + `resolved_at/by` + `resolution_note` + `refund_provider_reference` **皆 NULL** |
| `refunding` | `refund_claimed_at/by` **非 NULL**、`resolved_at/by` **NULL** |
| `refunded` | `refund_claimed_at/by` + `resolved_at/by` + `refund_target_rec_trade_id` **非 NULL**,且 `refund_provider_reference` **非空** |
| `dismissed` | `resolved_at/by/resolution_note` **非 NULL**、`refund_provider_reference` **NULL** |

### 2.2 append-only 稽核 event 表 `public.payment_double_charge_anomaly_events`

```sql
CREATE TABLE public.payment_double_charge_anomaly_events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id         uuid        NOT NULL REFERENCES public.payment_double_charge_anomalies(id),
  event_type         text        NOT NULL,   -- CHECK allowlist 見下
  from_status        text,
  to_status          text,
  actor_session_role text        NOT NULL,   -- 寫 session_user、記 DB session role(非人類 staff ID)
  note               text        NOT NULL,
  provider_reference text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

**event_type CHECK allowlist** = `claim` | `refund_confirmed` | `refund_not_executed` | `refund_uncertain` | `reopened` | `dismissed`。

**append-only 硬規(application/RPC 路徑):**
- **不提供 UPDATE / DELETE RPC**;table ACL 對所有角色 REVOKE → 無角色可直接改/刪。
- 只允許 owner-run SECDEF RPC(R1b1b)在**與主表轉移同一交易**內 INSERT。
- 🔴 **誠實邊界**:append-only 是「RPC 路徑 + ACL」層級保證;**DB owner/postgres 物理上仍可直接改表**,canonical(line 162)亦僅要求無 UPDATE/DELETE RPC + table ACL 收斂,非宣稱 DB 物理不可竄改。

### 2.3 安全(兩表共用,詳 §4)
兩表各 `ALTER TABLE … ENABLE ROW LEVEL SECURITY`(Phase 1 **zero-policy** = 無 policy → 非 owner/postgres 不得直接存取);`REVOKE ALL ON TABLE` 涵蓋 **PUBLIC / anon / authenticated / service_role / payment_confirmer**;migration 含 `has_table_privilege` / `information_schema.role_table_grants` **fail-closed assert**。

---

## §3 生命週期狀態機(R1b1b 行為合約)

```
                claim_double_charge_anomaly_for_refund
   ┌──────┐  (open→refunding, CAS WHERE status='open', 平行只一人)  ┌───────────┐
   │ open │ ───────────────────────────────────────────────────────▶│ refunding │
   └──────┘                                                          └───────────┘
      │                                                              │    │    │
      │ resolve(open→dismissed)                                      │    │    │ resolve, Dashboard 明確退款成功
      │ 確認非雙扣                          resolve, 明確「未退款/未執行」│    │    ▼ (refunding→refunded)
      ▼                                    清主表 claimed/provider     │    │  ┌──────────┐
 ┌───────────┐                            event 留 refund_not_executed │    │  │ refunded │ 終態(不可逆)
 │ dismissed │ 終態(不可逆)                + reopened ────────────────┘    │  └──────────┘
 └───────────┘                                                            │
                                       resolve, 退款結果不確定/Dashboard 回應遺失
                                       → 維持 refunding、寫 refund_uncertain event
                                       → 不可 reopen、不可再 claim、不可再退款
```

### 3.1 合法轉移(只此四條,其餘一律否決)
1. **`open → refunding`**(claim)— CAS `WHERE status='open'`;寫 `refund_claimed_at=now()`、`refund_claimed_by=session_user`;同交易寫 `claim` event。
2. **`refunding → refunded`**(resolve,Dashboard 明確退款成功)— 寫 `resolved_at=now()`/`resolved_by=session_user`/`resolution_note`(必填)/`refund_provider_reference`(必填、退款證據);保留 claimed 欄;寫 `refund_confirmed` event。
3. **`open → dismissed`**(resolve,確認**非**雙扣)— 寫 `resolved_at/by` + `resolution_note`(必填);寫 `dismissed` event。
4. **`refunding → open`**(reopen,**僅** TapPay 明確確認**未退款 / 未執行**)— **清空主表 `refund_claimed_at` + `refund_claimed_by` + `refund_provider_reference`**(回乾淨 open);**前次 claim + reopen 理由保存在 event 表**(寫 `refund_not_executed` + `reopened` event);**reopen 不抹除稽核歷史**(round8 二)。

### 3.2 fail-closed:退款結果不確定
🔴 **Dashboard 回應遺失 / 退款結果不確定**:**status 維持 `refunding`**、寫 `refund_uncertain` event、進人工查證;**不可 reopen、不可再 claim、不可再退款**。查明**確定未退款**才 reopen;查明**確定已退款**才 refunded。
→ 這是防「不確定就誤 reopen → 重退」的核心 fail-closed。

### 3.3 永遠禁止(RPC 須硬擋、否則 RAISE / rowcount=0)
- `refunded → open` / `refunded → refunding`(終態不可逆)
- `dismissed → 任何退款狀態`(終態不可逆)
- `open → refunded`(不可跳過 refunding;退款前必先 claim)
- 非 allowlist 的 resolution
- 覆蓋 / 修改 `refund_target_rec_trade_id`

### 3.4 不變式(invariants,實作須機械保證)
- I1:**每個狀態操作 / 退款結果同交易寫對應 event(s)**(主表變動與稽核原子綁定;漏寫 event = 漏稽核)。🔴 reopen(`refunding→open`)寫**兩筆**:`refund_not_executed` + `reopened`(canonical line 172);其餘轉移各一筆。
- I2:`refund_target_rec_trade_id` 一旦寫入(由 R1b1c genesis)即 immutable。
- I3:平行 claim 同一 anomaly **只一人成功**(CAS `WHERE status='open'`、序列化系統內退款工作)。
- I4:event 表 **append-only**(無 UPDATE/DELETE 路徑)。
- I5:`actor_session_role` / `refund_claimed_by` / `resolved_by` 一律寫 **`session_user`**(非 `current_user`,後者在 SECDEF 內會記成 function owner、稽核失真)。

---

## §4 安全與權限模型(R1b1a 表 + R1b1b RPC,canonical §3)

### 4.1 資料層(兩表)
- 兩表 `ENABLE ROW LEVEL SECURITY` + **Phase 1 zero-policy**(無 policy = 非 owner/postgres 全擋)。
- `REVOKE ALL ON TABLE` FROM **PUBLIC / anon / authenticated / service_role / payment_confirmer**。
- 🔴 **`payment_confirmer` 維持零 table / column 權限**(它在乙路只透過 charge-attempt 系列 SECDEF RPC 動 attempt;**對 anomaly 兩表完全無權**)。
- migration 含 `has_table_privilege` / `information_schema.role_table_grants` **fail-closed assert**(任一角色意外有權 → RAISE 擋 db push)。🔴 **為坐實上一行「零 column 權限」字面,assert 另含 `information_schema.role_column_grants`**(至少涵蓋 `payment_confirmer`,保守可涵蓋 5 負向角色;canonical §3 line 114 intent = payment_confirmer 零 table/column 權,本片把該 intent 機械化驗證、不超出 canonical 意圖)。
- W1 報表與退款操作走 **owner/postgres 受控流程**;**不開 service_role 直讀**。

### 4.2 RPC 層(R1b1b 兩個 owner-only RPC)
🔴 R1b1b = **兩個** owner-only RPC:`claim_double_charge_anomaly_for_refund`(claim,`open→refunding`)+ `resolve_double_charge_anomaly`(resolve,**在其內**處理 `refunding→refunded` / `open→dismissed` / `refunding→open`(reopen)/ unknown 維持 refunding 四分支)。**reopen / uncertain 是 resolve 的分支、非獨立 RPC**;`close_released_attempt` 屬 **R1c3、非本 PRD**(不列入)。兩 RPC 共用硬化規:
- `SECURITY DEFINER` + **`SET search_path='' + 全識別子 schema-qualified`**。
- **REVOKE PUBLIC / anon / authenticated / service_role / payment_confirmer**;**owner / postgres only**(Phase 1 由 Sean 受控人工流程執行;未來建正式 staff/admin 角色再獨立 migration 開權)。
- EXECUTE 權限矩陣**同時驗 `has_function_privilege` 與負向角色實呼 `permission denied`**。
- 稽核欄(`refund_claimed_by` / `resolved_by` / event `actor_session_role`)寫 **`session_user`**;文件註明此欄記 **DB session role**,非人類 staff 身分。

### 4.3 誠實邊界(canonical §7 round7 二,**不得寫成過度承諾**)
🔴 `old_attempt_id` UNIQUE **只防重複 anomaly row**;CAS **只能序列化系統內退款工作**,**無法物理阻止 Sean 在 TapPay Dashboard 手動點兩次退款**。真正防呆 = **claim CAS + runbook(先 claim 才退)+ TapPay 狀態查證 + 不確定時 fail-closed 保持 refunding + append-only 稽核**。
**本 PRD / 報表 / commit 不得宣稱「CAS 完全防止 Dashboard 重複退款」。**

---

## §5 anomaly genesis(R1b1c)

> R1b1c 同時是 charge-lifecycle 改動 + anomaly 唯一產生點;本 PRD 只規範「genesis 合約」,markCharged CAS 機制本體見 canonical §4 R1b1c。

- `mark_charge_attempt_charged` 改:`status IN ('pending','released') → charged`(same-rec 冪等;異 rec / 跨單 rec 撞 → RAISE)。
- 🔴 當 `v_row.status='released'`(= late success 對帳收斂)→ **同交易**寫主表 anomaly:
  - `INSERT … ON CONFLICT (old_attempt_id) DO NOTHING`(冪等、不重複建)、`status='open'`。
  - **所有 NOT NULL 欄須齊填**,否則 INSERT RAISE → markCharged 失敗 → **寧可不收斂也不漏記雙扣**(§7 主訊號失效是更大風險):
    | 欄 | 來源 |
    |---|---|
    | `old_attempt_id` | `v_row.id` |
    | `old_order_id` | `v_row.order_id` |
    | `user_id` | `v_row.customer_user_id` |
    | `cart_session_id` | 取自 order |
    | `rec_trade_id` / `refund_target_rec_trade_id` | 取**舊 attempt 的 rec**(refund_target 絕不指向新單) |
    | `released_at` | 取自 attempt 欄 |
    | `charged_at` | `now()` |
    | `amount` | 取 `orders.total`(整數、禁浮點) |

---

## §6 營運流程(W1)

> 🔴 **操作面向(Sean 2026-06-24 拍板)**:Phase 1 = **owner-only RPC + 固定 SQL 報表 + 人工 runbook**(過渡);退款的 claim / resolve(含 reopen 分支)一律經 §3/§4 受控 RPC。**日後一定改為後台 admin 給員工操作**——後台是上層 caller、**沿用同一批 claim/resolve RPC、不擋未來 admin UI**;⚠️ 但「記真人 staff actor」仍可能需資料層改動(獨立 migration / wrapper RPC / 稽核契約,見 §9.3)。

### 6.1 退款候選報表(只列 open)
- **主訊號** = `released→charged` 同交易寫的 `open` anomaly(R1b1c)。
- 退款候選查詢 = **只列 `status='open'`** 的 anomaly,旁佐「同 user 在 `released_at` 後 **12h 內**任何其他 paid order」(**不限金額/品項/cart_session**;相近金額/品項僅**輔助標記**、非過濾條件)。
- `refunding` **另列「處理中」**、不得再次領取;`refunded` / `dismissed` **不列入**。
- 報表欄位:old / new `display_id`、`refund_target_rec_trade_id`、金額、`released_at` / `charged_at`、**退款目標規則(退 `released→charged` 的 old attempt 那筆、絕不退新單)**、SLA、責任人。

### 6.2 7 步人工退款 runbook(過渡,§0 Q1)
1. 查 `open` anomaly(報表)。
2. owner-only CAS claim:`open → refunding`(`claim_double_charge_anomaly_for_refund`,寫 `refund_claimed_by=session_user`)。
3. **成功 claim 後**,才去 TapPay Dashboard 對 `refund_target_rec_trade_id` 退款。
4. Dashboard **明確顯示退款成功** → `resolve`:`refunding → refunded`(填 `resolution_note` + `refund_provider_reference` 退款證據)。
5. Dashboard **明確確認未退款 / 未執行** → `refunding → open`(清主表 `refund_claimed_at/by` + `refund_provider_reference`;**reopen note 寫 event 表 `refund_not_executed` + `reopened`,主表回乾淨 open 不留 note**)。
6. 🔴 **退款結果不確定 / Dashboard 回應遺失** → **維持 `refunding`、寫 `refund_uncertain` event、進人工查證、不得再 claim、不得重新退款**;查明未退才 reopen、查明已退才 refunded。
7. `dismissed` 僅用於確認**不是**雙扣。

> W1 寫 event 邊界:**每個狀態操作 / 退款結果透過受控 RPC 寫對應 event**;**查詢 open / 人工前往 Dashboard 本身不寫 event**(canonical §9 W1 驗收 + 附錄 B ㉕)。

---

## §7 誠實限制與殘餘風險(canonical §11,Sean accept,不得 Claude 自宣接受)

| 殘餘 | 處置 |
|---|---|
| 立即重刷**雙扣窗**(late success + 新單同 paid) | §0 informed-accept;**偵測必做(本子系統)+ Sean 手動退** |
| Dashboard **物理重複退款**無法被 DB 完全阻止 | 靠 claim CAS + runbook + 狀態查證 + **不確定 fail-closed 保持 refunding**(§4.3) |
| **自動退款未做** | TapPay Refund API adapter 現 stub;上線前 backlog(§1.2) |
| **正式 staff 身分未做** | Phase 1 `session_user` 記 DB session role;未來獨立 actor 模型(§4.2) |
| 真並發雙連線(anomaly claim) | 子集合模擬證 CAS 序列化;**真雙連線實證留執行 session 雙 psql**(canonical §10.11/§12.18) |

---

## §8 驗收條件 / 測試義務(每片 commit 前必滿足)

> 每片仍走完整 slice checkpoint:DDL MCP 模擬(BEGIN…ROLLBACK 零留痕)+ 三綠 + code-reviewer + **codex K2(鐵則 12 payment/雙扣/migration/RLS/GRANT 必跑)**+ 精準 add + STATUS 七欄同 commit + 不 push。

### R1b1a(資料模型)
- 兩表存在;逐欄型別 / NOT NULL / FK / `old_attempt_id` UNIQUE 正確。
- `amount integer ≥ 0`、取 `orders.total`;主表 4 態 CHECK + 四組一致性 constraints 生效。
- event_type CHECK allowlist;event 表 append-only(無 UPDATE/DELETE 路徑)。
- 兩表 RLS enabled + zero-policy;table ACL 5 角色皆無;**payment_confirmer 零 table / column 權限**;`has_table_privilege` + `role_table_grants` + `role_column_grants` fail-closed assert。
- 模擬:table ACL / RLS 矩陣(含 column-grant)+ constraints + has_table_privilege / role_table_grants / role_column_grants fail-closed。

### R1b1b(lifecycle RPC)
- claim CAS `open→refunding` 平行**只一人**成功。
- `refunded` / `dismissed` 不可逆;**refunding unknown → 保持 refunding 寫 `refund_uncertain` event(不 reopen)**。
- reopen 清主表 claimed/provider 欄但 **event 留歷史**;非法轉移否決;`refund_target` 不可改。
- 負向角色實呼 = `permission denied`;稽核欄寫 `session_user`;event 無 UPDATE/DELETE RPC。
- 模擬:CAS 平行 claim + 非法轉移 + unknown fail-closed + reopen 清主表/event 留痕 + append-only + ACL 矩陣。

### R1b1c(genesis)
- `released→charged` 成立;same-rec no-op;跨單 rec unique 保護。
- 同交易建 `open` anomaly、`amount=orders.total`、`refund_target=舊 attempt rec`;`ON CONFLICT old_attempt_id` 冪等。
- 模擬:RACE-B / B2 + anomaly 冪等。

### W1(報表 + runbook)
- 報表**只列 open**;`refunding` 另列「處理中」不可再領;退款目標 = 舊 rec 規則正確。
- 每個狀態操作 / 退款結果均透過受控 RPC 寫對應 event(查詢 open / 去 Dashboard 不寫 event)。
- 測試:單元測試 + 固定 SQL。

---

## §9 內容分級 + open decisions

### 9.1 分級(鐵則 9)
- **本子系統(anomaly 表 + 退款 lifecycle + 報表)= L3** → 必 DB-backed(本 PRD = 前置 gate)。
- 退款 runbook **操作文案** = L2(文件 hardcode + backlog)。
- markCharged / CAS 純狀態機標記 = N/A。

### 9.2 open decisions → 已拍板(Sean 2026-06-24)
- **D-A(✅ 接受建議)**:`refund_provider_reference` = **Phase 1 存自由文字字串(必填非空),格式不強制**;待 W1 runbook 實測再定。
- **D-B(🔴 改:走後台 admin)**:退款候選報表 / 退款操作呈現形態 — Sean 拍板「**日後一定走後台給員工操作**」(員工使用方便性)。**Phase 1 本批仍 = 固定 SQL + runbook(過渡)**;後台 admin = **已定緊接下階段 milestone**(§9.3)。**廢除原建議「不做 UI(period)」**;改為「Phase 1 暫不做 UI、但 UI 是已定方向、資料層前向相容」。
- **D-C(✅ 接受建議)**:`dismissed` **Phase 1 不做雙人覆核**,event 表留痕即可;未來 staff 模型再加。
- **未來**(canonical §13,非本 PRD 阻擋項):自動 close released / 自動退款 API,皆 Phase 1 不做、未來獨立 migration。

### 9.3 已定下階段方向(Sean 2026-06-24 拍板,非本批實作、記錄供銜接)
- 🔴 **後台 admin 退款操作介面**:退款的查詢 / claim / resolve / reopen **日後一定做成後台給員工操作**(考量員工使用方便性)。**緊接 Phase 1 之後的獨立 milestone**,連帶需要:**正式 staff / admin 身分 + 權限(RBAC)模型**(取代 Phase 1 的 `session_user` DB-role 稽核)、admin 前台、登入授權。
- 🔴 **前向相容範圍(誠實切分)**:**操作面 forward-compatible** = R1b1a 兩表 + R1b1b claim/resolve RPC + append-only event 表**皆 UI-agnostic**,日後後台 admin 為上層 caller、呼同一批 RPC,**Phase 1 做 SQL + runbook 不擋未來做 admin UI**。⚠️ **但「記真正 staff actor 身分」不保證資料層免改**:Phase 1 稽核欄寫 `session_user`(DB role);未來要記真人 staff,**很可能需獨立 migration 新增 `actor_staff_id` / `actor_type` 欄、wrapper RPC、或改稽核寫入契約**——本批**不預做**、屬該 milestone。canonical §3 round7 二只承諾「未來獨立 migration / actor 模型」,本 PRD 不超出此承諾。
- **不擴張本批 scope**:本決策**不**把員工模型 / admin UI 拉進 R1b1a–c / W1;若日後要在 Phase 1 內提前做 = 鐵則 8 重大改動、另提 plan。

---

## §10 字面 vs 事實揭示(鐵則 11)

- 本 PRD **不新增 canonical 以外的設計**;所有 schema / 狀態機 / ACL / runbook 逐項可回溯 canonical 節次(§11 對應表)。
- **已拍板的呈現/格式細節**:§9.2 D-A/D-B/D-C 是 canonical 未逐字釘死的呈現/格式細節,**Sean 2026-06-24 已拍板**(D-A 自由文字必填非空 / D-B 退款操作日後走後台 admin、Phase 1 SQL+runbook / D-C Phase 1 不做雙人覆核);**非 open、非待澄清**,皆不偏離 canonical 核心契約。
- **不偏離項(canonical 硬契約,本 PRD 原樣承接)**:兩表逐欄型別 / 4 態 + 一致性 constraints / append-only event / 兩表 RLS zero-policy + 5 角色 REVOKE / payment_confirmer 零表權 / owner-only RPC + session_user / unknown fail-closed 保持 refunding / reopen 不抹稽核 / refund_target immutable / genesis NOT NULL 齊填 / 報表只列 open / 退舊 rec 不退新單 / CAS 不防 Dashboard 重複退(誠實)。

---

## §11 canonical 對應表(可回溯、供 prd_review 核)

| 本 PRD 段 | canonical 節次 |
|---|---|
| §0 背景 / 為何 L3 | §2.1/§2.4/§2.6 + §9 line 286/290 + 附錄 A |
| §2 資料模型(兩表) | §4 R1b1a(line 156–164) |
| §3 生命週期狀態機 | §4 R1b1b(line 166–175) + §7 |
| §4 安全 / 權限 | §3(line 114–122) + §4 R1b1a line 163 + §10.8 |
| §5 genesis | §4 R1b1c(line 177–178) + §2.6 |
| §6 W1 報表 / runbook | §7(line 256–269) + §9 W1 列 |
| §7 殘餘風險 | §11 + §10.11 |
| §8 驗收 / 測試 | §9 slice 表 R1b1a/b/c + W1 + §12.7–12.12 |
| §9 分級 / open | §9 line 286/290 + §13 |

---

## §12 變更紀錄
- **v0.3(2026-06-24)** — 折入 codex K1 round2 findings(round1 #1/#3/#4/#5 已確認妥):① must-fix §6 補完 fix#2 漏掃處(「資料層不變」→ 操作面沿用同批 RPC、不擋 admin UI;記真人 staff actor 仍可能改資料層)② should-fix §3.4 I1 改「對應 event(s)、reopen 寫 refund_not_executed + reopened 兩筆」③ nit §1.1 表「claim/resolve owner-only RPC(resolve 內含 reopen/unknown)」。🔴 **round2 = FAIL(硬上限 2 輪)**;3 項全機械殘留已補。🟢 **round3(Sean 授權突破 2 輪上限、codex quota 重置後重試)= PASS、0 must-fix、findings 無**——確認 round2 三修妥、schema/constraints/RLS/ACL/RPC/session_user/genesis/W1 對齊 canonical、無復活附錄 B 廢案、L3 gate 涵蓋 R1b1a/b/c/W1 → **`prd_review` 通過、可進 §14 步 13 R1b1a gate**。
- **v0.2(2026-06-24)** — 折入 codex K1 round1(FAIL→修)findings:① must-fix §4.2 R1b1b 改寫為**兩個** RPC(claim + resolve;reopen/uncertain 是 resolve 分支、close 屬 R1c3 不列入)② must-fix §1.2/§9.3 前向相容**降級**(操作面 UI-agnostic、但「記真人 staff actor」不保證資料層免改)③ should-fix §10 改為 D-A/B/C **已拍板非待澄清**(消 §9.2↔§10 矛盾)④ should-fix §4.1/§8 補 `role_column_grants` assert 坐實「零 column 權」⑤ nit §1.3/§2.2 append-only 限定「application/RPC 路徑、owner 物理仍可改」。待 codex K1 round2 複審。
- **v0.1(2026-06-24)** — 折入 Sean open-decision 拍板:D-A ✅ 自由文字必填非空 / D-C ✅ Phase 1 不做雙人覆核;**D-B 🔴 改 = 退款操作日後走後台給員工用**(新增 §9.3 已定下階段方向 + §1.2 / §6 前向相容註記)。sequencing = Phase 1 維持 owner-only RPC + SQL + runbook,後台 admin + 員工模型 = 緊接獨立 milestone(非本批、資料層 UI-agnostic 前向相容)。仍待 `prd_review`(codex K1)。
- **v0(2026-06-24)** — 初版草稿。canonical v9(Codex round11 PASS)R1b anomaly/refund 設計收斂成 dedicated PRD;待 `prd_review`。未授權實作、未 commit、未 push。

— END —
