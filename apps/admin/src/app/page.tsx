// 🔴 **相對路徑、不用 `@/`**:根 `vitest.config.ts:27-29` 的 `@` alias 指向 **storefront** 的 src,
//    admin 檔案用 `@/` 在 vitest 裡 resolve 不到 ⇒ 本頁就永遠測不到。
//    姊妹頁 `app/orders/page.tsx` 為了同一個理由做過同一件事(`orders/page.test.tsx:15-17` 有記)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
import { selectActorAction } from '../lib/session/actor-actions';
import { ACTOR_ID_FIELD, getSessionActorWithSource, type ActorSource } from '../lib/session/actor';
import { listActiveStaff } from '../lib/staff';
import { loadTodaySummary, type TodaySummary } from '../lib/dashboard/today-read';
import { TodaySummaryCards } from '../components/dashboard/today-summary';
import {
  loadDataFreshness,
  loadFitmentFreshness,
  freshnessLabel,
  fitmentFreshnessLabel,
  unreadable,
  type DataFreshness,
} from '../lib/dashboard/freshness-read';
import {
  loadStuckPaymentCount,
  stuckPaymentLabel,
  unreadableStuckPayment,
  type StuckPaymentCount,
} from '../lib/dashboard/stuck-payment-read';
import {
  loadCronHeartbeats,
  unreadableReport,
  type CronHeartbeatReport,
} from '../lib/dashboard/cron-heartbeat-read';
import {
  DEAD_LETTER_SCAN_CAP,
  loadDeadLetterCount,
  unreadableCount,
  type DeadLetterCount,
} from '../lib/mail/dead-letter-count-read';

