# #27 稽核 UI — 施工 plan(C 窗 2026-08-14 夜;**2026-08-15 Sean 拍 `Q-D1 = A` + `Q-D1b = A` 後更新**)

> 🔴🔴 **本檔已被證實三次不準,引用前必須重驗**(2026-08-15):
>   ① §1 的 action 代碼清單**漏了 `settings.staff.deactivate` / `settings.staff.reactivate`**
>      —— 而它們與已收的 `create`/`update` **在同一支檔同一段**(`staff-actions.ts:274-275`)。
>   ② §1 的「**18 支 SECURITY DEFINER RPC**」是**檔數冒充支數**(見 §1 該行的更正)。
>   ③ §1 的「**共 19 支**」把 **app 層那個呼叫點也算成 RPC**(它不是)。
>   ⚠️ **三次同源** —— 都是這份 08-14 清單。**下一個引用它的人:先重量,不要抄。**
>
> 🏁 **本檔狀態(2026-08-15 更新):D0 已完成並 commit `feaa91c3`,但 `apply` 尚未發生。**
> **D0 走過**:codex R1 FAIL5 / codex R2 FAIL3+1(含 PG17 `pg_maintain` 權限洞)/ Fable R3 換模型 FAIL1+2+2
> (must-fix 不在 SQL 裡、在驗證鏈)/ 自審 ×2 / **非作者窗 E 實跑 `scripts/27-d0-verify.sh` 四次,第四次零 finding**。
> 🔴 **D1 仍不可上線** —— `20260815020000` **未 apply,而 apply 只有 Sean 能做**。
>    D1 的 code 寫得完、三綠會過(型別早就有),**但跑起來會 42501**,那正是驗收 8 要接的。
> ⚠️ **上一版這行寫「D0 尚未通過對抗審查、尚未 commit」** —— 那是 commit 前的狀態,**已過期,就地更正**。
>
> §1-A 現況 ❌「有寫入介面、連讀取 API 都沒有」。**複驗成立,而且比條目寫的更硬:不是沒人寫讀取 code,是 DB 端連 SELECT 權限都沒給。**
> 本檔零 code、不碰正式庫。

## 0. 🏁 拍板與狀態(2026-08-15)

**Sean 拍板 `Q-D1 = A`(逐字「a」,經主視窗轉達)⇒ 這片要做,開 `GRANT SELECT`。**

⚠️ **本檔原本就把權限這件事判對了,沒有「不需要 migration」那種字面要修。**
主視窗的指示假設本檔寫過那句;**實查沒有**(數法:`grep -nE 'migration|GRANT|鐵則 12|鐵則 8|授權|輕量片|標準片|高風險'` 逐行看過,
**§4 標題**、**§4 末的「雙中標」句**、**§5 表格 D0 那列**三處從第一版起就寫 **鐵則 12②③ 雙中標 / 高風險片 / 要 Sean 批**)。
**這裡明講,免得下一個人以為修過。**

**真正過期的只有時間字面**:§4 標題與 §4 末句原本寫「今晚不動」/「今晚一行都不動」—— 那是**還沒拍板時**寫的。
拍板後 D0 **可以寫**(寫檔 ≠ apply,見下)。已在該兩處就地改掉。
⚠️ **這裡刻意用章節名而不用行號**:本次插入 §0 讓全檔行號位移,寫死行號當場就會過期
(這正是我自己在 `#1` plan `§9-7` 抓到的同一種病)。

🔴 **apply 是 Sean 的獨立停點,拍板沒有涵蓋它。**
Sean 批的是「做這件事」;`~/pcm-mailbox/C-HANDOFF.md` 的授權邊界逐字:「**任何 apply 正式庫**」始終要 Sean 本人。
⇒ **我寫 migration 檔、commit、不執行、不 push。** apply 由 Sean 自己跑,那是第二個獨立停點。

### 🔴🔴 開放 SELECT 的正當性 = **一個有到期日的前提**(`Q-D1b = A`,Sean 2026-08-15 **知情後**拍板)

第一版我把這顆掛著不當它被涵蓋(理由:Sean 拍 `Q-D1 = A` 時字面只有「a」,我不知道他被告知了什麼)。
主視窗已補問,**這三件逐字送到他面前**:①開 SELECT 後威脅模型從「無人能讀」變成「**靠登入閘**」
②`#26` 說登入身分**仍是自選、系統不驗證** ③這張表的 `before`/`after` **合法可含經銷價 / 成本 / PII**。
**他知情後仍拍 A**,理由:**後台目前只有他本人在測、員工還沒上工。**

> **本片開放 SELECT 的正當性建立在「後台目前只有 Sean 一人測試、員工未上工」(Sean 2026-08-15 知情後拍板)。**
> **員工真正上工之前,`#26` 真認證必須先落地** —— 否則自選身分的人讀得到經銷價 / 成本 / PII。

🔴 **這段要逐字複製進 D0 migration 的檔頭 COMMENT**,不只留在 plan。
🔴 **字面紀律**:**不得寫成「已評估安全」** —— 它**不是安全**,它是**現在還沒有人會受害**。
⇒ 掛成 **`#26` 的下游相依**:`#26` 落地前員工上工 = 這個前提失效 ⇒ **回頭重估本片,不是「寫完就算」。**

---

## 🔴🔴 上面那段的**前半段已被 Sean 口頭推翻**(2026-08-15 更正段;原句一字不刪)

> **`:43` 與 `:45` 的原句刻意保留不動,不要以為那是漏改** —— 留痕才看得出被推翻的是哪一句。

**Sean 2026-08-15 原話**(經主視窗轉達,**非第一手**):
> **「是可以甲, 但是成本、客戶客人資料 **員工是可以看的**」**

**⇒ 被推翻的是「員工未上工 ⇒ 所以現在還安全」這個推理**:
**不是因為員工還沒上工才安全,是因為員工本來就該看得到這些。內容本身不是風險。**

✅ **仍然成立、而且現在是唯一的理由**:
🔴 **`#26` 真認證要的不是「擋員工」,是「確認進來的人真的是員工」。**
Sean 說的是**員工**可以看,**不是任何進得來的人**都可以看。

### 🔴 所以 `:50` 那條重估觸發條件是錯的,錯的方向是「延後行動」

| | 舊字面(`:50`) | 更正後 |
|---|---|---|
| 觸發訊號 | **等到「員工上工」才回頭重估** | **不必等任何人上工** |
| 缺口何時存在 | 隱含「現在還沒有」 | 🔴 **今天就存在** —— 缺的是身分驗證,與有沒有人上工無關 |

