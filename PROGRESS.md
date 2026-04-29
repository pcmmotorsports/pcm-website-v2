# PROGRESS.md — PCM Phase 1 重做歷史紀錄

> **角色:** 寫實質進度的歷史檔、不寫流水帳
> **不是 STATUS.md:** STATUS 是「當前狀態」、PROGRESS 是「歷史里程碑」
> **不是 git log:** git log 是 commit 流水、PROGRESS 是「這個 milestone 完成了什麼商業價值」
>
> 衝突仲裁:`STATUS.md` > 本檔 > 對話歷史

---

## 寫法規範

### 何時寫 PROGRESS

- 每個 milestone 結束(M-0 / M-1 / M-2 ...)
- 每個重大里程碑(第一個 slice 跑通 / 第一次 Vercel preview / 第一筆訂單跑通)
- 重大事故 + 修復(避免重複踩坑)
- 重大決策變更(Sean 改方向 → 對應到 docs/decisions/)

### 何時不寫

- 單一 slice 完成(那是 STATUS.md 的事)
- 小 bug 修復(commit message 即可)
- 流水帳(這個檔不是 git log)

### 格式

每筆紀錄含:
1. **日期**(YYYY-MM-DD)
2. **里程碑**(M-? / 重大事件名)
3. **完成了什麼**(商業價值層、不寫技術細節)
4. **技術產出**(slice / commit / PR 編號)
5. **教訓 / 學到的**(若有)

---

## 紀錄

### 2026-04-29 — Phase 1 重做拍板

**里程碑:** Phase 1 v2 啟動

**完成了什麼:**
- Sean 拍板整個重做、新 repo `pcm-website-v2` 從零、舊 repo `pcmmotorsports/pcm-website` 凍結保留
- .md onboarding 套件完成(15 份):STATUS / CLAUDE / lessons-learned / PROJECT-OVERVIEW / PHASE-1-NORTHSTAR / PHASE-2-VISION / working-style / tools-and-skills / decisions/0001 / patterns 三份 / vehicle-service-ecosystem v0.2 / README / PROGRESS / phase-1-backlog
- 規劃方向確定:design-reference 直接搬進 storefront + Medusa schema 對應 design 重建

**技術產出:**
- `docs/decisions/0001-rewrite-decision.md`(完整決策記錄)
- `.md` 套件(`/Users/sean_1/pcm-md-package/`)

**教訓:**
- 第一輪卡住根因 = 「翻譯 design 進 storefront」方向錯
- 「直接搬」與「翻譯」差別:翻譯 = 重新實作、踩 100 個小決策坑;直接搬 = 改插頭規格、不改家具本身
- Sean 04-29 第四次糾正後才完全立此原則(寫進 lessons-learned §0 一句話最重要的事)

**下一步:** 新 repo `pcm-website-v2` init、放 .md 套件、設 design-reference submodule、新 Claude Code 偵察 design + 寫 PRD-rewrite.md

---

<!--
紀錄模板(複製下面整段、填新紀錄):

### YYYY-MM-DD — 里程碑名稱

**里程碑:** M-? / 事件名

**完成了什麼:**
- (商業價值層、不寫技術細節)

**技術產出:**
- slice / commit / PR 編號

**教訓:**(若有)
- (學到的)

---
-->

— END —
