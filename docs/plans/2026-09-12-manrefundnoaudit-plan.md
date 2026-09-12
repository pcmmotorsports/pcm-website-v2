# plan · ⟦b4-MANREFUNDNOAUDIT⟧ 人工退款不進稽核 —— 「誰做的」不在事後查的人會去的那個地方

> ⛔ ~~標題原本寫「誰把狀態改成已退款查不出來」(板列的說法)~~ —— **量過之後不成立**,見 §0。

> 2026-09-12 · 窗 B(`~/pcm-ops`)· **只寫 plan,零改動、零貼板。**
> 🔴 鐵則 8(動 schema / 新 DB 物件)+ 鐵則 12①(錢)⇒ **等 Sean 批才實作**;實作那一顆 commit 前二審。
> 板列:`bash scripts/board-row-by-anchor.sh b4-MANREFUNDNOAUDIT`

---

## 0. 🧑 給 Sean 的一頁

**現在**:員工在後台登記一筆「我用現金/匯款退給客人了」,系統會把訂單改成**已退款**,
而**稽核紀錄(`admin_audit_log`)裡一列都沒有**。

🔴 **而「查不出來誰做的」這句話【比事實嚴重】—— 我第一版照板列寫,量了才知道寫錯:**
`order_manual_refunds` 這張表**自己存了 `actor` / `voided_by` / `request_id`**,
而今天那 2 筆的 `actor` **都有值**(唯讀量到,見 §1)。
⇒ ✅ **正確的說法**:「誰做的」查得到,**而它不在大家會去查的那個地方** ——
　 後台〈稽核紀錄〉那一頁、以及任何拿 `admin_audit_log` 做事後對帳的人,**看不到這件事發生過**。
⇒ 📌 嚴重度因此下降一級:這不是「證據不存在」,是「證據不在證據該在的地方」。

**而這不是漏掉,是當初就知道**:那支函式的說明自己寫著「沒有 actor、不寫 audit」,
並且交代「下一片必須補上」—— **那一片沒有做**。

**改完之後你會看到**:後台〈稽核紀錄〉多出兩種動作 ——
「登記人工退款」與「作廢人工退款登記」,每一筆帶**誰**、**哪張單**、**多少錢**、**哪一軌**(現金/匯款)、
**改前改後的付款狀態**。今天已經有的那 2 筆要不要回填,見 §6 / §7。

**要你決定的只有一件**(§7):**舊的那 2 筆要不要補稽核** —— 而因為 `actor` 有值,
補的那一列**可以是真的**(不是編的)。我推薦**補**,並在該列明寫它是事後補的。

---

## 1. 現在到底記了什麼 / 沒記什麼(檔:行 + 正式庫唯讀讀數)

**正式庫唯讀(2026-09-12,`bash scripts/readonly-prod-sql.sh`)**
```
order_manual_refunds                    2 列(未作廢 1)· 欄位含 actor / voided_by / request_id
  · actor 非空 2 列(相異值 1 個)· voided_by 非空 1 列 · request_id 非空 2 列
  ⇒ 🔴 **「誰做的」今天查得到 —— 在這張表裡, 不在 admin_audit_log 裡**
admin_audit_log 總列                    155
稽核裡與退款有關的 action(相異)        order_refund.initiate / finalize / correct_verdict / unknown_state
                                        ⇒ 🔴 **四個全是【卡片退款】那條線的,人工退款 0 列**
⚪ 負對照 現造 action 名                 0        🟢 正對照 整表 155 ⇒ 尺是活的
```
**三支函式今天的實況(唯讀問 `pg_get_functiondef` / `prosecdef`)**
```
admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz,boolean)
      audit=false · SECURITY DEFINER · 會呼 sync helper
admin_void_manual_refund(uuid,text,text)
      audit=false · SECURITY DEFINER · 會呼 sync helper
pcm_sync_order_refund_payment_status(uuid)
      audit=false · SECURITY DEFINER · **沒有 actor 參數**
🟢 正對照 admin_cancel_order(...)  audit=true ⇒ 「有沒有寫 audit」這把尺分得出來
```
**⇒ 三支都收得到 `p_actor`(前兩支),而沒有一支把它寫進稽核。**

### 🔴 而碼裡有兩句話說的是相反的事(字面 vs 事實)
```
apps/admin/src/lib/payment/manual-refund-actions.ts:33    逐字「本檔沒有一行稽核 code —— RPC 同交易寫 admin_audit_log(D1 header 段)」
apps/admin/src/lib/payment/manual-refund-repository.ts:12 逐字「稽核由 RPC 同交易寫(D1 header 段自陳),本層不碰 admin_audit_log」
```
🛑 **兩句都不成立**(上面的 `audit=false` 是唯讀量到的)。
📌 **它們不是無害的註解**:下一個人讀完會以為這件事有人做了 ⇒ **本片要順手把這兩句改對**,
否則修完 DB 而註解還在騙人。

