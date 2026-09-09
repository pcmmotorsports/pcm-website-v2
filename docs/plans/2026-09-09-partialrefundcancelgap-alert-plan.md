# `⟦auth-PARTIALREFUNDCANCELGAP⟧` · 取消 + 只退一部分的單要被告警看到 —— plan

> **2026-09-09 · 窗 B(`pcm-ops`)寫 · 板列 `docs/launch-todo.md:2480`**
> 🛑 **本檔是 plan,零施工** —— 不動碼、不開 RPC、不貼 migration。鐵則 8 + 12①③ ⇒ **批了才開工。**
> 🔵 **方向不必再問 Sean** —— 他 QB-16 已經拍了(§2)。要批的是**做法**,不是方向。
> 🔴 **第 2 版。** 第 1 版 codex R1 判 **FAIL(4 must-fix + 4 nit)**;本版逐條收。
> ⚠️ **而 R1 抓到的四條裡有兩條是「我把一個沒查的東西寫成結論」** —— 標在各節開頭,不藏。

---

## §0 一句話

**一張「取消了、而且只退了一部分」的刷卡單,兩條寄信線都不會把它掃進來 ⇒ 客人的錢動了,
而這兩條線不會通知他。**
⚠️ ⛔ ~~「客人零通知」~~ —— 那句超出證據(§1-a):他可能在取消前已收到部分退款信,或被人工通知過。
Sean 拍的處置是「**去告警不去客人信箱**」,而**告警那一側今天沒有它的位置**。

---

## §1 讀數 —— 而這一節的重點是「兩行字面直接對消」

### 1-a 兩條寄信線的述詞(**取自線上實體 `pg_get_viewdef`,不是讀 migration**)

```
pcm_cancelled_email_pending
  WHERE o.payment_method = 'tappay'::text
    AND o.payment_status = 'refunded'::payment_status
    AND o.cancelled_at IS NOT NULL AND NOT (EXISTS ( …

pcm_partial_refund_email_pending
  WHERE o.payment_method = 'tappay'::text
    AND o.payment_status = 'partiallyRefunded'::payment_status
    AND o.cancelled_at IS NULL
    AND r.status = 'confirmed'::text AND r.backfilled_source IS NULL AND NOT (EXISTS ( …
```

🎯 **目標單 = `partiallyRefunded` + `cancelled_at IS NOT NULL`**:
- 取消信線要 `= 'refunded'` ⇒ **狀態欄**把它排掉
- 部分退款線要 `cancelled_at IS NULL` ⇒ **取消欄**把它排掉

📌 **兩個述詞在【兩個不同的欄】上各自排掉它 ⇒ 不需要跑資料就成立。**
✅ **codex R1 核過**:repo 內兩張 view 的 `OR` 都被限制在其他條件內,**沒有繞過狀態／取消條件的頂層 `OR` 或 `UNION`**。

⚠️ **而【結論的射程】要收窄兩格(codex R1 nit)**:
1. 板列原句自標「**兩邊都撈不到』仍是讀述詞推的**」—— 本節把來源從 repo 換成線上實體,
   **而它仍然是「讀述詞」** ⇒ 🛑 升級的是**來源的權威性**,不是證明的種類。**不要讀成「實跑過了」。**
2. ⛔ ~~「⇒ 客人零通知」~~ **超出證據**:客人**可能在取消前已收到部分退款信**,也可能被人工通知過。
   ✅ 精確版:**在這個狀態下,這兩張 view 不會再把它掃進來。**

### 1-b 實跑那一格 —— **做不到,而原因本身要記下來**

```
SELECT count(*) FROM public.pcm_cancelled_email_pending
  ⇒ ERROR: permission denied for view pcm_cancelled_email_pending

誰 SELECT 得到這兩張 view:
  pcm_cancelled_email_pending       ⇒ service_role
  pcm_partial_refund_email_pending  ⇒ service_role
  (anon / authenticated / pcm_readonly ⇒ 零)
```
🔴 **⇒ 上線後要回答「今天有沒有客人被靜默丟掉」的人,`scripts/readonly-prod-sql.sh` 那條路走不通** ——
他得拿 `service_role`,而那是**動得了錢**的角色。
🛑 **本片不補那道 GRANT** —— 那是 schema 變更,且與窗 C 正在做的 RLS/GRANT 那族撞在一起,要一起判(主視窗 2026-09-09 指定)。**這一格只登記,不處理。**

### 1-c 今天的母體大小

