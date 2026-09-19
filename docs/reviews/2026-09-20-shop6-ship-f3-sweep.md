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

## §5 ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ —— **結論同(曝險 0),而板上寫的【理由】站不住**

板列 2026-09-10 的理由逐字:
> 「`sweep-email-outbox.ts:2183` 只有 `order_shipped` 與 `shipment_tracking_corrected` 會填,其餘設計上就是 null ⇒ **今天 7 列全空是【對的】**」

🔴 **而那個前提今天量得到是錯的:outbox 裡【就有 2 列是 `order_shipped`】,而它們照樣空。**
```
🔬 唯讀正式庫 2026-09-20 · email_outbox:
   event_type 分佈:bank_order_created 4 · order_created 4 · order_shipped 2
                   · order_cancelled 1 · order_partially_refunded 1 · order_unpaid_cancelled 1(共 13 列)
   那兩列 order_shipped:XS6XVY / ZN2HDP · status=sent · attempts=1
                        · sent_tracking_number 皆 NULL · sent_tracking_recorded 皆 false
```
✅ **而【真正的理由】是時點,不是事件類型** —— 我差一點把它讀成缺陷,查下去不是:
```
🔬 那兩封寄出時間:2026-09-02 03:05 與 03:30(sent_at)
🔬 而 sent_tracking_number 這個欄位是 2026-09-05 / 09-06 才建的
   (git log -S'sent_tracking_number' -- supabase/migrations ⇒ 72d53b562 09-05 · 74ec81a5d 09-05 · 8486bbf3e 09-06)
🔬 同一發 SQL 直接問:sent_at > '2026-09-06'::timestamptz ⇒ **兩列都 f**
⇒ 🎯 **它們的 NULL 是【欄位還不存在的年代留下的】, 不是「該填而沒填」。**
```
🟢 **對照組**:`sent_tracking_number` 非空的列在**所有六種 event_type 上都是 0** ⇒ 這把尺沒有偏心。
🔬 而**寫入邏輯今天在**:`grep -c 'sent_tracking_number\|sentTrackingNumber' packages/use-cases/src/sweep-email-outbox.ts` ⇒ **5**(⚪ 負對照現造字 ⇒ 0)。

⇒ 📌 **曝險今天仍是 0,而理由要換** ——
**舊理由**:「沒有該填的那一類」→ 🔴 假的,有 2 列。
**新理由**:「該填的那 2 列出現在欄位存在之前」→ ✅ 量到的。
🛑 **⇒ 下一封 `order_shipped` 才是這一列的第一個真樣本。** 而自 2026-09-02 之後**一封都沒有再寄過**。

## §6 ⟦ship-HCTUNKNOWNREAD⟧ —— 曝險仍 0,而「0 箱走過這條路」要分兩層講

```
🔬 唯讀正式庫 2026-09-20:hct_status 分佈 = draft 4 · submitted 2 ·【unknown 0】
⇒ ✅ 「乙型分不出來」那個病今天仍然打不到任何一箱(unknown = 0)。
🔴 而【submit 這條路】已經被走過兩次(S9FC6P 2026-09-10 · 45NJ3Y 2026-09-16, 新竹真的回了單號)
⇒ 📌 **「這條路沒人走過」與「unknown 沒發生過」是兩件事**, 而板上那句把它們合成一句。
```
🛑 下一個人要知道的是:**閘已經被走過,只是沒掉進 unknown** —— 而不是「這條線還沒啟用」。

## §7 ⟦ship-HCTLABEL⟧ —— 09-10 標的「今天曝險 未量」那一格,今天量了

```
🔬 板列 09-10 逐字:「庫裡至今 hct_raw_response 非 null 0 筆【今天是 1 筆】…今天曝險 未量」
🔬 2026-09-20 唯讀實查:hct_raw_response 非 null =【2 筆】(S9FC6P · 45NJ3Y)
🔬 而曝險 = 0:shipments 6 箱, deleted_at 全部非空 ⇒ **活的出貨單 0** ⇒ 今天沒有任何一張真的箱子在等那張紙
🟢 對照組:同一發 hct_status 非空 6 · hct_request_id 非空 2(尺會動)
```
🛑 **而本列 open 的理由不變,也不該變**:擋路的是**對方的動作**(新竹要看過我們印的樣子),
而列尾自陳「**這一格沒有主人**」。⇒ 📌 **這是「卡在外部而無人領」,不是工程還沒做。**

## §8 ⟦5b-866ISWARNINGNOW⟧ —— 自標「證不到」的第 ③ 格,關掉一半

板列自標四條證不到,其中 ③ 逐字:「沒查 `pcm_order_refundable_remaining` **有幾代**、正式庫那版**是不是 repo 最新**」。
```
🔬 唯讀正式庫 2026-09-20:pcm_order_refundable_remaining 在 public 底下【只有 1 代】
   簽章 pcm_order_refundable_remaining(uuid) → bigint
🟢 對照組:admin_cancel_order 同一發也是 1 代(尺會動)
⚪ 負對照:現造名 pcm_zzq_not_real_fn ⇒ 0 代
```
⇒ ✅ **「有幾代」= 1,量到了** ⇒ 不會有「舊代還活著」那一族問題。
⚠️ **而「是不是 repo 最新」我【沒有查】** —— 那要拿本體與 repo 最新那支 migration 逐字對,我沒做。**③ 只關一半。**
🛑 本列其餘不變:修法受詞是 RPC 那一層 ⇒ 鐵則 12①③ ⇒ **要 Sean 批、要 Sean apply**。

## §9 ⟦b4-RESEND409⟧ —— 板上猜錯的那個欄名,真值找到了,曝險量得出來而且是 0

