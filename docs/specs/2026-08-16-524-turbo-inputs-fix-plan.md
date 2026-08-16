# 給 Sean 批准 · `#524` turbo 沒有 `inputs` ⇒ 改根層設定會 replay 出假綠

> **鐵則 12④(平台設定)觸發,等你點頭才動。** 2026-08-16,A 窗寫。
> ~~**⚠️ §6 刻意留白** —— 在等 E 窗查「還有哪些根層檔屬於這類」~~
> **← 2026-08-16 E 窗量完,§6 已填。** 🔴 而它的結果**與我和主視窗的預期相反**:
> 不是「所有根層檔都盲」——**有反例**(`package.json` 的 `engines`)⇒ 敘述改成**機制句 + 清單句**,見 §6。

---

## 1. 一句話

**「三綠」在某些情況下會給你綠,而程式碼其實是紅的。** 這片是把那個洞補起來。

**什麼情況**:改到 **repo 根層的設定檔**(不在任何 package 資料夾裡的那些)之後。
沒動根層設定時,三綠照常成立 —— **不是三綠一直都不能信。**

---

## 2. 病在哪(座標,可重跑)

```bash
grep -n "globalDependencies\|inputs" turbo.json      # ⇒ 零命中
```
`turbo.json` 三個 task 的定義**逐字**:
```json
"lint":      { "dependsOn": ["^build"] }
"build":     { "dependsOn": ["^build"], "outputs": ["…"], "env": ["…"] }
"typecheck": { "dependsOn": ["^typecheck"], "outputs": [] }
```
**三個都沒有 `inputs`,整份也沒有 `globalDependencies`**
⇒ 走 turbo 預設:input 集合 = **該 package 資料夾內的檔**。**根層的檔不在裡面。**

⚠️ **而「根層的檔不在裡面」只是症狀的一半** —— 真正的機制在 §6-1:
turbo 的**全域**雜湊 `globalCacheInputs.files` 是**空的**,它吃的是四個**解析後的欄位**。
🔴 **先讀 §6-1 再讀本節,否則會得到「所有根層檔都盲」那個【有反例】的結論。**

而決定「這包紅不紅」的東西**就在根層**:
- `apps/admin/tsconfig.json:2` 逐字 `"extends": "../../tsconfig.base.json"`
- `apps/admin/package.json` 的 lint script 逐字 `eslint . --max-warnings 0 --no-error-on-unmatched-pattern`
  ⇒ 往上找到**根層唯一那份** `eslint.config.js`
  (分母:`find . -maxdepth 3 -name "eslint.config.*" -not -path "*/node_modules/*"` ⇒ **1 份**)

## 3. 實錘(2026-08-16;兩個獨立方法,結論相同)

**方法一(A 窗,量行為)** —— 各改一個根層檔,同一刻同一棵樹兩條路各跑一次:

| task | 改的根層檔 | 直跑 | turbo 路徑 | 逐包那行 |
|---|---|---|---|---|
| typecheck | `tsconfig.base.json` | `npx tsc -p apps/admin` **exit 2 / 13 error** | 0 error | `cache hit, replaying logs 53dad03f…` |
| **lint** | `eslint.config.js` | `npx eslint .` **exit 1 / 71 error** | 🔴 **`pnpm lint` exit 0 全綠** | `cache hit, replaying logs 808f63d3…` |
| **build** | `tsconfig.base.json` | `npx next build` **exit 1 / 13 error** | 🔴 **`pnpm build` exit 0 全綠** | `cache hit, replaying logs 3bd53db8…` |

🔴 三個 hash 都與各自「乾淨綠樹」那次**完全相同** ⇒ replay 了綠,而當下真的紅。

**方法二(E 窗,看 hash 組成)**:用 `--dry=json` 直接印 input 集合 ——
三個 task **各 382 個 input、根層命中零**、突變前後 **hash 逐字不變**。

⇒ **一個觀察行為、一個看組成,方法獨立、結論相同。**

### 🔴 一條要換理由的(E 窗更正,結論不變)

