# 在途 attempt 解析 resolver — ⛔ **本片已撤;本檔留作 P-1 落地時的 A 案重構規格**

> 🔴 **狀態:撤片(2026-08-10)**。codex 關卡1 FAIL,最重一條=**不要為不存在的呼叫者新增 RPC**。
> P-1(讓路 action)已因 Sean 拍「重付鈕等 L5b」而押後 ⇒ 第一個真 caller 短期不會出現 ⇒
> 當時做只會多出三樣成本:第二份挑單邏輯、一支正規式守門、**一個新的權限面**。
> 🔴 **這條論證與我自己兩小時前對 P-1 提的一模一樣**(P-304 §2),我沒把它套到自己的下一個提案上。
> ⇒ **本檔不再是施工 plan**,是「等第一個真 caller 出現時,直接做 A 案(單一來源重構)」的規格。
> 主視窗裁示:`P-305` §3=A。

## ⭐ A 案重構要點(第一個真 caller 出現時照這四條做)

1. **共用同一套 predicate 與排序** —— 目標解析必須與 `begin_charge_attempt` 的 per-user 閘
   逐字一致(`20260809210000_...sql:164-174`)。分岔的後果不是「效果差一點」,是**釋放另一張**
   pending attempt:客人照樣被擋,而我們多欠他一筆待補償。這是錢面。
2. 🔴 **只收 `p_order_id`、user 由 DB 自己推導** —— **不要**把 `customer_user_id` 開成參數。
   參數化本身就是攻擊面:`SECURITY DEFINER` + `payment_confirmer` EXECUTE 之下,
   可以餵**任意** user_id,而 `begin_charge_attempt` 是從訂單推導使用者的、沒有這個面。
   (codex 關卡1 MF3;我寫初稿時只想著「複製謂詞」,沒想到參數化的代價。)
3. **走 A 案(真重構)不要走 B 案(新函式+一致性守門)** —— 既然那時已有真 caller,
   直接讓 `begin_charge_attempt` 與新 caller 共用同一支,字面只有一份,不需要正規式守門。
4. **宣稱用詞**:新增並 GRANT 一支 SECURITY DEFINER RPC **本身就是 API 與權限面的改變**;
   可以說「**既有 caller path** 零改變」,不可以說「零行為改變」(codex 關卡1 MF5)。

## ⭐ 若那時仍需要一致性守門(B 案殘留設計,供參考)
- **EQUIV 要用兩支獨立交易餵同一份 fixture**,不可同交易內先 begin 後 resolver ——
  後者「安全」的理由依賴「begin 只替目標單建 attempt」這個當下為真的實作細節;
  哪天 begin 多寫一列,EQUIV 會安靜地量到污染集合,而且**兩邊仍都回某一張、不會紅**。
  fixture 必須抽成**單一來源**,否則本片自己就犯了它要防的錯。
- **ORDERBY 抽取要先切界定區段**:`begin_charge_attempt` 裡有**兩個** ORDER BY
  (cart dedup 一個、per-user 閘一個)。要先用 `INTO v_inflight_order_id` … `LIMIT 1` 切段、
  斷言起訖各恰一次、段內恰一個實際 ORDER BY,再比對;否則會抽到 dedup 那個、甚至吃到註解裡的字。
- 抽不到必須**紅**,不得靜靜比對兩個空字串(那是「取出段被註解餵飽」那族的翻版)。

---

<details>
<summary>以下為撤片前的原 plan 全文(保留供追線)</summary>

# 在途 attempt 解析 resolver 單一權威片 — plan

> P 窗 / 2026-08-10。主視窗裁 P-304 §2=A 之後開。
> 片型=**高風險片**(鐵則 12 ①錢 ③DB 結構)。流程:plan → 關卡1 → 實作 → **凍結不 commit**
> → 主視窗代跑審查 → marker → commit。

---

## 0. 設計原則(主視窗指定寫進檔頭)

> 🔴 **讓路只為了「讓一張新單走得通」。**
> 沒有新單在等的路徑(純對帳:callback / 輪詢 / webhook / cron sweeper / 過期孤兒重確認)
> **不需要也不應該讓路** —— 對它們讓路等於憑空製造一筆待補償的舊授權。
> (依據:`2026-08-10-l5a-policy-unification-plan.md` §8 八個呼叫點逐項盤點。)

---

## 1. 問題(為什麼現在做最便宜)

