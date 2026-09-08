---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React / Next.js 規則(**`paths:` 試點** · `tidy` 2026-09-08)

> 🔬 **這一支是試點, 不是定案。** 它在驗一件事:`.claude/rules/*.md` 的 `paths:` 前綴
> **到底會不會條件載入**。官方文件說會(`code.claude.com/docs/en/memory.md` 的
> "Path-specific rules" 逐字:"These conditional rules only apply when Claude is
> working with files matching the specified patterns.")—— 而**文件說會**與**這台機器上真的會**
> 是兩個宣稱。
>
> 🔴 **識別字串(給驗的人用)**:`PATHSPROBE-K7Q4-REACTRULES-LOADED`
> 　 建立時全 repo 命中 **0 檔**(⚪ 正對照:同尺找 `rules-of-hooks` ⇒ 17 檔 ⇒ 尺是活的)。
>
> 🛑 **驗收要兩個方向, 缺一不算**:
> 　① 開一支 `.tsx` ⇒ `/context` **看得到**那個識別字串
> 　⚪ ② 開一支 `.md` 或 `.sql` ⇒ `/context` **看不到**它
> 　🔴 **只驗①是恆真守門** —— 官方逐字「Rules without a `paths` field are loaded
> 　　 unconditionally」⇒ 若 `paths` 沒被解析, 它會【無條件載入】而①照樣過。
>
> 📌 **正本仍在 `docs/patterns/react-nextjs-rules.md`(路由表指著它)。**
> 　 本支是**逐字副本**, 刻意不刪正本 ⇒ 🔴 **而那表示現在有兩份、會漂**。
> 　 ⇒ **試點通過之後要立刻收斂成一份**(正本改成指標, 或本支改成指標)。
> 　 ⚠️ **在收斂之前, 改規則要改兩處。** 這一句是本試點的**已知代價**, 不是疏漏。

---

<!-- ↓↓ 以下逐字取自 docs/patterns/react-nextjs-rules.md,一個字都沒改 ↓↓ -->

> 2026-07-03 自 CLAUDE.md 本體原文搬出(瘦身、內容零改動)。觸發:動 hooks / eslint 設定 / useEffect 相關 code 時讀本檔。

- **React 19 hooks**:只開兩條 v5 規則(eslint-plugin-react-hooks v7.1.1、M-1-13Z 拍板)— `rules-of-hooks`(error、防條件/loop/nested 內呼叫)+ `exhaustive-deps`(error、防 deps 漏列多列、stale closure 防線)。套用 `apps/storefront/**/*.tsx` + `packages/ui/**/*.tsx`。
  - mount-only useEffect 合法寫法:`}, []);` 上一行 `// eslint-disable-next-line react-hooks/exhaustive-deps` + 內聯註解述意圖;deps 多餘則直接刪(語意正確化、不加 disable)。
  - v7 React Compiler 相關新規則(purity/set-state-in-effect/immutability 等)**未開**、留 follow-up、**見 backlog #168**(別在本檔列舉)。
- **build pass ≠ runtime pass**:`ignoreBuildErrors` 只影響 TypeScript、不影響 ESLint;Vercel build 不跑 ESLint、ESLint 守門靠 CI gate(GitHub Actions)。

<!-- ↑↑ 逐字副本到此 ↑↑ -->

---

## 🛑 而 `paths:` 這個機制的通用陷阱(寫在這裡, 因為下一個要拆規則的人會先讀到這支)

> **綁 `paths:` 之前先問:這條規則的觸發是【檔】還是【事】?**

🔬 **2026-09-08 量到的**:`CLAUDE.md` 路由表 52 列, 真正【檔案觸發】的只有 **4 列(7%)** ——
其餘 48 列是【情境觸發】(「我要查正式庫的一個數字」「板上寫著 open 而我不確定」)⇒ **不對應任何檔案。**

🔴 **而綁錯的代價不是沒效, 是【反向】**。最刺的實例:
```
把「終端機 / Bash 紀律」綁 paths: ["**/*.sh"]
⇒ 在【我編輯 .sh】時載入 —— 而那一段自己寫著「scripts/ 底下跑 zsh 的 0 支」⇒ 那裡不適用
⇒ 在【我在終端機打字】時不載入 —— 而那正是它唯一適用的時刻
```
🛑 **而它三綠全綠、diff 上完全看不出來** —— 那是一個**安靜地在錯的時候載入**的規則。
