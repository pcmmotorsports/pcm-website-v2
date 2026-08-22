// dev-db-guard.ts — 擋住「在指向【正式庫】的工作樹上跑 next dev」。
//
// 🔴 **它擋的不是一個設定錯誤,是一個【免登入的正式站後台】**:
//    主樹 `apps/admin/.env.local` 指向正式庫且帶 `SUPABASE_SERVICE_ROLE_KEY`
//    (2026-08-22 實測:`grep -c 'bmpnplmnldofgaohnaok'` ⇒ 1、`grep -c 'SUPABASE_SERVICE_ROLE_KEY'` ⇒ 1)。
//    而 dev 走 `ADMIN_DEV_BYPASS=1`(`proxy.ts:16`)⇒ 不需要登入。兩件合起來 =
//    任何人在主樹跑一行 `next dev`,就開了一個**不用密碼的正式站後台**。
//
// 🔴 **為什麼是機制不是規則**(PCM 機制優先律要求先答這一題):
//    `docs/design/admin-design-system.md` 檔頭教的那條路逐字是
//      `cd apps/admin && ADMIN_DEV_BYPASS=1 npx next dev -p 3001 -H 127.0.0.1`
//    ⇒ **它不經過 package.json 的任何一個 script**(`predev` 這類閘對它零作用;
//       而 pnpm 9.15.0 確實會跑 pre-script —— 那不是它失效的原因,**分母太窄才是**)。
//    ⇒ 規則寫在哪裡都一樣:它是一句話,而「照做」與「沒照做」在畫面上長得完全一樣。
//    2026-08-22 夜六個窗裡至少一個差點這樣做,擋住它的是那個窗自己想到要先查 —— **那是運氣**。
//
// 🔴 **為什麼判定寫在這支檔、而不是直接寫進 `next.config.ts`**:
//    next.config 跑不了測試。這支是純函式 ⇒ **「該紅的」與「該綠的」兩個世界都演得出來**
//    (見 `dev-db-guard.test.ts`)。next.config 只負責「拿判定去 throw」。

/** 正式庫的 Supabase project ref(2026-08-22 由主樹 `apps/admin/.env.local` 實測命中)。 */
export const PCM_PROD_PROJECT_REF = 'bmpnplmnldofgaohnaok';

/** 逃生門:設 `=1` ⇒ 只警告不擋。給「我就是要在本機連正式庫」那種正當用途。 */
export const PROD_DB_BYPASS_ENV = 'PCM_ALLOW_PROD_DB_DEV';

export type ProdDbInDevVerdict =
  | { kind: 'ok' }
  | { kind: 'bypassed'; matchedKey: string }
  | { kind: 'blocked'; matchedKey: string };

/**
 * 掃 **整個 env**、不是只掃幾個具名變數。
 *
 * 🔴 具名清單會漂:今天是 `NEXT_PUBLIC_SUPABASE_URL`,明天有人加一支
 *    `SUPABASE_DB_URL` / `DATABASE_URL`,而那時候這道閘會**安靜地回綠**。
 *    ⇒ 判準綁「這個 ref 出現在任何一個環境變數裡」,而**回報時指名是哪一個 key**
 *      —— 不指名的話,擋下來的人不知道要去改哪裡。
 */
/** 🔴 刻意**不用** `NodeJS.ProcessEnv` —— 本 repo 的那個型別要求 `NODE_ENV` 必填,
 *  會逼測試在每個案例塞一個與本判定無關的欄位。本函式只需要「一包 key→值」。 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export function checkProdDbInDev(env: EnvLike): ProdDbInDevVerdict {
  const matchedKey = Object.keys(env).find((key) => env[key]?.includes(PCM_PROD_PROJECT_REF));
  if (matchedKey === undefined) return { kind: 'ok' };
  if (env[PROD_DB_BYPASS_ENV] === '1') return { kind: 'bypassed', matchedKey };
  return { kind: 'blocked', matchedKey };
}

/** 擋下來時印給人看的字。**要能讓他知道下一步做什麼**,不只是說「不行」。 */
export function describeProdDbInDev(matchedKey: string): string {
  return [
    '',
    '🔴 這個工作樹的環境變數指向【正式庫】,next dev 已停止。',
    `   命中的變數:${matchedKey}(值含 ${PCM_PROD_PROJECT_REF})`,
    '',
    '   在這裡跑起來 = 一個【不用登入】的正式站後台(dev 走 ADMIN_DEV_BYPASS)。',
    '',
    '   要看畫面,換一個沒有 .env* 的工作樹跑,例如 /private/tmp/pcm-refund-4c。',
    `   真的要在本機連正式庫:${PROD_DB_BYPASS_ENV}=1 再跑一次(只警告不擋)。`,
    '',
  ].join('\n');
}
