## 合併中 `git checkout HEAD -- <檔>` 蓋掉 merge 帶進來的版本 —— 而它全綠〔安靜〕

**線** `-ship` 2026-09-06 · `⟦5b-SHIPPEDNUMNOTRECORDED1⟧` merge · **自述**

### 事情
合併進行中(`MERGE_HEAD` 還在), 我為了丟掉**自己一份重複的修改**跑了
`git checkout HEAD -- scripts/migration-static-checks.sh`。
🔴 **而合併中的 `HEAD` 是【合併前】那一顆** ⇒ 那一發把 `origin/dev` 帶進來的版本蓋掉,
接著 merge commit **把舊版當成合併結果提交出去**。
被刪的是別條線 2026-09-05 加的 selftest 四格(41 行):
```
selftest 總數  45 → 41      而它照樣印「✅ 全過」
規則本體       還在          ⇒ 閘照舊會擋 ⇒ 沒有任何人會發現
```

### 🎯 母題
**一個「還原」動作與一個「刪除」動作, 在 diff 上與在畫面上都長得一樣。**
而合併放大了它:merge commit 的 diff **本來就會很大**, 一支被降級的檔混在裡面沒有形狀。

### ✅ 判別句
> **合併中我要還原一個檔 —— 我要的是合併【前】那一版, 還是合併【後】應有的那一版?**

· 要丟掉**自己**那一半 ⇒ `git checkout --theirs -- <檔>` 或 `git checkout MERGE_HEAD -- <檔>`
· `git checkout HEAD -- <檔>` 在合併中的意思是「**回到我合併之前的樣子**」—— 幾乎永遠不是你要的
⚠️ **而我不是在解衝突** —— 那支檔**沒有衝突**, 我是「順手把它還原」。
⇒ 📌 **沒有衝突的檔沒有任何提示**;git 不會問、hook 不會叫、測試不會紅。

### 🔵 怎麼在事後抓到它(我就是這樣抓到的)
```
git diff --numstat origin/dev HEAD | awk '$2>0'     ← 我這邊【比 dev 少】的行
```
合併之後你的分支對 dev 應該**只有 +N/−0**(除非你真的改了它們)。
**任何 `−N` 都是一次要解釋的事。** 我那一發:其餘檔全是 `+N/−0`, 只有那一支 `−11/+…`。

### 🛑 與近親的差別(`traps-neighbours.py` 前 6 名, 逐條開過)
| 近親 | 它講的 | 為什麼不同族 |
|---|---|---|
| `mutation-restore-scope-git-checkout-wipes-uncommitted-edits`(0.41) | 突變還原用 checkout 會抹掉**未 commit 的編輯** | 它的受害者是**我自己還沒存的東西**;本條的受害者是**已經 commit、由 merge 帶進來的別人的東西** |
| `inbox/D-20260822`「`git checkout --` 拿的是 index 不是 HEAD」(0.40) | **省略 treeish** 時的來源 | 本條**寫了** treeish, 而那個 treeish 在合併中換了意思 |
| `aligning-to-origin-discards-my-unmerged-work`(0.39) | `checkout origin/dev --` 銷毀**我自己**還沒被合的改動 | 🎯 **本條是它的鏡像**:`checkout HEAD --` 銷毀**別人**已經合進來的改動。兩條合起來才是完整的那句:**合併中的每一個 treeish 都指著一個【不是你以為的】時點。** |
| `T2-20260818`「checkout 對還沒 commit 的檔是毀損」(0.35) | 未 commit | 同上, 受詞不同 |
