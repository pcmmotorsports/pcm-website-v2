// safe-log.ts — 「印 log 這件事永遠不改變控制流」的兩支小工具(#900 codex R1 findings 1/2/3/4)
//
// 🔴 為什麼是一支共用檔, 而不是在兩個 catch 裡各寫一份:
//   `safeErrorName` 下面那段註解記著它**第一版是錯的、codex 當場表演給看**(`err.name` 可寫)。
//   一份被打過的白名單, 複製成兩份就會 drift —— 而 drift 的方向是**多印一點東西**,
//   那正是它要擋的事。
//   ⇒ 原本住在 `app/api/cron/anomaly-alert/route.ts`(私有), 本片**整段搬出來、一個字沒改**,
//     只加了 `export`。那支 route 改成 import 它 ⇒ 它既有的測試就是「搬家沒改行為」的證據。
//
// 🔴 兩支的分工(不要混):
//   `safeErrorName` 管【印什麼】—— 第三方決定的字串不進 log。
//   `safeLog`       管【印不出來會怎樣】—— console 自己拋, 也不得改變控制流。
//   findings 1/2 是後者:**一個 catch 區塊裡的任何新語句, 都在那個 catch 的保護範圍外面。**

/**
 * 例外 → 一個【由白名單決定】的識別字。J-003 MF-1 的修法,而它的形狀是 codex 對抗審查逼出來的。
 *
 * 🔴 我第一版寫的是 `err instanceof Error ? err.name : typeof err`,並在註解裡宣稱
 *    「類別名是一個封閉集合的識別字,永遠不含密鑰」。**那句話是假的,而 codex 當場表演給我看:**
 *      const e = new Error('safe'); e.name = 'SECRET_IN_NAME';   ⇒ e.name === 'SECRET_IN_NAME'
 *    `name` 是一般可寫欄位(實例自帶、子類自訂、`Error.prototype.name` 被覆寫都算)
 *    ⇒ 只要哪天有人寫一個 name 帶動態內容的 Error 子類,密鑰就從這條路進 log,
 *      **而那正是這個 catch 當初刻意只記固定碼要擋的那件事**(訊息面 drift)。
 * ⇒ 所以封閉集合要【由這裡造出來】,不能假設它本來就是:
 *   認得的就照實印,不認得的一律 'other'。'other' 本身也有訊息(= 出現了不尋常的東西)。
 *
 * 🔴 而它一步都不可以自己 throw —— 這是 fail-closed 路徑上的最後一段:
 *    這裡 throw ⇒ console.error 那行不會跑、503 也不會回,**變成 500 而且零 log**
 *    ⇒ 比修之前更糟。`instanceof` 與讀 `.name` 對 Proxy 都可能 throw(codex A-2),故整段包 try。
 */
export function safeErrorName(err: unknown): string {
  try {
    if (err instanceof Error) {
      const name: unknown = err.name;
      // 🔴🔴 **這裡刻意用 `switch` 而不是一個陣列 + `.includes(name)`** —— codex R2 finding 1, must-fix。
      //
      //   `.includes` 是 `Array.prototype` 上的方法 ⇒ **攻擊面在我們的碼之外**:
      //   一個惡意的 `name` getter 可以先做 `Array.prototype.includes = () => true`,
      //   再回傳 `'prime=SECRET'` ⇒ 白名單放行 ⇒ **敏感字串直接寫進 log**。
      //   (codex 逐字:「白名單判斷不能依賴可被覆寫的 prototype method」。)
      //
      //   `switch` 用的是規格層的嚴格相等(StrictEqualityComparison)⇒ **沒有任何方法查找可以被換掉。**
      //   同理不能改用 `indexOf` / `some` / `hasOwnProperty` / `Object.keys` —— 那些全是同一族。
      //
      //   📌 這是這一族的**第三次**:①`err.name` 可寫(第一版)②`Array.prototype.includes` 可覆寫(本次)
      //     母題:**白名單若靠一個「可以被外面換掉的東西」來判斷, 那它就不是白名單。**
      //   ⚠️ 驗收不是「看起來安全」:`safe-log.test.ts` 有一格**真的去覆寫 prototype** 再打一次,
      //     並附一發活性對照證明那個覆寫真的生效了。改這段前先看那兩格。
      switch (name) {
        // ECMAScript 規格定義的錯誤建構子名稱 —— 這是一個【真的】封閉集合,不是假設出來的。
        case 'Error':
        case 'EvalError':
        case 'RangeError':
        case 'ReferenceError':
        case 'SyntaxError':
        case 'TypeError':
        case 'URIError':
        case 'AggregateError':
          return name;
        default:
          // 認不得的一律 'other'。**'other' 本身也有訊息**(= 出現了不尋常的東西)。
          return 'other';
      }
    }
    // ⚠️ `instanceof` 走 `Symbol.hasInstance`, **它也可以被覆寫** —— 而這一格**方向是安全的**:
    //   · 騙成 true(非 Error 被當 Error)⇒ 照樣進上面那個 switch ⇒ 認不得 ⇒ `'other'`
    //   · 騙成 false(真 Error 被當非 Error)⇒ 掉到這一行 ⇒ `'other'`
    //   兩個方向都往**少講一點**倒, 不會往「多印一點」倒 ⇒ 不需要再加一道。
    return 'other';
  } catch {
    // 讀 err 本身就會爆(Proxy / getter throw)⇒ 仍然要有一個字給觀察者。
    return 'other';
  }
}

/**
 * 印一行 log, 而**印不出來永遠不改變控制流**。
 *
 * 🔴 存在理由(#900 codex R1 findings 1/2, must-fix):
 *   原本兩處新增的 `console.*` 直接寫在 catch 區塊裡 ⇒ console 自己拋 ⇒ 逃出那個 catch:
 *     · `charge-actions.ts` 那處 ⇒ 落到 `chargePaymentAction` 外層 generic catch ⇒ formError
 *       ⇒ client 釋放按鈕 ⇒ 客人重按 ⇒ **雙扣**
 *       (而那條不變式是 `charge-actions.ts` 自己的 docstring 寫的 ——
 *        「絕不落到 `chargePaymentAction` 的外層 generic catch」)
 *     · `payment-status/route.ts` 那處 ⇒ 本來回 pending 200 變成未捕捉例外
 *
 * 🔴 而它**不記下印失敗這件事** —— 沒有地方可以記(要記也得用 console)。
 *   ⇒ 射程:它保證的是「不會更糟」, **不是**「log 一定出得來」。
 *   ⚠️ 連帶:`console` 壞掉的世界與正常世界, 在行為上**刻意**長得一樣 ——
 *      那是本函式的目的, 不是它的盲點。log 出不出得來要去 log 那端看, 而**沒有人在看**。
 */
export function safeLog(
  level: 'info' | 'error',
  message: string,
  fields: Record<string, unknown>,
): void {
  try {
    console[level](message, fields);
  } catch {
    // 印不出來就算了。這支函式存在的唯一理由就是這一行的空。
  }
}
