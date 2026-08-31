# admin 前綴代理:剝掉 /rest/v1 轉給 PostgREST。
#
# 🔴 **為什麼需要它**:supabase-js 打的是 `/rest/v1/...`,而 PostgREST 在**根** ——
#    直連會回 `PGRST125 Invalid path specified in request URL`(runbook §4 的坑⑤)。
#
# ⛔ ~~🔴 **與顧客站那支的差別:這裡【沒有】`/auth/v1` 替身,而那是刻意的。**
#    admin 走 `ADMIN_DEV_BYPASS=1`(免登入)+ server 端 `service_role`,不經過 supabase auth。~~
#
# 🔴🔴 **2026-08-30:上面那句【不再成立】,舊字面留著劃掉。**
#    `apps/admin/src/lib/customers/manual-customer.ts` 打 `client.auth.admin.*`
#    (`:297` `getUserById` / `:368` `createUser`)⇒ **客戶管理這一塊就是走 supabase auth。**
#    在補這一段之前, 手動建單那一頁**兩條路都回** `AuthApiError: Invalid path specified in request URL`
#    ⇒ 板 `:433` 的 `#12` 因此**沒有人做得完**(不是產品做不到, 是鑽機少一段)。
#    ⇒ **所以現在有 `/auth/v1/admin/users` 兩支替身**(見下)。
#    ⚠️ **仍然成立的那半**:這條鏈**證不了 admin 的登入閘** —— 票是手貼的, 沒走真登入流程。
#
# 🔴 **只補 admin 真的會打的那兩支, 不多做**(當場量的:
#    `git grep -oE "auth\.admin\.[a-zA-Z]+" -- apps/admin/src` ⇒ `createUser` 1 · `getUserById` 4;
#    負對照現造方法名 ⇒ 0)⇒ **多做的每一支都是一個「它在這條鏈上恆綠」的新題目。**
import http.server, urllib.request, urllib.error, sys, json, subprocess, uuid as _uuid

UP = "http://127.0.0.1:" + sys.argv[1]


def _q(v):
    """SQL 字面轉義(單引號成雙)—— 只給本檔內部組 SQL 用。"""
    return "'" + str(v).replace("'", "''") + "'"
HOP = ('host', 'content-length', 'connection', 'transfer-encoding')


PG_PORT = None   # 由 argv[3] 帶進來;沒帶 ⇒ auth 替身停用(見 _auth 開頭)


def _sql(q, *args):
    """對拋棄式 PG 跑一句 SQL,回一行 JSON(沒有列 ⇒ None)。

    🔴 走 `psql -At` + `$1..$n` 綁參數, **不做字串拼接** —— 這支替身收的是
       瀏覽器送來的 JSON, 拼字串等於在鑽機上開一個注入面。
    """
    out = subprocess.run(
        ['psql', '-h', '/tmp', '-p', str(PG_PORT), '-U', 'postgres', '-d', 'postgres',
         '-At', '-v', 'ON_ERROR_STOP=1', '-c', q, *[]],
        input='\n'.join(args), capture_output=True, text=True)
    if out.returncode != 0:
        return ('ERR', out.stderr.strip())
    v = out.stdout.strip()
    return ('OK', v or None)


def _user_json(row):
    """把 auth.users 一列包成 supabase-js 認得的形狀。"""
    return row


class H(http.server.BaseHTTPRequestHandler):
    # ── /auth/v1/admin/users 替身(只有兩支;2026-08-30 加)────────────────
    def _auth(self, path, body):
        if PG_PORT is None:
            return False
        # GET /auth/v1/admin/users/<uuid>
        if self.command == 'GET' and path.startswith('/auth/v1/admin/users/'):
            uid = path.rsplit('/', 1)[-1].split('?')[0]
            try:
                _uuid.UUID(uid)
            except ValueError:
                self.emit(400, {}, b'{"message":"invalid uuid"}'); return True
            st, v = _sql(
                "select coalesce(json_agg(t)->0,'null')::text from ("
                "  select id::text, email, raw_app_meta_data as app_metadata,"
                "         raw_user_meta_data as user_metadata, created_at"
                "    from auth.users where id = %s::uuid) t" % _q(uid))
            if st == 'ERR':
                self.emit(500, {}, json.dumps({'message': v}).encode()); return True
            if v in (None, 'null'):
                self.emit(404, {}, b'{"message":"User not found"}'); return True
            self.emit(200, {'Content-Type': 'application/json'}, v.encode()); return True
        # POST /auth/v1/admin/users
        if self.command == 'POST' and path.rstrip('/') == '/auth/v1/admin/users':
            try:
                p = json.loads(body or b'{}')
            except ValueError:
                self.emit(400, {}, b'{"message":"bad json"}'); return True
            uid = str(_uuid.uuid4())
            st, v = _sql(
                "with ins as ("
                "  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)"
                "  values (%s::uuid, %s, %s::jsonb, %s::jsonb) returning *)"
                " select coalesce(json_agg(t)->0,'null')::text from ("
                "   select id::text, email, raw_app_meta_data as app_metadata,"
                "          raw_user_meta_data as user_metadata, created_at from ins) t"
                % (_q(uid), _q(p.get('email', '')),
                   _q(json.dumps(p.get('app_metadata') or {})),
                   _q(json.dumps(p.get('user_metadata') or {}))))
            if st == 'ERR':
                # 🔴 **唯一鍵撞到要回 422 而不是 500** —— admin 那支靠它做冪等
                #    (`manual-customer.ts` 檔頭逐字:同一個佔位信箱重送 ⇒ 那不是失敗)。
                code = 422 if 'duplicate key' in v or 'unique' in v.lower() else 500
                self.emit(code, {'Content-Type': 'application/json'},
                          json.dumps({'message': v, 'code': code}).encode()); return True
            self.emit(200, {'Content-Type': 'application/json'}, (v or 'null').encode()); return True
        return False

    def relay(self):
        path = self.path
        if path.startswith('/rest/v1'):
            path = path[len('/rest/v1'):] or '/'
        body = None
        cl = self.headers.get('Content-Length')
        if cl:
            body = self.rfile.read(int(cl))
        if self._auth(self.path, body):
            return
        req = urllib.request.Request(UP + path, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in HOP:
                req.add_header(k, v)
        try:
            with urllib.request.urlopen(req) as r:
                self.emit(r.status, r.headers, r.read())
        except urllib.error.HTTPError as e:
            # 🔴 錯誤也要原樣轉回去 —— 吞掉的話 PostgREST 的 400/404 會變成代理的 500,
            #    而那會讓「查詢寫錯」看起來像「環境壞了」。
            self.emit(e.code, e.headers, e.read())

    def emit(self, status, headers, data):
        self.send_response(status)
        for k, v in headers.items():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = do_HEAD = relay

    def log_message(self, *a):
        pass


# 🔴 綁 127.0.0.1,不綁 0.0.0.0 —— 同 up.sh 檔頭那條(免登入的東西不對區網開)。
if len(sys.argv) > 3:
    PG_PORT = int(sys.argv[3])
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
