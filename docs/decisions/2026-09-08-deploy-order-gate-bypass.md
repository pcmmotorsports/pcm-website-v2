# 2026-09-08 · 部署時序閘 fail-closed 誤擋,Sean 拍 A 用 `--no-verify` 推這一發

> 🔴 **這份存在的理由**:`git push --no-verify` 在 git log 上**看不見**。
> 本檔是那一發的證據落點,而它與那顆 push **同一批**進 repo。

## 閘說什麼(逐字)

```
🔴 部署時序 gate:這次要推的應用層新增程式碼,用到了還沒 apply 的 migration 帶進來的東西
  · 🔴  的函式名是識別字而我認不出它: rpcName(在 apps/storefront/src/lib/products.ts)
    └ 這次有未 apply 的 migration,而我無法確定這支呼叫指到哪裡 ⇒ fail-closed。
gate: 1 blocked / 0 欄位警告(不擋) / 12 pending
```

## 🔵 為什麼判定它是誤擋 —— **而判定的依據是量到的,不是推的**

`apps/storefront/src/lib/products.ts:506` 逐字 `const rpcName: CatalogRpcName = dealer?.rpcName ?? CATALOG_RPC_PUBLIC;`
⇒ 那個變數**只有兩個可能值**(:408 / :409,兩者都是 `as const` 字面):

```
CATALOG_RPC_PUBLIC = 'search_catalog_by_vehicle'
CATALOG_RPC_DEALER = 'search_catalog_by_vehicle_dealer'
```

🔬 **正式庫唯讀實查(2026-09-08 15:45,`PCM_READONLY_DATABASE_URL`,零寫入)**:
```
 search_catalog_by_vehicle        | 2      (兩個多載)
 search_catalog_by_vehicle_dealer | 1      ← 15:10 由貼板 101 貼入
⚪ 負對照 never_exists_negative_control ⇒ 沒有印出來(只回 2 筆)⇒ 那把尺兩個方向都會動
```
⇒ 🎯 **兩個可能值在正式庫裡都存在 ⇒ 推上去不會 PGRST202 / 42703。**

## 🛑 這一發【沒有】跳過的東西 —— 閘跳過了,而檢查是手跑的

```
TURBO_FORCE=1 pnpm typecheck   rc=0 · 9/9 · 0 cached
TURBO_FORCE=1 pnpm lint        rc=0 · 11/11 · 0 cached
TURBO_FORCE=1 pnpm build       rc=0 · 2/2 · 0 cached
pnpm vitest run  連跑兩發、逐字一致:
  Test Files 905 passed | 1 skipped (906)
  Tests 16712 passed | 17 skipped | 2 todo (16731)   紅 0
各線 dev..<branch> 全 0 · 工作樹 dirty 0
```

## 🔴 而我犯的錯要寫在這裡,因為它比誤擋本身重要

我在收割後**自己跑過一次那道閘**,拿到 `0 blocked / 15 pending` 並據此廣播「全綠」。
🛑 **成因**:我餵 stdin 的順序是 `<新 sha> <舊 sha>`,而閘讀的是 `local_ref local_sha remote_ref remote_sha`
(`scripts/deploy-order-gate.sh:649`)⇒ **我把方向餵反了 ⇒ 它掃的是相反方向的差集。**
📌 **⇒ 一個餵錯方向的閘,印出來的綠與真的綠【逐字一樣】。**
⛔ ~~修法不是「下次小心」:跑這道閘之前先確認它印的 pending 支數,與 `git diff --name-only origin/dev..dev` 裡的 migration 支數對得上。~~