```
🔬 板列逐字:「我想數『撞過那一類的信有幾封』而【猜錯了欄名】(attempt_count 不存在)⇒ 不猜, 標未量」
🔬 2026-09-20 實查 email_outbox 欄位清單 ⇒ 真名是 attempts(integer)與 last_error_code(text)
🔬 用真名量:信件總數 13 · last_error_code 非空 1 · 含 'idempot' 0 · 含 '409' 0
            · attempts > 1 的 0 · max(attempts) = 1 · status='failed'(死信) 0
🟢 對照組:status 分佈 sent 12 · skipped_manual_no_recipient 1(表不是空的)
⚪ 負對照:status='pcm_zzq_not_real' ⇒ 0
```
⇒ ✅ **曝險 0,而這次是【量到的】不是「量不到」** —— 沒有任何一封信重試過,更沒有撞 409。
🛑 **而本列的病本身沒有被修** —— `email-backoff.ts:88` 把 `idempotency_payload_mismatch` 分到 `idempotency_24h` 那條路還在。**曝險 0 是分母造成的**(信總共才 13 封)。

## §10 這一輪查到、而**不屬於我這兩條線**的(只報不動)

```
🔴 ⟦front-PDPTAXONOMYEMPTY⟧(f3 表上列為 parked)關閉條件逐字是「上線後或 Sean 說有流量那天」
   ⇒ 而網站 2026-09-15 已經正式上線, 今天是第 5 天 ⇒ 📌 那個【等時機】可能已經到了。
   🛑 它是 front 線的, 我不碰, 只報。
🔴 板列 ⟦ship-HCTLABEL⟧ 的 2026-09-10 標記裡【逐字印了一個完整的新竹託運單號】。
   那是對外單號, 而板檔會跟著 repo 到處走。🛑 而「禁改原文」⇒ 我不動它, 端主視窗裁。
```

---
# 無主線(22 件)

## §11 ⟦search-DUPCATNAMES⟧ —— **今天已不成立**(同名分類 0 組)

```
🔬 板列 2026-09-10 逐字:「①『三組同名』已過期 ⇒ 今天 1 組, 另兩組改名成「(四輪)」」
🔬 2026-09-20 唯讀實查:
     SELECT name, count(*) FROM categories GROUP BY name HAVING count(*) > 1  ⇒ 【0 列】
   🟢 對照組:categories 總列數 115 ⇒ 表不是空的, 這個 0 不是「查無表」
⇒ 🎯 三組 → 一組 → **零組**。本列的病(客人拿到哪一個由沒有保證的順序決定)今天打不到任何人。
```
🛑 **而【結構上的保護沒有加】** —— 沒有唯一約束、沒有任何東西擋下一次再建一個同名分類。
⇒ 📌 **這是「今天沒有實例」不是「不可能再發生」。** 本列標【已不成立】而不是【已修好】,差別就在這裡。
🔵 09-10 記的另外兩格順帶失效:`category-queries.ts` 已加 `.order(id)` 全序(那一格已修),
而「今天選中的是有貨那一列是巧合」—— **沒有同名就沒有這個選擇**,該格不再有受詞。

## §12 ⟦b4-PARTCANCELTAX⟧ —— 仍成立,而**分母在長**(09-09 預言的「這個 0 最短命」再次應驗)

```
🔬 板列 09-09 逐字:「exclusive 的單 0 張 ⇒ 【1 張】(tax_total 50)…這個 0 最短命」
🔬 2026-09-20 唯讀實查 orders:總數 12 · tax_total 非 0 = 【2 張】· =0 的 10 張 · NULL 0 張
   ⚪ 負對照:tax_total = -999999 ⇒ 0
⇒ 🎯 **1 → 2。十一天長一張, 而錯的方向是【錢往外多走】。**
```
🛑 **而本列最重要的不是那個數字,是它留給下一個人的那句**(板列逐字,我原樣帶走):
> 「那道 `tax_total <> 0 ⇒ 不算` 的閘,**必須跟著 OP7 那支『多退』函式一起走**
>  —— 一個 fail-closed 的保護,今天住在一支【還沒被寫出來的函式】的前提裡,
>  而那份前提沒有寫在任何一個那個人會讀到的地方。」

⇒ 📌 **所以本列的風險不是「今天 2 張」,是【做多退那片的人不知道要把那道閘帶過去】。**
⚠️ 而板列自標證不到的那格照舊:`pcm_readonly` 讀不到那支 view(`permission denied`)
⇒ 那一格仍是**讀了碼**不是**量了行為**,我**沒有**把它讀成已驗。

## §13 ⟦b4-CUTOFFWRONGCOLUMN⟧ —— 仍卡 Sean,而**它要的是另一顆 env**

```
🔬 本列要的是 CANCELLED_EMAIL_CUTOFF(板列逐字),【不是】今晚 Sean 已經給值的 SHIPPED_EMAIL_CUTOFF
🔬 repo 裡與「哪些信寄得出去」有關的 cutoff 類 env 共四顆(git grep 計數):
     CANCELLED_EMAIL_CUTOFF 24 · BANK_ORDER_CREATED_EMAIL_CUTOFF 10
     · PARTIAL_CANCEL_EMAIL_CUTOFF 11 · PARTIAL_REFUND_EMAIL_CUTOFF 12
     (🟢 對照:SHIPPED_EMAIL_CUTOFF 93 —— 今晚已知有設)
⇒ 📌 **Sean 去 Vercel 看一次就能一次答完四顆**, 而現在是一顆一顆擋著不同的板列。
```
🛑 施工窗不准讀 Vercel env ⇒ **這四顆一律「未確認,要 Sean 自己看」**。建議把四顆併成同一題端他。
