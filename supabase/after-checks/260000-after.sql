-- 貼板對帳:20260905260000 ⟦b9-PUBLICVIEWALL⟧ —— **psql 版**
--
-- 🔴 **本支只有兩行**:`\set ON_ERROR_STOP on`(psql 專屬, 讓有 ERROR 時 rc 非 0)
--    + `\ir` 引入唯一那一份 DO 區塊。
--    ⇒ 📌 **內容只有一份, 兩邊漂移在結構上不可能發生**(codex R3 nit①)。
-- ⛔ **不要貼進 Supabase SQL Editor** —— `\` 開頭是 psql meta-command, 會在第一行報
--    `syntax error at or near "\"`(codex R2 MF①)。SQL Editor 請貼 `260000-after-sqleditor.sql`。
-- 🔬 **為什麼一定要那第一行**:實測 —— 拿掉它之後本檔【真的紅了、印出 32 格】而 **rc 仍是 0**;
--    加回去 ⇒ **rc=3**。
--    🛑 而更毒的是:`scripts/readonly-prod-sql.sh` 那道提醒是 `grep ON_ERROR_STOP <檔>` ——
--       只要檔頭註解裡提到這個字, **它就不警告了**, 而 rc 照樣是 0。
--       ⇒ 📌 **一個註解讓一道守門靜靜地變綠。**(已回報主視窗, 修法另一顆)

\set ON_ERROR_STOP on
\ir 260000-after-sqleditor.sql
