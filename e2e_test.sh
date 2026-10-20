#!/usr/bin/env bash
# 端到端测试证据采集：正常 / 异常 / 边界场景（所有中文 JSON 均通过文件发送，避免终端编码问题）
export PYTHONIOENCODING=utf-8
set -u
B=http://localhost:8080
OUT=E:/java/lostfound/target/e2e_evidence.txt
J() { python -c "import json,sys;d=json.loads(sys.stdin.buffer.read());print(json.dumps(d,ensure_ascii=False,indent=1)[:600])" 2>/dev/null || cat; }
Q() { python -c "from urllib.parse import quote;print(quote('$1'))"; }
say() { echo; echo "===== $* ====="; }
W() { python -c "import json,sys;json.dump(json.loads(sys.argv[1]), open(sys.argv[2],'w',encoding='utf-8'), ensure_ascii=False)" "$1" "$2"; }
mkdir -p E:/java/lostfound/target/e2e && cd E:/java/lostfound/target/e2e
: > $OUT

say "F1 注册与登录（正常+异常）"
W '{"username":"tester1","password":"123456","nickname":"测试员甲","contact":"13900000001"}' r1.json
echo "-- 注册:"; curl -s -H "Content-Type: application/json" -d @r1.json $B/api/user/register | tee -a $OUT | J
curl -s -c t1.jar -H "Content-Type: application/json" -d @r1.json $B/api/user/login > /dev/null
echo "-- 登录成功(session已保存)"; echo '{"username":"tester1","password":"123456"}' > login1.json
curl -s -b t1.jar $B/api/user/profile | tee -a $OUT | J
echo "-- 重复注册(409):"; curl -s -H "Content-Type: application/json" -d @r1.json $B/api/user/register | tee -a $OUT | J
echo "-- 密码错误(400):"; echo '{"username":"tester1","password":"bad"}' > badpwd.json
curl -s -H "Content-Type: application/json" -d @badpwd.json $B/api/user/login | tee -a $OUT | J
echo "-- 未登录发布(401):"; echo '{}' > empty.json
curl -s -H "Content-Type: application/json" -d @empty.json $B/api/items | tee -a $OUT | J
echo '{"username":"bob","password":"123456"}' > bob.json
curl -s -c t2.jar -H "Content-Type: application/json" -d @bob.json $B/api/user/login > /dev/null
echo '{"username":"carol","password":"123456"}' > carol.json
curl -s -c t3.jar -H "Content-Type: application/json" -d @carol.json $B/api/user/login > /dev/null
echo '{"username":"admin","password":"admin123"}' > adm.json
curl -s -c adm.jar -H "Content-Type: application/json" -d @adm.json $B/api/user/login > /dev/null
echo "-- 普通用户角色(profile.role):"; curl -s -b t2.jar $B/api/user/profile | python -c "import json,sys;print(json.loads(sys.stdin.buffer.read())['data']['role'])" | tee -a $OUT
echo "-- 管理员角色(profile.role):"; curl -s -b adm.jar $B/api/user/profile | python -c "import json,sys;print(json.loads(sys.stdin.buffer.read())['data']['role'])" | tee -a $OUT

say "F2 发布（正常+缺项+非法类型+超长）"
W '{"type":"FOUND","name":"银色U盘","category":"电子数码","location":"机房楼3楼","eventTime":"2026-10-12T14:30:00","description":"捡到银色32G U盘，内有课程作业文件夹","contact":"13900000001"}' item.json
echo "-- 正常发布:"; curl -s -b t1.jar -H "Content-Type: application/json" -d @item.json $B/api/items | tee -a $OUT | J
echo "-- 缺必填项(400):"; echo '{"type":"FOUND","name":""}' > miss.json
curl -s -b t1.jar -H "Content-Type: application/json" -d @miss.json $B/api/items | tee -a $OUT | J
echo "-- 非法类型(400):"; W '{"type":"STOLEN","name":"x","category":"电子数码","location":"机房","eventTime":"2026-10-12T14:30:00","description":"d","contact":"139"}' badt.json
curl -s -b t1.jar -H "Content-Type: application/json" -d @badt.json $B/api/items | tee -a $OUT | J
echo "-- 名称超长(400):"; W '{"type":"FOUND","name":"这是一个专门用于验证物品名称字段长度上限校验逻辑是否能够正常工作的超长测试物品名称内容示例数据准备超过五十个字符的边界用例","category":"电子数码","location":"机房","eventTime":"2026-10-12T14:30:00","description":"d","contact":"139"}' long.json
python -c "import json;print('name长度=',len(json.load(open('E:/java/lostfound/target/e2e/long.json', encoding='utf-8'))['name']))" | tee -a $OUT
curl -s -b t1.jar -H "Content-Type: application/json" -d @long.json $B/api/items | tee -a $OUT | J

