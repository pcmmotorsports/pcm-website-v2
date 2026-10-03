// zod-config.ts —— zod 全域設定 jitless(⟦後台 CSP 改強制⟧ 2026-10-04, Sean 批 計畫-網站安全標頭與網域-20261004.md Q1 甲)。
//
// 為什麼:zod 4.4.3 建立 object schema 時會跑一次 `new Function("")`, 測試瀏覽器准不准 eval
//   (node_modules zod/v4/core/schemas.js:970-972 → util.js allowsEval)。CSP 改成強制後那一下會被擋,
//   zod 自己會改用不需要 eval 的方式, 功能不受影響, 但每次載入都送一則違規回報, 真正被擋的東西會被淹沒。
//   jitless = 不跑那個測試、一律用不需要 eval 的方式驗證(較慢, 表單規模感覺不到)。
// 🔴 必須在任何 schema 建立【之前】執行:jitless 是在建 schema 的當下讀的, 不是驗證時才讀。
//    ⇒ 本套件每一支會建 schema 的檔案, 第一行都要 `import './zod-config';`(zod-config.test.ts 只守得到 index:
//      zod 只在建 object schema 時跑測試, 只建字串 schema 的檔案漏了也不會紅)。
// 前台(storefront)也會載入本套件 ⇒ 一併生效;前台的 CSP 目前仍是 Report-Only, 這裡只是先少一則回報。

import { z } from 'zod';

z.config({ jitless: true });
