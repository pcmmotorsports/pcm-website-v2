# 提案:數量詞落筆 hook(草案 v1.1)

> **狀態:草案,未掛。** hook 掛點在 `~/.claude/`(Sean 批准區)⇒ 本檔只到提案,不動 `settings.json`
> 也不動 `~/.claude/hooks/`。起草:E 窗(2026-08-11 晨),交主視窗轉 Sean 拍板。
> 素材:`B-431-STOP §4`(十例)/ D 窗「拿名字找東西」族 / S 窗「同片自打架」族 /
> memory `feedback_guard-effect-depends-on-how-it-is-executed`。
> **v1.1(同日午前)**:①`Stop`/`PostToolUse` 的 stdout 行為**已查證**,原本的「未確認」段換成
> 事實,並連帶查出**兩支既有 hook 是啞的**(§3.1a、Q2 因此改題)②T1 補三個詞(§3.2)
> ③追加 B-433 線兩條素材(§2 四階)。**行數 183 > 派工的 150** —— 超出的全在 v1.1 這三處,要砍請說。

## 0. 一句話

病不是「數錯」,是**寫下數量詞的那一刻,沒有回去對著實物數一遍**。
hook 唯一做得到的事 = **在那一刻把它變成一道當場要交代的門**;它永遠驗不了那個數字對不對。

## 1. 機制優先律:哪部分 hook 做得到

| 要做的事 | 機制做得到嗎 |
|---|---|
| 偵測「這句話帶數量詞 / 全稱詞」 | ✅ 純正規式,零狀態 |
| 要求**同段落**附一條可重現的數法 | ✅ co-presence 檢查 |
| 判斷那條數法**數的是不是正確的東西** | ❌ 只能靠規則文字 + 審查者 |
| 判斷全稱句的**掃描範圍**對不對 | ❌ 同上 |

🔴 **天花板就寫在素材裡**:B-431 §4 第 9 條重數時用 `grep -c "^mutate_and_check"`,
把**函式定義那一行**也算進去 —— **命令貼得出來、數字仍然錯**。
⇒ 本 hook 的效力上限是「逼出一條命令」,不是「保證數字對」。凡宣稱超過這條的都是命名過大。

## 2. 四族素材(各 2-3 例)

**族一 · B 窗「落筆當下沒回去數」(十例的三個階)**
- 一階:偵測器打到自己的輸入 —— 拿 `NO-FINDING` / `Reading additional input from stdin` 當判準,
  兩者都同時存在於自己送出去的 prompt 裡。
- 二階:段落標題「四個退款面各一格」實為兩面,**而且已經轉述給下游**。
- 三階:**用會命中非實例的 pattern 去數**(上面那條 `grep -c`)⇒ 修這一族的途中又製造一例。
- **四階(v1.1 追加,B-433 線 codex R1)**:**「用前提當驗收」在會改變前提的寫入片裡有毒** ——
  回填 migration 的檔尾斷言若在寫入後**重算**前提命中數,合格單一寫進去,「零帳本列」這個前提
  就從真變假 ⇒ **正確的寫入被自己的斷言判成違規**(命中數歸 0、實寫 1)。
  修法=候選集合**寫入前凍結**,檔尾對凍結快照驗、不對 live 狀態重算。
  ⇒ 對本提案的意涵:數量詞的「數法」也有時效 —— 同一條命令在寫入前後數出來的東西不是同一件事。
- 同批 B 又抓到自己一例**假的「構造不出來」**(cash 的 `request_id` 可由 `order_id` 衍生)——
  同族全稱否定句,已在 T1 觸發集內(`不存在` / `做不到` 類);全文見 memory
  `feedback_false-unconstructible-claim-is-worse-than-false-verified`。

**族二 · D 窗「拿名字找東西」**
- `LINE_TIP` 重釘用**錨名**盤 ⇒ 漏掉釘同一個值、但變數叫 `NEWEST_TS` 的那一支;**改用「值」grep 才抓到**。
- `p_items` 的鍵是 `quantity` 不是 `cancelled_quantity` —— 照別支 helper 抄形狀而沒讀契約。
- 4AXIS 判讀「grep 命中皆註解」在甲片剛好不成立:甲片是**經 trigger 間接**動那張表,**文字 grep 全盲**。

**族三 · S 窗「同片自打架」**
- `ProductBreadcrumb` 寫「不是行為改變」= 假,而**同一片**的 `ProductPage.test.tsx` 註解剛好講對 ⇒ 兩處自打架。
- 改了一處「死連結」敘述,**同檔 24 行外**那句沒改。
- `sort-options.ts` 檔頭**原本就有**「兩份清單會出事」的警語,但它講的是另一組清單
  ⇒ **警語存在 ≠ 這個面被守著**。

