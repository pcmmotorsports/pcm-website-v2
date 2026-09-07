# `⟦db-ZEROTOTALSPLIT⟧` 拆分 plan(鐵則 8;**只 plan, 本次零改動**)

> 出:線【資料】`-db` 2026-09-07 · 主視窗 A 派 · **等批准才動**
> 🔴 **本檔的每一個數字與座標都是當場量的**, 不是回想;量法都寫在旁邊, 可重跑。

---

## 0. 一句話

**76(`20260901030000_m4b_zero_total_settle.sql`)裡有【一支與券完全無關】的函式被券的閘擋在門外, 而它今天在正式庫上跑的是舊一代 —— 把那一支、也只把那一支抽出來單獨貼。**

---

## 1. 現況(量到的)

| 事實 | 讀數 | 量法 |
|---|---|---|
| 76 總行數 | **1321** | `wc -l` |
| 76 裡的函式 | **3 支** | `grep -n '^CREATE '`:`coupon_redeem_on_paid`(`:375`)· `settle_zero_total_order`(`:792`)· `admin_compute_order_settlement`(`:1051`) |
| `admin_compute_order_settlement` repo 最新一代 | **20260901030000**(= 76) | `bash scripts/latest-definition-of.sh admin_compute_order_settlement` |
| 同一支帳本上最後已記 | **20260812140000** | 同上 |
| **正式庫實際在跑哪一代** | **20260812140000**(舊的) | `python3 scripts/prod-vs-vc-functions.py` ⇒ 該支落在 🟡, 逐字「正式庫跑著較舊一代 20260812140000」 |

🟢 **兩把獨立的尺指向同一件事**(一把讀 repo + 帳本, 一把讀正式庫)⇒ 這不是單一檢查的結論。

---

## 2. 🔴 拆法與板上原本的假設【相反】—— 而這是本 plan 最重要的一段

板列原本寫的是「把 trigger 從 76 移走」。**量過之後那個方向會讓事情更糟**:

- 76 **自己就會建**券的那一套:`:375` `CREATE OR REPLACE FUNCTION coupon_redeem_on_paid()` ·
  `:637-638` 建 trigger · `:677` `ENABLE ALWAYS` · `:705-735` 三道 fail-closed 斷言。
- 76 `:285` **自己逐字寫過**:「本片自己就會建 `coupon_redeem_on_paid` + trigger ⇒ **不貼 75 也能把扣券打開**」。
- 75(`20260901021000`)用的是**裸 `CREATE FUNCTION`**(`:429`), 76 用 `CREATE OR REPLACE`
  ⇒ 📌 **這正是「順序是死的」的來源**:75 必須在 76 之前, 反過來會撞已存在。

⇒ **把 trigger 從 76 移走 ⇒ 76 再也建不出它 ⇒ 75 變成唯一建立者 ⇒ 順序依賴不減反增。**

---

## 3. 要抽的是哪一支 —— **只有一支**

### ✅ 抽:`admin_compute_order_settlement(uuid)`(76 `:1051-1298`)
**與券零關係, 這是量到的**:該段 `grep -in 'coupon'` ⇒ **0 命中**;
它讀的 12 張表(`order_payments` 5 · `payment_refund_effective_terminal` 2 · `payment_charge_attempts` 2 ·
`payment_refunds` · `payment_double_charge_anomalies` · `orders` · `order_refunds` · `order_refund_jobs` ·
`order_items` · `order_cancellations` · `order_cancellation_items`)**沒有一張是券的表**。

### ⛔ 不抽:`settle_zero_total_order(uuid)`(76 `:792-953`)
🔴 **它【語意上】依賴券, 抽出去買不到任何東西**:
該函式 `:869` 逐字 `IF v_order.coupon_id IS NULL THEN` ⇒ `RAISE EXCEPTION`
「這張 0 元單沒有帶券 —— **只有全額折抵券的單走本函式**」。
⇒ 📌 **券沒上線之前, 這支函式對每一個輸入都是拋錯。**先貼它 = 貼一個必定失敗的入口。

### ⛔ 不抽:`coupon_redeem_on_paid()` + trigger — 它就是券本身。

---

## 4. 為什麼**現在**要抽(不是整理癖)

抽出來的那一代對 live 一代有 **42 行 body diff**(`difflib`, `unified_diff n=0`;
live md5 `087a886d…` len 9719 ⇒ 最新 md5 `f134e95d…` len 11669), 而**其中一處是今天就成立的正確性修**:

