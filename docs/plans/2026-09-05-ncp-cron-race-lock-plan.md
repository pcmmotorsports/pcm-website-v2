# Plan · ⟦b4-NCPCRONRACE⟧ —— 逾期取消與收款落帳搶同一張單

> 線【資料】`-db` 2026-09-05 · **只寫 plan, 一行碼都沒動**(鐵則 8 等批)。
> 板列:`docs/launch-todo.md` 的 `⟦b4-NCPCRONRACE⟧`(用 `bash scripts/board-row-by-anchor.sh` 定位, 不寫行號)。

> ## 🔴🔴 **結論(codex 關卡 1 之後改寫):這一片【還不能動手】**
>
> 送審前我的結論是「做法清楚, 可以開工」。codex 提 **7 條 must-fix**, 而其中兩條
> **不是把做法改好, 是把做法【推翻】**:
> ```
> ① CTE 與 UPDATE 是【同一句 SQL】⇒ 中間插不進 PERFORM
>    ⇒ 整個「選完再拿鎖」的寫法要重畫(§2 已改寫成三段, 而它引入一個新的不變式)
> ② 「B 從不持有列鎖 ⇒ 不會死結」是【假的】
>    ⇒ B 的 FK 先拿 KEY SHARE, 而 A 是 FOR UPDATE ⇒ 兩者衝突 ⇒ **環是可能的**
>    ⇒ 🔴 而死結分析是【動手前的前置條件】, 不是驗收項
> ```
> **⇒ 動手前還要答三個問題, 而它們今天都沒有答案**:
> 1. **那四張鎖圖**(A↔B · B↔B · A↔A · A↔後台手動取消)—— 環存不存在?
>    存在的話 A 要改成「先 advisory 再列鎖」, 而那會改變 `SKIP LOCKED` 的語意。
> 2. **「拿鎖後重驗那五個條件」怎麼保證兩處逐字相同**(§2a 那支鍵函式解了鍵, 沒解述詞)。
> 3. **A 一輪持鎖多久** —— 因為 B 被擋住的代價不是「慢」而是**客人的付款可能失敗**
>    (`statement_timeout` + `WHEN OTHERS` 接不住 `57014`)。
>
> 🛑 **而我送審時就在 §2b 標紅懷疑過第一格** —— 📌 **標了懷疑不等於解決它**,
> 　 而我把它寫成「⚠️ 這句是推理不是實測」之後, 就繼續往下寫了。
> 　 ⇒ **一個誠實的「我不確定」標記, 不會阻止我照著那個不確定的東西繼續蓋。**

## 1. 病灶(逐字讀來的, 附座標)

codex 對抗審查 2026-09-04 逐字(`supabase/migrations/20260904230000_…:294`):
> 「cron 先取得 `FOR UPDATE` 時, 收款 INSERT 會在 FK `KEY SHARE` 等待;
>   cron 先取消後, 收款才落帳, 最終可形成【已取消但淨收款 > 0】。」

### 🔴 而兩條路拿的是【兩把不同的鎖】—— 這是本片的全部

```
路 A(逾期取消)  20260904230000:493   FOR UPDATE OF o SKIP LOCKED   ← 鎖的是 orders 那一列
路 B(收款落帳)  20260904230000:201   pg_advisory_xact_lock(hashtextextended(order_id::text, 0))
                                                                    ← 鎖的是一個【號碼】
```
📌 **兩把鎖互相看不見。** A 拿了列鎖, B 照樣拿得到 advisory;B 拿了 advisory, A 照樣拿得到列鎖。
🛑 而 B **刻意不用列鎖**, 理由寫在 `:198-199`:那筆 INSERT 的 FK 已對同一列持有 `KEY SHARE`
　 ⇒ 升級成 `FOR UPDATE` **會死結**。⇒ 🔴 **所以「讓 B 也拿列鎖」這條路是死的, 不要走。**

### 🔴 而原本以為的安全網【不存在】(板列已作廢那句)

`20260902030000:237` 那支 trigger 掛 `orders` 的 AFTER UPDATE, 資料來自
`pcm_pending_refund_amounts(NEW.id)` —— 它**當下**算 `order_payments`。
而本競態的時序是**取消先提交、收款之後才落帳** ⇒ 取消那一刻 `order_payments` 零列
⇒ **一列待退款都不開**, 連那句 `RAISE WARNING` 也不會響。
⇒ 📌 **那筆錢不會被記在任何地方。**

## 2. 做法:讓路 A 也拿【同一把 advisory】

