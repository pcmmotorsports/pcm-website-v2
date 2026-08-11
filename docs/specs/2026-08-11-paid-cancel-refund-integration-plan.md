# ④ 已付款取消 × 退款整合 —— plan **定稿 v2**(E 窗七代;三題全拍)

> **狀態:定稿(v2)—— 三題已由 Sean 拍板(全 A),仍**不是開工令**。**
> 拍板 `E-341-A`(2026-08-12 00:4x);v1 草稿授權見 `E-334-A`。
> 🔴 **實作開工令仍等 2g 落地後由主視窗發**;本檔仍是純 docs、零實作。
> 本檔要回答 line map(`docs/specs/2026-08-11-refund-line-map.md:70-73`)那格未答的事:**④ 到底是幾片、片界在哪、停幾次**。
> 上游依賴:② 的 **2g** + ① **RF7**;「有效事件」語意**一律引** P 八代沖銷片的 canonical view,**本檔不自定義**。

---

## §0 一句話結論

**「已付款取消」今天不是「還沒做 UI」,是構造上不可達** —— 取消線與退款線的入口條件在 DB 層**互斥不相交**,
而且兩線**互相不知道對方存在**。④ 因此**不是一片**,最少是 **3 片 + 1 個先決語意題**,並且**至少多一個 apply 停點**。
⇒ line map 知情缺口 #2(「14 只會變大」)**成立**,本檔把它量成具體數字。

---

## §1 現況三條硬事實(逐條可核;行號 2026-08-11 23:4x 現量)

### F1 — 取消線硬鎖 `unpaid`,DB 與畫面兩層都是

| 層 | 座標 | 字面 |
|---|---|---|
| 整單取消 RPC 步7 | `supabase/migrations/20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:199` | `IF v_order.payment_status <> 'unpaid'::public.payment_status` |
| 同支的**冪等格** | 同檔 `:171` | 冪等重播也逐欄比 `payment_status = unpaid` |
| 部分取消 RPC 步7 | `supabase/migrations/20260805100000_m4b_e10_a8a2_partial_cancel.sql:360` | 同字面 |
| 同支的冪等格 | 同檔 `:290`、`:307-308` | `after.payment_status` 恆 `unpaid` |
| 畫面拒因 | `apps/admin/src/lib/orders/cancel-view.ts:499` | `payment_not_unpaid` |

🔴 **注意冪等格那兩處**:它不只擋「不能取消」,它還把 `unpaid` 寫進了「這次重播算不算同一件事」的定義。
⇒ **放寬允許集合 ≠ 改一行述詞**;冪等指紋的語意要一起重新定義,否則放寬之後重播比對會拿舊定義去比新形狀。

### F2 — 退款線的入口白名單與 F1 **不相交**

`supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:255-257`:

```
IF v_payment_status IS NULL
   OR v_payment_status NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
```

⇒ 取消要 `unpaid`、退款要**非** `unpaid`。**同一張單在同一時刻只可能滿足其中一邊。**
這正是「已付款取消 + 一併退款」在今天**寫不出一條成功路徑**的原因,不是介面缺一顆鈕。

### F3 — 兩線互相不知道對方存在(雙向零命中)

| 方向 | 量法 | 結果 |
|---|---|---|
| 退款寫入 RPC 知不知道「取消」 | `grep -n 'cancelled' 20260803150000_*.sql` | **零命中** |
| 退款應用層知不知道「取消」 | `grep -rn 'cancel' apps/admin/src/lib/payment/*.ts`(排除 `.test.ts`) | **零命中** |
| 取消 RPC 知不知道「退款」 | A8a1/A8a2 的允許集合只看 `payment_status` 與 attempts | 不讀任何退款帳本 |

⚠️ **量的邊界(誠實界)**:F3 我量的是 `apps/admin/src/lib/payment/` 與那支 migration,**不是全 repo**。
「兩線完全不相干」這句**只在這個範圍內成立**;`packages/` 側我沒逐檔掃。

### F4 — 畫面上兩個區塊今天是**平行、不互斥**的

