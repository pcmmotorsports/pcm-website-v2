# Plan · `acl-drift-gate.py` R5 開一條豁免路(`⟦auth-R5VSMEMBERSHIP⟧`)

> 線【身分】`-auth` · 2026-09-05 · 主視窗 `-f8` 派 · **本檔是 plan,零改動**
> 🛑🛑 **改這支閘 = 【動驗證本身】** —— 那是 `00-work-rules` R4 逐字的「立即停止訊號」。
> ⇒ 📌 **所以本檔只提案。誰裁:主視窗 / Sean。我不動手。**

---

## 0. 🔴 先講一件我查出來的事,因為它會改變「這題該誰拍」

板列 `⟦auth-R5VSMEMBERSHIP⟧` 上我原本標「**R5 當初為什麼不可豁免 = 未查**」。
**查了。而答案是:【沒有記錄】。**

🔬 我掃過的四個地方(每一發都附負對照或分母):

```
① 閘的檔頭            R3 / R4 逐字寫「除非同檔加 -- ACL-GATE-EXEMPT」;
                      R5 那一行【只寫 ⇒ 紅】, 沒有任何「為什麼不給豁免」
② 程式碼              scripts/acl-drift-gate.py:322 R5 的 out.append 是【無條件】的
                      —— 它根本沒有接 exempt_for 這個參數, 而同一支函式裡 R3/R4 有接
③ selftest            共 47 格 / R5 佔 4 格, 而【零格】是「R5 + EXEMPT 仍然紅」
                      ⇒ 📌 那個不可豁免【沒有被任何一格測試釘住】
④ commit body 與文件   git log -S"MEMBERSHIP_DANGEROUS" ⇒ 只有一顆 788397652;
                      它的 body 提到 R5 三次, 全是列舉規則名, 零處講豁免。
                      docs/plans/ docs/specs/ docs/reviews/ 搜 acl ⇒ 只有 -db 那支
                      執行期偵測器的 plan, 沒有一份在講這支【文字閘】。
                      🔵 負對照:編造檔名 ⇒ 0
```

🎯 **⇒ R5 的不可豁免不是一個【被推翻要付代價的拍板】,是一個【沒有人寫下理由的現況】。**
🛑 **⇒ 而「沒有記錄」不等於「沒有理由」** —— 寫它的人可能想過而沒寫下來。
　　⇒ 📌 **這一格改變的是【誰要負舉證責任】**:不是我去推翻一個決定,
　　　　是**我們要補上那個從來沒被寫下來的理由,然後才知道能不能鬆。**

---

## 1. 為什麼現在要動它

`⟦b9-RLSHARDEN⟧` 的收窄案(`docs/specs/2026-09-05-service-role-narrowing-m1-draft.sql`)
今天住在 `docs/specs/` 而不是 `supabase/migrations/`,**唯一的理由就是 R5 會擋它**:

```
:135  GRANT service_role TO pcm_email_writer;
:136  GRANT service_role TO pcm_cron_writer;
```

🔴 **而這兩行不是可有可無的** —— 已量到的事實:
**`INHERIT` 成員資格是 `TO service_role` 的 policy 對新角色生效的【必要條件】**
(實測:NOINHERIT 成員讀 0 列 / INHERIT 成員 1 列 / 正對照 `service_role` 本人 1 列)。
⇒ 📌 **不 `GRANT service_role TO`,收窄案根本不成立。**

⇒ 🎯 **所以這是一個【一道正確的守門, 擋住了唯一可行的設計】的局面 —— 兩邊都是對的。**

---

## 2. 提案:R5 加一條**具名**的豁免路(不是「加 EXEMPT 就過」)

### 條件(三個都要,缺一仍紅)

```
① 同檔有  -- ACL-GATE-EXEMPT-R5: <被授的角色> -- <理由, ≥8 字且帶可稽核錨>
   (形狀照 R3/R4 現有的 EXEMPT,錨 = #編號 / 版本號 / 日期)
② supabase/APPLIED.tsv 有 20260905140000 與 20260905170000 兩列
   （= ACL 漂移【執行期】偵測器已經貼進正式庫）
③ 被授的角色名【不在】公開角色集合(anon / authenticated / authenticator / PUBLIC)
   —— 🔴 這一格是新的:R5 今天連 `GRANT service_role TO anon` 都只是「紅」,
      而放行路一旦開, 那個世界必須【永遠不可豁免】。
```

### 為什麼是「偵測器上線」當條件

R5 擋的不是語法,是**一個沒有人在看的世界**:成員資格複製一份權限出去,
而**今天沒有任何東西會在事後回頭量它**(閘檔頭自己寫:774 個 privilege 檢查
100% 住在 apply 時的 `DO` 區塊、`CREATE EVENT TRIGGER` = 0、6 個 cron job 沒有一個回頭量 ACL)。

