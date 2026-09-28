// turbo-global-deps.test.ts —— 根目錄設定檔改了,前台與後台都要重建(2026-09-28)。
//
// Vercel 用 turbo-ignore 判斷要不要建置,而 turbo 只看各 workspace 自己的檔。
// 下面這幾支在根目錄、卻會改變 app 建出來的東西:
//   · .npmrc / package.json / pnpm-workspace.yaml —— 安裝方式、版本覆寫、catalog 版本
//     (根目錄 package.json 的 lint-staged 條目改了也會觸發全部重建,這是已知的代價)
//   · vercel.json —— 前台的安裝指令與部署區域
//   · tsconfig.base.json —— 兩個 app 的 tsconfig.json 都 extends 它
//   · scripts/build-with-stamp.sh —— 兩個 app 的 build 指令都跑它
// 沒有列進 turbo.json 的 globalDependencies 時,改了它們 Vercel 會跳過建置,
// 新設定要等下一次別的改動才上線(2026-09-28 turbo dry-run 實測:5 支都是 0 個建置)。

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const REQUIRED = [
  '.npmrc',
  'package.json',
  'pnpm-workspace.yaml',
  'vercel.json',
  'tsconfig.base.json',
  'scripts/build-with-stamp.sh',
];

const turbo = JSON.parse(readFileSync('turbo.json', 'utf8')) as {
  globalDependencies?: string[];
};

describe('turbo.json globalDependencies', () => {
  it.each(REQUIRED)('%s 有列進去', (file) => {
    expect(turbo.globalDependencies ?? []).toContain(file);
  });

  it.each(REQUIRED)('%s 檔案存在(改名或搬走時要一起改清單)', (file) => {
    expect(existsSync(file)).toBe(true);
  });
});