🔴🔴 **[codex 關卡1 must-fix]:`WITH target … UPDATE … FROM target` 是【同一句 SQL】**
　 ⇒ **中間插不進 `PERFORM`**(`20260904230000:493-500` 逐字可讀)。
　 ⛔ ~~「CTE 選出 target 之後、UPDATE 之前 PERFORM」~~ —— **那句話在 plpgsql 裡做不到。**
　 📌 **而我自己在送審時就標紅懷疑這一格** —— 標了懷疑不等於解決它。

✅ **改寫成三段**(選 ⇒ 逐張拿鎖 ⇒ 再選一次並改):
```sql
-- ① 選一批(FOR UPDATE SKIP LOCKED 照舊)—— 只拿 id, 不改任何東西
FOR r IN
  SELECT o.id FROM public.orders o
   WHERE <原本那五個條件>
   ORDER BY o.created_at, o.id            -- 🔴 加 o.id:見 §2c, created_at 不是全序
   LIMIT p_limit
   FOR UPDATE OF o SKIP LOCKED
LOOP
  -- ② 逐張拿 advisory(順序 = 上面那個全序)
  PERFORM pg_advisory_xact_lock(public.pcm_order_lock_key(r.id));

  -- ③ 🔴 **拿到鎖之後【重新驗一次條件】** —— 這是本改寫的核心:
  --    拿鎖前後之間, 路 B 可能已經把錢寫進去並翻了狀態。
  --    ⇒ UPDATE 自己帶上那五個條件, 不是無條件改。
  UPDATE public.orders o
     SET cancelled_at = now(), cancelled_reason = 'payment_expired', updated_at = now()
   WHERE o.id = r.id AND <原本那五個條件, 逐字相同>;
END LOOP;
```
🛑 **③ 那一段是【新的】不變式** —— 舊寫法的 CTE 一選完就改, 而新寫法在拿鎖後再驗一次。
　 ⇒ 少了它, 這個改寫**只是把競態往後移了幾毫秒**。
⚠️ 而「那五個條件逐字相同」要有機制:抽成一支 `IMMUTABLE` 述詞函式, 或**兩處都指向同一段註解 + 一格測試比對**。
　 🔴 **這一格 plan 沒有解** —— 它是實作時的第一個決定。

### 2a. 🔴 鍵必須逐字相同 —— 而這是本片最容易錯的一格
`hashtextextended(p_order_id::text, 0)` 的三個部分都承重:
- `::text` —— 🔵 **[codex 關卡1 nit 訂正]** uuid 直接餵**不是** `hashtextextended` 的另一個多載,
　 它的原生函式叫 `hashuuidextended` —— **仍然是另一把鎖**, 而我原本那句話的理由講錯了。
　 ⇒ 結論不變(要 `::text`), 而**理由要對**, 否則下一個人照那個理由推別的東西會推錯。
- `, 0` —— seed 不同 ⇒ 不同的鎖
- 函式名 —— `hashtext`(32-bit)與 `hashtextextended`(64-bit)是**兩把不同的鎖**
🛑 **⇒ 兩邊的鍵不得各寫一份。** 抽一支 `IMMUTABLE` 函式當單一來源
　 (照 `pcm_js_trim_whitespace` 的成例 —— 那支就是為了同一個病建的):
```sql
CREATE FUNCTION public.pcm_order_lock_key(p_order_id uuid) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$ SELECT pg_catalog.hashtextextended(p_order_id::text, 0) $$;
```
⇒ 兩條路都改成 `PERFORM pg_advisory_xact_lock(public.pcm_order_lock_key(<id>));`

🔴 **[codex 關卡1 must-fix]:新函式的權限 plan 原本沒寫。**
　 本 repo 的新 DB 物件**出生就帶 `PUBLIC EXECUTE`**(`docs/patterns/revoking-function-execute-in-supabase.md`)
　 ⇒ 要四道 REVOKE(PUBLIC / anon / authenticated / service_role+payment_confirmer)
　 + **事後斷言用 `aclexplode` 白名單**(黑名單跟下一個沒想到的角色賽跑;而 `proacl IS NULL` 要單獨守)。
　 🔵 而它**不需要給任何人** —— 它只被那兩支函式的本體呼叫, 而那兩支是 SECURITY DEFINER。
✅ **而「兩邊一致」從此不是靠人記得, 是結構上做不到不一致。**

