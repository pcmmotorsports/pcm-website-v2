# 交接:M-4a B-2(`create_order` 8→9 參)已 commit,但 codex 關卡2 判 **NO-GO**(2026-07-19)

> **本檔是接手 session 的唯一入口。** 讀完本檔 + 下列三份即可動工,不需重讀整條線歷史。
> **本檔為 Claude 產出**,不屬 Sean ownership 凍結清單(他的凍結檔見 §6)。
> **紀律**:本檔所有「已驗/未驗」皆為實測結果;**未驗項不得當已驗用**,接手後任何宣稱請自己重驗。

## 0. 一句話現況

B-2 的 code **已 commit(`1c63970`)但未 push、未 db push**;production **完全未被動過**。
codex 關卡2 判 **NO-GO,5 個 must-fix**(全是真問題,其中 2 條是前一視窗的**假宣稱**)。
**下一步 = 修完 5 條 → 重跑 codex 關卡2 要 GO → 才交 Sean db push。**

## 1. 動工前必讀(依序)

1. 本檔
2. 上位真權威 PRD:`docs/specs/2026-07-18-b0-order-notification-email-prd.md` §4 B-2 / §5 / §6
3. 片級 plan:`docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md`(含三輪 codex + 兩輪 code-reviewer 銷案表)
4. 主體:`supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql`
5. 拍板 memory:`project_m4a-b2-create-order-9param-decisions`(Q1-Q7 全文)

## 2. 🔴 codex 關卡2 findings —— 5 must-fix,**全部待修**

> 完整輸出在該 session scratchpad(已隨 session 結束消失)→ 以下為逐條轉錄,**接手可直接照做**。
> 修完**必須重跑 codex 關卡2**(`codex exec -s read-only`,main session、`< /dev/null`、前後比對 `git status --porcelain`)。

### M-1 advisory lock 是**假互斥**(前一視窗的假宣稱)

- 位置:migration `SELECT pg_advisory_xact_lock(20260719120000);`(檔內約 §段 2 之後)、plan §4 段 2.5 的「緩解」段落
- **問題**:用的是**本 migration 專屬的 timestamp 當 key**。下一支 migration 會用它自己的 timestamp → **兩把鎖不衝突、根本不互斥**。前一視窗宣稱「已緩解」= **假的**。
- **修法(二選一)**:①改成所有 `create_order` DDL **共用的固定 object-scoped key**(例如以 `'public.create_order'::regclass` 之類穩定字串 hash 出的常數,寫死並註明)②**刪除「技術緩解」宣稱**,只保留「Sean 單人序列操作」的有界假設(codex 明說單一 writer 假設本身可接受)。
- ⚠️ 同時要修 plan §4 段 2.5 與 §7 Q5 裡的對應字面 —— **grep 全檔銷,勿只改被點名那一處**。

### M-2 狀態 A 守門指紋**不完整**,卻自稱「全屬性」

- 位置:migration 段 2.5 的 `FP_EXPR` 指紋公式、plan §4 段 2.5「完整指紋」定義
- **問題**:公式漏掉 **`proretset`、`prosupport`、security-label 狀態**;這三項**明明列在 E11**。它們若漂移,守門仍放行並 DROP。
- **修法**:把 E11 每一欄真的納入(建議**逐欄比較**而非串接 md5,避免再用「全屬性」稱呼一個不完整的雜湊)。若仍用 md5,公式必須補齊三項並同步更新基線指紋值(**基線指紋會改變,須重取**)。

### M-3 狀態 B 守門**過弱** —— 會靜默洗掉未知變更

- 位置:migration 段 2.5 的 `ELSIF v_n9 = 1 AND v_n8 = 0` 分支
- **問題**:只驗 `prosrc` md5 + 參數字串。若 history 裂縫後有人改了 owner / `SECURITY DEFINER` / `search_path` / ACL / COMMENT,重跑會**靜默覆寫**。檔內註解寫「本來就要 canonicalize,所以沒風險」——codex 判定**那正是守門存在要禁止的覆寫行為**。
- **修法**:狀態 B **也必須驗完整預期產出指紋**。理由:正常的 history 裂縫一定是「完整 COMMIT 後」的狀態,沒有放寬理由。

