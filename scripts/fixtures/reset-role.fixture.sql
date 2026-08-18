-- 🔴 這支是 scripts/migration-reset-role-guard.sh 的【正向對照測資】,不是要 apply 的 migration。
-- 🔴 絕對不可以放進 supabase/migrations/ —— 放進去下一發 db push 會把它推上正式庫。
-- 期望值恆為 1(它自己的性質,不是那支腳本常數的複本)。
RESET ROLE;
