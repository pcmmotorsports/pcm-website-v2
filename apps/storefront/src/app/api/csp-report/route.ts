// CSP 違規回報的接收端(2026-09-29;計畫 ~/pcm-mailbox/計畫-安全標頭-20260928.md 第三節甲案)。
// 三站(www / b2b / admin)的 Report-Only 都送到這裡;只記一行、一律回 204,跑 7 天照回報補來源清單後移除。
// · 站別看回報內容的 document-uri 主機名,不信任查詢字串;不是三站之一就不記(外人偽造的內容)。
// · 只記網域與路徑,不記查詢字串、不記使用者資料。
// · 內容上限 8 KB:先看 content-length,沒有就邊讀邊數,超過就停。
// · 停損:單日超過 5,000 則就先把三站的 report-uri 拿掉(計畫第三節)。
// · 🔴 回報可以被偽造(任何人都能 POST 一則 document-uri 填 www 的內容,這裡無從驗真)。
//   7 天後補清單時,只採納真瀏覽器走主要流程時看得到的來源,不要把紀錄裡的網域直接抄進 script-src / connect-src。
// · 經銷站與前台同一份程式,經銷站也會部署這支路由;沒有人會打它,無害。

import { describeReport, readCapped } from '@/lib/csp-report';

const noContent = () => new Response(null, { status: 204 });

export async function POST(req: Request): Promise<Response> {
  const body = await readCapped(req);
  const line = body === null ? null : describeReport(body);
  if (line) console.warn(line);
  return noContent();
}