我原本寫:「`pnpm typecheck` 第二段 `tsc -p tsconfig.scripts.json` 的 include 逐字 `["scripts/*.ts"]`
⇒ **由設定本身可證** `apps/admin` 的錯抓不到」。
**結論成立,但理由要換**:那一段的實際覆蓋是 `include` **加上 import 的傳遞閉包**
(實錘:那 3 個錯裡有 2 個在 `packages/ports/src/`)。
⇒ **正確的說法**:
- **第一層(turbo)失效是【結構性】的** —— 根層檔不在 input 集合,必定 replay。
- **第二層會不會救你是【看運氣】的** —— 取決於那次的錯有沒有落在傳遞閉包裡。**這次是巧合。**
🔴 **而「看運氣的第二層」不能當防線寫進任何驗收條件。**

---

## 4. 修法選項與各自代價

> 🔴 **「改壞的代價是反向的」展開**:
> **設太窄** ⇒ 假綠照舊(病沒好,而且大家以為好了 —— 比現在更糟,因為現在至少沒人相信它)。
> **設太寬** ⇒ 每次都 cache miss ⇒ turbo 退化成「沒有快取的 turbo」,CI 與本地收工都變慢。
> ⚠️ 兩邊的**回饋速度不對稱**:太寬會**立刻**被抱怨(慢),太窄**永遠不會**被抱怨(綠)。
> **⇒ 預設要偏寬,不要偏窄。**

| 選項 | 做什麼 | 代價 / 風險 |
|---|---|---|
| **甲(建議)** `globalDependencies` | 在 `turbo.json` 加一份**根層檔清單**,任一改動使**所有** task 失效 | 概念最簡單、最難寫錯;**代價**=改任何一個列進去的根層檔 ⇒ 全 repo 重跑。⚠️ 但那些檔本來就**應該**讓全 repo 重跑 |
| **乙** 每個 task 加 `inputs` | 逐 task 列出它真正依賴的東西 | 最精準;**但要逐 task 想對** ⇒ 想漏一個就是同一個病復發,而且**復發時無聲** |
| **丙** 甲 + 乙 | 根層走 `globalDependencies`、package 內走 `inputs` 收窄 | 效果最好、**維護面最大**;每加一個 package 都要重想一次 |
| **丁** 不修,只留判準 | 靠人記得「改過根層設定後 turbo 的綠不算數」 | 🔴 **不建議** —— 這正是 `#524` 條目裡「靠人回頭看」那類,`feedback_writing-down-a-gap-is-not-closing-it` 逐字反對 |

**建議甲** —— 理由:病根是「**根層檔完全不在任何集合裡**」,而甲**直接對著病根**;
乙丙都要求「每一個 task 都想對」,而想漏的症狀是**無聲的假綠**,與病本身同形。

⚠️ **甲的已知不足**:它讓根層改動使**全部** task 失效,**不區分哪個 task 真的依賴那個檔**
(例:改 `eslint.config.js` 也會讓 `typecheck` 重跑)。**那是刻意用效能換正確性,不是疏忽。**

---

## 5. 🔴 怎麼驗修好了 —— **驗收必須是實測,不是「設定看起來對」**

**驗收條款 T-524(三個 task 各一發,缺一不可)**:

```
對每一個 (task, 根層檔) 組合:
  ① 先跑一次讓它 cache hit（確認基準是綠且快取存在）
  ② cp 備份該根層檔 → 改成會讓該 task 紅的內容
  ③ 跑 turbo：🔴 逐包那行必須是 `cache miss, executing`，不是 `cache hit, replaying logs`
  ④ 直跑該工具：必須紅，且【紅在預期那一格】（見下方警告）
  ⑤ 兩者的錯誤內容一致
  ⑥ cp 還原 → shasum 逐字相同 → 兩條路都回綠
```
🔴 **③ 才是驗收本體。** 「turbo 也紅了」**不夠** —— 它可能是別的包紅、或第二段撿到的。
**要看的是那一包的 `cache miss`。**

⚠️ **④ 的警告(2026-08-16 我自己踩過)**:第一版突變把 `eslint.config.js` 改壞,
直跑回 `Unexpected undefined config at user-defined index 6` —— **那不是實驗結果,是突變壞了**。
**若當成「lint 抓到了」,結論會完全相反。**
⇒ **突變之後第一件事是確認「紅在我預期的那一格」,不是「紅了就好」。**

