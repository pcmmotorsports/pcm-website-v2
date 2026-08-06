# A9h-M — A5a 加 preserve 模式(migration 片)plan v1

> **狀態:草案,等關卡1(codex `gpt-5.5`)+ 主視窗核 §2 選型。零行 SQL。**
> 依 `E-125-A` ②(主視窗裁 A:A9h 三片拆開)。上游拍板 = Sean `E-124-A:3`(Q4=A)。
> **片型 = 高風險片**(鐵則 12②③)⇒ codex 關卡2 不降級、**apply = Sean 手動停點**。
> 事實親查於 `pcm-refund-wire` @ `aeb4e90`;引用一律附 `檔案:行號`。
>
> 🔴 **本片刻意很小。** A9h 的前一版 plan(v1-v3)想在一份文件裡同時定死 migration、
> 應用層編排、與一個還不存在的片的消費契約 ⇒ 兩輪關卡1 共 23 條 must-fix、0 行 code。
> 主視窗裁定拆片。**本檔只寫 migration,不寫編排、不寫 UI、不猜任何需要量測的數字。**

---

## §1 為什麼要這支 migration(一句話)

A5a 的 UPDATE 分支**無條件**用參數覆寫四個選填欄
(`20260803160000:354-360`:`submitted_at` / `supplier_order_no` / `exception_reason` /
`expected_arrival_date`,零 COALESCE、零 preserve 分支)。

⇒ A9h 批次只填「每列訂多少」時,那四欄會被送 `null` ⇒ **把員工在明細頁填好的供應商單號、
預計到貨日清掉**。動線很正常:先在明細頁記,之後那張單被批次掃到。

關卡1 R1 裁定逐字:**「警告不能把資料損失變可接受」** ⇒ 必須在 DB 層解決。

**CREATE 分支不受影響**(`:383-391`):新列沒有舊值可保留,插 `null` 本來就對。

---

## §2 選型:加一個 preserve 參數,**不做**窄版 patch RPC

```
p_preserve_optional_fields boolean DEFAULT false
```

`true` ⇒ UPDATE 分支那四欄保留現值;`false`(預設)⇒ **現行行為逐字不變**。

### 2.1 為什麼不做窄版 patch RPC(決定性)

窄版 RPC 必須**複製 A5a 的全部守門**:A2b1 的 `P2B01` catch 與 constraint 名比對
(`:392-399`)、`unique_violation` 併發首建重試圈、17 碼完整分流、同交易 audit(`:424-452`)、
隔離閘 `P2B02`、`FOR NO KEY UPDATE` 鎖序。

