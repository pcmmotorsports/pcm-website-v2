# 退款資料層換路提案(A7c)

> **狀態:** 提案 / 2026-08-01
> **拍板依據:** Sean 2026-08-01 `Q1=A 換路` / `Q2=A 先審方向再動手`
> **取代:** `docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md` 的 A7b-T 部分(A7b-M 已 apply、保留)
> **本檔是被審對象。凍結後不得修改;審查 findings 折入時另開 v2。**

---

## §1 為什麼要換(可驗證的診斷,不是感覺)

### 1.1 病灶:同一筆錢在兩張表各存一份

`order_refunds`(帳本,`20260725130100`,07-25 已 apply)與
`order_refund_jobs`(工單,`20260731120000`,07-31 已 apply)**重複持有 11 個同義欄位**:

```
bank_refund_id, tappay_refund_id, items_amount, shipping_fee_before,
shipping_fee_after, shipping_delta, refund_amount, reason, actor,
request_id, failed_reason
```

(第 12 個同名欄 `status` 兩邊定義域不同 —— 帳本 `processing|confirmed|failed`、
工單 `queued|...` —— 是同名不同義,不算重複。)

抽取方式 = 兩支 `CREATE TABLE` 的欄位集合取交集,腳本見 §7.1,可重跑。

**交叉佐證:** A7b-T 的 T3b 錢面負測裡那組「job↔ledger **十一欄**逐欄比對 + NULL-safe 雙向」,
測的正是這 11 欄。**測試的欄數與重複的欄數相同,不是巧合 —— 那組負測存在的唯一理由
就是這兩份副本可能不一致。**

### 1.2 後果:105 道守門裡 66% 在守一台狀態機

`20260731120100`(A7b-T,**未 apply**)的 105 道具名守門分類(抽取式見 §7.1):

| 類別 | 數量 | 說明 |
|---|---:|---|
| `a7bt_e*` 狀態機轉移規則 | **69 (66%)** | 「這個狀態能不能變成那個狀態」「這條 edge 准許改哪幾欄」 |
| 錢/量不變式 | 13 | C1-C8、D9 那一族 |
| 擋刪除/清空 | 5 | |
| 其他結構性 | 18 | |

69 道轉移規則之所以必要,是因為**錢的欄位坐在一列會被 UPDATE 的資料上**。
一列資料只要會變,就得回答「從什麼變成什麼合法、准許動哪幾欄」。

### 1.3 外部佐證(四路調研,2026-08-01)

- **金流閘道**(Stripe / Adyen / PayPal / TapPay):Refund 物件**沒有品項欄、沒有運費欄**。
  「退款總額 ≤ 收款額」由**閘道 API 層**擋。並行退款靠冪等鍵;Braintree 官方建議
  逐字是「兩次部分退款之間等 5-10 秒」。TapPay 無冪等機制文件。
- **電商平台**(Shopify / Medusa / Saleor / WooCommerce / Magento):
  **五家皆未將退款不變式放在 DB trigger**;一律「帳本/事件累加當真相 + 狀態欄只是顯示」。
  Saleor 的 `refundedAmount` 是把 `REFUND_SUCCESS` 事件加總算出來的。
  **Shopify 在 Admin API 2024-10 把「退運費」拆成獨立資源 `refundShippingLines`**
  —— 他們也踩過運費坑,解法是給運費自己一條帳。
- **台灣**(gemini,部分回答後 503):ECPay / NewebPay **未請款前只能全額取消**;
  **分期付款與紅利折抵只能全額退**(⚠️ 這條 PCM 從未考慮過,見 §6 未決事項)。
- ⚠️ **codex 那一路未交出結論**(跑完 9 分鐘、印出完成勾選但最終答案未寫入輸出檔)。
  本節結論**建立在其餘三路 + 我自己親讀的一手文件**(Stripe Refund object、
  Shopify 2024-10 changelog);codex 未確認。

---

## §2 新模型

### 2.1 一句話

**錢寫進帳本就不准改;工單只管「TapPay 那通 API 打了沒」,一毛錢都不碰。**

### 2.2 `order_refunds` = 唯一的錢真相(表已存在,不重建)

保持「一列 = 一筆退款」。新增一支 `BEFORE UPDATE` trigger:

- **不可變欄(11 個錢欄 + `order_id` + `created_at`):任何 UPDATE 一律拒絕**
- **可變欄只有四個**:`status`(`processing → confirmed|failed`,單向)、
  `tappay_refund_id`(NULL → 非 NULL,一次)、`confirmed_at`、`failed_reason`