### M-4 rollback **實際不可執行**

- 位置:`docs/reviews/2026-07-19-b2-preapply-snapshot.md` §4、plan §9 前置義務
- **問題**:snapshot 只存了 **`prosrc` 本體、不是完整 `pg_get_functiondef`**;其自身也未明列 `proretset=false`;repo 內**沒有可直接執行的 rollback migration**。事故時得臨場組 `CREATE` header、依賴 snapshot 以外的推論 → 違反「rollback 唯一權威」。
- **修法**:🔴 **不改既有凍結檔**(它自訂「產出後不得再編輯」)→ **新增一份 immutable supplement**,內含:完整 raw `pg_get_functiondef`、完整 E11 全欄值、**預先產生且已 parse 驗證的 rollback SQL + 其專屬斷言**。

### M-5 schema/history 分離**不是假設,是確定會發生**

- **codex 讀了 CLI v2.98.1 原始碼**(`pkg/migration/file.go` + pgconn `ExecBatch`):CLI 先排入 migration 全部 statements、**之後才追加 history INSERT**;pgconn 遇到顯式 transaction control **不再提供整批隱式交易**。
  → 檔內 `COMMIT` 後斷線或 history INSERT 失敗,**確實**會留下「9-param 已生效、history 未記」。
- **判定**:可重跑策略本身**合理**,但前提是 **M-3 修好**(狀態 B 守門完整)。
- **另須補**:失敗後的 **SOP** —— 先查 history / 簽章 / 完整指紋,**再決定是否重跑**,不可直接再按一次 `db push`。寫進 plan §10 或 migration 檔頭。

### 非阻擋(nit,順手清)

- Q1=A 的已知代價:不合規值會在**跑完整個商品迴圈與 `nextval()` 之後**才撞 CHECK → generic 500 + **單號跳號**。依 Q1=A **不在 RPC 補第三份規則**;硬條件 = **B-4 的 flag 不得在 B-3 六條鏡像驗證完成前開啟**。
- DROP 會換 OID、清函式統計 → 不影響功能,不需為此擋 apply。

### codex 判 OK 的部分(不必再動)

- 守門的**狀態 A/B 二分本身沒漏合法狀態**(零函式 / 兩者並存 / 其他 overload 都應停,設計正確)
- **ACL 重建沒有漏復原**:`proacl` 精確值 + 六角色 effective privilege 斷言足以攔住其他 default grants
- **Q1=A 確實落地**:RPC 內只寫入原值,零 trim / 正規化 / 驗證
- 現行 app 仍送 8 參 → B-3/B-4 前正常結帳不會產生髒值;且**建單先於 TapPay**,不會形成「已扣款但沒訂單」

## 3. ✅ Sean 2026-07-19 拍板(不可再質疑該不該問,只可質疑落地)

| # | 拍板 | 重點 |
|---|---|---|
| Q1 | A | 不合規 email **裸傳、由 B-1 CHECK 擋**;RPC 內**不加任何驗證/正規化**(不新增第三份規則) |
| Q2 | A | `database.types.ts` **刻意未同步**、留 B-4 —— 是拍板結果,**不是漏做** |
| Q3 | A | 檔內自帶 `BEGIN/COMMIT` + 兩簽章 `DROP IF EXISTS`;**不做** disposable DB failure-injection |
| Q4 | B | 明示破例加開 codex R3(輪數 override 是 **Sean 的權限**,Claude 不可自行加輪) |
| Q5 | A | 守門競態窗口記為**有界假設** |
| Q6 | A | 設定層加 hook + 改寫 MEMORY.md 句式(**已落地**) |
| Q7 | A | MEMORY.md 精簡**順延至 M-4a 收尾** |
| **新** | **A** | 🔴 **語法預檢:做**(見 §4) |

## 4. 🔴 語法預檢(Sean 剛拍 A,**尚未執行**)

