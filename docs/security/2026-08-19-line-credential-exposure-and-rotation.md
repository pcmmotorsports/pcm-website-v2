# 2026-08-19 · LINE 憑證洩漏至 session transcript —— 事件與**結案**紀錄

> **為什麼要有這一份**:事件本身先前**只存在於信箱與對話**(`git grep` 查無),
> 而**處置完成的紀錄一份都沒有**。
> 🔴 **日後稽核只查得到事件、查不到結案 ⇒ 看起來像沒處理。**
> ⇒ 本檔的重點是**下半**(已處置),上半只是為了讓下半有對象。

---

## 1 · 事件(第一手 —— 造成它的就是寫這份檔的窗)

**做了什麼**:W2 為了查「LINE channel 建好了沒」,跑了一發探索式 `grep`,
而參數帶了 `--include='*.env*'` ⇒ **把 `apps/storefront/.env.local` 的內容拉進了該 session 的 transcript**,
其中包含 LINE 的 channel secret 與 access token(**本檔不重貼任何值,連前幾碼也不貼**)。

**違反**:`CLAUDE.md` Server 端鐵則逐字「敏感資訊 → `.env.local` only、絕不提交 git、**絕不貼對話**」。

## 2 · 血量(第一手,可重跑)

```
git check-ignore -v apps/storefront/.env.local            ⇒ .gitignore:91 命中
git ls-files --error-unmatch apps/storefront/.env.local   ⇒ 非零(從未被 track)
git log --all -- apps/storefront/.env.local               ⇒ 零輸出
```
⇒ **未進 git、未進任何分支。曝光面 = 該 session 的 transcript。**

## 3 · ✅ 處置(**這一節是本檔存在的理由**)

**Sean 2026-08-19 已輪替該組憑證。**
```
範圍:兩個 Vercel 專案 + 本機
驗證:兩側【實走驗證過】—— 顧客站登入成功;報價單側 Sean 回「正常」
```
⚠️ **證據等級:二手。** 上面這段由主視窗轉述,**本窗未自行驗證**
(本窗無 Vercel 專案寫入權,亦**不應**再去讀那個檔 —— 見下節)。
⇒ 要升級成實查:`vercel env ls production` 只看得到**名稱**、看不到值 ⇒
**「有沒有換過」在 repo 這一側結構上量不到**,只能看兩側登入是否仍成功。

## 4 · 🔴 這條線到此為止(給下一個人)

**不要為了「確認一下」再去讀 `apps/storefront/.env.local`。**
確認輪替成功的方式是**兩側登入仍正常**,不是再看一次值 ——
**再讀一次只會把同一組值再複製到一份新的 transcript 裡。**
📎 同族:memory `feedback_the-warning-can-reproduce-the-hazard`
(**為了論證某個東西危險而寫下的證據,本身就複製了那個危險**)。

## 5 · 📌 可機械化的教訓(比「別碰 .env」硬)

> **先問:這個問題要不要讀到【值】?**
> 不要 ⇒ 用 `ls` / `test -e` / `grep -l`(**只列檔名**),不要 `grep` 內容。

當天要回答的是「**有沒有設定痕跡**」,而**檔名就足以回答** —— 根本不需要內容。
🔴 這條**擋得住下一個不叫 `.env` 的秘密檔**,而「別碰 `.env`」擋不住。
📎 已收進 `docs/patterns/guard-and-instrument-traps.md` 同族條目。