```
orders 全表                              4   (全部是測試單)
payment_status = 'partiallyRefunded'     0
目標單(partiallyRefunded + 已取消)      0
🟢 正對照 同一條連線讀得到 products 25,773 列 ⇒ 尺不是恆回 0
🔵 負對照 餵現造狀態值 ⇒ ERROR: invalid input value for enum ⇒ 值域由 DB 管
```
🛑 **這個 0 的正確讀法**(照 `-db` 在 `⟦auth-MANUALORDERLIMITBURN⟧` 立的那條):
- ⛔ **不是**「今天 0 個客人被丟掉,所以不急」
- ✅ **是**「這個形狀**今天還沒有機會發生** —— 全站只有 4 張測試單」

⚠️ **而這個 0 的射程要縮兩格(codex R1 nit)**:
- ⛔ ~~「這個值**從來沒有**出現過」~~ ⇒ ✅ **當下為 0**。歷史我沒查(沒有稽核或快照可以答)。
- ⛔ ~~「上線前**一次都不會**叫」~~ ⇒ ✅ **今天的母體是 0,所以現在不會叫**;上線前會不會有人造出那種單,我證不到。
- ⛔ ~~products 非零 ⇒ 可見範圍完整~~ ⇒ ✅ 它**只排除「連線恆回零」**,不證明我對 `orders` 看得完整。

---

## §2 為什麼做 —— 方向已拍,引出處

板列 `:2480` seg 4 逐字:
> ✅ **處置照 Sean 自己的拍板**:他 QB-16 選的是「退了一部分、**單子沒有全退**」,
> 而對「帳對不上」那一群逐字說「**去告警不去客人信箱**」。

⇒ 🔵 **所以本片【不寄任何一封信給客人】。** 這一句要進驗收:**outbox 新增列數恆為 0**。
🛑 **而它證得到的比看起來少,兩層都要講**(codex R2 nit):
· 它**不證明告警送到了** —— 那要走完通知路徑(§7①②)。
· 它**也不證明沒有寄客人信** —— 它只證明**沒有新增入列**,而**既有的列仍可能被 sweeper 寄出去**。

---

## §3 🔴 接哪一條 —— **我不選邊,列給主視窗判**

### 3-0 先找免費的路 ⇒ **已查三族,皆不能完整涵蓋目標**

| 既有告警族 | 它的母體 | 收不收目標單 |
|---|---|---|
| `orderRefundsStuck*` | 退款列仍在 `processing` 且符合逾時／證據條件 | ❌ **不涵蓋**,而**不重疊沒被證明**(見下) |
| `unpaidCancelledGap*` | **未付款**取消(沒有錢要退) | ❌ 母體不同 |
| `cancelledMixedRail*` | 述詞**逐字鏡像 `pcm_cancelled_email_pending`** ⇒ 要 `payment_status = 'refunded'` | ❌ **狀態欄就排掉了** |

🔬 第三格是量到的:`20260906960000_m4b_cancelled_mixed_rail_phone_notified.sql:148` 逐字
「**述詞逐字鏡像 `public.pcm_cancelled_email_pending`**」,而 §1-a 量到那張 view 要 `= 'refunded'`。
⇒ 📌 掛進去 = 讓一支自稱「鏡像那張 view」的函式開始說謊。

⛔ ~~**「免費的路不存在」**~~ 🔴 **那句過強(codex R1 nit),收窄成**:
> **已查三族,皆不能【完整涵蓋】目標。**
· `orderRefundsStuck` 的真正條件是退款列仍卡住 ⇒ **「母體不同」證不了不重疊**:一張部分退完的單,
  另一筆退款仍可能卡在那一族裡。⇒ **兩族可能對同一張單各叫一次**,那要在實作時處理去重。
· 另有 `CARD_CANCEL_REFUND_REMINDER`(`check-anomaly-alerts.ts:823`)—— **它是固定提醒句,不是計數**,答不出「今天有幾張」。
· 🛑 **我讀的是 `AnomalyAlertSummary` 的欄位表,不是 3,038 行全文** ⇒ **不能排除全部替代路徑。**

### 3-A 加進既有的 `get_cancelled_mixed_rail_gap_counts()`(多回一個 key)
```
做法  那支回 jsonb{pending_manual_send_count, oldest_pending_cancelled_at,
                  cancelled_refunded_total_count}, 多塞一個 key
好處  🟢 不新增 DB 物件 ⇒ 不新增 GRANT 面
代價  🔴 **那支的主詞是「混合軌」** —— 它的 COMMENT 與 :148 自陳鏡像那張 view
      ⇒ 塞一個不屬於那個受詞的 key = 讓它的自陳變成假的(⚠️ **而 COMMENT 可以跟著改,
        所以這是【要不要改契約】的取捨, 不是不可跨越的限制** —— codex R1 nit)
      🔴 它有存在性 shape 自檢(`v_shape ? '…'` 三行)⇒ **加 key 不會讓它自動紅**, 要自己補一行
      ⛔ ~~adapter 那側幾乎零改~~ **過度絕對**:raw pg 不代表不用改, 它仍須解析新 key 並往下傳
🛑 **我不建議 A** —— 理由是**它會製造今天這一列自己在抓的那種病**(一句自陳替另一件事背書)。
```

