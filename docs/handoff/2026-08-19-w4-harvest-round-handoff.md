# W4 收割輪交接(2026-08-19 夜)

> **寫給:下一任收割窗。** 你需要的是「哪些已經送出去了、哪些押著、押著的解鎖條件是什麼」。
> 🔴 **本檔不抄 E2b 那條線的正本** —— 正本 `~/pcm-mailbox/W4-E2b前置與cron歸屬-20260819.md`(§17/§18)。
> 抄第二份就會有兩份各自過期。這裡只寫**收割這個動作**的狀態。

> ### 📌 每條判別句後面那個括號怎麼讀(2026-08-20 W4 補,主視窗派)
> ```
> (W4 第一手)   = 掃得到的最早版本就在本窗的檔裡（括號內附那個位置）
> (轉錄自 X)    = 別的窗/檔先有,本檔只是搬過來（附得出來源就附行號）
> (出處不明)    = 🔴 我分不出來 ⇒ **不要拿它當先例**,要用先去問原作者
> ```
> 🔴 **「出處不明」不是還沒寫完,它就是答案** —— 壓縮之後我是這些條目的讀者,不是作者了,
> 而**猜一個出處填滿它,比空著更貴**:下一個人會照著它去引用一個不存在的先例。
> ⚠️ 射程:只標【判別句/判準】那幾行,不標整份檔的每一句。

---

## 0. 為什麼有「收割窗」這個角色

2026-08-19 的實錘:訂單面板那條線**做完七八片、全部過審,而一片都沒進 `dev`**
(⚠️ 「七八片」**未數** —— 轉自 `~/pcm-mailbox/W4-RESTART-20260819.md`,本檔未覆核)
⇒ Sean 等了一整天,螢幕上什麼都沒變。**沒有人在收割,而沒有人知道那是誰的事。**

📌 **判準(轉錄自 Sean 新規矩③ —— `~/pcm-mailbox/W4-RESTART-20260819.md:13-14`)**:排片第一問=**會不會讓 Sean 打開後台看到不一樣的東西**;
而**收割永遠排最前面** —— **做完的東西沒送出去,等於沒做。**

---

## 1. 本輪收了什麼(進 `dev`,**未 push**)

數法(當場可重跑):`git log --oneline --merges c0d156a9..dev` ⇒ 8 顆 merge;
未收割用 §5 那段 `for` 迴圈 ⇒ 落檔時剩 1 支(`vitest-alias`)。

| merge commit | 分支 | 顆 | Sean 看得見? |
|---|---|---|---|
| `6820b99f` | `w1-order-panel` | 2 | ✅ 危險操作收成兩顆鈕 + `#637` 錨點 |
| `ef5a4a7f` | `w3-containing-block` | 1 | ✅ 面板 `page.tsx` + 撤回一句假宣稱 |
| `5728f72c` | `w2-shipment-dialog` | 1 | ❌ containment 量具 |
| `c820a466` | `w3-traps-0819` | 1 | ❌ traps 八條 |
| `5da9b727` | `w3-storefront-probe-teardown` | 2 | ❌ probe 腳本 |
| `1fff1eb9` | `w3-admin-probe` | 4 | ❌ probe 腳本 |
| `d65caf90` | `claude/practical-shannon-525b68` | 1 | ❌ 一個 JSDoc 字 |
| `8551a485` | `w2-email-cron` | 2 | ❌ E2b migration + cron route |

另外兩顆非 merge:`b3e32d67`(`APPLIED.tsv` 去重)、`e1eb1d53`(角色基線 plan 補量測)。

**四綠(每一批收完各跑一次;最後一次四項的 `Cached:` 欄皆為 `0 cached`)**
```
TURBO_FORCE=1 pnpm typecheck ⇒ 8/8      TURBO_FORCE=1 pnpm lint  ⇒ 10/10
TURBO_FORCE=1 pnpm build     ⇒ 2/2      TURBO_FORCE=1 pnpm test  ⇒ 550 檔 passed | 1 skipped(551)
                                            9220 passed | 2 expected fail | 2 skipped | 1 todo
```
🔴 **`TURBO_FORCE=1` 不可省** —— 少了它 turbo 命中快取會 replay 舊的綠(鐵則 11)。

---

## 2. 押著沒收的:**一支,而它有明確的解鎖條件**

