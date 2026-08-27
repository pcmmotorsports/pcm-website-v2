# B7 九條負向驗收 · 逐條狀態表(收工檔)

> 🔴 **這份檔【本身】就是 `docs/specs/2026-08-18-m4b-e8b-b6-b7-spec.md` §3 明文的 B7 收工條件**
>    ——「B7 的收工條件是九條逐條標記狀態(通過 / 未做 / 不適用+理由),不得只交『跑過的那些』」。
>    **而它在 2026-08-27 之前不存在** ⇒ 這正是為什麼「B7 做了沒」一直沒有一個查得到的答案。
>
> 🔴 **給下一個 grep「B7」的人**:你會拿到 **0**,而那個 0 是【命名】的 0,不是【覆蓋】的 0。
>    這九條的守門**不掛「B7」這個名字** —— 它們散在 `b5a-identity-acceptance` / `read-gate` /
>    `authorize` / `staff` 這些檔裡。**這份表就是來接住你那個 0 的。**
>    (2026-08-27 主視窗板子 `:129` 一度寫「3 支撞名 ⇒ 這九條一條沒跑」,那是【命名的 0】被讀成【覆蓋的 0】;
>     實測 admin 側五條有測、59 格綠、每條帶正對照。板子已由主視窗劃線更正。)
>
> 分母 = 母 plan `docs/specs/2026-08-16-m4b-e8b-real-auth-line-plan-v4.md` §6(負向清單)。
> 母 plan 逐字:「正向『三個帳號各登一次』不算驗收」「每一項都要有一格【會紅】的測試,不是『應該會擋』」。

## admin 側 59 格綠(可重跑,不只給數字)
```
npx vitest run --project admin \
  src/lib/session/b5a-identity-acceptance.test.ts \
  src/lib/session/read-gate.test.ts \
  src/lib/session/authorize.test.ts \
  src/lib/staff.test.ts
⇒ 4 檔 / 59 passed / 0 failed(2026-08-27 11:3x 實跑 rc=0)
```

## 九條逐條

| # | 母 plan 那一條 | 狀態 | 證據(檔案:行號)| 正對照(防恆綠)| 誰在跑 |
|---|---|---|---|---|---|
| 1 | 舊 cookie 失效、開關開 ⇒ v:1 拒、不得靜默降級 | ✅ 已覆蓋(不叫 B7)| `b5a-identity-acceptance.test.ts:105` [2] v:1+旗標開⇒拒、reason=`version_rejected` | `:98` [1] v:1+旗標關⇒收(回歸格:它紅=弄壞現況)| admin 單測 |
| 2 | legacy fail-open cookie 發不出來 | ⬜ 分母不在這裡 | 報價單 repo · B2 的面(登入端)| — | 報價單側,本工作樹構造不出來 |
| 3 | 備援登入進得去、而任何寫入被擋 | 🟡 admin 半已覆蓋 / 另一半分母不在這裡 | admin 半:`authorize.test.ts:92` 無具名 actor(停用/查無/DB錯)⇒null | `authorize.test.ts:99` 前一層先失敗就不問 actor 閘(fail-closed 序)| admin 單測 / 報價單半在報價單 repo |
| 4 | 已停用員工仍持有效 session ⇒ 讀取閘擋 | ✅ 已覆蓋(不叫 B7)| `staff.test.ts:59` DB 列 inactive⇒null;`:149` resolveActiveStaffById is_active=false⇒null | `staff.test.ts:48` 在職 id⇒actor(同把尺會回東西)| admin 單測 |
| 5 | SSO code 重放 ⇒ 擋 | ⬜ 分母不在這裡 | 報價單 `exchange` 原子消耗(B4 spec §6 第9格);admin callback 只是【委派】給它 | — | 報價單側 |
| 6 | 開關開、而 session 沒帶身分 ⇒ 擋 | ✅ 已覆蓋(不叫 B7)| `b5a-identity-acceptance.test.ts:281` [16] 無 v:2+旗標開⇒null,且一次都沒讀 ACTOR_COOKIE | `:294` [16b] 同把尺在第 3 層【真的會爆】(否則 [16] 恆綠)| admin 單測 |
| 7 | 混版:admin 新 / 報價單舊 ⇒ 不當機、不放行無身分 | 🟡 admin 半已覆蓋 / 另一半分母不在這裡 | admin 半:`b5a-identity-acceptance.test.ts:142` [7] v:3 或 v 缺⇒拒 | 同檔 [3] v:2 合法⇒收(能收也能拒)| admin 單測 / 報價單半(B4 spec §6 第7/8格)|
| 8 | 查無帳號 vs 密碼錯:訊息、狀態碼、**回應時間**三者一致 | 🔴 連【怎麼量】都還沒有人想好 | 無 —— 母 plan 明文「**沒想好怎麼量之前不要寫成通過**」 | — | 報價單側,且量法未定(比「沒做」更前面一格)|
| 9 | 首次登入沒改密碼 ⇒ 不得經 SSO 繞過 | ⬜ 分母不在這裡 | 報價單側 · 攔截點必須在所有入口之前含 `authorize` | — | 報價單側 |

## 分堆(一眼看完)
```
admin 側已覆蓋(綠、帶正對照,只是不叫 B7):  #1 #4 #6 全條 + #3 #7 的 admin 半  = 5 條有 admin 貢獻
分母不在這裡(報價單 repo,本工作樹構造不出來):#2 #5 #9 全條 + #3 #7 的另一半      = 4 條
連怎麼量都未定(比「沒做」更前):              #8                                  = 1 條
```

## 🔴 這份表【不】宣稱什麼(誠實邊界)
1. 報價單側那半我**沒有下任何結論** —— 我看不到那個 repo,不寫「應該也有測」。狀態一律「分母不在這裡」。
2. admin 側五條寫的是「**已覆蓋而不叫這個名字**」,**不是「B7 已完成」** —— B7 的完成要九條都有著落 + 兩顆開關都開(spec §3 收尾),那不是這份表能宣布的。
3. `#8` 不是「不適用」也不是單純「報價單側」 —— 它是**量法未定**;誰要動它,先去母 plan 讀那句「沒想好怎麼量之前不要寫成通過」。
