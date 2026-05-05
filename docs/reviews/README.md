# Audit Reviews

> **角色:** 每次 skill audit 跑完後留 findings 快照。
> **不是 commit log:** commit message 引用 finding ID、reader 撈不回完整內容、本目錄補完整 finding 內容。
> **不是 backlog:** backlog 是「待做」、本目錄是「audit 歷史紀錄」。

---

## 命名規範

`{milestone}-audit-{YYYY-MM-DD}.md`

例:`M-1-03-prep-audit-2026-05-05.md`

---

## 何時建

每次跑雙輪 skill audit(`engineering:code-review` + `simplify`)後、follow-up commit 前建立。

提前到 follow-up 第一個 commit 落地、後續 follow-up commits 即可在 commit body 精準引用 `docs/reviews/{file}.md F{N}` 給未來 reader 反查。

---

## 內容必含

1. **Audit metadata**:日期 / 範圍 / 來源 commit / 用過的 skills / Sean 拍板 timeline
2. **Round 1 / Round 2 findings 完整內容**:不只 finding ID + 一句話、要含程式碼位置 + 建議
3. **互補 vs 重疊分析**:雙輪零重疊 vs 同議題多視角命中
4. **三類分流**:立即修 / 進 backlog / 進 lessons-learned / 不改
5. **Sean 拍板紀錄**:audit 期間 + 分流拍板 + reality check 拍板
6. **follow-up commits 對應表**:件 → 內容 → 對應 finding(commit hash 不寫死、用 git log subject 撈)
7. **發現偏離(reality check)**:本 follow-up 期間抓出的 Claude.ai 指令字面 vs 實況偏離

---

## 索引

| 檔名 | Audit 範圍 | 日期 | findings |
|---|---|---|---|
| [M-1-03-prep-audit-2026-05-05.md](./M-1-03-prep-audit-2026-05-05.md) | M-1-03-prep 件 #3 + 件 #4(4 .ts 檔) | 2026-05-05 | 21 條(F1-F21、去重 18 unique) |

— END —