```
vitest-alias  1 顆  88845f35  test(admin): sso start/callback 兩支 route 行為測試
```
**症狀**:merge ⇒ `CONFLICT (add/add)`,兩支檔
`apps/admin/src/app/api/sso/{start,callback}/route.test.ts` —— `dev` 上已有 `d9f8894e` 的同名測試。

🔴 **而這一格教了一條判準,請帶走**(轉錄自 W6 —— 斷言差集是它量的,`~/pcm-mailbox/MAIN-065-第一輪裁定與現況-20260819.md:41` 也記著):
```
我最初的判法（行數）：dev 279 行 > vitest-alias 236 行 ⇒ 判「被取代的重工」
W6 的判法（斷言差集）：236 行裡有 7 條 dev 沒有的，其中 1 條守的是登入 CSRF
   （start/route.ts:31 的 const state = newState() 被提到 module scope
     ⇒ dev 現有兩格【全綠】，而全站共用同一個 state）
⇒ **「哪版比較完整」答不出「哪版守得比較嚴」。**
⇒ 🔴 **下次遇到 add/add 重工:先問【斷言差集】,再問【行數】。**
```
**退役條件(主視窗裁定)**:等 W5 把 Δ1(state 唯一性)+ Δ2(302 pathname)補進 `dev` 且突變驗過,才退役。

#### ✅ 條件達成(2026-08-19 22:0x,W4 逐條驗,不是照轉述)
```
git merge-base --is-ancestor 03e415fa dev            ⇒ YES
git log --oneline -1 -- .../api/sso/start/route.test.ts ⇒ 03e415fa
Δ1 在 :65-79  「兩次 GET 的 state 不得相同」，**且連 cookie 那一側一起驗**
              （檔內逐字：只驗 URL 的話「cookie 寫死而 URL 每次新」也會綠）
Δ2 在 :84-87  302 目的地的 pathname = /api/sso/authorize（既有 :45 只驗 origin）
突變證據在檔內逐字：「提到 module scope ⇒ 本格紅；還原 ⇒ 全綠。**不是紙上突變**」
```
⇒ **`vitest-alias` 從收割清單退役** —— 它記錄的那個缺口已經被更好的版本補進 `dev`。

⚠️ **而我【沒有刪那個分支】,兩個理由**
```
· 它被 checkout 在別人的工作樹（git worktree list ⇒ /Users/sean_1/pcm-vitest-alias）
  ⇒ 刪不掉，而硬刪要動別人的工作樹 —— 那不是收割窗的權限
· 它與 dev 的差集仍有 160 insertions / 369 deletions（`git diff --stat dev vitest-alias -- .../api/sso/`）
  ⇒ 「Δ1/Δ2 已補」≠「這支分支的所有差異都已被消化」
  🔴 而那個差集【沒有人逐條看過】——W6 當初比的是斷言差集，不是整支 diff
⇒ 處置：**從清單退役（不再等它、不再收它），而分支留著給它的工作樹擁有者處理。**
```

---

## 3. 🔴🔴 E2b:三層,**誰都不准壓成一句**

正本在 dossier §18-b。**這裡原封抄三行,因為它今晚被壓縮過一次:**
```
① 排程有在跑          ✅ 量到  cron.job_run_details 近 30 分：pcm-email-sweep succeeded 4 次
② 打得出 HTTP 且 200   ✅ 量到  net._http_response 近 15 分 n=10 全 200
③ 真的寄出信          ❌ 量不到 —— 而且更窄：email_outbox **零列**
```
🔴 **正確的宣稱**:**管子接通了、抽水機在轉,而【從來沒有東西進過那根管子】。**
**不要寫「E2b 已驗證」或「排程寄信成功」** —— 那兩句都會被讀成 ③。

### 🔴 而 ③ 的原因量到了(W2,2026-08-19 12:35Z 之後補的一發)—— **不是壞掉,是沒上膛**

