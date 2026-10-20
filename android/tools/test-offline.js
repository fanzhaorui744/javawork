/* Node 端离线引擎测试：模拟 WebView 环境，跑通核心业务流程 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'web-extra', 'js', 'offline.js'), 'utf8');

function makeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    get length() { return map.size; }
  };
}

const sandbox = {
  window: null,
  location: { protocol: 'file:', pathname: '/index.html', search: '' },
  navigator: { onLine: false },
  document: { documentElement: { classList: { add() {} } } },
  localStorage: makeStorage(),
  URLSearchParams,
  Response,
  Promise,
  setTimeout,
  clearTimeout,
  JSON,
  Math,
  Date,
  console: { log() {}, warn() {}, error() {} },
};
sandbox.window = sandbox;
sandbox.window.OFFLINE_MODE = true;
vm.createContext(sandbox);
vm.runInContext(CODE, sandbox);

const api = async (method, url, body) => {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await sandbox.fetch(url, init);
  const json = await res.json();
  return { status: res.status, ...json };
};

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  <<< ' + JSON.stringify(extra) : '')); }
}

(async () => {
  console.log('\n=== 1. 匿名浏览 ===');
  let r = await api('GET', '/api/items?page=1&size=10');
  check('匿名列表 code=0', r.code === 0, r);
  check('匿名列表 total=18（20 条种子 - 2 条已关闭）', r.data.total === 18, r.data && r.data.total);
  check('adminView=false', r.data.adminView === false);
  const first = r.data.list[0];
  check('列表项字段齐全', ['id','type','name','category','location','eventTime','description','contact','imagePath','status','publisherId','hidden','createTime'].every(k => k in first), Object.keys(first));
  check('种子数据 imagePath 为 null（与 DemoDataInitializer 一致）', first.imagePath === null, first.imagePath);

  r = await api('GET', '/api/items?keyword=雨伞');
  check('匿名关键词搜索命中', r.code === 0 && r.data.total >= 1, r.data && r.data.total);
  r = await api('GET', '/api/items?type=LOST&category=生活用品');
  check('类型+类别组合筛选', r.code === 0 && r.data.list.every(i => i.type === 'LOST' && i.category === '生活用品'), r.data && r.data.list.map(i => i.name));
  r = await api('GET', '/api/items?type=BAD');
  check('非法类型报错', r.code === 400, r);

  r = await api('GET', '/api/items/1');
  check('匿名详情可访问', r.code === 0 && r.data.id === 1, r);
  r = await api('GET', '/api/items/999');
  check('详情不存在 404', r.code === 404, r);

  console.log('\n=== 2. 未登录访问受保护接口 ===');
  r = await api('GET', '/api/user/profile');
  check('profile 401', r.status === 401 && r.code === 401, r);
  r = await api('GET', '/api/claims');
  check('claims 401', r.status === 401, r);
  r = await api('GET', '/api/admin/items');
  check('admin 未登录 403', r.status === 403, r);

  console.log('\n=== 3. alice 登录并发布招领 ===');
  r = await api('POST', '/api/user/login', { username: 'alice', password: 'wrong' });
  check('错误密码被拒', r.code === 400, r);
  r = await api('POST', '/api/user/login', { username: 'alice', password: '123456' });
  check('alice 登录成功', r.code === 0 && r.data.username === 'alice', r);
  check('登录响应不含密码', r.data.passwordHash === null && r.data._pwd === undefined, r.data);

  r = await api('POST', '/api/items', {
    type: 'FOUND', category: '电子数码', name: '深蓝色充电宝 20000mAh',
    eventTime: '2026-10-19T16:30:00', location: '图书馆三楼靠窗座位',
    description: '在图书馆三楼靠窗座位捡到深蓝色充电宝，侧面有一道白色划痕，贴着动漫贴纸。',
    contact: '13800000001'
  });
  check('alice 发布招领成功', r.code === 0 && r.data.id > 10, r);
  const newItemId = r.data.id;
  check('新信息状态待认领', r.data.status === 'PENDING');
  check('无图自动生成占位图', String(r.data.imagePath).startsWith('data:image/svg'));

  r = await api('POST', '/api/items', { type: 'FOUND', name: '', category: 'x', location: 'y', eventTime: '2026-10-19T16:30:00', description: 'd', contact: 'c' });
  check('空名称校验失败', r.code === 400 && /名称/.test(r.message), r);

  r = await api('POST', '/api/user/logout');
  check('alice 退出', r.code === 0);
  r = await api('GET', '/api/user/profile');
  check('退出后 401', r.status === 401, r);

  console.log('\n=== 4. bob 登录 → 搜索 → 详情 → AI 匹配 ===');
  r = await api('POST', '/api/user/login', { username: 'bob', password: '123456' });
  check('bob 登录', r.code === 0 && r.data.username === 'bob', r);

  r = await api('GET', '/api/items?keyword=' + encodeURIComponent('充电宝'));
  check('bob 搜索到 alice 的新信息', r.code === 0 && r.data.list.some(i => i.id === newItemId), r.data && r.data.list.map(i => i.name));

  r = await api('GET', '/api/items/' + newItemId);
  check('bob 查看详情', r.code === 0 && r.data.id === newItemId);

  // 反向匹配：bob 发布一条寻物，看是否能匹配到 alice 的招领
  r = await api('POST', '/api/items', {
    type: 'LOST', category: '电子数码', name: '深蓝色充电宝',
    eventTime: '2026-10-19T15:00:00', location: '图书馆三楼',
    description: '在图书馆三楼丢失深蓝色 20000mAh 充电宝，侧面有白色划痕。',
    contact: '13800000002'
  });
  check('bob 发布寻物', r.code === 0, r);
  const bobLostId = r.data.id;

  r = await api('GET', '/api/match/' + bobLostId);
  check('AI 匹配 code=0', r.code === 0, r);
  check('匹配降级标记为 true（无原生桥）', r.data.degraded === true, r.data);
  check('匹配命中 alice 的充电宝', r.data.matches.some(m => m.itemId === newItemId), r.data.matches);
  const best = r.data.matches[0];
  check('匹配结果含 score/reason', typeof best.score === 'number' && typeof best.reason === 'string', best);
  check('匹配得分降序', r.data.matches.every((m, i, a) => i === 0 || a[i - 1].score >= m.score));

  console.log('\n=== 5. bob 提交认领 ===');
  r = await api('POST', '/api/claims', { itemId: newItemId, description: '充电宝侧面白色划痕是我磕的，贴纸是《进击的巨人》利威尔。' });
  check('bob 提交认领成功', r.code === 0 && r.data.status === 'PENDING', r);
  const claimId = r.data.id;

  r = await api('GET', '/api/items/' + newItemId);
  check('物品状态变为认领处理中', r.data.status === 'CLAIMING', r.data.status);

  r = await api('POST', '/api/claims', { itemId: newItemId, description: '重复提交' });
  check('重复提交被拒 409', r.code === 409, r);

  r = await api('GET', '/api/claims');
  check('bob 的 mine 含新申请', r.data.mine.some(x => x.claim.id === claimId), r.data.mine.length);

  r = await api('POST', '/api/claims/' + claimId + '/approve', { note: '越权确认' });
  check('非发布者不能确认（403）', r.code === 403, r);

  console.log('\n=== 6. alice 登录看到通知并确认认领 ===');
  await api('POST', '/api/user/logout');
  r = await api('POST', '/api/user/login', { username: 'alice', password: '123456' });
  check('alice 重新登录', r.code === 0);

  r = await api('GET', '/api/notifications');
  const unreadBefore = r.data.unread;
  check('alice 收到认领通知', r.data.list.some(n => n.itemId === newItemId), r.data.list.length);
  check('未读数 > 0', unreadBefore > 0, unreadBefore);

  r = await api('GET', '/api/notifications/unread-count');
  check('unread-count 一致', r.data.unread === unreadBefore, r.data);

  r = await api('GET', '/api/claims');
  const incoming = r.data.incoming.find(x => x.claim.id === claimId);
  check('alice 的 incoming 含该申请', !!incoming, r.data.incoming.length);
  check('incoming 带申请人昵称', incoming && incoming.applicant === '小红（拾取者）', incoming && incoming.applicant);

  r = await api('POST', '/api/claims/' + claimId + '/approve', { note: '特征描述一致，已当面归还。' });
  check('alice 确认认领', r.code === 0 && r.data.status === 'APPROVED', r);

  r = await api('GET', '/api/items/' + newItemId);
  check('物品状态变为已归还', r.data.status === 'RESOLVED', r.data.status);

  r = await api('POST', '/api/claims/' + claimId + '/approve', { note: 'again' });
  check('重复处理被拒 409', r.code === 409, r);

  r = await api('GET', '/api/notifications');
  check('alice 通知新增系统消息（bob 认领 + 通知）', r.data.list.length >= 2);

  r = await api('POST', '/api/notifications/read-all');
  check('全部已读', r.code === 0);
  r = await api('GET', '/api/notifications/unread-count');
  check('未读归零', r.data.unread === 0, r.data);

  console.log('\n=== 7. bob 侧确认通知 ===');
  await api('POST', '/api/user/logout');
  await api('POST', '/api/user/login', { username: 'bob', password: '123456' });
  r = await api('GET', '/api/notifications');
  check('bob 收到确认通知', r.data.list.some(n => /已被确认/.test(n.content)), r.data.list.map(n => n.content).slice(0, 3));
  r = await api('GET', '/api/claims');
  const mineRow = r.data.mine.find(x => x.claim.id === claimId);
  check('bob 的申请状态已确认', mineRow && mineRow.claim.status === 'APPROVED', mineRow && mineRow.claim.status);
  check('mine 带物品信息', mineRow && mineRow.item && mineRow.item.id === newItemId);

  console.log('\n=== 8. 管理后台 ===');
  await api('POST', '/api/user/logout');
  r = await api('POST', '/api/user/login', { username: 'admin', password: 'admin123' });
  check('admin 登录', r.code === 0 && r.data.role === 'ADMIN', r);

  r = await api('GET', '/api/admin/items?page=1&size=10');
  check('管理列表可读', r.code === 0 && r.data.total > 0, r.data && r.data.total);
  const adminList = r.data.list;
  check('管理列表含新物品', adminList.some(i => i.id === newItemId));

  r = await api('POST', '/api/admin/items/' + newItemId + '/hide');
  check('隐藏信息', r.code === 0 && r.data.hidden === 1, r);
  await api('POST', '/api/user/logout');
  r = await api('GET', '/api/items');
  check('公开列表不再出现隐藏项', !r.data.list.some(i => i.id === newItemId), r.data.list.map(i => i.id));
  r = await api('GET', '/api/items/' + newItemId);
  check('普通视角详情不可见', r.code === 404, r);
  await api('POST', '/api/user/login', { username: 'admin', password: 'admin123' });
  r = await api('GET', '/api/admin/items?hiddenOnly=true');
  check('只看已隐藏生效', r.data.list.every(i => i.hidden === 1), r.data.list.map(i => i.hidden));
  r = await api('POST', '/api/admin/items/' + newItemId + '/unhide');
  check('恢复信息', r.code === 0 && r.data.hidden === 0, r);

  r = await api('POST', '/api/admin/items/' + newItemId + '/archive');
  check('归档已归还信息', r.code === 0 && r.data.status === 'CLOSED', r);
  r = await api('POST', '/api/admin/items/' + newItemId + '/archive');
  check('已关闭不可再归档', r.code === 400, r);

  r = await api('DELETE', '/api/admin/items/' + bobLostId);
  check('删除缺 confirm 被拒', r.code === 400, r);
  r = await api('DELETE', '/api/admin/items/' + bobLostId + '?confirm=true');
  check('带 confirm 删除成功', r.code === 0, r);
  r = await api('GET', '/api/items/' + bobLostId);
  check('删除后不存在', r.code === 404, r);

  r = await api('GET', '/api/admin/audit-records?page=1&size=20');
  check('处理记录可读', r.code === 0 && r.data.list.length > 0, r.data && r.data.list.length);
  check('记录含本次操作', r.data.list.some(a => a.action === '归档关闭') && r.data.list.some(a => a.action === '删除信息'), r.data.list.map(a => a.action));

  console.log('\n=== 9. 统计接口 ===');
  r = await api('GET', '/api/stats/category');
  check('类别统计 code=0', r.code === 0 && Array.isArray(r.data), r);
  check('类别统计格式 {name,value}', r.data.every(d => typeof d.name === 'string' && typeof d.value === 'number'), r.data);
  check('类别统计降序', r.data.every((d, i, a) => i === 0 || a[i - 1].value >= d.value), r.data);
  r = await api('GET', '/api/stats/location');
  check('地点统计非空', r.data.length > 0, r.data.length);
  r = await api('GET', '/api/stats/monthly');
  check('逐月统计 name 为 yyyy-MM', r.data.every(d => /^\d{4}-\d{2}$/.test(d.name)), r.data);
  check('逐月统计按时间升序', r.data.every((d, i, a) => i === 0 || a[i - 1].name <= d.name), r.data);

  console.log('\n=== 10. AI 辅助接口（无原生桥 → 本地降级） ===');
  r = await api('POST', '/api/ai/keywords', { description: '在图书馆二楼丢失一把黑色折叠雨伞，伞柄有蓝色挂绳' });
  check('关键词 code=0', r.code === 0, r);
  check('降级标记为 true', r.data.degraded === true, r.data);
  check('本地关键词非空', Array.isArray(r.data.keywords) && r.data.keywords.length > 0, r.data);
  r = await api('POST', '/api/ai/description', { description: '黑色雨伞丢了' });
  check('描述优化 code=0', r.code === 0 && r.data.degraded === true, r);
  check('降级模板含原文', /黑色雨伞丢了/.test(r.data.description), r.data.description);
  r = await api('POST', '/api/ai/description', { description: '' });
  check('空描述报错 400', r.code === 400, r);

  console.log('\n=== 11. 注册 / 权限 / 边界 ===');
  r = await api('POST', '/api/user/register', { username: 'alice', password: '123456', nickname: 'x' });
  check('重复用户名 409', r.code === 409, r);
  r = await api('POST', '/api/user/register', { username: 'newbie', password: '123456', nickname: '新同学', contact: '13900000000' });
  check('注册成功', r.code === 0 && r.data.role === 'USER', r);
  r = await api('POST', '/api/user/register', { username: 'ab', password: '123456', nickname: 'x' });
  check('用户名过短被拒', r.code === 400, r);
  r = await api('GET', '/api/nope');
  check('未知接口 404', r.code === 404, r);

  // 非管理员访问后台
  await api('POST', '/api/user/login', { username: 'carol', password: '123456' });
  r = await api('GET', '/api/admin/items');
  check('普通用户访问后台 403', r.status === 403, r);

  // 撤回自己的信息
  r = await api('POST', '/api/items', { type: 'LOST', category: '其他', name: '测试物品', eventTime: '2026-10-18T10:00:00', location: '测试地点', description: '测试描述内容', contact: '139' });
  const tmpId = r.data.id;
  r = await api('POST', '/api/items/' + tmpId + '/withdraw');
  check('撤回成功', r.code === 0 && r.data.status === 'CLOSED', r);
  r = await api('POST', '/api/items/' + tmpId + '/withdraw');
  check('重复撤回被拒', r.code === 400, r);
  r = await api('GET', '/api/items');
  check('已关闭不出现在公开列表', !r.data.list.some(i => i.id === tmpId));

  console.log('\n=== 12. 持久化 ===');
  const snapshot = sandbox.localStorage.getItem('lostfound.offline.v5');
  check('状态已写入 localStorage', !!snapshot && snapshot.length > 1000, snapshot ? snapshot.length : 0);
  check('localStorage 不含 passwordHash 字段', !snapshot || snapshot.indexOf('"passwordHash"') < 0);

  console.log('\n=== 13. 数据重置 ===');
  const msg = sandbox.LFOffline.reset();
  check('reset 返回提示', /重置/.test(msg), msg);
  r = await api('GET', '/api/items?page=1&size=10');
  check('重置后回到 18 条公开数据', r.data.total === 18, r.data.total);
  r = await api('GET', '/api/user/profile');
  check('重置后为未登录', r.status === 401, r);

  console.log('\n---------------------------------------------');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  console.log('---------------------------------------------');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('测试脚本异常：', e);
  process.exit(2);
});
