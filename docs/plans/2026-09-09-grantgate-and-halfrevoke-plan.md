# plan · ⟦auth-GRANTGATEBLIND⟧ + ⟦auth-HALFREVOKEDTRIGGERS⟧ —— 兩列都被修過了,而**剩下的不是同一種東西**

> 線【權限/信件】窗 C · 2026-09-09 · **本檔只是判定 + plan。窗 C 沒有寫任何 migration、沒 apply、沒 push、沒改板。**
> 讀數 = `pcm_readonly` @ 正式庫(`bash scripts/readonly-prod-sql.sh`,唯讀零寫入)+ repo 側實跑。**2026-09-09 11:1x–11:3x UTC**。

---

## 0. 兩句話

1. 🎯 **`⟦auth-HALFREVOKEDTRIGGERS⟧` 真的做完了** —— 而我證的**不是「那支 migration 貼了」,是【受詞本身】**:那 9 對權限今天全部是 `f`。
2. 🔴 **`⟦auth-GRANTGATEBLIND⟧` 修掉的比我原本以為的少** —— 欄級 GRANT 的**抽取器**加了,而**下游把它放進 `COL_WARN` 不放進 `BLOCKED`** ⇒ 📌 **偵測到了也照樣放行。**
3. 🛑 **而我原本要建議「板上漏列失效②」—— 那句撤回**:摘要那一格確實沒列它,**而失效② 已經被三個地方追蹤著**(同列前文 · `⟦db-PENDINGLISTUNSEEN⟧` · `⟦db-DIRGATENOMECH⟧`,外加一份決策檔)⇒ **要建議的只是「摘要補交叉引用」,不是「發現一個沒人管的缺口」。**

---

## 1. 🎯 `⟦auth-HALFREVOKEDTRIGGERS⟧` —— 完成,而且是量受詞量出來的

板列 2026-09-09 已翻 `done`,**理由是「那支 migration 2026-09-09 01:37 貼進正式庫了」**。
🛑 **而「貼了」不等於「收乾淨了」** —— 板列自己就寫著「若來源是繼承,事後閘① 會擋下並**整支回滾**」。⇒ 📌 **貼成功與生效是兩件事,所以我量受詞。**

**受詞 = 那三個角色今天還有沒有 `EXECUTE`**(2026-09-09 11:15 UTC):
```
                                anon   authenticated   service_role
pcm_staff_touch_updated_at        f          f              f
pcm_suppliers_block_delete        f          f              f
pcm_suppliers_touch_updated_at    f          f              f
                                        ⇒ 9 / 9 全部 f
```
**而 `proacl` 逐字**(比 `has_function_privilege` 更硬,它看得見「有沒有明確收過」):
```
pcm_staff_touch_updated_at()      {postgres=X/postgres}
pcm_suppliers_block_delete()      {postgres=X/postgres}
pcm_suppliers_touch_updated_at()  {postgres=X/postgres}
⇒ 只剩 owner 一筆,三個角色一個都不在;secdef = f · rettype = trigger · owner = postgres
```
⇒ ✅ **兩把尺都說那 9 對沒了。板上翻 `done` 是對的。**

🛑 **而「收乾淨」這個詞要收窄**(codex R1 提的,我同意):
- **兩把尺不是完全獨立** —— `has_function_privilege` 與 `proacl` **讀的是同一份 ACL 資料**,一個是求值一個是字面。
- **`proacl` 只證明「現在長這樣」,不證明「曾經明確 REVOKE 過」。**
- 🔴 **存在一條兩把尺都看不到的路**:一個**不繼承** `postgres` 權限、但**能 `SET ROLE postgres`** 的角色,原角色回 `f`、ACL 也只有 `{postgres=X/postgres}`,**切過去之後仍拿得到**。⚠️ **這是可能的構造,不是我今天在正式庫查到有這條路** —— 本 repo 的 `docs/patterns/revoking-function-execute-in-supabase.md:232` 早就寫著「兩道 REVOKE 擋的是直接呼叫,擋不住 `SET ROLE`」。
⇒ ✅ **精確講法:那三支函式對 `anon` / `authenticated` / `service_role` 的【直接呼叫】這條路,今天關上了。**

