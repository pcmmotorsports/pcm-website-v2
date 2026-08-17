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
| `codex-review-packet.md` | Codex Review Packet 流程(歷史備查;2026-07-21 起鐵則 12 改直呼 codex CLI) |
| `codex-inspector-role.md` | 給新 Codex 視窗的「檢查者」角色說明(唯讀審查) |
| `cowork-review-chain.md` | Cowork 五階段對抗審查鏈規範 |
| `guard-and-instrument-traps.md` | **守門與量具的坑**(恆綠格 / 紅錯地方 / 一發紅多格 / 恆紅閘 / 掃描字集太窄 / 證據可不可重跑 / `cd` 改作用域 / 「共 N 處」重數還是錯 / 折出假的守門)。**條目數不寫在標題裡**——帶數字的標題沒有人會回頭改。**寫完守門要說「已驗證」之前、下全稱句之前、審別人驗收表之前**各查一次;每條附 2026-08-14 當天實例 + `檔案:行號` |
| `pagination-loop-review.md` | **分頁迴圈五條準則**(頁大小嚴格小於 `db-max-rows` / `.range()` 兩端皆含 / 中途失敗要 throw 不得 break / `count` 不當終止判準 / 排序帶唯一鍵)+ **repo 內那個比五條高一級的範本**(空頁終止 + 實得游標 ⇒ 對 `db-max-rows` 調小**免疫**,把第 1 條整個解耦掉)+ 錢族那把刀(「漏一筆+多一筆會不會剛好對上」)。**審或寫任何 `.range()`・翻頁迴圈之前讀**。🔴 檔頭有**證據等級聲明**:原始全文已隨 session 消失,本檔是轉錄版 —— **引用前先讀那一段** |
| `revoking-function-execute-in-supabase.md` | 🔴 **檔名寫 function,實際涵蓋【表 / view / 函式】三者** —— 找建表注意事項的人不要因為檔名走開。**新建任何 DB 物件之前讀**:新物件出生就自帶 `anon` 權限(表是整套寫權含 `TRUNCATE`、函式是 `EXECUTE`),而**那個授權在 repo 裡沒有 `GRANT` 語句可以被掃到、三綠也不會紅**。含兩道 REVOKE、`TRUNCATE` 不受 RLS 管、`has_*_privilege` 對欄級授權少報、ACL 欄是 `NULL` 時 PUBLIC 看不見、改參數型別會多出一支而舊的不會消失 |

---

## 與其他文件關係

- 想知道「為什麼有這條規則」→ `docs/lessons-learned.md`
- 想知道「具體怎麼做」→ 本目錄
- 想看執行清單/鐵則→ `CLAUDE.md`(Codex 對應 `AGENTS.md`)
- 想看拍板紀錄 → `docs/decisions/`

## 衝突仲裁

- **`stalled-line-triage.md`** —— 一條線停住了,先分型再動手。
  **觸發時機不是情境是【時刻】:在你說「那要開線」之前。**
  三型:甲沒有落點 / 乙結論住錯地方 / 丙照拍板在等;**丙型誤判 = 推翻當事人自己的拍板**。

`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > `CLAUDE.md` > `docs/decisions/` > `patterns/` > 其他 md > 對話歷史。

— END —
