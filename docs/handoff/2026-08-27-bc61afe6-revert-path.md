# 🚨 `bc61afe6` 的退場路徑 —— **備好了,只等一個字**

> 線3(`pcm-website-v2-6e`)2026-08-27 04:4x。**本檔【不執行任何東西】。**
> 觸發條件:Sean 的 16 分鐘肉眼驗收**失敗**(登入後台 → 分頁開著別關 → 16 分鐘後被叫去重新登入)。
> ⚠️ **沒有 Sean 的話,一個字都不動。**

## 現況(當場量的)
```
git ls-remote origin refs/heads/dev  ⇒ 40c175f7…  與本地 HEAD 同 ⇒ 未推 0
bc61afe6 已在 origin/dev(判別法:git merge-base --is-ancestor bc61afe6 origin/dev && echo 已推 || echo 未推)
bc61afe6 之後動過那三支檔的只有 acf3484a(我自己的檔頭註解), 沒有別人 ⇒ 退場不會踩到別人
```

---

## 🅰️ 方案 A(**推薦**):外科式 —— **只關掉 Origin 閘,其餘四條修法全留**

**適用**:失敗的形狀是「每個人 15 分鐘被登出一次」/ 後台任何動作都 403。
(這一片新增的擋人機制在 `apps/admin/src/app/api/session/renew/route.ts:80`;
數法 `grep -c "isAllowedOrigin" apps/admin/src/app/api/session/renew/route.ts` ⇒ **3**
 —— import 1 + 註解 1 + 真正的呼叫 1;**擋人的只有 `:80` 那一個**, 另外兩個不擋任何東西。
 ⚠️ 本檔第一版把這個數字寫成 2, 而我沒有跑就寫了 —— 今晚同款第 N 次, 照 §射程那節看待。)
**理由**:那是這一片**唯一新增的擋人機制**;M1(每分鐘打 DB)、M3(DB 抖一次全體被踢)、
MF1(票多活 15 分鐘)、N1(操作紀錄串不起來)四條修法**沒有理由跟著退**。

```bash
cd /Users/sean_1/pcm-website-v2
git apply /private/tmp/claude-502/-Users-sean-1-pcm-website-v2/576ca6a8-aeb2-474e-8601-5362b07cbc2f/scratchpad/REVERT-A-origin-gate-off.patch
```
📎 patch 全文也貼在本檔最後,scratchpad 不見了可以直接用。

**實測過的(在拋棄式 worktree 裡,沒碰共用樹)**
```
typecheck                     ⇒ rc=0
git apply --check(在主樹)   ⇒ 套得上
   負對照:把 patch 弄壞一個字 ⇒ 套不上 ⇒ 那個檢查會動
```
🔴 **而它會弄紅兩格測試, 那是【預期的】不是壞掉**:
```
× [R10]  Origin fail-closed:缺 Origin ⇒ 拒
× [R10b] 別的來源(同站子網域也算)⇒ 拒
⇒ 那兩格就是在守 Origin 閘。關掉閘 ⇒ 它們必須紅。
⚠️ 【不要為了讓它們變綠而改測試】 —— 紅著才是誠實的。commit body 寫明「兩格刻意紅」。
```

---

## 🅱️ 方案 B:整顆退回 —— **只有在 A 沒解決時才用**
(退掉的範圍:`git show --stat bc61afe6` ⇒ 6 支檔)

```bash
cd /Users/sean_1/pcm-website-v2
git revert --no-commit --no-edit bc61afe6
```
**實測過**:自動合併成功(三支檔 auto-merging)、typecheck rc=0、
`vitest --project admin` 那組 **12 檔 / 166 格 / 紅 0**。

🔴 **而它會把這些【一起退掉】,這是代價不是副作用**:
```
M1  ⇒ 回到每 60 秒無條件打一次 DB
M3  ⇒ 回到「DB 抖一次 ⇒ 每個分頁永久停止換票 ⇒ 15 分鐘內全體被踢」← 最會咬人的那條
MF1 ⇒ 回到票最壞多活近 15 分鐘, 而「絕對上限」那句話變回假的
N1  ⇒ 回到編號每 60 秒換一次, 操作紀錄串不起同一次連線
另外它會【刪掉】apps/admin/src/components/session/session-renew.test.tsx(那支測試是這顆帶進來的)
並一併退掉 apps/admin/src/app/api/sso/callback/route.ts 的註解訂正
```
⇒ 📌 **B 是「回到一個已知有 15 條 must-fix 的版本」,不是「回到安全狀態」。**

---

## 兩案都要做的收尾
(三綠的完整規則見 `docs/patterns/slice-checkpoint.md:1`;`git log -1 --format=%s` 回核標題)
```
1 三綠:TURBO_FORCE=1 pnpm typecheck && ... lint && ... build
  ⚠️ 八窗共用一棵樹 ⇒ build 可能撞別人的鎖(逐字 Another next build process is already running)
    ⇒ 等 90 秒重跑, 那不是紅
2 commit 帶字面 pathspec, 不用 shell 變數
3 🔴 不 push —— push 只有 Sean 做
4 body 要寫:為什麼退、退了什麼、【沒有】退什麼、哪幾格測試刻意紅
```

## 🔴 而在跑任何一案之前,先問一格
```
失敗的形狀是什麼?
  「每個人 15 分鐘被登出一次」/ 任何動作都 403  ⇒ 極可能是 Origin 閘 ⇒ 走 A
  其他形狀(例如登入頁本身進不去)              ⇒ 那可能【不是這一片】
    ⇒ 這一夜有 75 顆一起被推上去。先確認是誰造成的, 再退。
    📌 退錯東西的代價是:真正的病沒好, 而我們少了四條修法。
```

## patch A 全文(scratchpad 不見時用這份;對應 `apps/admin/src/app/api/session/renew/route.ts:79-82`)
```diff
@@ export async function POST(req: NextRequest): Promise<NextResponse> {
-  const devBypass = process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1';
-  if (!isAllowedOrigin(req.headers.get('origin'), { devBypass })) {
-    return json('bad-origin', 403, requestId);
-  }
+  // ⛔ 2026-08-27 緊急關閉:Origin 閘讓正式站的續期全部失敗。
+  //    ⚠️ 只關這一道 —— M1/M3/MF1/N1 四條修法【全部留著】, 不要整顆 revert。
+  //    🔴 重開之前要先查清楚正式站送過來的 Origin 到底是什麼字串。
+  void isAllowedOrigin;
```

## 本檔的射程
```
· 兩案的 typecheck 與測試是在【拋棄式 worktree】裡跑的, 不是主樹。主樹跑時數字可能不同
  (別的窗還在動)。
· 我【沒有】在正式站上驗證過任何一案 —— 我沒有存取權。
· 「失敗的形狀 ⇒ 走哪一案」那張判斷表是【推的】, 因為失敗還沒發生。
· 而最重要的一格:🔴 **我沒有執行任何一案。** 本檔是備料, 不是紀錄。
```
