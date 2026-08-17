# 推前總驗收 —— 今晚(2026-08-17 之後)改了行為的 commit 四欄對帳

> 起因:Sean 已批 apply、也早授權推,213+ 顆隨時上 pcm-admin production。而今晚改了十幾處(含錢/權限/出貨),沒有人回頭確認每一處【真進了 dev】【有負測】【被第二方驗過】【血半徑進了 code 註解】。
> 執行:T①(socket 32075),2026-08-18。**唯讀盤點,不改任何被審的檔。**

---

## 0. 分母(可重跑)

```bash
# 產品執行期行為 = apps/** + packages/** (非測試) + supabase/migrations/**,排除 scripts/(工具儀器)與純 docs
git log origin/dev..dev --since="2026-08-17 00:00" --pretty=%H --name-only \
 | awk '/^[0-9a-f]{40}$/{h=$0;next}
        /^(apps|packages|supabase\/migrations)\//&&!/\.(test|spec)\.[jt]sx?$/&&!/__tests__/{print h}' \
 | sort -u
```
- 產品執行期行為 commit = **27 顆**(含 scripts/ 工具儀器則 51 顆;那些不碰顧客面)。

---

## 🔴 column a 的分母陷阱(比表本身重要,寫在最前面)

> **column a(「進 dev 了嗎」)若拿【dev】當分母,它對分母裡每一顆【恆真】—— 零判別力,而表看起來完全正常。**
> 這是「恆真格」那一族的最高階版本:不是一格測試恆真,是**一張表的一整欄恆真**。
> ⇒ 要回答「有沒有東西【沒進】dev」,那一欄必須換**另一個分母**:各窗今晚宣稱改過的 commit(不論在哪個 branch),再逐顆 `git merge-base --is-ancestor <h> dev`。
> **本表的 a1210748 就是這樣抓到的 —— 去 dev 分母【之外】找。**

---

## 1. column a —— 不在 dev 的(推 dev 不會帶上)

| commit | 面 | 在哪 | 判定 |
|---|---|---|---|
| 🔴🔴 **a1210748** | **錢** settle-charge 對帳「已退金額欄缺不翻 0」 | `sso-security-log-tests` | **NOT in dev** —— 缺口 |
| a22f6e2d | C 條資料層(adapters) | `products` | NOT in dev —— **施工中正常** |
| 7f6d0ac1 | 六列表頁 max-w-6xl | `bmw-m-headline` | NOT in dev —— **施工中正常** |
| de7cc9ef | 出貨入口鈕改名 | `bmw-m-headline` | NOT in dev —— **施工中正常** |

**a1210748 細節(可回放)**:
- `git merge-base --is-ancestor a1210748 dev` ⇒ 否;merge-base 停在 15d8b19c。
- dev 現行 `packages/use-cases/src/settle-charge.ts:418` 仍是 fail-open:`if ((tr.refundedAmount ?? 0) !== 0) …` —— `?? 0` 就是病灶(欄缺→0→閘不響)。
- dev 版 grep `refunded_amount_missing`(修法招牌字)⇒ 0 命中 ⇒ 修法確不在。
- **射程**:這是【對帳/告警】閘(回 triage 訊號),**不是資金移動閘** ⇒ 不直接掉錢,但一類異常退款【不被告警】。仍屬鐵則 12①。
- **成因(主視窗自陳)**:I 窗押著它等 V 窗複驗;V 窗早 PASS;而「押著的理由消失」時沒有東西通知 I 窗 ⇒ 一顆錢的修法停在分支。→「暫緩要寫成有到期條件的依賴,而到期時沒有東西會叫」。

> ⚠️ 「正常(施工中)」與「缺口」分開講 —— 這張表不是四條紅字的恐慌清單。真缺口只有 a1210748。

---

## 2. column b —— 負測是不是真的

方法:`git show <hash> -- <test>` 讀 diff 判「會不會對舊 code 紅」(比「有沒有測試檔」強;比「親手拆」弱)。