// ~~M0-S1 骨架占位頁~~ + M0-S2 具名身分選人。
// 🔴 **`#16` 今日對帳(2026-08-14,Sean 拍「批」)**:骨架說明卡下架,換成對帳數字。
//    🪦 **原為四格;「今日退款」於 2026-08-15 拆掉 ⇒ 現為三格**(理由見 `lib/dashboard/today-view.ts` 墓碑段)。
//    判定與加總全在 `lib/dashboard/today-read.ts`,本頁只負責取資料 + 擺位置。
//    ⚠️ 具名身分那一區(M0-S2)**一字未動** —— 它是這頁原本唯一在用的功能。
//
// 🔴 **顯式 `force-dynamic`**:對帳數字**不得被快取**。本頁目前是動態渲染只因為 layout 讀了
//    `cookies()`(`app/layout.tsx:27-30`)—— 那是「現況剛好如此」,不是保證。
//    不顯式宣告,哪天 layout 改了就會有人看到昨天的數字、還以為是今天的。
//
// 🔴 **對帳讀取失敗只倒那一區、不倒整頁**(reviewer MF6):`today-read.ts` 那句「寧可炸也不要
//    顯示少算的數字」只證成**那幾格**該炸,**不證成把 `selectActorAction` 一起帶走** ——
//    具名身分是這頁原本唯一在用的功能,對帳掛掉不該讓員工連身分都切不了。
//    做法逐字抄同 repo 既有形狀:`app/settings/staff/page.tsx:24-31,47-53`(try/catch +
//    `console.error` + 失敗卡),不自創第二種寫法。
// 🔴🔴 **`:247`(⟦b4-MGR0-COPY⟧)三個世界,三句話 —— 而在此之前它們印同一句**(2026-08-29 線F)。
//
// **改之前**:下面那句「這個身分是你自己選的、系統並未驗證」是**無條件印的**,
// 而 `apps/admin/src/app/settings/audit/page.tsx`(錨 `那句話 2026-08-25 就已經假了`)
// 早就寫著它假了 —— **兩支檔各自為真,而讀者一次只讀得到一支。**
//
// 🔴 **決定要印哪一句的是【那張票】,不是 `ADMIN_REQUIRE_REAL_IDENTITY` 那顆旗標。**
//    這一格極容易寫反,而**寫反了畫面看起來完全正常**:
//    存在「旗標**關**而票已經是 `v:2`」的世界 ⇒ 身分是驗證過的,而照旗標分岔會在那裡印「你自己選的」。
//    ⇒ 三層與順序在 `lib/session/actor.ts` 的 `getSessionActorWithSource`,**本檔不複述一次**
//      (板子上這一列的由來,正是「同一件事被三支檔各講一遍而三句不一樣」)。
//
// ⚠️ **本片放棄了什麼,寫在這裡不寫在報告裡**:
//    ① `'none'` 的兩個世界(v:2 票但 fallback/bootstrap 登入 / 旗標開而票非 v:2)裡,
//       下面那顆選單**選了不會生效**(那條路不讀 `ACTOR_COOKIE`)—— 本片**只把話說對,沒有停用那顆鈕**。
//       停用它是 UI 行為改動 ⇒ Sean 的地盤,已進累積表。
//    ② 這三句話的正確性現在綁在**票的解讀**上 ⇒ `verifySession` 哪天放寬,這裡會跟著錯,
//       而**測試釘的是三層各走到哪一句,不是那些字**(`page.test.tsx`)。
//
// 🔴🔴 **`source` 一個人不夠 —— 還要問 `actor` 是不是 null**(codex 關卡2 must-fix,2026-08-29)。
//    `source==='ticket'` **不保證票上那個人還在**:`lib/staff.ts:71-76` 的 `resolveStaff`
//    對「不在啟用名單」回 `null`(員工被停用、查無、DB 逾時)⇒ 到得了 `{ticket, actor:null}`。
//    ⇒ 少了那一格,那個人會看到「**尚未選擇** … 這個身分來自你登入時那張票」——
//    **兩個半句互相矛盾,而畫面不會有任何其他徵兆**,他也不知道自己的寫入為什麼被擋。
//
// 🔴🔴 **第五個世界**(codex 關卡2 R2 must-fix):`self-selected` 而 `actor` 是 null =
//    **還沒選人**。舊字面在這裡也是壞的 —— 畫面會連著印
//    「目前身分:**尚未選擇**。稽核 log 會把**這個身分**記成操作者」⇒ **哪個身分?**
//    ⚠️ **這一格不是本次改動造成的**(舊版無條件印同一句),而它就是板子那一列說的「假文案」
//    ⇒ 一併修,而**修的理由要記著**:它不是回歸,是本來就在的第五句假話。
//
// ⚠️🔴 **這六個 key 是【畫面狀態】,不是【真實原因】**(codex 關卡2 R3 角度C,收下為 nit):
//    型別會擋住「新增一個沒處理的 `ActorSource`」,**擋不住**「日後有人在 `actor.ts` 加第四層、
//    而沿用一個既有的 source」—— 那會安靜地套上一句對它而言是錯的話,**沒有東西會紅**。
//    📌 寫在這裡,是因為**下一個加層的人會先讀 `actor.ts`,而那邊也有一句指回這裡。**
type CopyKey = ActorSource | 'ticket-unresolved' | 'self-selected-unset';