### 3-B 新開一支 `get_partial_refund_cancel_gap_counts()`(**建議**)
```
做法  新 migration:CREATE FUNCTION, 回 jsonb{pending_count, oldest_cancelled_at, total_count}
      述詞 = tappay + partiallyRefunded + cancelled_at IS NOT NULL + §3-B-2 那個 anti-join
      adapter 抄 get_cancelled_mixed_rail_gap_counts 那一段(含「函式不存在 ⇒ null」那條)
      domain 加三欄 + 一個 *Unknown 布林(照既有慣例:三態不是兩態)
好處  🟢 受詞乾淨 ⇒ 每一支函式只講一件事
      🟢 形狀抄既有那支 ⇒ 不發明新做法
代價  🔴 **鐵則 12③ 的完整片**:新 DB 物件 ⇒ 要 migration、要 Sean 貼、要 codex 對抗審查
      🔴 **收權要跟著新物件走, 不能只抄 `20260906970000`** —— 那支是【補既有授權】,
         不是新函式的收權範本(codex R1 nit)。新函式要在**同交易**內
         REVOKE PUBLIC/anon/authenticated + GRANT 給該給的角色 + 自檢斷言。
      🔴 owner / `search_path` 照既有新建物件的形狀(既有 `search_path=''` 本身沒問題)
```

#### 3-B-1 🔴 **通知要落在【兩個地方】—— 這一格是 R1 must-fix ①,原版整格漏掉**
```
量到的(codex 指位 + 我複核):
  告警日:summary → result → check-anomaly-alerts.ts 的告警信 builder(mixed-rail 那族在 :1360 一帶)
          ⇒ 只有 shouldAlert=true 才經 :2813 寄出
  安靜日:apps/storefront/src/app/api/cron/anomaly-alert/route.ts:932
          ⇒ !result.alerted 時呼叫 buildAnomalyQuietHeartbeatMessage
  🔬 而 CARD_CANCEL_REFUND_REMINDER(:823)**只出現在安靜日那封**(我 grep 過 builder 內容)
```
🛑 **可複現反例(codex 給的)**:目標計數 = 1,而其餘告警條件全不成立
⇒ 照 mixed-rail 的位置加一行 ⇒ **那一行完全不會寄出**(因為 `shouldAlert` 是 false);
⇒ 只補安靜日 ⇒ **其他告警成立的那一天它又消失**。
✅ **所以實作要明寫落點,而它有兩個。** 而「進不進 `shouldAlert`」是另一個決定:
· **我的建議:不進 `shouldAlert`**(理由同 `CARD_CANCEL_REFUND_REMINDER` 的檔頭:它不假裝是警報)
· ⇒ **但那表示它必須在【兩封信】裡都印得出來**,否則告警日那天它就不見了。

#### 3-B-2 🔴 **anti-join 要先答一個問題 —— 這是 R1 must-fix ②,原版只寫了「outbox anti-join」五個字**
```
既有兩族【形狀不同】, 不能隨便抄一個:
  mixed-rail        20260906960000:94   按【訂單】排除任何 order_cancelled 列 + 排除電話通知稽核
  partial-refund    20260908080000:170  按【每筆退款的 dedup_key】比對
```
🛑 **而 codex 給了一個可複現反例, 它證明「有 outbox 列 ≠ 客人收到了」**:
部分退款信先入列,**寄出前訂單被取消** ⇒ `sweep-email-outbox.ts:1522` 的資格檢查會讓它**跳過寄送**
⇒ 那一列在 outbox 裡,而信沒寄。**拿它當排除依據就會再次漏報。**

⇒ 📌 **所以要先答**:
```
甲 · 告警追【帳務仍未結清】 ⇒ anti-join 不看 outbox, 看「錢退完了沒」
     好處:已通知不等於缺口消失 ⇒ 不會被上面那個反例騙
     代價:一張已經處理完但狀態沒收尾的單會一直叫
乙 · 告警追【尚未通知】     ⇒ anti-join 看「有沒有【有效通知】」
     好處:與既有兩族同形
     🔴 代價:⛔ ~~上面那個反例會讓它漏報~~ **那句是我把一個錯的實作當成乙的代價**
        (codex R2 nit)。乙真正的代價是:**它得先定義「什麼算有效通知」** ——
        **不能拿「outbox 裡有一列」代替**(那一列可能根本沒寄成)。
        ⇒ 要寄成功的證據(`sent_at` / `provider_message_id` 之類), 而那是另一組判斷。
```
🛑 **我不選。** 而**我傾向甲** —— Sean 的原話是「**帳對不上**那一群去告警」,那是帳務語意不是通知語意。
⇒ **選定之後才定得出 `pending` / `total` / `oldest` 的母體與退出條件**,那三個值今天還沒有定義。

