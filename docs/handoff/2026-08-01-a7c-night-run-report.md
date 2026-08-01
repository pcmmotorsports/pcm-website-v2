# A7c 退款帳本 — 進度報告(2026-08-01)

> 交接檔:`docs/handoff/2026-08-01-a7c-night-run-handoff.md`
> **正式站零改動、未 apply、未 push、未 commit。**

---

## 白話三句話

1. **A7c 已照你早上的拍板 Q1=A 改成「記金額」了**,而且測完全綠:43 項通過 / 0 失敗,
   **14 道守門逐道用突變證明「拿掉就真的會出事」,0 條是裝飾**。
2. **改形狀順手解掉三個問題**:自由金額寫得進去了(退 300 實測可登記)、
   折扣訂單不再多算(實測:實收 7237,舊形狀會算成 7448、多 211)、
   「在帳本裡虛構運費」那條路**物理上消失**(那四個欄位已經不存在)。
3. **跑了四輪審查,全部收斂**(R1 FAIL 11 → R2 NO-GO 16 → R3 FAIL 3 → R4 NO-GO 3)。
   findings 彼此**零重疊**,其中五條是我自己的測試在騙自己。

---

## 你拍的板,我怎麼落地的

| 題 | 你的答案 | 我做了什麼 |
|---|---|---|
| Q1 | **A:改表記金額,摺進同一支 migration** | 砍掉兩條把金額綁死在品項上的 CHECK、兩支主從一致性 trigger、四個沒有語意的欄位;`order_refund_items` 改為**凍結**(不再有任何寫入端)。全部在同一支 A7c 裡,沒有另開檔 |
| Q2 | **A:已結案填錯先不做更正出口** | 沒做更正機制、也沒讓 confirmed 可轉 failed(後者會接上 Q3 那條重複退款路徑)。限制已寫進 migration 註解 |
| Q3 | **A:轉 failed 前的對帳只寫成營運鐵律** | 寫進顯示函式註解 + 表 COMMENT + 「禁止 DELETE」的錯誤訊息裡。**沒有**做成 DB 守門(那會與拍板⑤ 衝突) |

---

## 🔴 這一條請記著:唯一會真的退兩次錢的路

拍板⑤ 說「防超退交給 TapPay」。**但 TapPay 只擋「累計超過原始刷卡金額」。**

```
退款其實已經執行 → 但沒拿到 / 沒記到對帳碼
→ 操作者把那筆轉成 failed(這是我們自己文件寫的更正路徑)
→ 系統算出的「剩餘可退額」回升
→ 照著那個數字再退一次
→ 兩次部分退款的累計仍在原刷卡金額之內 ⇒ TapPay 不會攔
```

⇒ **營運鐵律:轉 failed 之前必須先用 TapPay Record API 對帳。**
你選 A = 暫不做成後台強制流程;等做退款按鈕那片時可以再決定要不要升級成 B。

---

## 產物(3 個檔,皆未 commit)

| 檔 | 行數 | 說明 |
|---|---|---|
| `supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql` | 712 | A7c 本體(未 apply) |
| `scripts/a7c-verify.sh` | 566 | 驗收 harness(負測 + 正向鏈 + 突變 + 重放) |
| `docs/handoff/2026-08-01-a7c-night-run-report.md` | 本檔 | 這份報告 |

> 鐵則 6 的行數上限約束的是**元件檔 / Hook 檔**,不是 migration
> (對照:既有 `20260725130100` = 503 行、`20260731120000` = 924 行)⇒ 未違反。

---

## 帳本現在長什麼樣

**一次退款登記一列,金額就是一個欄位 `refund_amount`。** 沒有品項、沒有運費欄、沒有等式。

### 14 道守門(全部經突變證明承重、0 死規則)

| 守門 | 擋什麼 |
|---|---|
| `a7c_insert_status_must_be_processing` | 憑空 INSERT 一列「已結案且沒有對帳碼」的退款 |
| `a7c_insert_order_payment_not_captured` | 訂單不在白名單 `{paid, partiallyRefunded, refunded}`,或訂單不存在 |
| `a7c_insert_order_has_no_rec_trade_id` | 沒有 TapPay 交易的訂單(匯款單) |
| `a7c_insert_rec_trade_id_mismatch` | **送錯交易識別碼**(關錢:送錯 TapPay 會退到別人的錢) |
| `a7c_insert_settlement_fields_must_be_empty` | 建立時就預塞假對帳碼 |
| `a7c_update_money_columns_immutable` | 事後改金額 |
| `a7c_update_identity_columns_immutable` | 事後改冪等鍵 / 改掛別張單 / 改時間 / 改「誰按的」 |
| `a7c_update_settlement_fields_write_once` | 結案後改掉或抹除對帳碼 |
| `a7c_confirm_requires_tappay_refund_id` | **結案卻不回填對帳碼** |
| `a7c_processing_must_not_have_tappay_refund_id` | 結案前偷填對帳碼 |
| `a7c_ledger_delete_forbidden` | 刪帳本(兩張表都擋) |
| `a7c_refund_items_frozen` | 往已凍結的品項明細表寫東西 |
| `rec_trade_id NOT NULL` | 用 NULL 繞過交易碼綁定 |
| `refund_amount > 0`(既有,非本片新增) | **0 元與負數退款** —— 🔴 改形狀砍掉金額周圍所有等式後,它是唯一擋這個的東西,而負數會讓剩餘可退額**上升**。已補前置斷言 + 兩條負測 + DDL 突變 |