W2 拿 `net._http_response` 的 **body 逐字**(那張表沒有 `url` 欄,它改用時刻判別:
`*/5` 落在分鐘 5/15/25/35/45/55、`*/2` 只落偶數分 ⇒ 分鐘 %10=5 的那幾發只可能是 email-sweep;
對照組:近 40 分鐘偶數分 22 筆 + %10=5 的 2 筆 = 24 = 同期間全部筆數 ⇒ 切片自洽):
```
2026-08-19 12:25:00Z │ 200 │ {"ok":true,"reclaimed":0,"claimed":0,"sent":0,"failed":0,
                              "deferred":0,"staleMarks":0,"errors":0,
                              "enqueueStatus":"skipped_no_cutoff"}
2026-08-19 12:35:00Z │ 200 │ （逐字相同）
```
⇒ **它自己說它沒寄。** `apps/storefront/src/app/api/cron/email-sweep/route.ts:18-20` 逐字寫著這條路:
`B4_DEPLOY_CUTOFF` 未設 → 200 且 `enqueueStatus:'skipped_no_cutoff'`(不寄任何信);
env 名字在 `route.ts:101`,而 `docs/patterns/guard-and-instrument-traps.md:9141` 記著實查 **Vercel production 未設它**。

🔴 **⇒ 真正的「上膛」動作是設 `B4_DEPLOY_CUTOFF`,不是排程。** 而那是 **Sean 的動作**(設下去信就真的會寄給真客人),已端給他。

**兩格分清楚,別讓下游併掉**
```
✅ 量到：cutoff 未設 ⇒ enqueue 整段跳過 ⇒ sent=0。**這是【設定】不是【壞掉】。**
⚠️ 推出（不是量到）：拿到 200 而不是 503 ⇒ ORDER_EMAIL_FROM / RESEND_API_KEY 應該是設好的。
   🔴 沒有人直接量過那兩個 env。
```

#### 🔴 而我追這條推論時撞到一個**現成的矛盾**,兩邊都留著(W4 讀 code 驗的)

```
route.ts:307 `getSweepEmailOutboxDeps()` 是**無條件**跑的 —— 它在 cutoff 分支【外面】，
              而 cutoff 未設只跳過 enqueue 那半（route.ts:284 的 if (cutoffRead.kind === 'ok')）
route.ts:338 requireEnv throw ⇒ 503；而我們拿到的是 **200**
⇒ **在服務那兩發請求的那個 deployment 上，那兩顆 env 是設好的。**（比「應該」硬一階）

而 docs/patterns/guard-and-instrument-traps.md:9141 逐字記著實查結果：
   「**ORDER_EMAIL_FROM 與 B4_DEPLOY_CUTOFF 確實未設**」
⇒ 🔴 **兩份證據對 ORDER_EMAIL_FROM 給相反答案。**
```
**不要挑一個消滅。** 兩個都可能是真的(env 在那次實查之後被設上去了)。

#### ✅ 而它 20 分鐘後就被收掉了 —— **答案是「時間」,不是「誰量錯」**
W2 有 Vercel 通道(主樹有 `.vercel/`),當場跑 `vercel env ls production`(唯讀、**只列名稱不含值**):
```
ORDER_EMAIL_FROM   Encrypted  Preview, Production  created **3h ago**   ← ✅ 設了
RESEND_API_KEY     Encrypted  Production, Preview  created 49d ago      ← ✅ 設了
B4_DEPLOY_CUTOFF   🔴 整份清單裡【沒有這個名字】                          ← 未設
分母：production 共 30 個名稱（與 traps:9141 當時數到的 30 一致）
```
⇒ **`created 3h ago` ⇒ 今天才設上去的** ⇒ **traps:9141 那次實查在它被設之前。兩份證據都是真的,中間世界變了。**
📌 **可搬走的**(W4 第一手 —— 「反向用法」這句最早在本窗 dossier `~/pcm-mailbox/W4-E2b前置與cron歸屬-20260819.md:959`):memory 那條「`vercel env ls` 最後一欄是 **created** 不是 updated ⇒ 答不出值改了沒」——
**反向用法**:它答不出「值改了沒」,**卻答得出「這個名字第一次出現是什麼時候」**,而這一格要的恰好是後者。
⚠️ **限定跟著走**:`3h ago` 是**名字被建立**的時間,不是「值現在是對的」;
也不保證服務那兩發請求的 deployment 已經帶上它(**env 要 redeploy 才生效**)。

🔴 **⇒ 給 Sean 的那句因此收窄成一件事**:
~~兩顆 env 要查~~ ⇒ **只剩 `B4_DEPLOY_CUTOFF` 未設 = 唯一擋著信寄出去的東西,而設它 = 上膛。**
⚠️ **這一層錯了,客人收不到信,而後台什麼都不會紅。**

