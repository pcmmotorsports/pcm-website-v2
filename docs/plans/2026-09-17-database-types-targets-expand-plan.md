# plan:`database.types.ts` 型別債 —— 先把合併器的 `TARGETS` 從 10 補到 20

> 依據:Sean 2026-09-17 逐字「**依照建議**」⇒ 拍甲 = **先補 `TARGETS`,重跑乾跑,把「真的會不見」壓到 0,然後才談重寫。**
> 寫的人:窗 A(前台,worktree `pcm-shop`,branch `agent/shop-6`),2026-09-17。
> 🔴 本檔每個數字都是**今天當場量的**(正式庫 `supabase gen types` 產物 + scratchpad 乾跑),不是抄的。
> 🛑 **本檔停在 plan。碰 `packages/adapters` 共用檔 ⇒ 鐵則 8,要 Sean 批了才動手。**

---

## 1. 一句話

合併器 `scripts/regen-types-merge.py` 的 `TARGETS` 只列 **10 支**,而檔頭宣告的手動校正是 **21 條 / 20 個不同名字**
⇒ 另外 10 個名字的校正**不會被貼回去、也不會叫**。本片把 `TARGETS` 補齊,並補一道把兩者綁在一起的對帳。

---

## 2. 🔬 今天量到的(做決定的依據)

### 2-a 分母
```
repo 現有 database.types.ts      5,348 行
正式庫重新產生                    8,962 行   ← supabase gen types typescript --project-id bmpnplmnldofgaohnaok(唯讀, rc=0)
                                              🔴 2026-09-18 發現:這一行【漏帶 --schema】,只產了 public 一個 schema。
                                              ✅ 正確 8,990 行 ← 同命令 + --schema public,graphql_public(唯讀, rc=0)
                                              ⇒ 本檔 §3 以下凡是拿 8,962 算出來的數字都偏高, 已於 §3 重算。
合併器產物(TARGETS=10)          9,625 行
```

### 2-b 兩種 `TARGETS` 的乾跑結果(同一份新檔、同一支腳本,只有清單不同)

| | `TARGETS`=10(現況) | `TARGETS`=20(本片) |
|---|---|---|
| 報告 | 9 OK / **1 STOP** | 17 OK / **3 STOP** |
| `diff` 標成刪除 | 851 行 | **814 行** |
| 🔴 **真的沒了**(合併檔裡一行都找不到) | 278 行 | **220 行** |
| └ 其中註解 | 249 | **194** |
| └ 其中型別 / 程式行 | 29 | **26** |

🛑 **「壓到 0」這個目標,補 `TARGETS` 一個動作【做不到】** —— 這是本片最重要的一個數字,先講清楚:
補完之後**還剩 220 行**。而那 220 行**不是同一種東西**,見 §3。

### 2-c 🔴 `diff` 的「刪除」會把「移動」算進去
851 行裡有 **573 行其實還在合併檔裡**,只是位置變了(檔案從 5,348 長到 9,625,整個大搬風)。
⇒ 📌 **腳本 docstring 那條驗收「`diff | grep -c '^<'` = 0」在【大幅落後之後的第一次重 gen】上不適用** ——
它假設的是「上次 gen 之後只差幾十行」的增量情境。
⇒ ✅ 正確的尺是**「這一行在輸出檔裡還找不找得到」**,不是 diff 的 `^<` 計數。本檔所有「真的沒了」都用這把尺。

---

## 3. 那 220 行拆成三堆 —— 每一堆的處置不同

> 🔴 **2026-09-18 更新:標題那個 220 是用【漏帶 `--schema`】的產物算的,正確的數字是 207(型別行 19,其中真損失 7)。**
> 下面堆一已整段重寫;堆二堆三的字面未動,而它們的行數同樣是舊分母算的。

### 🟢 堆一:2026-09-18 **量完了** —— 假說一半成立,而**昨天那把尺自己是壞的**

> 🔬 本節每個數字都是 2026-09-18 當場量的(CLI 仍是 **2.98.1**,沒升級 —— 見下面「為什麼不用升」)。

#### ① 先講最重要的:昨天那「18 行」**不是一堆,是兩堆,而且其中一堆是我自己量錯**

| 昨天算在「堆一」裡的 | 今天的答案 |
|---|---|
| **7 行** `graphql_public`(L617/625/627/628/630/5330/5331) | 🔴 **不是生成器的事 —— 是我昨天的命令少帶參數。** |
| **10 行** 輔助型別樣板(`Tables<>` / `Enums<>` / `CompositeTypes<>` 的 `extends` 與 `: never = never,`) | 🟢 **版本差假說成立,而且不用升 CLI 就證得出來。不是損失。** |

#### ② `graphql_public` 那 7 行:少帶 `--schema`

昨天跑的是 `supabase gen types typescript --project-id <ref>`,**沒帶 `--schema`** ⇒ 只產 `public` 一個 schema。
而 repo 那份有**兩個** schema。⇒ 那 7 行「不見」是我**問錯問題**,不是生成器產不出來。

```
不帶 --schema              ⇒ 8,962 行 / `graphql` 命中 0 次 / schema 只有 public
--schema public,graphql_public ⇒ 8,990 行 / `graphql` 命中 3 次 / schema = graphql_public + public
```
⇒ ✅ **重 gen 的正確命令是**(本檔往後一律用這個):
```
supabase gen types typescript --project-id bmpnplmnldofgaohnaok --schema public,graphql_public
```
⇒ 📌 **這是一個「量具」的錯,不是「被量的東西」的錯** —— 而它整整一天被寫成「生成器版本差」。
   判別句:**發現一整塊東西不見了,先問「我這次的命令跟上次產它的那次一樣嗎」,再問生成器。**

#### ③ 樣板那 10 行:版本差成立,**而且不用升 CLI**

昨天以為要升到 2.117.0 才比得出來。**不用** —— repo 那份是**更舊的生成器**產的,
跟今天的 2.98.1 之間**已經有差**,量得到。差別逐字是**一對括號**:

```
repo        TableName extends  DefaultSchemaTableNameOrOptions extends {   …   : never  = never,
2.98.1 產物 TableName extends (DefaultSchemaTableNameOrOptions extends {   …   : never) = never,
```
🔬 驗法:把產物那對括號正規化掉之後跟 repo 逐行 `diff` ⇒ **110 行全等,0 處實質差異**
(唯一的 diff 是我取行區間時多切到的檔尾,不是內容)。
`: never = never,` repo 5 次 / 產物 0 次;`: never) = never,` 產物 5 次 ⇒ **一對一換掉,沒有少。**

⇒ 🟢 **這 10 行不是損失**:同一個型別,新版只是把條件型別的括號寫明。
⇒ 🟢 **所以「等 CLI 升級成功」這個 blocker,對堆一【解除了】。** 升級仍然值得做,但**不再擋這一片**。

#### ④ 重算之後的損失(用正確命令 + `TARGETS`=19)

| | 昨天(命令漏 `--schema`) | 今天(命令正確) |
|---|---|---|
| 真的沒了 · 總行 | 220 | **207** |
| └ 註解 | 194 | **188** |
| └ 型別/程式行 | 26 | **19** |
| └└ 其中**不是損失**(樣板括號) | — | **10** |
| └└ 🔴 **真正要處理的型別行** | — | **9** |

那 9 行逐行(這是完整清單,沒有省略):

| 行 | 內容 | 判定 |
|---|---|---|
| 4910/4911/4914 | `create_order` 的 `p_client_ip` / `p_client_ua` / `p_notification_email` 的 `\| null` | 已知,被真漂移 STOP 連帶(§4-1 ①) |
| 5027 | `pcm_pending_refund_amounts` 的 `Returns:` 單行寫法 | 已知,比較器假陽性(§3 堆二) |
| 5148 | `search_catalog_by_vehicle` 整塊 | 已知 🟡 未結,**不論結論都不准刪** |
| 4312 | `admin_soft_delete_order_note.p_reason: string \| null` | 🔴 **新發現,見 §3-b** |
| 4529/4536 | `admin_claim_hct_dispatch` / `admin_record_hct_dispatch` 的 `p_edelno` | 🟢 **不是損失** —— 單行 vs 多行排版差,參數一模一樣 |
| 4698 | `admin_unvoid_shipment` 的 `Args:` 單行 | 🔴 **新發現,見 §3-b** |

⇒ 📌 扣掉 4529/4536 這兩行排版差,**真正的損失是 7 行**,其中 **2 行是今天才發現的**。

### 🔴 3-b 今天多抓到的兩件(昨天的分類裡沒有這兩格)

#### (一)`admin_unvoid_shipment` —— repo 型別**舊了兩個參數**,而三綠量不到

```
repo 型別   Args: { p_idempotency_key: string; p_shipment_id: string }          ← 2 個
正式庫      p_actor / p_idempotency_key / p_request_id / p_shipment_id          ← 4 個
呼叫端      apps/admin/src/lib/shipping/shipment-repository.ts:246 送【4 個】   ← 跟正式庫一致
```
⇒ 🟢 **線上沒有壞** —— 呼叫端送的是對的 4 個,而且重 gen **會把型別修好**,不是弄壞。
⇒ 🔴 **但是**:`TURBO_FORCE=1 pnpm typecheck` **今天是綠的**(我親跑,rc=0)。
   **型別宣告 2 個、呼叫端送 4 個,typecheck 沒有叫。**
⇒ 📌 判斷句:**這份型別檔落後,不會讓三綠變紅。** 它壞掉的方式是安靜的 ——
   跟 CLAUDE.md 記的「改簽章兩個方向都有空窗」是同一顆地雷的另一面:
   那一條擋的是**碼與庫**不同步,這一條是**型別檔與庫**不同步,而**沒有任何一道閘在量它**。
⇒ 🙋 **本片不修**(碰 `packages/adapters`,鐵則 8)。只記下來。

#### (二)`admin_soft_delete_order_note.p_reason` —— 一條**沒人記、沒人守**的手動校正

```
repo    p_reason: string | null      ← 有人手動補過 | null
產物    p_reason: string             ← 生成器今天不產
```
🔬 查證:這支函式名**不在檔頭那份編號清單裡**(①…㉕ 全查,命中 0),**也不在 `TARGETS` 裡**。
⇒ 🔴 **所以它今天是三重沒有保護**:重 gen 會直接沒了、檔頭不會提醒、對帳測試(§4-2)也抓不到
   —— 因為 §4-2 那一格比的是「檔頭清單 ↔ `TARGETS`」,**而它兩邊都不在**。
⇒ 📌 **§4-2 那道對帳有一個它守不到的形狀**:它守「記了但沒進 TARGETS」,
   守不到「**根本沒記**」。要守後者,尺得換成「產物與 repo 的 `Args` 逐行比」,那是另一件事。
⇒ 🙋 處置要 Sean 批(是把它補進檔頭+`TARGETS` 變 21 支,還是讓它退場)。**本片只記。**

### ⛔ ~~堆一:生成器版本差(18 行,型別/程式行)—— 假說未證實,待升級後重測~~(2026-09-17 字面,留痕)

> 昨天寫的是「升級失敗 ⇒ 這一堆至今沒有答案,要升到 2.117.0 才重測得了」。
> **今天量完:不用升。** 兩個原因見上面 ②③ —— 一半是我命令漏參數,一半用 2.98.1 就比得出來。
> 🔴 **昨天那句「待升級後重測」把一件量得到的事寫成了量不到。** 留在這裡當提醒。
> ⚠️ 🔴 **pnpm 地雷照舊有效**:brew 在 Cellar 留了 **pnpm 12.4.2** 而 link 不進去,
>   brew 自己會建議 `brew link --overwrite pnpm`。**不要跑那句** —— pnpm 會從 9.15.0 跳三個大版本,
>   而這個 monorepo 每一次 typecheck / lint / build / test 都靠它。(今天實測仍是 9.15.0,正常。)

### ⛔ ~~堆一:生成器版本差(18 行)—— 不是損失~~(更舊的字面,留痕)
`graphql_public` 那一塊、`TableName extends DefaultSchemaTableNameOrOptions extends {` 那組輔助型別樣板。
**本機 CLI 2.98.1,官方已 2.117.0** ⇒ 樣板不同版本長得不一樣。
⇒ **處置:先升 CLI 再比**(見 §6 ⑤),否則每次重跑都混進一堆與校正無關的差。