> ⚠️ **這是刻意的「不夠純」版本。** 教科書式 append-only 會連 `status` 都不改、
> 改成再寫一列 confirmation entry。我選可變四欄,因為 TapPay 的實際流程是
> 「一通 API 呼叫 → 一個結果」,再寫一列會讓「這筆退款到底成不成」需要跨列聚合才知道,
> 而那正是我們要避免的複雜度。**代價:仍需要一支 trigger 守那四欄的轉移。**
> 這是本提案最該被打的地方,審查者請優先攻擊。

### 2.3 `order_refund_jobs` = 純工單(表已存在,DROP 欄位)

正式站 0 列 ⇒ `ALTER TABLE ... DROP COLUMN` 零成本、零回填。

**DROP 掉的(14 欄)**:上述 11 個重複錢欄 + `refunded_before` + `refunded_target` + `rec_trade_id`
(`rec_trade_id` 從 `orders.tappay_rec_trade_id` 讀,不再抄一份)

**`refund_id` 改 `NOT NULL`** ⇒ **先寫帳、再排工單**。錢的決定只做一次、只做在帳本上。

**保留的**:`cancellation_id`, `generation`, `payload_hash`, `status`, `claim_token`,
`claimed_at`, `claim_expires_at`, `refund_call_attempted_at`, `last_refund_call_at`,
`retry_count`, `next_retry_at`, `next_check_at`, `check_fail_count`, `manual_review_required`,
`reviewed_at`, `reviewed_by`, `resolution`, `dead_reason`, `retry_auth_recorded_refunded`,
`retry_auth_checked_at`, `corrected_at`, `corrected_by`, `correction_reason`, `updated_at`

### 2.4 錢的不變式:三條,全部只在 INSERT 時檢查

因為錢欄不可變,**檢查只需要做一次**(帳本 INSERT 當下),不需要 16 條 edge 各檢查一遍。

```
M1  訂單層:  Σ refund_amount  (status <> 'failed')  ≤  orders.total
M2  品項層:  Σ order_refund_items.quantity  per order_item  ≤  order_items.quantity
M3  運費層:  Σ (-shipping_delta)  (status <> 'failed')  ≤  orders.shipping_fee
```

三條都是「同一張訂單跨所有退款列累加 ≤ 上界」,同一個形狀。
實作:一支 `AFTER INSERT` DEFERRED constraint trigger,先 `SELECT ... FOR UPDATE` 鎖 `orders` 那列再算。

⚠️ **`status <> 'failed'` 讓 M1/M3 讀到一個可變欄** —— 一筆 `processing` 事後轉 `failed`
會讓額度「還回來」。這是對的(那筆錢沒退成),但它意味著 M1/M3 **不是純 INSERT-time 檢查**,
`processing → failed` 那一步不需要重檢(額度只會變鬆),`→ confirmed` 也不需要(額度不變)。
**請審查者驗證這個推論。**

### 2.5 保留的營運規則(與錢面副本無關,不因換路消失)

- `bank_refund_id UNIQUE`(冪等鍵)
- D9 隔日閘:**部分退款隔日 / 全額退款當日**(Sean 07-31 拍板,比 TapPay 實測保守是刻意的)
- claim / lease 租約、retry backoff、`manual_review_required` 人工介入
- 工單狀態機**仍然存在**(TapPay 會回「不確定」),但它寫錯的代價是「重打一次 API」,
  不是「多退一次錢」

---

## §3 消失了什麼(這是換路的全部收益)

| 原本 | 換路後 |
|---|---|
| C1-C4 主從一致(退款明細 vs `order_items`) | 移到帳本 INSERT 的 M2,一條 |
| C5-C6(退款明細 vs 取消明細) | **保留**,但移到帳本 INSERT 側 |
| C7(跨取消單累計件數) | = M2 |
| C8(跨取消單累計運費) | = M3 |
| job↔ledger 十一欄逐欄比對 + NULL-safe 雙向 | **整組消失**(沒有副本了) |
| 跨表 `bank_refund_id` 一致 | **消失**(同一列) |
| 16 條 edge 的 allowed-delta 白名單中的錢欄部分 | **消失**(錢欄不在工單上) |
| 69 條 `a7bt_e*` 轉移規則 | 大幅縮減 —— **但仍有工單狀態機,不會歸零** |

