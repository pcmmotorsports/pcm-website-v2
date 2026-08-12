# 2f 交接檔 — diff 層 R1 FAIL,五處守門「形狀」要重做(P 九代 → 下一代 P 窗)

> **你的第一讀物就是本檔。** 讀完再開 plan。
> 交接時點:2026-08-12 晚,P 九代 session `767c198d` 收窗。
> **工作區五檔一律 untracked、未 commit、未 apply、未 push** —— 重折完才 commit(主視窗裁定)。
> 🔴 **上面那句是 P 九代交接當下的狀態,現已過期**:本檔連同其餘六個檔目已於 **`378b4fb9`**(P 十一代,
> 2026-08-13)一顆 commit 進 `payment-lifecycle`。**仍然未 apply、未 push。**
> 讀本檔請把它當**歷史交接紀錄**(釘值與拍板仍然有效),不要拿檔頭那句去判斷現在的 git 狀態。

---

## 0. 一句話現況

2f 的 **plan 已過關卡1**(三輪 48 條全折)、**實作已完成且本機實跑綠**,
但 **diff 層 R1(codex)FAIL:9 must-fix + 18 important + 2 nit**。
其中約五處**不是字面修,是守門形狀要重做** —— 這是你要接的主要工作。

✅ **R1 正面確認一件事**(不必重驗):函式本體 150 行是**機械切自原始檔再插入**的,
codex 逐字比對後逐字回覆「**函式本體逐字比對未見未申報差異**」。搬運是乾淨的。

---

## 1. 在製品五檔(全部在 `/Users/sean_1/pcm-lifecycle`,branch `payment-lifecycle`)

| 檔 | 行數 | 狀態 |
|---|---|---|
| `supabase/migrations/20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql` | 675 | 本機臨時叢集 apply **全綠**(前置 P1-P8 過、後置七道過);PIN 全填 |
| `scripts/l5b2-2f-rollback.sql` | 315 | 實跑過:2g 在庫 abort / 正常還原 / 冪等路徑 / 第三態 abort **四格皆綠** |
| `scripts/l5b2-2f-verify.sh` | 495 | `run` 30/30、`rb` 6/6、`mut` 10 靶逐格皆紅在預期處(**但見 §4 的退出碼問題**) |
| `docs/specs/2026-08-12-l5b2-2f-initiate-advisory-plan.md` | 1053 | v5(§14/§15/§16 三輪折疊、§17 突變實測) |
| `docs/phase-1-backlog.md` | +4 條 | #442/#443/#444/#445(唯一一個 tracked 檔,狀態 ` M`) |

**R1 逐字輸出(絕對路徑)**
`/private/tmp/claude-502/-Users-sean-1-pcm-website-v2/767c198d-f764-4362-9cf3-167c0f7f646b/scratchpad/2f-r1-diff.txt`
(6098 行含讀檔軌跡;findings 在最後 ~60 行)
⚠️ 那是 **session 專屬 scratchpad**,別的 session **看得到檔案但目錄可能已被清**;
若讀不到,重跑 codex 即可(prompt 同目錄 `2f-r1-diff-prompt.md`)。

---

## 2. 兩顆釘值(**不要重猜,直接用**)

| 用途 | 值 | 算法/量法 |
|---|---|---|
| 2e post-image `prosrc`(成組閘 P1) | `f4e3aa5b5afb9e886b0b2820a4c4b34b` | md5;正式庫 apply 當下 NOTICE 逐字(`P-578-A §1`),本機臨時叢集**獨立重量同值** |
| canonical view 定義(P4) | `d20e9c8e9702d4b9b975105b91e051d1` | md5;**Sean 於正式庫 SQL Editor 親跑**,`server_version = 17.6`。本機 17.10 Homebrew 實測**同值**(觀察,非保證) |

其餘 repo 出處的釘值(② pre-image `f98e25f5…`、狀態機 `c97ed6ce…`、COMMENT `9656887f…`、
2f post-image `6ad55496…`)都可用 `scripts/l5b2-2f-verify.sh pins` 現場重量。

---

## 3. Sean 拍板(依據,不要重問)

| 題 | 答 | 連動 |
|---|---|---|
| `Q-2f-1` | `lock_timeout = **10s**`(母 plan 建議 3s;3s 無量測依據且本支是員工日常路徑) | 2e 已上庫值是 3s ⇒ **三方不再同值**,2g 要自己決定(plan §11 偏-3a) |
| `Q-2f-2` | **B 放行**(已受理 `result_success` 即不算在途);**複判維持** | 述詞第三條排除;carve-out(唯一獲准直讀的 event_type)(plan §11 偏-5) |
| `Q-超退閘` | **做,獨立片排 2g 前** = backlog **#445**(知情推翻拍板⑤) | 本片不做任何本地超退防護 |

⚠️ 拍板落檔時字母撞號過一次(主視窗問卷的 A = 我 plan 的 B)⇒ **一律以「值」為準,不以字母為準**。

---

## 4. R1 findings 分類(你的工作清單)

### 🔴 A. 守門「形狀」要重做(不是字面修 —— 這是主要工作)

