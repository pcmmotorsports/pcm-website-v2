// 「經銷零洩漏」的共用檢查(購物車、結帳兩個畫面的測試共用)。
//
// 🔴 2026-09-25 片 C(B2B 計畫 §9.4)為什麼改:頁尾加了「經銷商申請」入口(Sean 決定兩站都放),
//    原本「整頁不准出現『經銷』兩個字」會把這個入口當成外洩。主視窗 2026-09-25 裁甲並收窄:
//    · 只有「經銷」這兩個字的文字檢查排除 <footer>(頁尾是全站共用的導覽, 不是價格);
//    · price_store / priceByTier / 劃線價 / 呼叫端給的經銷價金額, 一律照原本對【整頁】檢查, 頁尾也不例外。
//    ⇒ 保護範圍沒有縮小:任何價格欄位或經銷價金額出現在頁尾, 照樣紅(負對照在 dealer-leak.test.ts)。
export function assertNoDealerLeak(container: HTMLElement, dealerAmounts: readonly string[] = []): void {
  const whole = container.textContent ?? '';
  const outsideFooter = container.cloneNode(true) as HTMLElement;
  // 只排除全站頁尾(HomeFooter 的 footer.ed-footer), 不排除頁面裡其他用 <footer> 包的區塊(Fable R1)
  outsideFooter.querySelectorAll('footer.ed-footer').forEach((f) => f.remove());
  const problems: string[] = [];
  if ((outsideFooter.textContent ?? '').includes('經銷')) problems.push('頁尾以外出現「經銷」');
  for (const token of ['price_store', 'priceByTier', ...dealerAmounts]) {
    if (whole.includes(token)) problems.push(`整頁(含頁尾)出現 ${token}`);
  }
  if (container.querySelector('s') !== null) problems.push('出現劃線價 <s>');
  if (problems.length > 0) throw new Error(`經銷零洩漏:${problems.join('、')}`);
}