**族四 · P 窗「執行方式決定守門效力」**
- 同一段 `RAISE`:`psql -f` 逐句 autocommit 下**被滾過去**;包成單一交易才擋得住。
- 驗那條時用 `psql -c`(多句被包成隱式單交易)⇒ 量到「守門有效」、**差點回報審查者講錯**。
- ⇒ 對本提案的直接意涵:**hook 掛在哪個事件,決定它有沒有後果**(見 §3 表)。

**附註 · E 窗自己(同族,列出來免得看起來只有別人在犯)**
- `#363` 登記面把 `CartContext` 記成 2 處、實為 3 —— **守門第一次跑就抓到它作者**。
- 同段散文寫「共 8 處」、實際 9(改了其中一個數字、沒重算總和)。

## 3. 設計

### 3.1 掛哪(三個落筆面,三種能力)

| 事件 | 攔到的落筆面 | 能不能擋 | 現成範本 |
|---|---|---|---|
| `PostToolUse` `Write\|Edit` | 信件 / STATUS / backlog / spec | ❌ 只能提醒(而且**必須走 `additionalContext` JSON**,見 §3.1a) | `contract-sync-reminder.js` |
| `PreToolUse` `Bash` | commit 訊息(heredoc / `-F` 檔) | ✅ `permissionDecision: deny` | `block-commit-verify-bypass.js` |
| `Stop` | **對話裡講給 Sean / 主視窗的話** | ✅ `additionalContext`(續跑)或 `exit 2`(擋停) | `push-state-watch.js` |

🔴 **只有 `Stop` 攔得到對話 prose**,而這一族有相當比例是**先講出去、才寫進檔**
(B-431 §4-7「污染了你和 codex R2 兩個下游的前提」是最貴的一例)。

### 3.1a 🔴 已查證:`exit 0` 的**純 stdout 根本不會被看見**(v1.1 更正,連帶查出兩支既有 hook 是啞的)

官方文件(`code.claude.com/docs/en/hooks`,2026-08-11 親讀)逐字:
> For most events, stdout is written to the debug log but not shown in the transcript.
> The exceptions are `UserPromptSubmit`, `UserPromptExpansion`, and `SessionStart`.

⇒ `Stop` 與 `PostToolUse` 要送話給 Claude,**只有兩條路**:JSON 的
`hookSpecificOutput.additionalContext`,或 `exit 2` 走 stderr(`Stop` 的 exit 2 = 擋停續跑)。

🔴 **本 session 的構造證據**:`contract-sync-reminder.js`(PostToolUse、`docs/specs/*.md` 命中)
的計數器 `$TMPDIR/.claude-contract-sync-254b5555c188`(檔名=本 session id 的 md5 前 12 碼)
**現值 3 = 它自己設的每 session 上限**,而**最後寫入時間 09:36 正是我編輯本檔的時段**
⇒ **它那一刻確實跑了,而我沒收到任何提醒文字**。
⚠️ 誠實界:我只證得到「至少那一次跑了且沒被看見」,**不主張那三次全發生在寫本檔時**
(本 session 跨了昨天,更早的命中可能來自別的 spec 編輯)。
同一批工具回應裡,用 JSON `additionalContext` 送的 ide 診斷與 impeccable 兩支則**每次都看得到**。

⇒ **這兩支 hook 現在是啞的**:`contract-sync-reminder.js`(合約字面守則)與
`push-state-watch.js`(別窗連帶 push 警報)都是 `process.stdout.write(...)` + `exit 0`。
兩支的檔頭都寫著「prose 層擋不住時機型規則、hooks 是唯一 deterministic 層」——
**而它們自己從沒把話送到**。修法是各改一處送出方式(純字串 → `additionalContext` JSON),
但那是動 `~/.claude/hooks/` ⇒ **屬 Sean 批准區,本片不動,列為 §5 Q2**。

### 3.2 觸發字元集(三個 tier,實測見 §4)

- **T1 全稱 / 全稱否定**:`全部` `所有` `每一` `一律` `唯一` `僅有` `只有` `皆` `零命中` `查無` `不存在` `從沒` `一項都` `完全不`
  **+ `做不到` `構造不出來` `不可能`**(v1.1 追加:少了這三個就漏掉「假的構造不出來」那一族,
  而那族有專屬 memory;實測代價=每封 2.4 → **2.6 次**,同量級)
- **T2 數量詞**:`\d+` 緊接 `處|支|條|格|檔|例|欄|筆|次|面|種|版|列|台|組|顆|片`
- **T3** = T1 ∪ T2

### 3.3 要求什麼(同段落內出現任一即放行)

1. 反引號內含數數命令:`grep` / `rg` / `wc -l` / `ls … | wc -l` / `find` / `psql` / `jq` / `awk`
2. `檔案:行號` 形式的引用
3. 明文標記:`未數` / `估` / `未確認`

### 3.4 擋不住什麼(依 `feedback_control-named-beyond-its-actual-power`,命名前先答)

