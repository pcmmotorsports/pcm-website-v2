> 🔴 **這一份為什麼在 repo 裡,而不是留在信箱**(2026-08-27 深夜,b4 的 reviewer 逼出來的)
>
> **問題**:變更單同時給「改成什麼」與「驗收 grep」,而套的人**做完才回頭取基準**時,
> 那個驗收就零判別力。而 **【做完才取基準】與【先釘基準再做】在檔案上的差異是零** —— 差在時序,而時序不留在檔案裡。
>
> **b4 試過的藥**:套前 `shasum` 變更單存檔、套後再 `shasum`,不同 ⇒ 整輪作廢。
> 🔴 **reviewer 實跑打掉它**:**套完改 spec 再重釘 ⇒ 驗照樣 PASS。** ⇒ 連 `shasum` 都擋不住。
>
> **正解(reviewer 給的,而它比 v1~v4 四輪判定器加起來值錢)**:
> ```
> 變更單先 commit 進 repo, 再套板子
> ⇒ commit 序是 append-only, 「哪個先」不需要任何新機制就查得出來
> ⇒ 零新工具、零新規矩 —— 換的是【載體】, 不是加一道檢查
> ```
> 📌 **b4 花四輪做的是「把時序讀出來」,而正解是「換一個本來就記時序的載體」。**
>
> ⚠️🔴 **而本份【不享有那個保證】** —— 主視窗**已經在這一顆之前把 A 堆 14 格套完了**
> (`6fd0591f` / `10452c52` / `652271ef`)⇒ **本份是事後補進 repo 的,commit 序證明的正好是「套在前、單在後」。**
> **不要拿本份當「先釘基準」的範例。** 從**下一份**起才成立。
>
> 📎 來源:`~/pcm-mailbox/b4-板子變更單-全105列-v1-20260827.md`
> (逐字複製,`shasum -a 256` 前 16 = `7599083cf055b11e`,62 行;主視窗當場量)
> 判定器現行版:`~/pcm-mailbox/b4-chk-v4-20260827.py`(v2/v3 留著 —— b4 的話照抄:**「它們的結果不是壞的、是有盲區。」**)
>
> ⚠️ **reviewer 另普查出一格,套的人要知道**:**28 列的「事」欄不足 20 字 ⇒ 錨零餘裕**
> (而 105/105 現在唯一)⇒ **四分之一的列,下次任何人改寫它就會斷錨,而現在因為唯一所以看不出來。**

---

# b4 · 板子變更單 · 全 105 列 v1(2026-08-27)

> 給主視窗一次套。**本檔是收攏,不是重核** —— 每列依據欄指向本班四份核查檔的行號(`~/pcm-mailbox/b4-核查-launch-todo-第{5,6,7,8}批…20260827.md`,下稱 5批/6批/7批/8批;`b4-核對主視窗套板13格-20260827.md` 下稱 13格)。
> 基線:板子 sha256 前 16 `a9d2362623d10ed8`(HEAD `93fd3682` 之後未變);三態 open 51 / doing 8 / parked 12 / done 34。
> ✅ **已套、不用再動**(`b601076b` + `e636cb82`):第 5 批 13 格的 🔵 追記全部;誰欄 3 格(優惠券 / 性別 / 商品編輯後台 ⇒ `plan 等批 · 落點…`);#868 誰欄 `~~c4 窗 A~~ 窗名已作廢`;反向刪除線 2 處;`:199` 加了「(主視窗)」;BL-47 open ⇒ parked。
> 🔴 欄位固定:**態(現) | 態(建議) | 錨字串 | 要改哪一欄 | 改成什麼(逐字) | 依據**。「要改哪一欄」不可省。

---

## A · 只改字面,套完即可(不改態;14 列,數法 awk 節內 `^\| (open|done|doing|parked) \|` 行數)