---

## 4. 帳本 `supabase/APPLIED.tsv`:一次撞車,與它留下的規則

**事件**:W2 與我在幾分鐘內**各 append 了 `20260819160000` 一列**;
W2 為避撞用 `cp` **整檔還原**,把我那列一起蓋掉;我又補了一次 ⇒ 同版本號兩列。
**處置**:保留 W2 那列(第一手 —— 它自己跑 `job_run_details JOIN cron.job`),刪掉我那列(`b3e32d67`)。

📌 **兩條可搬走的**
```
· 判準用【誰的證據是第一手】，不是【誰先寫】　（W4 第一手 —— 這條處置是本窗當場裁的）
· 🔴 病灶不是手滑，是拿【整檔還原】去解一個【只該動一行】的問題
  ⇒ 共用工作樹裡，**檔案層級的還原等於對別人的未 commit 改動下手**
  ⇒ 判別句：我要撤回的是【我的一個動作】，還是【這個檔案的一段時間】？
     （🔴 出處不明 —— 事件是 W2 的,這句誰落的分不出來,不要拿去當先例）
     後者在共用工作樹裡永遠是錯的答案 —— 而它讀起來像比較保守的做法
```
⚠️ **pre-commit 的 reviewer gate 會擋 `APPLIED.tsv`**。我寫跳審標記過關,理由=
「只動一支自陳帳本 TSV,零 SQL、零 code、零平台設定」。
🔴 **而主視窗加了一條邊界,寫下來免得它變通行證**(轉錄自主視窗):
`APPLIED.tsv` 之所以輕,是因為**它自己不會執行任何東西**。
**哪天有人寫了一支「照 `APPLIED.tsv` 決定要不要 apply」的工具,這張表就從自陳帳本變成【輸入】,那時它就不輕了。**
⇒ 寫跳審理由時把「**它不被任何程式讀**」這個前提寫進去,將來前提變了才有人撞得到。

### 🔴 而這支檔一夜撞了 4 次,而第 3、4 次證明傷害**不限於這支檔**

```
① W2 與我各 append 一列 ⇒ W2 用 cp 整檔還原 ⇒ 蓋掉我那列
② 我 add 之後被 pre-commit gate 擋下、補標記再 commit 時【沒重新 add】
   ⇒ 那段空檔別的窗把它的版本 stage 進同一個索引
   ⇒ 我 commit 了 2 列而 commit body 寫「1」（更正在 035fd668）
③ 主視窗一筆 staged 的 APPLIED.tsv **擋住我一個完全無關的 merge**
   （branch 根本沒動那支檔 —— 擋住 merge 的不是衝突，是共用索引裡有未提交改動）
④ 主視窗用 /tmp/cmsg.txt 寫 commit 訊息，而別的窗也在寫同一個檔名
   ⇒ `cat > /tmp/cmsg.txt` 成功、零錯誤訊息，而讀回來的內容是別人的
   ⇒ 它一度誤判成「hook 讀 COMMIT_EDITMSG 快取」；實查 grep 舊字面 ⇒ 檔裡真的還有
```
📌 **四次的共同形狀不是「誰不小心」**,是 **【共用命名空間 + 沒有人擁有那個名字】**:
①②③ 是共用索引,④ 是共用 `/tmp`。
📌 **判別句(④ 給的,最短)**:**我這次寫檔跟我這次讀檔,中間隔著別人嗎?**
(🔴 出處不明 —— 事件④ 由主視窗回報,這句誰落的分不出來;全庫掃「中間隔著別人」零命中 ⇒ 沒有更早的版本可指)

**⇒ 新規矩(主視窗 2026-08-19 立,即刻生效)**
```
動 supabase/APPLIED.tsv 的窗，**當場 commit，不留 staged**。
從 `git add supabase/APPLIED.tsv` 到 `git commit` 之間**不要插入任何其他動作**
（跑 gate、寫標記、改 commit 訊息都算「其他動作」—— 那正是 ② 的成因）。
被 hook 擋下 ⇒ 先 `git restore --staged supabase/APPLIED.tsv`，修好再重新 add + commit。
```
📌 **而 ④ 的修法是換載體不是加小心**:commit 訊息改寫進 **session scratchpad**,不用 `/tmp` 的共用名字。