⚠️ **而我的正對照【沒有燒起來】,誠實寫**:我原本想找一支 `proacl IS NULL`(= 還是 PUBLIC EXECUTE)的 trigger 函式當對照組 ⇒ **回 0 筆**。
🔬 補量分母:`public` 底下 `RETURNS trigger` 的函式共 **58 支**,其中 `proacl IS NULL` 的 **0 支**、有明確 ACL 的 **58 支**。
⇒ 📌 **這個庫裡沒有那種對照組可以造** —— 所以本節靠的是 ⚪ 負對照(現造函式名 ⇒ 0)與**兩把尺互相印證**,不是正對照。

---

## 2. ⚠️ `⟦auth-GRANTGATEBLIND⟧` —— 欄級那一半修了,而缺口不只板上列的兩格

### ① 修正確實落地(自己量,不是信板)
| 量什麼 | 開列時(2026-09-08) | 今天(2026-09-09) |
|---|---|---|
| `grep -c GRANT scripts/deploy-order-gate.sh` | **0** | **7** |
| 🟢 正對照 `ADD COLUMN` | 7 | **9** |
| ⚪ 負對照 `zzq8842` | 0 | **0** |
| `953acb08e` 在我這棵樹嗎 | — | **在** |

`col_pairs_of()`(`:538` 起)裡逐字多了一段 `re.finditer(r"GRANT\s+(?:[A-Za-z]+\s*)+?\(([^)]*)\)…")` ⇒ **欄級 GRANT 接進 `(表, 欄)` 那個既有的桶**。

🔴🔴 **而「下游比對與豁免邏輯沒動」這件事,後果比我原本寫的嚴重 —— codex R1 抓到,我開檔核過:**
```
scripts/deploy-order-gate.sh:1069 逐字
  # 🟡 **進 `COL_WARN` 不進 `BLOCKED`** —— 這一族只警告不擋(理由見上方 COL_WARN 宣告處)。
scripts/deploy-order-gate.sh:1097 逐字
  [ -z "$BLOCKED" ] && { summary 0; exit 0; }
```
⇒ 📌 **一支帶欄級 GRANT 的 pending migration,即使被成功抽到、成功比中 app 碼,它進的是【警告】那一桶** ⇒ **`BLOCKED` 空 ⇒ `exit 0` ⇒ 照樣放行。**
⇒ 🛑 **所以正確的講法是三段,不是一句「修好了」**:
- ✅ **抽取器加進去了**(欄級 GRANT 現在進得了比對面)
- 🟡 **而它只警告不擋**
- ⚠️ **而豁免還有盲區**:`:783` 只憑**已 apply** 的 `(表, 欄)` 豁免 ⇒ 📌 **「這一欄以前加過」推不出「這次授給某角色的 UPDATE 權已經存在」。**

⚠️ **另一格也收窄**:`proacl`/腳本檔案的 `grep` 命中數只證明**字面在**,不證明**那段程式在真實 push 裡跑到過**(§3 第 2 條)。

### ② 板上收尾列的兩格 —— 我複驗,都成立
- **整表級 `GRANT SELECT ON TABLE t TO r` 仍抓不到**:`:614-615` 逐字「本格【只抓欄級】…整表級授權沒有欄可以配對,而本閘的比對單位是 `(表, 欄)` ⇒ 它需要另一種訊號,不在本格射程內」⇒ ✅ **明寫不假裝,今天仍是這樣。**
- **沒有構造過一次真的擋**:板列自陳。我今天也沒構造(需要「pending 且帶欄級 GRANT 且 app 碼引用該欄」的組合,今天不存在)。

### ③ 失效②(餵反 stdin)—— 今天手餵仍分不出,**而它不是沒人管的缺口**
🛑 **我原本要寫「板上收尾漏列了失效②」。撤回。** 逐字核對後:
- ✅ 板列 `:726` 的 `⟨已量 2026-09-09 · B⟩` 那格**確實只列兩格**(整表級抓不到 · 沒構造過真的擋)—— **而那個「②」是缺口編號,不是失效②。**
- 🔴 **而失效② 已經被三個地方追蹤著**:同列前文(`-auth` 與 `-b1` 09-08 的四個世界)· `⟦db-PENDINGLISTUNSEEN⟧`(`:2411`)· `⟦db-DIRGATENOMECH⟧`(`:2511`,逐字記著「不擋」「今天不做機制」)· 外加決策檔 `docs/decisions/2026-09-08-deploy-order-gate-bypass.md`(14,618 bytes,今天在)。
⇒ 📌 **所以能建議的只有「摘要那一格補一條交叉引用」,不是「發現一個沒人管的缺口」。**

