# 供應商主檔線 — 交接檔(2026-08-01 下午)

> **接手入口。開工前整份讀完。** 前身 = `docs/handoff/2026-08-01-a7c-applied-handoff.md`(A7c 線,已完成)。

---

## §0 一句話現況

**供應商主檔 plan v2 已寫完、等 Sean 批准;code 一行都還沒寫。** 未推 commit 3 筆、工作樹乾淨。
今晚 22:00 後仍有一件獨立的事要做:**TapPay sandbox 部分退款探測**(見 §5,與本線無關、不互相擋)。

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git log --oneline -4 && git status --porcelain
```
預期:branch=`dev`、HEAD 三筆為本日 docs commit、**工作樹乾淨**。

---

## §1 這條線今天發生了什麼(順序很重要)

1. **完成地圖產出**(`6a1e95d`)——27 項逐項盤點,結論:**能用的只有 2 項、從 07-26 到今天沒變**;
   已拆片 43 / 未拆區塊 13 / 零規劃領域 5。地圖 = `docs/specs/2026-08-01-admin-completion-map.md`。
2. **依 DAG 起手 A5b**(供應商名稱正規化 SQL 函式)⇒ **三輪對抗審查全 NO-GO、共 37 must-fix**
   (codex R1 14 → codex R2 13 → **Fable R3 換模型換角度 10**),逐條親驗全成立、駁回 0。
   🔴 **函式本體三輪都沒被打破;37 條全部打在 plan 文件上。**
3. **Sean 拍板換路**(`ec98b25`):供應商改「**主檔 + 下拉選單**」⇒ **A5b 與 A5c 砍掉**,
   **並明確推翻 07-27 Q2=B「E12 供應商主檔這期不做」**(本次確認、非假設)。
4. **供應商主檔 plan v1 → codex 關卡1 NO-GO(約 30 must-fix)→ 本 v2**。

---

## §2 🔴 Sean 今天的全部拍板(逐字,施工必須逐條對照)

| # | 逐字 | 落到哪 |
|---|---|---|
| 1 | 「A 下拉選單,供應商還可以自行再增加到下拉選單」 | 主檔 + 選單 |
| 2 | 「那就變成無法刪除就好,只可以修改名稱。」 | 可新增 / 可改名 / **不可刪除** |
| 3 | 停用開關 = **A** | `is_active` |
| 4 | 「就先這 26 個」 | plan §11 seed |
| 5 | 「名單排序依照字母順序」 | `ORDER BY label` |
| 6 | 「名單欄位可以打字快速帶入名單候選」 | typeahead |
| 7 | **Q1=A** 改名後歷史顯示新名字 | 不存快照 |
| 8 | **Q2=A** 停用旗標先做 | 明知暫時無人消費 |

另兩則同日拍板(工作模式,不屬本線但同 session):**Q1=A 照原訂做 E10 第 1 批關鍵片**、
**Q2=A 夜跑吃機械片**(九碼退場六片;**明知它們做完 27 項驗收表一格都不會動**)。
落檔 = memory `project_m4b-supplier-master-decisions` / `project_workmode-0801-nightrun-decisions`。

---

## §3 下一步(依序)

1. 🔴 **Sean 批准 plan v2**(命中鐵則 8:動 schema + 跨 3+ 檔)—— **未批准前不得動 code**。
   plan = `docs/specs/2026-08-01-e10-supplier-master-plan.md`。
2. **關卡1 R2**:v1 是 NO-GO、v2 折入約 30 條 ⇒ 依輪次紀律要跑 R2 確認。
   🔴 **下次跑 codex 記得帶 `-c service_tier="fast"`**(排隊優先權,不降品質;
   本 session 沒帶、且 42 天前那則紀錄是 CLI 0.128.0 的,**新版是否仍有效尚未驗證**)。
3. 依 plan §4 施工 **S1a → S1b → S2 → S3a → S3b** 五片。

---

## §4 🔴 接手必須知道的坑(今天實際踩到的)

### 4.1 codex 背景跑會靜默卡死 —— 已做成機制
`codex exec` 未加 `< /dev/null` 時**卡死 47 分鐘、CPU 0%、輸出 1 行**,
外觀與「正在深度思考」完全相同。該坑 memory 已記兩次、**今天是第 3 次復發**,
且兩次都連帶對 Sean 做出「審查正在跑」的不實回報。
⇒ **PreToolUse 門禁已掛**(`~/.claude/hooks/require-codex-stdin-guard.js`,Sean 拍板 A)。
🔴 **比修法更重要**:背景工作「活著」看**產出有沒有長**,不是 `pgrep` 有沒有命中。
等待迴圈至少要偵測三種結局:出判定 / 程序消失 / **輸出連續 N 分鐘零成長**。

### 4.2 審查期間不得改被審物件
今天違反一次(R2 送審後改了 plan 一個行號),已自陳於 A5b plan 檔頭。
同款 07-31 才發生過。**送審 = 凍結。**

### 4.3 我今天犯的「字面 vs 事實」四次(全部由審查抓出)
1. 引 A7c 交接檔的「兩表 0 列」當**採購表**的證據 —— 那是退款帳本的數字。
2. 說「repo 已有 15 家供應商名冊」—— `scripts/supplier-config.ts` 是**爬蟲管線設定檔**,
   那 15 家是**改裝品牌**。**我從審查員 finding 直接轉述、沒自己開檔確認。**
3. 說「只有 2 個檔引用 canonical key」—— grep **排除了 `.md`** 卻下通則結論,實際至少 8 處。
4. 說「S3 讓完成地圖第 26 項變綠」—— 第 26 項是「員工各自帳號與權限」,**引用錯項**。

⇒ **通則:限縮搜尋範圍時,結論範圍必須跟著限縮;引用任何檔案前先開來看它是什麼。**

### 4.4 Fable R3 抓到的那條(codex 兩輪都沒看到的層次)
我為修 R2「漏改三行 A7b-T」而設計的「四行機械換成 A7c + `grep -c=0` 驗收」
**會製造假句並抹掉一筆 Sean 拍板紀錄** —— master `:248` 說「A7b-T 移除 dormant CHECK」,
而 A7c migration `:51` 逐字說它**不動**休眠閘。⇒ **修法比漏更糟。**
🔴 **那批 master 修正交還退款線語意改寫,不屬供應商片。**

---

## §5 今晚 22:00 後(獨立於本線,不互相擋)

**TapPay sandbox 部分退款探測** —— 交易 `D202607314b3cIL`,今天 18:00 送批。

```bash
python3 scripts/tappay-sandbox-refund-probe.py plan     # 先看順序,零 API 呼叫
python3 scripts/tappay-sandbox-refund-probe.py query    # 唯讀,確認 is_captured=true
python3 scripts/tappay-sandbox-refund-probe.py refund 10
```
🔴 **query 若 `is_captured` 仍是 false 就停** —— 未請款做部分退款必回 `10024`,測了沒意義。
回答兩個 PCM 從未測過的問題:API 支不支援多次部分退款 / 超額退款會不會被 API 拒。
🔴 Portal 按鈕消失只證明介面擋住、**不證明 API 會拒**,而 API 才是我們要走的路。
細節見 `docs/handoff/2026-08-01-a7c-applied-handoff.md` §3。

---

## §6 沒做的事(明說)

- **供應商主檔 code 零行**。plan v2 未經關卡1 R2、未經 Sean 批准。
- **A5b plan v3 標作廢但保留**:§2 的 14 條 PG/Unicode 實測與形狀無關、可重用
  (新主檔若要對 label 做任何歸一,同一批坑會再出現)。
- **完成地圖 §3 的單片成本估算已知偏低** —— A5b 是我判定最輕的一片,實際三輪審查 37 條後整片作廢;
  「30-40 分鐘」只算實作沒算審查。已在 STATUS 標註,待第一片走完完整流程再修。
- **未跑 `busboy-end`**(工作樹狀況見 §0)。
- **未 push**(3 筆待 Sean 手動推)。

— END —