⇒ ✅ **`⟦b9-ACLDRIFT5⟧` 那支偵測器正是在補這一格**:
`pcm_acl_snapshot_digest` 表 + `pcm_acl_digest()` / `pcm_acl_digest_record()` +
每日 `cron.schedule('pcm-acl-digest', '0 0 * * *', …)` + `pcm_acl_approve_latest(text)` 人工核准。
⇒ 📌 **偵測器在 = 那個「沒有人在看」的前提不再成立 ⇒ 才有資格談放行。**

### 放行時要印一句(不要靜靜通過)

```
⚪ R5 豁免:GRANT service_role TO pcm_email_writer
   —— 理由「…」;偵測器前提:APPLIED.tsv 有 20260905140000 / 20260905170000
   🔴 而本閘【沒有】驗那支偵測器今天真的在跑 —— 見下面「證不到什麼」
```

---

## 3. 驗收(正負對照成對,每條可 yes/no)

```
1. 🔴 負對照 A:帳本【拿掉】140000 那一列 ⇒ 同一支檔仍然 rc=1(仍擋)
2. 🔴 負對照 B:帳本兩列都在, 而【沒寫】EXEMPT-R5 ⇒ 仍然 rc=1
3. 🔴 負對照 C:帳本兩列都在 + 寫了 EXEMPT-R5, 而被授的是 `anon`
   ⇒ 仍然 rc=1(條件③)
4. 🔴 負對照 D:理由字數 < 8 或不帶錨 ⇒ 仍然 rc=1(沿用 R3/R4 的 EX 規則)
5. 🟢 正對照:三個條件都齊 ⇒ rc=0, 且【印出】上面那一句
6. 🟢 回歸:現有 47 格 selftest 全過(今天 82 PASS / 0 FAIL, 我當場跑過)
7. 🔴 突變:把新加的三個條件【任一個】改成恆真 ⇒ 對應那一格必須紅
   —— 🛑 少了這一格, 一個「寫了條件而沒接上」的版本會四格全綠
```

---

## 4. 這個提案【擋不住什麼】(與修法一樣顯眼)

```
① 🔴 帳本是【自陳】的 —— 誰都能手打一列進 APPLIED.tsv。
   ⇒ 📌 條件② 驗的是「有沒有人【記】偵測器貼了」, 不是「偵測器真的在跑」。
   ⇒ 而閘是 pre-commit、離線、每個窗都沒有正式庫存取 ⇒ 它【結構上】問不到 DB。
   ⇒ 🛑 這個弱點【無法在閘裡修】, 只能寫在它印的那句話裡(上面那句就是)。
② 偵測器【貼了】不等於【在跑】—— cron job 可以被停、函式可以被 CREATE OR REPLACE 換掉,
   而閘看不到那些。
③ 偵測器是【每日】一次 ⇒ 最壞情況下, 一次漂移要 24 小時才被看見。
   ⇒ 📌 這條豁免路換來的不是「不會漂」, 是「漂了會在一天內被看見」。
④ 路⑤(dashboard / SQL Editor / MCP 手動 GRANT)本來就漏擋, 本提案【零改善】。
```

---

## 5. Rollback

改一支 `.py` + 它的 selftest ⇒ **revert 一顆**。零 DB、零 migration、零 env。
🔵 而 revert 之後回到今天:R5 全紅、收窄案繼續住在 `docs/specs/`。

---

## 6. 🔴 一個字的題(我不自己拍)

```
Q-R5豁免:
  甲 = 照本檔做(三條件豁免路 + 七格驗收)
  乙 = 不動這支閘, 改讓收窄案【不用】GRANT service_role TO
       —— 而那要先證明有另一條路讓 policy 對新角色生效, 🔴 而我今天量到的是【沒有】
          (INHERIT 成員資格是必要條件, 實測三格)
  丙 = 兩個都先不做, 收窄案繼續住 docs/specs/(= 今天的狀態)
A: 甲|乙|丙   ← 我推【甲】, 而**理由要連同它的弱點一起讀**:
   甲的價值全部押在「偵測器真的在跑」上, 而**閘驗不到那一格**(§4①)。
   ⇒ 📌 若裁 甲, 請連帶指定【誰負責定期看那個偵測器的輸出】——
      沒有那個人, 這條豁免路就是一句好聽的話。
```

⚠️ **而在裁下來之前,§0 那件事要先有人接**:
**R5 為什麼不可豁免, 沒有人寫下來。** ⇒ 甲乙丙三個都建立在「那個理由不存在或不重要」上,
而**那是我查無, 不是我證明它不存在**。

---

# 🛑🛑 結論(2026-09-05 · 主視窗 `-f8` 裁【換路】)—— **這條豁免路不做了,已撤回**

`7aa85abdf`(開豁免路)與 `89447fda3`(折第一輪 8 條)**兩顆都撤掉**;
`scripts/acl-drift-gate.py` 回到 `7aa85abdf^` 的內容(逐位元組核過,selftest 回到 **82 PASS / 0 FAIL**,
R5 相關字面 **0 命中**)。**留歷史,不 reset。**

## 為什麼不做 —— **兩輪 14 條 must-fix 的【形狀】,不是條數**