`apps/admin/src/components/orders/order-detail.tsx`:`:351` `<OrderCancelBlock>`、`:384` `<RefundLedgerSection>`、`:402` `refundEnabled &&` 才渲染 `<RefundSection>`。
兩者各自有各自的閘,**沒有任何一行 code 說「取消跟退款要一起發生」**。
⇒ Sean 07-26 的「**強制二選一**」在現行結構裡**沒有落點**,得先決定它住哪一層(§4 決策題 D2)。

---

## §2 Sean 07-26 Q11=A 拍板拆出來的**三個**交付物

逐字(memory `project_m4b-admin-preview-decisions.md:24-25`):

1. **已付款的訂單也能取消**(推翻既有 PRD §4.2)
2. **補守門=取消時強制二選一(一併退款 / 先取消稍後退),不允許取消完不管錢**
3. **取消後可復原;閘門=未退款可復原、已退款不可**;🔴 復原訂單 ≠ 復原採購

⇒ line map 把這三件事壓成一格 ⇒ 那一格**至少三片**。第 3 項尤其獨立:它是**反向操作**,
而且它要回答「這張單到底有沒有退款」—— 那是 canonical 語意題,不是 UI 題(§3 ④-d)。

---

## §3 片界建議(④ = 3 片 + 1 先決語意題)

| 片 | 內容 | 面 | 片型 | 依賴 | apply 停點 |
|---|---|---|---|---|---|
| **④-0**(先決,**非施工片**) | 語意釘死:已付款取消之後 `payment_status` 與 `cancelled_at` 的狀態機關係;「取消」是否改動 `payment_status`;取消與退款誰先誰後 | 純決策 + docs | — | 無 | 無 |
| **④-a** | 放寬 A8a1/A8a2 允許集合 + **重新定義冪等指紋**(F1 那兩處)+ 「不允許取消完不管錢」的 DB 側落點 | migration(**動已上線金流 RPC**) | 🔴 高風險(鐵則 12①③) | ④-0、2g、RF7 | 🔴 **新增 Sean 停點** |
| **④-b** | 應用層 + UI:`cancel-view` 拒因改寫、二選一表單、與 `RefundSection` 的互動 | 應用層 + UI | 標準片 | ④-a apply 後 | 無 |
| **④-d** | **復原**(未退款可復原、已退款不可)+ 「復原訂單≠復原採購」的商品狀態退回 | migration + 應用層 | 🔴 高風險 | ④-a/b + **canonical view**;🔴 **④-Q3=A ⇒ 排在 ⑤⑥ 之後**(§4b-4) | 🔴 **可能再一個** |

⚠️ **④-a 與 ④-b 不得同片**:④-a 改的是正在收錢/退錢的 RPC,母 plan 對 2e/2f 的紀律(「各自單獨過對抗審查、不合併審」,line map `:54`)同樣適用。
✅ **④-d 獨立排、且排在 ⑤ 開燈與 ⑥ 真退款之後 —— 已由 ④-Q3=A 拍定**(~~v1 此處原為「我建議」~~)。理由不變:它是唯一一片「錢已經退出去之後才用得到」的功能,在真退款實測前沒有真資料可驗。

**⇒ 對 line map 的回饋**:④ 由 1 格 → **3 片**,停點由「未定」→ **最少 +1、可能 +2**。
14 片 → **16 片**、6 停點 → **7~8 停點**。(數法:14 − 1 + 3 = 16。)

---

## §4 決策題 —— **三題全數拍板(Sean 2026-08-12 00:4x,全照推薦)**

> 拍板出處:主視窗 `E-341-A`(Sean 逐字「桌上五題 依照推薦」)。題號前綴 `④-` 是必要的
> (`E-336-A` §2:D 窗同晚另有一組 `Q-D1`~`Q-D5`,同名不同題)。~~v1 原用 `Q-D1/Q-D2/Q-D3`~~ 已改。

| 題 | 拍板 | 內容 |
|---|---|---|
| **④-Q1** | **A** | 取消**不動** `payment_status`(維持 `paid`/`partiallyRefunded`/`refunded`),只寫 `cancelled_at`。取消 = 業務標記,錢的狀態由退款帳本自己說。**「已取消且仍 paid」是新形狀。** |
| **④-Q2** | **A** | 「強制二選一」住 **DB 層** = 取消 RPC 多一個**必填參數**(一併退款 / 稍後退)。⇒ 擋得住直接打 RPC,「不允許取消完不管錢」是**機制承諾**不是 UI 承諾。 |
| **④-Q3** | **A** | **④-d 復原片排在 ⑤ 開燈 / ⑥ 真退款之後**。在那之前它沒有真資料可驗。 |