**四個世界實跑**(`local_sha = f10214482`(HEAD)· `remote_sha = 069813e7`(`origin/dev`)):
```
① 正確順序   rc=0 · 0 blocked / 0 欄位警告(不擋) / 10 pending(檢查了 1 個 ref)
② 兩個 sha 餵反 rc=0 · 0 blocked / 0 欄位警告(不擋) / 10 pending(檢查了 1 個 ref)   ← 與 ① 【逐字相同】
③ 空 stdin    rc=0 · 未檢查任何 ref(這次推的不是 refs/heads/dev 或 refs/heads/main)
```
⇒ ✅ **③ 分得出來;② 分不出來 —— 與板列 09-08 兩個獨立來源(`-auth` 與 `-b1`)的讀數一致。**

🔴 **而【為什麼四個世界都 0 blocked】,我原本歸因給「pending 集合相同」—— 那不是最直接的原因。** codex 指出來,我開檔核過:
```
scripts/deploy-order-gate.sh:810 逐字   [ -n "$APP_FILES" ] || continue
當場量:git diff --name-only 069813e7e f10214482 -- apps packages | wc -l  ⇒  0
```
⇒ 📌 **我這兩顆 sha 的 `apps/` 與 `packages/` 差異是空的 ⇒ 它【根本沒進應用程式比對那一段】** ⇒ `BLOCKED` 當然是空的。
⇒ 🛑 **「pending 集合相同」是另一個成立的條件,而不是這一發的直接成因** —— 而**它們兩個會印出一模一樣的摘要**(又是同一個形狀)。

⇒ ✅ **所以本節能寫的只有一句**:**今天手餵時,那四個數分不出方向。** 🛑 **不是**「今天重新證明了它會漏擋」—— **會漏擋的那個反例(正確 `1 blocked` vs 餵反 `0 blocked`)是引板列 `-auth` 09-08 的,不是我量的。**
🟢 **正對照跑了,而且燒起來了**(拿 pending 集合真的不同的兩顆 sha:`HEAD` 對 `origin/dev~40`):
```
正對照A 正確順序  0 blocked / 0 欄位警告 / 10 pending(檢查了 1 個 ref)
正對照B 餵反      0 blocked / 0 欄位警告 / 11 pending(檢查了 1 個 ref)   ← 🟢 pending 動了
```
⇒ ✅ **我這把尺是活的** —— 兩個 sha 的 pending 集合真的不同時,`pending` 那個數會變。
⇒ 📌 **所以 §2③ 的「①②逐字相同」不是尺壞了,是【那個分母下本來就分不出】。**
🛑 **而我的正對照只燒到 `pending` 這一維,沒燒到 `blocked`**(A/B 都是 `0 blocked`)⇒ **「餵反會不會改變 blocked 判定」我這一發沒證到** —— 板列 `-auth` 2026-09-08 那發證到了(正確 `rc=1 · 1 blocked` vs 餵反 `rc=0 · 0 blocked`),**我引用它,不冒充自己量的。**

### ④ 而這一列真正的內容,是那兩個病**共用一個症狀**
板列逐字(我複驗過機制,同意):
```
失效① 它不看 GRANT           ⇒ 純 GRANT 的 migration 不產生新名字 ⇒ 不進比對面
失效② 餵反 stdin 也印 0 blocked ⇒ 而【0 blocked】正是失效① 造成的那個結果長得一樣
⇒ 有人來查① 的時候會看到 `0 blocked`, 而那個 0 可能是② 造成的
```
🔴🔴 **我原本寫「欄級那一類的 `0 blocked` 現在是真的」—— 那是錯的,已刪。**(codex R1 must-fix,我核過 `:1069` / `:1097`)
**理由**:欄級命中進的是 `COL_WARN` **不是** `BLOCKED` ⇒ 📌 **就算抽到了、比中了,`0 blocked` 照樣印、照樣 `exit 0`** ⇒ **那個 0 對欄級一樣不能讀成「查過了沒事」。**

