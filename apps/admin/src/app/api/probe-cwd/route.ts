// 🔴🔴 **本檔是【一次性量具】—— 拿到那個字串、寫進 plan §12.8 之後就刪掉它。**
//    (`~/pcm-mailbox/線-出貨-plan-412-伺服器產PDF-20260830.md` **§12.7**;主視窗-87 2026-09-03 批。
//     ⚠️ 那份 plan 的節號:設計在 §12.8, 而讀數要寫進 §12.7 —— 兩處都要, 不是二選一。)
//    ⚠️ **而「刪掉」這件事沒有任何東西會提醒** ⇒ 🔴 **所以退場有【兩個】載體, 不是一個**:
//    ① 本行(而它只有【打開這支檔的人】看得到, 而打開它的前提正是「有人想起它還在」)
//    ② 🔴 `docs/launch-todo.md` 的 `⟦ship-PROBECWD1⟧` —— **那張板子有人在數、態是封閉集**
//       (code-reviewer must-fix:plan §12.8-d ② 逐字要求兩件事, 而我原本只做了①)
//
// ══ 它要回答什麼 ══════════════════════════════════════════════════════════
// storefront 那條 PDF route 在正式站量到 `cwd=/var/task/apps/storefront`,
// 而**丁**(`apps/storefront/src/lib/print/statement-pdf.ts` 的候選②)的兩個 base
// 就是照那個 cwd 推出來的。
// 🔴 **而 admin 是【另一個 Vercel 專案】** ⇒ 它的 `cwd` 沒有人量過
//    ⇒ 照抄丁的 base 到 admin = 拿 A 的讀數去答 B。
//
// ══ 為什麼是「一條會 500 的 route」而不是別的 ═══════════════════════════════
// ⛔ ~~掛在 admin 既有的 error log 上~~ ⇒ 主視窗-87 撈 Vercel API 實查:
//    `get_runtime_errors` since=7d ⇒ **1 個錯誤群組**(而它與字型無關);
//    `get_runtime_logs` since=24h level=[error,warning] ⇒ **表格是空的**
//    ⇒ 🔴 **admin 今天幾乎沒有任何 log 在叫 ⇒ 掛上去也印不出東西。**
// ⛔ ~~撈 stack 裡的絕對路徑~~ ⇒ **stack 說「檔在哪」, `cwd` 說「行程站在哪」** —— 兩者可以不一樣。
// ⛔ ~~加一條無條件印的 log~~ ⇒ 一條永遠在叫的 log = 「閘死於誤報」的同族(主視窗-87 不批)。
// ✅ ⇒ **剩下的是這一條。**
// 🔴🔴 ⛔ ~~而它成立的理由是「它保證會失敗, 所以它保證會印」~~ **那句是假的, 而它錯在因果**
//    (code-reviewer 2026-09-03 must-fix):**印它的是下面那行【無條件】的 `console.error`**,
//    它跑在 `return` **之前** ⇒ **回 200 也一樣印。500 與「會不會印」沒有關係。**
//    🛑 **而同一段話上面才剛否決「無條件印的 log」** ⇒ 我否決了一個做法, 然後在下一句用了它。
// ✅ **真正的差別是【範圍】不是【狀態碼】**:那條被否決的是掛在**正常流量路徑**上的無條件 log
//    (每個請求都叫);而這一條**沒有任何地方連到它** ⇒ **只有知道網址的人打得開** ⇒ 它一輩子叫幾次
//    等於**有人手動打幾次**。⇒ 📌 **它不是「靠失敗才印」, 是「靠沒有人打」才安靜。**
//
// ══ 三個「本來會安靜出錯」的地方 ═══════════════════════════════════════════
// 🔴 ① **目錄名不能用 `_` 開頭** —— Next App Router 把 `_foo` 當**私有資料夾、不路由**
//    ⇒ 我原本在 plan 裡寫 `api/_probe/cwd`, **那條路徑打不開, 而它不會報錯。**
// 🔴 ② **必須是 dynamic** —— 若它被靜態預算(build 期執行), 印出來的是**建置容器的 cwd**,
//    **不是 Lambda 的** ⇒ 兩個值長得一樣可信 ⇒ 拿到就會被當答案。
//    (admin 今天零靜態 route:build 輸出的 `○ (Static)` 那一行在 admin 段 grep ⇒ 0;
//     而**不靠那個現況**, 下面明寫 `force-dynamic`。)
// 🔴 ③ **不印任何客人資料** —— 它只印兩個路徑字串, 不吃參數、不讀 DB、不讀檔。
//
// 🔵 **授權那半不必自己做**:`apps/admin/src/proxy.ts:84` 的 matcher
//    `'/((?!_next/static|_next/image|favicon.ico).*)'` 除靜態資源外全涵蓋、`:41` 預設擋
//    ⇒ **未登入打它會被導去 `/start`, 一個字都不會印** ⇒ 它不對外洩漏路徑。
import { NextResponse } from 'next/server';

