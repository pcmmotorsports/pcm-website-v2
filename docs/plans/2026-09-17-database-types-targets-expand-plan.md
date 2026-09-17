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

### 🟢 堆一:生成器版本差(18 行,型別/程式行)—— 不是損失
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
- 那 26 行「型別/程式行」我**全部看過**(不是抽樣),而其中 `p_reason: string | null` / `p_edelno: string`×2 那幾行
  **對應到哪一支函式我沒逐行追** —— 它們落在 3 個 STOP 的區塊裡,補 `TARGETS` 之後由那 3 個 STOP 的處置決定。

— END —