### 🟡 堆二:3 個 STOP 帶來的(8 行型別/程式行)—— 要人判,而其中一個是誤報

| STOP | 原因(腳本印的) | 我查證之後的判定 |
|---|---|---|
| `create_order` | 參數集合不同:新-舊 = `p_coupon_code` / `p_payment_channel` | 🔴 **真漂移** —— 正式庫真的多了兩個參數。**這是另一件事,不要混進本片**(見 §6 ③)。它被 STOP 住 ⇒ 整塊用新版 ⇒ 連帶讓 ① 那三處 `| null`(`p_client_ip` / `p_client_ua` / `p_notification_email`)一起消失。 |
| `email_outbox` | Args/Returns 解析不出來 ⇒ fail-closed | 🔴 **結構性做不到,不是 bug** —— ⑲⑳ 校正的是一張**表**的欄位,而合併器整支是為**函式**寫的(認 `Args:` / `Returns:`)。⇒ 把它放進 `TARGETS` **只會得到一個 STOP**,救不了它。**要另想辦法。** |
| `pcm_pending_refund_amounts` | 簽章形狀變了;Returns 舊 = `{ rail: string; amount: number }[]` 新 = `{` | 🟢 **誤報** —— 我開檔逐字比:兩邊 `Args` 完全一樣,`Returns` 的**內容也一樣**,只是新版印成多行。`args_shape()` 比的是 `Returns:` **那一行的字串** ⇒ 單行 vs 多行必然不等。**這是比較器的假陽性。** |

### 🔴 堆三:本體中文註解(194 行)—— 結構性保不住
合併器只保留**檔頭**(`old[:h]`,切在 `export type Json =` 那一行),
**本體裡的中文註解,只有落在那 20 個被貼回的區塊內才活得下來。**
⇒ 📌 **這件事現在沒有人寫下來過**,而它是「重 gen 之後檔案讀起來變陌生」的真正原因。

---

## 4. 改什麼

### 4-1 `scripts/regen-types-merge.py` 的 `TARGETS`:10 → 20
照 `database.types.ts` 檔頭那份編號清單逐條對(①…㉕;⑬⑭⑮⑯ 已退場):

| 條 | 名字 | 現在在 TARGETS? | 乾跑結果 |
|---|---|---|---|
| ① | `create_order` | ✅ | STOP(真漂移) |
| ② | `admin_upsert_supplier` | ✅ | OK |
| ③ | `admin_append_order_note` | ✅ | OK |
| ④ | `admin_initiate_order_refund` | ✅ | OK |
| ⑤ | `admin_finalize_order_refund` | ✅ | OK |
| ⑥ | `admin_upsert_item_procurement` | ✅ | OK |
| ⑦ | `admin_cancel_order` | ✅ | OK |
| ⑧ | `admin_record_item_receipt` | ✅ | OK |
| ⑨ | `search_products_by_vehicle` | ✅ | OK |
| ⑩ | `admin_search_orders` | ✅ | OK |
| ⑪ | `admin_update_order_item_amount` | 🔴 **缺** | OK(補進去就救得回來) |
| ⑫ | `admin_set_product_listing` | 🔴 **缺** | OK |
| ⑰ | `admin_record_hct_submit` | 🔴 **缺** | OK |
| ⑱ | `admin_hct_reset_unknown_to_draft` | 🔴 **缺** | OK |
| ⑲⑳ | `email_outbox`(**表,不是函式**) | 🔴 **缺** | STOP(結構性做不到) |
| ㉑ | `record_manual_cancel_notice` | 🔴 **缺** | OK |
| ㉒ | `revoke_manual_cancel_notice` | 🔴 **缺** | OK |
| ㉓ | `pcm_pending_refund_amounts` | 🔴 **缺** | STOP(誤報) |
| ㉔ | `admin_record_hct_unknown_reason` | 🔴 **缺** | OK |
| ㉕ | `admin_requeue_dead_email` | 🔴 **缺** | OK |

⇒ **補進去立刻救回來的是 8 支**(⑪⑫⑰⑱㉑㉒㉔㉕),它們今天**完全沒有保護**。

### 4-2 補一道對帳:`TARGETS` ↔ 檔頭清單
**掛在既有那一族**,不另起爐灶 —— `packages/adapters/src/supabase/database-types-manual-count.test.ts` 已經在讀檔頭、已經在數條目,
本片在**同一支檔**加一格:從檔頭抽每一條的函式名,與 `regen-types-merge.py` 的 `TARGETS` 對。
🔵 抽法沿用我今天用的:`^//   <圈號> \`<名字>` 這個形狀(21 條全中,0 漏)。

🔴 **那一格自己要有正負對照(只驗綠的那一半等於沒驗)**:
```
正:現況(TARGETS 有那 20 個名字)          ⇒ 綠
負:從 TARGETS 抽掉任何一支                 ⇒ 必須紅, 而且訊息要講出【是哪一支】
負:在檔頭加一條假的 ㉖                      ⇒ 必須紅
```
⇒ 做法:把「抽名字 + 比對」寫成**純函式**,測試餵它兩組輸入(真的 / 動過手腳的)——
與 `brand-content-coverage.test.ts` 那一族同一個形狀(它就是為了讓負對照跑得起來才抽純函式的)。

### 4-3 ✅ `email_outbox` 那一條 —— **2026-09-17 查完了:這題消失,⑲⑳ 可以退場**

> Sean 2026-09-17 拍**丙**(先查那兩處校正今天還需不需要)。**查完了,答案是不需要。**

⑲ = `email_outbox` 的 `sent_tracking_number` / `sent_tracking_recorded` 各佔 Row/Insert/Update(六處)
⑳ = `email_outbox.provider_message_id` 佔 Row/Insert/Update(三處)