say "F3 组合搜索（正常+边界）"
echo "-- 关键词命中(名称):"; curl -s "$B/api/items?keyword=$(Q 雨伞)" | tee -a $OUT | J
echo "-- 组合筛选全匹配:"; curl -s "$B/api/items?type=FOUND&category=$(Q 电子数码)&location=$(Q 机房楼3楼)&keyword=$(Q U盘)" | tee -a $OUT | J
echo "-- 组合筛选地点不匹配(0):"; curl -s "$B/api/items?type=FOUND&category=$(Q 电子数码)&location=$(Q 图书馆)" | python -c "import json,sys;print('total=',json.loads(sys.stdin.buffer.read())['data']['total'])" | tee -a $OUT
echo "-- 无结果关键词(0):"; curl -s "$B/api/items?keyword=$(Q 不存在的东西xyz)" | python -c "import json,sys;print('total=',json.loads(sys.stdin.buffer.read())['data']['total'])" | tee -a $OUT
echo "-- 越界页码(空列表不报错):"; curl -s "$B/api/items?page=999" | python -c "import json,sys;d=json.loads(sys.stdin.buffer.read())['data'];print('page=',d['page'],'list大小=',len(d['list']))" | tee -a $OUT
echo "-- 时间范围外(0):"; curl -s "$B/api/items?startTime=2027-01-01T00:00:00" | python -c "import json,sys;print('total=',json.loads(sys.stdin.buffer.read())['data']['total'])" | tee -a $OUT

say "E2 AI 辅助（无密钥→本地降级）"
W '{"description":"我在图书馆丢了一把黑色的雨伞，伞柄有蓝色挂绳"}' ai.json
echo "-- 关键词推荐(降级):"; curl -s -b t2.jar -H "Content-Type: application/json" -d @ai.json $B/api/ai/keywords | tee -a $OUT | J
echo "-- 描述优化(降级):"; W '{"description":"捡到一张校园卡"}' aid.json
curl -s -b t1.jar -H "Content-Type: application/json" -d @aid.json $B/api/ai/description | tee -a $OUT | J
echo "-- 疑似匹配Top5(本地降级):"; curl -s -b t2.jar $B/api/match/2 | tee -a $OUT | J

say "F4/F5 认领全流程（核心验收场景：A发布→B认领→A确认）"
echo "-- B认领A的U盘(id=11):"; W '{"itemId":11,"description":"U盘内文件夹里有我的姓名"}' claim.json
curl -s -b t2.jar -H "Content-Type: application/json" -d @claim.json $B/api/claims | tee -a $OUT | J
echo "-- 重复提交(409):"; curl -s -b t2.jar -H "Content-Type: application/json" -d @claim.json $B/api/claims | tee -a $OUT | J
echo "-- 第三人C处理申请(403):"; curl -s -b t3.jar -X POST $B/api/claims/1/reject | tee -a $OUT | J
echo "-- 发布者A收到通知:"; curl -s -b t1.jar $B/api/notifications | python -c "
import json,sys
d=json.loads(sys.stdin.buffer.read())['data']
print('未读数=',d['unread'])
for n in d['list'][:2]: print('-',n['content'])" | tee -a $OUT
echo "-- A确认认领:"; W '{"note":"文件夹姓名核对一致"}' ok.json
curl -s -b t1.jar -H "Content-Type: application/json" -d @ok.json $B/api/claims/1/approve | tee -a $OUT | J
echo "-- 物品状态:"; curl -s $B/api/items/11 | python -c "import json,sys;print(json.loads(sys.stdin.buffer.read())['data']['status'])" | tee -a $OUT
echo "-- B收到确认通知:"; curl -s -b t2.jar $B/api/notifications | python -c "
import json,sys
for n in json.loads(sys.stdin.buffer.read())['data']['list']: print('-',n['content'])" | tee -a $OUT
echo "-- C无相关通知(隔离):"; curl -s -b t3.jar $B/api/notifications | python -c "import json,sys;print('C的通知数=',len(json.loads(sys.stdin.buffer.read())['data']['list']))" | tee -a $OUT
echo "-- 重复处理(409):"; curl -s -b t1.jar -X POST $B/api/claims/1/reject | tee -a $OUT | J