📌 **不接受的驗收方式**:「`turbo.json` 裡有 `globalDependencies` 了」——
那是**設定看起來對**,不是**行為對**。本病的全部特徵就是「看起來對」。

---

## 6. 爆炸半徑 —— **E 窗量完了,而它的結果讓修法方向更清楚**(2026-08-16)

### 6-1 🔴🔴 機制:turbo 的全域雜湊**不吃檔案,吃四個解析後的欄位**

```bash
npx turbo run typecheck --dry=json --filter=@pcm/admin
#   globalCacheInputs.files ⇒ {}（長度 0）
#   其餘鍵 ⇒ rootKey / hashOfExternalDependencies / hashOfInternalDependencies
#            / environmentVariables / engines
```
⇒ **一個根層檔會不會被偵測到,不取決於它是不是根層檔,取決於它的內容有沒有落進那四個欄位。**

### 6-2 逐檔(**不要讀成「所有根層檔都盲」——有反例**)

| 已證盲 | 已證**非**盲 | 未確認 |
|---|---|---|
| `tsconfig.base.json` / `tsconfig.scripts.json` / `eslint.config.js` / `vitest.config.ts` / `pnpm-workspace.yaml` | 🔴 **`package.json` 的 `engines.node`**(`>=22.0.0`→`>=22.1.0` ⇒ hash 變) | `pnpm-lock.yaml`(E 的測法不足:改的是 YAML 註解,而該欄位從**解析後的依賴圖**算 ⇒ **那一發本來就不可能讓它變**)/ `turbo.json`(禁令未測) |

🔴 **「未確認」那兩格是「沒量到」,不是「它沒事」** —— 兩者長得一模一樣而意義相反。

### 6-3 🔴 這對修法方向的影響:**收窄了選項,而不是推翻建議**

- **`globalCacheInputs.files` 是空的** ⇒ **那個空集合就是要填的東西** ⇒ **甲(`globalDependencies`)直接對著病根。**
- **乙(各 task 加 `inputs`)** —— 🔴 **2026-08-16 實測:技術上【做得到】。原本標「未確認」的那半已答。**
  turbo **2.9.7**(`npx turbo --version`;`package.json` devDep 寫 `^2.3.0` ⇒ **文件要對 2.9.7 讀,不是對 2.3**)。
  在 `@pcm/schemas#typecheck` 加 `inputs: ["$TURBO_DEFAULT$", "../../tsconfig.base.json"]`:

  | 量測 | hash | inputs 數 |
  |---|---|---|
  | baseline(無 override) | `cd23416c2038ca43` | 10 |
  | 加 override(檔沒改) | `8f4755ad61ea418a` | **11**,含鍵 `../../tsconfig.base.json` |
  | **再改 `tsconfig.base.json`** | **`2179f98350fe2af4`** | 11 |
  | 🔬 **對照組 `@pcm/ports`(無 override)** | `d8e6697484db3eb9` **前後不變** | — |

  ⇒ **不只「列得進去」,是【真的影響 hash】**;而對照組證明那個變化**來自 override,不是全域**。
  ✅ 還原後 schemas 回到 `cd23416c2038ca43`、inputs 回 10;`turbo.json` 與 `tsconfig.base.json` **shasum 逐字相同**、工作樹零留痕。

  ⚠️ **但「做得到」不等於「該用」** —— 乙仍是繞路:
  每個 package 各寫一份**指向同一批根層檔**的相對路徑,**漏一個的症狀就是同一個無聲假綠**,
  而且新增 package 時**沒有任何東西會提醒你要寫**。
  🔴 **甲把「記得寫」變成「寫一次」;乙把它變成「每次都要記得」** —— 而本病的病根正是「沒人會發現忘了」。
⇒ **§4 的建議(甲)不變,而現在它有結構性理由,不只是我的直覺。**

### 6-4 ⚠️ `vitest.config.ts` 也在已證盲那五個裡,但**它的意義不同**