| commit | 面 | 負測判定(讀 diff) | 親手拆紅 |
|---|---|---|---|
| 7305cf8d+b9a6b1e2 | tier prod 硬閘 | ✅ 真(翻掉舊斷言) | ✅ T① 親拆,①③兩格紅(V 窗獨立複驗一致) |
| 15d8b19c | 錢/退款帳本 | ✅ 真([5d] 舊斷言翻成 table 為 null,舊斷言留註解備查) | ✅ **5681 親拆三次:2 failed/25 passed([5d]+[5e])。🔴 但 commit body 寫「1 failed」是錯的** —— 更正在 STOP §⑤-b,收割引 STOP 別引 body |
| fa958b0c | 出貨單守門 | ✅ 真(不擋→擋印 + 反向格擋恆綠) | ✅ **C 窗親拆:2 failed/61 passed,與 body「2 格紅」一致**;兩格紅=設計(反向對照) |
| 251c2307 | 權限/RLS migration | ✅ 真(628-verify.sh M1/M2 REVOKE 突變) | ✅ **E 窗親跑:M1 轉紅在【元資料層】(非行為層,刻意——codex R2-MF3 把元資料守門重排到行為前,權限還在的世界先在 §2 被擋、REINDEX 不跑)** |

> 🔴 **251c2307 口徑(E 窗主動說,推前必帶)**:`628-verify.sh` PASS=32 **≠「正式庫 apply 會過」**。本機基線是照 repo DDL 重建的**三欄節錄版**,驗不到正式庫 owner/grantor/RLS/default ACL/Supabase 角色拓樸。限定寫在 migration 檔頭「誠實界」段。
> 📌 **E 窗 harness 設計值得記**:每發突變斷言【紅在哪一格】(逐格 grep 點名),不是【紅幾格】⇒ 結構上沒有「該紅 N 格」這個字面可與實際不一致 ⇒ V 窗抓的那類漂移在這支不存在。「紅了」與「紅對地方」是兩件事,數格數只驗前者。

> **column b 加問(今晚同族三次)**:commit body/註解寫的「拆掉會紅 N 格」,跟【現在】實際紅幾格一樣嗎?三次實例:
> - T① tier.test 原寫「第一格必須翻紅」,實測 ①③兩格 ⇒ b9a6b1e2 已修。
> - **15d8b19c body 寫「1 failed」,實測「2 failed」** ⇒ 5681 更正在 STOP §⑤-b(commit body 改不動)。成因逐字:「那個 `1 failed` 是 `[5e]` 還不存在時(26 格)量的,加完 [5e] 沒重跑 M1,拿舊數字描述最終狀態。」
> - 🔴 **5681 給的判別句最準(這族的根)**:**「不是數錯了,是【量測的時點】與【描述的對象】不是同一個狀態 —— 而它天生沒有訊號:那個數字當時是對的,是世界(檔案)變了而數字沒跟著變。判別句:我這個數字,是在【現在這個檔】上量的嗎?中間我改過它嗎?」**
> - 🟢 反例(結構上免疫)= E 窗 628-verify.sh:每發突變斷言【紅在哪一格】(逐格 grep 點名),不用「N 格」制 ⇒ 沒有那個會漂的字面。
> **親手拆**:各原窗自拆自己那顆(它們 worktree 有可跑狀態;T① 的 branch 落後 dev-merge、本地拆不動),回一行。

---

## 3. column c —— 第二方審查

> 🔴🔴 **這一欄最重要的不是那四顆,是【審查證據活在哪裡】。**
> reviewer-gate 的 marker **不留歷史**;三個月後**沒有任何機械方式**回答「這顆審過沒」。今晚主視窗能逐顆對帳,只因為它**還記得那幾封訊息**,而它會被壓縮。
> **判別句:這顆的審查證據,活在哪裡?活在 commit body ⇒ 永久;活在訊息 / marker ⇒ 會消失。**
> ⇒ 錢/權限/schema 的審查結論**必須寫進 commit body**(誰審的、判定、findings 折了幾條),不能只在訊息裡。

| commit | 審過沒(主視窗 review 帳) | body 有記? |
|---|---|---|
| 7305cf8d | codex + code-reviewer(opus)PASS | ✅ 有記 |
| 1fd291d6 | codex(收五條) | ✅ 有記 |
| 8cb69570 | 寫/驗分離:B 窗寫、E 窗驗 | ✅ 有記 |
| 15d8b19c | ✅ codex R3 PASS + V 窗 PASS(兩層) | 🔴 **body 沒記** |
| 251c2307 | ✅ codex 三輪 13 條全折(harness 禁 Agent 故未跑 code-reviewer;主視窗裁「apply 前必補」仍成立=apply 前置非推前置) | 🔴 **body 沒記 codex** |
| 🔴 fa958b0c | **無人審**(C 窗自判輕量片跳審,判定人=自己,沒有第二方) | —— |
| 92ac213c | 🟡 E 窗規格層第二方;修法本身回驗無紀錄 | 待補 |