⇒ 兩份守門**必然漂移**,而「批次路徑少了一道單列路徑有的守門」正是本 repo 反覆踩的坑
(memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`)。**一支 RPC 一個守門面。**

### 2.2 為什麼這答得了「單純 COALESCE 會讓合法清空失效」

關卡1 R1 逐字提醒過這條。**同意,所以不用 COALESCE。**

- `COALESCE` = **永遠**不能清空(null 一律被當「不提供」)
- **顯式旗標** = 只在呼叫端**明說自己沒有那四欄**時才保留

⇒ 明細頁單列表單(有那四欄)照舊送 `false`,**員工想清空某欄照樣清得掉、能力零損失**。
「不提供」與「明確清空」由**呼叫端的意圖**區分,不是由值區分。
**這是 Sean 拍 A 時的硬約束(`E-124-A:3`「真想清空某欄要做得到」),§6 驗收 4/5 逐條釘它。**

---

## §3 migration 要做的六件事(逐項可驗)

| # | 內容 | 為什麼(證據) |
|---|---|---|
| **M1** | UPDATE 分支(`:354-360`)四欄改為:`preserve=true` 時取 `v_before.<欄>`、否則取參數 | 本片病灶本體 |
| **M2** | 🔴 **`NO_CHANGE` 的比較基準跟著改** —— preserve 時那四欄**不參與**「有沒有變」的比較 | 否則「保留了舊值卻因為比到 null 而回 `UPDATED`」= 假寫入紀錄 + `status_changed_at` 被無謂推進 |
| **M3** | 🔴 **稽核 `after` 改記「實際寫入值」而非參數** | 親驗 `:439-448`:`after` 是用 `p_submitted_at`/`v_order_no`/`v_reason`/`p_expected_arrival_date` **組參數**;preserve 後資料列保留舊值、稽核卻記 `null` ⇒ **兩者矛盾**(關卡1 R2 抓到,我親驗成立) |
| **M4** | **DROP 舊 11 參簽章** + 斷言 `proname='admin_upsert_item_procurement'` 的 `COUNT(*)=1` | 加參數 = 新簽章;兩個 overload 並存會讓 PostgREST 歧義。repo 前例:A8a1/A8a2「5 參已 DROP、恰 1 個 overload」 |
| **M5** | 🔴 **新簽章 ACL 重建**:先 `REVOKE ALL FROM PUBLIC, anon, authenticated`,再 `GRANT EXECUTE TO service_role`,並 fail-closed 斷言 | DROP 會一併帶走舊 ACL(該 migration `:809-814` **自己就寫了這件事**);且 SECURITY DEFINER 函式**預設 PUBLIC 可執行** ⇒ 只寫 GRANT 不寫 REVOKE 會開後門(關卡1 R2 抓到)。memory `reference_supabase-service-role-execute-default-grant` |
| **M6** | **終態屬性斷言**(不只數量):`pronargs=12` / `pronargdefaults=1` / DEFAULT 精確為 `false` / SECURITY DEFINER / `search_path` 釘死 / owner / COMMENT 存在 | 關卡1 R2:只斷言 `COUNT(*)=1` 擋不住「數量對但形狀錯」(例如 DEFAULT 被寫成 `true` ⇒ **所有單列呼叫靜默變成保留模式**) |

### 3.1 🔴 `DEFAULT false` 是承重的,不是風格

若 DEFAULT 寫成 `true`,**明細頁的單列表單會靜默失去清空能力** —— 而且沒有任何測試會紅
(表單照樣送出、RPC 照樣回 `UPDATED`、只是那四欄再也清不掉)。⇒ M6 必須逐字斷言它。

---

## §4 R2 十二條 must-fix 的認領(依 `E-125-A:10`,三分類、不丟失、不假折)

| R2 # | 摘要 | 歸屬 |
|---|---|---|
| 1 | 稽核 `after` 記參數而非實際寫入值 | ✅ **本片 M3** |
| 2 | 只寫 GRANT 未寫 REVOKE PUBLIC/anon/authenticated | ✅ **本片 M5** |
| 3 | `COUNT(*)=1` 不夠,要釘 pronargs/pronargdefaults/DEFAULT/SECDEF/search_path/owner/COMMENT/schema-cache | ✅ **本片 M4+M6**(schema-cache reload 與 PostgREST smoke 進 §6 驗收 7) |
| 4 | 跨訂單批次 vs 單一頂層 `orderId` 矛盾 | ➡️ **A9h-2**(簽章題,本片無簽章) |
| 5 | `ok: true\|false\|'unknown'` 判別式不好用 | ➡️ **A9h-2** |
| 6 | 未驗共同欄、數量放行 0 與極大值、無 batch-level 回傳型別 | ➡️ **A9h-2** |
| 7 | 「業務失敗」集合未定義(三碼已是 caller bug 型) | ➡️ **A9h-2**(A9h-1 已在 `procurement-result.ts:33` 留下正確行號指標 `:96-99`) |
| 8 | 歸屬查詢失敗(RPC 前)vs transport 失敗(RPC 後)混為一談 | ➡️ **A9h-2** |
| 9 | 無批次上限數字 / per-row timeout / 總 deadline;`maxDuration` 要落在 page 不是 action 模組 | ➡️ **A9h-2**(需實測,plan 階段寫的都是猜的 —— 這正是拆片的理由) |
| 10 | A12b read-back 只留散文,未進母 plan row 64 / A12b 驗收 / DAG 硬前置 | ➡️ **A9h-2 + 母 plan 連動**(A9h-2 收工時同批改母 plan row 64) |
| 11 | 「測試矩陣不變」與「新增 unknown/null 案例」互斥 | ✅ **已自然消失** —— A9h-1(`272b26b`)實際驗收改用 byte-identity 三條,沒有那個矛盾 |
| 12 | action diff 只准加 import+刪函式,但還要移除未使用型別 import | ✅ **已自然消失** —— A9h-1 實作時就移除了,commit body 已具名交代 |
| nit | 重複列理由與整批拒收自相矛盾 | ➡️ **A9h-2** |
| nit | §0 說兩片 §5 說三片 | ✅ **已消失**(現行為三片,plan 已重寫) |

⇒ **本片吃 3 條、A9h-2 吃 7 條、自然消失 3 條。零丟失。**

---

## §5 施工紀律

- **交易模擬**:`BEGIN → 套用 → 驗 → ROLLBACK`,零留痕檢查(memory `reference_supabase-rls-schema-test-txn-simulation`)。
- 🔴 **不 `db push`、不 apply** —— commit 押本分支等收割;**apply = Sean 手動停點**,時機由主視窗排。
- 🔴 **與 B 線 S2b 是兩條線各自的批、絕不混批**(`E-124-A:10`)。
- **關卡1 用 `gpt-5.5`** —— `gpt-5.6-sol` 已隨換帳號失效(實測 400),詳見
  `docs/reviews/2026-08-06-e10-a9h-k1-codex.md` 檔頭註記。
- 🔴 **回報三綠一律帶 `--force` 或貼 `Cached: 0`** —— 多 worktree 環境下 turbo 會跨樹重播快取,
  不帶等於恆真宣稱(A9h-1 的 code-reviewer 實錘)。

---

## §6 驗收條件(逐條 yes/no)

1. `preserve=true` 更新一列 ⇒ 四欄**原值保留**。
2. `preserve=false`(或不帶)同樣輸入 ⇒ 四欄**被寫成 null** —— **證明旗標真的在做事、不是恆真**。
3. 🔴 **清空能力未受損**:單列表單送空值 + `preserve=false` ⇒ 該欄**真的變 null**
   (Sean 硬約束「真想清空某欄要做得到」的直接驗收)。
4. 🔴 **`NO_CHANGE` 正確**:preserve=true 且只有那四欄「不同」(因為沒送)⇒ 回 `NO_CHANGE`,
   **不得**回 `UPDATED`;且 `status_changed_at` 未被推進。
5. 🔴 **稽核一致**:preserve=true 時 `admin_audit_log.after` 的四欄 = **實際保留值**,不是 `null`。
6. `proname` 的 `COUNT(*)=1`;`pronargs=12`;`pronargdefaults=1`;**DEFAULT 精確為 `false`**;
   SECURITY DEFINER;`search_path` 釘死;owner 正確;COMMENT 存在。
7. ACL 終態:`PUBLIC`/`anon`/`authenticated` **零 EXECUTE**;`service_role` EXECUTE=true;
   PostgREST schema cache reload 後具名參數呼叫 smoke 通過。
8. 既有 17 碼行為在 `preserve=false` 下**逐碼不變**(現有單列測試全綠且未修改)。
9. 交易模擬零留痕。
10. codex 關卡1 PASS(`gpt-5.5`)+ 關卡2 不降級。

---

## §7 假設清單(不確認不准施工)

| # | 假設 | 怎麼驗 |
|---|---|---|
| A1 | preserve 只需動 UPDATE 分支 | ✅ 已驗:`:383-391` CREATE 分支是新列、無舊值可保留 |
| A2 | `v_before` 在 UPDATE 分支確實已載入那四欄 | 開 `:330-360` 確認 `v_before` 的 SELECT 欄位清單涵蓋四欄(**施工前第一件事**) |
| A3 | DROP 舊簽章後無其他呼叫端 | grep 全 migration 樹 + `pg_proc` 實查 + TS 端只有 `procurement-repository.ts:124` 一處 |
| A4 | 加 DEFAULT 參數後,舊 TS 呼叫端不帶該參數仍走對分支 | supabase-js `rpc()` 具名參數;PostgREST smoke(驗收 7)實打 |

---

**未經關卡1 PASS + 主視窗核 §2,不得寫任何 SQL。**

— E 窗(九碼退場窗),2026-08-06