---

## 5. 收割怎麼做(可直接照抄)

```bash
# 1. 自己量，不要照抄別人給的分支清單
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  n=$(git rev-list --count dev..$b); [ "$n" != "0" ] && printf "%-32s %s\n" "$b" "$n"; done

# 2. 🔴 量「會不會撞到工作樹髒檔」要用 merge-base，不要用 dev..branch
#    （dev..branch 是【樹差異】，會把 dev 後來新增的檔算成分支的改動 ⇒ 假警報）
mb=$(git merge-base dev $b); git diff --name-only $mb..$b

# 3. 🔴 去重要用 patch-id，不要看訊息
git show $c | git patch-id --stable

# 4. 🔴🔴 **merge 之前先跑這一支** —— 它答「共用索引裡有沒有別人的東西」
bash scripts/harvest-preflight.sh <要收的分支>
#    rc=0 乾淨可以 merge ／ rc=3 有別人的 staged 檔（會被你一起帶走）⇒ 停下來問那個窗
```

#### 🔴 第 4 條是 2026-08-19 賠出來的,不是想出來的

```
88804080 那顆 merge 把 W2 還沒 commit 的 scripts/containment-probe.mjs 一起帶走了
  對做 merge 的我   merge 成功、四綠過、**完全正常**
  對 W2             它的 code 進了 dev，而 git log 那條路是斷的（訊息一個字沒提它）
                    且整個繞過了 reviewer gate —— 有人實際審過那 6 行，而那件事在 git 裡零痕跡
  對追查的人        全隊共用 `probe <probe@local>` ⇒ **`%an` 對「誰做的」判別力為零**
```
🔴 **`git merge` 帶走的是【當下共用索引裡的一切】,而做 merge 的窗看不到那些是誰的。**
⇒ **這不是注意力問題,加再多小心都擋不住** —— 那些檔在你的視野裡根本不存在。
⇒ 所以修法是**一支在動作那一行跑的腳本**,不是一條「以後注意」。
**它自己雙向表演過**(檔頭有寫):乾淨索引 ⇒ 無輸出 rc=0;`git add` 一支不相干的檔 ⇒ 印出檔名 rc=3。
```bash
# 5. 動 docs/phase-1-backlog.md 之前/之後跑這一條 —— 答「有沒有【新的】編號碰撞」
#    KNOWN = 已裁定保留、已各標互指註記的碰撞（2026-08-19 命名空間碰撞，兩者都留、不改號）
#    🔴 而它【在可預見的未來不會過期】—— 它過期的訊號是「那兩個號被改掉」，而我們剛裁定不改
#       ⇒ 不要定期回來查一個不會變的東西；要拿掉它，條件是那兩條 backlog 條目被合併或刪除
KNOWN='^(#672|#676)$'
grep -oE '^### #[0-9]+[a-z]*' docs/phase-1-backlog.md | sed 's/^### //' \
  | sort | uniq -d | grep -vE "$KNOWN" | grep . && echo '🔴 有【新的】碰撞' || echo '✅ 無新碰撞'
```
**這條的三個世界(2026-08-19 實跑,不是紙上)**
```
現況（repo 那支 + KNOWN）        ⇒ ✅ 無新碰撞
拿掉 KNOWN                        ⇒ 印出 #672 #676  ← 證明資料真的在，不是 grep 空轉
在 /tmp 副本尾端貼兩個 ### #700   ⇒ 🔴 印出 #700    ← 證明它抓得到【新】的
                                     ⚠️ 這一發跑在副本上，**沒有動 repo 那支檔**
```
⚠️ **兩個限定跟著走**
```
· 射程：它只看得到【本工作樹】那一份 backlog。各棵樹的條目數 613–617 不等（主視窗量）
  ⇒ 在 A 樹跑出「無新碰撞」，不代表 B 樹沒有
· `[a-z]*` 不可省：本檔有 #220. / #220b. / #220c. 這種【刻意的子編號】，
  少了它會把 220b/220c 截成 220 ⇒ 報一個假的碰撞（我第一版就是這樣多報的）
```
🔴 **為什麼它非有不可**:`#672` 那次碰撞**已經發生、已經有兩條註記寫著它,而它仍然不算被發現** ——
直到有人跑這條命令為止。⇒ **一個只有「有人主動去看」才會出現的訊號,等於沒有訊號。**