🔴🔴 **[2026-09-08 22:0x 線 db 複量:那個修法【大部分時候沒有判別力】]**
`auth` 先量到「它只在那一批帶了 migration 時才有用」並交來;我複量,而**判準比那句更窄**:
```
情境一  HEAD~2..HEAD   APPLIED.tsv 差 0 行 · migrations 檔差 1 支
        正確順序 12 pending  ·  餵反 12 pending   ⇒ 🔴 四個數逐格相同 ⇒ 尺全盲
情境二  HEAD~3..HEAD   APPLIED.tsv 差 0 行 · migrations 檔差 1 支
        正確順序 12 pending  ·  餵反 12 pending   ⇒ 🔴 同上
情境三  HEAD~40..HEAD  APPLIED.tsv 差 6 行 · migrations 檔差 3 支
        正確順序 12 pending  ·  餵反 15 pending   ⇒ ✅ 分得開
```
🎯 **⇒ 決定它有沒有判別力的是【`supabase/APPLIED.tsv` 在兩顆 sha 之間有沒有差】,
不是【這一批有沒有帶 migration】** —— 情境一與情境二各帶了 1 支 migration 檔而尺照樣全盲。
🔵 成因看得懂:`pending = migrations − 帳本`。餵反只是換了「用哪一顆 sha 的帳本」
⇒ **帳本沒差 ⇒ pending 一定相同。**
🛑 **⇒ 那個修法在日常(純 docs / 純 scripts / 只改既有 migration 的批)完全不會叫**,
而它印出來的「對得上」與真的對得上**逐字一樣**。⇒ 📌 **它是一個大部分時候恆真的自檢。**
✅ **可用的替代**(而它不依賴帳本):**餵之前把那四個欄位逐字念一遍** ——
`local_ref local_sha remote_ref remote_sha`(`scripts/deploy-order-gate.sh` 讀 stdin 那一行),
**`local_sha` = 你要推上去的那顆(新的)**。⚠️ 而這是「靠人念」不是機制 —— **機制那一半今天不存在。**
📎 `auth` 同日另量到:餵反與正確順序**四個數逐格相同**(`0 blocked` / `10 pending` / rc=0 / 檢查了 1 個 ref)
  ⇒ 與我情境一/二 同型。它的讀數在 `0dd623a4f` 的 body 與板列裡。

## ⏭ 留下來的兩件

1. ⛔ ~~**閘讀不懂 `const X = '字面' as const`** ⇒ 開成板列,由專人修 + codex 審。~~
   🔴 **2026-09-08 17:3x 線 db 實測:這句是錯的** —— 那一種本來就追得到,
   真正認不出的是 `products.ts:465` 的**函式參數** `rpcName`。
   而型別導向解析**兩輪 codex 共 14 條 must-fix ⇒ 決定不做**。⇒ 全文見本檔最後一段。
   ⛔ **今晚不改** —— 收工時改一道守門、沒有第二人審,比繞過它更危險(R4:動驗證本身 = 立即停止訊號)。
2. 🔵 那 12 支 pending 不是本片造成的,清單見 `DOG_DEBUG=1` 的輸出。

**授權**:Sean 2026-09-08 15:4x 拍 A(選項逐字「這一發 `git push --no-verify`, 而理由寫進紀錄」)。

---

# 【2026-09-08 17:3x 追加 · 線 db】那兩件的結局:**一件修了, 一件【決定不做】**

> 授權:主視窗 A 2026-09-08 16:3x 裁「A 核准立刻做 · B 核准, 而附三個硬條件」。
> 條件 ①負對照是驗收本體 ②`as` 擋門要兩個方向的實證 ③鐵則 12④ codex 對抗審查不降級。
> 三條都跑了 —— 而**第三條的結果是把第二件整個否決掉**。

## 🔴 先訂正上面那句 —— **「閘讀不懂 `const X = '字面' as const`」是錯的**

⛔ ~~上面 `⏭ 留下來的兩件` 第 1 條:「閘讀不懂 `const X = '字面' as const`」~~
🔬 實測(HEAD `36af2e7d0`,把閘的解析式原封搬出來跑):
```
[CATALOG_RPC_PUBLIC] -> search_catalog_by_vehicle
[CATALOG_RPC_DEALER] -> search_catalog_by_vehicle_dealer
[rpcName]            -> (空)
⚪ 負對照 never_exists_neg_ctl -> (空)  ⇒ 那把尺兩個方向都會動
```
⇒ `grep -o` 只取到收尾單引號, 後面的 ` as const;` **根本不參與比對** ⇒ 那一種本來就追得到。
🔴 **真正認不出的是 `rpcName`** —— `apps/storefront/src/lib/products.ts:465` 的**函式參數**,
沒有任何 `rpcName = '字面'` 可解析;它的值域是被型別框住的(`:410`
`type CatalogRpcName = typeof CATALOG_RPC_PUBLIC | typeof CATALOG_RPC_DEALER;`)。
📌 **為什麼這個訂正重要**:照舊字面去改, 改完那一格**照樣紅** ——
而「改了還是紅」很容易被讀成「這條路不通」⇒ 下一個人會去動 fail-closed 本身。
**舊字面留刪除線, 讓搜它的人同一發撞到這裡。**