🎯 **所以那個「共用症狀」的關係,09-09 之後【一格都沒有減少】,只是多了一個成因**:
```
成因① 整表級 GRANT 進不了比對面        ⇒ 0 blocked
成因① ' 欄級 GRANT 進得了, 而只警告不擋 ⇒ 0 blocked   ← 09-09 之後新增的一條路
成因②   餵反 stdin                     ⇒ 0 blocked
成因③   apps/packages 差異為空 ⇒ 整段跳過 ⇒ 0 blocked   ← 我今天實際踩到的那一條
⇒ 🛑 四條路印同一句話。修好其中一條,那句話仍然印得出來。
```
⇒ 📌 **這一列真正的內容不是「閘瞎了」,是【`0 blocked` 這個輸出承載不了「已檢查」這個意思】。**

---

## 3. 🛑 我證不到什麼

1. **失效② 在真的 `git push` 流程裡構造不構造得出來 —— 沒量。** 我是手餵 stdin;真 push 由 git 餵,而 git 的餵法是它自己決定的。板列 `-auth` 也標了同一格未量。
   ⇒ 📌 **在那一格答出來之前,失效② 的正確描述是「手餵時分不出」,不是「部署路徑上有一個洞」。**
2. **我沒有構造一次真的擋**(欄級 GRANT 進 pending 且被 app 碼引用)⇒ 「修好了」是從**抽取器行為 + 檔案內容**推的,不是從**一次真實的紅**推的。
3. **整表級 GRANT 抓不到,我只複驗了註解字面與比對單位,沒有實際餵一支整表級 GRANT 的 migration 去試。**
4. **`⟦auth-HALFREVOKEDTRIGGERS⟧` 那三支的 `EXECUTE` 有沒有被別的 migration 在別處收過/再給過** —— 我只量線上結果,**沒有追來源**(那正是 `⟦db-ACLVALUEPROVENANCE⟧` 在講的事)。
5. 🔴 **同一族的形狀今天又出現一次**:**一把在錯的世界裡量的尺,印出來的東西跟「沒事」長一樣。** 這一次是 `0 blocked` 有四個成因(§2④)。
   🛑 **而我原本寫「第五次」—— 那個精確次數刪掉了**(codex 查不到我「版本號前綴」那一次的獨立紀錄座標;而 `has_function_privilege` 不看 schema 閘那一次是「`t` 卻不可達」,與「`0` 被讀成沒事」**不同族**)。**有座標的兩次**:ugrep 有界重複超上限印 0(`docs/plans/2026-09-09-acl-drift-and-provenance-plan.md` §5②-b)· git commit 時間當貼入時間(`docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md` §3 第 1 條)。
6. 🔴 **撤權之後那三支 trigger 的功能有沒有回歸 —— 沒驗。** `supabase/migrations/20260909020000_…:66` 本來就保留了這一項。我只量權限,**沒有量「員工改一筆 staff 時那個 `updated_at` 還會不會動」。**
7. **`SET ROLE` 那條路沒排除**(§1)· **本片沒有附完整 SQL 與 schema/簽章**,只附讀數。
8. 讀數是 2026-09-09 11:1x–11:3x UTC 那幾發的。

---

## 4. 改什麼 · 影響 · rollback

🛑 **本片不寫 migration、不改任何腳本。** 產出是判定 + 下面兩件。

### 第 1 件 · `⟦auth-HALFREVOKEDTRIGGERS⟧` ⇒ **結案,不用做事**
板上已 `done`,而我量受詞複驗成立。**沒有後續。**

### 第 2 件 · `⟦auth-GRANTGATEBLIND⟧` ⇒ **建議摘要補兩句,而那不是窗 C 改板**
板列 09-09 的收尾寫了兩格缺口(整表級抓不到 · 沒構造過真的擋)。**建議由主視窗在下次動板時補這兩句**:
> · 🔴 **欄級那一半修的是【抽取器】,不是【擋】** —— 命中進 `COL_WARN` 不進 `BLOCKED`(`scripts/deploy-order-gate.sh:1069`),`BLOCKED` 空就 `exit 0`(`:1097`)⇒ **偵測到了也放行。**
> · 🔵 失效②(餵反 stdin)已被 `⟦db-PENDINGLISTUNSEEN⟧` / `⟦db-DIRGATENOMECH⟧` 與 `docs/decisions/2026-09-08-deploy-order-gate-bypass.md` 追蹤 ⇒ **摘要補一條交叉引用即可,不是新缺口。**