⇒ **§3 的 ④-0(先決語意題)由 ④-Q1 釘住大半**;剩下的語意題(§4b-1 的「新形狀怎麼分流」)
**不另開片**,依主視窗 `E-341-A` §2 **寫進 ④-a 自己的 plan**。

---

## §4b 三個答案帶出來的施工面(**這節是定稿新增的,v1 沒有**)

### §4b-1 ④-Q1=A 的第一個連帶:**退款發起路徑不必改** —— F2 那條白名單從障礙變成便利

`payment_status` 不動 ⇒ 取消後它仍在退款白名單 `('paid','partiallyRefunded','refunded')` 內
(`20260803150000:255-257`)⇒ **「先取消、稍後退」在 DB 層天然走得通,退款側零改動**。
🔴 但**反向也成立**:退款路徑全程不看 `cancelled_at`(§1-F3 雙向零命中)⇒
「已取消」既**不阻止**退款、也**不要求**退款 ⇒ **「不允許取消完不管錢」完全靠 ④-Q2=A 那顆必填參數撐**,
沒有第二道網。這一點要在 ④-a 的驗收條件裡明寫。

**剩餘語意題(移交 ④-a plan)**:`flagNonUnpaidActive`(`PgChargeAttemptAdapter.ts:210`)會把
「非 unpaid + attempt 仍 active」標人工;④-Q1=A 之後「**已取消 + 仍 paid + attempt 仍 active**」是新形狀,
它會被標人工 —— **那是對的還是噪音**,④-a 要答(即 §6 的 7-1 重問)。

### §4b-2 ④-Q1=A 的第二個連帶:**部分取消不會扣減「帳本未登記額」的基數**

`pcm_order_refundable_remaining` 的基數是 `orders.total`,**式子裡沒有任何取消項**
(`20260803150000:401-407` 逐字 `SELECT o.total::bigint - COALESCE((SELECT SUM(r.refund_amount) …), 0)`)。
⇒ ④-Q1=A 之下,**部分取消之後該值仍以全額 `total` 為基數**。

⚠️ **精確界定(不要把它說成守門失效)**:該函式的 `COMMENT` 逐字自陳
「🔴 **不是守門、沒有 trigger 讀它**」「UI 措辭必須是『帳本未登記額』不得寫『還能退多少』」
⇒ 它**不會擋、也不會放行**任何退款,**不存在「因此超退」的路徑**。
它是**顯示面**:員工看它決定要退多少。⇒ 真正的題是「**部分取消後,顯示給員工的基數該不該扣**」,
屬 ④-a/④-b 的範圍,**本檔只標出來、不自己拍**。

### §4b-3 ④-Q2=A 的施工陷阱 —— **範式就在同一支函式的上一次改版裡,不必重新發明**

加必填參數 = **改已上線 RPC 的簽章**。`A8a2` 上次做同一件事時把坑寫在檔頭 `:15` 逐字:

> 簽名=DROP 5 參+CREATE 6 參(**加 default 走 `CREATE OR REPLACE` 會產生第二 overload**=PG…)

⇒ **④-a 必須 DROP + CREATE,不得 `CREATE OR REPLACE`**,否則多長一個 overload 出來。

而 overload 本身有**四道閘**在守,④-a 要自己帶同款、且**期望值要重新決定**(它會是第三版):

| 閘 | 座標 | 現行期望值 |
|---|---|---|
| A8a1 前置 | `20260804180000…a8a1…sql:51` | 首建 = **0** |
| A8a1 後置 assert | 同檔 `:281` | 恰 **1** |
| A8a2 前置 | `20260805100000…a8a2…sql:40` | 恰 **1**(= A8a1 版) |
| A8a2 後置 assert | 同檔 `:507` | 恰 **1** |

🔴 **還有一個 v1 沒看到的連動面:改簽章要重 gen 型別**。
`packages/adapters/src/supabase/database.types.ts:106` 記著現行簽章逐字
`public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) → jsonb`(= A8a2 那次的「CREATE 6 參」),
`:2779` 有對應的 `admin_cancel_order:` 型別區塊 ⇒ **④-a 的收工步驟必須含重 gen**,
否則型別與正式庫分岔、而 `tsc` 會綠(它信的是型別檔)。
⚠️ 重 gen 的已知副作用見 backlog **#418**(註解引用生成型別寫死行號 ⇒ 每次重 gen 整批過期)。