**估計剩 25-35 道具名守門。⚠️ 這是估計,不是量測** —— 我沒有把新 migration 寫出來跑過。
唯一量到的事實是「69 道是狀態機規則」與「不可變的欄位不需要轉移規則」。

---

## §4 遷移成本

**資料**:零。四張表(`order_refunds` / `order_refund_items` / `order_refund_jobs` /
`order_refund_job_items`)與 `order_cancellations` 在正式站**全部 0 列**
(2026-08-01 親查,見 §7.2);`orders` 31 列不受影響。

**要丟掉的**:A7b-T 那條線 7,297 行 —— migration 2,062 + 五支 harness 4,800 + rollback 435。
**未 apply、未 push** ⇒ 丟掉不需要回滾任何東西,`git revert` 都不用(那 5 個 commit 留著當紀錄)。

**要新寫的**:
1. 一支 migration `A7c`(改 `order_refunds` 加不可變 trigger、`order_refund_jobs` DROP 14 欄
   + `refund_id NOT NULL`、三條錢不變式 trigger、工單狀態機 trigger)
2. harness:正向鏈 / 狀態負測 / 錢面負測 / 突變 / ACL+rollback(沿用現有五支的**形狀**,
   內容重寫 —— `a7bt-fixtures.sh` 的 provision 與 `count_gate` 機制可直接搬)

**估時**:2-3 天。⚠️ 這是估計。已知會偏低的理由:A7b-T 的估時也偏低過。

---

## §5 明文做不到 / 換路解決不了的

1. **TapPay 回應不確定** —— 打了 API 但沒收到回應,錢到底動了沒。這需要工單狀態機 +
   Record API 對帳,帳本化一點都不會讓它變簡單。
2. **並行退款** —— 兩個員工同時對同一張訂單按退款。帳本化把它從「16 條 edge 各自要正確」
   縮成「M1/M3 的鎖要正確」,但**沒有消滅它**。
3. **TapPay 側的真相** —— 我們的帳本只是我們這邊的紀錄。TapPay 說退了、我們沒記到,
   或反過來,只能靠 Record API 對帳。D9c/D9d 那組共模失效仍然測不到。
4. **`status <> 'failed'` 的競態** —— 見 §2.4 的警告。
5. **分期付款/紅利折抵只能全額退** —— gemini 查到 ECPay/NewebPay 有此限制,
   **TapPay 是否同樣受限、PCM 是否開放分期,兩者都未確認**。見 §6。

---

## §6 需要 Sean 拍板的岔路(夜跑前必須清空)

見交接檔 `docs/handoff/2026-08-01-a7c-redesign-handoff.md` §2。
**本提案不預設任何一題的答案。**

---

## §7 本檔數字的來源(可重跑)

### 7.1 欄位與守門的抽取式

```bash
# 重複欄位
python3 - <<'PY'
import re
def cols(path, table):
    s = open(path, encoding='utf-8').read()
    body = re.search(r'CREATE TABLE public\.%s \((.*?)\n\);' % table, s, re.S).group(1)
    return [m.group(1) for m in
            (re.match(r'^([a-z_]+)\s+(uuid|text|integer|boolean|timestamptz)\b',
                      l.split('--')[0].strip()) for l in body.split('\n')) if m]
led = cols('supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql','order_refunds')
job = cols('supabase/migrations/20260731120000_m4b_e10_a7b_m_refund_jobs.sql','order_refund_jobs')
print([c for c in led if c in job and c not in ('id','order_id','created_at')])
PY

# 105 道具名守門與分類(與 a7bt-negative-state.sh:1822 同一份口徑)
F=supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql
{ sed -n "s/.*CONSTRAINT = '\(a7bt_[a-z0-9_]*\)'.*/\1/p" $F
  grep -oE "pcm_a7bt_block_(write|truncate)\('a7bt_[a-z0-9_]*'\)" $F \
    | sed -E "s/.*'(a7bt_[a-z0-9_]*)'.*/\1/"
} | grep -v '^a7bt_selftest_marker$' | sort -u > /tmp/ids.txt
wc -l < /tmp/ids.txt                      # 105
grep -cE "^a7bt_e[0-9]" /tmp/ids.txt      # 69
```

### 7.2 正式站列數(2026-08-01 親查,Supabase MCP 唯讀)

```
order_refunds 0 / order_refund_items 0 / order_refund_jobs 0
order_refund_job_items 0 / order_cancellations 0 / orders 31
```

— END —