⇒ **舊觸發條件叫下一個人等一個永遠不會正確觸發的訊號。**
**新判準:`#26` 落地之前,這頁的存取控制只有一層 —— 那是現況,不是未來風險。**

### 這個更正住在哪些載體(2026-08-15 實掃)

| 載體 | 狀態 |
|---|---|
| 本檔 §0 的兩處原句(「他知情後仍拍 A,理由…」與其下方引言區塊) | ✅ 原句留痕 + **本更正段就在下方**(相鄰,跟得到) |
| 本檔 §「🏁 那顆疑慮已結案」段 | ✅ **該段有自己的更正區塊**(E 窗 R2 must-fix:那段是**正面重申**、且距本段一百多行 ⇒ **指標承載不了**) |
| `apps/admin/src/app/settings/audit/page.tsx:32-44` | ✅ 同一份更正,寫在會被讀到的地方 |
| `supabase/migrations/20260815020000…sql:14` | ⚠️ **改不動**(已 apply、sha 釘死)⇒ 引用該檔頭前必須先讀本段 |

🔴 **本表刻意用「段落名」不用行號** —— 我第一版寫 `:43 / :45 / :205`,而**加完更正段之後行號全部位移**
⇒ **那三個數字當場變成假行號**(本 repo 的 `#485` / `#504` 就是這種假行號的事故)。**會位移的東西不要當座標。**

⚠️ **掃描字集紀律(這次差點漏兩處)**:第一輪用 `員工未上工|只有 Sean 一人測試` 只掃到本檔 **1 處**;
放寬成 `未上工|還沒上工` 才看到本檔其實有 **3 處**。
🔴 **同一件事在同一份檔裡用了兩種說法,而窄字集只抓得到其中一種。**
✅ **正解(E 窗 R2 給的)**:**用最短不可分割片段掃**(這裡是 `上工`),**不要猜措辭**。
(另有 1 處在 `apps/admin/.next/**.map` = **build 產物,不是載體**,不處理。)

⚠️ **而「列出載體」≠「處置載體」**(E 窗 R2 抓到,比「沒列出來」晚一步、也更難自己看見):
我第一版把三處歸成同一類、寫「由本段一次涵蓋」—— **但只有相鄰且是引文的那兩處成立**;
**「已結案」那段是正面主張、又隔了一百多行,一個指標帶不動它。** ⇒ 已補獨立更正區塊。

## 1. `admin_audit_log` 欄位與寫入點(逐項從 migration 讀;建表檔數法 `grep -rln "CREATE TABLE public.admin_audit_log" supabase/migrations/` = 1 檔)

建表 = `supabase/migrations/20260712210000_m4a_admin_audit_log.sql`。10 欄(`:43-59`):
`id` uuid PK · `actor` text NOT NULL(具名 staff slug)· `action` text NOT NULL · `target` text(格式約定 `<entity>:<uuid>`,`:65-66` COMMENT)· `before` jsonb · `after` jsonb · `reason` text · `request_id` text NOT NULL(correlation id)· `source_app` text CHECK IN('admin','quote')· `created_at` timestamptz DEFAULT now()(DB 權威、server 不回填以防竄改,`:53`)。
四個索引已經是為了這頁建的(`:72` created_at DESC / `:74` actor+created_at / `:76` target partial / `:78` request_id)——**列表、依人查、依單查、依 request 追蹤四條路都有索引,這頁不必自己加。**

~~**寫入點兩類,共 19 支**~~ ⇒ **更正(2026-08-15)**:**18 個 migration 檔含稽核 INSERT + app 層 1 個呼叫點**。
🔴 **原句錯在單位**:`19 = 18 檔 + 1 處`,而它被寫成「**19 支 RPC**」—— **app 層那一個不是 RPC**,
且 18 是**檔數**不是支數。**兩個單位在同一句裡各錯一次。**
量法:`grep -rl "INSERT INTO public.admin_audit_log" supabase/migrations/ | wc -l` ⇒ **18**;
`grep -rn 'getAdminAuditLogRepository()' apps/admin/src` ⇒ 4 命中,**逐一開檔後只有 `staff-actions.ts:61` 是真呼叫**
(其餘 2 處註解、1 處 getter 定義本身)⇒ **app 層確實是 1 處**。
⚠️ **但那 1 個呼叫點會發出 4 種 action 代碼**(`:124` create / `:189` update / `:274-275` reactivate+deactivate)
⇒ **「呼叫點數」與「代碼數」不是同一件事**,原句把兩者混在一個數字裡。
🏁 **「有幾支函式真的寫稽核」已量(2026-08-15)= **23 支函式的函式體含稽核 INSERT**(2026-08-15 量,**三種量法互證**:E 窗①以 `CREATE FUNCTION` 切段計數 ②收集 `(檔, 函式名)` 配對去重;C 窗③獨立以 regex 切段 + 逐段判斷。三者皆得 **23**;前提檢查「稽核 INSERT 出現在函式外」⇒ **零命中**。⚠️ **共同限度**:三種都靠「`CREATE FUNCTION` 之間即函式邊界」,**巢狀定義會誤判**——未遇到、也未特別構造)
🔴 **而「三法互證」互證到的是「實作沒寫錯」,不是「那個假設成立」** —— 三種都用**同一個切段假設**(`CREATE FUNCTION` 之間即函式邊界),**同源的方法不會互相抵消共同限度**。⇒ 若那個假設不成立,**三個會一起錯**。。**
⚠️ **前一版寫「沒有可信值,不要填」是假的,已更正** ——「我沒量」是關於自己的宣稱(真),
「沒有可信值」是關於世界的宣稱(假)。**31 vs 28 的分歧也解了**:31 那條不錨行首、把 3 行 SQL 註解算進去,**28 才對**。

| 類 | 誰 | 形狀 |
|---|---|---|
| **DB 層(主流)** | **18 個 migration 檔**含稽核 INSERT(`20260714130000`–`20260814190000`);**支數未量,見上方更正** | 與主操作**同交易**寫,主操作 rollback 稽核也不留 |
| **app 層(唯一一處)** | `staff-actions.ts:61` → `getAdminAuditLogRepository().record()`(`orders/order-repository.ts:39-51`) | **非交易性**;`payment-actions.ts:47` 註解已標明這條路存在 |