- 🔴 **`voided` 排除**(⟦b4-TAPPAYDIRECT⟧ A2, 2026-09-07, codex R2 抓到):
  `WHERE orf.status <> 'failed'` ⇒ `WHERE orf.status NOT IN ('failed', 'voided')`。
  **一筆補登錯了、已作廢、錢其實沒退的訂單**, 在舊一代裡 `old_n` 仍會是 1
  ⇒ P6 判 false ⇒ **結清變 `needs_human / R_REFUND_TRACE_PRESENT`、金額輸出變 NULL**。
  ⚠️ 而 `voided` 那個值**已經存在了**(貼板 70 = `20260907030000` 已貼)⇒ **這一格今天就會踩到。**
- 🔵 另一處是 0 元單的 P5 分支 —— 它只在 `payment_method = 'zero_total'` 時成立,
  而**寫那個值的是 `settle_zero_total_order`**(還沒貼)⇒ **今天不會被觸發, 貼下去是惰性的。**

⇒ 📌 **一句話**:抽出來會**修好一件今天正在錯的事**, 而它帶進來的另一半**今天不會動**。

---

## 5. 新 migration 要帶哪些閘(而**不要**帶券的閘)

- **帶**:`admin_compute_order_settlement` 的 ACL 三 REVOKE + `GRANT … TO service_role`
  (76 `:1295-1298` 逐字)+ `has_function_privilege` fail-closed 釘。
- **帶**:前後 `md5(prosrc)` 釘死(照 `20260907140000` 的形狀 —— 那支已被 codex R1/R2 + opus R3 打過三輪)。
  前置釘 live 一代 `087a886d…`, 事後釘 `f134e95d…`。
- **帶**:單一多載釘 `(uuid)` · `prosecdef` · `proconfig` · `proowner`。
- ⛔ **不帶**:`redeem_coupon` 存在性、owner-EXECUTE、`orders.coupon_id` 這三道**券的相依閘** —— 本支不碰券。

### 版本號
🔴 **這一格要有人明說, 不要讓下一個人自己猜**:本支不碰券 ⇒ **它與 75/76 沒有順序關係**,
版本號排在 75 之前或之後都成立。**而「沒有順序關係」必須寫在檔頭**, 否則下一個人會照舊假設 75→76 的死順序。

---

## 6. 影響面

- **改的是誰**:`admin_compute_order_settlement(uuid)` 一支函式的 body(`CREATE OR REPLACE`)。
- **誰會受影響**:呼叫端只有 `service_role`(唯一 `GRANT EXECUTE` 對象, 76 `:1298`)。
- **行為變化**:上面第 4 節那兩處。**已作廢的補登不再被算成退款痕跡** ⇒ 本來被錯判 `needs_human` 的單會回到正常結清。
- **不影響**:券、`settle_zero_total_order`、75、76 本身(76 仍留著它自己那一份 `CREATE OR REPLACE`,
  ⚠️ **而這代表 76 之後若真的貼, 會把本支再蓋一次** —— 兩邊 body 相同 ⇒ 無害, 但**要在兩個檔頭都寫明**)。

## 7. Rollback
**forward-only**(照全 repo 慣例)。而 🟢 **可貼回的前一代【在版控裡】**:
`20260812140000_m4b_lifecycle_refund_manual_reversal.sql:356`, body md5 `087a886d…`
⇒ 事故當下不必憑空重建, 再出一支把它 `CREATE OR REPLACE` 回去即可。

## 8. 🛑 本 plan 證不到什麼
- 我**沒有**跑過任何寫入;正式庫那一代的判定來自 `prod-vs-vc-functions.py` 的唯讀讀數。
- 我**沒有**驗證「`voided` 那一格今天真的有訂單踩到」—— 我證的是**構造得到**(`voided` 值已存在),
  不是**已經發生**。要答後者需要讀 `order_refunds`, 而我的唯讀角色沒試過那張表。
- 我**沒有**判「76 剩下那兩支什麼時候貼」—— 那是券上線的排程, 不在本 plan。

---

# 附:回答 `⟦b4-NCPCRONRACE⟧`(`docs/launch-todo.md:394`)「要不要開新片共用同一把鎖」

> 主視窗 A 2026-09-07 派。**答案:要開, 而它不是「加一把鎖」那麼簡單 —— 難的是【順序】, 不是【鎖】。**

## A. 兩側今天各拿什麼(量到的)

| 側 | 拿不拿 advisory | 鍵 | 座標 |
|---|---|---|---|
| **cron / 重算** | ✅ 拿 | `hashtextextended(p_order_id::text, 0)` = **每張單一把** | `20260904230000:201-202` |
| **收款寫入** `admin_record_manual_payment` | ❌ **零** | — | `20260810200000` 全檔 `grep -c pg_advisory` = **0** |
| **收款寫入** `confirm_card_leg` | ❌ **零** | — | `20260810160000` 全檔 = **0** |

