# 可直接貼進 `#497` 的段落（E 窗查證結論）

> **來源**：E 窗（安全稽核）2026-08-16　**依據 commit**：`b3fe104c`（分支 `customers`，當時未推）
> **完整論證**：`docs/security/2026-08-16-security-audit-run1-phase2-hunt.md` §6.8 / §6.9
> **搬運者不是判斷者**：本段由 E 窗查證撰寫；貼上此單的窗只負責搬運。

---

**經查不是不一致；統一它們會製造 bug。要補的是註解與值域斷言，不是統一。**

`#497` 指的兩套 `SUM` 是：

| | 它回答的問題 | 統計的集合 |
|---|---|---|
| `pcm_order_refundable_remaining` | 「**這張單還能再退多少？**」 | `processing` + `confirmed` |
| `admin_finalize_order_refund` 步 7 | 「**這張單真的退掉了嗎？**」 | 只有 `confirmed` |

**兩邊都是保守方向，而且方向不同是必要的：**

- 額度**必須**算進 `processing`（在途的先佔住），否則**在途期間可以把同一筆錢再退一次**。
- `payment_status` **必須不**算進 `processing`，否則**一筆最後失敗的退款會把單子錯標成已退清**。

⇒ **把它們統一成同一個集合，兩個方向各壞一邊：**

```
額度改成只算 confirmed          ⇒ 在途期間可重複退（賠錢）
payment_status 改成含 processing ⇒ 退款失敗後單子錯標已退清（帳目錯）
```

## 🔴 真正該補的：同一個 fail-open 出現在**兩處**，只有一處有警告

`pcm_order_refundable_remaining` 的 `COMMENT` 逐字寫著：

> 「**未來新增任何 status 值預設不佔額度 —— 新增狀態時必須回訪本函式。**」

**而 `admin_finalize_order_refund` 步 7 的 `status = 'confirmed'` 是裸字面，零註解。**

新增一個退款狀態（例如 `confirmed_manual`）之後：

| | 後果 | 有警告嗎 |
|---|---|---|
| 額度那套 | 新值不佔額度 ⇒ **可以多退** | 有，**但在函式 COMMENT 裡** |
| 步 7 那套 | 新值不算進 `v_sum` ⇒ **單子永遠標不到 `refunded`** | **零** |

**兩處都會靜默出錯，其中一處連提醒都沒有。**

## 建議的修法（機制，不是「記得回訪」）

隨每次 `db push` 跑一道斷言：**釘住 `order_refunds.status` 的值域集合，新增任何值當場紅**。
完整規格見 `…-phase2-hunt.md` §6.9，其中兩點是重點：

1. **值域取自 `CHECK` 約束，不是取自資料** —— 取資料的話，**表是空的就恆綠**。
2. 🔴 **錯誤訊息本身就是回訪清單**（標記為**不可簡化**）—— 必須逐字指名上面那兩處
   以及各自會怎麼壞。縮成 `RAISE EXCEPTION 'unknown status'` **等於退回原病**。

⚠️ 斷言裡 `c_known` 的實際值域，**E 窗沒有逐字核對**（只讀到約束名 `order_refunds_status_check`
存在，以及程式碼用到的四個值）⇒ **實作者要先 `pg_get_constraintdef` 讀出真值再填。**