🛑 **窗 C 沒有改 `docs/launch-todo.md`**(凍結唯讀)。
🛑 **而「要不要讓欄級從警告升成擋」是一個新問題,本片不代裁** —— 它與板上那題 `甲/乙`(整表級要不要進閘)**不是同一題**,codex 提醒得對。

### 而「要不要修失效②」照板上原本那題走 —— **本片不推翻它**
板列已把 GRANT 那一面變成一題 `甲 / 乙`:
- `甲` 閘照舊不看(整表級),交給上線前一次性 ACL 對帳(`~/pcm-mailbox/0905查證/run.sh` 已存在)—— **`db` 與 `auth` 都傾向這個**
- `乙` 閘裡加「只警告不擋」⇒ **`db` 不建議**:10/12 支都會叫 ⇒ 背景雜訊
🔵 **我也傾向甲**,而多一個今天的理由:**欄級那一半已經修掉了,而我們實際踩到的那一支就是欄級的** ⇒ 剩下的整表級,爆炸半徑比原本小一階。
🛑 **這一題本來就在等 A 或 Sean 裁,本片不代裁。**

### 本片的尺自檢 —— ✅ 過了(讀數見 §2③)
正對照 `10 pending` 對 `11 pending` ⇒ 尺會動 ⇒ §2③ 的「①②逐字相同」是**分母的問題,不是尺的問題**。
🛑 **而它只燒到 `pending` 這一維** ⇒ `blocked` 那一維我引板列的讀數,沒有自己量到。

---

## 5. codex R1 —— 1 個 must-fix + 4 個 nit,逐條怎麼修

| codex 意見 | 怎麼修 |
|---|---|
| ④**must-fix** · 「欄級那類的 `0 blocked` 現在是真的」不成立 —— 命中進 `COL_WARN` 不進 `BLOCKED`(`:1069`),`BLOCKED` 空就 `exit 0`(`:1097`) | 🔴 **那句刪了**(§2④)。§2① 改寫成三段(抽取器加了 / 只警告不擋 / 豁免有盲區);§2④ 改成「`0 blocked` 有**四個**成因」 |
| ①nit · §1 只支持「九對當下有效 EXECUTE 已撤除」,不支持「所有路徑收乾淨」;兩把尺共用 ACL 資料不算獨立;`SET ROLE` 那條路沒排除 | §1 加一段收窄,精確講法改成「**直接呼叫這條路今天關上了**」,並引本 repo `revoking-function-execute-in-supabase.md:232` |
| ②nit · 四個世界都 `0 blocked` 的**直接原因**是 `apps/packages` 差異為空(`:810` `[ -n "$APP_FILES" ] \|\| continue`),不是 pending 集合相同 | **當場核**:`git diff --name-only … -- apps packages` ⇒ **0** ⇒ §2③ 歸因改掉,並寫明兩個條件會印同一份摘要 |
| ③nit · 「板上漏列失效②」包裝成新發現是錯的 —— 它已被 `⟦db-PENDINGLISTUNSEEN⟧`、`⟦db-DIRGATENOMECH⟧` 與一份決策檔追蹤 | 🛑 **那句撤回**(§0-3 / §2③);建議改成「摘要補交叉引用」。另修正:板上那個「②」是**缺口編號**不是失效② |
| ⑤nit · 「今天第五次」找不到四個可核對的前例 | **精確次數刪掉**,只留兩個**有座標**的(§3 第 5 條);並補上三條漏的限制(trigger 功能回歸未驗 · `SET ROLE` 未排除 · 沒附完整 SQL) |

🛑 **codex 結論是「不可 —— 原稿漏掉既有追蹤與決策,更把只警告的欄級檢查誤判為可靠防護」。本稿把兩者都修了**:誤判那句刪除、既有追蹤補上;而 §4 的建議也從「補一個新缺口」降成「補交叉引用 + 補一句『只警告不擋』」。
🛑 主視窗 2026-09-09 定:**純 .md 只跑 R1,不跑 R2。**