## ✅ 做了:反引號逃逸(那個 syntax error 與誤擋是【同一行】)

🔴 **這裡刻意【不寫行號】** —— 本 diff 自己就把那一行從 `850` 推到 `871`;
引用一行要給【可搜尋的字面】,行號會被下一個插入的人推走
(memory `feedback_my-comment-only-diff-breaks-others-coordinates`)。
🔵 那一行的字面(拿它去 grep):`的函式名是識別字而我認不出它`

```bash
- BLOCKED="$BLOCKED\n  · 🔴 `.rpc()` 的函式名是識別字而我認不出它:…"
+ BLOCKED="$BLOCKED\n  · 🔴 \`.rpc()\` 的函式名是識別字而我認不出它:…"
```
雙引號裡一對沒逃逸的反引號 ⇒ bash 當命令替換 ⇒ 每次跑都印一句 `command substitution: … syntax error`(行號隨檔案漂, 不釘它),
而 `` `.rpc()` `` 那幾個字**被吃掉**(原輸出「🔴」後面空兩格就是它)。
```
🔬 bash -n ⇒ rc=0                    ⇒ 語法檢查看不到它(命令替換是執行期才 parse)
⚪ 正對照 :394 同檔同形狀有逃逸       ⇒ 不報錯
⚪ 全檔非註解含反引號 2 行, 只有這一處 ⇒ 修完 0 處未逃逸
🔬 修後重現同一發:syntax error 0 行, 訊息裡看得到 `.rpc()`
```
🔴 **它為什麼躲得掉所有尺**:那一行**只有在擋下來的時候才跑得到** ⇒ 平常永遠不會踩。
✅ 已加 harness 格 ㊿b 釘它;**兩個世界實測**:把逃逸還原 ⇒ `PASS=131 FAIL=1`, 該格印出那句 syntax error。

## 🛑 決定不做:型別導向解析 —— **兩輪對抗審查, 14 條 must-fix, 全部落在同一層**

做過兩版:①整段 bash regex ②python 嚴格解析器(剝註解與字串 / 整段型別式 / 正面列舉接受面 /
整個初始化式才算常數 / 含反斜線的字面放棄 / import 帶到 id 就放棄)。
codex `gpt-6-astra` 唯讀對抗審查(`-s read-only --disable apps`, `mcp: codex_apps` 命中 0):

| 輪 | 結論 | must-fix | 形狀 |
|---|---|---|---|
| R1 | FAIL | **6** | 聯集註記只抽第一項 / import 作用域 / `as/*x*/T` / 收尾分號在註解裡 / 拼接與 `let` / 跳脫字元 |
| R2 | FAIL | **8**(5 新 + 3 個 R1 的換行·跨檔變體) | 同名型別在兩支檔 / `type A` 與 `const A` 同名 / `const C: string` / 字串裡的假註記 / `as (T)` 括號 |

🎯 **兩輪的 finding 全部指向同一件事:文字比對讀不出【註解 / 字串 / 作用域 / 模組解析】。**
⇒ 📌 那**不是實作沒寫好, 是量具的天花板**。要做對需要 tsc 級 parser + module resolution,
而那不能掛在 pre-push hook 上。
📎 **本閘第二次撞到同一面牆**:欄位那一族 2026-09-06 降級時, 理由逐字就是
「TS 那一支要能分得出【字串 / template literal / 註解】三種狀態」。

🔴 **判停依據**(`~/.claude/rules/00-work-rules.md` §5 輪次紀律逐字):
「**某輪的 finding 開始重複前輪、或都在同一層打轉 = 方向問題**, 整理決策題給 Sean 而非繼續折衝。」
⇒ R2 有 3 條是 R1 的變體、其餘 5 條同層 ⇒ **命中判停條件** ⇒ 停, 不開 R3。

