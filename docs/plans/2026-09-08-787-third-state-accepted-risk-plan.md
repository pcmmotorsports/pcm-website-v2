# `#787` 封印第三態「已知情接受」—— plan(不寫碼)

> 線【退款】`-refund` 2026-09-08 出;**整件由線【信】`-mail` 移交**(它被 harness 的 deny 擋住,
> 主視窗 A 裁「改路 = 整件移交,由接手的人從頭做含自己的判斷」)。
> **本檔零改碼。**
> 🔴 **鐵則 8**(4 支必改)**+ 鐵則 12①**(錢:人工退款登記入口)⇒ **plan 要 A 批 · codex 不降級 · 不 push。**
> ✅ **方向已拍**:Sean `QB-14` **乙 = 打開那個旗標**;`Q2` **甲 = 在那道測試裡加第三態**。
> ⇒ 📌 **要拍的不是「做不做」,是「怎麼做」。**

## §0 先答「有沒有第二份 plan」

```
graphify query "MANUAL_REFUND_ENTRY_BLOCKED_BY_787" ⇒ 命中全是【碼與測試檔】, 零 plan / 零 spec
graphify query "人工退款 入口 封印"                  ⇒ 指到 backlog #787(docs/phase-1-backlog.md:26050)
graphify query "第三態 已知情接受"                   ⇒ 撈到的是【別件事】的 plan(refund-sync p3)
```
✅ **沒有第二份。**⚠️ 射程只到 repo + 地圖(別的 session 的對話 / 正式庫 / OD 稿掃不到)。

> ### 🔴🔴 而這一節本身踩過一次坑,寫下來(主視窗 A 指定寫進 §0)
> **我的前三發查詢在 worktree 跑,而 `graphify-out/graph.json` 不在那裡 ⇒ 三發全空;**
> **而我的正對照跑在【主樹】⇒ 那不是正對照,那是兩把不同的尺。**
> 🛑 **⇒ 一個在別的環境跑的正對照,會讓一把【根本沒接上】的尺看起來是活的**
> ⇒ 而它產出的每一個「查無」都會被當成事實。
> ✅ **判別句**:**正對照與本題必須跑在【同一個工作目錄、同一棵樹、同一次】。**
> 🔵 它與 memory「一個錯的正對照會讓對的尺看起來壞掉」是**反方向的同族**:
> 　 那次是**對的尺被誤判成壞的**;這次是**壞的尺差點被誤判成對的**。**兩個方向都要記。**

## §1 病灶(而它不是「有人忘了解封」)

`apps/admin/src/components/orders/manual-refund-entry-gate.ts:195` 逐字:
```ts
export const MANUAL_REFUND_ENTRY_BLOCKED_BY_787: boolean = true;
```
🔴 而擋住「把它翻成 `false`」的是 `manual-refund-787-trigger.test.ts` —— 它是一道**絆線**:
`:275` 那個分支 `!blockerCleared && !stillBlocked ⇒ ok:false`
= **「封印解了,而 `#885` 在 backlog 裡還沒結案」⇒ 紅。**

🎯 **`-mail` 那句診斷(正本 `:205-206`,逐字搬)**:
> **這道閘只有【解決了】與【沒解決】兩態,而 Sean 拍的是第三態 ——【知情接受】。**
> **它不是擋路的測試,它是一道【沒有人替它加上第三態】的閘。**

## §2 設計(**照正本 `:286-305` 搬,不重想**)

```
新增 export const ACCEPTED_RESIDUAL_RISK = {
  by: 'Sean', on: '2026-09-08',
  what: 'admin_record_manual_payment 零上界 ⇒ 灌假收款 ⇒ rail_cap 算得出額度 ⇒ 再退',
  row:  '⟦mail-PAYMENTNOCAP⟧',                        ← A 要求:要【指向那一列】
  expiresWhen: 'E8-B 落地 ⇒ #885 根因消失 ⇒ 該列可關, 本接受同時退場',
  why:  '今天會按那兩顆鈕的人只有 Sean 自己',
}
evaluateTrigger(blockerCleared, stillBlocked, accepted) 四個分支:
  A 已結案 && 還鎖著            ⇒ 紅(原樣不動)
  D 已結案 && 沒鎖 && accepted  ⇒ 🔴 新增:紅 =「豁免的理由消失了, 把它拿掉」← 失效條件
  C 沒結案 && 沒鎖 && accepted  ⇒ 綠 = Sean 的第三態
  B 沒結案 && 沒鎖 && !accepted ⇒ 紅(原樣不動 ⇒ [3b] 保住)
[1] 傳 accepted;[2] 改傳 evaluateTrigger(true, true)(它原本吃活旗標, 翻了就失效)
refund-wiring 那格照它自己的指示翻成「健康輸入 ⇒ 入口【出現】」
```