⇒ 📌 **兩側今天【沒有共用任何一把鎖】。** cron 那把只擋得住「也拿同一把 per-order 鍵的人」, 而收款側一個都沒拿。

## B. 🔴 而「就加一把上去」會踩到 repo 裡已經有人踩過的那個環

`20260906700000` 用整整三段(`:266-277` / `:436-447` / `:711-722`)記著同一件事, 逐字:
> 「**全隊既有順序是【先鎖列、再拿 advisory】**」·「把它搬到函式最開頭 = 把三支改成【advisory→列】= 與 begin 反向
> ⇒ **我親手造出那個環**」·「**教訓(比修法重要)**:我第二版的鑽機把新世界兩個 session **都**寫成 advisory→列」

而現在兩側的順序**天生相反**:
- **cron**:`advisory` ⇒ 然後才讀/寫那一列(`20260904230000:201` 在 `SELECT` 之前)
- **收款**:`INSERT order_payments` 的 **FK 先在 orders 那一列拿 `KEY SHARE`** ⇒ 若之後才拿 advisory ⇒ **列→advisory**

⇒ 🛑 **一邊 advisory→列、一邊列→advisory = 教科書等級的死結環**, 而那正是上面那三段在講的事。

## C. ⇒ 所以新片的範圍不是「加鎖」, 是「**決定順序並讓兩側一致**」

**而它是大片, 這是量到的**:`INSERT INTO public.order_payments` 的非註解命中散在
`20260810100000`(2)· `20260810110000`(5)· `20260810130000`(3)· `20260810160000` · `20260810170000` ·
`20260810200000` · `20260810210000` · `20260811050000` · `20260812150000`(2)· `20260906700000`
—— **10 支檔**。要「兩側共用」= 這些寫入路徑**每一條**都要拿同一把鍵、而且順序要與 cron 同向。

⇒ 🔴 **依鐵則 12(①錢 ③大量寫入)與鐵則 8(跨 3+ 檔), 這必須是【自己的一片 + 自己的 plan + 不降級的對抗審查】,不是塞進本片的附帶修改。** 本 plan 只回答「要不要」與「難在哪」。

## D. 開那一片之前必須先答的三格(答不出來就不要開)
1. **順序選哪一向**?(全隊既有是「先鎖列、再拿 advisory」⇒ **改的應該是 cron 那一側**, 而不是十條收款路徑 —— 那也是**改動面最小**的一向。)
2. **鍵用哪一個**?cron 用 per-order(`p_order_id`), 而收款側附近既有的家族是 per-user(`customer_user_id`, 全 repo 8 處)⇒ **兩個家族不同**, 混用等於沒鎖。
3. **怎麼證明它真的擋到了**?—— 兩個 session 的鑽機, 而 `20260906700000:277` 記著「**我的鑽機把兩個 session 都寫成同一向 ⇒ 測不到環**」。**鑽機本身要有正對照。**

## E. 🛑 本節證不到什麼
- 我**沒有**跑任何併發實測;B 段的死結是**依既有註解與兩側順序推的**, 不是量到的。
- 我**只**檢查了 `admin_record_manual_payment` 與 `confirm_card_leg` 兩支收款函式的 advisory 命中數(各 0);
  其他 8 支檔**沒有逐支確認** ⇒ 「收款側零 advisory」這句話的分母是**那兩支**, 不是十支。

---

# 🔴 關卡 1 · codex R1 `VERDICT: FAIL` ⇒ 本 plan 的修訂(2026-09-07)

> `gpt-6-astra --disable apps -s read-only`;rc=0 / 產出 6553 行 / 回聲字 4。
> **六條我逐條核過, 其中【兩條是我真的寫錯】, 已就地改;其餘四條收窄或補上。**
> 🛑 **上面的原文一句不刪** —— 錯的字面留著, 讓照舊字面搜尋的人同一發撞到訂正。

## R1-1 「與券零關係」說過頭 ⇒ **收窄**
`admin_compute_order_settlement` **不查券表**(該段 `grep coupon` = 0)—— 這句仍成立。
🛑 **而 P5 那一支【信任】券結清入口寫進去的 `payment_method = 'zero_total'`** ⇒ 它與券**在語意上有一條線**,
只是不經過券的表。⇒ 改寫成「**不查券表**」, 不再寫「與券零關係」。
🔴 **另一句我寫錯了**:我說 `settle_zero_total_order` 券沒上線前「對每個輸入都拋錯」——
codex 反例:**若已有合法帶券的零元單、而扣券 trigger 缺席**, 它仍可能把單翻成 `paid` **而券沒扣**。
⇒ **不抽它的結論不變, 而理由要改成「會在券沒扣的情況下放行」, 比「必定拋錯」更嚴重。**

