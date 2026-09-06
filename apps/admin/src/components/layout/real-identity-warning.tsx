// real-identity-warning.tsx — ⟦b4-MGRENV1⟧ 那一列要的【一道會叫的訊號】。
//
// ## 這一條在守什麼(不是「提醒設定」,是一個會放行的洞)
// 後台 manager 閘的效力綁在環境變數 `ADMIN_REQUIRE_REAL_IDENTITY` 上。
// 🔴🔴 **而射程比我第一版寫的窄, 那是 codex R2 抓到、我開檔核過的**(`lib/session/actor.ts:65-70`):
// ```
// 第 1 層  票是 v:2       ⇒ 身分【只】從 sub 來, 旗標開不開都一樣  ← 旗標關著也【不受影響】
// 第 2 層  不是 v:2 而旗標【開】⇒ null, 不回退
// 第 3 層  不是 v:2 而旗標【關】⇒ 退回使用者自選的來源  ← 洞在這一格, 【只有這一格】
// ```
// ⛔ ~~原句「旗標關著時 `getSessionActor` 會退到使用者自己決定的來源」~~ —— **那對 v:2 的票不成立。**
// ⇒ 📌 正確說法:**旗標關著時, 拿【舊格式登入票】的人會落進第 3 層。**
// ✅ 而今天正式站上第 3 層走不到(`actor.ts:26` 逐字), 理由正是這顆旗標 `=1`
//    ⇒ 🎯 **這條警示守的就是「那個理由消失」的那一天。**
// 📎 射程 = 4 個呼叫點(2026-09-06 實數):`lib/staff-actions.ts` **3 處**(:105 / :156 / :230)
//    + `lib/mail/dead-letter-actions.ts:46`。
//    ⛔ ~~原句「`staff-actions.ts` 4 處 + 死信重排 1 處」~~ —— codex R1 nit 抓到, 我開檔數過:是 3+1。
//
// ## 🔴 為什麼是「出聲」而不是「擋」(主視窗 `-f1` 2026-09-06 裁【乙】)
// 甲案是 production 沒開就 fail-closed。**而那是在一個沒有人讀得到的值上下注**:
// Vercel 那格 Type = `Secret`, 面板逐字「You can't reveal this value after saving」
// ⇒ **連 Sean 本人也讀不到**;`vercel env ls` 在 `=1` 與 `=0` 兩個世界印同一個 `Encrypted`。
// ⇒ 🛑 沒有辦法在動手前確認它今天是不是 1 ⇒ 甲案可能把整個後台鎖死。
//
// ## 🔴 文案刻意【不寫怎麼利用】(codex R1 must-fix ②)
// 這條警示出現在登入閘的**內側**, 而 `proxy.ts` 只證明「已登入」—— **它沒有證明看的人是管理者**。
// ⇒ 一般員工、或一個被盜的帳號, 都會讀到這條字。
// ⇒ 📌 **所以它只說「現在這個狀態下權限檢查不可靠、去哪裡修」, 不說「怎麼冒名」。**
//   ⚠️ 這不是安全靠隱藏 —— 洞在碼裡、對讀得到碼的人本來就不是秘密;
//     省掉的是**把現成的步驟遞給一個剛好看到這條字的人**。
//
// ## ⚠️ 它答不出什麼(先寫在這裡, 免得下一個人以為洞補好了)
// · 它**不會擋**那個放行 —— 洞還在, 只是現在有人會看到。
// · 它只在**有人打開後台頁面**時才出聲;沒有人登入的那段時間它是沉默的。
// · 🔴 **不是「每一頁」**(codex R1 nit):只有走 root layout 的頁面 ——
//   一般頁 / `@panel` 平行路由 / 螢幕上的 print 頁。
//   **Route Handler(`/api/*`、SSO 導頁、PDF)不渲染 layout ⇒ 那些路徑上它不出聲**,
//   而全域錯誤畫面也不保證經過這裡。
// · 🔴 **祖先把它藏起來, 本檔的守門看不到**(codex R2):測試只驗這個元件自己沒有 `hidden`;
//   有人在 layout 外包一層 `hidden` 或 `display:none`, 11 格照樣全綠而畫面上什麼都沒有。
//   ⇒ 那要真瀏覽器量, 不是單元測試的射程。**寫在這裡, 不假裝守住了。**
// · 🔴 **沉默區**(codex R2 consider):self-host production / Vercel 系統變數沒開 / CI 做
//   production build 時, `VERCEL_ENV` 讀不到 ⇒ `resolveEnvTag()` 回 `null` ⇒ **本條不出聲**。
//   那是白名單 fail-closed 的代價:寧可沉默, 也不要在每個非正式環境天天噴假警報。
// · 旗標在 `=1` 以外的任何值(空的 / `true` / `yes`)都算沒開 —— 那是 `requireRealIdentity()`
//   的既有形狀(`session.ts`, `=== '1'`), 本檔沿用、不自己判。
//
// ## 環境判準用 `resolveEnvTag()`, 不用 `IS_PROD`(codex R1 must-fix ①)
// `IS_PROD` 只是 `NODE_ENV === 'production'` ⇒ **Vercel Preview 與本機 `next start` 也是 true**,
// 而那兩個環境本來就不會設這顆旗標 ⇒ 會天天噴假警報, 而假警報會讓真警報沒有人看。
// ✅ `resolveEnvTag()`(`session.ts`)走白名單:認得出來才回值, 認不出來回 `null`。
// 🔵 附帶好處:它**每次呼叫才讀** env, 不像 `IS_PROD` 是模組載入當下算的常數。
//
// 樣式**照搬** `components/orders/item-procurement-warnings.tsx` 那一條既有警告條
// (`role='alert'` + amber 三件組), 不自己發明配色 —— 鐵則 1。
// `print:hidden`:本 layout 也是列印頁的父層, 而這條警告不該印在給客人的單據上。
import { requireRealIdentity, resolveEnvTag } from '@/lib/session/session';

export function RealIdentityWarning() {
  if (resolveEnvTag() !== 'production') return null;
  if (requireRealIdentity()) return null;
  return (
    <div
      role='alert'
      data-testid='real-identity-warning'
      className='mx-4 mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700 print:hidden'
    >
      <strong>後台的「管理者身分驗證」目前是關的。</strong>
      在這個狀態下,某些登入方式無法確認執行管理者動作的人真的是本人,
      而檢查會照常放行、不會有任何錯誤訊息 —— 請暫時不要在後台調整員工權限或重送信件。
      請到 Vercel 專案的環境變數把它開回來(那一格叫 <code>ADMIN_REQUIRE_REAL_IDENTITY</code>,
      值要<strong>正好是 1</strong>),存檔後要重新部署才會生效。
    </div>
  );
}