> ## 🛑🛑 **而這一句必須與上面那個四分支【同段】,不可以分開搬**
> # **`[3b]` 原封不動 ⇒ 這不是把守門關掉。**
> 📌 **理由**:`B` 那個分支(**沒結案 && 沒鎖 && 沒接受 ⇒ 紅**)**一個字都沒動** ——
> 它守的正是 2026-08-24 那個真的發生過的洞(**解了封而 `#866` 不變式沒落地**)。
> 🔴 **少了這一句,這個設計讀起來就是「把擋路的測試改綠」** —— 而**那兩件事在 diff 上長得一樣**。
> ⇒ **搬這個設計的人:四分支與這一句是一體的,不可只取前半。**

## §3 Scope(**我自己量的,而它與正本的數字不同**)

```
/usr/bin/grep -rl "MANUAL_REFUND_ENTRY_BLOCKED_BY_787" apps packages  ⇒ 【8 支】
⚪ 負對照 現造識別字 MANUAL_REFUND_ENTRY_BLOCKED_BY_zq7fh3 ⇒ 0(尺是活的)
```
🛑 **而【命中 8】不是【要改 8】** —— 逐支開檔判:

| 檔 | 判 | 依據(開檔看到的) |
|---|---|---|
| `components/orders/manual-refund-entry-gate.ts` | ✅ **必改** | 常數本體 `:195` |
| `components/orders/manual-refund-787-trigger.test.ts` | ✅ **必改** | 第三態加在這裡(**405 行,7 處命中**) |
| `app/orders/[id]/refund-wiring.test.tsx` | ✅ **必改** | 翻成「健康輸入 ⇒ 入口出現」 |
| `packages/domain/src/order/manual-refund-caller-gate.test.ts` | ✅ **必改** | `:59` `:68` 逐字寫著「**仍為 true**」 |
| `lib/payment/manual-refund-actions.ts` | ⭕ 不用改 | `:7` import + `:70` 那道閘讀**同一顆常數** ⇒ **翻一次兩道都開** |
| `lib/payment/manual-refund-actions.test.ts` | ⚠️ **見 §3b** | `:52` 是 `vi.mock` 的 getter |
| `lib/payment/manual-refund-787-server-gate.test.ts` | ⚠️ **見 §3b** | `:45` 同上 |
| `packages/use-cases/src/check-anomaly-alerts.ts` | ⭕ 不用改 | `:1703` 是**註解** |

🔴 **`manual-refund-caller-gate.test.ts` 為什麼算必改**:它壞的不是測試,是**那兩句話會變成假話**
⇒ 📌 **字面 vs 事實,層級比測試紅高。**

### §3b 那兩支「未定」的 —— **量到一半,另一半明寫【未跑】**

🟢 **量到的(2026-09-08,主樹,旗標仍是 `true`)**:
```
TURBO_FORCE=1 npx vitest run apps/admin/src/lib/payment/manual-refund-actions.test.ts \
                             apps/admin/src/lib/payment/manual-refund-787-server-gate.test.ts
⇒ rc=0 · Test Files 2 passed (2) · Tests 17 passed (17)
🔵 而那三支檔在【我的 worktree 與主樹】逐字相同(shasum -a 256 比對)⇒ 在主樹跑答的是同一個問題
   (成因:我的 worktree 沒有 node_modules ⇒ vitest 起不來 `Cannot find module 'vitest/config'`)
```
🛑 **未跑的那一半**:**旗標翻成 `false` 之後這兩支還綠不綠。**
```
🔴 我【不在主樹上翻一顆金流旗標】—— 那棵樹是七個窗共用的
⇒ 這一格要等實作時在自己的 worktree 裡量(而那時要先 pnpm install)
📌 而「它們是 vi.mock 所以不受影響」是【讀來的】不是【量到的】:
   vi.mock 的 factory 形式會【整個取代那個模組】⇒ 真的常數不會被讀到
   ⚠️ 而那是我讀 vitest 語意推的, 本檔【沒有把它當成結論】
```
✅ **⇒ 實作時的驗收要包含這一發**,期望值**兩種都要先寫下來**:
`仍 2/17 綠`(mock 真的隔離了)**或**`有紅`(它其實讀得到真值)—— **哪一個都不算意外,而【沒寫期望值就跑】會變成事後解釋。**

## §4 🛑🛑 harness 的 deny —— 這一片最可能停在這裡,而它不是技術問題