**紀律**
```
· 真衝突 ⇒ 退回作者。**唯一的例外形狀**：兩側是【同一件事的兩半】而不是兩個作者對同一行有分歧
  （本輪兩次都是這種：backlog 那段 W1 說「升級被推翻」/ W3 說「原限定恢復」；
    traps 那段兩側各自 append 在同一個插入點）⇒ 這種我自己解，並在 commit body 寫明形狀
· 別人的教訓正文我不改。traps 有一段疑似掛錯節（W3 的 audit-css 註記接在
  「我量有沒有人在做」那節底下），我照原樣合進去、另外通知 W3
· 每批 merge 完跑四綠 `TURBO_FORCE=1`
· 🔴 **收割窗永遠不 push** —— 那道關的價值是「一雙沒寫過這段 code 的眼睛」，
  而收割窗與寫的窗都是 AI ⇒ 少了 Sean 那一下，關卡只是換一個 AI 蓋章
· 🔴 **不碰 `STATUS.md`** —— 收帳權在主視窗
```

---

## 5b. 🔴 `harvest-preflight.sh` 的【射程限定】—— 它量的不是「merge 會不會出事」

```
它量的：索引（git diff --cached）
而擋住 merge 的實際有【兩種】，2026-08-19 兩種都真的發生過:
  ① 索引裡有別人 staged 的東西        ⇒ merge **成功** 而帶走它們（88804080）
  ② 工作樹的狀態讓 merge **跑不起來**  ⇒ rc=0 而 `git merge` 直接失敗
     實錘:`Cannot save the current worktree state / fatal: stash failed`
           `error: Entry '<檔>' not uptodate. Cannot merge.`
     成因:`git add -N`（intent-to-add）—— 🔴 **它在索引裡佔了位置,而位置是空的**
           porcelain 看得到（` A 檔名`）／`git diff --cached` **回空**／`git diff` 看得到
           ⇒ 兩把常用的尺各只看得到它的一半
```
✅ 現版已補:`rc=3` 索引侵入 / `rc=4` 工作樹擋死(intent-to-add 不論重疊 + 未提交改動與本次 merge 重疊)。
⚠️ **而 `rc=4` 那段【沒有在真案上驗過】** —— 改好之前現場已被清掉,
本次驗證是在自己的工作樹**構造**同形狀(`git add -N` ⇒ rc=4、乾淨樹 ⇒ rc=0)。
🔴 **下次同款若仍不紅,救得了的是這一句。**
⚠️ 另一個已知缺陷:**merge 進行到一半(有衝突未解)時它會回 rc=3 並說「去問那個窗」** ——
而那時候擋住的是**你自己的 merge**。**訊息會指錯人。**

### 🔴🔴 第三種漏法(2026-08-20 實錘):**它是【時點量測】,而跑它與 merge 之間那段空檔沒有人守**

```
01:13:0x  bash scripts/harvest-preflight.sh w3-customer-sort  ⇒ rc=0（乾淨）
01:13:2x  git merge --no-ff w3-customer-sort                  ⇒ 被擋，git 逐字：
            error: Your local changes to the following files would be overwritten by merge:
              note-compose-form.test.tsx / note-compose-form.tsx / notes-timeline.tsx /
              order-detail.tsx / note-action-state.ts / local-admin-with-real-data-probe.md
01:13:50  重跑同一支 preflight                                ⇒ rc=3，**逐字列出同樣那 6 支**
```
🔴 **工具沒有壞 —— 它兩次都答對了它被問的那個時點。** 別的窗在那 40 秒之間 `git add` 進來。
⇒ **這不是「尺不準」,是「尺量的是過去」。** 在共用索引上,**任何 preflight 的結論在它印出來的那一刻就開始過期**。

**判別句**
> **我這一發 preflight 與我這一顆 merge 之間,隔著幾秒?那幾秒裡別的窗能不能 `git add`?**
> 能 ⇒ **rc=0 只代表「當時乾淨」,不代表「現在可以 merge」。**
(這與本檔 §4 那條「我這次寫檔跟我這次讀檔,中間隔著別人嗎?」是**同一句話的第二個化身** ——
 那次是寫檔/讀檔,這次是量測/動作。)