L5 讓路的目標 attempt 必須**和擋住客人的那一張是同一張**。而「擋住客人的是哪一張」目前
**只有一份答案**,寫在 `begin_charge_attempt` 的 per-user 閘裡
(`supabase/migrations/20260809210000_...sql:164-174`):

```sql
SELECT a.order_id
  FROM public.payment_charge_attempts a
  JOIN public.orders o ON o.id = a.order_id
 WHERE a.customer_user_id = v_order.customer_user_id
   AND a.order_id <> p_order_id
   AND a.status IN ('pending', 'charged')
   AND a.created_at > pg_catalog.now() - interval '10 minutes'
   AND o.payment_status <> 'paid'::public.payment_status
 ORDER BY (a.status = 'charged') DESC, a.created_at DESC, a.id DESC
 LIMIT 1;
```

⚠️ **誠實用詞**:現在**還沒有**第二份 —— 主視窗說的「已在分岔軌道上」若照字面讀是誇大的。
準確說法是:**第二份即將出現**(讓路 action 必須自己挑一張),而**抽出來的成本現在最低**
(還沒有人抄過去、還沒有人依賴任何抄本)。

**分岔的後果不是「效果差一點」**:用不同排序會釋放**另一張** pending attempt ⇒
客人照樣被擋、而我們多欠他一筆待補償。這是錢面。

⚠️ **不要與 cart dedup 的挑法混為一談**(同檔 `:138-141`):它的排序是
`(o.payment_status='paid') DESC, (a.status='charged') DESC, o.created_at DESC`,
**刻意不同**,因為它問的是另一個問題(「同一個購物車裡有沒有兄弟單」)。
本 resolver **只**收斂 per-user 在途閘那一個問題,不碰 dedup。

---

## 2. 兩種做法,我選 B(附理由)

| | A:真重構 | **B:新函式 + 一致性守門(選這個)** |
|---|---|---|
| 做法 | `CREATE OR REPLACE begin_charge_attempt`,把那段 SELECT 改成呼新 resolver | 新增 resolver 函式;`begin_charge_attempt` **一個字不動**;由 harness 斷言兩者對同一組 fixture **恆回同一張** |
| 好處 | 真的只有一份 | 不動線上金流 RPC;新舊可並存驗證 |
| 壞處 | 動到**線上、真客人在走**的金流 RPC,為了「未來的第二個呼叫者」 | 字面上仍有兩份,靠守門綁住 |

**選 B 的理由**:P-1 已押後(Sean 拍鈕等 L5b)⇒ **第二個呼叫者短期不會出現**。
為了一個還沒出現的呼叫者去改線上金流 RPC,風險與收益不成比例(R1「涉錢」該保守)。
B 先把「唯一權威的定義」與「守門」立起來;等 P-1 真的要接時再走 A,那時 resolver 已被驗過一輪。

🔴 **B 的成敗全在守門有沒有判別力** —— 若守門只是「兩邊都跑一次、看有沒有結果」,
那它對「排序不同」全盲(兩邊都會回**某一張**)。守門必須斷言**回同一張**,且要有突變證明它抓得到。

### 2b. 🔴 補上「機制而非文字約定」那一層(主視窗建議,採納)
plan 初稿對 §5-1(兩份會分岔)的緩解只有「兩支檔頭互相指標」= **純文字約定,機制上擋不住任何事**。
改成 **catalog 層錨**,錨在 DB 現況而不是註解:

harness 常設一格 `ORDERBY-EQUIV`:
1. 從 `pg_get_functiondef('public.begin_charge_attempt(uuid)')` 抽出 **per-user 閘那一段的 ORDER BY**;
2. 從 `pg_get_functiondef` resolver 抽出它的 ORDER BY;
3. 正規化空白後**逐字比對**,不同即紅。

⚠️ 誠實計價(不誇大它的能力):
- 它仍然是「**跑了才有效**」—— 沒有 CI 的話,改了 begin 而不跑 harness 一樣沒人叫
  (與 `SOLE-WRITER`/`ACL-UNIVERSAL` 兩道偵測器同一個掛帳桶,已知未掛 CI)。
- 但它比檔頭註解強在:**錨點是 DB 裡的實際定義**,不是人寫的字;
  begin 的 ORDER BY 被改掉 ⇒ 這格必紅,不需要任何人記得去改註解。
- 抽取本身要有判別力:抽不到(正規式沒命中)必須**紅**,不能靜靜回空字串比對成功
  (那就是「取出段被註解餵飽」那族的翻版,今天在 L5a-1 已經踩過一次)。