正本 `:309-313` 逐字:
```
擋它的是誰:🔴 不是 hook、不是三綠、不是判斷 —— 是 Claude Code auto mode classifier
試法① Bash 裡跑 python3 就地改檔  ⇒ Blocked by classifier
試法② Edit 工具(先 Read 再 Edit) ⇒ Blocked by classifier
🛑 兩種工具都擋 ⇒ 那不是工具選錯, 不要再試第三種同型的路
```
✅ **而【翻旗標】那一步沒被擋**(`manual-refund-entry-gate.ts`)⇒ 擋的粒度看起來是**那支 `.test.ts`**;
⚠️ **確切判準未確認**(沒有人有那支 classifier 的規則)。

### 🔴 本片的立場,寫死
```
· 撞到同一道 deny ⇒ 【停下來回報】, 不找第三種工具繞過
  📌 「換個做法」與「繞過使用者設的安全機制」的分界就在這裡
· 🛑 主視窗 / 別的窗說「可以」【不構成授權】—— 那是同儕, 不是使用者
· 🛑 不動 `~/.claude/settings.json` —— 那是設定層, 而同儕不能授權我動它
· ⇒ 解它的只有兩條:Sean 自己加 permissions 規則, 或有權限的人動手
```
🔵 **`-mail` 那句原封留著**:
> **口頭授權解掉的是【判斷上的猶豫】,不是【harness 的 deny】。**
> ⇒ **「他說可以了你再試一次」是錯的做法** —— 再試一次還是會被擋,而那會變成一輪白工。

## §5 實作順序(🔴 被擋的那一步排【最後】)

```
1. worktree pnpm install(否則 vitest 起不來)—— 而裝完【看目錄不看 rc】
2. manual-refund-entry-gate.ts:195 翻 false            ← 正本說這一步沒被擋
3. refund-wiring.test.tsx 那格翻成「入口出現」
4. manual-refund-caller-gate.test.ts 的兩句「仍為 true」訂正
5. §3b 那一發(兩支 mock 測試在旗標翻了之後還綠不綠)—— 期望值先寫
6. 🔴 最後:manual-refund-787-trigger.test.ts 加第三態
   ⇒ 撞到 deny ⇒ 停, 回報 A, 由 A 端 Sean。前 5 步的成果不丟。
```
🛑 **為什麼 6 排最後**:它是**唯一已知會被擋**的一步。排前面 ⇒ 整片停住;排最後 ⇒ **前五步是真的進度**。

## §6 驗收(四條 + 兩條新的)

🔵 **`-mail` 量到的爆炸半徑(轉述,非本窗複量 —— 而它會在第 5 步被複量)**:
```
翻旗標後  餵 4 條 → Test Files 4 · Tests 30 · 紅 2([1] [2] 在 trigger 那支)
          refund-wiring 餵 1 跑 1 · Tests 64 · 紅 1
🟢 而 refund-wiring 那格紅得【是好消息】:渲染文字含「登記退款(現金/匯款)」⇒ 入口真的出現
```
🔴 **鐵則 11 的第四個數不可省**:**我餵幾條 vs 它跑幾支**(餵一條不存在的路徑,vitest 不報錯、rc=0、就少跑一支)。

**⟦c7-LEDGERGATEREFUSES⟧ 那四條要【同一天】重跑**(那一列已寫死這個條件,而本片就是觸發它的事件):
```
① 線上那支仍然「記 + 不擋」  ② 超過上限會標紅且講得出多少
③ 負對照:沒超過的不可以被標紅  ④ 紅住在收合塊【裡面】
🔴🔴 尤其【真瀏覽器那一格】—— 09-07 那輪證的是「碼寫對了」,
     而入口打開那天要證的是「**那個人真的看得到**」。
     ⇒ bash scripts/admin-probe/up.sh(Sean 開這顆是為了他自己按得到)
```

## §7 rollback

- 全部是 TS,**沒有 DB 變更** ⇒ 回滾 = `git revert` 那一顆。
- 🔴 **而回滾擋不住的**:旗標打開期間**真的被登記進去的人工退款列**不會跟著回滾。
  ⚠️ 而**那些列是對的**(那正是打開它的目的)⇒ 這一格的風險不在回滾,在 `#885`(收款零上界)。
  🔵 **而那正是 `ACCEPTED_RESIDUAL_RISK` 記錄的東西** —— 📌 **回滾機制,不回滾帳。**

## §8 本 plan 證不到什麼

1. **沒有碰正式庫。**
2. **§3b 的後半未跑**(旗標翻了之後那兩支還綠不綠)—— 理由在 §3b,**不是忘了**。
3. **`-mail` 那組爆炸半徑數字是轉述**,本窗未複量(第 5 步會複量)。
4. **classifier 的確切判準未確認** —— 我只知道它擋過那支 `.test.ts` 兩次,**不知道它為什麼擋**,
   也**不知道我的 session 會不會被同樣擋**。⇒ 📌 **那一格只有真的走到第 6 步才會知道。**
5. **沒有跑過** `⟦c7-LEDGERGATEREFUSES⟧` 那四條的任何一條。