🔬 **拿正式庫的產物逐字比,9 行對 9 行【完全相同】**(不是比名字在不在,是比整行):
```
產物(正式庫 gen)              repo 現有
provider_message_id: string | null        ⇔  provider_message_id: string | null
sent_tracking_number: string | null       ⇔  sent_tracking_number: string | null
sent_tracking_recorded: boolean           ⇔  sent_tracking_recorded: boolean
provider_message_id?: string | null       ⇔  provider_message_id?: string | null      (Insert)
sent_tracking_number?: string | null      ⇔  sent_tracking_number?: string | null     (Insert)
sent_tracking_recorded?: boolean          ⇔  sent_tracking_recorded?: boolean         (Insert)
provider_message_id?: string | null       ⇔  provider_message_id?: string | null      (Update)
sent_tracking_number?: string | null      ⇔  sent_tracking_number?: string | null     (Update)
sent_tracking_recorded?: boolean          ⇔  sent_tracking_recorded?: boolean         (Update)
```
🔵 **負對照**:同一把尺去撈我編的 `zzz_not_a_column` ⇒ **0 次**;而那三個欄名在產物裡各 **3 次**(Row/Insert/Update)
⇒ 尺兩個方向印得出不同的東西,那三個 3 是真的。

⇒ ✅ **生成器今天自己產得出來,連 `| null` 與 `?` 都一字不差** ⇒ **⑲⑳ 具備退場條件**
  (照檔頭 ⑯ 那一條立的慣例:「下一次重 gen 就會自己產生 ⇒ **那時直接刪掉本條,不要重貼**」)。
⇒ ✅ **所以 `email_outbox` 不用進 `TARGETS`** —— 它本來就進不去(表不是函式),而現在也不需要進去。
⇒ 📌 **`TARGETS` 的目標數因此是 19 個名字,不是 20。**

🛑 **而退場【不是本片做】** —— 刪 ⑲⑳ 會動到檔頭計數,那道守門(`database-types-manual-count.test.ts`)會紅,
   而它該紅。退場要跟「重寫型別檔」那一件一起做,由 Sean 另外批。**本片只把「可以退場」這個事實記下來。**
🔵 這一格**不需要升 CLI 就答得出來** —— 用的是 2.98.1 的產物。升級只影響 §3 堆一那 18 行。

### 🔴🔴 4-3-b **而【不要】把 §4-3 讀成「生成器現在會產 `| null` 了」—— 那是兩件事**

> 本節是 2026-09-17 加的**訂正**。起因:主視窗讀完 §4-3 之後的轉述是
> 「`| null` 那一族生成器今天寫得出來了 ⇒ 推翻了檔頭的一個前提」。
> 🛑 **我去量了,那句不成立。而它如果被寫進文件,下一個人可能會把另外 40 幾處校正一起退場。**

`| null` 在這份型別檔裡有**兩個來源**,長得一樣而機制完全不同:

| | 來源 | 生成器產不產? | 例子 |
|---|---|---|---|
| **表的欄位**(Row / Insert / Update) | 欄位本身 nullable | 🟢 **一直都產** | `email_outbox.provider_message_id: string \| null` |
| **函式的參數**(`Args`) | 參數可以傳 null | 🔴 **今天仍然不產** | `create_order.Args.p_client_ip` |

🔬 **今天實測(同一份正式庫產物,2026-09-17)**:
```
產物 p_client_ip: string            ⇔  repo p_client_ip: string | null     ← 校正還活著
產物 p_note: string                 ⇔  repo 有 | null
產物 p_zero_price_reason: string    ⇔  repo 有 | null
產物 p_notification_email?: string  ⇔  repo 有 | null
```
⇒ 🎯 **檔頭那句「生成器【今天仍然不產】那些 `| null` —— 實測 `p_client_ip`」今天【仍然成立】,一個字都不用改。**
⇒ 🎯 **§4-3 那 9 行之所以能退場,是因為它們是【表的欄位】,不是因為生成器變聰明了。**

🛑 **判別句(給下一個人)**:看到某一條校正想退場,先問它是**表的欄位**還是**函式的參數**。
   · 表的欄位 ⇒ 可能可以退場,**逐行比過再說**。
   · 函式的參數 ⇒ **今天一律不能退場**,而且要等到有人重新實測那句前提不成立的那一天。
📌 **⑲⑳ 是本檔第一批「表的欄位」校正**(檔頭 ⑲ 自己的註解也說過「『函式』這兩個字今天已經不精確」)——
   ⇒ 它們能退場**不構成任何其他條目的先例**。


#### 🟢 2026-09-18 **補一次全檔普查 —— §4-3-b 這條規則今天有分母了**

昨天證明這件事用的是**幾個例子**(`p_client_ip` 等 4 個)。今天把**整份檔**掃過,兩類分開數:

| 區塊(只算型別行,註解不算) | repo 裡帶 `\| null` 的行 | 產物**產不出來**的 | 比率 |
|---|---|---|---|
| **資料表 / View 欄位**(Row / Insert / Update) | **930** | **0** | **0.0%** |
| **函式參數**(`Functions` → `Args`) | **28** | **28** | **100.0%** |

⇒ 🎯 **0/930 對 28/28。這不是傾向,是乾淨的二分。**
⇒ 🎯 §4-3-b 那條判別句(表的欄位 vs 函式的參數)**今天在全檔尺度上成立,一個例外都沒有。**

🔵 **對照組**(不做這兩格,上面那兩個數字都不該被相信):
```
負對照:拿我編的 zzz_not_a_real_column: string | null 去撈
        ⇒ repo 命中 0 / 產物命中 0     (尺印得出「找不到」)
正對照:拿確定存在的 provider_message_id: string | null 去撈
        ⇒ repo 命中 1 / 產物命中 1     (尺印得出「找得到」)
```
⇒ 兩個方向都印得出不同的東西 ⇒ 上面那張表的 0 與 28 是真的,不是尺壞掉。

🛑 **而「28 個函式參數校正今天全部沒有保護」不等於「28 條都在 `TARGETS` 裡」** ——
   §3-b(二)剛抓到 `admin_soft_delete_order_note` 是**檔頭與 `TARGETS` 兩邊都沒有**的。
   ⇒ 📌 **這 28 行還沒有逐行盤過「各自被誰守著」。本片沒做,見 §7。**

