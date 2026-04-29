# Patterns 索引

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **目的:** patterns/ 目錄入口、列出所有 patterns 檔與用途
>
> 配合閱讀:`CLAUDE.md`(自動 @import 本目錄)

---

## 0. patterns/ 是什麼

`patterns/` 收錄**可重用的工程規矩 / 架構原則**、不是教學、是「這個 project 規定就這樣做」的硬規則。

每份 patterns 檔要可以**獨立讀懂**、不依賴其他檔。CLAUDE.md 用 `@import` 自動載入、Claude Code 進 session 即吸收。

---

## 1. 檔案清單

| 檔 | 涵蓋 | 何時讀 |
|---|---|---|
| **`general.md`** | 通用工程規矩(可移植到任何 project) | 第一天讀完套件後讀 |
| **`pcm-specific.md`** | PCM 專屬規矩(B2B2C 架構、tier-aware UI、業務邏輯) | 寫任何 PCM 程式碼前讀 |

---

## 2. 增添新 patterns 規則

### 2.1 何時新增

當以下情境出現、考慮寫進 patterns:

- **重複踩同一個坑** — 第一輪某個錯誤類型出現 2+ 次(例:str_replace CJK 失敗)、寫進 patterns 防再犯
- **跨 slice 共用的決策** — 不只一個 slice 用到的規則(例:檔案大小硬上限)
- **架構級原則** — 影響全 project 的設計選擇(例:店家用一般網頁看、不開獨立批發頁)
- **環境特性** — Sean / repo 環境的特殊性(例:zsh 禁忌)

### 2.2 何時不新增

- **單一 slice 的局部技巧** — 寫 commit message 即可、不進 patterns
- **臨時 workaround** — 進 backlog、不進 patterns
- **個人偏好** — 不進 patterns、可能違反「為什麼」精神

### 2.3 寫法規範

每條規則必含:

1. **規則本身**(一句話講清楚要做什麼)
2. **為什麼**(具體場景、不修會痛在哪)
3. **範例**(正確 vs 錯誤對比、可直接複製貼上)

---

## 3. patterns 與其他文件關係

| 文件 | 角色 |
|---|---|
| `lessons-learned.md` | 「為什麼有這條規則」(歷史 + 教訓) |
| `patterns/` | 「規則是什麼、怎麼做」(可執行) |
| `CLAUDE.md` | 「總覽 + 自動載入入口」 |
| `decisions/` | 「重大決策的拍板紀錄」(不可改) |

順序:
- 你不確定為什麼要這樣做 → 看 `lessons-learned.md`
- 你想知道具體怎麼做 → 看 `patterns/`
- 你想看執行清單 → 看 `CLAUDE.md`
- 你想看誰拍板的 → 看 `decisions/`

---

## 4. 衝突仲裁

`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > `CLAUDE.md` > `decisions/` > `patterns/` > 其他 md > 對話歷史。

patterns 與其他 md 衝突時、其他 md 為準(因為 patterns 是「通用規矩」、其他 md 是「特定 project 的具體決策」)。

— END —