**⇒ 現行處置(不改腳本,改用法)**
```
· preflight 與 merge **貼在同一條命令上**:
    bash scripts/harvest-preflight.sh <branch> && git merge --no-ff <branch> -m "…"
  🔴🔴 **而 `&&` 把窗口壓小，【沒有關掉它】**（主視窗 2026-08-20 指正；原句寫「拿得到的最好結果」
     會被讀成解決了）—— 兩個指令之間仍有毫秒級空檔，只是機率變小。
     ⇒ **它是減災，不是解。** 而**更難重現的 bug 更貴** ——
       下一個人若以為問題解決了，遇到時會先懷疑別的地方。
· 🔴 而 merge 【被擋】本身是【好事】,不要想辦法讓它過去:
  git 這一次是**吵著失敗**的。88804080 那次同族形狀是**安靜成功並帶走別人的檔**。
  ⇒ 兩者的差別不在誰比較小心，在 git 那一刻剛好需不需要動到那些路徑。
· 被擋 ⇒ 照紀律**去問那個窗**，不要 stash、不要 reset、不要「先收別支再回頭」繞過去。
```
⚠️ ~~**未驗**:把兩者用 `&&` 串起來之後**還會不會再發生一次**~~ ——
🔴 **這個問法本身錯了**(主視窗指正):`&&` **在原理上就擋不住它**,所以「有沒有再發生」不是判準 ——
**沒再發生只代表機率變小**。⇒ 不要拿「後來都沒事」當成它有效的證據。

### ✅ 而真正的那道關一直都在:**`git merge` 自己**
```
本次它【吵著失敗】：error: Your local changes … would be overwritten by merge
⇒ **merge 被擋本身是好事，不要想辦法讓它過去。**
   88804080 那次同族形狀是【安靜成功並帶走別人的檔】——
   差別不在誰比較小心，在 git 那一刻剛好需不需要動到那些路徑。
```

### 📌 後續量到的一格(同一晚,40 分鐘後)—— **rc=0 這次是對的,不是又漏了**
```
那 6 支後來被作者 `git restore --staged` 退出暫存區（它自己想到共用 index 這個坑，不是被叫的）
⇒ porcelain 從 `M ` 變成 ` M`（已 staged → 只有工作樹改動）
⇒ preflight 重跑 rc=0，而**這次 rc=0 是正確答案**：
   那 6 支不在本次 merge 的改動清單裡 ⇒ 不重疊 ⇒ merge 不會碰它們。
🔴 **判別 `M ` 與 ` M` 的差別是這一格的全部**：
   `M `（第一欄）= 已進索引 ⇒ **擋 merge、且會被不帶 pathspec 的 commit 帶走**
   ` M`（第二欄）= 只在工作樹 ⇒ 不擋不相干的 merge
   ⇒ 兩者在 `git status` 短格式裡**只差一個空格的位置**，而後果完全不同。
```

## 5c. 🔴 新開的 worktree 在 `pnpm install` 之前**沒有任何 pre-commit 閘**

```
.husky/_ 由 pnpm install 生成，而它被 gitignore
⇒ 新 worktree 一開始【沒有鉤子】⇒ 那段期間的 commit 會【安靜成功】，四綠與 reviewer gate 都不存在
實例:`f9cd9f88`（W5 的貼料號主體）就是這樣進來的 —— 它自己主動報的
判別句:**這棵樹跑過 `pnpm install` 了嗎?** 沒跑過 ⇒ 它的每一顆 commit 都是【裸的】
（轉錄自 memory `feedback_a-fresh-worktree-has-no-hooks`:8 —— 它 08-19 23:57 寫成,早於本檔 `5bc26ba1` 00:13;事件 `f9cd9f88` 由 W5 自報）
```
⚠️ **今晚開了多棵新樹** ⇒ 「回頭盤點有幾顆是裸的」**沒有人做,主視窗押著**。

## 5d. backlog 編號:號段表(2026-08-19 主視窗裁定)

```
W1 #700–#719   W2 #720–#739   W3 #740–#759   W4 #760–#779
W5 #780–#799   W6 #800–#819   主視窗 #820–#839   保留 #840+
規則:**只在自己的號段內遞增,不掃全檔、不看別人用到哪**;用完回報要新段，不要自己往上長
🔴 現有 #676 以下一律不動 —— **改既有編號正是製造第二次碰撞的那個動作**
   （#673 撞號 ⇒ 改成 #676 ⇒ 而 W3 同時也挑了 #676）
```
**兩組已知碰撞都【保留 + 各標互指註記】,不改號**:`#672`(W2 處理)、`#676`(W4 處理)。