**已在用的 action 代碼 19 個**(數法 `grep -rhoE "'[a-z][a-z_]+\.[a-z_]+(\.[a-z_]+)?'" $(grep -rl "INSERT INTO public.admin_audit_log" supabase/migrations/) | sort -u`,濾掉 `public.*` 表名與 `v_before.*` 變數後):
`customer.tier.change` `customer.wallet.adjust` `order.cancel` `order.workflow.update` `order_item.workflow.update` `order_note.append` `order_refund.correct_verdict` `order_refund.finalize` `order_refund.initiate` `payment.record` `payment.record.replay` `payment.reverse` `procurement.create` `procurement.update` `procurement.void` `procurement_receipt.create` `procurement_receipt.delete` `supplier.create` `supplier.update`;app 層另有 `settings.staff.create` / `settings.staff.update`(`staff-actions.ts:124,189`)。
⚠️ `AdminAuditAction = string`(`lib/audit/types.ts:8`)—— **型別層不列舉**,所以上面這張表是「今天數到的」、不是「不會再多」。UI 的動作篩選必須能吃到未知代碼、不能寫死 enum。

## 2. 讀取面現況 = 零(附 pattern 與分母)

- `.from('admin_audit_log')` 全樹**只有 2 處**(數法 `grep -rn "from('admin_audit_log')" apps packages`):`lib/audit/supabase-repository.ts:10`(註解裡的示範)與 `lib/orders/order-repository.ts:46`(**insert 路徑**)。⇒ **零 SELECT**。
- `apps/` 全樹 `admin_audit_log` 共 43 行命中(分母 = 823 個 `.ts`/`.tsx`,數法 `grep -rl "" --include='*.ts' --include='*.tsx' apps | wc -l`),**逐行看過:全部是註解或寫入路徑,沒有一行在讀。**
- 路由層零頁面:`ls apps/admin/src/app/` = `@panel api customers orders settings page.tsx layout.tsx globals.css`,**無 audit 目錄**。

## 3. 這頁要給員工看什麼

員工的問題是「**誰、什麼時候、對哪張單、做了什麼**」。四欄就答得完:
`created_at`(轉 Asia/Taipei,PRD §6.5 明定在 app 層轉)· `actor`(slug → 中文姓名,`lib/staff.ts` 已有 label)· `action`(代碼 → 中文字典)· `target`。

🟢 **不需要 join**:`target` 是 `<entity>:<uuid>`,而 `/orders/<uuid>` 與 `/customers/<uuid>` 兩條 admin 路由**都吃 uuid**(現有 `customer-detail.tsx:55` 的 `orderHref` 就是這樣組的)⇒ 直接把 target 切成連結即可,零 join、零額外查詢。
⚠️ 代價:員工看不到單號(`display_id`),只看得到「查看訂單」四個字。要顯示單號才需要 join `orders` —— **v1 建議不做**,等 Sean 看過畫面說不夠再加。
🔴 **`before`/`after` 預設不展開**:建表 `:26-28` 逐字寫明這兩欄「**可合法含經銷價 / 成本 / PII**」。v1 只在點開單列時才顯示,且**成本欄不進列表**。

## 4. 🔴 權限:這是本片真正的門檻(鐵則 12②;**2026-08-15 已拍板要做,見 §0**)

**現在沒有任何角色讀得到這張表。** `20260712210000:85` 先 `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`,`:89` 只補回 `GRANT INSERT TO service_role`。`:88` 逐字:「**不給 SELECT(最小權限;稽核 viewer slice 才顯式 GRANT SELECT TO service_role)**」—— **這片就是那個 viewer slice,建表當天就預告了。**
`:113-117` 還有 fail-closed 斷言:service_role 有 SELECT 就 `RAISE EXCEPTION`;`:127-133` 另斷言 service_role 的 grant 列數**恰為 1**。
⇒ 必須新開一支 migration:`GRANT SELECT ON public.admin_audit_log TO service_role`。

> 🔴 **2026-08-14 夜自我更正(本段第一版寫錯了機制)**:第一版寫「**同時把上面兩條斷言的終態改寫**,否則新舊斷言互相矛盾」。
> **「矛盾」不成立、「改寫」更是錯的做法。** migration **forward-only、只跑一次**(`20260712210000:140` 逐字),
> 那兩個 `DO $$` 是 **apply 那一刻**的檢查、**不會再跑** ⇒ 執行期沒有矛盾;
> 而編輯一支**已 apply 的** migration = **改歷史**,明文禁止。**照第一版那句做,下一個人會去動已上庫的檔。**
> **正解**:D0 寫**自己的**新斷言陳述**新終態**,檔頭寫明取代 `20260712210000` §4 的最小權限意圖。
> 先例 `20260807120000`(A9v):`:10`「REVOKE 不是 DROP、可逆」/`:118` 斷言**攤平後完整授權字串**而非只數筆數/`:106` **誤殺正控**/`:77-80` 自己標註某條恆真。
> **D0 四條斷言**:①`service_role` 終態恰 `INSERT`+`SELECT`、其餘 5 權限零 ②`anon`/`authenticated` 7 權限仍全零
> ③**誤殺正控:`INSERT` 仍在**(**18 個 migration 檔 + app 層 1 個呼叫點**的命脈;其中 **23 支函式**體內含稽核 INSERT(~~19 支 writer~~ 見 §1 更正),誤殺=後台所有寫入連帶死)④欄級 ACL 零殘留。
> ⚠️ 誠實界:**forward-only 我沒實測**,依據是 migration 檔字面 + 「不得編輯已 apply migration」既有紀律。詳見 `2026-08-14-27-d1-prep-notes.md` §1。
⇒ **鐵則 12②(權限/GRANT)+ ③(schema)雙中標 ⇒ 獨立成片 D0。**
**2026-08-15 更新**:Sean 已批(`Q-D1 = A`)⇒ D0 **可以寫**;
🔴 但 **apply 仍是 Sean 本人的獨立停點**(§0),寫檔 ≠ 上庫。
⚠️ 順帶一提:migration `:27` 說「安全來自**無人能 SELECT**」。開了 SELECT 之後那句話就不再成立,威脅模型變成「靠 admin 登入閘」—— 而 `#26` 說登入身分**目前仍是自選**(`session/actor.ts:6-7` 自陳非授權邊界)。~~這是要送給 Sean 的那顆決策,不是我能拍的。~~
   🏁 **已拍(`Q-D1b = A`,2026-08-15,Sean 知情後)** —— 但**正當性有到期日**,逐字條件見 §0。
   ⚠️ 這一行留著不刪,是因為它記著「威脅模型真的變了」這個事實;變的只是「誰來承擔」。

## 5. 片型 · 鐵則 · 驗收 · 誠實缺口

| 片 | 內容 | 檔數 | 片型 | 鐵則 |
|---|---|---|---|---|
| **D0** | migration:`GRANT SELECT` + **本支自己的**四條新斷言(**不碰已 apply 的 `20260712210000`**) | 1(新 migration) | **高風險片** | **8 + 12②③**,要 Sean 批 + apply |
| **D1** | 讀取 API + 頁面 + 篩選 + **D0 的必然連動**(見 §7) | **11**(逐檔實查 2026-08-15,**按檔去重**;原 plan 寫 8 是漏的)| 標準片 | **鐵則 8 命中**;D0 未 apply 前**不得上線**(跨 apply 停點) |