### 🔵 而板列說的「那段碼自己指定了要補」確實存在
`supabase/migrations/20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql:33-40` 逐字:
「而這個修正【零留痕】—— 片3 之前沒有 audit」·「helper 的 COMMENT 逐字『沒有 actor、不寫 audit』」·
「⇒ **片3 的任務清單必須含一格:helper 加 audit 寫入**」。

---

## 2. 打算怎麼改(而**不是**改 helper)

| 步 | 動作 | 落點 |
|---|---|---|
| A | `admin_record_manual_refund` 內、成功寫入 `order_manual_refunds` 之後,同交易 `INSERT admin_audit_log` | 新 migration(改 `20260909090000` 那一代的 body) |
| B | `admin_void_manual_refund` 同款 | 同一支 migration(改 `20260905440000` 那一代的 body) |
| C | 兩處各加一道 `GET DIAGNOSTICS … ROW_COUNT <> 1 ⇒ RAISE`(照 `20260908060000:730-734` 既有形狀) | 同上 |
| D | 把 `manual-refund-actions.ts:33` 與 `manual-refund-repository.ts:12` 兩句話改成事實 | 2 支 TS |
| E | 板列關閉條件② —— 回退包 §4-f 的前提與 helper COMMENT 對齊(改 COMMENT,不改 helper 行為) | 同一支 migration |

### 🔴 為什麼不是照板列寫的「helper 加 audit」
`pcm_sync_order_refund_payment_status(uuid)` **沒有 actor 參數**,而它是被**兩支不同的呼叫端**呼叫的。
要它寫稽核就得加參數 ⇒ 動它的簽章 ⇒ 兩支呼叫端與所有既有代同時要改。
⇒ ✅ **改成在【兩支收得到 actor 的 RPC】裡寫** —— 它們本來就知道「誰」,而 helper 不知道。
🛑 **代價要明寫**:任何**繞過那兩支 RPC、直接呼 helper** 的路徑仍然零稽核。
　 今天 repo 內呼叫 helper 的只有那兩支(唯讀量到,見 §1),**而那是今天的分母,不是保證**。

### 動作名(與既有命名同族)
```
order_refund.manual_record   target = order:<uuid>
order_refund.manual_void     target = manual_refund:<uuid>
before/after = jsonb_build_object('payment_status', <改前>, …) / (…, 'manual_refund_id', …, 'rail', …, 'amount', …)
```
🔵 `reason` 用員工填的退款原因 / 作廢原因(那兩格本來就有值、已進 DB)。
🔴 **金額寫整數分位**(與 `order_manual_refunds.refund_amount` 同一個單位),不轉字串、不加符號。

---

## 3. 新 migration:版本號 · SECURITY DEFINER · 授權

```
版本號   20260912040000_m4b_manrefundnoaudit_rpc_writes_audit.sql
         (repo 內 20260912 已用 010000 / 020000 / 030000 ⇒ 040000 空;貼之前再 grep 一次)
形狀     CREATE OR REPLACE FUNCTION ×2(兩支都已存在)+ COMMENT ×1(E 那格)
         🛑 **不是新建物件** ⇒ 不必走 `docs/patterns/revoking-function-execute-in-supabase.md` 的建檔流程,
            而**那份檔的另一半仍然適用**:`CREATE OR REPLACE` 會把 `SET` 子句整組換掉
            (memory `reference_create-or-replace-resets-set-clause`)⇒ 🔴 **原本的 `SET search_path=''` 要逐字抄回去**。
SECURITY 兩支今天已是 DEFINER ⇒ **維持 DEFINER,不改**。理由:它們要寫 `admin_audit_log`,
         而那張表對呼叫端角色不開放寫入(與 `admin_cancel_order` 同款)。
EXECUTE  **不動**。本片不加不減任何 GRANT ⇒ `acl-drift-gate` 那條路不會被觸發。
         ⚠️ 而「不動」要用**貼後唯讀複驗**證,不是用「我沒寫 GRANT」宣稱(見 §5)。
冪等     `CREATE OR REPLACE` 本身可重跑;本片**零 DML** ⇒ 不需要 `-- pcm:idempotent: yes`
         (判準:`bash scripts/apply-paste-board.sh --check-dml <檔>` 期望 rc=0)。
```

---

## 4. 改完之後,員工與 Sean 看得到什麼不同

```
員工      後台〈稽核紀錄〉那一頁多兩種動作;中文字面要同批加進
          apps/admin/src/lib/audit/audit-field-label.ts(欄名與值),
          否則畫面會印英文欄名 —— 那是 2026-09-12 ⟦b4-AUDITNULLAMBIG⟧ 剛踩過的同一個坑。
Sean      「這筆退款是誰登記的」從【要去翻 order_manual_refunds 才查得到】
          變成【後台稽核那一頁就看得到】。
          🛑 而**只對新的那些成立** —— 舊的 2 筆要不要回填是 §7 那一題。
沒有變的  退款金額、狀態流轉、可退餘額、畫面按鈕 —— 本片**一格都不動**。
```