---

## 3. 要做的東西

**新增**:`public.resolve_blocking_inflight_attempt(p_user_id uuid, p_exclude_order_id uuid)`
- 回傳:`{attempt_id, order_id}`(或零列)
- 本體 = §1 那段 SELECT **逐字相同的謂詞與排序**,只是把 `v_order.customer_user_id` 換成參數
- `SECURITY DEFINER`、`search_path=''`、ACL 比照 L5a-1(REVOKE 四方 + GRANT payment_confirmer + 窮舉斷言)
- 🔴 **可呼面守門照抄 L5a-1 那一版**(非 inert 身分取得閉包 + 版本閘),不再自己發明一版

**不做**:不改 `begin_charge_attempt`、不改 dedup、不接任何呼叫者、不動 10 分鐘窗口。

---

## 4. 驗收(判別力優先,格數其次)

| 格 | 斷言 | 突變(要能單獨紅它) |
|---|---|---|
| `EQUIV-*` | 對同一組 fixture,resolver 回的那張 **= `begin_charge_attempt` 回的 `in_flight_order_id`** | 🔴 把 resolver 的排序改成 `created_at ASC` ⇒ **必紅**(這一發是本片的核心) |
| `ORDERBY-EQUIV` | 兩支 `pg_get_functiondef` 抽出的 ORDER BY **逐字相同**(§2b) | ①改 resolver 排序 ⇒ 必紅 ②讓抽取正規式抽不到 ⇒ **必紅**(不得靜靜比對空字串) |
| 多張候選 | 有 charged + pending 兩張時,兩邊都挑 charged 那張 | 拿掉 `(status='charged') DESC` ⇒ 必紅 |
| 同秒建立 | `created_at` 相同時由 `a.id DESC` 決勝、兩邊一致 | 拿掉 `a.id DESC` ⇒ 必紅(否則排序不穩定=間歇性挑錯) |
| 排除自己 | `p_exclude_order_id` 那張不得被選 | 拿掉該條件 ⇒ 必紅 |
| 已 paid 單 | 不選(`o.payment_status <> 'paid'`) | 拿掉 ⇒ 必紅 |
| 他人的單 | 不選 | 拿掉 `customer_user_id` ⇒ 必紅 |
| 10 分鐘外 | **兩邊行為一致**(目前都排除) | 拿掉窗口 ⇒ 必紅 |
| 零候選 | 兩邊都回空 | — |
| ACL / 可呼面 | 照 L5a-1 那套(含 `REACH-DENY-*` 家族) | 同 L5a-1 |

🔴 **`EQUIV-*` 那組不能只比「有沒有回值」**,必須逐字比 id。
🔴 每一發突變只改 resolver、**不改 `begin_charge_attempt`** —— 若某發突變兩邊同時變,那格沒有判別力。

---

## 5. 誠實邊界(先寫,免得事後補)
1. B 案下**字面仍是兩份**,一致性靠 harness;harness 不跑的時候它們可以分岔。
   ⇒ 若日後 `begin_charge_attempt` 被改而沒跑本 harness,守門不會叫。
   **緩解**:①`ORDERBY-EQUIV` catalog 層錨(§2b)——錨在 DB 實際定義,不靠人記得改註解;
   ②檔頭互相指標(輔助,不是主力)。
   ⚠️ 兩者都**只在 harness 被跑的時候有效**;「掛 CI」與 `SOLE-WRITER`/`ACL-UNIVERSAL` 同一個掛帳桶,
   本片不假裝解決它,只是把錨從註解移到 catalog。
2. resolver **不取鎖** —— 它只回答「現在誰擋著」。真正的 TOCTOU 關閉在 L5a-1 的鎖下前置。
   ⇒ 呼叫端不得把 resolver 的回答當成「稍後仍然成立」。
3. 本片**零行為改變**(無呼叫者)。這句在 commit 前要用 caller graph 證明,不是宣稱。

---

## 6. 體積
單一 migration + 單一 harness,無 app 層改動 ⇒ 15-45 分鐘可完成、可中斷。符合鐵則 4。

## 7. 現況前提
- L5a-1 `7c27d36f` 已收割;⛔ 兩支 migration **仍未 apply**。
- 本片新增的 migration **同樣不 apply**,排進主視窗的 apply 佇列。
- P-1 押後(Sean:鈕等 L5b);對客體驗 spec 六點待 Sean。

</details>