### ⛔ ~~4-3 `email_outbox` 那一條 —— 🙋 本片不解,要 Sean 挑~~(舊字面留痕,不刪)
它是**表**不是函式,合併器結構上處理不了。三條路,我**不自己決定**:
- **甲** 放進 `TARGETS` 當一個**刻意的 STOP**,讓它每次重 gen 都吵一次,由人手動貼回(成本:每次要人做)
- **乙** 把合併器擴充成也認表的區塊(成本:改那支腳本的核心,風險比本片大)
- **丙** 去查那兩處校正**今天還需不需要**(生成器可能已經產得出來了)⇒ 需要就走甲,不需要就退場
🔵 **我推薦丙先做** —— 它可能讓這一題直接消失,而它只是一次比對。

---

## 5. 驗收(做完要印得出這些)

1. `TARGETS` = 20 個名字,與檔頭清單**零差集**(新的那一格測試說了算)。
2. 乾跑報告:**17 OK / 3 STOP**,而那 3 個 STOP 的理由**逐一寫在 plan 或 commit body 裡**,不是默默吞掉。
3. 「真的沒了」從 **278 → 220**(本片的實績);剩下的 220 行**照 §3 三堆各自處置**,不在本片收尾。
4. 新那一格測試的**負對照當場跑一次**:抽掉一支 ⇒ 紅、訊息指名;不抽 ⇒ 綠。
5. 三綠 + `pnpm test` 全綠(本片動 `.py` 與 `.test.ts`)。

🛑 **本片【不重寫 `database.types.ts`】** —— 它只是讓工具有能力做對,重寫是下一件,要 Sean 另外批。

---

## 6. ~~🙋 要 Sean 決定的~~ ⇒ 🟢 **2026-09-17 三題全答「依照建議」= 全照推薦**(原文保留備查)

```
Q1 create_order 真漂移 ⇒ 甲:另開一件, 不跟型別檔混。本片不碰它、也不查呼叫端。
   🔴 而 plan 保留這句:補完 TARGETS 之後它【仍然會 STOP】—— 因為簽章真的不一樣。
Q2 email_outbox        ⇒ 丙:先查還需不需要。✅ 查完了, 不需要 ⇒ 見 §4-3。
Q3 supabase CLI        ⇒ 甲:先升(2.98.1 → 2.117.0)。
   🛑 而它是【brew 全域安裝】(/opt/homebrew/bin/supabase → Cellar/supabase/2.98.1)
      ⇒ 升級會動到這台機器上【每一個窗】⇒ 已回報主視窗, 等它點頭才動。
      退回去的指令:brew 的舊版在 Cellar 裡, 可用 `brew switch` 或重裝指定版本。
```

## 6-b 原本那三題的選項(留痕)

```
Q1:`create_order` 的真漂移(正式庫多了 p_coupon_code / p_payment_channel)要不要跟本片一起處理?
    甲) 不一起 —— 本片只補 TARGETS 與對帳;那個漂移另開一件(它會動到呼叫端)。(推薦)
    乙) 一起 —— 反正都要重跑一次。
    A: 甲 | 乙

Q2:`email_outbox`(表,合併器處理不了)怎麼辦?
    甲) 放進 TARGETS 當刻意的 STOP, 每次重 gen 由人手動貼回
    乙) 把合併器擴充成也認表的區塊
    丙) 先查那兩處校正今天還需不需要 —— 可能已經可以退場。(推薦:一次比對就知道)
    A: 甲 | 乙 | 丙

Q3:本機 supabase CLI 是 2.98.1、官方 2.117.0, 那 18 行樣板差可能純粹是版本差。要不要先升?
    甲) 先升 CLI 再比 —— 不然每次重跑都混進無關的差。(推薦)
    乙) 不升, 把那 18 行當已知噪音記著。
    A: 甲 | 乙
```

---

## 7. 我沒做 / 做不到的

- **沒有改 `TARGETS`、沒有重寫型別檔、沒有 commit 任何產物。** 乾跑全部在 scratchpad,repo 全程乾淨。
- **那 194 行本體中文註解**,本片**不處理** —— 它是合併器的結構性限制(只保檔頭),要解得另外設計。
- `search_catalog_by_vehicle`(repo 有、新產物沒有)🟡 **我沒查完** —— 別窗查到正式庫上有**兩個版本活著**
  (11 參舊版 + 14 參現行版,舊版是 `20260909040000` 前置閘刻意留的)。**要拿那個去對才知道它為什麼沒出現在產物裡。**
  🛑 **不論結論是什麼,不要砍它。**
- ⛔ ~~那 26 行「型別/程式行」我**全部看過**(不是抽樣),而其中 `p_reason: string | null` / `p_edelno: string`×2 那幾行
  **對應到哪一支函式我沒逐行追** —— 它們落在 3 個 STOP 的區塊裡,補 `TARGETS` 之後由那 3 個 STOP 的處置決定。~~
  🔴 **2026-09-18 訂正:上面那句後半【是錯的】。** 今天逐行追完了,那幾行**不在任何一個 STOP 的區塊裡**:
  `p_reason` 屬 `admin_soft_delete_order_note`、兩個 `p_edelno` 屬 `admin_claim_hct_dispatch` / `admin_record_hct_dispatch`,
  三支都是 **OK 都不是、連 `TARGETS` 都沒有**的函式。⇒ 「由那 3 個 STOP 的處置決定」**不成立**,
  其中 `p_reason` 是一條沒人守的真校正(§3-b 二)。📌 **沒追就別推論它歸誰管。**

### 🔴 7-b 今天量完之後,**還沒做**的(給下一個人)

- **那 28 行函式參數校正,我沒有逐行盤「各自被誰守著」。** 今天只證明了「生成器 28 個全不產」,
  而 `admin_soft_delete_order_note` 那個例子說明**至少有一條兩邊都沒登記**。⇒ 有幾條是孤兒,**今天沒有數字**。
- **`admin_unvoid_shipment` 型別落後兩個參數,我沒有去掃「還有幾支也這樣」。** 今天是撞到的,不是掃出來的。
  ⇒ 📌 **不要把「找到一個」讀成「只有一個」。**
