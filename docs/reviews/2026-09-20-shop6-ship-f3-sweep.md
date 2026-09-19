# 2026-09-20 · 窗 shop-6 · `ship` + `f3` 兩線查證(23 件包乾)

> 🟢 全程唯讀查正式庫(`bash scripts/readonly-prod-sql.sh`),零寫入。碼一律對 `origin/dev` 量。
> 🛑 **新竹的寫入路徑零接觸** —— 不重送、不 reset、不取消。
> 每一節 = 板上一列。板列只加**一行**標記,原文一字不動(授權:`docs/handoff/CURRENT.md` 2026-09-10「部分解凍」那一節)。

## §1 ⟦b4-MANREFUNDNOAUDIT⟧ —— **已修好**(板列停在 09-09,而修它的板 09-12 就貼了)

板列三條關閉條件,今天逐條對:

| 關閉條件 | 今天 |
|---|---|
| ① `helper` 加 audit 寫入 | ✅ 用**更好的落點**做掉了:`20260912040000_m4b_manrefundnoaudit_rpc_writes_audit.sql` 改在**兩支收得到 actor 的 RPC**裡(`admin_record_manual_refund` / `admin_void_manual_refund`),不改沒有 actor 參數的 helper。檔頭逐字寫了為什麼不改 helper。 |
| ② 回退包 §4-f 與 helper COMMENT 不再矛盾 | 🔵 **不再是問題**:落點根本沒動 helper ⇒ 兩份文件不再對同一個機制各自為真。 |
| ③ 一次真人工退款後,稽核查得到誰做的 | ✅ **量到的**(下面) |

```
🔬 APPLIED.tsv:634  20260912040000 已貼 2026-09-12(主視窗依 Sean「貼 135」代貼)
🔬 唯讀正式庫 2026-09-20:
     order_manual_refunds  rows = 3
     admin_audit_log 裡 action LIKE 'order_refund.manual%' ⇒ manual_record 3 · manual_void 1
   ⇒ 🎯 三筆人工退款, 三列稽核 —— ③ 成立, 不是「應該有」。
🟢 對照組:admin_audit_log 總列數 693(尺會動)
⚪ 負對照:action = 'pcm_zzq_not_real' ⇒ 0
```
📌 **為什麼會過期**:板列末格查證日 **2026-09-09**,而修它的那支板 **2026-09-12** 才貼。
⇒ **列尾的「仍成立」是在修法落地之前寫的。**

## §2 ⟦b4-PARTPAIDNOCANCEL1⟧ —— **已修好**(同一個形狀:查證日早於修法)

```
🔬 唯讀正式庫 2026-09-20:pg_get_functiondef(admin_cancel_order) LIKE '%partiallyPaid%' ⇒ t
     簽章只有一個多載:admin_cancel_order(uuid,uuid,text,text,text,jsonb) ⇒ 沒有舊代還活著
⚪ 負對照(同一把尺、同一發):同一個 body 找現造字 '%pcm_zzq_not_real%' ⇒ f
🟢 對照組(另一支函式,本來就不該提到它):admin_record_hct_submit ⇒ f
🔬 來源:板 20260914050000_m4b_partpaid_cancel_gate_v2.sql(commit 043b09e47 同時動了
     order-cancel-block.tsx / cancel-view.ts / cancel-view.test.ts ⇒ 前後台同一顆)
```
📌 板列末格查證日 **2026-09-10**,早於那支板的 **09-14** ⇒ **列尾那句是過期的。**
🔵 而那一列 09-10 標的是「**前提翻面**」(從未來式變成現在式),**那個判斷當時是對的** —— 它只是沒有活到修法落地那天。

## §3 ⟦ship-UNKNOWNREASONLOST⟧ —— **DB 那半已貼且今天分母 0**;板列 2428 另一句**已過期**

**(a) 窄門已經貼了**
```
🔬 supabase/migrations/20260908020000_m4b_hct_record_unknown_reason.sql · APPLIED.tsv 已貼 2026-09-08
🔬 它是【合併】不是覆蓋::174-179 只動 hct_raw_response 一欄, 佔位鑰匙 placeholder 刻意留著
```

**(b) 今天分母 0 —— 而第一次量我用錯了尺,寫下來**
```
⛔ 舊尺:hct_raw_response -> 'placeholder' = 'true'::jsonb  ⇒ 🔴 這兩箱的 raw 是【陣列】不是物件 ⇒ 這把尺瞎的
✅ 改用看得懂陣列的尺(整串文字比對)2026-09-20 唯讀實查:
     兩箱 raw 含 'placeholder'   ⇒ f
     兩箱 raw 含 'unknownReason' ⇒ f
   ⚪ 負對照同一把尺找現造字 'zzq_not_real' ⇒ f
   🟢 對照組:hct_status='submitted' ⇒ 2 而 hct_status='zzq_not_real' ⇒ 0
🔬 而整張表【一箱 unknown 都沒有】:狀態分佈 draft 4 · submitted 2
⇒ 🎯 乙型分母 = 0。不是「修好了」,是【這條路今天一次都沒被走到】。
```
📌 **結論不變而理由換了** —— 舊尺給的 0 是**假的 0**(它對陣列恆 false),新尺給的 0 才算數。

**(c) 🔴 板列 2428 有一句已經過期,而它會誤導下一個人**
```
板列 2428 逐字:「HCT_SUBMIT_ENABLED 關著 ⇒ 一箱都還沒走過這條路」
🔬 git log -S 那句 -- docs/launch-todo.md ⇒ a5e2bf2e3 · 2026-09-08
🔬 而正式庫兩箱真的送出去過:S9FC6P 2026-09-10 · 45NJ3Y 2026-09-16 —— 都在那句【之後】
🔬 新竹真的回了:raw 元素 0 的鍵 = AREAS CODE1..CODE7 edelno epino eqamt eqmny ErrMsg
     erstno image MDCODE1..3 NewOutArea Num success ⇒ 新竹 API 自己的欄位名
⇒ 📌 板【過期】, 不是有人在箱子送出之後還寫「一箱都沒走過」。兩者要分開。
```
🛑 **而那兩張託運單今天在新竹那端還在不在 —— 未確認。** 我們這邊六箱全作廢(`deleted_at` 全非空),
而作廢我們的紀錄 ≠ 取消新竹的託運單。**已端 Sean 打電話**,窗不碰新竹寫入路徑。
🔵 白話版給 Sean:`~/pcm-mailbox/給Sean-新竹兩張託運單-20260920.md`(不在 repo)。

## §4 ⟦f3-AUTOREFUND2⟧ —— **仍不可派,而我【刻意沒有加標記】**

```
🔬 板列 :1204 末格 2026-09-10 已經標過:「仍成立 · 不可派(卡前置不是卡人)」
🔬 前置 E8-B 的 B7 那一列(本檔量時在 :602)今天仍是 open
   事欄逐字「開關已開,只剩負向驗收」⇒ 📌 開關開了 ≠ 驗收做了
⇒ 🎯 **狀態與 09-10 那一次【一模一樣】,沒有新事實。**
```
📌 **再加一行內容相同的標記,只會讓那一列更長而不會更準。**
🛑 板列的價值在**讀的人能不能快速判斷**,而**重複的標記會稀釋掉真正有變化的那幾行**。
⇒ 所以本列**不標**,理由寫在這裡。