**應用層同步點是單一的**:`apps/admin/src/lib/orders/cancel-repository.ts:160`
`.rpc('admin_cancel_order', {…})`,該檔 `:7` 自稱「`admin_cancel_order` owner RPC 的**唯一呼叫端**」。
🔴 **跨 apply 停點紀律適用**(memory `feedback_app-layer-must-not-ship-before-migration-apply`):
新簽章的應用層**不得先於 migration apply 上線**,否則舊庫收到新參數 = 正式站壞
—— 那條教訓的事故(A9h、正式站壞約 8 小時)就是這個形狀。**④-a 的 plan 要指定觀測點**。

### §4b-4 ④-Q3=A 對排位的影響(**片數不變、排位變**)

④-d 從「跟 ④-a/b 同段」移到 ⑤⑥ 之後 ⇒ 全線仍是 **16 片**,但依賴序改成:

```
… → ④-a ──[apply 停點]──→ ④-b → ⑤ 開燈 ──[停點]──→ ⑥ 真退款 ──[停點]──→ ④-d 復原
```

📌 **line map 的字面由 P 改**(主視窗 `E-341-A` §2:「④-d 排位入 map 由 P 改」)——
本檔**不代改別人的檔**,只在這裡記下定稿後的排位供 P 取用。

---

## §5 上游依賴的現況(逐條實查,含一條**回饋給 line map** 的更正)

| 依賴 | 現況 | 座標 |
|---|---|---|
| ① **RF7** | ✅ **已實作**;🔴 **零 migration ⇒ RF7 沒有 apply 停點** | `git show --stat 3e542afc` = `settle-charge.ts` + `settle-charge.test.ts` **兩檔**,無 `supabase/` |
| ② **2g** | ⏳ 未開;契約=「advisory lock → 否決條件 → 開父列 + `sent`、`sent` 前持久化 `refunded_amount` baseline」 | `docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md:559` |
| ③ **canonical 有效事件 view** | ⏳ P 八代實作中;定義=「terminal 集合 **且** 無 `manual_reversal` 指向它」 | `docs/specs/2026-08-11-refund-manual-reversal-plan.md:124` |

🔴 **回饋 line map 知情缺口 #1**:那張圖寫「① RF7 的 apply 停點不在我射程」——
**答案是零**。RF7-fix 純應用層。⇒ 「6 個停點」那個數字**不必為 RF7 加**,但要為 ④ 加(§3)。

🔴 **④-d 對 canonical 的依賴是硬的**:「未退款可復原」要回答「這張單有沒有退款」,
而在**兩本帳**(M3 `order_refunds` / L5b `payment_refund_events`)之下那個問題有兩個答案。
⇒ ④-d **不得自己寫判準**,一律消費 canonical view(沖銷 plan `:126-127` 逐字要求「所有讀取面一律消費它、不得再自己問」)。

---

## §6 矩陣 §7 三問對本片的狀態

