# Probe · PostgREST 收不收 `not.in.(a,b)` —— 2026-09-13 B 窗實跑

> **為什麼有這支檔**:`SupabaseEmailOutboxAdapter.claimDue` 的排除清單,
> 在 2026-09-01 被逐字寫成「`'in'` + 括號字串**沒有任何一次被證明過 PostgREST 收**」
> ⇒ 於是 ≥2 個時不下查詢層、改在 app 層濾 ⇒ 被排除的列**佔掃描窗**
> ⇒ codex 2026-09-13 R2 must-fix 3:**活信會被擠出窗外, 而沒有錯誤碼。**
>
> 🛑 **要修它就得先把那句「沒被證明過」變成「證明過了」** ——
> 而猜錯文法的後果寫在同一支檔裡:`claimDue` throw ⇒ **連付款成功信都不寄, 每 5 分鐘一次。**
>
> ⇒ 📌 **本檔就是那個證明。** 環境照 `docs/runbooks/throwaway-postgres-for-migration-verification.md`
> §1(拋棄式 PG)+ §3(真的 PostgREST)起的 —— 指令是**從 runbook 貼的, 不是打的**。

---

## 環境(可複現)

```
PostgreSQL 17.10 (Homebrew) · initdb --encoding=UTF8 --locale=C · LC_ALL=C
postgrest(Homebrew)· db-schemas=public · db-anon-role=anon · jwt-secret 自造
client = 本 repo 自己的 @supabase/postgrest-js 2.105.3(不是手拼 URL)
```

🔵 **fixture**(六列,刻意讓每一種斷言都有分母):

| id | event_type | status |
|---|---|---|
| a | order_created | pending |
| b | order_shipped | pending |
| c | shipment_tracking_corrected | pending |
| d | bank_order_amount_changed | pending |
| e | bank_order_created | failed |
| f | order_created | **sent**(不可認領 ⇒ 恆不該出現) |

查詢固定帶 `.in('status',['pending','failed']).lte('next_retry_at', now)`
⇒ **正對照 = a b c d e(五列)**,而 `f` 一次都沒出現過 ⇒ 那兩個過濾條件是活的。

## 結果(逐格,`@supabase/postgrest-js` 打出來的)

| # | 呼叫 | 期望 | 實得 |
|---|---|---|---|
| ① | 無排除 | a b c d e | ✅ `["a","b","c","d","e"]` |
| ② | `.neq('event_type','order_shipped')` | a c d e | ✅ `["a","c","d","e"]` |
| ③ | `.not('event_type','in','(order_shipped,shipment_tracking_corrected)')` | a d e | ✅ `["a","d","e"]` |
| ④ | `.not(… 三個 …)` | a e | ✅ `["a","e"]` |
| ⑤ | `.not('event_type','in','(order_shipped)')` | a c d e | ✅ `["a","c","d","e"]` |

## 🔬 負對照(**沒有這兩格,上面五個綠證不到東西**)

```
.not('event_type','zzz','(order_shipped)')  ⇒ 400 PGRST100
   "failed to parse filter (not.zzz.(order_shipped))" (line 1, column 5)
.not('event_type','in','order_shipped')     ⇒ 400 PGRST100   ← 少括號
   "failed to parse filter (not.in.order_shipped)" (line 1, column 8)
```
📌 **兩格都真的 400** ⇒ 這條管線會因為文法錯而叫
⇒ 所以上面那五個 200 是「文法對」,不是「這條路沒被走到」。

## 🔴 意外的一格 —— 空清單**不是語法錯**

```
.not('event_type','in','()')  ⇒ 200 · a b c d e【全回】(連一列都沒濾掉)
```
⛔ `SupabaseEmailOutboxAdapter.test.ts` 原本逐字寫著「空的 `not in ()` 給 PostgREST 是**語法錯**,
它會炸」—— **那句話是錯的**(那支檔先前已經被 codex 標過「誇大」,而**方向也錯了**)。

⛔ ~~我第一版把這一行寫成「**六列**全回」~~ —— 🔴 **那個分母是錯的**(codex 2026-09-13 nit):
fixture 是六列,而 `f` 的 status 是 `sent` ⇒ 它**本來就被 status 條件濾掉**,
和 `not.in` 一點關係都沒有。⇒ 📌 **正確的讀法是「那五列一個都沒被 `not.in` 濾掉」** ——
寫成六會讓下一個人以為這一發連 status 條件都失效了,而那是另一種壞法。

⇒ 🔵 **`exclude.length` 那道守門仍然要留, 而理由換了**:
舊理由是「不炸」,新理由是**不要送一句什麼都不做的過濾** ——
📌 一個 no-op 過濾在查詢字串與 log 上**看起來像一道生效的閘**,而它什麼都沒擋。

## 🛑 這支 probe 證不到什麼

- 它跑在**拋棄式 PG + 本機 postgrest**,不是 Supabase 那一台。
  兩邊的 PostgREST 版本若不同,文法支援**可能不同** ⇒ 本檔答的是「這個文法合法」,
  不是「Supabase 那台一定收」。⚠️ 要那一格,得在真的環境上打一次。
- 它沒有驗**值的跳脫**:fixture 的 `event_type` 全是 `[a-z_]`。
  值域由 DB 的 `email_outbox_event_type_check` 釘死 ⇒ 今天組不出第二種意思;
  🔴 **哪天有人在值域裡加一個帶逗號的值, 那個 `join(',')` 要一起改。**
- 它沒有驗**清單很長**時的 URL 長度上限。
  ⛔ ~~「今天最多 4 種」~~ 🔴 **數錯了**(codex 2026-09-13 nit;我照 `buildExcludeEventTypes` 重數):
  四個旗標全關 ⇒ `order_shipped` + `shipment_tracking_corrected`(出貨那顆一次推兩個)
  + `bank_order_created` + `order_partially_refunded` + `bank_order_amount_changed` = **5 種**。
  📌 那一顆旗標推兩個值,是我把「旗標數」當成「值的數」的地方。離 URL 上限仍然很遠,
  而**一個錯的上界會讓下一個人少驗一格**。

## 收攤

```bash
D=/tmp/pcm-probe-b8
pgrep -f "postgrest $D/prest.conf" | while read -r p; do kill "$p"; done
pg_ctl -D "$D/data" stop
rm -rf "$D"
```
