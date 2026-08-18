// 🔴 這支檔是 `scripts/authz-failure-visibility.sh` 的【正向對照測資】,不是要修的 code。
//
// 為什麼需要它(G6 2026-08-18 提,已實測):
//   那支腳本數「裸 redirect 有幾個」。當真實樹數到 **0** 的那一天,
//   **「pattern 打錯所以永遠數到 0」與「真的沒有缺口」長得一模一樣**
//   ⇒ 那一格會變成恆綠而看起來很盡責 —— 正是本艦隊整晚在抓的那種格子。
//
// 它怎麼分辨:同一支 pattern 對本檔【必須】數到 1。
//   真實樹 0 而本檔 1 ⇒ 世界真的乾淨
//   兩邊都 0           ⇒ **是 pattern 壞了,不是缺口沒了**
//
// 🔴 本檔【不可以】放進 apps/ —— 放進去它會被真實樹的掃描自己數到,那就沒有分辨力了。
// 🔴 本檔的期望值【恆為 1】,不隨 EXPECT_BARE 走。改動本檔前先想:你是不是在拆掉那把尺的校準。
export async function fixtureAction(): Promise<void> {
  const auth = await authorizeAdminMutation();
  if (auth === null) redirect('/customers');
}