- **為什麼要**:所有交易模擬用的都是「**在 DB 內等價重建**」的版本,**整份 migration 檔從未被 PG 完整 parse 過**。未覆蓋面 = 檔頭註解 / `BEGIN`/`COMMIT` / `SET LOCAL` / `pg_advisory_xact_lock` / `COMMENT ON FUNCTION` 的 SQL 逸出正確性。
- **codex 明說**:這**不同於** Sean 拒絕的 failure-injection,是**更便宜**的 syntax preflight。
- **環境已查(可行,不需走替代路線)**:
  - ❌ 無 docker
  - ✅ **本機 Homebrew PostgreSQL 17.10**(`postgres` + `psql` 皆在)
  - ✅ supabase CLI 2.98.1(有新版 2.109.1,未升)
  - 目前 5432 / 54322 **皆無 pg 在 listen**
- **做法**:起一個拋棄式本機 DB → 把 `20260719120000_...sql` **原封不動**套一次 → 只確認**語法**(執行會因缺 `auth.uid` / 缺表而失敗屬預期,**要看的是有沒有語法錯**)→ 丟掉。
- ⚠️ 預檢**不可**改動檔案內容(改了就不是預檢那份)。

## 5. 已完成且已驗證的部分(**不要重做**)

- **函式體零手動轉錄**:以程式從 prod 已驗證副本產生;**反向還原後 md5 == prod 基線**;`prosrc` 層 delta = **1 處**(orders INSERT 欄位 + VALUES),簽章與 COMMENT 不在 prosrc 內故檔面 = 3 處(unified diff 會顯示 **2 個 hunk**,同屬那 1 處)
- **三綠**:typecheck 8/8 + lint 10/10 + 運費 drift test 3/3(build N/A)
- **prod 交易模擬全過、零留痕已驗**:SIM-A(DB 自行由 prod `prosrc` 推導,md5 == 檔案內值)/ SIM-B 真建單三案(合法 email 存入正確、省略第 9 參 → NULL、合成域 → `23514 check_violation`)/ SIM-C(檔內斷言 DO block **原文**抽出實跑)/ 守門原文實跑 + **mutation test 證明守門會觸發**
- **審查**:codex 關卡1 R1/R2/R3 皆 FAIL、18 條全處置(+1 條 codex 三輪未點名、由 grep 全檔自查補上);code-reviewer R1 FAIL → **R2 PASS**
- **commit 後已驗** lint-staged 未改寫內容(committed 版函式體 md5 相符)

### 關鍵數值(可重取,勿寫死於他處)

| 項目 | 值 | 重取方式 |
|---|---|---|
| prod 現行 `prosrc` md5 | `a60944edb678064c468ba517391cc311`(12,225 octets) | `select md5(prosrc), octet_length(prosrc) from pg_proc where oid='public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)'::regprocedure;` |
| 新 9-param `prosrc` md5 | `0bc0d256b7483c5dd6ef1f8f97b4e9a7`(12,275 octets) | 抽 migration 檔 `$fn$…$fn$` 本體算 md5 |
| 全屬性基線指紋 | `2b898129e49d194c30ab8039b857c0be` | ⚠️ **M-2 修好後此值會變,須重取** |
| 舊 COMMENT md5 / 長度 | `7aec7ae7dbf52af683586a360ccde641` / 584 | `select md5(obj_description(oid,'pg_proc')), length(...) from pg_proc where ...` |
| Supabase project_id | `bmpnplmnldofgaohnaok`(pcm-website-v2、PG 17.6) | — |

### prod 現況(每次動工前自己重驗,勿信本檔字面)

`create_order` 簽章數 **1**、仍 **8 參**、`prosrc` md5 = 上表基線、orders **30** 筆、migration 水位 `20260718120000`。

## 6. git / 部署狀態