- **沒有升 CLI**,也**不再需要為堆一升**。升級若要做,是為了別的理由,不是這一片。
- **完全沒碰 `packages/adapters`**(鐵則 8),`TARGETS` 一個字沒改,repo 只多這一份 `.md` 的改動。

## 8. 🔢 2026-09-18 **「還有幾支也這樣」—— 數字補上了:8 支**

> 起因:§3-b(一)撞到 `admin_unvoid_shipment` 型別落後兩個參數,而我當時逐字寫了「**不要把『找到一個』讀成『只有一個』**」。
> 這一節把那個數字補上。**唯讀普查,沒有改任何東西。**

### 8-1 怎麼量的(三個來源,兩個方向的對照)

| 來源 | 是什麼 | 取得方式 |
|---|---|---|
| **A** repo 型別檔 | `packages/adapters/src/supabase/database.types.ts` 的 `Functions` 區塊 | 直接解析,~~84~~ **99 支**(🔴 84 是壞掉的解析器給的,見 §9-3) |
| **B** 今天的產物 | `--schema public,graphql_public` 產出,149 支 | 唯讀 gen(§3 ②) |
| **C** 正式庫真簽章 | `pg_catalog.pg_proc`,public schema,`prokind='f'`,264 支 | `bash scripts/readonly-prod-sql.sh`(唯讀,錯誤 0) |

比的是**輸入參數的名字集合**,不是型別 —— 因為 §4-3-b 已證明生成器對函式參數一律不產 `| null`,比型別會有 28 個必然的假陽性。

🔵 **對照組(三條都跑了)**:
```
正對照  admin_append_order_note 原樣    == 正式庫 ? True    ← 比對器抓得到「一致」
負對照① 編一支不存在的 zzz_not_a_real_rpc_9x ⇒ 正式庫 0 組 / repo 0 組   ← 不會亂命中
負對照② admin_append_order_note 拿掉一個參數 == 正式庫 ? False   ← 動過手腳就該紅, 真的紅了
```
🔵 **而最強的那道其實是「B vs C」** —— 今天剛從正式庫產出來的檔,理論上該與正式庫**全中**:
```
B(今天產物) vs C(pg_proc):對得上 148 / 對不上 0 / 正式庫沒這支 1(graphql, 它在 graphql_public 不在 public)
```
⇒ **148 比 0。尺是準的。** 所以下面 A vs C 的 8 支是真的,不是解析器的毛病。

### 8-2 🔴 而第一版的尺是壞的 —— 是交叉核對抓到的,不是我看出來的

第一版 SQL 直接拿 `p.proargnames` 當輸入參數,量出來 **A vs C 對不上 15 支**。
**而同一把尺量 B vs C 也是 15 支對不上** —— 一個剛從正式庫產出來的檔不可能錯 15 支 ⇒ **是尺壞了**。

原因:`proargnames` **把 OUT 參數也放在同一個陣列裡**。凡是 `RETURNS TABLE(...)` 的函式
(`pcm_pending_refund_amounts` 的 `rail`/`amount`、`get_effective_prices` 的 `amount`/`currency`/… )
那些回傳欄名都被我當成了輸入參數。

✅ 修法:改用 `proargmodes` 過濾,只留 `i` / `b` / `v`(`proargmodes IS NULL` 時全部是 IN):
```sql
SELECT string_agg(nm, ',' ORDER BY ord)
FROM unnest(p.proargnames) WITH ORDINALITY AS a(nm, ord)
WHERE p.proargmodes IS NULL OR p.proargmodes[ord] IN ('i','b','v')
```
⇒ 修完 B vs C 從 15 變 **0**,A vs C 從 15 變 **8**。
⇒ 📌 **判斷句:兩個獨立來源拿來互相驗,驗的不只是被量的東西,也是尺本身。**
   **這是今天第二次「量具壞掉被讀成被量的東西壞掉」**(第一次是 §3 ② 漏帶 `--schema`)。

### 8-3 🎯 名單:8 支,而**沒有一支會在線上炸**

| 支 | 正式庫比 repo 型別多的參數 | 必填? | 呼叫端實際有沒有送 | 判定 |
|---|---|---|---|---|
| `admin_create_shipment` | `p_actor` `p_request_id` | 🔴 **必填** | ✅ 有(`shipment-repository.ts:119`) | 🟢 沒壞 |
| `admin_add_shipment_items` | `p_actor` `p_request_id` | 🔴 **必填** | ✅ 有(`:146`) | 🟢 沒壞 |
| `admin_mark_shipment_shipped` | `p_actor` `p_request_id` | 🔴 **必填** | ✅ 有(`:171`) | 🟢 沒壞 |
| `admin_void_shipment` | `p_actor` `p_request_id` | 🔴 **必填** | ✅ 有(`:227`) | 🟢 沒壞 |
| `admin_unvoid_shipment` | `p_actor` `p_request_id` | 🔴 **必填** | ✅ 有(`:246`) | 🟢 沒壞 |
| `create_order` | `p_payment_channel`(必填) `p_coupon_code`(DEFAULT NULL) | 🔴 **必填** | ✅ 有 —— 走自己的 wire 型別,見 8-4 | 🟢 沒壞 |
| `admin_create_manual_order` | `p_notification_email` `p_tier` `p_vehicle` | 🟢 三個都有 DEFAULT | (沒查,不必) | 🟢 不會炸 |
| `admin_record_manual_refund` | `p_confirm_card_not_refunded` | 🟢 `DEFAULT false` | (沒查,不必) | 🟢 不會炸 |

⇒ 🟢 **結論一:8 支全部不會在線上炸。** 五支出貨的必填參數呼叫端都送了(逐個開檔看的,不是推的)。
⇒ 🔴 **結論二:8 支全部三綠量不到。** `TURBO_FORCE=1 pnpm typecheck` 今天 rc=0 綠(§3-b 親跑)。

### 8-4 為什麼 `create_order` 型別落後兩個參數卻沒事 —— **它根本不用這份型別檔**

`packages/adapters/src/supabase/mappers/order.ts:77` 有一份**手寫的** wire 型別 `CreateOrderRpcArgs`,
它自己就帶了 `p_payment_channel`(必填)與 `p_coupon_code`(選填),而**呼叫端用的是它,不是 `database.types.ts`**。