### ⇒ 現行決定
```
· 維持 fail-closed, 一個字都不動
· 誤擋的解法不是讓閘變聰明, 是【把那幾支 pending migration 貼掉】—— 清空之後這一格不會叫
· 真的要現在推 ⇒ --no-verify + 證據落檔(就是本檔上半那一發的做法)
· 閘裡那一行(grep `的函式名是識別字而我認不出它`)上方留了一整段
  「不要把這裡改成回頭去解析型別」+ 兩輪的形狀清單 —— **不寫行號, 理由同上**
· harness 加 ㊿a 釘住這個【已知誤擋】是刻意的 —— 有人做出可靠解析時那一格會紅
```
📦 **沒有採用的 patch 與兩輪 codex 全文都留著**(要重開這題的人先讀, 不要從頭再走一次):
```
~/pcm-mailbox/patch-deploy-order-gate-型別導向解析-未採用-db-20260908.patch   494 行
~/pcm-mailbox/codex-R1-deploy-order-gate-db-20260908.txt
~/pcm-mailbox/codex-R2-deploy-order-gate-db-20260908.txt
```

## 🔵 過程中弄壞又修好的一件(留著, 因為它是別人也會踩的形狀)

把新函式插進 `pending_versions()` 後面之後,**M5 那發突變當場 FAIL**。
成因:`mutate_and_check` 是 `replace(old, new, 1)` ⇒ **換全檔第一個命中**,
而 M5 的錨是裸字串 `-- apps packages`(閘裡當時 3 處, 第一處剛好就是要打的那一處)。
新函式裡有 4 處同字串 ⇒ 第一個命中變成新函式裡的一處 ⇒ 突變打在無關的地方 ⇒ ㉔ 照樣放行。
🎯 **那個綠靠的是【位置】不是【內容】** —— 而插入的人不會知道自己動到了別人的座標。
✅ 錨已重釘在只有那一行才有的字面上(當場量:全檔 7 處含該字串, 本錨 1 處);
突變目標、期望值、對照格一個字都沒改。**本次雖然不留那個函式, 錨的重釘留下來。**

## 🔵 那 12 支 pending 的清單(`DOG_DEBUG=1` 實跑, 2026-09-08 16:2x, `local_sha=36af2e7d0`)
```
20260828060000  b4cron6_expire_unpaid_orders_heartbeat     490 行
20260828070000  b4mgr0_is_manager_comment                   29 行  ← COMMENT-only, 貼不貼都一樣
20260901021000  coupon_p3b_create_order_redeem             816 行
20260901030000  zero_total_settle                         1364 行
20260904010000  storefront_search_partno_indexable          51 行  ← 空殼, 自陳「已作廢, 零 DDL」
20260905120000  storage_revoke_anon_write                  202 行  ← 貼板 94 時自己的斷言擋住 ⇒ 回滾
20260905210000  manual_no_email_off_scan_surface           740 行
20260907070000  orders_delete_audit_trail                  344 行
20260907190000  acl_approve_after_244_review                61 行  ← 要 payment_confirmer 才讀得到(Q-ACLSNAP)
20260908030000  net_exposure_probe                         471 行
20260908060000  partpaid_cancel_gate                       788 行  ← 🔴 主視窗 A:**不可貼**(下游沒有出口, `59665be3b`)
20260908090000  fitsync1_get_fitment_sync_freshness        260 行
```
🔴 **這張表【已經過期一格】** —— 副手窗 B 2026-09-08 17:4x 告知:`20260908030000`(net 曝露面探針)
**Sean 本人 17:16 已貼進正式庫**(`APPLIED.tsv` 383⇒384, commit `1bed71ebc`)⇒ **今天的 pending 是 11 支不是 12**。
📌 **上面那張表刻意不改** —— 它旁邊寫著量測時點與 sha(16:2x / `36af2e7d0`), 那才是它的意思;
改掉數字而留著時戳, 會讓一個**沒有人量過的組合**看起來像量過的。⇒ 要現值 ⇒ **當場跑 `DOG_DEBUG=1`。**

🛑 **「哪幾支該貼」不在我的分母裡** —— 擁有者是別條線, 判準是各線自己的驗收條件。
📌 而 A 給的那支反例值得寫下來:**pending 裡混著三種 —— 該貼的 / 貼不貼都一樣的 / 貼了會出事的。**
⇒ 只有一欄「支數」的表會被下一個人讀成待辦清單。