const ACTOR_SOURCE_COPY: Readonly<Record<CopyKey, string>> = {
  // 第 1 層:票是 v:2 且 kind='user',而那個人也還在啟用名單裡。線D 2026-08-29 備好的 A 版,逐字採用。
  ticket:
    '。稽核 log 會把這個身分記成操作者。這個身分來自你登入時那張經過簽章驗證的票,不是你自己選的。',
  // 第 1 層而 `resolveStaff` 回 null ⇒ 票上有人,而那個人現在不是啟用中的員工。
  // 🔴 這一句與 `none` **不可以合併**:兩者「選了都不會生效」,而**員工要做的事完全不同** ——
  //    這一句要他去找管理員把帳號開回來,`none` 那句要他改用個人帳號登入。
  // 🔴 **這句話【不得斷言原因】**(codex 關卡2 R2 must-fix):同一個 `{ticket, actor:null}`
  //    可以來自「被停用」「查無」**或「名單這一趟沒讀到」**(`lib/staff.ts` 那支有逾時上界)——
  //    ⇒ 寫成「你的帳號被停用了」會在**第三種**世界誤導人,而那個人的帳號其實好好的。
  //    📌 **我們量得到的是「現在對不到」,量不到的是「為什麼」。**
  'ticket-unresolved':
    '。你登入的那張票上有一個身分,而系統現在對不到那個人(可能是被停用、查無,或員工名單這一趟沒讀到)。這個狀態下需要具名操作者的動作會被擋下 —— 請重新整理一次,還是這樣就找管理員。',
  // 第 3 層:讀自選 cookie。線D 的 B 版 = **一個字都不改**,這個世界裡原句是對的。
  // ⚠️ `actor` 為 null 時這句仍然對 —— 那是「還沒選」,而下面那顆選單是**活的**。
  // 第 3 層而還沒選人 ⇒ **不能說「會把這個身分記成操作者」,因為沒有那個身分。**
  //    而這一格與 `none` 的差別是**下面那顆選單是活的** ⇒ 話要講成一個可以照做的動作。
  'self-selected-unset':
    '。你還沒有選具名身分,請先在下面選一個 —— 在那之前,需要具名操作者的動作(改訂單、記收款…)會被擋下。',
  'self-selected':
    '。稽核 log 會把這個身分記成操作者。🔴 這個身分是你自己選的、系統並未驗證 —— 目前登入只確認「有人通過認證」,不確認「是誰」。真實帳號驗證待報價單端建立個人帳號後接上。',
  // 第 1 層 fallback/bootstrap,或第 2 層 ⇒ 這次 request 不讀 `ACTOR_COOKIE`。
  // 🔴 **「需要具名操作者的動作」這幾個字是收窄過的**(codex 關卡2 nit):
  //    ~~「需要寫入的動作會被擋下」~~ **過度概括** —— 下面那顆選單的 server action
  //    (`lib/session/actor-actions.ts:27-36`)**照樣會把 cookie 寫進去**,只是沒有人會去讀它。
  //    被擋下的是走 `authorizeAdminMutation` 的那些(`lib/session/authorize.ts` 逐字
  //    `const actor = await getSessionActor(); if (!actor) return null;`)。
  none: '。這次登入沒有帶具名身分(共用密碼或首次建置登入),而下面那顆選單在這個狀態下選了不會生效 —— 需要具名操作者的動作(改訂單、記收款…)會被擋下。請改用個人帳號登入。',
  // 🔴 **這一句與 `none` 分開,是因為【員工該做的事不同】**(codex 關卡2 R3「災難當天」角度):
  //    第 2 層 = 旗標開著而你手上是**舊票**。
  //
  // 🔴🔴 **而它【不能】叫他直接登出重登**(codex 關卡2 R4 must-fix,我開檔複驗過):
  //    `app/api/sso/callback/route.ts:156-163` 逐字 `if (requireRealIdentity() && !result.sub)`
  //    ⇒ 記一筆 `flag-on-without-upstream-sub` 然後 **`return configError()`(顯式 500,不發新票)**。
  //    ⇒ **上游還沒開始送 `sub` 時,他登出就【回不來了】** —— 而他現在這張舊票**還讀得到東西**。
  //    📌 **一句「請登出重登」在一半的世界裡是修復步驟,在另一半是把他鎖在門外** ——
  //    而**畫面分不出他在哪一半**(那取決於上游,不在本站)。⇒ 話要寫成「先別登出,先去確認」。
  'stale-ticket':
    '。你手上這張登入票是舊版的,還沒帶具名身分,而下面那顆選單在這個狀態下選了不會生效 —— 需要具名操作者的動作(改訂單、記收款…)會被擋下。🔴 請先不要登出:要等你的個人帳號在報價單端接上之後,重新登入才會拿到新票。先找管理員確認,確認了再登出重登。',
};

