# Runbook · 重新生成 `database.types.ts`(**不是一行指令**)

> 建立 2026-08-19 · G2 · 起因=`#20` 上下架片 apply 之後需要重 gen,而一次天真的重 gen
> **會同時做三件壞事**:沖掉中文檔頭 / 沖掉手動校正 / 刪掉一段還在用的型別。
>
> 🔴 **本檔的每一個數字都要你【當場重跑】才算數** —— 下面每一步都附了命令。
> **不要信本檔寫的數字,信你跑出來的。**(本檔自己的數字量於 2026-08-19 09:4x。)

---

## 0. 🔴 先決定:**這一次到底要不要 gen**

```
要 gen 的唯一理由 = 有一支【新 apply 的 migration】帶來了 code 要用的型別
⇒ 而「順手更新一下」不是理由 —— 每一次 gen 都要付下面整份的成本
```

**先確認那支東西真的在正式庫**(而不是只在 `APPLIED.tsv` 上):
```bash
supabase gen types typescript --project-id bmpnplmnldofgaohnaok > /tmp/gen-live.ts
grep -c '<你要的函式名>' /tmp/gen-live.ts        # 期望 ≥1
grep -c 'admin_initiate_order_refund' /tmp/gen-live.ts   # 🔴 正向對照，期望 1（證明尺會動）
```
⚠️ **沒有正向對照的那個 0,與「函式恆不生成」在觀察上不可分辨。**

---

## 1. 🔴 第一步:**自己數一次手動校正有幾處**(不要信任何人寫的數字,包括檔頭)

檔頭第 2 行宣稱「**十一個函式、共二十七處**」。**當場重數**:
```bash
python3 - <<'PY'
import io,re
s=io.open('packages/adapters/src/supabase/database.types.ts',encoding='utf-8').read()
items=[l for l in s.split('\n') if re.match(r'^//\s*[①-⑳]', l)]
cn={'一':1,'二':2,'三':3,'四':4,'五':5,'兩':2}
rows=[]
for l in items:
    m=re.search(r'`([^`]+)`\s*\*{0,2}([一二三四五兩])處', l)
    if m: rows.append((m.group(1), cn[m.group(2)]))
print(f'條目 {len(rows)} 個，處數合計 {sum(c for _,c in rows)}')
for n,c in rows: print(f'  {n:46s} {c}')
PY
```
📌 2026-08-19 G2 跑出來 = **11 個函式、27 處**,與檔頭一致。
⚠️ **而我第一版的尺只抓到 4 條**(正則要求 `**N處**` 粗體,而有些條目沒加粗)⇒ **回 4 就是尺壞了,不是檔頭錯。**

---

## 2. 🔴 保護那 27 處的方法:**不是「記得貼回去」,是 diff**

**「逐一貼回 27 處」是提醒,而提醒治不好這種事。** 可執行的形狀:
```bash
cp packages/adapters/src/supabase/database.types.ts /tmp/types-before.ts
supabase gen types typescript --project-id bmpnplmnldofgaohnaok \
  > packages/adapters/src/supabase/database.types.ts

# 🔴 現在【機械】列出：舊檔有而新檔沒有的每一個 `| null`
diff <(grep -nE '\| null' /tmp/types-before.ts | sed 's/^[0-9]*://') \
     <(grep -nE '\| null' packages/adapters/src/supabase/database.types.ts | sed 's/^[0-9]*://') \
  | grep '^<'
# 期望：印出的每一行，都要在新檔裡被手動補回去
# 🔴 而它印完之後【再跑一次】，期望這次是空的 ⇒ 空 = 27 處都補回來了
```
✅ **這一發在兩個世界印不同的東西**:漏補 ⇒ 有輸出;補完 ⇒ 空。
⚠️ 中文檔頭也一起被沖掉 ⇒ 從 `/tmp/types-before.ts` 把檔頭整段貼回(它就是 `export type Json` 之前那一段)。

---

## 3. 🔴 `admin_search_customers` 那個地雷:**判別句,不是「先比對再刪」**

檔頭曾警告:「它在正式庫**還不存在** ⇒ **現在重 gen 不會產生它** ⇒ apply 之後重 gen 時**先比對再刪那一段**」。

⚠️ **那句話 2026-08-19 已經反轉**(G2 實查:live 輸出 `:3275` 有 `admin_search_customers`)。
🔴 **而不要照抄這個結論 —— 照抄下面這個檢查**:
```bash
grep -c 'admin_search_customers' /tmp/gen-live.ts
```
```
回 ≥1 ⇒ 正式庫【有】它 ⇒ gen 會自己生成 ⇒ **什麼都不用做**
回 0  ⇒ 正式庫【沒有】它 ⇒ gen 會把它刪掉 ⇒ 🔴 **從 /tmp/types-before.ts 把那一段貼回來**
        （理由：repo 裡有 code 在用它，而它生不回來）
```
📌 **為什麼給檢查不給結論**:下一次它可能又反轉回去(有人 revert、有人開新環境)——
**而檢查在兩個世界都有判別力,結論沒有。**

---

## 4. 收尾三綠

```bash
TURBO_FORCE=1 pnpm typecheck && TURBO_FORCE=1 pnpm lint && TURBO_FORCE=1 pnpm test
```
🔴 **`typecheck` 紅在「某某型別不見了」⇒ 回頭看第 2 或第 3 步,不要去改用它的那支 code。**

---

## 5. ⚠️ Open question:**這條指令憑什麼跑得動,我們不知道**

```
2026-08-19 G2 實測（三個位置都查了，只查存在性、沒印任何值）：
  ~/.supabase/access-token                    ⇒ 不存在
  ~/Library/Application Support/supabase/…    ⇒ 不存在
  SUPABASE_ACCESS_TOKEN 環境變數               ⇒ 沒設
🔴 而 `supabase gen types typescript --project-id bmpnplmnldofgaohnaok` **照樣跑出 3,833 行**
```
⇒ **代表有一條我們沒看見的授權路徑,而任何人在這台機器上都走得通。**
⚠️ **這不擋任何人,所以本檔不叫你去追它** —— 而它是一個**沒有人決定過的可達性**,記在這裡。
🔴 **若有人追出它讀的是某個殘留憑證檔 ⇒ 那一刻就變成安全面的事,立刻回報主視窗。**

---

## 6. 誠實邊界

```
· 本檔的步驟【沒有被完整執行過一次】—— 第 2 步的 diff 形狀是設計出來的，不是跑過的
  ⇒ 🔴 第一個照它做的人，請把「跑起來像不像這樣」寫回本檔
· 「27 處」我獨立數過（見 §1），而【那 27 處逐一是不是還必要】我沒有查
· gen 出來的 3,833 行 vs repo 現行 4,234 行（差 401 行）⇒ 那個差是「手動校正 + 中文檔頭 + 註解」
  而我【沒有逐行分解那 401 行】⇒ 不要把它讀成「401 行都是手動校正」
```