| 態(現) | 態(建議) | 錨字串 | 要改哪一欄 | 改成什麼(逐字) | 依據 |
|---|---|---|---|---|---|
| open | open | 一句「A8a3 還沒 apply」過期了 (#868) | **事欄** | `~~一句「A8a3 還沒 apply」過期了,而它撐著一個值班面結論~~ ⇒ #868 另一半:寄之前不寄(e8c5c6e3 自陳「只做完一半, 今天照樣會寄」)` | 5批:29;13格:18;`packages/ports/src/IPaidEmailContext.ts:101-102` |
| open | open | 優惠券／折扣碼 | **卡什麼欄(內文)** | 把仍是粗體的 `**零條目、零 PRD、零 schema**` 改成 `~~零條目、零 PRD、零 schema~~`(新結論那句已在 🔵 追記) | 13格 §4 F2 |
| open | open | 商品編輯的真正難題:每天會被覆蓋一次 | **卡什麼欄(內文)** | `grep -c supplier_slug <丙 plan>` ⇒ `grep -c supplier_slug ~/pcm-mailbox/60-線2-20-商品編輯-選項丙-plan-20260825.md` | 13格 §4 F5 |
| open | open | 總帳狀態欄加封閉集欄位 | **列尾** | 該列(現 `:199`)結尾補 `\|`(現尾字元是 `。`) | 13格 §4 F7 |
| done | done | 🟡 20260822010000(出貨信 view)到底套了沒 | 內文 | `帳本分母 wc -l < supabase/APPLIED.tsv ⇒ 290` 旁加 `(⏱ 2026-08-27 重量 ⇒ 291)` | 6批:28 |
| done | done | 放寬那道閘的第三格驗收 | 內文 | `分母 214` 旁加 `(⏱ 2026-08-27 重量 ⇒ 219,ls supabase/migrations/*.sql \| wc -l)` | 6批 §4 |
| done | done | ⑳ 員工分權那題只是沒結案 | 內文 | 「本列該追的是那句誤 defer」後加 `✅ 2026-08-27 b4:那句已刪(payment-reverse-actions.ts:40 逐字「原本這裡寫…已刪」)⇒ 本列可真的關` | 6批:19;6批 §4 |
| done | done | #806 ~~解除退款封印~~ 結論=不解除 | 內文 | ①字面錨 `MANUAL_REFUND_ENTRY_BLOCKED_BY_787 = true` ⇒ `MANUAL_REFUND_ENTRY_BLOCKED_BY_787: boolean = true`;②「`#866` 兩支 migration 未 apply ⇒ 現在解封 = DB 側零保護」後加 `⚠️ 2026-08-27 b4:兩支已 apply(APPLIED.tsv 20260824010000 / 20260824011000,Sean 08-24 親貼)⇒ 這句前提已翻,「不解除」的理由要重讀` | 6批:20 / §4;7批:21 |
| doing | doing | 手動建訂單 #858 | 內文 | `🔴 片0-b 已開工未 commit(?? …manual-customer.ts)` ⇒ 加刪除線 + `(2026-08-27 b4:已版控,git ls-files ⇒ 1;品項選擇器仍未接:orders/new/page.tsx grep -c manual-order-catalog ⇒ 0)` | 7批:17 |
| doing | doing | 員工手動建單 #939 | **內文 + 誰欄** | 內文 `⚠️ 未 commit、未 apply` ⇒ `~~未 commit、未 apply~~ 2026-08-27 b4:migration 20260824020000 已版控且帳本 1;唯一消費者仍未開工`;誰欄 `96 線 C` ⇒ `落點 supabase/migrations/20260824020000_m4b_858_admin_create_manual_order.sql;呼叫端零人接` | 7批:22 |
| doing | doing | 訂單確認信改版(HTML + 金額 + PDF) | **誰欄** | `窗 A` ⇒ `落點 3a0de9e1(08-25 12:53,#876 附件 port/adapter);sender 那半 08-25 起零 commit` | 7批:18 |
| parked | parked | 刷新 docs/progress-roadmap.html | 內文 | `2,791 顆 commit` ⇒ `2,791 顆 commit(⏱ 2026-08-27 重量 ⇒ 3,164;git rev-list --count --since=2026-08-12 HEAD)` | 8批:21 |
| parked | parked | 贈品(0 元)上不了架 —— 供應商匯入那道閘擋著 | **誰欄 + 內文** | 誰欄 `等排片(要 plan)` ⇒ `plan 在版控 docs/specs/2026-08-26-q18-zero-price-group-basis-plan.md;片B Sean 08-26 拍緩做`;內文 `皆未 apply` ⇒ `~~皆未 apply~~ 2026-08-27 b4:20260825120000 已 apply(帳本 1)、20260825130000 未、0ed3cf16 無 migration` | 8批:13 |
| parked | parked | B5-b 讀取閘去查員工名單 | **誰欄** | `先解 #17` ⇒ `先解 #17(⚠️ 指哪套編號未確認:backlog #17 是已✅的無關條目、員工的一天 17 是退款操作;上一班 checkpoint §5-10 同題)` | 8批:15 |

## B · 要 Sean 拍才能改態(9 格,同一數法;每格附「不拍會怎樣」)

| 態(現) | 態(建議) | 錨字串 | 要改哪一欄 | 改成什麼(逐字) | 依據 | 🔴 不拍會怎樣 |
|---|---|---|---|---|---|---|
| done | **open** | 🔴 CI 已經連紅約 74 小時,而沒有人被通知 | **態 + 內文** | 內文尾加 `🔴 2026-08-27 b4:又紅了 —— 08-25 12:28(3c588990)起連續非 success,最後綠 1651fe76;紅的檔 scripts/migration-new-file-gate.test.ts(根因 ee4bdf27,de 已修待 commit)+ admin 兩支(修在 7228d8d0,未推)。通知機制本身零實作` | 6批:54 / §2 | 板子印 done,而 CI 紅了 30h 零人知道 —— **這格的病名就是「沒人被通知」,它會第三次發生** |
| done | **open**(de 的丙修 commit 進之後可回 done) | ~~沒有任何東西對【新增的 .sql】自動跑語法規則②~~ 已接線 | **態 + 內文** | 內文尾加 `🔴 2026-08-27 b4:守門測試 2 failed/1 passed(本機 HEAD 與 CI 皆紅)—— ee4bdf27 把 lint-staged key 放寬成 supabase/migrations/*.sql,truth-sync 在暫存 repo 讀不到真檔 ⇒ 殺掉規則② task;de 修法丙(把三支真檔補進暫存 repo)待 commit` | 6批:55 / §2 | 「規則②有沒有在守」現在沒人量得到;放著 = 這道守門是恆綠還是恆紅都不知道 |
| doing | **done** | 人工退款可以超過實際收到的錢 #866 | **態 + 內文 + 誰欄** | 內文 `⚠️ 未 commit、未 apply` ⇒ `~~未 commit、未 apply~~ 2026-08-27 b4:b6a204b2 祖先;20260824010000 / 20260824011000 皆在 APPLIED.tsv(Sean 08-24 親貼)`;誰欄 `c4 窗 A` ⇒ `落點 b6a204b2` | 7批:21 | **它改別人的排程**:#806 的「不解除」前提靠它「未 apply」;有人會再排一片去 apply 它 |
| doing | **done(接線半)/ #872 另立** | 那道 migration 守門寫好了、沒接線 #530/#872 | **事欄 + 誰欄** | 事欄 `~~寫好了、沒接線~~ 已接線(40cb0486,08-23;.husky/migration-post-commit-gate.sh:68)`;誰欄 `cf 補洞窗` ⇒ `剩 #872 逃生門(backlog ⏳),零人接` | 7批:23 | 「沒接線」這句假話會讓下一個補洞窗再接一次 |
| doing | **done 或答「還剩什麼」** | 登錄匯款後單子從畫面消失 #841 | 態 | 板子 doing / backlog ⏳ / 碼與 migration 都在(0853bf2b、20260823030000 帳本 1)⇒ 三載體三態 | 7批:19 | 做 #841 的人會重做已做完的一半 |
| doing | **parked(等 codex)** | 🔴 這一格的傷害模型【原本是錯的】—— 零訊號 | **態 + 誰欄** | 誰欄 `等主視窗派 codex` ⇒ `碼已 commit;codex 零紀錄(08-24 起);鐵則 12① 未審` | 7批:20 | 金流路徑上一顆沒審的 commit 躺在 dev,而板子說「有人在做」 |
| doing | **併入 :129 或 parked** | B5-a 後台去讀票上的身分 | 態 | 剩的「八條負向驗收」= open 列「B7 端到端負向驗收」同一件事(兩列都逐字含「八條負向驗收」) | 7批:16 | 一事兩列兩態,計數重複、派工會派兩次 |
| parked | **doing** | #202 儲值金分頁空白 | **態 + 事欄 + 誰欄** | 事欄 `~~儲值金分頁空白~~ 儲值金明細已接上(c1aef746 / a87b4827)`;誰欄 `等一個沒問出去的確認` ⇒ `Sean 08-26 拍甲乙乙(memory project_0826-sean-wallet-detail-slice-rulings);backlog #202 🔄` | 8批:23 | 下一個盤點的人會第三次報「分頁空白」 |
| parked | **open(指名)** | 33 項「員工的一天」6 格重量 / 刷新 roadmap(兩列) | **誰欄** | `排隊中(等第一個窗收工)` ⇒ 指名一個落點或改 open;「等第一個窗收工」08-25 起已發生 33 次(有落檔的收工檔數)而零人接 | 8批:20-21 / §2-4 | 這兩列永遠在排隊,而排隊在板子上長得像有人在做 |

## C · 驗收數法(套完在 repo 根跑;期望值 = 只套 A 堆;B 堆每拍一格照表移動)

```bash
grep -oE '^\| (open|doing|parked|done) \|' docs/launch-todo.md | sort | uniq -c   # A 堆不改態 ⇒ 仍 open 51 / doing 8 / parked 12 / done 34
grep -cE '^\| [a-z]+ \| #868 \| 一句「A8a3' docs/launch-todo.md                     # 現 1 ⇒ 0
grep -c '~~零條目、零 PRD、零 schema~~' docs/launch-todo.md                          # 現 0 ⇒ 1
grep -c '<丙 plan>' docs/launch-todo.md                                              # 現 1 ⇒ 0
grep -cE '^\| open \| — \| 總帳狀態欄加封閉集欄位.*\|$' docs/launch-todo.md            # 現 0 ⇒ 1
grep -cE '^\| doing \|.*(#866|#939).*未 apply' docs/launch-todo.md                   # 現 2 ⇒ 0(A 堆 #939 + B 堆 #866 都劃掉後)
grep -cE '^\| doing \| #858 \|.*片0-b 已開工未 commit' docs/launch-todo.md           # 現 1 ⇒ 0(劃掉後字串仍在 ⇒ 改數 '~~🔴 片0-b' ⇒ 1)
grep -cF '皆未 apply' docs/launch-todo.md                                            # 套前 ≥1 ⇒ 套後 0(⚠️ 用 -F;括號在 ERE 會被吃掉,我第一發就踩到)
grep -c '2,791 顆 commit(⏱ 2026-08-27' docs/launch-todo.md                          # 現 0 ⇒ 1
grep -cE '^\| parked \| — \| B5-b .*指哪套編號未確認' docs/launch-todo.md           # 現 0 ⇒ 1
grep -cE '^\| done \| #806 \|.*這句前提已翻' docs/launch-todo.md                      # 現 0 ⇒ 1
grep -cE '^\| parked \| #202 \| 儲值金分頁空白' docs/launch-todo.md                 # 現 1;B 堆拍了才 ⇒ 0
grep -cE '^\| doing \| #530 / #872 \|.*沒接線' docs/launch-todo.md                   # 現 1;B 堆拍了才 ⇒ 0
grep -cE '^\| zzz-bogus \|' docs/launch-todo.md                                      # 負對照,恆 0
python3 scripts/board-state-consistency.py --selftest                                # 封閉集守門仍 rc=0
```
🔴 每一條都要**雙向**:套之前先跑一次拿到「現」值,套完再跑一次;兩發同值 = 那格沒套到。