**驗收條件(每條 yes/no)**
1. `/settings/audit` 列得出最近 N 筆,預設 `created_at DESC`。
2. 時間顯示為台北時間,**而且是 import 既有的 `formatOrderDateTime`**
   (`apps/admin/src/lib/orders/order-detail-view.ts:37`;`:39` 與 `:41` 兩處都釘 `timeZone: 'Asia/Taipei'`)。
   🔴 **不得自己寫第 N 份時區字面。**(今晚 B 窗踩過:自寫 `toLocaleString('zh-TW')` 忘了釘時區,
   本機是台北所以三綠全綠,**正式站 Vercel Node `TZ=UTC` 每個時間差 8 小時**。)
   ⚠️ **只斷言「時區對」不夠** —— 人在台北時區時,沒釘時區的壞實作也會湊巧給對答案 ⇒ **那格是恆綠的**。
   ⇒ 測試要**額外釘死輸出格式字面**:拿一筆已知 UTC 值,斷言輸出**逐字等於** `YYYY-MM-DD HH:mm`
   (該函式 `:39` `en-CA` 日期 + `:40-44` `en-GB` 2-digit 時間 + `:45` 以單一空格串接)。
3. `actor` 顯示中文姓名而非 slug;`action` 顯示中文而非代碼。
4. `target` 為 `order:<uuid>` 時點得進該訂單頁;為 `customer:<uuid>` 時點得進客人頁。
5. **未知 action 代碼不會讓頁面炸**(塞一個字典沒有的代碼,應原樣顯示代碼本身)。
6. **列表層**不含 `before`/`after` 的內容(DOM 斷言:列表 HTML 查無成本欄字面)。
   ⚠️ **字面改準(R1 must-fix)**:原字面寫「列表不含 `before`/`after`」會讓讀的人以為
   「**成本不會被顯示**」——事實是「**成本不在列表、但點一下就看得到**」。
   ⇒ 本條只管**列表層**;展開層**會**顯示,那是本片刻意的設計,正當性見 §0 的**到期日前提**。
   🔴 這正是 §0 立的字面紀律(**不得寫成已評估安全**)在驗收條款上的同一種踩法。
7. 三綠 + `vitest` 全綠。
8. D0 未 apply 時,頁面顯示誠實錯誤態、**不顯示空清單假象**(鏡像 `customer-detail.tsx:120` 既有的 `loadFailed` 慣例)。
9. 🔴 **展開檢視要有明確的使用者動作才出現**(不是預設展開、不是 hover)。
   ⇒ **兩個方向都要釘,缺一即恆綠**:
   - **未展開時**:DOM 查無 `before`/`after` 內容(成本欄字面)。
   - **展開後**:DOM **查得到**(拿一筆刻意含成本欄的假資料)。
   ⚠️ **只釘前者的話,把展開功能整個拿掉也會綠** —— 那是恆綠格,不是守門。
10. 🔴 §0 的**到期日前提**要逐字出現在**展開檢視的 code 註解**裡
    (不只 plan、不只 migration 檔頭)。理由:**展開層正是那句話真正會被違反的地方** ——
    經銷價 / 成本 / PII 真的被畫到畫面上,就在這一格。

**誠實缺口(我沒驗的)**
- ❌ **沒對正式庫跑過任何查詢**。§4 全部權限結論來自 migration 檔字面 —— 而 migration 內有 fail-closed 斷言(`:109-117`)代表 apply 當下確實成立,但**「repo 裡的註解不是正式庫事實」照樣適用**;D0 開工前必須實查 `has_table_privilege('service_role','public.admin_audit_log','SELECT')`。
- ❌ **19 個 action 代碼是「今天數到的」不是「全部」**:型別層是 `string`(`types.ts:8`)、不列舉;而且我只掃了 `supabase/migrations/` 與 `apps/admin/src`,**沒掃報價單專案**(`source_app` CHECK 允許 `'quote'`,`20260712210000:58`)⇒ 正式庫裡可能已有本 repo 掃不到的代碼。字典必須 fallback 顯示原代碼(已寫成驗收 5)。
- ❌ 沒量過筆數:不知道正式庫現在有幾列 ⇒ **分頁要不要做、N 該設多少,我沒有數字支撐**,v1 先寫死取最近 100 筆並在片尾標為待調。
- ⚠️ 未擴張:`lib/sso/security-log.ts:3` 自陳「**這不是 admin_audit_log 正式接線**」、登入稽核走 stdout 且已被 Sean Q2=A 延後(S3b)⇒ **登入事件不在本頁**,本 plan 不動它。

## 6. 🔴🔴 D0 的承重約束:這張表的 append-only **是 ACL 撐的,沒有 trigger 兜底**

主視窗 2026-08-15 指出的約束,**我自己複跑過才寫進來**(不轉抄):

**事實 A — 這張表零 trigger(repo 字面)**
```
grep -rniE 'CREATE (OR REPLACE )?TRIGGER[^;]*' supabase/migrations/*.sql | grep -i audit_log   ⇒ 零命中
正向對照:同 pattern 不加 audit_log 過濾                                                        ⇒ 65 命中
```
⇒ pattern 有效,**零是真的零**。與 `20260812150000:489` COMMENT 逐字對上:
「該表現行 trigger 數=0、append-only **只靠 GRANT**」。
⚠️ **誠實界:這是 repo 字面,不是正式庫事實。** 我沒查過正式庫有沒有人手動加過 trigger。

**事實 B — `:132` 那顆「恰 1 筆」斷言不會回頭炸(我自己掃的)**
```
grep -rn "role_table_grants" supabase/migrations/*.sql | grep -i audit
```
⇒ 對 `admin_audit_log` 的筆數斷言**只存在於 `20260712210000` 自己**(`:128-134`),forward-only、已跑過。
唯一另一處 `20260717020000:445` 是 **`email_outbox`** 的、期望 **3 筆**、且訊息裡逐字寫「偏離 audit_log 的 1 筆 = CAS 認領所需」
⇒ **不同表,不受影響。** 順帶:那正是「期望值不是 1 也可以,但要在訊息裡說明為什麼」的**現成先例**。

**事實 C — 另外兩處引用是正向檢查,開 SELECT 不會讓它們變 false**
`20260803160000:630` / `20260806200000:681`,形狀都是 `IF NOT has_table_privilege(v_owner, …, 'INSERT')`
⇒ 檢查的是「**至少有 INSERT**」,多一個 SELECT 不影響。

