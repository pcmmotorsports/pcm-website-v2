# 突變 harness 的「還原」怎麼寫才不會被殺掉

> **來源**:2026-08-16 A 窗實錘 —— 一份**被突變的 migration 被 commit 進正式分支**(`02dd510e`,修在 `e37fbea5`)。
> **本檔要回答的那一刻**:「我要跑一支**會改檔案**的腳本」。

---

## 1. 病灶不是「忘了還原」,是「用一個會殺掉還原的方式跑它」

```bash
bash mutation-harness.sh 2>&1 | head -2
```

`head -2` 讀完兩行就關掉 pipe ⇒ 上游收到 **SIGPIPE** ⇒ 腳本**死在「已套用突變、還沒還原」那一刻**。
那份被突變的檔就留在工作區,而**接下來的 `git add` 會把它一起帶走**。

🔴 **`| head` 是每個人每天都在打的東西。** 這不是紀律問題,是**工具組合**問題 ——
所以修法不能是「記得不要接 head」。

---

## 2. 🔴 只掛 `EXIT` 是不夠的(第一版修法就是這樣壞的)

```bash
trap restore EXIT          # ❌ SIGPIPE 的預設動作是終止行程，EXIT trap 不會跑
```

**實測**:掛 `EXIT` 之後再跑一次 `| head -2`,檔案**照樣是髒的**(量到的數字是 2,應為 3)。

```bash
trap restore EXIT INT TERM HUP PIPE    # ✅ 訊號要逐個掛
```

---

## 3. 可複製的範本

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET=path/to/file-under-mutation
BASE=/tmp/$(basename "$TARGET").base
SHA=/tmp/$(basename "$TARGET").sha

# 🔴 基準【當場照】—— 不要沿用上一次留在 /tmp 的那份。
#    （2026-08-16 另一次實錘：沿用舊基準的腳本把「後來新加的斷言」一起還原掉，
#      而那一輪「三發全紅」根本沒測到新斷言。）
cp "$TARGET" "$BASE"
shasum -a 256 "$TARGET" | cut -c1-16 > "$SHA"

restore_and_verify () {
  cp "$BASE" "$TARGET"
  local now; now=$(shasum -a 256 "$TARGET" | cut -c1-16)
  # 🔴 驗【結果】不是驗「cp 跑了」—— cp 的 exit 0 不等於內容回來了。
  if [ "$now" != "$(cat "$SHA")" ]; then
    echo "❌❌ 還原失敗：現在 $now，基準 $(cat "$SHA") —— 檔案是髒的，不要 commit"
  else
    echo "✅ 還原已驗（shasum $now）"
  fi
}
trap restore_and_verify EXIT INT TERM HUP PIPE

# ── 每一輪：M0 基準必跑 ──────────────────────────────────────────────
# 🔴 先跑一發【沒有突變】的，確認它是綠的。
#    沒有這一發，「斷言本身壞掉」會被讀成「突變成功」——
#    2026-08-16 我的判序斷言用了 POSIX 非貪婪正規式而整段吃到底，
#    基準就紅，而那一發是唯一救得了我的東西。
run_case "M0 基準（未突變，應綠）"

# 每一發突變：anchor 必須命中，否則停 —— 沒進去的突變會製造假的「沒有判別力」
apply_mutation () {
  python3 - "$TARGET" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
a="<被突變的字面>"
assert a in s, "突變 anchor 沒對上 —— 停，紅綠都不算數"
open(p,'w',encoding='utf-8').write(s.replace(a,"<突變後>",1))
PY
}
```

### 三條硬性的自檢

| 問題 | 答不出來就是壞的 |
|---|---|
| **基準是什麼時候照的?** | 必須是**本次開跑當下**,不是沿用 `/tmp` 裡上一次那份 |
| **突變真的進去了嗎?** | `assert anchor in s` —— 沒命中要停,不是靜默跳過 |
| **還原之後我驗的是什麼?** | **shasum 相同**,不是「`cp` 的 exit code 是 0」 |

---

## 4. 📋 2026-08-16 掃描結果(方法與限度都寫在下面)

### 題1:repo 裡有沒有「把會改檔的腳本接進 pipe」的用法?

```bash
grep -rnE "(bash|sh|\./)[^|]*\.(sh)[^|]*\|[[:space:]]*(head|grep -q|tail|sed -n '1)" \
  scripts/ docs/ .github/ .husky/
```
⇒ **零命中。**

🔴 **而零命中的意思不是「沒有風險」** —— 它的意思是**這個風險不住在 repo 裡,住在我們臨時打的指令裡**。
我那次就是臨時打的,repo 裡從來沒有那一行。
⇒ **所以本檔的讀者是【要跑腳本的那個人】,不是【要改 repo 的那個人】。**

### 題2:有 `trap` 但沒掛 `PIPE` 的腳本

```
腳本總數 100 ／ 有 trap 的 60 ／ trap 含 PIPE 的 20
```
其中 **trap 做的是「還原檔案」**(= 會被 commit 進去的那種)只有 **1 支**:

| 檔案 | trap | 做什麼 | 風險 |
|---|---|---|---|
| `scripts/e13-slice1a-verify.sh` | `cleanup` (EXIT 系,無 PIPE) | `cp "$BASE" "$MIG"` | 🔴 **與我踩的完全同型** |

其餘 39 支的 trap 做的是**拆叢集 / 還原 DB 狀態**(`pg_ctl stop`、`psql -f base-def.txt`),
被殺掉的後果是**留下一個髒的拋棄式叢集**,不是**留下一個髒的檔案**。
⚠️ **那仍然是風險**(下一輪跑在污染環境上、每一發都看起來正常),只是**不會被 commit**。

### ⚠️ 這份掃描守不住什麼

1. **只掃 `scripts/` 與 `docs/probes/`**,別的目錄沒掃。
2. **靠 `trap` 這個字面** —— 用別種方式做清理的(例如把還原寫在最後一行)一律看不到,
   **而那種其實更脆弱**(任何提早退出都會跳過它)。
3. **只看第一個 `trap`**:一支腳本掛多個 trap 時,後面那些沒被分類。
4. **分類「還原檔案 vs 拆叢集」是靠函式主體裡有沒有 `cp`/`mv`/`git checkout`** ——
   換個寫法就漏掉。**我用逐支開檔複核過那幾支名字像還原的**(`restore_base` 四支實際是 psql 還原 DB,
   不是檔案),但**沒有逐支開完 60 支**。

---

## 5. 判別句

> **我現在要跑的這支腳本,如果在中間被殺掉,會留下什麼?**
> 留下**檔案** ⇒ 它會被 commit ⇒ `trap … EXIT INT TERM HUP PIPE` + shasum 驗還原。
> 留下**叢集/DB 狀態** ⇒ 下一輪會跑在污染環境上 ⇒ 一樣要 trap,但症狀不同(每一發都看起來正常)。

> **而「我有還原機制」不等於「還原會跑到」** —— 這兩件事今晚各壞過一次。