`pnpm vitest run` **不走 turbo** ⇒ 那裡沒有 replay 在騙人;它只是不影響 turbo 的 hash。
⇒ **不算進「三綠假綠」那一族**,但 `globalDependencies` 的清單**仍應該收它**
(理由:改了它會改變測試判什麼,而 turbo 的 build/typecheck 快取沒有理由跨過那個改動)。
🔴 **這一句是我的判斷,不是 E 量出來的。**

---

## 7. 回歸風險:**估不出來,明寫**

改 `globalDependencies` 之後,**現有 CI 會不會大量 cache miss** ——
🔴 **我估不出來。** 我沒有 CI 的快取命中率數據,也沒查本 repo 的 CI 設定。
**能說的只有形狀**:凡是**清單裡的檔被改動的那一次** push,全部 task 會重跑;
**沒改到清單裡的檔時,行為與現在完全相同。**
⇒ **落地前應該先量一次「這些根層檔多久被改一次」**(`git log --oneline -- <那些檔> | wc -l` 之類),
而**那個量測不在本 plan 內**。

---

## 8. 鐵則 8 / 12 逐字對硬清單

| 鐵則 | 中不中 | 逐字理由 |
|---|---|---|
| **12④**(平台設定)| ✅ **中** | 鐵則 12 逐字列 **CI・env・平台設定**;`turbo.json` 決定整個 monorepo 怎麼跑 |
| **8**(動平台設定)| ✅ **中** | 鐵則 8 逐字「動 next.config・vercel.json・Medusa config・Prisma schema」同類 |
| 8(跨 3+ 檔)| ❓ **未定** | 甲案可能只動 `turbo.json` 一支;乙丙會多。**選項未定 ⇒ 檔數未定** |
| 12①(錢)| ❌ 不中 | 不碰金流 |
| 12②(權限)| ❌ 不中 | 不碰 auth |
| 12③(DB)| ❌ 不中 | 零 migration |
| 12⑥(`packages/ui`)| ❌ 不中 | 不碰 |

⇒ **要你批准 + commit 前必跑 codex 對抗審查。**

## 9. 影響面 / Rollback

- **後台 / 前台 / 客人 / 正式資料庫**:**零影響**(這片只改建置工具的快取判定)。
- **對所有窗**:改完之後,**改到根層檔的那一次**大家會覺得「怎麼變慢了」—— 那是預期行為,要先講。
- **Rollback**:`git revert` 那顆。`turbo.json` 是純設定、無狀態 ⇒ 退掉即刻恢復原行為。
  ⚠️ **退掉之後假綠也跟著回來** —— 所以退之前要先想清楚是「設錯了」還是「不想要正確性」。

## 10. 我沒驗的

1. ~~**爆炸半徑**(§6,等 E 窗)~~ **← 已答,見 §6。**
   ⚠️ 但 §6-2 裡**留下兩格未確認**(`pnpm-lock.yaml` / `turbo.json`)—— 那兩格是「**沒量到**」不是「它沒事」。
2. **回歸風險量化**(§7,估不出來)。
3. **`globalDependencies` 在本 repo 的 turbo 版本上的確切語意** —— 我**沒查 turbo 版本、沒讀它的文件**,
   只知道它是官方提供的機制。**落地前要查版本 + 讀該版文件。**
4. **`sync-engine` / `api` 這些包我沒個別測** —— 三發都打在 `apps/admin`。
   ⚠️ 形狀上它們同病(同一份 `turbo.json`),**但沒有人構造過。**
5. ~~🔴 **turbo 的 `inputs` 能不能用 `../../` 指到 package 目錄外** —— 我沒查、沒測~~
   **← 2026-08-16 已實測,答案是【可以】,見 §6-3。**
   ⚠️ **限度**:只測了 **turbo 2.9.7**、只測 **`typecheck`** task、只測 **`@pcm/schemas`** 一個 package、
   只測 **`tsconfig.base.json`** 一個檔。**`lint` / `build` 與其他 package 沒測。**
   ⚠️ 也**沒測** `inputs` 是否能指到**更上層或 workspace 外**的路徑。
6. **`pnpm-lock.yaml` 與 `turbo.json` 兩格未確認**(§6-2)—— **甲案的清單要不要收它們,取決於那兩格。**

— END —
