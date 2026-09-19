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

## §14 ⟦b4-CARDALREADYREFUNDED⟧ —— 09-10 標「已修好」而自陳沒驗活的庫;**今天在活的庫上驗了**

```
🔬 板列 09-10 自標逐字:「⚠️ 而我沒驗正式庫上今天的 prosrc, 我證的是【檔案這樣寫、帳本記它貼了】」
🔬 2026-09-20 唯讀實查 pg_get_functiondef(admin_record_manual_refund):
     含「卡上那筆的狀態我確認過了」            ⇒ t
     含「已經退成功】的話:卡那半不要在這裡登記」⇒ t
   ⚪ 負對照(同一發、同一個 body):含現造字 'pcm_zzq_not_real_string' ⇒ f
   🟢 對照組(另一支函式,本來就不該有):admin_void_manual_refund ⇒ f
   🔬 而它只有【1 個多載】(8 參那支)⇒ 沒有舊代還活著
⇒ ✅ **那一格從「檔案這樣寫」升級成「活的庫真的這樣」。本列可以放心讀成已修好。**
```

## §15 ⟦b4-PAIDTHENOVERPAID⟧ —— 09-09 標「⚪判不出」而它自己寫明缺哪一道;**那一道今天跑了**

```
🔬 板列 09-09 逐字:「⚪判不出…【那 7 支檔有沒有進 dev】我沒查 ⇒
   缺的檢查:對本列點名的 commit 跑 git merge-base --is-ancestor <sha> origin/dev」
🔬 2026-09-20 對本列點名的四顆逐顆跑(先 git cat-file -e 確認存在, 再問祖先關係):
     8dc919f19 ⇒ 在   ce1451e62 ⇒ 在   e25aa7e3a ⇒ 在   e581dbed2 ⇒ 在
   ⚪ 負對照:現造 sha `deadbee` ⇒ git cat-file -e 說不存在 ⇒ 尺會動
⇒ ✅ **四顆全在 `origin/dev`。那個「判不出」的成因消失了。**
```
🛑 **而本列【不因此變成做完】** —— 它自陳還等兩件:①`-f8` 那棵樹補裝 `@pcm/pdf` 之後補跑一次 typecheck
②誰欄逐字「**要一段『已付款而多匯』的文案,而客服稿 Q6 也沒涵蓋**」⇒ 那是**文案**,不是碼。
⇒ 📌 **碼那一半到位了,卡的是一段沒有人寫的話。**

## §16 ⟦db-ROLLBACKPROSE222⟧ —— 🔴 **慣例其實已經換了,而 09-10 那次重量【用了一把看不到修法的尺】**

板列 09-10 重量逐字:「**檔名帶 down/rollback/revert 0 ⇒ 仍 0**(⚪ 負對照 zzzbogus ⇒ 0)」。
🔴 **那把尺只看 `supabase/migrations/` 底下的檔名** —— 而真正的修法住在**隔壁目錄**。

```
🔬 supabase/rollbacks/ 這個目錄 2026-09-05 才誕生(首次出現的 commit 3a49c6827)
🔬 逐個時點數(git ls-tree, 先算完整個數不接 head):
     2026-08-28(本列開列那天)⇒ 0 支     ← 所以本列當天那句【是對的】
     2026-09-11 之前(09-10 重量那天)⇒ 45 支  ← 🔴 而 09-10 的尺回報「仍 0」
     2026-09-20 今天 ⇒ 126 支
   ⚪ 負對照:同一發問一個現造目錄 supabase/zzq-not-real/ ⇒ 0
```

**而覆蓋率是多少 —— 用版本號配對量**:
```
🔬 migration 502 支(全部帶 14 碼版本號)· rollbacks 126 支(全部帶 14 碼版本號)
   · 2026-09-05【之後】的 migration 199 支 ⇒ 有配對 rollback 的 123 支 =【61.8%】
   · 2026-09-05【之前】的 migration 303 支 ⇒ 有配對的 3 支 =【1.0%】
   ⚪ 負對照:現造版本號 99991231000000 在 rollbacks 裡 ⇒ False
   🟢 正對照:隨手挑一支真的配對到的 ⇒ 20260905130000
```
⇒ 🎯 **慣例是真的換了**:從「回退方案 = 一段註解」變成「回退方案 = 一支真的 `.sql`」,而**轉折點就是 09-05**。
🛑 **而本列不因此關掉**,三個理由:
① **61.8% 不是 100%** —— 09-05 之後仍有 76 支沒有配對的回退檔。
② **09-05 之前那 303 支基本上沒有**(3 支)⇒ 舊的那一堆仍然是註解。
③ 本列自標「**那些註解跑不跑得起來 = 未量**」⇒ **今天我也沒量**,一支都沒執行過。