| 輪 | 誰 | 結果 |
|---|---|---|
| R1 | code-reviewer(opus) | FAIL **6** must-fix |
| R1 | adversarial-reviewer(opus,`-f8` 派) | FAIL **8** must-fix + 5 nit |
| R2 | adversarial-reviewer(opus) | FAIL **6** must-fix + 2 consider + 5 nit |
| R2 | codex(`gpt-5.6-sol` xhigh,本窗) | **FAIL** —— 與 adversarial R2 **收斂到同一批** |

🎯 **而 `00-work-rules` R4 的換路訊號逐字命中**:「相同錯法第 2 次」「修 A 壞 B 連鎖 2 步」
「某輪的 finding 開始重複前輪、或都在同一層打轉」。⇒ 📌 **兩輪的 findings 都是同一族,而修法在疊修法。**

### 那一族長什麼樣(這是本節最該帶走的)

```
族①【離線文字閘對「遞移授權」結構上蓋不住】
    R1-F5  GRANT service_role TO pcm_w(豁免綠)+ GRANT pcm_w TO anon(零規則)⇒ anon 拿到 service_role
    R2-F1  我補的遞移【只比被授那側】⇒ 把順序反過來(HEAD 先有 GRANT pcm_w TO anon、
           staged 才豁免 service_role TO pcm_w)⇒ 仍然破
    R2-F2  遞移掃的是原始 SQL, 不走 sql_layers ⇒ DO $$ EXECUTE 'GRANT service_role TO pcm_w' 看不到
    ⇒ 🔴 每補一個方向, 下一輪就指出另一個方向。**要關滿得做不動點迭代 + 進到字串層,
       而那時它已經不是一道文字閘了。**

族②【每一格新判準的突變都落在 selftest 之外】
    R2-F3  extra_dangerous 換空集合      ⇒ 129 全綠
    R2-F4  r5_prereq 換恆真              ⇒ 129 全綠
    R2-F5  MEMBERSHIP_DANGEROUS 刪 postgres ⇒ 129 全綠
    codex  F10 的替身覆蓋在先, 所以它證的是「替身接得上」不是「原實作對」
    ⇒ 🔴 我每加一格守門, 就多一個【它自己沒有守到】的生產接線。

族③【印一行不是訊號】
    R2-F6  F13 那行紅在 `if not files: return 0` 之【後】⇒ 開門的那一顆
           (補帳本 + 合 .ts)不 staged migration ⇒ 它印的是「不適用」。
```

⇒ 🛑 **三族合起來的結論:我在一個【結構上做不到】的地方,用越來越細的規則去逼近它。**

## ✅ 換的那條路(`-f8` 裁,寫成 `⟦auth-R5VSMEMBERSHIP⟧` 的結論)

收窄第一片**不走豁免路**,改走:

```
① 草稿留在 docs/specs/2026-09-05-service-role-narrowing-m1-draft.sql(不進 supabase/migrations/)
② Sean 明示授權之後【由 Sean 貼】
③ 貼完 ⟦b9-ACLDRIFT5⟧ 的偵測器會紅【一次】
④ 用 pcm_acl_approve_latest(<理由>) 認掉那一次
⑤ 帳本記一列, 指到 docs/specs 那支
```
🔵 **為什麼這條比豁免路好**:它**不需要文字閘看得懂遞移授權** ——
那件事交給**執行期的偵測器**(它讀的是真的 `pg_catalog`,不是 SQL 字面),
而**文字閘維持「一律紅」這個它做得到的宣稱**。
📌 **⇒ 把「閘做不到的那一半」交給做得到的那個東西,而不是把閘改鬆。**
🛑 **而它不是零成本**:每次都要 Sean 的手 + 一次人工認可;而**`repo` 裡有檔**(不是路⑤ 的手打),
所以下一個人查得到來源。

## 🛑 這一節【證不到什麼】
· **我沒有實跑過那條新路** —— ③④⑤ 三步都要正式庫,而收窄片今天還沒被貼。
· 撤回只證明「豁免路的碼不在了」,**不證明**「那三族問題在別的地方不存在」——
  族①那個遞移洞的**後半**(`GRANT pcm_w TO anon` 零規則觸發)**本來就開著**,撤回之後**照樣開著**。
  ⇒ 📌 **那是一個獨立的缺口,不歸本片,而它現在沒有人記著。**(要不要開列:`-f8` 裁。)
· 撤回也順手撤掉一個**與 R5 無關的好修法**:`selftest` 的 `total` 從「手維護的加總」改成「數出來的」
  (`7aa85abdf` 帶進來的)。⇒ 那個病(新增格子而總數不跟著動)**回來了**,
  已寫進 `⟦b9-GATESELFEDIT⟧` 當待派內容。

## 📌 codex 對「閘外最小機制」的答案(F14,值得單獨留著)
> 最小閘外機制是 **GitHub server-side protected branch / ruleset**:
> enforcement chain 那幾段必須經 **code-owner PR 核准、作者不可自行 bypass**;
> **只放一份 repo 內 checksum 或 CI 腳本,仍可在同一顆 commit 裡一起改掉。**