| 題 | 對 RF7 的狀態 | 🔴 對 ④ 的狀態 |
|---|---|---|
| 7-1 `flagNonUnpaidActive` 算不算已處理「非 unpaid + active attempt」 | 已答(fix-plan §1) | 🔁 **已移交 ④-a**(`E-341-A` §2)。④-Q1=A 之後「**已取消 + 仍 paid + attempt 仍 active**」是新形狀,`flagNonUnpaidActive`(`PgChargeAttemptAdapter.ts:210`)會把它標人工 —— 那是對的還是噪音,由 ④-a 的 plan 答(詳 §4b-1) |
| 7-2 inbox 路 1 要不要濾訂單狀態(#422) | 待裁,**不阻塞 RF7** | **同樣不阻塞 ④**,但 ④-a 會讓「已取消的單」也走進那條重試路 ⇒ #422 的裁定面積變大,建議連帶重估 |
| 7-3 「這一次」的證據粒度 | 對 RF7 已被繞開(fix-plan §3) | 🔴 **回來了,但來源已定**:④-d 判「有沒有退款」**一律引 P 的 canonical view**(`E-341-A` §3 明示;Q-425=B 已拍、P 已解鎖),**本片不自定義**。🔴 仍然**不得用 `orders.payment_status` 當證據** —— ④-Q1=A 之後它連「有沒有取消」都不反映了,拿它當退款證據會更錯 |

外加 **C1**(R3 親查、已證實):`20260810220000:362` 告警計數只計 `unpaid`
⇒ ④-a 放寬之後,**已付款取消產生的異常永遠不會進告警計數**。這條要在 ④-a 內處理,不能留給下一片。

---

## §7 誠實界(這份 plan **沒有**做到的事)

1. **零實跑**。全部是讀 migration / code 得到的靜態盤點,沒有跑過任何一格。
2. **F3 的範圍是 `apps/admin/src/lib/payment/` 與那一支 migration,不是全 repo**;`packages/` 側沒掃。
3. **沒查 `flagNonUnpaidActive` 的掃描條件與觸發頻率** —— 與矩陣 §6-2 同一個未查項,我沒補上。
4. **沒查「復原」今天有沒有任何既有實作**(我只確認 Sean 拍過板,沒 grep 過 restore/uncancel 面)⇒ ④-d 的片界是**四片裡最軟的一格**。
5. **片數 16 是「按本檔片界」的數**。~~④-0 若拍出 ④-Q1=B,④-a 會再長大~~ **④-Q1=A 已拍 ⇒ 這個放大路徑關閉**;但 §4b-3 的簽章改版(DROP+CREATE + 四道 overload 閘重定期望值)是 v1 沒看到的體積,**④-a 仍可能自己要再拆**。
6. **§4b-2 我只證了那支函式的式子裡沒有取消項,沒有窮舉「還有誰在算可退額」** —— 若別處另有一份基數計算,那格的結論要重估。
7. **§4b-3 的四道 overload 閘我是逐行 `sed` 印出來對的,但沒實跑過任何一支 migration**;「DROP+CREATE 才對」是讀 `A8a2:15` 的檔頭字面得到,**不是我實驗出來的**。
8. ~~④-Q2=A 的「唯一呼叫端」沒有全樹數過~~ **已數**(2026-08-12 00:5x):
   `grep -rn "admin_cancel_order" apps packages | grep -v /.next/ | grep -v '\.test\.'` = **13 命中**,
   但**真正的 `.rpc(` 呼叫點恰 1 處**(`cancel-repository.ts:160`);其餘 12 處是註解、docstring 與
   生成型別。🔴 **13 與 1 的差距就是 memory `reference_grep-keyword-count-includes-comments` 那條** ——
   要數呼叫端就數語法位置,不能數關鍵字命中。
9. 行號=2026-08-11 23:4x 與 2026-08-12 00:4x 兩批現量;**引用前重量**(六代 N1 的同型教訓)。

---

## §8 與鄰片的邊界(主視窗 `E-334-A` §3 劃界)

- **S 五代的 `refund-ledger-ui-plan`** 管**帳本讀取 UI**;本片管**取消→退款的流程整合**。
  交界=`order-detail.tsx` 那三個區塊(`:351` / `:384` / `:402`)的**版面與互斥關係**,
  ⇒ 誰動 `RefundLedgerSection` 由 S 決定,誰動 `OrderCancelBlock` 由我決定,**二選一表單的位置**要兩邊對過再落。
  ⓘ 順帶:line map `:81` 說「L5b 帳本零 UI」——**那句只對 L5b**;M3 舊帳本的 `RefundLedgerSection` 是存在的,別讀成「退款完全沒畫面」。
- **P 八代的沖銷片**交付 canonical 語意;本片是它的**消費者**,不自定義(§5)。
- **#425**(`paid` 短路格)隨本線首顆**實作** commit 帶進 backlog。⚠️ **下一號已不是 #426** —— #426 已被 `is_active` 過期註解那條佔用(`92c72f2a`),**發號帳現值 #427**(`E-338-A` §3)。

---

— E 窗七代,**定稿 v2**:2026-08-12 00:5x(三題全拍後收題 + §4b 新增);v1 草稿 2026-08-11 23:4x。
**未實作、未 commit code、實作仍等 2g 開工令。**