say "F4 拒绝与要求补充（对carol的寻物id=8: bob拾到耳机可认领）"
echo "-- 新建招领(bob捡到运动水杯):"; W '{"type":"FOUND","name":"透明运动水杯","category":"生活用品","location":"体育馆","eventTime":"2026-10-13T08:00:00","description":"杯身有校徽，拾于篮球场边","contact":"13800000002"}' cup.json
curl -s -b t2.jar -H "Content-Type: application/json" -d @cup.json $B/api/items > E:/java/lostfound/target/e2e/cup.out
CUPID=$(python -c "import json;print(json.load(open('E:/java/lostfound/target/e2e/cup.out', encoding='utf-8'))['data']['id'])")
echo "cup id=$CUPID" | tee -a $OUT
echo "-- carol提交认领:"; W "{\"itemId\":$CUPID,\"description\":\"是我的水杯\"}" cclaim.json
curl -s -b t3.jar -H "Content-Type: application/json" -d @cclaim.json $B/api/claims > E:/java/lostfound/target/e2e/cclaim.out
CCLAIM=$(python -c "import json;print(json.load(open('E:/java/lostfound/target/e2e/cclaim.out', encoding='utf-8'))['data']['id'])")
echo "-- bob要求补充:"; printf '{"note":"请补充水杯的具体特征细节"}' > more.json; curl -s -b t2.jar -H "Content-Type: application/json" -d @more.json $B/api/claims/$CCLAIM/request-more | python -c "import json,sys;d=json.loads(sys.stdin.buffer.read())['data'];print('claim状态=',d['status'],'物品处理意见=',d['handleNote'])" | tee -a $OUT
echo "-- carol收到要求补充通知:"; curl -s -b t3.jar $B/api/notifications | python -c "
import json,sys
for n in json.loads(sys.stdin.buffer.read())['data']['list'][:1]: print('-',n['content'])" | tee -a $OUT
echo "-- 物品保持认领处理中:"; curl -s $B/api/items/$CUPID | python -c "import json,sys;print(json.loads(sys.stdin.buffer.read())['data']['status'])" | tee -a $OUT
echo "-- carol重新补充申请(原申请已非处理中,新申请因物品非待认领被拒409):"; curl -s -b t3.jar -H "Content-Type: application/json" -d @cclaim.json $B/api/claims | tee -a $OUT | J
echo "-- bob拒绝(需先回到合法状态:直接拒绝当前MORE_INFO申请→409已处理):"; curl -s -b t2.jar -X POST $B/api/claims/$CCLAIM/reject | tee -a $OUT | J

say "F2/F5 撤回与非法流转"
W '{"type":"LOST","name":"宿舍钥匙","category":"生活用品","location":"南门","eventTime":"2026-10-13T09:00:00","description":"钥匙一串带红绳","contact":"139"}' key.json
curl -s -b t1.jar -H "Content-Type: application/json" -d @key.json $B/api/items > E:/java/lostfound/target/e2e/key.out
KEYID=$(python -c "import json;print(json.load(open('E:/java/lostfound/target/e2e/key.out', encoding='utf-8'))['data']['id'])")
echo "-- 撤回(id=$KEYID):"; curl -s -b t1.jar -X POST $B/api/items/$KEYID/withdraw | tee -a $OUT | J
echo "-- 撤回后公开列表不可见:"; curl -s "$B/api/items?keyword=$(Q 红绳)" | python -c "import json,sys;print('total=',json.loads(sys.stdin.buffer.read())['data']['total'])" | tee -a $OUT
echo "-- 已关闭再次撤回(非法流转400):"; curl -s -b t1.jar -X POST $B/api/items/$KEYID/withdraw | tee -a $OUT | J
echo "-- 他人撤回(403):"; curl -s -b t2.jar -X POST $B/api/items/$KEYID/withdraw | tee -a $OUT | J