⇒ 📌 **這解釋了整節的形狀**:`database.types.ts` 落後,之所以安靜,
   是因為**真正擋得住事情的那些型別,有些根本不住在這份檔裡**。
⇒ 🛑 反過來也要看見:**那也表示這份檔的「守備範圍」比它看起來小。**
   要知道某一支 RPC 真的被誰守著,得去看呼叫端有沒有自己的 wire 型別,**不能只看這份檔**。

### 8-5 順手撈到的兩件(都只記,不改)

**(一)`mappers/order.ts:79-82` 那段註解過期了。**
它逐字寫「新舊兩支 `create_order` 靠名字集合各自被唯一命中……少送一次就會靜靜掉回舊那支、存成 tappay」。
🔬 今天實查:正式庫 public schema `prokind='f'` 的 `create_order` **只有 1 支**(11 參),舊那一代已經不在。
⇒ **結論沒變**(`p_payment_channel` 仍然該是必填),**但理由變了** —— 今天少送會是 PGRST202 吵出來,不是靜靜寫錯。
⇒ 🙋 改註解要碰 `packages/adapters`(鐵則 8),**本片不動**。

**(二)🟢 `search_catalog_by_vehicle` 的 🟡 解掉一半了。**
§7 原本記「repo 有、新產物沒有,不知為何」。今天量到:正式庫**真的有兩代並存**,
而 **repo 宣告的 11 參 == 正式庫舊那一代的 11 參,名字集合逐字相符**(所以它落在「對得上」那 75 支裡)。
```
正式庫 11 參(舊):p_brand,p_model,p_year,p_offset,p_limit,p_sort,p_category,p_brand_slugs,p_price_min,p_price_max,p_new_since
正式庫 14 參(現行):上面 + p_categories,p_terms,p_fit_scope
```
⇒ ✅ **repo 那一塊不是憑空多出來的,它對應一支真的活著的函式。**
⇒ 🛑 **仍然不要砍它**,而「產物為什麼只印一代」還沒答(產物只列 149 支,正式庫有 264 支,**差的那 115 支是什麼,今天沒查**)。

### 8-6 我這一節**沒做**的

- **只比了參數名字,沒比型別、沒比 `Returns`。** 型別比不了(§4-3-b 的 28 個必然假陽性),`Returns` 沒碰。
- ⛔ ~~只比了 repo 型別檔裡有的那 84 支……「型別檔根本沒收錄」那一類今天沒數。~~
  ✅ **2026-09-18 稍晚數完了,見 §9**(而且 84 這個分母是錯的,正確是 99)。
- `admin_create_manual_order` 的 `p_tier` / `p_vehicle` 不送會拿到 NULL,**那是不是對的,我沒判**(後台的事)。
- **沒改任何碼**:`packages/adapters` 沒碰、`TARGETS` 沒碰、型別檔沒重 gen 也沒覆蓋。

## 9. 🔢 2026-09-18 收尾:**「型別檔根本沒收錄」那一類 —— 三個數字**

> 這是 §8-6 第二條「沒數」的那一格。**唯讀,沒改任何東西。**

### 9-1 🔴 先更正分母:不是 115,也不是 111,是 **166**

派工單說的 115 是「正式庫 264 − 產物 149」。我實測那個差是 **111**,而且**它不是風險分母**:

| 口徑 | 數字 | 是什麼 |
|---|---|---|
| 正式庫 − 今天的產物 | 68 | PostgREST **根本不吐**的(內部 / trigger 用) |
| **正式庫 − repo 型別檔** | **166** | 🎯 **呼叫端寫程式時沒有型別可用的** ← 風險在這一格 |
| 產物 − repo 型別檔 | 98 | repo 這份檔落後的部分 |

⇒ 📌 **「產物沒有」跟「呼叫端沒有型別」是兩件事。** 擋得住打錯字的是 **repo 那份檔**,不是產物。

### 9-2 🎯 三個數字

```
分母 166 支(正式庫 public 有、repo database.types.ts 沒有)
  ├ 沒有任何 .rpc 呼叫端            = 148 支   🟢 沒事
  ├ 有呼叫端 + 自己有手寫型別邊界   =   3 支   🟢 沒事
  └ 🔴 有呼叫端 + 什麼型別都沒有    =  15 支   ← 只有這格要緊
```

**🟢 那 3 支有自己的型別邊界(而且做得比型別檔還好):**

| 支 | 邊界 | 強在哪 |
|---|---|---|
| `catalog_facet_counts` | `FacetRpcClient`(`vehicle-facet-counts.ts:53`) | `fn` 釘成字面值 `'catalog_facet_counts'`,8 個參數逐個帶型別 |
| `get_vehicle_taxonomy` | `VehicleTaxonomyRpcClient` | 同上,`fn` 釘死 |
| `record_auth_callback_event` | `AuthCallbackEventClient`(`callback-event.ts:79`) | 🔵 **最強的一個** —— 方法**根本不收函式名**,名字寫死在門的另一側,參數釘成字面值聯集。它擋的不只是打錯字,是「拿到這個 client 的人能叫幾支 RPC」 |

**🔴 那 15 支什麼都沒有 —— 而且逃生口有三種長相:**

| 逃生口 | 支數 | 名單 |
|---|---|---|
| `LooseClient`(自訂 `rpc(fn: string, …)`) | 9 | `admin_fx_rate_set` · `admin_home_banner_save_draft` / `_publish` / `_duplicate` / `_archive` · `admin_request_order_item_amount` · `admin_review_order_item_amount` · `admin_set_order_item_costs` · `pcm_incident_log_line_forward_failed` · `system_supplier_mail_record` |
| 行內 `as unknown as { rpc(fn: string, args: Record<string, unknown>) }` | 4 | `get_member_order_cancelled_quantities` · `pcm_count_new_email_events` · `pcm_order_remaining_receivable` · `log_search_query` |
| 🔴 `.rpc('…' as never, …)` —— **直接把檢查關掉** | 1 | `admin_record_hct_label_raw`(`shipment-repository.ts:670`) |