export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  // 🔴 ~~三支~~ ⇒ **六支**(2026-09-01 `⟦b4-FIT1⟧` 加第六支)**併發**、不串行(R2 nit4):
  //    彼此無依賴,串著跑等於白等 round-trip,
  //    而這是每次進站都跑的首頁。
  // 🔴 用 `allSettled` 不用 `all`:`all` 會讓對帳的失敗直接吃掉另外兩支的結果 —— 那正是 MF6 要擋的事。
  // 🔴🔴 **而 `allSettled` 隔離得了【失敗】,隔離不了【永遠不回】**(codex 2026-09-01 must-fix,判定成立):
  //    這六支都沒有自己的 timeout ⇒ **任何一支卡住,整個首頁跟著卡**,而畫面上看起來就是「還在載」。
  //    ⚠️ **這個缺口【不是本片帶進來的】** —— 它對原本那五支一樣成立,本片只是讓它多一個曝露面。
  //    ⇒ **本片刻意不在這裡修**:要修是給這六支各自加 bounded timeout = 動到另外五支的行為,
  //      那是範圍擴張。⇒ **單獨立一列**,不要順手改。
  //    身分與員工名單失敗**仍照舊往上拋**(它們掛了這頁本來就沒東西可看,不該假裝正常)。
  const [
    actorSettled,
    staffSettled,
    todaySettled,
    freshSettled,
    fitmentSettled,
    cronSettled,
    deadLetterSettled,
    stuckPaymentSettled,
  ] = await Promise.allSettled([
      getSessionActorWithSource(),
      listActiveStaff(),
      loadTodaySummary(),
      loadDataFreshness(),
      // 🔵 `⟦b4-FIT1⟧` 2026-09-01 加:上面那支蓋【供應商資料】, 這支蓋【車款搜尋】——
      //    兩件不同的資料, 而在這之前畫面上只有一行字。理由全文在 freshness-read.ts 那一節。
      loadFitmentFreshness(),
      loadCronHeartbeats(),
      // 🔵 `⟦f3-DEADLETTERCOUNT⟧` 2026-09-02(Sean 拍甲:「把『有幾封卡住』做成看得見的數字」)。
      //    這個數字**本來就已經被算出來**(告警器每輪都在算),只是沒有任何人類的眼睛看得到它。
      loadDeadLetterCount(),
      // 🔵 2026-09-03 線 `-db` 加(主視窗派, L1):一張扣款重試被放棄的單, 在這之前**後台沒有任何畫面看得到** ——
      //    那個標記只出現在【取消】流程的一道閘上, 而訂單列表沒有「系統放棄了」這一軸
      //    ⇒ 員工要已經點進那一張單才看得到, 而他不會知道要點哪一張。理由全文在 stuck-payment-read.ts。
      loadStuckPaymentCount(),
    ]);
  if (actorSettled.status === 'rejected') throw actorSettled.reason;
  if (staffSettled.status === 'rejected') throw staffSettled.reason;
  const { actor, source: actorSource } = actorSettled.value;
  // 🔴 見 `ACTOR_SOURCE_COPY` 上方那段:`ticket` 而 `actor` 為 null = 票上那個人已不在啟用名單。
  // 🔴 五個世界,而分岔的第二個輸入是 `actor === null` ——
  //    `source` 一個人答不出「這句話對不對」(codex 關卡2 R1+R2 各抓到一個漏網世界)。
  const copyKey: CopyKey =
    actor !== null || actorSource === 'none' || actorSource === 'stale-ticket'
      ? actorSource
      : actorSource === 'ticket'
        ? 'ticket-unresolved'
        : 'self-selected-unset';
  const staff = staffSettled.value;

  let today: TodaySummary | null = null;
  if (todaySettled.status === 'fulfilled') {
    today = todaySettled.value;
  } else {
    console.error('[admin/home] 今日對帳載入失敗', todaySettled.reason);
  }

  // 🔴 這一格**沒有「不顯示」這個選項**(`freshness-read.ts` 檔頭那段的理由):
  //    儀表的價值來自它每天都在印一個值 ⇒ 讀不到也要印「量不到」。
  //    `loadDataFreshness` 自己不拋,這裡的 rejected 分支是**最後一道**(它哪天改成會拋)。
  let fresh: DataFreshness;
  if (freshSettled.status === 'fulfilled') {
    fresh = freshSettled.value;
  } else {
    console.error('[admin/home] 資料新鮮度載入失敗', freshSettled.reason);
    // 🔴 走 `unreadable()` 而不是自己組一份字面量(R1 nit):「量不到長什麼樣」只有一個作者。
    fresh = unreadable('讀取時發生例外');
  }

  // 車款搜尋那一半(`⟦b4-FIT1⟧`)。**同一條理由**:讀不到也要印,不留白。
  let fitment: DataFreshness;
  if (fitmentSettled.status === 'fulfilled') {
    fitment = fitmentSettled.value;
  } else {
    console.error('[admin/home] 車款搜尋同步新鮮度載入失敗', fitmentSettled.reason);
    fitment = unreadable('讀取時發生例外');
  }

  // 系統放棄的付款(2026-09-03)。**同一條理由**:讀不到也要印,不留白。
  let stuckPayment: StuckPaymentCount;
  if (stuckPaymentSettled.status === 'fulfilled') {
    stuckPayment = stuckPaymentSettled.value;
  } else {
    console.error('[admin/home] 扣款重試已放棄筆數載入失敗', stuckPaymentSettled.reason);
    stuckPayment = unreadableStuckPayment('讀取時發生例外');
  }

  // 排程心跳(3a)。同一條理由:讀不到也要印,不留白。
  let cron: CronHeartbeatReport;
  if (cronSettled.status === 'fulfilled') {
    cron = cronSettled.value;
  } else {
    console.error('[admin/home] 排程心跳載入失敗', cronSettled.reason);
    cron = unreadableReport('讀取時發生例外');
  }

  // 死信計數。同一條理由:讀不到也要印,不留白。
  let deadLetter: DeadLetterCount;
  if (deadLetterSettled.status === 'fulfilled') {
    deadLetter = deadLetterSettled.value;
  } else {
    console.error('[admin/home] 死信計數載入失敗', deadLetterSettled.reason);
    deadLetter = unreadableCount('讀取時發生例外');
  }

  // 🔴 `max-w-4xl` **刻意留著,不是漏做**(`7f6d0ac1` 那次六支列表頁拿掉時逐支判過):
  //    本頁是**總覽**、沒有表格,拉滿寬只會讓幾張卡片攤在一片空白裡。
  //    規則:沒有表格 ⇒ 留 `max-w-`(長文字行過寬更難讀);有表格的列表頁一律吃滿寬
  //    (`#640` 守門在 `app/design-tokens.test.ts`)。
  return (
    <div className='mx-auto max-w-4xl space-y-4 py-10'>
      <h1 className='text-2xl font-semibold'>PCM 後台</h1>

      {/* 🔴 灰字一行 = Sean 2026-08-28 拍 `q1: 甲` 的那個形狀(「後台首頁一行灰字」)。
          舊了(> `FRESHNESS_STALE_HOURS`)或量不到 ⇒ 轉成 destructive 色,而**字一樣會出現**。
          ⚠️ 它只蓋本 repo 這半的供應商管線 —— 報價單那半(車款搜尋)與 feed 自己停更都抓不到,
             理由與 Sean 讀過的那句原話在 `lib/dashboard/freshness-read.ts` 檔頭。 */}
      <p
        data-testid='data-freshness'
        // 🔴🔴 **判準只讀 `abnormal` 一格,不在這裡自己再組一次**(R1 must-fix)。
        //    第一版寫 `fresh.stale || fresh.hoursAgo === null` ⇒ **漏掉未來時間戳**
        //    ⇒ 那一行會用平靜的灰字印「時間戳在未來」,而那是唯一一個確定有東西寫錯的世界。
        //    📌 文字層做對了、顏色層把它藏回去 —— 同一件事判兩次就會這樣。
        className={fresh.abnormal ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
      >
        {freshnessLabel(fresh)}
      </p>

      {/* 🔵 `⟦b4-FIT1⟧` 2026-09-01:上面那行蓋【供應商資料】, 這一行蓋【車款搜尋】。
          🔴 **兩行分開是刻意的, 不要合併成一行** —— 它們是兩條不同的管線、兩個不同的門檻
             (供應商 26 小時是推的 / 車搜 7 天是 Sean 拍的), 而合成一行之後
             「哪一半舊了」就答不出來了。
          🔴 判準同樣只讀 `abnormal` 一格, 不在這裡自己再組一次(理由同上面那格的 R1 must-fix)。 */}
      <p
        data-testid='fitment-freshness'
        className={fitment.abnormal ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
      >
        {fitmentFreshnessLabel(fitment)}
      </p>

      {/* 🔴🔴 2026-09-03:**零張時它印「0 張」, 不是什麼都不印** —— 那是本片的驗收條件不是風格。
          同一天量到三個「該叫才叫」的東西(車款排程 / 兩顆 env / 雙扣告警), 共同病是
          **沉默有兩種意思而收訊端分不出來**:「今天沒事」與「它壞了」印同一個空白。
          ⇒ 所以這一格是儀表:它每天都印一個值。
          🔴 顏色判準只讀 `count` 那一格, 不在這裡自己再組一次(同上面兩行那條 R1 must-fix)——
             而 `count === null`(量不到)也要亮, 因為那是「我們壞了」不是好消息。 */}
      <p
        data-testid='stuck-payment-count'
        className={
          stuckPayment.count === null || stuckPayment.count > 0
            ? 'text-destructive text-xs'
            : 'text-muted-foreground text-xs'
        }
      >
        {stuckPaymentLabel(stuckPayment)}
      </p>

      {/* 🔴🔴 這一區**不是「監控做好了」,它是「有一個地方看得到」** —— 沒人登入後台就沒人看見。
          主動會叫的告警是 3b,而 3b 卡在一個結構問題(它自己會變成第 7 支排程 ⇒ ⟦b4-CRON6b⟧)。
          ⚠️ 而它也答不出「有排程在跑而沒有人在看」:真排程那份(`cron.job`)後台讀不到,
             原因是**三道權限**不是我們沒去讀 —— 三道逐條在 `lib/dashboard/cron-heartbeat-read.ts` 檔頭。 */}
      <section data-testid='cron-health' className='rounded-lg border p-4'>
        <p className='text-sm font-medium'>排程心跳</p>
        {cron.unreadableReason !== null ? (
          <p className='text-destructive mt-2 text-xs'>量不到({cron.unreadableReason})</p>
        ) : (
          <ul className='mt-2 space-y-1'>
            {cron.jobs.map((j) => (
              <li
                key={j.jobName}
                data-testid={`cron-job-${j.jobName}`}
                // 判準只讀 `abnormal` 一格 —— 同 `freshness-read` 被 R1 抓到的那條:
                // 文字層與顏色層各判一次同一件事,它們一定會漂開。
                className={j.abnormal ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
              >
                {j.label}:{j.note}
              </li>
            ))}
          </ul>
        )}
        {/* 🔴 兩種漂移印**不同的句子**,而且各自附「該怎麼辦」——
            一個不附該怎麼辦的告警,看到的人會先花五分鐘重新推導一次。 */}
        {cron.neverBeat.length > 0 && (
          <p className='text-destructive mt-2 text-xs'>
            這幾支從來沒寫過心跳:{cron.neverBeat.join('、')} —— 去看它們接線了沒。
          </p>
        )}
        {cron.unknownJobs.length > 0 && (
          <p className='text-destructive mt-2 text-xs'>
            有東西在寫我們沒在看的心跳:{cron.unknownJobs.join('、')} —— 白名單過期了,補進去。
          </p>
        )}
      </section>

      {/* 🔴🔴 這一格**不是新做一個數字** —— 那個數字告警器每輪都在算(`get_email_outbox_deadman_counts`
          的 `signal2`),而它今天只送去告警器,**沒有任何人類的眼睛看得到它**。
          ⇒ Sean 2026-09-02 拍甲:「維持人工重排,而把『有幾封卡住』做成看得見的數字」。
          🔵 **為什麼放在首頁而不是 `settings/mail`**:那一頁是「你已經知道有事才會去」的頁,
             而這個數字的用途正是**告訴還不知道的人**。
          🛑 **不做成會叫的告警** —— Sean 2026-09-01 拍過零告警管道。 */}
      <section data-testid='dead-letter-count' className='rounded-lg border p-4'>
        <p className='text-sm font-medium'>寄不出去的信</p>
        {deadLetter.unreadableReason !== null ? (
          /* 🔴 「讀不到」與「一封都沒有」**不可以長一樣** —— 一個是我們壞了,一個是好消息。 */
          <p className='text-destructive mt-2 text-xs'>
            量不到({deadLetter.unreadableReason})—— 這<strong>不代表</strong>一封都沒有。
          </p>
        ) : deadLetter.total === 0 ? (
          /* 🔵 **帶一格範圍, 而不是加一個數字**(`-fc` 2026-09-02 nit 2 · `-f3` 判)。
             🔴 這個數字只數 `pending` / `failed` ⇒ 一封被 claim 之後 worker 掛掉的信留在
                `sending`, **不在這個數裡** ⇒ 而卡片會【主動說好消息】而不是留白。
             ⇒ 那是有上界的盲窗(`sweep-email-outbox.ts:26` 每輪 lease 回收 stale sending → failed,
                `:119` lease 硬下界 1 小時), 不是永久看不到 —— 但盲窗期間那句話會騙人。
             🔵 **所以補範圍不補計數**:一句話不會過期, 而一個 `sending` 的計數會把讀的人
                拉進「那個數字要怎麼解讀」的第五個世界。 */
          <p className='text-muted-foreground mt-2 text-xs'>
            目前沒有等待重試的信。(正在寄送中的不計)
          </p>
        ) : (
          <>
            <p className='mt-2 text-xs'>
              卡住 <strong>{deadLetter.total}</strong> 封 · 其中{' '}
              <strong className={deadLetter.dead > 0 ? 'text-destructive' : undefined}>
                {deadLetter.dead}
              </strong>{' '}
              封已放棄{deadLetter.deadExact ? '' : '(至少)'} —— 已放棄的要人去重排,才會再寄。
            </p>
            {/* 🔴 被截斷的數字**不可以印得像精確值** —— 那就是下一件事故。 */}
            {!deadLetter.deadExact && (
              <p className='text-destructive mt-1 text-xs'>
                卡住的信超過 {DEAD_LETTER_SCAN_CAP} 封,「已放棄」那個數是下界、不是實數。
              </p>
            )}
            {/* 🔵 這一句是【指標不是常數】:板上 ⟦15-SHIPGATE-F1⟧ 記著有一批因停線而死的信還在表裡,
                而**今天沒有機械方法把它們認出來**(要一支還沒人寫的 migration)。
                ⇒ 手打「其中 N 封是已知的」會在下次停線之後變成假的,而**過期時零訊號**。
                ⇒ 所以這裡寫一句不會過期的話,讓「為什麼它一直不歸零」有地方可問。 */}
            <p className='text-muted-foreground mt-1 text-xs'>
              這裡面可能含一批舊的、已知還沒清掉的信 —— 這個數字不會自己歸零。
            </p>
          </>
        )}
        <a className='mt-2 inline-block text-xs underline' href='/settings/mail'>
          去看是哪幾封
        </a>
      </section>

      {today === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          今日對帳載入失敗,這一區的數字暫時看不到。請稍後重新整理,或聯絡系統維護。
          <span className='block'>這頁其他功能不受影響。</span>
        </div>
      ) : (
        <TodaySummaryCards summary={today} />
      )}

      <div className='rounded-lg border bg-card p-6 text-card-foreground'>
        <p className='text-sm font-medium'>具名身分(M-4a M0-S2)</p>
        <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
          目前身分:
          <span className='text-foreground font-medium'>
            {actor ? actor.label : '尚未選擇'}
          </span>
          {ACTOR_SOURCE_COPY[copyKey]}
        </p>
        <form action={selectActorAction} className='mt-4 flex items-center gap-2'>
          {/* #388:欄名走共用常數 —— 三處都吃同一顆(`htmlFor`/`id` 綁 a11y、`name` 是 wire 契約)。 */}
          <label htmlFor={ACTOR_ID_FIELD} className='sr-only'>
            選擇具名身分
          </label>
          <select
            id={ACTOR_ID_FIELD}
            name={ACTOR_ID_FIELD}
            defaultValue={actor?.id ?? ''}
            className='border-input bg-background h-9 rounded-md border px-3 text-sm'
          >
            <option value='' disabled>
              選擇身分…
            </option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type='submit'
            className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
          >
            切換
          </button>
        </form>
      </div>
    </div>
  );
}