外加顯示函式 `pcm_order_refundable_remaining()`。
🔴 **它不是守門**:全樹 grep 確認沒有任何 trigger/CHECK 讀它 —— 對齊拍板⑤。

### 改形狀砍掉了什麼

砍掉兩條 CHECK(`refund_amount = items_amount - shipping_delta`、
`shipping_delta = 後運費 - 前運費`)、兩支主從一致性 trigger 與其函式、
四個欄位(`items_amount` / `shipping_fee_before` / `shipping_fee_after` / `shipping_delta`)。

`order_refund_items` **保留但凍結**(不 DROP TABLE:不可逆,且它被 A7b-M 引用為形狀樣板)。

---

## 🔴 誠實邊界

- **A7c 完全擋不到你直接進 TapPay Portal 手動退款那條路**(PCM 全程沒參與)。
  它守的只是「我們自己的紀錄不會寫錯 / 被改 / 被抹掉」。
- **對 owner 無效**:表擁有者可以 `DISABLE TRIGGER` 之後繞過全部守門,PostgreSQL 沒有
  能阻止的機制。這條靠「誰有 owner 權限」與稽核來守,不是靠 A7c。
- **不做防超退**:`refund_amount` 只有 `> 0`、**沒有上界**(拍板⑤)。
- 測試跑在本機 PG17,**不是 Supabase**:role 繼承、BYPASSRLS、pgbouncer 都不在覆蓋內。
- **Refund API(程式呼叫)的多次部分退款仍未測** —— sandbox 那筆今天 18:00 才送批。
- `database.types.ts` **刻意未重 gen**:它反映 LIVE prod schema,而 A7c 尚未 apply
  ⇒ 現在重 gen 會寫進不存在的欄位。**apply 後必須補**(欄位有增有減,型別會錯)。

---

## 🔴 未解題(需要你拍板,但不擋現在)

1. **匯款訂單無法登記退款** —— `rec_trade_id` 是 `NOT NULL`,沒有 TapPay 交易的訂單被擋死。
   刻意 fail-closed,但會擋到營運。🔴 STATUS.md 記著「5 筆已付款訂單有 2 筆
   `tappay_rec_trade_id` 為 NULL」(我今天沒有重新查證正式站,那是既有紀錄)。
2. **`partiallyPaid` 也被擋** —— 匯款可分多筆進來;日後放寬第 1 項時這道也要一起看。
3. **帳本不能容納「事後才發現、系統沒登記過的退款」** —— 例如你直接在 Portal 退了,
   事後想用 Record API 對帳補登。補登會撞上「初態必須 processing」與 `rec_trade_id` 綁定。
4. **重複扣款那天帳本記不了** —— `orders` 只有一欄 `tappay_rec_trade_id`,
   同一張訂單被扣兩次時,「退掉第二筆(重複的)交易」物理上無法登記。
   這正是你 #301 最在乎的情境,卻剛好落在交易碼綁定守門的盲區。

---

## 四輪審查抓到什麼

| 輪 | 模型 | 判決 | 最重的一條 |
|---|---|---|---|
| R1 | Claude code-reviewer | FAIL(11) | **突變判準把「被別道守門擋下」當成「本道承重」** ⇒ 據此刪掉一條死規則 |
| R2 | codex `gpt-5.6-sol` xhigh | NO-GO(16) | **INSERT 負測只插 header 就 rollback** ⇒ 既有不變式從未執行 ⇒ 5 道守門的承重證據全是假綠;另抓到折扣單高估、假對帳碼可預塞、TOCTOU |
| R3 | Fable(換角度) | FAIL(3) | **結案卻不回填對帳碼,全部守門放行** —— 前兩輪都在問「填了改不改得掉」,沒人問「能不能不填」 |
| R4 | codex(聚焦改形狀) | NO-GO(3+2) | **既有 `refund_amount > 0` 成了唯一擋 0 元/負數的東西**,而 harness 全用正數;保留 trigger 的斷言接受 `tgenabled='R'`(replica-only = 正常寫入時不觸發);共用函式的多個掛載點只測了其中一個 |

