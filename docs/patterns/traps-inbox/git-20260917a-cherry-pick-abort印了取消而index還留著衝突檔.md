# ⟦git-ABORTLEAVESINDEX⟧ `cherry-pick --abort` 印了「已取消」,而 index 還留著衝突檔 —— 而撞到的是別人

> 🔴 **寫這一則的是主視窗,因為【上游那一半只有我看見過】。** 下游那一半由前台窗
> (`/Users/sean_1/pcm-shop`)提供逐字,標在下面。兩半合起來才是完整的一次。
> ⚠️ 前台窗自己判斷不由它寫:核心那句它只能標「轉述,未核」,而那正是整則的重點。

## 現場(2026-09-17 14:1x,主樹 `/Users/sean_1/pcm-website-v2`)

主視窗要從設計窗的分支挑一顆純文案 commit,而那顆坐在一片**被 Sean 擱置**的功能上面:

```
git cherry-pick --no-commit 7640874b6
⇒ CONFLICT (content): apps/admin/src/components/home-banners/home-banner-editor.tsx

git cherry-pick --abort          ← 🔴 它【印了取消】
git status --short
⇒ DU apps/admin/src/components/home-banners/home-banner-editor-copy.test.ts
   UU apps/admin/src/components/home-banners/home-banner-editor.tsx     ← **還在**

git reset --hard HEAD && git clean -fd apps/admin/src/components/home-banners/
⇒ 這一步跑完主樹才真的乾淨
```

📌 **`--abort` 的回報與 index 的實況不一致。** 而中間那段時間,主樹的 index 帶著
兩支**不屬於任何人**的檔案。

## 下游長什麼樣(前台窗提供,逐字)

```
· 我 git add <我的一支 .md> 然後 git commit -F <訊息檔>
· 閘擋下,逐字:「這顆 commit 沒有 pathspec,而它會帶走【不是你放進去的】檔案」
  點名 apps/admin/src/components/home-banners/home-banner-editor-copy.test.ts
       apps/admin/src/components/home-banners/home-banner-editor.tsx
· 我改成 git commit -F <訊息檔> -- <精確路徑> ⇒ 過,且沒碰那兩支
· 🔴 事後 git status 乾淨、git diff --cached --name-only 空
  ⇒ 我當下分不出是「閘讀到別處的 index」還是「當下真的有、後來被收走」
  ⇒ 我標了「推論,未核」
```

## 病灶 —— 不是 git 壞了,是**兩個系統各自在回答**

**上游**說「我取消了」,**下游**看到的是 index 的實況。兩者之間沒有人對帳。
⇒ 下游撞到的是**一個沒有人承認的檔**,而它在 `git status` 上與
**「有人正在做事」長得一模一樣** —— 那是要等的,不是要清的。兩者的處置相反。

🎯 **而前台窗差點去問兩個無關的窗。** 分辨器不是看檔案,是**問上游一句**。
今天問了一句就結案。

## 判別句

> **在共用樹上跑任何會產生衝突的動作之前,先問:如果它撞了,別人會看到什麼?**

## 照做的三步

1. **共用樹不要試挑、不要試合。** 要預演去拋棄式 worktree,或**直接請寫的人出乾淨分支**
   (本次最後就是這樣做的 —— 只是順序反了,先弄髒才想到)。
2. **真的在共用樹撞了**:`--abort` 之後**一定要再跑一次 `git status --short`**。
   ⚠️ 只看 `--abort` 的輸出 = 只看上游的自述。
3. **撞到「不是我放的檔」**:📌 **問上游一句,不要展開調查。**
   全域事件由主視窗單一查證(2026-08-30 實測:五個窗各查一輪,五份結論一模一樣)。

## 🛑 這一則答不出什麼

- **`--abort` 那個行為是【單一次觀察】,沒有重跑過。** 前台窗提議在拋棄式 worktree
  造同形狀的衝突實測一次 —— **主視窗當時裁定不做**(那是造量測裝置,不是產品工作)。
  ⇒ **所以「`--abort` 一定會留下」是推論,未核。** 已知的只有「這一次留下了」。
  真要證,起點是那個提議。
- 沒有查過 `git merge --abort` / `rebase --abort` 有沒有同一個形狀。**未查,不是 0。**
- 沒有查過那道 pathspec 閘讀的是哪一份 index(worktree 各自的,還是 `$GIT_DIR`)。
  ⇒ 本則不主張它「讀到別處的 index」—— 本次的成因是**主樹 index 真的有那兩支**,
  而那是另一個問題的答案,不是這一個的。
