// dev-auth-bypass.ts — dev 登入 bypass 的判定(MAIN-127 ⑤,Fable R2 nit-6)。
// 住在 lib 不住在 proxy.ts:Next 的 proxy 是特殊入口檔,只留 `proxy` / `config` 約定 export
// (codex R1 nit);本檔 runtime-neutral —— 只 import 純函式,無 node:fs / node:crypto。
import { checkProdDbInDev, type EnvLike } from './dev-db-guard';

/**
 * 🔴 dev bypass 的三個條件:非 production、顯式 ADMIN_DEV_BYPASS=1、**DB 必須本機**。
 *    第三條是本片新加的:dev bypass + 指向正式庫的 env = 免登入的正式站後台;
 *    next.config 的啟動閘只擋 `next dev`,而這一道跑在 app 層 ⇒ **任何啟動路徑都經過**
 *    (含 next.config 接不到的 custom server)。
 *    · 順序刻意:production 先短路 ⇒ production 下 DB 判斷【根本不執行】,行為與改前逐字相同。
 *    · NODE_ENV≠production 但≠development(staging/test/漏設)沿用既有拍板:fail-closed 錨在
 *      **正向 flag**(ADMIN_DEV_BYPASS 預設不存在=擋),本片只收緊、不重設那道邊界。
 *    · 🔴 逃生門(PCM_ALLOW_PROD_DB_DEV=1)**不延伸到這裡**(codex R2 must-fix):
 *      它的語意只有「允許 dev server 連遠端庫」,不是「授權免登入」。兩個 flag 一起設
 *      若仍放行 bypass,就精確重建了本片要消滅的「免登入正式站後台」—— 所以判準是
 *      `kind === 'ok'`(字面上的「DB 必須本機」),不是 `!== 'blocked'`。
 *      代價誠實寫:逃生門 + 遠端庫的 admin 會停在登入牆,而本機沒有報價單發起端 ⇒ 進不去。
 *      那不是 bug —— 「免登入 + 正式庫」本來就不該有低摩擦的路。
 */
export function isDevAuthBypassEnabled(env: EnvLike): boolean {
  if (env.NODE_ENV === 'production') return false;
  if (env.ADMIN_DEV_BYPASS !== '1') return false;
  return checkProdDbInDev(env).kind === 'ok';
}
