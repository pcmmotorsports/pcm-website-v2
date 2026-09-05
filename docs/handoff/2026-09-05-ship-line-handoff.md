# 交接 · 出貨線(`-ship`)2026-09-05

> **這一份是收帳,不是進度報告。** 它答三件事:
> **①哪些東西還沒上去 ②哪些事停著而停在誰身上 ③接手的人【不要】做什麼。**
>
> 🔴 **本檔寫於 `agent/line-ship` HEAD = `0b56b677d`。**數字會過期 ——
> 引用之前當場重跑那一行,不要抄本檔的數字。

---

## 一、還沒上去的東西(**兩條分支,而它們的處置完全不同**)

### A. `agent/line-ship` —— **6 顆,可以推**
```
量法 git rev-list --count origin/dev..agent/line-ship
0b56b677d  docs(runbook): 一句「要 Sean 手動改 DB」, 而全 repo 沒有一個地方寫他要怎麼改
9f4647173  docs(plan): 我跑對了那個 grep, 答案排第一, 而我讀成「那只是提到它」
7846f3b17  docs(board): 我看到了那個 2, 而我沒有停下來
4b43771ba  Merge remote-tracking branch 'origin/dev' into agent/line-ship
a4a8b6175  docs(plan): 輕不等於子集 —— 換了帳號就換了這次實驗答得到什麼
cc0d0fa01  docs(plan): 用最重的手段回答最輕的問題, 那個重量換不到確定性
```
🔵 **全部是 `.md`** —— 零程式碼、零 migration、零對外。⇒ 併進 dev 不會改變任何行為。

### B. 🔴🔴 `agent/line-ship-5b-sentnum` —— **6 顆, 【不要合】**
```
量法 git merge-base --is-ancestor agent/line-ship-5b-sentnum origin/dev  ⇒ 未合(正確)
74ec81a5d  fix(db): 我的 UUID 守門是裝飾用的 —— PG 不保證 AND 的求值順序
cdc172446  test(probe): 用 bigserial 的 fixture, 正式的排序問題在探針上根本不存在
72d53b562  feat(db): 一箱可以裝好幾張訂單, 而第一版只綁了箱
113fb3b5a  test(probe): 那個競態重現出來了 —— 而它至今只有推導
910db2169  test(sql): 三世界探針 —— 而板列給的那句修法在世界②當場消失
4ee55d4db  WIP(草稿, 不進 dev): 5b 片 A migration —— 尚未跑三世界探針
```
🛑 **為什麼不能合**:它含一支**沒有貼進正式庫的 migration**,而
**migration 是不可變歷史** —— 合進 dev 之後改它就要再開一支。
⚠️ 而 `4ee55d4db` 的 commit 標題**自己寫著「不進 dev」** —— 那不是註解,是處置。
📌 **⇒ 接手的人:這條分支的正確動作是【繼續在它上面做】或【整條丟掉】, 不是 merge。**

---

## 二、停著的事(**逐格寫【停在誰身上】—— 沒有這一欄的清單會被讀成待辦**)

### ① 🔴 新竹貨運:三件事全停,**停在【問廠商】**
```
停的是      ⟦ship-HCTAPI⟧(parked) · HCT JSON 形狀探針 plan · ⟦ship-HCTUNKNOWNSTUCK⟧ 的 RPC 那半
停在誰      🔴 **新竹**(要他們回四題)⇒ 然後 Sean 重新授權
問題在哪    ~/pcm-mailbox/要問新竹的四題-20260905.md(白話版, 64 行)
為什麼停    05:0x 量到那個服務【只講 SOAP】—— 而我們的碼假設 JSON。
            ⇒ 「什麼叫查到了」的形狀由傳輸決定(SOAP 回 XML, 查無的形狀與 JSON 不一樣)
            ⇒ 📌 現在寫那支 RPC = 猜一個【不可變】的東西。
```
🛑 **接手的人不要做的事**:不要「先照 JSON 寫,之後再改」。那支是 migration。

### ② 🔴 `⟦5b-SHIPPEDNUMNOTRECORDED1⟧` —— **停在【22 條 must-fix】**
```
狀態        stopped(不是 doing)。分支 B 那 6 顆就是它。
停在誰      🔵 **我們自己** —— codex 對抗審查的 22 條 must-fix 還沒展開修
內容        我們沒存下「那封出貨信實際寄了哪個號碼」⇒ 一個競態下客人永久拿著錯號碼, 而沒有東西會叫
🎯 已經做到  競態【物理重現過】(gen1 假 / gen2 真, 三次一致);四突變 harness 抓到一個真的崩潰(世界⑧)
```