## 6. 現況與下一步

```
git rev-list --count origin/dev..dev  ⇒ 39（本檔落檔時；會變，當場重量）
未收割：vitest-alias 1 支（押著，見 §2）
下一批來源：W1 正在改的訂單面板（收款區移到第 1 塊 + 拆掉四張摘要卡）
            —— 那是這一輪唯一會讓 Sean 打開後台看到不一樣東西的東西
推的時機：主視窗押著，等 W1 那片進來一次推
            理由=現在 39 顆裡看得見的只有兩顆鈕 + 面板 CSS，
            而 Sean 的四條回饋（MAIN-063 A/B/C/D）一條都還沒修完
```

### 🔴 而 `MAIN-063` 的四條裡,**「B」不會以一顆 commit 的形狀出現**

```
A 訂單明細欄位   W1 的片14/15/片7 陸續進來（它是【多顆】，不是一顆）
B 側邊欄         🔴 **兩個窗各做一半**：W1 那半（720 面板）已隨片14/15 進來；
                 W3 那半還沒開工（它序在 admin-probe 之後）
C 客戶頁篩選     ✅ 2f2863ab
D 商品頁         ✅ 兩半：2f2863ab（自動套用）+ 0e065c1b（品牌只列有商品的）
```
⇒ **收割時不要去找一顆叫「側邊欄」的東西** —— 找不到不代表沒人做,
而**「四條解了幾條」這個問題,答不出來的原因是【條】與【commit】不是一對一**。
📌 判別句(W4 第一手 —— MAIN-063 四條對 commit 的盤點是本窗做的):**回報進度前先問「這一條在 git 上長什麼形狀?」** ——
一條可能是 0 顆(還沒開工)、1 顆、多顆,或**跨兩個窗各一半**。

### 🔴🔴 那 131 顆**沒有過 Sean 逐顆看的那一關**(2026-08-20 00:0x 推上去)

```
origin/dev  f71974cf → 98a7ed69，131 顆。主視窗執行，Sean 逐字授權「1.2.3 先處理」
🔴 而「不 push、由 Sean 手動推」那道關的價值是【一雙沒寫過這段 code 的眼睛】
   ⇒ 這一批**失效的是他逐顆看那一格**，不是全部
✅ 沒有失效的:四綠（每批都跑、TURBO_FORCE=1 全 0 cached）／W6 逐片審／突變測試／部分片真瀏覽器驗
⚠️ 而 `git reflog show origin/dev` **只寫 update by push,不記錄執行者**
   ⇒ 「我沒推」可以證明,「是誰推的」**證不了** —— 兩件事寫的時候不要合併
還原路徑（主視窗備的，我沒驗過）:
   npx vercel rollback dpl_DwFBtog9HcViAnK5H4WWzaVRKD1c --scope pcm-motorsports
部署現況:dpl_4LKHSheUx51ygdVnWgStzg35ByxV state=READY / sha=98a7ed69（主視窗量，我未覆核）
```

### 📎 下一輪收割的來源:`MAIN-066` Sean 肉眼驗收第二輪(八條)

正本 `~/pcm-mailbox/MAIN-066-Sean肉眼驗收第二輪-20260820.md`。
```
兩個 Bug   面板切換不更新 / 取消整張單點下去沒反應
一個功能+文案 部分退款停在「處理中」——他問「要等明天才知道嗎?應該馬上成功才對」
四個視覺   三張卡文字凌亂 / 編輯訂單浪費空間 / 備註區要合一 / 全面字級顏色
一個動作   「寄信開」⇒ 主視窗手上，**未完成**
```
⚠️ 照 `MAIN-063` 那一輪的教訓:**「一條」不是可數的單位** —— 收割前先問「這一條在 git 上長什麼形狀」。

⚠️ **Sean 的四條回饋不是收割窗的工**(`~/pcm-mailbox/MAIN-063-Sean肉眼驗收回饋-20260819.md`)。
收割窗對它的貢獻方式只有一個:**別人一交件就馬上送進 `dev`。**

— END —