⇒ 這 15 支**打錯參數名、少送必填參數、送錯型別,typecheck 一律不叫**。
⇒ 🛑 **而這不等於「有 bug」** —— 我沒有逐支去比它們的參數對不對(見 9-4)。這格答的是**「有沒有人守」,不是「守的對不對」**。
⇒ 🔵 反向健檢:**程式裡叫得到、而正式庫 public 沒有的 = 0 支** ⇒ 沒有叫空氣的 RPC。

### 9-3 🔴🔴 今天我的尺壞了**四次**,而第四次讓我換了做法

| 第幾次 | 壞在哪 | 怎麼抓到的 |
|---|---|---|
| ① | `gen types` 漏帶 `--schema` ⇒ 少一整個 schema | 「一整塊不見」太整齊,不像漂移 |
| ② | `proargnames` **把 OUT 參數當成輸入參數** | 交叉核對:剛從正式庫產的檔不可能錯 15 支 |
| ③ | 解析器漏掉**整塊寫成一行**的 `name: { Args: {…}; Returns: X }` | 一支「型別檔沒有」的函式,呼叫端卻沒有任何 cast 也不紅 ⇒ 它一定在檔裡 |
| ④ | 解析器漏掉 `Args: never`(零參數函式) | 同上,又一支對不起來 |

⇒ 🛑 **前三次我都是「再補一個形狀」,而第四次證明這條路沒有底** —— 我不知道還有幾種形狀。
⇒ ✅ **所以改成用【大括號深度】做結構解析,不再比對行的長相。** 四版解析器的分母:
```
repo 型別檔支數:84(初版) → 86 → 97 → 99(結構式)
```
⇒ 🟢 **而 §8 那個答案【四版都是 8】** —— 分母一路變,那 8 支一支沒變、也沒多出來。
   📌 **這才是我敢把 8 寫成結論的理由:它撐過了四把不同的尺。**(§8 的 84/75 兩個數字請讀成 **99/90**。)
⇒ 📌 **判斷句:同一把尺連壞兩次以上,就不要再補那把尺 —— 換一種量法。**

### 9-4 這一節**沒做**的

- **那 148 支「沒有呼叫端」是用 `.rpc('字面值')` 找的。** 動態名字、從 SQL 內部呼叫(trigger / 其他函式)、cron 直接叫的**都找不到**。
  ⇒ 🛑 **「沒有 TS 呼叫端」≠「沒人用」。** 那 148 支大部分看起來是內部 helper,但我**沒有逐支確認**。
- **那 15 支我沒有逐支比參數對不對。** 這格答的是有沒有型別守著,不是守得對不對。
- **沒判斷該不該把它們補進型別檔。** 補進去會動 `packages/adapters`(鐵則 8)⇒ **要 Sean 批。**
  ✅ **其中訂單自訂檢視那四支 Sean 已拍甲(留著、補型別、不 DROP)⇒ 見 §10,含兩個還沒關掉的盲區。**
- 🛑 **`.rpc('…' as never)` 那一支我沒去追為什麼要這樣寫** —— 有可能是刻意的,也有可能是繞過紅字。**沒查就不判。**

## 10. ✅ Sean 拍 Q4 甲:訂單自訂檢視那四支 **留著不動,併進本批補型別**

> 拍板時間 2026-09-18 凌晨,**經主視窗轉述**(我沒有直接收到 Sean 的字面)。
> 完整查證過程 `~/pcm-mailbox/查證-訂單自訂檢視四支RPC-還有沒有人用-0918.md`。
> 🛑 **不 DROP、不做畫面。** 這四支就是 §9 那 15 支的其中四支的鄰居 —— 它們連呼叫端都沒有。

### 10-1 決定

```
admin_list_saved_order_views
admin_create_saved_order_view
admin_update_saved_order_view
admin_delete_saved_order_view
＋ 空表 public.admin_saved_order_views
⇒ 一律【留著不動】, 只把這四支的型別併進本批一起補。
```

### 10-2 🛑 早上動手的人必須先讀這一段 —— **結論是 🟡,不是 🟢**

**🔵 最硬的正面證據:那張表從來沒有過一列。**
```
SELECT count(*) FROM public.admin_saved_order_views  ⇒ 0
pg_stat_user_tables:  插入 0 / 更新 0 / 刪除 0 / 現存 0
pg_stat_database.stats_reset ⇒ 空(沒有歸零過)
🔵 正對照(同一發 SQL):orders 10 列 / order_items 11 列;orders 插入 9 更新 17 刪除 1
```
⇒ `create` / `update` / `delete` 那三支**從來沒有成功寫進去過一次**。

**🛑 而我關不掉的兩個盲區(這就是它是 🟡 的原因):**

| # | 盲區 | 為什麼關不掉 |
|---|---|---|
| ① | **`list` 是唯讀的** | 唯讀呼叫**不留任何痕跡** —— 表不會動,而 `track_functions` 又是 `none`。⇒ 🔴 **有人每天叫它一萬次,我這套方法量到的會一模一樣。** |
| ② | **我只搜了 `pcm-shop` 這一個 repo** | GRANT 是 `service_role` ⇒ 🟢 **客人的瀏覽器與外部都叫不到(沒有安全面)**,但🔴 **任何拿著 service_role key 的東西都叫得到** —— 報價單專案、手動腳本、Supabase 後台有人手點,全在我視線外。 |

**🛑 而「呼叫統計」那一格【答不了】,不是答 0:**
```
track_functions = none
🔵 正對照:pg_stat_user_functions 對 create_order / admin_search_orders
         (這兩支天天在跑)也是【空白】
```
⇒ 📌 **誰要拿「統計是 0」當證據,那是把「沒有量測」讀成「沒有」。**

### 10-3 🎯 所以早上補型別的時候

- **可以**照補,它們是活的、PostgREST 吐得出來的函式,補型別零風險。
- 🛑 **不要順手 DROP**,也不要因為「反正沒人用」就跳過驗證。
- 🛑 **要 DROP 得先關掉 §10-2 盲區②** —— 確認沒有別的專案拿 service_role 在叫。那不是本批的事。

— END —