### 2b. 拿鎖的【點】—— 順序決定會不會死結
```
路 A:CTE 選 target(FOR UPDATE OF o SKIP LOCKED)⇒ 拿列鎖
     ⇒ 然後才 PERFORM advisory
路 B:先 advisory ⇒ 然後才 SELECT/UPDATE orders(它不拿列鎖)
```
⛔ ~~**B 從不持有列鎖 ⇒ 不存在環 ⇒ 不會死結**~~
🔴🔴 **[codex 關卡1 must-fix]:那句是【假的】。**
　 B 在 trigger 跑之前, 那筆 `INSERT INTO order_payments` 的 **FK 已經對 `orders` 那一列持有 `KEY SHARE`**;
　 而 B 後續還可能 `UPDATE orders`(翻狀態)⇒ **B 確實持有列鎖, 而且是先拿列鎖再拿 advisory。**
　 ⇒ 📌 **A 與 B 的拿鎖順序【相反】** —— A 是「列鎖 → advisory」, B 是「KEY SHARE → advisory」…
　 　 而 `KEY SHARE` 與 `FOR UPDATE` **互相衝突** ⇒ 環是有可能的。

🔴 **⇒ 死結分析要重畫, 而它是實作前的【前置條件】不是驗收項**:
```
要畫的四張鎖圖(每一張都要寫出【誰先拿什麼、誰等什麼】):
  A ↔ B        A 拿 orders FOR UPDATE, B 的 FK 要 KEY SHARE ⇒ B 等 A
               而 A 接著要 advisory, B 若已持有 advisory ⇒ A 等 B ⇒ 🔴 環
  B ↔ B        兩筆收款進同一張單(既有 advisory 已處理)
  A ↔ A        兩個 cron 實例(見 §2c)
  A ↔ admin    後台手動取消那條路(它也 UPDATE orders)—— 🔴 plan 原本【漏了這一條】
```
🛑 **⇒ 若那個環成立, 本 plan 的做法要改**:可能要讓 A 也走「**先 advisory 再列鎖**」,
　 而那會讓 `SKIP LOCKED` 的語意改變(見 §2d)。**這一格沒有解之前不要動手。**

### 2c. 一輪內多張單:advisory 要逐張拿, 而順序要固定
路 A 一輪最多 `p_limit` 張。若兩個 cron 實例同時跑(重試 / 手動補跑),
兩邊各自對一批單逐張拿 advisory ⇒ **拿的順序不同就會死結**。
⛔ ~~CTE 已經 `ORDER BY o.created_at` ⇒ 沿用同一個順序~~
🔴 **[codex 關卡1 must-fix]:`created_at` 不是【全序】** —— 同一毫秒建立的兩張單,
　 兩個實例可能拿到**相反的順序** ⇒ 死結。
✅ 改成 `ORDER BY o.created_at, o.id`(`id` 是 PK ⇒ 全序)。
🛑 而 `SKIP LOCKED` 只跳過**列鎖**被別人持有的, 不跳過 advisory
　 ⇒ 兩個實例仍可能選到同一批 ⇒ 順序這一格承重。

## 3. 失敗世界(每一個都要有處置)

| 世界 | 會發生什麼 | 處置 |
|---|---|---|
| A 拿不到 advisory(B 正在算) | A 那一張**等** | 🔵 對:等的是毫秒級, 而它換到的是正確性 |
| 一輪 50 張其中一張等很久 | 整輪拖長 ⇒ 可能撞 `statement_timeout` | 🔴 **整輪回滾** —— 與 `⟦b4-SETTLERETRYNEVER⟧` 同一個形狀。下一輪重做, 不會漏 |
| B 拿不到(A 正在取消一批) | 收款那筆 INSERT **等** | 🛑 **本片最貴的一格, 而 plan 原本說「只慢毫秒」—— 那句沒有證據**(codex 關卡1)。實際上 B 可能**先卡在 FK 的 KEY SHARE**, 而 `statement_timeout` 會讓**整筆付款 INSERT 回滾**;而既有的 `WHEN OTHERS` **接不住 57014**(`20260904230000:189-191`)⇒ 🔴 **客人的付款失敗, 而不是變慢。** ⇒ 這一格要在實作前量:A 一輪持鎖多久 |
| 兩個 cron 實例同時跑 | 見 §2c | 順序固定 ⇒ 不死結 |
| advisory 拿了而交易 rollback | `xact` 版自動釋放 | 🔵 不需要(也不可能忘記)解鎖 |

## 4. 回退