### ⇒ D0 必須遵守的三條(寫進 migration,不是寫在信裡)

1. **只開 `SELECT`,一個字都不多。**
   不得順手開 `UPDATE` / `DELETE` / `TRUNCATE` / `REFERENCES` / `TRIGGER`。
   🔴 理由不是潔癖:**這張表的「不能改、不能刪」沒有第二道防線** ⇒ ACL 在這裡是**承重牆**,不是配置。

2. **自帶 fail-closed 斷言,終態恰 `{INSERT, SELECT}` 兩筆、不多不少。**
   形狀抄 `20260712210000:93-134`(那是原作者自己釘 ACL 的手法),四條:
   - ①`service_role` **有** `INSERT`(誤殺正控 —— **18 個 migration 檔 + app 層 1 個呼叫點**的命脈;其中 **23 支函式**體內含稽核 INSERT(~~19 支 writer~~ 見 §1 更正),誤殺=後台所有寫入連帶死)
   - ②`service_role` **有** `SELECT`(本片的目的)
   - ③`service_role` 其餘 **5** 權限(`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`)**全零**
   - ④`role_table_grants` 對 `service_role` **恰 2 筆**,`anon`/`authenticated`/`PUBLIC` **仍零**
   🔴 **訊息裡要寫明「為什麼是 2」** —— 抄 `20260717020000:445` 的寫法(它把偏離的理由寫進 RAISE 訊息裡)。
   否則下一個人看到 2 只會知道「期望是 2」,不知道**哪兩個、為什麼**。

3. **plan 與 migration 檔頭都要明寫這句事實,而且字面要準**:
   > `admin_audit_log` 的 append-only **由 GRANT 撐,表上零 trigger**;本片**只加 SELECT、不改變這件事**。
   🔴 **不得寫成「append-only 有保障」** —— 它有的是**一道 GRANT**,不是一道 trigger。
   ⚠️ 這不是措辭潔癖:寫成「有保障」會讓下一個人以為改 ACL 是安全的(反正還有 trigger 兜著),而**沒有**。

### 🏁 那顆疑慮已結案(2026-08-15 `Q-D1b = A`,Sean **知情後**拍板)
### ⚠️ 但上面那個「已結案」只對**當時**成立 —— **本段下半已被推翻,往下讀完再走**

原文留在 §0。結論:**他知道了才拍的**,理由是「後台目前只有他本人在測、員工還沒上工」。
⇒ **那不是「安全」,是「現在還沒有人會受害」** —— 前提有到期日,`#26` 是它的下游相依。
🔴 **§0 那段引文要逐字複製進 D0 migration 的檔頭 COMMENT。**

> 🔴🔴 **上面三行已被 Sean 2026-08-15 口頭推翻,原句留痕不刪。完整更正段在 §0(搜「前半段已被 Sean 口頭推翻」)。**
> **這裡不能只放指標,因為上面那句是【正面重申】不是引文**(E 窗 R2 must-fix):
>
> | 上面說 | 更正後 |
> |---|---|
> | 「前提**有到期日**」⇒ 現在成立、以後才失效 | 🔴 **缺口今天就存在** —— 缺的是**身分驗證**,與有沒有人上工無關 |
> | 「員工還沒上工」是安全的理由 | **員工本來就該看得到成本與客戶資料**(Sean 原話)⇒ **內容不是風險** |
> | 標題「🏁 已結案」 | ⚠️ **對「內容能不能給員工看」= 結案;對「進來的人是不是員工」= 沒結案** |
>
> ⚠️ **`:246` 那行也過期了**:引文**已經**複製進 `20260815020000:14`,而**複製過去的正是被推翻的那段**
> ⇒ 那支已 apply、sha 釘死、**改不動**;**引用它的檔頭之前必須先讀 §0 更正段**。
> **⇒ 這行從「待辦」變成「已完成但內容已被推翻」,不是還沒做。**

### D0 的版本號 = `20260815020000`(主視窗發,**我自己複驗過**)

檔名:`20260815020000_m4b_e10_27_d1_admin_audit_log_grant_select.sql`
🔴 **`20260815010000` 是 A 窗的,不得使用。**

我複驗的量法與結果:
```
ls supabase/migrations/ | grep -c "^20260815"
  · pcm-customers ⇒ 0    · pcm-website-v2 ⇒ 0
  · pcm-void-readers ⇒ 0 · pcm-products ⇒ 0   · pcm-print ⇒ 0
四樹最新皆 20260814190000_m4b_e10_473b1_refund_manual_corrections.sql
信箱佔位掃描 grep -rn "20260815[0-9]{6}" ~/pcm-mailbox/*.md ⇒ 零命中
  正向對照同 pattern 換 20260814 ⇒ 26 命中(pattern 有效,零是真的零)
```
⚠️ **與主視窗給的數字對不上,而我照實記**:它說「該是 1 —— A 窗的 `010000`」,
**實測五棵樹都是 0**,信箱也零佔位 ⇒ **A 窗那支還沒落檔**(或只在它的 plan 裡)。
結論不變(`020000` 仍空),但**「該是 1」這個期望值不成立,別拿它當守門**。
⚠️ **掃描限度**:只掃本機五棵樹 + 信箱;**remote 上、本機無對應 branch 的號掃不到** ⇒ 下限不是保證。

### D0 的誠實缺口(補在原 §5 之上)

- ❌ **`has_table_privilege('service_role','public.admin_audit_log','SELECT')` 我沒實查正式庫** ——
  原 plan 已寫「D0 開工前必須實查」,**這條到現在仍未做,而且我做不到**(不碰正式庫)。
  ⇒ **這是 apply 前 Sean 或主視窗要跑的一道,不是我能勾掉的。**