### 🔴 fa958b0c = 真 column-c 缺口 + 一個規則的洞(C 窗主動自曝)

- **無人審**:C 窗依 `CLAUDE.md` 片型分級自判輕量片(不碰六類 + 單一元件)⇒ code-reviewer 可跳。合規,但**沒有第二個人看過**。
- 🔴 **規則的洞**:這一片**翻掉了一格既有測試的斷言**(原釘「`null` ⇒ 不擋」→ 改「`null` ⇒ 擋印」)。**「翻既有測試斷言」不在片型分級的六類裡,所以規則沒擋它** —— 而翻既有測試的語意 = 行為語意改動,理應觸發審查。C 窗自評「那大概是規則的洞,不是我該利用的空間,要補審我不反對、該補」。
- 「三條依據寫得完整」≠「有第二個人查證過那三條」—— 是兩件事。
- **建議**:推前對 fa958b0c 補跑一次 code-reviewer(叫得動 Agent 的窗);並考慮把「翻既有測試斷言」加進觸發審查的條件(機制優先律候選)。

---

## 4. column d —— 血半徑限定進了 code 註解,不只 commit body

> **為什麼重要(現成最佳論證)**:`lessons:1065` 那條 —— 原文 runbook(`docs/reviews/2026-08-07-e-batch-apply-runbook.md:164-166`)有「PGRST202 = 具名參數對不上」的限定,而 lessons **摘要弄丟了它**,摘成「函式不在」,活了 11 天並被當通則引用。
> ⇒ **限定會在轉載時掉,而掉了之後沒有人知道它掉過。** commit body 不會被讀第二次,code 註解會 ⇒ 血半徑限定必須進 code 註解。

抽樣(續):
- fa958b0c:「shipping-doc.tsx:81 未核、刻意不動」寫在 commit body ⇒ **待查是否也進了 code 註解**。
- (下一輪補其餘高風險顆的 d 欄抽樣。)

---

## 小結(推前)

**兩個推前要處理的**:
1. 🔴🔴 **a1210748(錢的 fail-open 修法)not-in-dev** —— 推 dev 不會帶上。已單報,I 窗去收。成因=「押著等複驗、複驗過了沒人解押」。
2. 🔴 **fa958b0c 無人審** —— 且翻了既有測試斷言(規則的洞)。推前補一次 code-reviewer。

**已澄清、非缺口**:
- 其餘三顆 not-in-dev(a22f6e2d/7f6d0ac1/de7cc9ef)= 施工中正常。
- 15d8b19c / 251c2307 = **審過了(codex+V窗 / codex 三輪),只是審查帳沒進 body**。
- column b 三顆全部【原窗親拆確認紅】:15d8b19c 2 格、fa958b0c 2 格、251c2307 元資料層(刻意)。

**比那些 commit 本身更重要的兩條(寫進制度)**:
- **column a 分母陷阱**:一整欄在自己的分母上恆真=零判別力(見檔頭)。
- **column c 載體律**:審查證據活在 commit body ⇒ 永久;活在訊息/marker ⇒ 會消失(reviewer-gate marker 不留歷史)。錢/權限/schema 的審查結論必須寫進 body。
- **column b 時點漂移**:數字「當時對」但檔案變了沒回頭重量(15d8b19c 的「1 vs 2 failed」);逐格點名(不用 N 格制)結構免疫(E 窗 628-verify.sh)。

**附註**:
- 15d8b19c 的 body「1 failed」是錯的,更正在 `~/pcm-mailbox/T-008-STOP-20260817.md §⑤-b`;收割 merge body 引 STOP、不引 commit body(I 窗已照辦)。
- 251c2307 的 `628-verify.sh PASS=32 ≠ 正式庫 apply 會過`(本機三欄節錄版,驗不到正式庫 owner/grantor/RLS/ACL/角色拓樸)。
- 8e576886(量測管線 refactor)body 有一句歸因錯誤(V 窗在 C 窗施工中工作樹上 `cp` 還原蓋掉了 C 窗的還原,C 窗誤記成「腳本沒吃到」)—— C 窗走信+STOP 更正,那段期間的突變量到的是半成品狀態、V 窗自己作廢。
- 檔名相撞已解:5681 把它的 traps-inbox 檔改名 `T2-20260818.md`(883fabb2),本窗的 `T-20260818.md`(da070870)不用動,`git merge-tree` 已 rc=0。