本片**不新增表、不改既有欄位** ⇒ 回退 = 把兩支函式各自 `CREATE OR REPLACE` 回上一代
+ `DROP FUNCTION public.pcm_order_lock_key(uuid)`。
⛔ ~~先退兩支函式, 再 drop 那支鍵函式(反過來會因相依而失敗)~~
🔴 **[codex 關卡1 must-fix]:那個「會因相依而失敗」不可靠** ——
　 `$$…$$` 函式本體裡的呼叫**不一定記進 `pg_depend`** ⇒ **DROP 可能直接成功**,
　 而兩支呼叫端要到**執行期**才爆(而那是 cron 半夜跑的時候)。
✅ 順序照舊(先退兩支、再 drop), 而**加一道事前斷言**:
```sql
-- drop 之前:確認沒有任何函式的本體還提到它
SELECT count(*) FROM pg_catalog.pg_proc p
 WHERE pg_catalog.pg_get_functiondef(p.oid) LIKE '%pcm_order_lock_key%'
   AND p.proname <> 'pcm_order_lock_key';   -- 該 0
```
⚠️ 而**退回去就是退回今天這個競態** —— 回退不是「沒事了」, 是「換回舊的那個風險」。

## 5. 驗收:並發探針(這一片沒有它等於沒做)

🔴 **單執行緒的測試對這一片零判別力** —— 競態要兩條連線同時跑才看得見。

```
拋棄式 PG, 兩條連線:
  🔴 **[codex 關卡1 must-fix:原本這段的時序是錯的]**
     ⛔ ~~改之前連線2 不會擋~~ —— **連線1 已持有 `FOR UPDATE`, 連線2 的 FK 要 `KEY SHARE`
       ⇒ 它【本來就會被擋】**。⇒ 那個「改之前」的預期是假的, 而照它做會得到一個假的綠。
  ✅ **正確的時序是【反過來】**(那才是病灶的真實形狀 —— 取消先提交、收款之後才落帳):
  ① 連線1 BEGIN; 呼叫 expire_unpaid_orders(選到單 X); **COMMIT**   ← 取消先落地
  ② 連線2 BEGIN; INSERT order_payments(X, 全額); COMMIT            ← 收款之後才來
  ③ 直接查結果(不看有沒有擋):已取消而淨收款 > 0 的單數
     · 改之前 ⇒ **1**(病)   · 改之後 ⇒ **0**
  🔴 **而改之後為什麼會是 0, 要說得出機制** —— 不是「advisory 擋住了」(連線1 已提交, 鎖早放了),
     而是 **③ 那段「拿鎖後重驗條件」讓取消不會發生**, 或收款那側看到已取消而走另一條路。
     🛑 **這一格 plan 答不出來** ⇒ 它是實作前要先想清楚的第二件事。
  ④ **另一個時序也要測**(兩者都要):連線2 先 INSERT 不提交, 連線1 才跑 cron
  ⑤ 釘住【等在哪一種鎖上】:`pg_locks` 的 `locktype`(`advisory` vs `tuple`/`transactionid`)
     —— 只看「有沒有等」分不出它等的是我們新加的鎖還是本來就有的 FK 鎖
  ④ 🟢 正對照:兩條連線操作【不同的單】⇒ 不得互相擋(否則是鎖太寬)
  ⑤ 🔵 負對照:把 pcm_order_lock_key 改成回常數 ⇒ 所有單共用一把鎖
     ⇒ ④ 那格會紅 ⇒ 證明 ④ 有判別力
```
🛑 **而「已取消而淨收款 > 0」這個結果要【直接查出來】**, 不要只看有沒有擋住:
```sql
SELECT count(*) FROM public.orders o
 WHERE o.cancelled_at IS NOT NULL
   AND (SELECT coalesce(sum(p.amount),0) FROM public.order_payments p
         WHERE p.order_id = o.id) > 0;
```
改之前該 **1**, 改之後該 **0**。

## 6. 🛑 這份 plan 證不到什麼

- **零 apply、零 migration** —— 上面每一段都是讀碼與推理, 只有座標是量到的。
- §2b「不會死結」是**推理**;§5 的探針是為了把它變成量測。**在跑之前它只是一句話。**
- **「這件事發生過幾次」我答不出來** —— `orders` 全表今天 1 張單(`⟦b4-SETTLERETRYNEVER⟧` plan §5b 量過)
  ⇒ 那個 0 的成因是分母。🔴 **不得讀成「沒發生過」。**
- 本片**不處理已經發生的那些單**(若有)—— 那是資料修復, 另一件事。
- 鐵則 12①③(錢 + DB 結構)⇒ **commit 前 codex 對抗審查, 不降級。**