- ❌ **零 trigger 是 repo 字面,不是正式庫事實**(事實 A 的誠實界)。
- 🔴 **codex 關卡2 的歷程(2026-08-15;三輪,狀態隨時間變過,**這一段自己就過期過一次**)**
  🏁 **現況(最新)**:**R1 判 FAIL 5 條、R2 再判 FAIL(must-fix 3 + nit 1),兩輪共 9 條全折完。**
  折法逐條在 D0 migration 檔頭的「codex 折法紀錄」段。**目前等主視窗放行才 commit。**
  🔴 **R2 的三條 must-fix 全部在丟棄庫實驗證過,全部成立**:
  - **MF2(最重,真的權限洞)**:PG17 `GRANT pg_maintain TO service_role` ⇒ `MAINTAIN` 有效權限成立,
    但 **relacl 攤平字串與期望值逐字相同**、原本查的五種權限**全部 false** ⇒ **兩層都看不到。**
    ⇒ 補進權限清單,且**版本感知**(PG16 以下不認得該名字,實測回 `22023`,硬加會讓 apply 當場炸)。
  - **MF1**:掛一支 `AFTER INSERT` trigger 後,**舊版八格全部通過並 `COMMIT`** ⇒ 檔頭那句「零 trigger」**沒有守門**。
    ⇒ 新增一格數非內部 trigger。
  - **MF3**:`2a` 的 RAISE 訊息宣稱「RLS on + 零 policy」,**但那一格當時還沒跑** ⇒ 假字面。
    ⇒ **把 RLS/policy 檢查整組移到最前面**,後面的訊息才引用得起它。
  🔴 **自審再補一格(等 R3 期間做的,不是 codex 指出的)**:主視窗問「`malformed array literal`
  是孤例還是通病?」——**答案:不是孤例。** 實測 `IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname=...)`
  在**角色不存在**時子查詢回 NULL,plpgsql 對 `IF NULL` 走 ELSE ⇒ **整格靜默放行(fail-open)**。
  `service_role` 有 `GRANT` 擋著,但 **`anon`/`authenticated` 在本支沒有任何 GRANT 引用** ⇒ 那兩格真的會 fail-open。
  ⇒ 新增 **2-pre**:三個角色必須存在,**把整族一次收掉**;附專屬負控(`drop role authenticated` ⇒ 紅)。
  🏁 **丙案(主視窗 2026-08-15 裁):加一格「只印不擋」的角色繼承觀測**,配 backlog **`#505`**。
  背景:現行防繼承是**列舉權限名**,天花板是「**PG18 再多一個新權限就原樣重演**」。
  機制解 = **查角色成員資格**(實測一個查詢同時抓到 `pg_maintain` 與 owner 兩條繼承路,**不依賴權限名**)。
  🔴 **但沒有寫成硬斷言,而且理由要記住**:本片作者**看不到正式庫**,寫死「必須零成員」= **拿看不到的東西當期望值**,
  會在最糟的時刻(Sean 一個人 apply 時)擋住他。⇒ **只觀測、不判定。**
  ⚠️ **這一格對防護的貢獻是零** —— 價值完全取決於有沒有人把輸出貼回來。
  ⇒ 配套:apply 指示逐字要求回報 + `#505`(拿到實際拓樸後改硬斷言)。
  **在 `#505` 做完之前,這個洞仍然開著,我們只是終於知道它現在的形狀。**
  ⚠️ **`#505` 的 backlog 條目目前不在 backlog 檔裡** —— 完整文字在 `~/pcm-mailbox/C-034-STOP.md` §2。
  主視窗 2026-08-15 裁定「現在誰都不要寫」:`docs/phase-1-backlog.md` 已被三條線改在三行之內、
  且它正在 R4 審查範圍內,**現在寫 = 讓審查目標移動**。收割時一次併。
  🔴 **看到這段的人請不要「順手補上」** —— 那不是漏做,是刻意排程。

  ⚠️ **兩個原本被我標成「誠實缺口」的,codex 與主視窗都裁定是藉口,我接受**:
  欄級與 trigger **在丟棄庫幾行就能構造** ⇒ 現在都有專屬負控,**不再是缺口**。
  ⚠️ **本條在 2026-08-15 稍早寫成「兩輪皆未產出 findings、本片至今未經不同模型對抗審查」——
  那句話在 R3 成功後就過期了,而我更新了信卻沒更新這裡,是自驗掃描才抓到的。**
  🔴 這正是本片一直在防的同一個病:**改了狀態,沒改記錄狀態的字面。**
  ⚠️ 主視窗自陳 R1/R2 的「失敗」有一半是判讀錯誤:**判定在 codex 自己的 session jsonl(`task_complete`),
  輸出檔的 tail 不可靠** —— 它讀過那份記憶仍用輸出檔判斷。
  下面保留三輪的原始事實當紀錄:(主視窗轉述;我未自跑 —— `codex-adversary` 只能 main session 跑):
  - R1:migration 全文入 prompt + 白名單 2 檔 ⇒ 無 findings;被 12 分 watchdog 砍時**還在找檔**。
    🔴 主視窗自陳白名單檔名是它**編的**(給 `..._a9v_grant_assert_flatten.sql`,真名 `..._a9v_nine_code_writer_revoke.sql`)。
  - R2:全部內聯、明文禁開檔禁 grep ⇒ 無 findings;輸出 183 行 = prompt 回聲 + header,**判定段零命中**
    (驗法 `grep -nE "判定|^PASS|^FAIL"` 唯一命中是 prompt 自己那行格式說明)。
  - 🔴 **R2 不是逾時,是自己結束的**(2026-08-15 補測,主視窗實跑):
    `stat` 顯示 `created=01:11:20 / modified=01:13:21` ⇒ **只跑 2 分 1 秒,12 分 watchdog 根本沒觸發**。
    ⇒ **兩輪不是同一種失敗**:R1 是真逾時(找一個不存在的檔),R2 是**大 prompt 進去、零 model 回覆出來**
    (無 `codex` 標記、無 `tokens used`)。可疑點指向 **prompt 尺寸/形狀**(168 行、含 fenced SQL、
    另有一行 `warning: Skill descriptions were shortened to fit the 2% skills context budget`),**不是時間**。
    ⚠️ 這條推翻了「放寬 watchdog 再跑一次」那個修法 —— **再多給時間治不到 R2。**
  - codex 本身正常啟動(`v0.144.1` / `gpt-5.6-luna` / `read-only` / effort high),
    且主視窗另跑過 smoke test(`codex exec -s read-only "只回答兩個字:測試通過"` ⇒ 正常回覆 + `tokens used 19,019`)
    ⇒ **不是沒裝、沒登入、被擋**;兩輪輸出裡的 `failed to load models cache` **是無害噪音、不是根因**。
  🔴 **不得把這條寫成「codex 通過」或「無 findings」** —— 那正是
  `feedback_absence-read-as-verified` 的形狀:**「什麼都沒有」被讀成「檢查過了」**。
  ⚠️ **鐵則 12 的條件目前仍未滿足** ⇒ **D0 不 commit** —— 但理由已經換了:
  不再是「審查跑不成」,而是「**R1 已 FAIL、折完了,還缺一輪確認**」。**條件未達,不是保守。**
- ❌ **D0 的丟棄庫實跑不能替代對抗審查**:它證明的是「**我寫的斷言會如我預期那樣紅**」,
  證明不了「**我漏掉了哪一格該有的斷言**」。
  🔴 **R3 直接證實了這句**:六道負控全綠的那一版,codex 抓到 **2b 是恆真格**、**2f fail-closed 過頭**
  —— **兩條都不是「負控沒跑」,是「我沒想到要寫那一格」。**