### 3-C 不新開 RPC,由 adapter 直接查 —— **不建議**
繞過既有的 SECDEF 邊界(每一支 gap counts 都走 SECDEF 函式,那是 RLS/GRANT 的收斂點)。
列在這裡只為了讓「為什麼要走 RPC」有一個被否決過的對照。

🎯 **⇒ 我的建議是 B,而【選邊是主視窗的】。** B 的理由一句:**唯一一條「受詞乾淨、而且抄既有形狀」的路。**

---

## §4 影響

- **今天正式庫命中 0 張**(§1-c)⇒ 這條線**現在**不會叫。⚠️ 而「上線前一次都不會叫」我證不到(§1-c)。
- **不寄任何客人信** ⇒ outbox 零新增列。🛑 **而那不證明告警送到了**(§2)。
- 動到的層:`supabase/migrations`(新 1 支)· `packages/adapters` · `packages/domain` · `packages/use-cases`
  · `apps/storefront/.../anomaly-alert/route.ts`(安靜日那封)⇒ **跨 5 層 ⇒ 鐵則 8。**
- 日報會多一行,大部分時候是 0。**建議不進 `shouldAlert`**,但**兩封信都要印得出**(§3-B-1)。

---

## §5 rollback —— **單一順序(R1 must-fix ③:原版說「兩個順序都安全」是錯的)**

```
✅ 正確順序(部署層面, 不可對調):
   1) 先讓【不再呼叫新函式】的版本上線, 並確認 production 跑的是那一版
   2) 確認之後才 DROP 函式:
      DROP FUNCTION IF EXISTS public.get_partial_refund_cancel_gap_counts();
      🟢 驗:SELECT to_regprocedure('public.get_partial_refund_cancel_gap_counts()')::text  ⇒ 空
```
⛔ ~~「兩個順序都安全」~~ **那句是錯的。** 反向順序(先 DROP、碼還在)的代價是**可執行的、而且會被看見**:
```
adapter 那條降級是真的(codex 核過 PgAnomalyAlertReaderAdapter.ts:416):
  只有 42883 且二次探測確定函式不存在 ⇒ 保留空陣列 ⇒ :1906 產生 Unknown=true、計數 null
  (連線包裝沒有 BEGIN ⇒ 沒有「交易失效導致探測跑不動」的問題;42501 或函式內部的 42883 會上拋)
🔴 **而完整路徑不止於此**:apps/storefront/.../anomaly-alert/route.ts:706
   會記失敗心跳、回 **503**、**提前結束** ⇒ 📌 **安靜日那封信寄不到。**
   🛑 **而這一格是【實作要求】不是現況**(codex R2 nit):`:706` 今天**只檢查 `cancelledMixedRailUnknown`**
      ⇒ 新函式缺失要得到同樣的 503, **必須替新的 `*Unknown` 補上同型分支**。
      ⚠️ 不補的話, 反向順序的代價**不是 503, 而是【安靜地少一個計數】** —— 那更糟。
⇒ 反向順序 = 用「一天沒有心跳」換「早幾分鐘 DROP」。**不划算, 所以不採用。**
```
🛑 **而 `git revert` 那一半也要講清楚**:`git revert --no-commit` + 本機三綠
**不會讓線上舊呼叫端消失** —— 要等那一版**真的部署**。上面第 1 步講的就是這件事。

---

## §6 不在本片射程

### 6-a 匯款單那半
兩條線的第一道濾網都是 `payment_method = 'tappay'`,而正式庫量到:
```
payment_method | payment_channel | 張數
tappay         | tappay          |  1
(NULL)         | bank_transfer   |  3
```
`NULL = 'tappay'` 求值是 **NULL 不是 false**,`WHERE` 只收 true ⇒ **那三張被第一道濾網排掉。**
🔬 逐字套在三張上,`passes_view_filter` 三格全回空白(NULL)⇒ 演示到了。