- branch `dev`;HEAD = `1c63970`;**未推 1 commit**(⚠️ 一律以實跑為準:`git rev-list --count origin/dev..HEAD` / `git rev-parse --short origin/dev`)
- **未 push、未 db push**
- ⚠️ push `dev` 會觸發 **pcm-admin 重部署**(`dev` 是 admin 的 production 分支)。本批為 `.sql` + `.md` + 1 個測試檔**註解** → admin 行為不變。
- ⚠️ **Sean ownership 凍結檔(勿動、勿混入 commit)**:`.gitignore`、`docs/progress-roadmap.html`、各 `*.png`、`docs/handoff/2026-07-1*`(**本檔除外**)、`docs/specs/2026-07-15|16-*`、`docs/specs/2026-07-19-m4a-email-e2a-2-plan.md`、`docs/reviews/2026-07-16-*`、`docs/superpowers/`
- **精準 `git add <路徑>`,禁 `git add .` / `-A`**

## 7. 本 session 的制度層產出(已落地)

- 🔴 Fable 稽核證實「只改被點名那一處」**已復發 9+ 次**,且治本步驟 **07-17 就已寫在 memory**、之後照樣復發 → 根因 = **時機型規則放在只能靠回憶的載體**;`settings.json` 的 hooks 是唯一 deterministic 層、原 6 個 hook **零個觸發規則**。
- **已新增** `~/.claude/hooks/contract-sync-reminder.js`(PostToolUse `Write|Edit`;命中 `docs/specs|handoff|reviews/*.md`、`STATUS.md`、`*prd*.md` 時提醒 grep 全樹建舊字面清單;每 session ≤3 次;任何錯誤靜默 exit 0;**六項測試全過**),掛進既有 `Write|Edit` 群組 = 零常載成本。
- MEMORY.md 該行已改**觸發器句式**;memory 全文補上診斷。
- 詳見 memory `feedback_freeze-artifact-before-adversarial-review` 與 `feedback_claimed-sync-but-only-patched-touched-lines`。

## 8. 本 session 抓到的「字面 vs 事實」偏差(接手務必知道)

1. 🔴 **advisory lock「已緩解」是假宣稱**(= M-1)。設計了一個看似合理、實際不成立的緩解措施,還寫進報告。
2. 🔴 **守門自稱「全屬性指紋」但漏三項**(= M-2)。**名稱誇大實際能力**。
3. 🔴 **Packet 兩處宣稱 §7 有交易模擬全文,但檔案在 §6 就結束了** —— 這正是 B-1 被 Codex 抓過的同一個坑,**在我自己寫的「避免此坑」提醒下方又犯一次**;產出後自查才發現。→ **產完任何「自帶材料」的文件,必須逐項驗證被引用的章節真的存在。**
4. `pnpm x | tail -3` 讓 `Tasks:` 判定行被截掉 → 看不到真實結果。**一律 grep 判定行,不用 tail 取 N 行。**
5. 測試腳本自身的 bug(shell 引號誤寫成 SQL 逸出)造成**假紅** → 沒當它過,改用腳本檔重驗才拿到真結果。
6. 編輯 plan 表格時多打一個 `|` → 欄數從 4 變 5,**多出的內容渲染時會被吃掉**(原始檔看得到、顯示不出來)。由 IDE lint 抓到。
7. codex R2 點名 §9 兩處已作廢字面,**grep 全檔後發現第三處在 §1「一句話」** —— 審查員也會漏,**只有 grep 全檔可靠**。

## 9. 接手起手

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --porcelain | head -5 && git log --oneline -3
```
預期:branch=`dev`、HEAD=`1c63970`、工作區只有 §6 的凍結檔。

**動工順序**:①修 M-1~M-5(每條都要 grep 全檔銷舊字面)→ ②語法預檢(§4)→ ③三綠複跑 → ④prod 交易模擬複跑(M-2 改了指紋公式 → **基線指紋須重取**)→ ⑤重跑 **codex 關卡2** 要 GO → ⑥更新 Packet 與 plan 銷案表 → ⑦commit(STATUS 7 欄同 commit)→ ⑧**不 push、不 db push**,等 Sean。

⚠️ **B-2 apply 後 ≠ 必填生效**:第 9 參仍是 `DEFAULT NULL`、`authenticated` 可直呼 RPC 省略 → 必填收緊是 **B-6**。
⚠️ **在 PRD §6 八項上線 gate 全數達成前,禁用「通知功能上線」「孤兒已消滅」字面。**