---

## 5. 驗收(寫死,做的時候不准改)

```
① 好世界   登記一筆人工退款 ⇒ admin_audit_log 多【恰好 1 列】, actor = 登入的那個人,
           before.payment_status 是改前的值、after 帶 manual_refund_id / rail / amount
② 壞世界   把那段 INSERT 拿掉 ⇒ ①必須紅(否則①在兩個世界都會過)
③ 作廢     作廢一筆 ⇒ 另一列 order_refund.manual_void, 而登記那一列【不動】(append-only)
④ 交易性   讓 audit INSERT 失敗(例如餵一個超長 action)⇒ **整筆回捲**:
           order_manual_refunds 不得留下那一列 ⇒ 證明「錢的紀錄與誰做的」同生同死
⑤ 授權面   貼後唯讀複驗:兩支的 proacl 與貼前逐字相同(⚠️ 見 §3「不動」那一格)
🔴 ①-④ 在拋棄式 PG 上跑(`scripts/migrations-replay-from-zero.sh` 那套),**不碰正式庫**。
```

---

## 6. 既有資料怎麼辦

```
今天 2 筆(未作廢 1)—— 而它們的「誰做的」**補得出真值**:
  · order_manual_refunds.actor 兩列都有值 · voided_by 1 列 · request_id 2 列
  ⇒ 回填的來源是【那張表自己】, 不是我們編的
⚠️ 而補不回來的是【時間精度以外的東西】:當時的 before.payment_status 沒有第二份來源
   ⇒ 回填那兩列的 before 要寫 null 並明標「事後補、改前狀態不可考」, 不可填一個推出來的值。
```
⛔ ~~我第一版寫「補不出真值 ⇒ 不回填」~~ —— **那建立在「沒有 actor 欄」這個【我沒量就寫下的前提】上**,
量了之後前提不成立。📌 **一個 plan 的建議可以是對的而理由是假的;這一次是兩個都要改。**

---

## 7. ❓ 要 Sean 回的(只有一題)

```
Q:今天那 2 筆人工退款,要不要回填稽核?(actor 有值 ⇒ 補的是真值,不是編的)
A:甲 = 補(推薦)—— 來源是 order_manual_refunds 自己的 actor / request_id,
       而那一列要明標 reason='事後補(20260912);改前付款狀態不可考'、before=null。
   乙 = 不補 —— 理由是 append-only 的表只放「當下寫下的」, 事後補會讓兩種列混在一起;
       想查的人改去查 order_manual_refunds。
🔵 兩邊都成立, 差別是【你希望事後查的人只看一個地方, 還是接受看兩個地方】。
```

---

## 8. 影響 / rollback / 曝險

```
影響    2 支 DB 函式(改 body, 不改簽章)+ 2 支 TS 註解 + 稽核中文字典。零資料遷移、零 GRANT。
rollback  supabase/rollbacks/20260912040000-rollback.sql = 把兩支的 body 換回貼前那一版
          🔴 **回捲檔要內含完整 body**(不可寫「請去某檔複製」—— Sean 2026-09-11 Q4 甲逐字)。
          ⚠️ 回退之後**已經寫下的稽核列不會消失**(append-only)⇒ 那是對的, 不要清它。
曝險    貼 migration 到應用層改註解之間:**零** —— 本片 DB 端自己完整,TS 那半只是把話改對。
        🔴 反過來(先改註解後貼)也不會壞,只是那段時間註解比事實樂觀 ⇒ **建議 DB 先**。
```

## 9. 🛑 這份 plan 證不到什麼

1. **我沒有實跑那兩支 RPC** —— 上面「會寫/不寫 audit」全部來自 `pg_get_functiondef` 的字面比對與 `prosecdef`,不是行為觀察。
2. **「只有那兩支呼叫 helper」是 repo 內的分母** —— 正式庫裡有沒有別的函式/trigger 呼它,我用 `pg_get_functiondef ilike` 掃過四支點名的,**沒有全庫掃**。
3. ⛔ ~~那 2 筆舊資料是不是真的沒有 actor 欄~~ ⇒ **量了:有欄、有值**(§1)。
   🔴 **而這一格原本是我【沒量就寫進 plan 的斷言】** —— 它撐著 §6 與 §7 的整個建議,
   而兩者都因此寫反。📌 **一份 plan 裡最貴的不是不知道, 是把沒量的當成量過的。**
4. 讀數是 2026-09-12 那一發;**人工退款隨時可能多一筆**,而多一筆的那一刻沒有訊號。