## 7. 🔴🔴 D1 的檔案清單 = **11 支,不是 8 支**(2026-08-15 逐檔實查)

**數法**:`for f in <清單>; do test -f "$f" && echo 存在 $(wc -l < $f) || echo 不存在; done`,
然後 `sort -u | wc -l` **按檔去重** ⇒ **11**。
⚠️ **我中途數錯過兩次**(先報 13、又報 14):把「同一支檔多一件事要做」當成新檔 = **重複計數**。
`repository.ts` / `supabase-repository.ts` / `order-repository.ts` 本來就在原 8 檔裡。
🔴 **病根 = 沒先定義「一支檔算一次」就開始數** —— 與 C1 那次「8 檔不是 7」是**同一個病的反向版**(那次漏數)。

### 7-1 原 8 支(4 支存在 / 4 支新建)

| # | 檔 | 現況 | 要做什麼 |
|---|---|---|---|
| 1 | `lib/audit/repository.ts` | 存在 33 行 | 加**讀取埠**(現只有 `record()` 寫入埠)+ 改 §7-2 的註解 |
| 2 | `lib/audit/supabase-repository.ts` | 存在 28 行 | 加讀取實作 + 改 §7-2 的註解 |
| 3 | `lib/audit/audit-list-view.ts` | **新建** | 代碼→中文字典、`target` 切連結、時間走 `formatOrderDateTime` |
| 4 | `lib/orders/order-repository.ts` | 存在 52 行 | 加讀取 getter + 改 §7-2 的註解 |
| 5 | `app/settings/audit/page.tsx` | **新建**(`app/settings/` 現只有 `staff` / `suppliers`) | 頁面 |
| 6 | `components/audit/audit-table.tsx` | **新建**(連 `components/audit/` 目錄都不存在) | 表格 + 展開檢視 |
| 7 | `components/layout/app-sidebar.tsx` | 存在 100 行 | `NAV_ITEMS` 加一列 |
| 8 | `lib/audit/audit-list-view.test.ts` | **新建** | 單測 |

### 7-2 🔴 第 9-11 支 = **D0 的必然連動,不是「順便改」**