- ❌ **數法數錯東西**(§1 那條 `grep -c`)—— 命令在、數字錯,hook 全綠。
- ❌ **全稱句的範圍錯**:掃了 `apps/admin/` 卻寫成「全樹只有 N 處」,命令貼得出來、範圍是錯的(E 窗 `#363` 實例)。
- ❌ Sean 或別窗**自己在終端機**下的任何動作(hook 只看本 session 的工具呼叫)。
- ❌ **放行標記被當通行證**:一路貼 `未確認` 就永遠不會紅。這條只能靠審查者與規則文字。

## 4. 實測:誤報載量(這份提案自己的數字)

樣本 = `~/pcm-mailbox` 中 mtime 早於 **2026-08-11 09:40** 的最後 20 封 `*-STOP.md`
(`P-358-STOP.md` … `D-469-STOP.md`),段落 437 段(空行切段):

| tier | 觸發段落 | 佔比 | 其中已附數法 | **每封平均會開火** |
|---|---|---|---|---|
| T1 全稱(含 v1.1 追加三詞) | 73 | 17% | 20 | **2.6 次** |
| T2 數量詞 | 66 | 15% | 7 | **3.0 次** |
| T3 聯集 | 124 | 28% | 22 | **5.1 次** |

⚠️ **時間戳是必要的,不是講究**:本節第一版寫「最近 20 封」而沒釘時點,
十分鐘後別窗落了一封新信 ⇒ 視窗滑掉一格、三個數字全變。
釘住 mtime 上限才重現得出來 —— 這正是本提案要擋的那一族。

重現(把 §3.2 的三組正規式餵下去數,不是憑印象):

```bash
cd ~/pcm-mailbox && python3 - <<'PY'
import re,glob,os,datetime
CUT=datetime.datetime(2026,8,11,9,40).timestamp()   # 釘住樣本視窗,否則新信一落就滑掉
CMD=re.compile(r'`[^`]*(?:grep|rg|wc\s+-l|sort|uniq|psql|ls\b|find\b|jq|awk)[^`]*`|`[^`]*:\d+(?:-\d+)?`')
T1=r'全部|所有|每一|一律|唯一|僅有|只有|皆|零命中|查無|不存在|從沒|一項都|完全不|做不到|構造不出來|不可能'
T2=r'\d+\s*(?:處|支|條|格|檔|例|欄|筆|次|面|種|版|列|台|組|顆|片)'
f=sorted([x for x in glob.glob('[A-Z]-*STOP.md') if os.path.getmtime(x)<CUT],key=os.path.getmtime)[-20:]
p=[q for x in f for q in re.split(r'\n\s*\n',open(x,encoding='utf8',errors='replace').read()) if q.strip()]
for n,r in (('T1',T1),('T2',T2),('T3',T1+'|'+T2)):
    h=[q for q in p if re.search(r,q)]; w=[q for q in h if CMD.search(q)]
    print(n,len(h),len(w),round((len(h)-len(w))/len(f),1))
PY
```

🔴 **這組數字直接否掉「全掛 T3」**:每封信開火 5.1 次 = 提醒疲勞,而疲勞的提醒等於沒掛
(`contract-sync-reminder.js` 每 session 上限 3 次,就是為了這個)。

## 5. 給 Sean 的決策題

```
Q1:數量詞 hook 的觸發範圍與掛點,選哪個?
A: A|B|C

A(推薦)= 只掛 T1「全稱句」,三個事件都掛(Write/Edit 提醒、Bash commit 擋、Stop 提醒)。
   理由:全稱句是**一個反例就推翻**的句型,誤報成本低、命中率最高(素材四族裡佔多數);
   每封信平均開火 2.6 次,和現有 hook 同量級。
B = T3 聯集,但只掛 PostToolUse(純提醒、不擋任何工作流),每 session 上限 3 次。
   理由:最保守,絕不影響流程;代價是 commit 訊息與對話 prose 兩個面完全沒守到。
C = 先不掛 hook,只把 §3.3「同段落附數法」寫進 00-work-rules。
   理由:先用規則文字跑一週看復發率;代價=這一族已證明規則文字擋不住(同 push / 合約字面兩條的前科)。
```

```
Q2:§3.1a 查出**既有兩支 hook 是啞的**(純 stdout + exit 0 送不到)。要不要修?
A: A|B|C

A(推薦)= 兩支都改成 hookSpecificOutput.additionalContext(每支動一處送出方式,行為不變只是話送得到)。
   理由:它們是為「時機型規則」而立的,現在等於沒立;而且是**先修既有的、再談要不要新增**。
B = 只修 push-state-watch.js(別窗連帶 push =會動到 origin 的那一支),合約字面那支下次順手。
C = 都先不動,連同 Q1 的新 hook 一起排。
⚠️ 三個選項都動 `~/.claude/hooks/`,屬 Sean 批准區 —— 批了我才動,本片只到提案。
```

— E 窗六代,2026-08-11