📌 **而這一列最該被帶走的不是數字,是那把尺**:
🎯 **一次「仍然是 0」的重量,量的是一個【修法不住在那裡】的位置。**
⇒ 🔴 **而那個 0 有負對照、有時點、看起來完全嚴謹** —— 它唯一的問題是**分母選錯了目錄**。

## §17 ⟦f3-HALFWRITE1⟧ —— 09-10 自標「沒複驗那份 plan 的讀數」;**今天逐格複驗了,機制成立**

```
🔬 板列 09-10 自標逐字:「🛑 我只讀了那份 plan 前 22 行, 沒複驗它的讀數」
🔬 2026-09-20 對 scripts/rpm-load.ts 逐格開檔核(不是讀 plan):
     :16  const BATCH_SIZE = 500;                                          ✅ 逐字相符
     :140 for (let i = 0; i < rows.length; i += BATCH_SIZE) {              ✅ 逐字相符
     :145 if (error) throw new Error(`upsert ${table} batch@${i}: ...`);   ✅ 逐字相符
   🔬 而關鍵那一格:全檔 `catch` 命中【0】⇒ **逐批 throw 而沒有逐批 catch**
   ⚪ 負對照:同檔 :1 印出來的是 `/**` ⇒ 我讀的確實是那幾行, 不是整檔亂撈
⇒ ✅ **機制成立**:先前批次已 commit、失敗那批回捲、之後的從沒送出 ⇒ **半寫入,不是整批回捲。**
```
🛑 **本列仍未做完** —— 我證的是**病確實在**,不是**病被修好**。修法要碰同步管線,未動。

## §18 ⟦b4-MANUALORDERDEADEND⟧ —— 標題那一句**今天不成立**,而關閉條件**一條都沒到**

主視窗 2026-09-20 用後台建了真單 `8HSMDP` 一路走到出貨彈窗打得開。
🛑 **而它走的是一條路,不是五格** —— 我逐格核,結果分兩半。

### ✅ 不成立的是標題的**最後一句**
板列標題逐字:「手動建單走得完, 而走完之後【出不了貨】—— 而那是【設計】不是 bug, **只是畫面從來沒說出來**」。
```
🔬 apps/admin/src/components/orders/manual-order-view.tsx:106 逐字(表單第一行):
   「電話 / LINE 來的單在這裡建;出貨前要先「到貨登記」,不然出貨那邊會是「可出 0」。」
   ⚪ 負對照:同一把尺找一句現造的話 ⇒ 0
🔬 那句話什麼時候進來的:a54d37248 · **2026-09-14**
🔬 而板列最後一次查證是 **2026-09-09** ⇒ 📌 **板比修法早五天。**
🔬 另一格:出貨彈窗會印「尾款 X 元未收」(shipment-dialog.tsx:137-138, Sean 2026-09-04 拍甲)
```
⇒ 🎯 **畫面說了,而且說在最前面。** 那一句要劃掉。

### 🛑 而關閉條件三條,一條都沒到
```
① 乙2/乙3 的體積「有人量過【並拍板】」⇒ 🔴 走通一次不是拍板。而我也量不準 ——
   板上的「9 步 · 8 個必填欄」是**在鑽機上走一遍**量的,
   而我只能 grep:整族 12 支檔 `required` 命中 9 處(⚪ 負對照現造屬性 ⇒ 0)。
   📌 **9 與 8 不可比** —— 兩把尺量的不是同一個東西(一個是走出來的步數, 一個是字串命中數)。
   ⇒ 🛑 **所以我【不寫】「8 變 9」**, 我寫「這一格我量不準」。
② 乙4 已併進 ⟦b4-PRICECOPYTAX⟧ ⇒ **不在本列解**(板列自己寫的)。
③ ②「未選身分 ⇒ 寫入靜默失效」要在**走得到那條路的環境**驗 ⇒ 仍未驗。
```
⇒ ⇒ **標 Ⓐ「本列某句有誤」,不標 done。** 主視窗逐字交代過:「不要因為我走通了就標 done」。

## §19 ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ —— **第一個真樣本來了,而那一欄填對了**

§5 寫過:「**下一封 `order_shipped` 才是這一列的第一個真樣本**」。它在幾小時後就出現了。
🛑 **而主視窗把讀數轉述給我,我沒有採用它 —— 我自己重跑了一發。**

```
🔬 2026-09-20 02:3x 唯讀實查 email_outbox 的三封 order_shipped:
   XS6XVY  sent 2026-09-02 03:05Z  recorded_tracking f · sent_tracking_recorded f   ← 欄位建立【前】
   ZN2HDP  sent 2026-09-02 03:30Z  recorded_tracking f · sent_tracking_recorded f   ← 同上
   3D6GCD  sent 2026-09-19 18:30Z  recorded_tracking t · 長度 10 · recorded t       ← 欄位建立【後】的第一封
                                   attempts 1 · last_error_code 空 ⇒ 一次就寄成
🟢 對照組就在同一發裡:兩封舊的仍是 f/f ⇒ **這把尺分得出兩個世界**, 那個 t 不是整排都 t
⚪ 負對照:event_type = 'pcm_zzq_not_real' ⇒ 0
🔬 而 outbox 總數 16 · order_shipped 3 · 最新一列 2026-09-19 18:30Z ⇒ 表還在寫
```
⇒ ✅ **欄位建立之後寄出的第一封,那一欄就填了。** §5 的結論(曝險 0 · 理由是時點)**被真樣本印證,而不是被推論支撐**。
🛑 **我沒有把那個單號的值寫進任何檔** —— 只記長度 10。理由與 `⟦ship-HCTLABEL⟧` 那件同一條。

## §20 收尾那三種定位法 —— 給下一個要動板列的人抄

今晚動板列用了**三種定位法**,而每一種都配一道「不是恰 1 就停手」的閘。**兩層都要:先過濾、再斷言恰 1。只有第一層的話它會安靜地挑錯。**

| 定位法 | 什麼時候用 | 已知的坑 |
|---|---|---|
| **錨欄比對整個 `⟦…⟧`** | 有錨的列 | 🔴 用前綴會誤中更長的錨(`ship-HCTLABEL` 命中 `ship-HCTLABELCAPTURE`) |
| **錨欄 + 態欄是合法狀態字** | 同一個錨出現兩次 | 🔴 第二列在 `:1763` 起的**副本表**裡,它第 1 欄是【行】不是【態】 |
| **本列自己的一段字面** | **無錨**的列 | 🔴 短字面會命中別列(`b4-PAIDTHENOVERPAID` 命中 2 列 —— 另一列在引用它) |

```
⚪ 對照組(證明那道閘會叫):拿一段到處都有的字面 '🔴 **' 去定位 ⇒ 命中 920 列 ⇒ 停手
```

🛑 **而【不補錨】是刻意的**(主視窗 2026-09-20 裁丁):
> 錨是一個**識別碼** —— 一旦補上去,派工表、`what-happened-to.py`、別人的引用都會開始指它。
> **補錯了要改,而改識別碼比改內文貴十倍。**

🛑 **而 `doing` 的列不翻成 `parked`**:Sean 授權的是 `open ⇄ parked`,`doing` 不在射程;
而 **`doing` 本身帶著「曾經有人在做」的資訊,翻掉會弄丟它。**
⇒ 🎯 **那四列靠的是尾巴那一行裡的五個字:「本列不再派。」** —— 它不需要動態、也不需要錨。

## §21 ⟦b4-BANKORDERINVISIBLE⟧ —— 🔴 **標題與末格指向相反的事,而排序用的是標題**

```
標題逐字:「🔴🔴 匯款單在 DB 眼裡不存在 —— 而它會讓一個客人【兩邊都付】」
末格逐字(09-10):「仍成立 · 而修法已被裁定排除過兩層 ⇒ **不做**」
⇒ 🎯 一列板子的【標題】與【結論】可以指向相反的事, 而**派工的人讀的是標題**。
⇒ 📌 2026-09-20 這一列就是照標題被派出來的 —— 主視窗自陳「我就是照標題派的」。
```

**而「兩邊都付」那一半 2026-09-04 就關了,我在【線上】量到:**
```
🔬 pg_get_functiondef(begin_charge_attempt(uuid)) 含 'superseded_by_card'      ⇒ t
🔬 同一個 body 含 bank_transfer 那段管道條件                                    ⇒ t
⚪ 負對照(同一 body 找現造字)⇒ f   🟢 對照組 admin_record_hct_submit ⇒ f
🔬 20260904050000 在 APPLIED.tsv ⇒ 1(🟢 正對照已知那支 ⇒ 1 · ⚪ 負對照現造版本 ⇒ 0)
🔬 而 cancelled_reason = 'superseded_by_card' 的單 ⇒ **0 張** ⇒ 那條路一次都沒被真的走過
```
⇒ ✅ **客人先建匯款單、再回頭刷卡 ⇒ 那張匯款單會被就地取消 ⇒ 不會兩邊都付。**

🛑 **而本列今天不是「已解決」,是【已被拍板接受的殘餘風險】**(Sean 2026-09-06 拍甲:不另加 DB 層鎖)。
⚠️ 而板上自標那一拍的授權強度是**【待 Sean 複核】**不是【已確認】——
**這一句不因為今天補齊了證據而改變。** 原樣帶過來,沒有讀寬。

🔵 **順手量到而屬於【別列】的分母**:
```
orders 14 張 · payment_channel = bank_transfer 的 11 張 ⇒ 匯款是今天的主要管道
而今天有【2 張】未付款、未取消的匯款單活著 ⇒ 那是 ⟦b4-BANKNOEMAIL⟧ 的分母, 不是本列的
```

## §22 ⟦b4-CLEARALLKEEPSJUNK⟧ —— 🔴 **受詞是派工的人自己補的,而那兩個字決定了派給誰**

```
派工理由逐字:「員工每天在按那顆鈕」
🔬 而 git grep -ln 清除全部 -- apps ⇒ **11 支全部 apps/storefront、0 支 apps/admin**
   (use-catalog-filter-url-sync · FilterSide · FilterTop · ActiveChips
    · products-url-state.hooks · SearchKeywordChip · products-message-state …)
⇒ 🎯 **按那顆鈕的是【客人】, 在商品目錄的側欄篩選上。**
⚠️ 而同一份派工單叫我用 `admin-probe` 去按它 —— **那個鑽機開的是後台, 根本看不到那顆鈕。**
```
📌 **而「員工」那兩個字【板上沒有】** —— 派工的人讀了標題,然後自己補上去,
而**那兩個字決定了這件事排進哪一條線**。
⇒ 🎯 **一個錯的受詞,會讓派工落在錯的窗上,而兩邊都不會發現 —— 因為那個理由本身聽起來是對的。**
🔵 主視窗當場自陳:「那個受詞不是板上寫的,是**我自己加上去的**。」

**而本列仍然開著,只是現在不該動**:
```
末格逐字:「要推翻它, 得先答得出『怎麼分得出垃圾參數與客人的舊連結』—— 而今天沒有人答得出來
   ⇒ 所以主視窗刻意【不裁、也不現在端 Sean】:端一個答不出前置的題給他,
      只會拿回一個沒有依據的拍板。」
```
🛑 **所以它不是「沒人做」,是「有人判斷現在不該做」** —— 不要標成不成立。

🔵 **而這一次標題與末格【沒有】打架**(前兩次誤派都是那個形狀):末格是在**細化**標題。
而末格自己留的那句 ——
> 「兩件事同名不同因…**不要因為前者做完就把這一列劃掉。**」

⇒ 🎯 **它今天真的擋住了一個人(我)。一句寫給下一個人的話,真的擋到了下一個人。**

## §23 ⟦auth-MANUALORDERLIMITBURN⟧ —— **修法 2026-09-10 就落地了,而板列還停在「等 Sean 批」**

板列末格逐字:`⟨已查證 2026-09-10 · 仍成立 · plan 在 docs/plans/2026-09-10-manual-order-recipient-plan.md · **等 Sean 批**⟩`
🔴 **而那份 plan 同一天就被實作了。**

### ① 逐支驗 —— 🔵 而今天是【九支】不是七支
```
🔬 ls packages/use-cases/src/enqueue-*-emails.ts ⇒ **9 支**(commit 訊息寫「七支」是 2026-09-10 當時的數)
🔬 逐支三格(每一格都是分開數的, 不是一個總命中數):
   檔                                        push   沖出迴圈   真的叫 outbox
   enqueue-bank-order-amount-changed-emails    1       1           1
   enqueue-bank-order-created-emails           1       1           1
   enqueue-order-cancelled-emails              1       1           1
   enqueue-order-created-emails                1       1           1
   enqueue-order-partially-cancelled-emails    1       1           1
   enqueue-order-partially-refunded-emails     1       1           1
   enqueue-order-shipped-emails                1       1           1
   enqueue-order-unpaid-cancelled-emails       1       1           1
   enqueue-tracking-corrected-emails           1       1           1
   ⚪ 負對照:現造方法名 enqueueZzqNotReal ⇒ 0 支
⇒ ✅ **九支全部**:`suppressedInputs.push(input)` → `for (const input of suppressedInputs)`
   → `await deps.outbox.enqueueManualNoRecipient(input)`
```
🔵 **而那個沖出迴圈排在 cap 閘【之前】是承重的**(`enqueue-bank-order-created-emails.ts:140-143` 逐字):
> 「那道閘會 `throw`,而 throw 在寫痕跡之前**正是本片要修的病**(下一輪再撈到同一張單,永遠)。」

### ② 🔴 而有一條路【確實不留痕】—— 我照實寫,不寫成「全都蓋到了」
```
🔬 同一支 :108-113:effectiveEmail === null ⇒ result.noRecipient += 1; continue;   ← **沒有痕跡**
🔵 而那是【兩個信箱都空】那個世界, 檔內逐字標明「那是 ⟦b4-NORECIPIENTWINDOW⟧ 那一族, 不是本片」
⇒ 📌 **所以本列的射程是「手動單有 customers.email 可以借來落痕」那一種, 不是全部。**
```

### ③ 正式庫對得上 —— 而正負對照剛好各有一個真樣本
```
🔬 機制落地時間(UTC):2899c72fd 09-10 12:03 · ac9b65b0e 09-10 12:24 · 兩顆都在 origin/dev 與 origin/main
🟢 正對照(機制之【後】· 而且那條軌真的掃手動單):
   cd5d9a14 manual_line 2026-09-16 · outbox 一列 event_type=order_partially_refunded
   · status=**skipped_manual_no_recipient** · was_sent=**f** ⇒ **痕跡真的落下來了**
⚪ 負對照(機制之【前】⇒ 本來就不該有痕跡)—— 四張全部落在 12:03 之前:
   d53eed7c 09-05 08:14 · 8e664f0b 09-09 13:54 · 3a4c75e3 09-09 13:55 · e3af8388 09-10 **02:56**
   ⇒ 🎯 **四張全是「之前」, 沒有一張是「同時」** ⇒ 零筆無法解釋。
🔵 而 c81ed568(09-19, manual_phone, 有填 notification_email)沒有痕跡也是對的:
   「匯款訂單成立信」那條軌的 view 寫死 `AND o.order_source = 'web'`(20260907220000:52)
   ⇒ **它根本不掃手動單** ⇒ 沒有東西可以留痕。
```

⇒ ✅ **結論:修法已實作、九支全到、正式庫有真樣本。板列末格那句「等 Sean 批」是過期的。**
🛑 **而我沒有改態** —— 這一列不在那 99 件重判清單裡,換態要 Sean。

## §24 ⟦b4-CUTOFFWRONGCOLUMN⟧ —— **「卡在 Sean 讀不到 env」擋不住【量那個傷害】,而我量到一個真的例子**

板列卡住的理由逐字:「答不出兩格而其中一格只有他能答:**【讀不到 Vercel env】** ⇒ 證不到那顆 cutoff 現在是多少、甚至有沒有設」。
⇒ 🎯 **而那句話擋住的是「證明那顆 env 的值」,不是「量那個傷害有沒有發生」。** 後者不需要 env。

### 量到的:七張已取消的單,五張沒有取消信 —— 而其中【一張是 web】
```
🔬 唯讀實查 2026-09-20(orders.cancelled_at 非空 = 7 張):
order_id     建立              取消              來源          付款     取消信  其他信件
d53eed7c…  09-05 08:14      09-06 14:52      manual_phone  unpaid    0     (無)
3a4c75e3…  09-09 13:55      09-09 13:57      manual_phone  unpaid    0     (無)
8e664f0b…  09-09 13:54      09-09 13:58      manual_phone  unpaid    0     (無)
e3af8388…  09-10 02:56      09-15 16:00      manual_phone  unpaid    0     (無)
🔴 9b686bda… 09-06 14:57     09-11 **16:00:00**  **web**    unpaid    **0**  bank_order_created/sent
✅ 46245478… 09-11 17:35     09-11 17:45:33     web        unpaid     1    bank_order_created/sent + order_unpaid_cancelled/sent
✅ 50d7fd11… 09-11 16:45     09-11 17:46:16     web        refunded   1    order_cancelled/sent + order_created/sent
⇒ 7 張裡 5 張沒有取消信;🔵 其中 4 張是 manual_phone 且 notification_email 全空
  ⇒ Sean 拍板「可以不填 = 不寄」⇒ **那四張是對的**
⇒ 🔴 **剩下那一張 9b686bda 是 web 客人, 而他【什麼取消通知都沒收到】。**
🟢 對照組:同一發問 order_cancelled / order_unpaid_cancelled 在 outbox 裡各有 1 列
  ⇒ 那兩條軌是活的, 那個 0 不是「整張表都沒有這種信」
⚪ 負對照:event_type 現造 ⇒ 0
```

### 🛑 而【為什麼那一張沒收到】有兩個解釋,今天的資料分不出來
```
假說 A(本列講的病):看 created_at 不看 cancelled_at
   9b686bda 建立 09-06(舊)· 46245478 建立 09-11 17:35(新)⇒ 舊的被 cutoff 擋掉
假說 B(另一種):被【自動逾期取消】的單不寄信
   9b686bda 取消於 16:00:00 整點 ⇒ 像 cron;46245478 取消於 17:45:33 ⇒ 像人手按的
🔴 **兩個假說都完全吻合今天這兩張單。** 而我分不出來 ——
   要分開它, 需要一張【建立時間在 cutoff 之後、而被 cron 自動取消】的 web 單, 而今天沒有。
```
⇒ 📌 **所以我寫的是「量到一個 web 客人沒收到取消信」,不是「本列的病發生了」。**
🎯 **一個讀數同時吻合兩個假說時,它證明的是【有事發生】,不是【哪一件事發生】。**

⇒ 🔵 **而不論哪一個假說成立,那位客人的體驗是同一件事:單被取消了,而他沒有收到任何通知。**
🛑 而修法要碰那條信軌的篩選條件 ⇒ 鐵則 8,**本檔零落筆**。

## §25 ⟦f3-ADPNARROWER1⟧ —— 「等 Sean 批」在這一列是**雙重假的**,而它的結論今天仍然成立

### ① 那句「等 Sean 批」為什麼是假的 —— 兩個獨立的理由
```
🔬 板列末格逐字:「⟨已查證 2026-09-10 · 仍成立 · **plan 在 (無, 只複量)** · **等 Sean 批**⟩」
🔴 理由一:**沒有 plan** —— 它自己寫「(無, 只複量)」⇒ **他要批什麼?**
🔴 理由二:**他明文說過這一類他不接** —— Sean 2026-09-19 劃線(memory
   project_0919-sean-scope-of-his-decisions)逐字:「只管【他會看到 / 員工會看到 /
   客人會用到看到】的;**DB 權限那類他不懂也不接, 叫我們自己判斷**」
   而本列講的正是 `ALTER DEFAULT PRIVILEGES` 的射程 —— **DB 權限。**
⇒ 🎯 **一列寫著「等他批」, 而(a) 沒有東西可批 (b) 他說過這類不接。**
📌 **它占的不是一個工時, 是他清單上的一格。**
```

### ② 而它自己要求的「只複量」,我做了 —— **而它正好證明了它自己教的那一課**
```
🔬 讀數時刻(寫在數字旁邊, 這正是本列的教訓):2026-09-19 20:16:48 UTC(= 台北 09-20 04:16)
🔬 public 底下函式:**265 支**(prokind: 一般 265 · procedure 0 · 聚合 0 · 視窗 0)
   ⛔ 09-07 讀數 204 · ⛔ 09-08 複量 206 ⇒ ✅ **今天 265**
   ⇒ 🎯 **十二天長了 59 支。** 而本列逐字警告過:「**這個數會長, 引用前重跑。**」
🔬 owner 分佈:**postgres 265 支, 一支不漏** ⇒ **零個 supabase_admin 擁有的函式**
🔬 public 底下非函式物件(表/view/序列/分割表):**postgres 122 個**(09-07 是 102)⇒ 同樣全部 postgres
🟢 對照組(同一把尺量一個【穩定的大數】):pg_catalog 函式 **3,319**
   ⇒ 📌 **與 2026-09-08 那一次的讀數逐字相同** ⇒ 尺沒變, 那個 +59 是【真的成長】不是口徑差
⚪ 負對照:現造 schema `pcm_zzq_not_real` ⇒ 0
```
⇒ ✅ **本列的核心結論今天仍然成立**:那組全開的預設權限**現在打不到任何東西**,
因為 `public` 底下**沒有一個物件是 `supabase_admin` 擁有的**。

🛑 **而「仍然成立」與「不會變」是兩件事** —— 只要有人用 `supabase_admin` 建一個物件,
那組預設就立刻有受詞。**而今天沒有任何東西會在那一刻叫。**
⇒ 📌 那才是這一列真正的內容,而它**不需要 Sean**。

## §26 ⟦db-REVIEWLEFTNOTRACE⟧ —— 「卡在 Sean」而 **(a) 已經被裁過不做 (b) 那題不是他的**

```
🔬 板列 2026-09-12 那一格逐字:
   「⟨2026-09-12 · **主視窗裁甲:不寫那份文件** · 卡在:🧑Sean ——
     關閉條件②『什麼算核過』要他拍, **且那份文件本身是一條規則 ⇒ 減法期(CLAUDE.md「不寫規則」)不做**
     · 本列維持 open⟩」
```
⇒ 🔴 **同一個括號裡寫了兩件互相抵銷的事**:「主視窗裁甲**不做**」與「**卡在 Sean**」。
⇒ 🎯 **已經裁了不做的事,不會再卡在任何人身上。**

**而第二個理由是新的篩法問出來的 ——「他答得了嗎?」**
```
🔬 關閉條件② 逐字:「而那要一個判準 —— **什麼算『核過』**」
🔴 而 Sean 2026-09-19 劃線(memory project_0919-sean-scope-of-his-decisions)逐字:
   「只管【他會看到 / 員工會看到 / 客人會用到看到】的」
⇒ 🎯 **「什麼算核過」是【我們內部的工程判準】** —— 客人看不到、員工看不到、他也看不到。
⇒ 📌 **那不是「等他」, 是【填錯收件人】。**
```

🔵 **而本列自己量過一個很好的數,值得留著**(2026-09-10):
```
~/pcm-mailbox/貼板-*/*.sql 共 284 支 · 章裡指得到一個【章以外落點】的只有 35 支(12.3%)
⇒ 249 支(87.7%)指不到
🟢 正對照:同尺數含 SELECT 的 ⇒ 281/284 ⇒ 尺會咬
🛑 而它自己標明「249 是【上界】不是實例數」—— 判準是「有沒有提到一個 .md 路徑」,
   不是「寫了一個複驗不了的結論」
```
⇒ 📌 **那一格【自己把自己的數字降級成上界】** —— 那正是本列在講的病的反面示範:**它的過程留下來了。**

🛑 **而本列仍然 open 是對的**(病還在),我只動那句「卡在 Sean」。