### ③ 🟡 片 0(出貨明細 PDF 基線)—— **停在【Sean】**
```
要他做      在正式站打一次 /account/orders/<id>/statement.pdf, 回報四格
放在哪      ~/pcm-mailbox/端Sean-0905早上佇列.md §C
為什麼是他  那條路要登入一個真客人的帳號, 而我們不在正式站後台用測試帳號
🔴 這是第三次記錄「未量」—— 前兩次也都記了, 而它沒有前進。
   ⇒ 📌 **接手的人:如果又要記第四次, 那不是記錄問題, 去問為什麼端不出去。**
```

### ④ 🟡 出貨 PDF 抽取第一片 —— **排在片 0 後面(主視窗 09-05 裁乙)**
```
差異頁      docs/plans/2026-09-05-shipping-pdf-today-diff.md(210 行, commit 9f4647173)
第一片範圍  把 strip-pictographs.ts 抽進 packages/adapters/pdf(範圍寫在差異頁 §二)
為什麼排後面 正本 §13-② 逐字:「這一片的前置是【丁先被驗過】」—— 那是拍板不是建議
🔴 而我 v2 在同一份檔裡自己豁免過它一次 ⇒ 這一格特別容易再被豁免一次。
```

---

## 三、🛑 接手的人【不要】做的事(每一條都有人踩過)

```
1  不要 merge agent/line-ship-5b-sentnum 進 dev(見 §一B)
2  不要照 JSON 去寫新竹那支 RPC(見 §二①)
3  不要把出貨 PDF 第一片排在片 0 前面 —— 而它會很想被排前面, 因為它「零依賴零風險」
4  不要用 updated_at 去算「這箱多久沒動」—— shipments 有 touch trigger,
   任何改動都會動它(改用 hct_raw_response ->> 'at')
5  不要拿差異頁裡那些【打了刪除線】的數字去用 —— 它們作廢的理由就寫在旁邊
6  不要 push —— 只有 Sean 推, 或主視窗代推
```

---

## 四、今天做完而**已經上去或可以上去**的

```
⟦ship-BRANDSPELLING1⟧    品牌拼法 AKRAPOVIČ ⇒ Akrapovic(前台碼已改 + ASCII smoke test)
                          🔴 而 DB 那半是 Sean 自己貼的 SQL(我唯讀驗過:25 筆總數不變)
⟦ship-PIPESPLITCELLS⟧    board-row-by-anchor.sh --cells(pipe-aware, 突變測過)
⟦ship-HCTUNKNOWNSTUCK⟧   UI 那半(紅字提示)已上;runbook 今天補上(0b56b677d)
                          🔴 RPC 那半仍 open
出貨 PDF 差異頁 v3       codex 關卡 1 判 FAIL 14 must-fix, 逐條複驗折入(9f4647173)
```

---

## 五、🔴 這一份【證不到】什麼

```
1  它證不到「本線沒有別的東西停著」—— 我列的是【我知道的】。
   分母 = 我今天碰過的板列, 不是所有 ship-* 的列。
   ✅ 自己重數的方法(本檔寫成時當場跑過):awk -F'|' '/⟦ship-/' docs/launch-todo.md | wc -l ⇒ 33 列
      🟢 正對照 同一把尺換 /⟦shipXX-/ ⇒ 0 ⇒ 尺是活的
      ⚠️ 而 33 是【提到 ship- 錨的行數】不是【ship- 的板列數】—— 有些行只是引用它
2  🔴 第三節那六條「不要做」全部是【文字】—— 沒有一條有機制擋著。
   ⇒ 📌 講規矩不會提高套用率, 裝守門會。而今天沒有時間裝。
3  本檔的 commit 清單是 HEAD=0b56b677d 那一刻的。七個窗同時在寫 ⇒ 讀到時可能已經變了。
4  ⟦ship-PRINTLAYOUTNOTEST⟧ / ⟦ship-HCTACTIVATION⟧ / ⟦ship-TURBOFORCECOST⟧ 三列今天沒動過,
   **我沒有重新確認它們還成不成立** ⇒ 那是【沒查】不是【沒事】。
```