**5 支既有檔寫著「service_role 對 `admin_audit_log` 無 SELECT」—— D0 一 apply,那句話就是假的。**
其中 3 支已在原 8 檔裡(#1/#2/#4),**另外 2 支是新增的**:

| # | 檔 | 行 | 現行字面 |
|---|---|---|---|
| 9 | `lib/audit/types.ts` | `:36` | 「對齊 REQUIRED-2 return=minimal(不回讀 id)」 |
| 10 | `lib/audit/repository.test.ts` | `:92` | 「service_role **無 SELECT** 下 return=minimal 不炸 42501」 |

🔴 **收尾掃描用 `bash scripts/literal-sweep.sh '<舊字面>'`,不要手寫 grep 組合**
(全窗通報 2026-08-15;它在本 worktree 就有,實測 2105 個文字檔約 1.2 秒、自帶 6 發負測)。

⚠️ **而且這一組要掃兩個字面才掃得全** —— 實跑證據:
```
literal-sweep '無 SELECT'   ⇒ 命中 4 支:repository.ts:13 / supabase-repository.ts:14
                                        / order-repository.ts:35 / repository.test.ts:92
literal-sweep 'REQUIRED-2'  ⇒ 命中 5 支:上面 4 支 + types.ts:36
```
⇒ **`types.ts:36` 寫的是「對齊 REQUIRED-2 return=minimal」、句子裡沒有「無 SELECT」四個字**
⇒ **只掃「無 SELECT」會漏掉它**,而它同樣是靠那個前提寫的。
🔴 **這正是工具自己的限度第 4 條**:「它告訴你**哪裡還有這個字面**,不告訴你**那句話現在是真是假**」——
**判斷『哪些字面算同一件事』仍然是人的工作**,工具只保證掃得乾淨。

🔴 **為什麼必須同片改、不能另立案**(主視窗 2026-08-15 裁定):
那 5 處寫的是**一句安全性質的宣稱**。留著它,下一個讀的人會以為「這張表對 server 也是唯寫的」,
而 apply 之後**整張表對 server 全開讀**。⇒ D1 是 D0 之後**第一片碰這條線的**,**沒有比這更晚可以修的時機**。

**第 11 支**:`components/layout/app-sidebar.test.ts`(存在 192 行)`:87` 是
`expect(navEntries()).toEqual([...])` **全清單斷言** ⇒ 第 7 支加一列 nav **必定弄紅它** ⇒ 同片改。
⚠️ **這條目前是「推的」不是「量的」**(我讀 `:87` 字面、沒實跑)。
**實作第一動 = 加那一列然後跑一次,把推變成量。不要帶著推論進 commit。**

### 7-3 🏁 「禁鏈 `.select()`」這條規定:**留,但理由換掉**(主視窗 2026-08-15 裁定)

**原理由(建表時)**:「service_role 沒有 SELECT 權,鏈了會 42501」⇒ **D0 之後不成立。**

⚠️ **我提的替代理由被否決,而且否得對**:我寫「不回讀 = append-only 的手癖防線」——
**站不住**:`append-only` 是「**不能改、不能刪**」,**讀不在裡面**;回讀一列並不違反它。
🔴 **用站不住的理由撐一條規定,下一個人一戳就破,規定照樣被拿掉。**
(這段寫進來是刻意的 —— 否則下一個人會以為我們沒想過這個理由。)

**採用的理由 = 「這個 GRANT 有到期日」**(扣回 §0):
- 規定**留著** ⇒ 這個 SELECT 權限**只有一個消費者**(檢視頁)。要收回時,關掉一頁就好。
- 規定**拿掉** ⇒ **每一條 audit insert 路徑**(**18 個 migration 檔 + app 層 1 個呼叫點**;~~19 支 RPC~~ 見 §1 更正)都可能開始回讀
  ⇒ 消費者從 1 個變成幾十個、**散在所有寫入路徑裡**;要收回等於全面回歸。

> **一句話:開一道有到期日的權限時,要讓依賴它的東西數得出來。**

🔴 **改註解的紀律**:**絕不可以只把「無 SELECT」四個字刪掉就當修完** ——
那會留下一條**沒有理由的禁令**,下一個人會順手拿掉它。
⇒ 每一處都要**換成上面那個理由**,並**指向 §0 的到期日前提**,兩處互相扣住。

### 7-4 不動的:`package.json` / `pnpm-lock.yaml` / 已 apply 的 migration 與 docs

- **零新 dep** ⇒ lock 不動。D1 要用的三樣(supabase client / `formatOrderDateTime` / `lib/staff.ts:16 pickStaff`)
  全在 `apps/admin/package.json` 現有 13 個 dep 裡。(C1 那次動 lock 是因為**新加** `@pcm/schemas`。)
- **已 apply 的 migration(`20260712210000:19/88/112`、`20260802150000:62`)與 docs 的過期字面不動** ——
  forward-only、**不得編輯已 apply 的 migration**;D0 檔頭已寫明它取代的是哪一半意圖,那就是正確處置。

## 8. 🏗 D1 施工 plan(2026-08-15;D0 已 commit `feaa91c3`、**未 apply**)

### 8-1 逐檔實查(**開工前重數一次,不抄舊清單**)

數法:`for f in <11 支>; do test -f "$f" && echo 存在 $(wc -l < $f) || echo 新建; done`,
再 `awk '{print $NF}' | sort -u | wc -l` **按檔去重** ⇒ **11**。

| # | 檔 | 現況 | 要做什麼 |
|---|---|---|---|
| 1 | `lib/audit/repository.ts` | 存在 **33** 行 | 加**讀取埠**(現只有 `record()` 寫入埠)+ 改 §8-2 的字面 |
| 2 | `lib/audit/supabase-repository.ts` | 存在 **28** 行 | 加讀取實作 + 改 §8-2 |
| 3 | `lib/audit/types.ts` | 存在 **47** 行 | 只改 §8-2 的字面(型別不動) |
| 4 | `lib/audit/repository.test.ts` | 存在 **94** 行 | 改 §8-2 的字面 + 補讀取路徑的測試 |
| 5 | `lib/audit/audit-list-view.ts` | **新建** | 代碼→中文字典、`target` 切連結、時間走 `formatOrderDateTime` |
| 6 | `lib/audit/audit-list-view.test.ts` | **新建** | 單測(含驗收 2 的輸出格式逐字斷言) |
| 7 | `lib/orders/order-repository.ts` | 存在 **52** 行 | 加讀取 getter + 改 §8-2 |
| 8 | `app/settings/audit/page.tsx` | **新建** | 頁面(`app/settings/` 現只有 `staff` / `suppliers`) |
| 9 | `components/audit/audit-table.tsx` | **新建** | 表格 + **展開檢視**(驗收 9/10) |
| 10 | `components/layout/app-sidebar.tsx` | 存在 **100** 行 | `NAV_ITEMS` 加一列 |
| 11 | `components/layout/app-sidebar.test.ts` | 存在 **192** 行 | `:87` 是 `toEqual` 全清單斷言,**加 nav 必定弄紅它** |

⚠️ **第 11 支目前仍是「推的」不是「量的」**(讀 `:87` 字面、沒實跑)。
**實作第一動 = 加那一列然後跑一次,把推變成量。不要帶著推論進 commit。**

### 8-2 🔴 D0 造成的 stale 字面:**5 支檔,而且每支不只一行**

**先寫下這個概念有幾種寫法,再掃**(不是邊掃邊想)——四種:
`無 SELECT` / `REQUIRED-2` / `return=minimal` / `禁鏈`。

```
bash scripts/literal-sweep.sh '無 SELECT'      ⇒ repository.test.ts:92 / repository.ts:13
                                                 supabase-repository.ts:14 / order-repository.ts:35
bash scripts/literal-sweep.sh 'REQUIRED-2'     ⇒ 上列 + supabase-repository.ts:10 / types.ts:36
bash scripts/literal-sweep.sh 'return=minimal' ⇒ 上列 + repository.test.ts:59 / repository.ts:14
bash scripts/literal-sweep.sh '禁鏈'           ⇒ repository.ts:15 / supabase-repository.ts:10
                                                 / order-repository.ts:35
⇒ 去重後載體 = 5 支
```
🔴 **只掃一個字面會漏**:`types.ts:36` 只有 `REQUIRED-2` 抓得到、`repository.test.ts:59` 只有 `return=minimal` 抓得到。
🔴 **而且每支檔內不只一行**(`repository.ts` 有 `:13`/`:14`/`:15` 三行)——
**「找到那支檔」不等於「找到那支檔裡所有要改的行」。**

**改法(主視窗 2026-08-15 裁定)**:**規定留、理由換掉。**
- ❌ **不採用**「不回讀 = append-only 的手癖防線」—— **站不住**:append-only 是「不能改、不能刪」,**讀不在裡面**。
- ✅ **採用**「**這個 GRANT 有到期日**」:規定留著 ⇒ SELECT 只有一個消費者(檢視頁),要收回關掉一頁就好;
  規定拿掉 ⇒ **18 個 migration 檔 + app 層 1 個呼叫點**(~~19 支 RPC~~ 見 §1 更正)都可能開始回讀,要收回等於全面回歸。
  > **開一道有到期日的權限時,要讓依賴它的東西數得出來。**
- 🔴 **絕不可以只把「無 SELECT」四個字刪掉** —— 那會留下一條**沒有理由的禁令**,下一個人會順手拿掉它。
  每一處都要**換成上面那個理由**並**指向 §0 的到期日前提**。

**收尾驗收**:四個字面各跑一次 `literal-sweep`,**每個都要能指出「剩下的命中都是刻意保留的更正引文」**,
並附**正向對照**(同 pattern 在別處仍有命中 ⇒ pattern 有效)。

### 8-3 開工順序(每片 15-45 分)

| 片 | 做什麼 | 卡什麼 |
|---|---|---|
| **D1a** | 讀取埠 + adapter + getter(#1/#2/#7)+ 同批改 §8-2 那 5 支的字面 | 無 —— **可立刻開工** |
| **D1b** | `audit-list-view.ts` + 單測(#5/#6) | D1a |
| **D1c** | 頁面 + 表格 + **展開檢視**(#8/#9)+ sidebar 與它的測試(#10/#11) | D1b |
| **D1d** | 肉眼驗 + 空狀態/錯誤態文案 | D1c + **apply(Sean)** |

🔴 **D1a-c 都寫得完、三綠都會過**(型別檔早就有 `admin_audit_log` 的 `Row`),
**但在 apply 之前跑起來會 42501** ⇒ **驗收 8(誠實錯誤態、不顯示空清單假象)是這片的承重驗收,不是附加項。**

### 8-4 這片**不做**什麼
- ❌ 不 join `orders` 顯示單號(v1 只給「查看訂單」連結;要單號等 Sean 看過畫面再說)。
- ❌ 不碰登入稽核(`lib/sso/security-log.ts` 自陳非正式接線,Sean Q2=A 已延後)。
- ❌ **不寫 `#505` 的 backlog 條目** —— 主視窗裁定收割時併入,**不要順手補上,那是刻意排程**。