## R1-2 「今天正在錯」未證實 ⇒ **降級為「可構造」**
我在 §8 已寫「只證構造得到, 不證已發生」, 而 §4 標題寫「**今天就成立的正確性修**」⇒ **兩節自相矛盾**。
✅ 統一改成:**`voided` 那一格今天【可構造】**(值已存在), **未證實已發生**(要讀 `order_refunds`, 我的唯讀角色沒試過)。
同理 0 元 P5 那一格:「今天不會觸發」的依據只是 **repo 裡沒有 `zero_total` 的寫入點**
⇒ **排除不了正式庫既有值 / 人工寫入 / 庫外定義** ⇒ 一併收窄。

## R1-3 兩個檔頭註記不夠 ⇒ **要在 76 也加閘**
反例(codex):**新支 → 之後有人修補或 rollback 那一支 → 76 才貼** ⇒ 76 的**無條件 `CREATE OR REPLACE`**(`:1051`)
會把中間那一版**蓋掉**。📌 **註解攔不住覆蓋。**
✅ 修訂:**76 也要加一道前置閘**, 明列它可接受的前置 body md5(至少含 `087a886d…` 與新支產生的那一版);
不在清單內 ⇒ 拒貼、人來看。

## R1-4 漏了交易與替換競態 ⇒ **補**
✅ 新支要**自帶 `BEGIN` / `COMMIT`**(替換 + ACL + 事後斷言同成同敗)+ `SET LOCAL lock_timeout`。
🔴 **而前後 md5 擋不住「檢查後、別人先改、我再蓋掉」** —— 那正是 `20260907140000:46` 自己寫過的洞。
⇒ **advisory lock 的鍵要涵蓋 76**(兩支拿同一把), 只有新支拿 = 沒有互斥。
🔵 券的三道閘確認**可以不帶**(codex 同意)。

## R1-5 🔴 「與 75/76 沒有順序關係」**直接錯, 我收回**
codex 重算與我一致(舊 `087a886d…` / 76 `f134e95d…`), 而推論是:
**76 先貼 ⇒ 現行變 `f134e95d…` ⇒ 新支前置閘要 `087a886d…` ⇒ 拒貼。**
⇒ ✅ **正確說法**:與 **75** 無直接相依;**與 76 有順序** —— **新支必須排在 76 之前**,
或 76 依 R1-3 加閘接受新支那一版。**版本號與貼法必須一起定義, 不能只給號碼。**

## R1-6 🔴 附錄(NCPCRONRACE)的前提錯了 —— **我已自己驗證, codex 對**
我寫「收款側零 advisory」, 而**那是 grep 錯了主詞**:我 grep 的是兩支收款 **RPC 的 body**,
但 `order_payments` 上有 **`AFTER INSERT` trigger** ⇒ `pcm_noncard_settle_after_payment()`
(`20260904230000:384-385` 建立, body 在 `:364`)⇒ `PERFORM public.pcm_noncard_settle_recompute(NEW.order_id)`
⇒ **它就會拿那把 per-order advisory lock。**
🔬 **我另外唯讀查了正式庫確認它真的在**:`order_payments` 上非內部 trigger **5 支**,
其中 `pcm_noncard_settle_after_payment_ai` · `tgenabled = O` · **AFTER** · **INSERT**。
⇒ 📌 **所以收款側【有】拿同一把鎖, 而且是【在 FK 拿了列鎖之後】拿** ⇒ 與 cron 的 advisory→列 **仍然反向**,
但「兩側沒共用鎖」這句話**是錯的**, 要改成「**兩側都拿, 而順序相反**」。
🛑 而 codex 另指出:`KEY SHARE` 與 `NO KEY UPDATE` **相容** ⇒ **只憑順序推不出死結**,
要追實際鎖模式與完整呼叫鏈。⇒ **附錄 B 段的「教科書等級死結環」我收回, 改成「順序相反, 而死結未證實」。**
⇒ ⚠️ **D 節那三格因此多一格:先證明「今天真的會死結或真的會漏」, 再談改哪一側。**

## R1-7 codex 的射程(照抄, 不美化)
未連正式庫(不能確認目前 body / 有效 ACL / trigger 啟用 / 受影響訂單)· 未執行 migration ·
未做行為測試與雙 session 併發測試 ⇒ **不能宣稱可安全貼上或死結已重現**。
