// overflow-ruler.mjs — 「這個寬度下有沒有東西超出視窗 / 被切掉」的尺。
//
// 用法(playwright / devtools console,頁面必須開在 http://localhost:<port>):
//   const R = await import('http://127.0.0.1:3987/overflow-ruler.mjs');
//   await R.run(390, '某個只有這一輪才有的字')   // 第二參數 = 指紋，用來確認畫面真的是你這一輪的
//
// 🔴 **落筆前先看 `selfCheck.ok`。false ⇒ findings 一律作廢,不准拿去下結論。**
//    三條自檢每次量測都跑:
//      widthOk        window.innerWidth 必須等於你設的值(前任量到 609 而以為在量 390)
//      probeSeen      當場塞一個必定溢出的探針,尺必須看得見它
//      afterRemoval   拿掉探針後數字必須回到原值(防尺恆真、防殘留)
//
// 🔴 **為什麼不量 `document.scrollWidth - innerWidth`**(前一版的尺就是那樣,而它是瞎的):
//    頁面掛 `overflow-x:hidden`、或溢出的東西是 `position:fixed` 時,**不產生捲軸**
//    ⇒ 那個差在「有溢出」與「沒溢出」兩個世界印同一個 0 = 零判別力。
//    本尺改量每個元素自己的 `getBoundingClientRect()`,那個值不受裁切影響。
//
// 🔴 **被排除的不靜默丟掉**:祖先是橫向捲動容器、或被中間層祖先 `overflow-x != visible` 裁切的,
//    算它的設計(輪播 / 橫向清單 / 畫廊),移進 `skippedInHorizontalScroller`(附筆數與 class),
//    **報告時要一起附**。
//    ⚠️ 而 **body / html 的裁切【不排除】** —— 被 body 裁掉 = 內容真的被切了,那要報。
//
// ⚠️ 它量的是「有沒有東西超出視窗或被切」,**不是**「好不好看 / 好不好按」。
// ⚠️ MCP 傳輸會把中文 `text` 欄弄成亂碼;tag / class / 數字是好的,引用時只引後者。

export function run(expected, fingerprint) {
  const T = 1;
  const skipped = [];
  const scan = (v) => {
    const o = [];
    skipped.length = 0;
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const ov = Math.round(r.right - v), un = Math.round(-r.left);
      if (ov > T || un > T) {
        if (o.some((f) => f.e.contains(e))) continue;
        // 🔴 橫向捲動容器裡面的東西【本來就該】超出視窗(輪播/橫向清單)——
        //    把它們算成溢出 = 量錯東西。往上找到 body 為止,任一祖先可橫捲就跳過。
        let a = e.parentElement, inScroller = false;
        while (a && a !== document.body) {
          const as = getComputedStyle(a);
          // 元件【自己】裁切或自己可橫捲 ⇒ 那是它的設計(輪播/橫向清單),不是溢出。
          // 🔴 只認【中間層】祖先,不認 body/html —— 被 body 裁掉的東西是「內容被切了」,要報。
          if (as.overflowX !== 'visible') { inScroller = true; break; }
          a = a.parentElement;
        }
        // 不靜默丟掉:另外記一份,報告要一起附(掉了幾個、掉在哪)
        if (inScroller) { skipped.push({ tag: e.tagName.toLowerCase(), cls: String(e.className||'').slice(0,55), over: ov>T?ov:0 }); continue; }
        o.push({ e, tag: e.tagName.toLowerCase(), cls: String(e.className || '').slice(0, 55),
                 over: ov > T ? ov : 0, under: un > T ? un : 0, pos: s.position,
                 w: Math.round(r.width) });
      }
    }
    return o;
  };
  const v = innerWidth;
  const base = scan(v).length;
  const p = document.createElement('div');
  p.dataset.rulerProbe = '1';
  p.style.cssText = 'width:' + (v + 400) + 'px;height:20px;position:relative;left:0';
  p.textContent = 'PROBE';
  document.body.appendChild(p);
  const seen = scan(v).some((f) => f.e.dataset && f.e.dataset.rulerProbe === '1');
  p.remove();
  const after = scan(v).length;
  const body = document.body.innerText || '';
  return {
    url: location.pathname + location.search,
    fingerprintOk: fingerprint ? body.includes(fingerprint) : null,
    selfCheck: { ok: v === expected && seen && after === base,
                 vw: v, widthOk: v === expected, probeSeen: seen,
                 before: base, afterRemoval: after },
    findings: scan(v).map(({ e, ...r }) => r),
    skippedInHorizontalScroller: { count: skipped.length,
      classes: [...new Set(skipped.map((x) => x.cls))].slice(0, 6) },
  };
}