⚠️ **射程要縮(codex R1 nit)**:⛔ ~~「所有匯款單永遠如此」~~ ⇒ ✅ **對【這三張現況】成立**;
`payment_method` 之後會不會被填上,我沒查。
🛑 **不是新發現** —— `⟦b4-BANKGIVEUPPATH⟧`(`docs/launch-todo.md:459`)已點名同一道濾網,受詞不同。
🔵 **而「擴到匯款要改文案」那句也要收窄**:若只擴**告警**的涵蓋,**不需要**改客人退款信文案;
只有要**寄信給匯款客人**時才會撞到 `buildOrderPartiallyRefundedText` 逐字「款項將退回您原本付款的信用卡」。
⇒ **本片只涵蓋刷卡單。兩列要不要合併是主視窗的判斷,本檔不裁。**

### 6-b 那道 GRANT(§1-b)—— schema 變更 + 與窗 C 的 RLS/GRANT 族撞在一起,本片不處理。
### 6-c 「怎麼把錢退完」—— 本片只讓那群單**被看見**,不退錢、不改任何一張單的狀態。

---

## §7 驗收 —— **照 R1 must-fix ④ 重寫(原版有「功能失效仍全綠」的組合)**

⛔ **原版的恆綠組合**:DB 函式正確而 adapter 永遠回 `null + Unknown=true` ⇒ ①②③④**全過**,
而資料**永遠沒有抵達通知內容**。⇒ 下面每一格都要求**走完整條路**。

```
① 端到端(非零資料):在拋棄式 PG 上造一張 tappay + partiallyRefunded + cancelled 的單
   ⇒ 走完 DB → adapter → result → **實際 notifier 的內容**
   ⇒ 斷言:數字正確 **且 Unknown = false**   ← 少了後半就會被「永遠 null」騙過去
② 兩條通知路徑都要看得到(§3-B-1):
   · 只有本目標異常(其餘全靜)⇒ **安靜日那封**印得出那一行
   · 另有其他異常(shouldAlert=true)⇒ **告警日那封**也印得出那一行
③ 權限:`payment_confirmer` 執行得到;`anon` / `authenticated` / `service_role` 執行不到;
   並核對 owner 與 `search_path`
④ 🔴 **反例要分兩堆, 而【方向不同】**(codex R2 must-fix:我第一版把第四格放錯堆):
   · **必須【排除】** 三格:未取消(cancelled_at IS NULL)· 非 tappay · 已 refunded(取消信線的母體)
   · 🛑 **必須【納入】** 一格:**已有 outbox 列但那封信【未寄成】、而帳務仍未結清、也沒有其他有效通知**
     ⛔ ~~我第一版把它放進「必須不被算進去」~~ ⇒ **那等於把漏報寫成預期行為, 而測試會綠。**
     ⇒ 📌 **甲(追帳務)會納入它;而乙(追通知)【也應該納入】** ——
       「乙必然漏報」是我把一個**錯的實作**(有 outbox 列 = 已通知)當成乙的必要代價。
       ✅ 乙要成立, 得先定義**什麼算「有效通知」**(寄成功的證據), 不能拿「有列」代替。
⑤ outbox 新增列數 = 0 —— 🛑 **它只證明【沒有新增入列】**:既有列仍可能被寄出, 而告警成不成功它也答不出。
   ⇒ 保留當一格便宜的回歸檢查, **不可當主驗收**。
⑥ 🛑 **本片證不到:上線後真的命中一次。** 那要等第一張真的「部分退款 + 取消」單
   ⇒ **不得寫成「做完」** —— 碼上正確與線上真的叫過一次是兩個宣稱。
```

---

## §8 本檔證不到什麼

1. **沒有實跑那兩張 view**(唯讀角色被拒,§1-b)⇒ 「兩邊都撈不到」仍是**讀述詞**,只是讀線上實體。
2. **沒有讀完 `check-anomaly-alerts.ts` 全文**(3,038 行)⇒ §3-0 只能說「**已查三族皆不能完整涵蓋**」,
   **不能說「沒有第四條路」**。
3. **沒有在鑽機上造過那種單** ⇒ §7 全部是設計,不是跑過的結果。
4. **沒有驗完整通知路徑** —— §3-B-1 的兩個落點是**讀碼 + codex 指位**,我沒有實際送過一封信。
5. **沒有定義 outbox 排除／「處理完成」的語意** —— §3-B-2 停在把甲乙兩個選項列出來,**未選**。
6. **rollback 的降級行為未實測** —— §5 那條「反向順序會回 503、安靜日信寄不到」是 codex 追碼得到的,
   **沒有人真的 DROP 過一支函式再看 cron**。
7. **本版已過 codex R1**(FAIL,4 must-fix + 4 nit,逐條收在上面)⇒ **改完要再送一輪 R2。**
