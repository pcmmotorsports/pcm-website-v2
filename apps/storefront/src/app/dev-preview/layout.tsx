// dev-preview/layout.tsx — #385:正式站把整個 `/dev-preview/*` 關成 404,dev / preview 環境照常可用。
//
// **為什麼是 layout 不是 middleware**:巢狀 layout 天然包住這個 segment 底下**每一頁**(今天 8 區,
// 以後新增的自動繼承)⇒ 一處守門、零遺漏,而且不動 `middleware.ts` / `next.config`(那會落鐵則 12④
// 平台設定、把一片純前台守門升成高風險片)。
//
// 🔴 **判準是 fail-closed 的:預設關,只有「明確認得出是非正式環境」才開。**
//   | 環境 | `VERCEL_ENV` | `NODE_ENV` | 結果 |
//   |---|---|---|---|
//   | Vercel production | `'production'` | production | **404** ← 本片目標 |
//   | Vercel preview | `'preview'` | production | 開 |
//   | 本機 `next dev` | 未設 | development | 開 |
//   | 本機 `next build && start` | 未設 | production | **404**(也正是測試守得到它的原因) |
//   | 部署但讀不到 `VERCEL_ENV` | 未設 | production | **404**(見下,刻意往關的方向倒) |
//
// ⚠️ **preview 會不會也變 404 = 未確認**(誠實申報,別讓下一個人以為壞了)。取決於這個 env 是
//   在 build 期還是 request 期被讀:
//   · **量到的事實**:本片前後兩次 `next build` 都印 `ƒ /dev-preview/*`(dynamic、非預渲染)——
//     `ƒ` **不是本片造成的**,加 layout 前就是 `ƒ`(移開本檔重跑 build 對照過)⇒ 這些頁本來就每次請求
//     在 server 上跑,理論上讀的是 **runtime** env,而 Vercel 預設會把系統變數注入 runtime ⇒ preview 正常。
//   · **另一條路**:若 Next 仍在 build 期把它固定下來,則因 Turborepo 2 預設 **Strict** env mode
//     (官方逐字「Strict Mode will filter out environment variables that come from your CI vendors
//     until you've accounted for them」)、而 `VERCEL_ENV` **不在** `turbo.json` 的 build `env` 清單裡
//     ⇒ 讀不到 ⇒ 落到 `NODE_ENV` 那條 ⇒ **preview 也 404**。
//   兩條路的正式站結果**都是 404**(本片目標達成),差別只在 preview 會不會被連坐。
//   ⇒ 要讓 preview 一定回得來:`turbo.json` 的 `build.env` 加一筆 `"VERCEL_ENV"`。**本片刻意不動它**
//     (平台設定、屬另一層批准),而且加完**本檔判準不必跟著改**。真相由第一次 preview 部署當場揭曉。
//
// ⚠️ 另一個「讀不到」的來源:Vercel 專案若關掉「Automatically expose System Environment Variables」,
//   runtime 也拿不到 `VERCEL_ENV`。兩種讀不到都落在**關**的那一邊 ⇒ 不會出現「以為擋住了其實沒擋」。
//
// 🔴 **本閘擋不住什麼**(命名前先答,依 memory `feedback_control-named-beyond-its-actual-power`):
//   · 擋不住「有人把不該公開的東西寫進 `dev-preview/*/fixtures.ts`」——那些字面仍在 **git 與 JS bundle** 裡;
//     本閘只讓**正式站的網址**進不去,不等於內容沒外流。backlog #385 的 C 案(fixtures 檔頭寫明
//     「視同公開」)仍然值得做,兩者不互斥。
//   · 擋不住已經被別人抓走的舊快照 / 快取。
//   · 擋不住 admin 或別的 app —— 本檔只管 storefront 這棵路由樹。

import { notFound } from 'next/navigation';

/** Vercel 上「不是正式站」的兩個值(`development` = `vercel dev`)。 */
const NON_PRODUCTION_VERCEL_ENVS = new Set(['preview', 'development']);

/**
 * 這個環境能不能看 `/dev-preview/*`。**純函式**,測試直接餵矩陣,不必起 server。
 *
 * 🔴 讀不到 `VERCEL_ENV` 時**不是**放行,而是退回看 `NODE_ENV`:production build 一律關。
 *    這條就是 fail-closed 的支點 —— 拿掉它,任何讀不到系統變數的正式部署都會變成全開。
 */
export function isDevPreviewReachable(env: {
  VERCEL_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
}): boolean {
  if (env.VERCEL_ENV !== undefined) return NON_PRODUCTION_VERCEL_ENVS.has(env.VERCEL_ENV);
  return env.NODE_ENV !== 'production';
}

export default function DevPreviewLayout({ children }: { children: React.ReactNode }) {
  if (
    !isDevPreviewReachable({
      VERCEL_ENV: process.env.VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
    })
  ) {
    // `notFound()` 丟出 Next 的 NEXT_HTTP_ERROR_FALLBACK ⇒ 渲染 not-found、回 404。
    // 對「知道網址的人」與「亂試的人」回同一個 404,不揭露這裡有東西。
    notFound();
  }
  return children;
}