// 🔴🔴 **`runtime = 'nodejs'` 不可省**(code-reviewer must-fix):admin 既有三條 route
//    **每一條都釘了**(`api/sso/start:15` · `api/sso/callback:32` · `api/session/renew:37`),
//    而我原本漏了。⇒ 🛑 **Edge runtime 底下 `process.cwd` 不存在** ⇒ 這條 route 會回 500 而
//    **零讀數** —— 而「拿到那個讀數」是這支檔**唯一**的存在理由。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  // 🔵 **兩個值一起印, 讓下一個人自己比** —— `cwd` 是【行程站在哪】,
  //    `dirname` 是【這支檔被放在哪】。⚠️ **「不同 route 會不會有不同 cwd」未驗**
  //    (`process.cwd()` 是行程層的值, 而 Vercel 可能把不同 route 拆進不同 Lambda)
  //    ⇒ 這兩個值若哪天對不起來, 差異會顯示在這裡。
  let here = 'unknown';
  try {
    // 🔴 不用裸 `__dirname` —— 它在 ESM 輸出下不存在, 而**存取不存在的識別字會 throw**
    //    ⇒ 一支「用來拿讀數」的探針因為拿讀數而爆掉, 就什麼都印不出來。
    // 🔴🔴 **後備【不用 `new URL('.', import.meta.url)`】**(2026-09-03 實測):
    //    那個寫法會讓 build 印 `Warning: Module not found: Can't resolve '.'`
    //    —— 打包器把那個 `'.'` 當成**要解析的模組**。
    //    ⇒ 📌 **build 照樣綠(警告不影響 rc)** ⇒ 只讀 rc 的人看不到它。
    //    ✅ 改成直接印 `import.meta.url` 原字串:它已經含有這支檔的位置, 而**不需要任何解析**。
    // ⚠️ **`import.meta.dirname` 在【打包後的 route】存不存在, 這一格未量**(code-reviewer nit):
    //    `apps/admin/next.config.ts:39` 有同款寫法, 而那發 2026-08-23 探針量的是
    //    **SWC-CJS 的 config loader**, 不是打包後的 route ⇒ **讀數不可轉。**
    //    ⇒ 🔵 而那不影響本檔的用途:拿不到就退到 `import.meta.url`, 兩者都答得出「這支檔在哪」。
    here = import.meta.dirname ?? import.meta.url;
  } catch {
    // 吞掉:拿不到 dirname 不該讓 cwd 那一半也消失。
  }
  // 🔵 標籤寫 `dirname|url=` 而不是 `dirname=`(code-reviewer nit):後備拿到的是
  //    `import.meta.url`(一個 `file://…/route.js`), **而讀的人正在找一個目錄**
  //    ⇒ 標成 `dirname=` 會讓一個 URL 被讀成目錄。
  console.error(`[admin/probe-cwd] cwd=${process.cwd()} · dirname|url=${here}`);
  // 🛑 回 500 而不是 200:**絕對不可以有任何地方連到它**, 而 500 讓誤連的人當場看得出來
  //    (板上記過「一顆連到空網址的按鈕比沒有按鈕糟」)。
  return new NextResponse(null, { status: 500 });
}
