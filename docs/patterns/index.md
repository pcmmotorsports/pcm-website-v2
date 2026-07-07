# Patterns 索引

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **本目錄性質:** 由 `CLAUDE.md` / `AGENTS.md` 路由表**按需引用**(2026-07-03 瘦身後不再常載全文);規則字面以 `CLAUDE.md` / `AGENTS.md` 為準,本目錄僅存細節。
> 命中路由表對應觸發情境才讀對應檔,不通讀全目錄。

---

## 檔案清單

| 檔 | 定位 |
|---|---|
| `general.md` | 通用工程規矩(可移植到任何 project,如檔案大小上限) |
| `pcm-specific.md` | PCM 專屬硬規則(design-reference 真權威等),寫 PCM 程式碼前必讀 |
| `react-nextjs-rules.md` | React 19 hooks / eslint 規則,動 hooks・useEffect 相關 code 時讀 |
| `money-handling.md` | brand type MoneyAmount 守門規範(ADR-0004 Q4=A3 落地),跑金額運算時讀 |
| `slice-checkpoint.md` | 三綠 Checkpoint(typecheck+lint+build)規範,鐵則 11 細節檔 |
| `slice-instruction-six-piece.md` | Slice 指令格式六件套完整規格(Cowork 模式) |
| `codex-review-packet.md` | Codex Review Packet 流程,鐵則 12 細節檔 |
| `codex-inspector-role.md` | 給新 Codex 視窗的「檢查者」角色說明(唯讀審查) |
| `cowork-review-chain.md` | Cowork 五階段對抗審查鏈規範 |

---

## 與其他文件關係

- 想知道「為什麼有這條規則」→ `docs/lessons-learned.md`
- 想知道「具體怎麼做」→ 本目錄
- 想看執行清單/鐵則→ `CLAUDE.md`(Codex 對應 `AGENTS.md`)
- 想看拍板紀錄 → `docs/decisions/`

## 衝突仲裁

`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > `CLAUDE.md` > `docs/decisions/` > `patterns/` > 其他 md > 對話歷史。

— END —