| # | 問題 | 為什麼是形狀問題 |
|---|---|---|
| A1 | **P7 索引檢查** `pg_get_expr(indpred) LIKE '%processing%'` | 把索引改成 `WHERE status <> 'processing'`,字串**照樣包含** `processing` ⇒ 全綠,而 processing 完全不受限、同單可開多筆退款。**與突變 M1 抓到的「共享鎖名含互斥鎖名當前綴」同型** —— 我又用「找得到這個字串」當守門 |
| A2 | **鎖鍵等價**只抽 `substr(replace(...),1,16)` | 改 `'x'` 前綴、或 bigint 後 `+1` ⇒ 斷言仍綠,但 2e/2f 已是**不同的鎖** |
| A3 | **P6b/P6c 狀態機** | 同名 trigger 可**重綁到 no-op 函式**,舊函式留在庫裡 ⇒ 兩道都綠,終態卻可被轉出 |
| A4 | **rollback 三態閘**只看 `prosrc` | 2f 後只改 COMMENT / ACL / `ALTER FUNCTION ... SET` ⇒ 仍判為 post-image 並**覆蓋掉那些改動** |
| A5 | **harness `mut` 不累計失敗** | 靶紅了只印 ❌,最後 `cat` 成功 ⇒ **整個模式恆 exit 0**。🔴 **「10 靶全綠」的退出碼不可信;但逐格結果是人眼讀報告讀出來的,那部分仍成立** |

### 🟠 B. 字面/範圍修(較機械,但別漏)

- COMMENT 前綴比對用 `LIKE` ⇒ 舊全文裡的 `_` 被當萬用字元(`request_id`→`requestXid` 仍判逐字保留)。改 `starts_with()` 或 `position()=1`。
- 順序錨只證「否決晚於 G4」,**沒證早於步 8** ⇒ 把否決移到 INSERT 之後仍過。
- 回傳碼閉集/carve-out 的 `regexp_matches` 只認特定寫法(別名 `e`、`=`、字面)⇒ 改別名/`IN (...)`/串接即繞過。
- P1c「owner 外無人可執行」只查四個角色;P3 不比 ACL 期望集合(既有誤授會被**保留**且全綠)。
- P6 只找四個詞、不驗集合相等;P4 的 `pg_get_viewdef` **不含** `security_invoker`/owner/ACL。
- rollback:2g 偵測只剝 `--` 註解 ⇒ `/* INSERT INTO payment_refunds */` 可繞(誤判與漏判**兩個方向都有**);後置不驗 COMMENT;閘①只查 writer 在不在、**不查還有沒有在途的退款**。
- harness:`all` 忽略 `teardown` 回傳值;C/D 格拿原始 psql 輸出做 substring(RPC 改成 `RAISE 'REFUND_IN_FLIGHT'` 會被當成正確回傳碼)。

### 🟡 C. 文件字面過期(順手清)

- plan `:508-511` 仍寫「正常成功退款會擋單約一天」—— **Q-2f-2=B 之後已排除 `result_success`,與實際行為相反**。
- backlog `#442` 把 `result_unknown`/`reconcile` 也講成「不擋單、永久隱形」—— 那兩態**仍會擋**(三條 NOT EXISTS 全真)。只有 `result_success` 那類才是隱形。
- plan 檔頭仍寫「尚未實作」;harness 未知模式提示仍寫「mut 未實作」(mut 已實作)。

### 🔵 D. R1 也打中我自己申報過的弱點(不是新問題,但要處理)

**突變表沒有「只紅那一格」的證據**:M7/M8 必然同時紅 `0-1 post-image md5` 那格,M8 還連帶紅 C6
⇒ §17 寫的「行為靶紅在預期格」**判別力歸錯人**。重做時要讓每個行為靶的比較基準是
「與 M0(無突變)的紅格集合之差」,而不是「有沒有出現那個標籤」。

---

## 5. 已知且已宣告、**不要重複當成新問題**

1. 否決條件在 2g 之前**恆假** ⇒ harness 相關格驗的是直接 INSERT 造的資料。
2. **死結消融(要實際觀察 40P01)本輪未做** ⇒ 「死結已解」**沒有實測背書**,只有結構前哨。plan §17-3 已明文。
3. `payment_charge_attempts.order_id` 無 immutable 守門(#444);2e/2f 共用此假設。
4. advisory 隨交易釋放的前提 = 單語句交易(唯一呼叫點 `refund-repository.ts:195`,**時點觀察非禁止**)。
5. 本片**不宣稱任何本地超退防護**(#445)。

---

## 6. 給下一代的三個提醒(都是我這輪付過學費的)

1. **「找得到這個字串」不是守門** —— M1(共享鎖名含前綴)與 A1(`<> 'processing'` 含 `processing`)是同一個病,
   我在抓到 M1 之後**還是**在 P7 上犯了一次。寫任何 `LIKE '%x%'`/`strpos` 守門時,先問「**加一個否定詞會怎樣**」。
2. **突變測試會抓到人審查抓不到的東西** —— 三輪 48 條 findings 沒人發現 M1,是突變跑出來的。
   但**突變測試自己也會假綠**(退出碼、殘留叢集、判別力歸錯人),它一樣要被驗。
3. **新鮮度/不變量的來源要小心** —— 我一度用「新叢集 orders=0」當判準,而那個 0 來自一次**失敗的** provision
   (seed 沒跑到)⇒ 拿壞掉的狀態推出了不變量。改用 `payment_refunds`(只有 harness 會寫)。

---

## 7. 建議的重折順序

1. 先修 **A1/A2/A3**(migration 內的守門形狀)→ 這三處直接關係到「本片到底守住了什麼」。
2. 再修 **A4/A5**(rollback 三態、harness 退出碼)→ 沒有它們,後續所有綠燈都不可信。
3. B 段字面修一次掃完;C 段文件同批清。
4. 重跑 `run`/`rb`/`mut`(mut 要改成與 M0 紅格集合比差),**紅格數以實跑輸出入表、不預測**。
5. 三綠 → diff 層 R1 再跑一次 codex → 主視窗派 R2 → **五檔 + backlog 同一顆 commit** → **不 apply、不 push**。

— P 九代(session `767c198d`)