### 🔴 我自己的測試騙了我五次(值得記,因為數字是我報給你的)

1. 突變判準把「被別道守門擋下」記成「本道承重」。
2. 明細保護的判斷句抓錯兇手(比對訊息含表名,而新守門訊息剛好帶表名)。
3. 一元敏感度測試**自己走了我判定為說謊的那條路**(虛構運費)。
4. INSERT 負測只插 header 就 rollback,既有不變式從未執行。
5. 改形狀後,狀態守門的負測多帶了一個欄位 ⇒ 突變後被別道接住 ⇒ 又一次假承重
   (這次是我自己的 harness 當場抓到的)。
6. 補 `order_refund_items` 掛載點測試時,**刪的是空表** —— BEFORE ROW trigger 對 0 列不觸發
   ⇒ 「沒被擋」的假失敗。要先在交易內暫停凍結守門種一列,攻擊時再開回來。

fixture 也踩過兩次同一類坑:先是運費 = 0、後是折扣 = 0,都讓一整族判斷失去判別力。
現在 fixture 的每個值旁邊都寫著「為什麼不能是 0」。

---

## 驗收條件逐條(交接檔 §7)

| # | 條件 | 結果 |
|---|---|---|
| 1 | `a7c-preflight.sh` 退出碼 0 | ✅ **開工當下** EXIT 0。現在再跑是 EXIT 1(第 2 項要求工作樹乾淨,而樹裡有我新增的三個檔;第 6 項如預期**只列出 A7c 一支**) |
| 2 | 從零 provision 套完全部既有 migration + A7c | ✅ EXIT 0 |
| 3 | 重複套用 → 乾淨停住、零殘留 | ✅ 被擋下,trigger 數 21 不變 |
| 4 | 每道新守門 ≥1 條負測,斷言**指定的 CONSTRAINT_NAME** | ✅ **21 條負測 / 14 道守門** |
| 5 | 突變測試,0 個死規則 | ✅ **承重 14 / 被蘊含 0 / 死規則 0**;另釘死覆蓋數,負測被刪會轉紅 |
| 6 | 正向鏈坐在邊界 | ✅ 退款 7237 = 訂單實收 7237;另有「自由金額 300」與「折扣不高估」兩條 |
| 7 | 三綠 | ✅ typecheck 8/8、lint 10/10(本片零 `.ts/.tsx` 改動,故未跑 build) |
| 8 | `git status` 只多出自己的產物 | ✅ 三個新檔(+ 別線那兩個 untracked 目錄) |

**總計:43 項通過 / 0 失敗。**

🔴 上述數字綁定於以下檔案版本(未 commit 的檔測完後還能再改,不綁 hash 這份報告會沿用
一個已經不存在的綠燈)。驗證:`shasum -a 256 <上列兩檔>`,對不上就代表數字不適用。

```
9f222ea0bb6a5cb6ed5584a36a47951f3407d37ee9abdbdc648402e52aacb5a5  supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql
b6d66294ad6caf3821e68ac5458565345fd7ea8b1e15cbbcc99f4969a394df70  scripts/a7c-verify.sh
```

---

## ⚠️ 一顆地雷

**A7c 那支檔現在就躺在 `supabase/migrations/` 裡**,而 `db push` 讀的是**目錄**、不是 git
—— 這和交接檔 §0 剛清掉的 A7b-T 是同一顆雷,**與有沒有 commit 無關**。

⇒ **在審查收斂、你決定要 apply 之前,不要跑 `supabase db push`。**
⇒ `bash scripts/a7c-preflight.sh` 第 6 項會列出它,那是預期的、不是錯誤。

---

## 下一步

1. ✅ R4 已收斂、修完、重測全綠 → **已 commit(未 push)**。
   ⚠️ 誠實補充:**R4 那三條的修法本身還沒被任何人審過**(改動很窄:收緊兩處斷言、
   補一處斷言、換一句錯誤訊息、加四條負測與一道 DDL 突變,全部有測試覆蓋)。
2. **10:00 之後**:sandbox 交易 `D202607314b3cIL` 請款完成,用 sandbox + API 測
   「多次部分退款」與「超額退款會不會被 API 拒絕」。
   🔴 那是下一片(`refund()` 實作)的硬前置 —— 目前只有 Portal 那條路實證過,API 全未測,
   而 API 才是我們要走的路。
3. apply 一律你手動,且必須在審查收斂之後;apply 後記得重 gen `database.types.ts`。

— END —