say "E1 图片上传（正常+非法格式+超限）"
W '{"type":"LOST","name":"测试图片物品","category":"其他","location":"测试地点","eventTime":"2026-10-13T10:00:00","description":"测试","contact":"139"}' pic.json
curl -s -b t1.jar -H "Content-Type: application/json" -d @pic.json $B/api/items > E:/java/lostfound/target/e2e/pic.out
PICID=$(python -c "import json;print(json.load(open('E:/java/lostfound/target/e2e/pic.out', encoding='utf-8'))['data']['id'])")
python -c "
from PIL import Image
Image.new('RGB', (300, 200), (47, 127, 214)).save('E:/java/lostfound/target/e2e/test.png')"
echo "-- 正常上传PNG:"; curl -s -b t1.jar -F "file=@E:/java/lostfound/target/e2e/test.png;type=image/png" $B/api/items/$PICID/image | tee -a $OUT | J
echo "-- 图片访问:"; curl -s -o /dev/null -w "%{http_code}\n" $B/uploads/$(ls /e/java/lostfound/uploads | head -1) | tee -a $OUT
echo "-- 上传文本伪装(非法格式400):"; echo "not an image" > E:/java/lostfound/target/e2e/fake.png
curl -s -b t1.jar -F "file=@E:/java/lostfound/target/e2e/fake.png;type=text/plain" $B/api/items/$PICID/image | tee -a $OUT | J
python -c "
from PIL import Image
import os, random
random.seed(42)
img = Image.new('RGB', (2600, 2600))
img.putdata([(random.randint(0,255),random.randint(0,255),random.randint(0,255)) for _ in range(2600*2600)])
img.save('E:/java/lostfound/target/e2e/big.jpg', quality=100)
print('大小MB=', round(os.path.getsize('E:/java/lostfound/target/e2e/big.jpg')/1048576, 2))" | tee -a $OUT
echo "-- 上传超大JPG(400):"; curl -s -b t1.jar -F "file=@E:/java/lostfound/target/e2e/big.jpg;type=image/jpeg" $B/api/items/$PICID/image | tee -a $OUT | J

say "F6 管理审核（权限/隐藏/删除确认/归档/处理记录）"
echo "-- 普通用户访问管理接口(403):"; curl -s -b t2.jar $B/api/admin/items | tee -a $OUT | J
echo "-- 管理员隐藏U盘信息(id=11):"; curl -s -b adm.jar -X POST $B/api/admin/items/11/hide | tee -a $OUT | J
echo "-- 隐藏后公开搜索不可见:"; curl -s "$B/api/items?keyword=$(Q 银色U盘)" | python -c "import json,sys;print('total=',json.loads(sys.stdin.buffer.read())['data']['total'])" | tee -a $OUT
echo "-- 普通用户看隐藏详情(404):"; curl -s -b t2.jar $B/api/items/11 | tee -a $OUT | J
echo "-- 删除缺confirm(400):"; curl -s -b adm.jar -X DELETE $B/api/admin/items/11 | tee -a $OUT | J
echo "-- 删除带confirm(200):"; curl -s -b adm.jar -X DELETE "$B/api/admin/items/11?confirm=true" | tee -a $OUT | J
echo "-- 归档水杯(id=$CUPID 认领处理中→归档被拒400):"; curl -s -b adm.jar -X POST $B/api/admin/items/$CUPID/archive | tee -a $OUT | J
echo "-- 处理记录:"; curl -s -b adm.jar "$B/api/admin/audit-records?size=8" | python -c "
import json,sys
for r in json.loads(sys.stdin.buffer.read())['data']['list']:
    print(f\"- {r['createTime'][:19]} 操作人{r['adminId']} [{r['action']}] {r['detail'][:45]}\")" | tee -a $OUT

say "E4 统计与一致性抽查"
echo "-- 类别TOP10:"; curl -s $B/api/stats/category | python -c "
import json,sys
for d in json.loads(sys.stdin.buffer.read())['data']: print(f\"  {d['name']}: {d['value']}\")" | tee -a $OUT
echo "-- 地点TOP10:"; curl -s $B/api/stats/location | python -c "
import json,sys
for d in json.loads(sys.stdin.buffer.read())['data']: print(f\"  {d['name']}: {d['value']}\")" | tee -a $OUT
echo "-- 逐月趋势:"; curl -s $B/api/stats/monthly | python -c "
import json,sys
for d in json.loads(sys.stdin.buffer.read())['data']: print(f\"  {d['name']}: {d['value']}\")" | tee -a $OUT

say "F7 持久化（重启前快照）"
curl -s "$B/api/items?size=1" | python -c "import json,sys;d=json.loads(sys.stdin.buffer.read())['data'];print('物品总数=',d['total'])" | tee -a $OUT
curl -s -b adm.jar "$B/api/admin/audit-records?size=1" | python -c "import json,sys;print('处理记录总数=',json.loads(sys.stdin.buffer.read())['data']['total'])" | tee -a $OUT

echo; echo "证据采集完成 -> $OUT"
