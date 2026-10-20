# -*- coding: utf-8 -*-
"""F9「感谢接力」权限边界回归：确认手机号只会给到该看的人。

角色：
  alice(id=2) = 失主，也是 claim#1 的申请人（雨伞被 bob 捡到）
  bob(id=3)   = 拾取者，招领的发布者
  carol(id=4) = 无关第三方  ← 最关键，必须拿不到

设计原则（与后端实现一致）：
  - /pickup/contact/{claimId}：仅「申请人本人」可见拾取者手机号，其他人 403
  - /pickup/approved/{itemId}：仅「发布者本人」返回认领人手机号；
    其他人返回 data=null（不报错，前端据此走无卡片分支）
所以对 approved 的第三方断言是「data 为 null 且不含手机号」，而不是 403。
"""
import json
import sys
import urllib.request
import urllib.error
import http.cookiejar

BASE = 'http://localhost:8080'
PHONE_PICKER = '13800000002'   # bob 的手机号
PHONE_OWNER = '13800000001'    # alice 的手机号


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))

    def req(self, method, path, body=None):
        data = json.dumps(body).encode('utf-8') if body is not None else None
        r = urllib.request.Request(BASE + path, data=data,
                                   headers={'Content-Type': 'application/json'},
                                   method=method)
        try:
            with self.opener.open(r, timeout=15) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read().decode('utf-8'))
            except Exception:
                return {'code': e.code, 'message': 'HTTP %d' % e.code}
        except Exception as e:
            return {'code': -1, 'message': str(e)}

    def login(self, u, p='123456'):
        return self.req('POST', '/api/user/login', {'username': u, 'password': p})


results = []


def check(name, cond, extra=''):
    results.append(bool(cond))
    print(('PASS  ' if cond else 'FAIL  ') + name + ('  <<< ' + str(extra) if extra else ''))


def dump(x):
    return json.dumps(x, ensure_ascii=False)


# ---------- 复位演示数据，保证 claim#1 处于可测试状态 ----------
reset = Client()
reset.req('GET', '/api/items?resetDemo=1')
print('--- 演示数据已复位 ---')

# ---------- 1. 未登录一律 401 ----------
anon = Client()
check('未登录查联系方式 401', anon.req('GET', '/api/pickup/contact/1').get('code') == 401)
check('未登录查招领认领人 401', anon.req('GET', '/api/pickup/approved/1').get('code') == 401)
check('未登录致谢 401', anon.req('POST', '/api/pickup/thank/1', {'note': 'x'}).get('code') == 401)

# ---------- 2. 无关第三方 carol：一个手机号都不能看到 ----------
carol = Client()
carol.login('carol')
r = carol.req('GET', '/api/pickup/contact/1')
check('第三方查 contact 403', r.get('code') == 403, r.get('message'))
check('第三方 contact 响应不含拾取者手机号', PHONE_PICKER not in dump(r))
check('第三方 contact 响应不含失主手机号', PHONE_OWNER not in dump(r))

r = carol.req('GET', '/api/pickup/approved/1')
check('第三方查 approved 不返回数据', r.get('data') is None, dump(r)[:100])
check('第三方 approved 响应不含失主手机号', PHONE_OWNER not in dump(r))
check('第三方 approved 响应不含拾取者手机号', PHONE_PICKER not in dump(r))

r = carol.req('POST', '/api/pickup/thank/1', {'note': '越权'})
check('第三方致谢 403', r.get('code') == 403, r.get('message'))

# ---------- 3. 拾取者 bob 也不能看「自己的」申请人联系方式（对称保护） ----------
bob = Client()
bob.login('bob')
r = bob.req('GET', '/api/pickup/contact/1')
check('拾取者查 contact 403（只给申请人本人）', r.get('code') == 403, r.get('message'))

# ---------- 4. 申请人 alice 正常拿到拾取者信息 ----------
alice = Client()
alice.login('alice')
r = alice.req('GET', '/api/pickup/contact/1')
check('alice 查联系方式 code=0', r.get('code') == 0, r.get('message'))
d = r.get('data') or {}
check('返回拾取者昵称', '小红' in str(d.get('pickerNickname', '')), d.get('pickerNickname'))
check('返回拾取者联系方式', str(d.get('pickerContact', '')) == PHONE_PICKER, d.get('pickerContact'))
check('返回物品名', '雨伞' in str(d.get('itemName', '')), d.get('itemName'))
check('返回捡到地点', bool(d.get('pickedLocation')), d.get('pickedLocation'))

# ---------- 5. 拾取者 bob 能看到认领人（用于反向联系） ----------
r = bob.req('GET', '/api/pickup/approved/1')
check('bob 查 approved code=0', r.get('code') == 0, r.get('message'))
d = r.get('data') or {}
app = d.get('applicant') or {}
check('bob 看到认领人昵称', '小明' in str(app.get('nickname', '')), app.get('nickname'))
check('bob 看到认领人联系方式', str(app.get('contact', '')) == PHONE_OWNER, app.get('contact'))

# ---------- 6. 边界 ----------
r = alice.req('GET', '/api/pickup/contact/999')
check('不存在的认领 404', r.get('code') == 404, r.get('message'))

# ---------- 7. 致谢只允许一次（按当前 thanked 状态判断） ----------
cur = (alice.req('GET', '/api/pickup/contact/1').get('data') or {}).get('thanked')
r = alice.req('POST', '/api/pickup/thank/1', {'note': '谢谢你，雨伞已拿回'})
if cur:
    check('已致谢时再谢被拒 409', r.get('code') == 409, r.get('message'))
else:
    check('首次致谢成功', r.get('code') == 0, r.get('message'))
    check('重复致谢被拒 409', alice.req('POST', '/api/pickup/thank/1', {'note': '再谢'}).get('code') == 409)

# ---------- 8. 匹配接口（参数必须是一条 LOST 信息） ----------
lost_id = None
r = alice.req('GET', '/api/items?page=1&size=100&type=LOST')
for it in ((r.get('data') or {}).get('list') or []):
    if it.get('status') in ('PENDING', 'CLAIMING'):
        lost_id = it.get('id')
        break
if lost_id:
    r = alice.req('GET', '/api/pickup/match/%d' % lost_id)
    check('匹配接口 code=0', r.get('code') == 0, r.get('message'))
    data = r.get('data') or []
    check('匹配结果是列表且带 score',
          isinstance(data, list) and all('score' in x for x in data),
          'n=%d' % (len(data) if isinstance(data, list) else -1))
    check('匹配结果按得分降序',
          all(data[i - 1]['score'] >= data[i]['score'] for i in range(1, len(data))))
else:
    check('找到可匹配的寻物信息', False, '没有 PENDING 状态的寻物信息')

r = alice.req('GET', '/api/pickup/match/1')
check('对招领信息调 match 被拒 400', r.get('code') == 400, r.get('message'))

bad = [i for i, ok in enumerate(results) if not ok]
print('\n' + '=' * 45)
print('PASS %d / FAIL %d' % (len(results) - len(bad), len(bad)))
sys.exit(1 if bad else 0)
