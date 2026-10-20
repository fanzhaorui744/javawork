/* 种子数据自检：直接读取 offline.js，断言与 DemoDataInitializer 一致 */
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
    get length() { return map.size; },
    _map: map
  };
}

const storage = makeStorage();
const sandbox = {
  window: null,
  location: { protocol: 'file:', pathname: '/index.html', search: '' },
  navigator: { onLine: false },
  document: { documentElement: { classList: { add() {} } } },
  localStorage: storage,
  URLSearchParams, Response, Promise, setTimeout, clearTimeout,
  JSON, Math, Date,
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
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  <<< ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const st = sandbox.LFOffline.state();

  console.log('\n=== 版本 / 存储键 ===');
  check('STATE_VERSION = 3', sandbox.LFOffline.version === 3, sandbox.LFOffline.version);
  check('STORAGE_KEY 升级为 v3', !!storage.getItem('lostfound.offline.v3'));
  check('旧 v2 键未被写入', storage.getItem('lostfound.offline.v2') === null);

  console.log('\n=== 用户（4） ===');
  check('用户数 = 4', st.users.length === 4, st.users.length);
  const expectUsers = [
    [1, 'admin', 'admin123', '系统管理员', 'admin@campus.edu', 'ADMIN'],
    [2, 'alice', '123456', '小明（失主）', '13800000001', 'USER'],
    [3, 'bob', '123456', '小红（拾取者）', '13800000002', 'USER'],
    [4, 'carol', '123456', '同学C', '13800000003', 'USER'],
  ];
  expectUsers.forEach(e => {
    const u = st.users.find(x => x.id === e[0]);
    check(`用户 #${e[0]} ${e[1]} 字段一致`,
      !!u && u.username === e[1] && u._pwd === e[2] && u.nickname === e[3] && u.contact === e[4] && u.role === e[5],
      u && [u.username, u._pwd, u.nickname, u.contact, u.role]);
  });

  console.log('\n=== 物品（应为 20 条） ===');
  check('物品总数 = 20', st.items.length === 20, st.items.length);
  const byStatus = st.items.reduce((a, i) => (a[i.status] = (a[i.status] || 0) + 1, a), {});
  check('PENDING = 16', byStatus.PENDING === 16, byStatus);
  check('CLAIMING = 1', byStatus.CLAIMING === 1, byStatus);
  check('RESOLVED = 1', byStatus.RESOLVED === 1, byStatus);
  check('CLOSED = 2', byStatus.CLOSED === 2, byStatus);
  check('状态合计 = 20', Object.values(byStatus).reduce((a, b) => a + b, 0) === 20, byStatus);
  check('全部 imagePath 为 null', st.items.every(i => i.imagePath === null), st.items.filter(i => i.imagePath !== null).map(i => i.id));
  check('id 连续 1..20', st.items.every((i, idx) => i.id === idx + 1));

  const expectItems = [
    [1, 'FOUND', '黑色折叠雨伞', '生活用品', '图书馆二楼自习区', 3, 'PENDING'],
    [2, 'LOST', '黑色折叠雨伞', '生活用品', '图书馆二楼', 2, 'PENDING'],
    [3, 'LOST', '校园卡', '证件卡片', '第一食堂', 2, 'PENDING'],
    [4, 'FOUND', '蓝色保温杯', '生活用品', '教学楼A座301', 3, 'PENDING'],
    [5, 'LOST', '高等数学教材', '书籍资料', '教学楼B座', 4, 'PENDING'],
    [6, 'FOUND', '苹果无线耳机充电盒', '电子数码', '操场看台', 2, 'PENDING'],
    [7, 'LOST', '运动水杯', '生活用品', '体育馆', 4, 'CLAIMING'],
    [8, 'LOST', 'U盘（32G 银色）', '电子数码', '机房楼3楼', 2, 'RESOLVED'],
    [9, 'LOST', '宿舍钥匙串', '生活用品', '南门快递点', 4, 'CLOSED'],
    [10, 'FOUND', '白色蓝牙耳机', '电子数码', '图书馆一楼大厅', 3, 'CLOSED'],
    [11, 'FOUND', '灰色围巾', '衣物配饰', '图书馆三楼', 3, 'PENDING'],
    [12, 'LOST', '学生证', '证件卡片', '校医院', 2, 'PENDING'],
    [13, 'FOUND', '机械键盘', '电子数码', '机房楼2楼', 3, 'PENDING'],
    [14, 'LOST', '篮球', '其他', '体育馆', 4, 'PENDING'],
    [15, 'FOUND', '笔记本', '书籍资料', '第一食堂', 2, 'PENDING'],
    [16, 'LOST', '电动车钥匙', '生活用品', '南门车棚', 3, 'PENDING'],
    [17, 'FOUND', '充电宝', '电子数码', '图书馆一楼大厅', 4, 'PENDING'],
    [18, 'LOST', '眼镜', '衣物配饰', '教学楼C座', 2, 'PENDING'],
    [19, 'FOUND', '雨衣', '衣物配饰', '东门传达室', 3, 'PENDING'],
    [20, 'LOST', '水卡', '证件卡片', '宿舍楼下', 4, 'PENDING'],
  ];
  expectItems.forEach(e => {
    const it = st.items.find(x => x.id === e[0]);
    check(`物品 #${e[0]} ${e[2]}`, !!it && it.type === e[1] && it.name === e[2] && it.category === e[3] &&
      it.location === e[4] && it.publisherId === e[5] && it.status === e[6],
      it && [it.type, it.name, it.category, it.location, it.publisherId, it.status]);
  });

  console.log('\n=== createTime = eventTime + 2h ===');
  let timeOk = true, badTime = [];
  st.items.forEach(it => {
    const ev = Date.parse(it.eventTime), ct = Date.parse(it.createTime);
    if (!(Math.abs((ct - ev) - 2 * 3600 * 1000) < 2000)) { timeOk = false; badTime.push(it.id); }
  });
  check('全部 20 条 createTime 比 eventTime 晚 2 小时', timeOk, badTime);
  check('updateTime == createTime', st.items.every(i => i.updateTime === i.createTime));

  console.log('\n=== 认领申请（3） ===');
  check('认领数 = 3', st.claims.length === 3, st.claims.length);
  const c1 = st.claims[0], c2 = st.claims[1], c3 = st.claims[2];
  check('认领 #1 运动水杯 bob PENDING',
    c1.itemId === 7 && c1.applicantId === 3 && c1.status === 'PENDING' &&
    c1.description === '杯子是我的，杯底有一道竖着的划痕，杯身上贴过校运会标签但已撕掉。', c1);
  check('认领 #2 U盘 bob APPROVED + handleNote',
    c2.itemId === 8 && c2.applicantId === 3 && c2.status === 'APPROVED' &&
    c2.handleNote === '核实物品特征一致，确认归还' && c2.handlerId === 1, c2);
  check('认领 #3 白色蓝牙耳机 carol APPROVED + handleNote',
    c3.itemId === 10 && c3.applicantId === 4 && c3.status === 'APPROVED' &&
    c3.handleNote === '核实物品特征一致，确认归还' && c3.handlerId === 1, c3);

  console.log('\n=== 站内通知（6） ===');
  check('通知数 = 6', st.notifications.length === 6, st.notifications.length);
  check('未读通知 = 1（carol 的运动水杯）', st.notifications.filter(n => n.isRead === 0).length === 1);
  const n1 = st.notifications[0];
  check('通知 #1 carol/运动水杯/未读',
    n1.userId === 4 && n1.itemId === 7 && n1.isRead === 0 &&
    n1.content === '您发布的「运动水杯」收到一条认领申请，请及时处理。', n1);
  check('通知含 U盘 双向 2 条', st.notifications.filter(n => n.itemId === 8).length === 2);

  console.log('\n=== 审核记录（4） ===');
  check('审核记录 = 4', st.audits.length === 4, st.audits.length);
  check('含 撤回 / 归档 动作',
    st.audits.some(a => a.action === '撤回') && st.audits.some(a => a.action === '归档'), st.audits.map(a => a.action));
  check('归档作用在 item 10', st.audits.find(a => a.action === '归档').targetId === 10);

  console.log('\n=== 接口：公开物品列表 ===');
  let r = await api('GET', '/api/items?page=1&size=50');
  check('公开列表 code=0', r.code === 0, r);
  check('公开列表 total = 18（排除 2 条 CLOSED）', r.data.total === 18, r.data.total);
  check('公开列表不含 CLOSED', r.data.list.every(i => i.status !== 'CLOSED'));

  console.log('\n=== 接口：统计（真实聚合，过滤 hidden / CLOSED） ===');
  r = await api('GET', '/api/stats/category');
  check('category code=0 且为数组', r.code === 0 && Array.isArray(r.data), r);
  const cat = r.data;
  console.log('    category =>', JSON.stringify(cat));
  check('category 格式 {name,value}', cat.every(d => typeof d.name === 'string' && typeof d.value === 'number'));
  check('category 降序（值相同按名称升序）', cat.every((d, i, a) => i === 0 || a[i - 1].value > d.value ||
    (a[i - 1].value === d.value && a[i - 1].name <= d.name)), cat);
  const expectCat = { '生活用品': 5, '电子数码': 4, '证件卡片': 3, '书籍资料': 2, '衣物配饰': 3, '其他': 1 };
  const catSum = cat.reduce((a, d) => a + d.value, 0);
  check('category 合计 = 18（与公开列表一致）', catSum === 18, catSum);
  let catOk = true, catBad = [];
  cat.forEach(d => { if (expectCat[d.name] !== d.value) { catOk = false; catBad.push([d.name, d.value, expectCat[d.name]]); } });
  check('category 各组数量正确（6 个类别全覆盖）', catOk && cat.length === 6, catBad);
  check('category ≤ 10 组（TOP10）', cat.length <= 10, cat.length);

  r = await api('GET', '/api/stats/location');
  const loc = r.data;
  console.log('    location =>', JSON.stringify(loc));
  check('location code=0 非空', r.code === 0 && loc.length > 0, loc.length);
  // 地点去重后共 15 个，SQL 带 LIMIT 10，故只返回 TOP10，合计 ≤ 18
  const locSum = loc.reduce((a, d) => a + d.value, 0);
  check('location 为 TOP10 截断（合计 ≤ 18 且 > 0）', locSum > 0 && locSum <= 18, locSum);
  check('location 首位 体育馆=2 / 第一食堂=2', loc[0].value === 2 && loc[1].value === 2 && loc[2].value === 1, loc.slice(0, 3));
  check('location TOP10 ≤ 10 组', loc.length <= 10, loc.length);
  check('location 降序', loc.every((d, i, a) => i === 0 || a[i - 1].value >= d.value), loc);

  r = await api('GET', '/api/stats/monthly');
  const mon = r.data;
  console.log('    monthly  =>', JSON.stringify(mon));
  check('monthly code=0 非空', r.code === 0 && mon.length > 0, mon.length);
  check('monthly name 为 yyyy-MM', mon.every(d => /^\d{4}-\d{2}$/.test(d.name)), mon.map(d => d.name));
  check('monthly 升序', mon.every((d, i, a) => i === 0 || a[i - 1].name <= d.name), mon.map(d => d.name));
  check('monthly 合计 = 18', mon.reduce((a, d) => a + d.value, 0) === 18, mon.reduce((a, d) => a + d.value, 0));
  check('monthly 覆盖 6 个月（跨月趋势有形状）', mon.length >= 5 && mon.length <= 7, mon.length);

  console.log('\n=== 接口：登录 / 通知 / 认领 ===');
  r = await api('POST', '/api/user/login', { username: 'carol', password: '123456' });
  check('carol 登录成功', r.code === 0 && r.data.username === 'carol', r);
  r = await api('GET', '/api/notifications');
  check('carol 通知 3 条', r.data.list.length === 3, r.data.list.length);
  check('carol 未读 1 条', r.data.unread === 1, r.data.unread);

  r = await api('GET', '/api/claims');
  check('carol 的 incoming 含运动水杯 PENDING 申请',
    r.data.incoming.some(x => x.claim.itemId === 7 && x.claim.status === 'PENDING'), r.data.incoming.length);

  await api('POST', '/api/user/logout');
  r = await api('POST', '/api/user/login', { username: 'bob', password: '123456' });
  check('bob 登录成功', r.code === 0, r);
  r = await api('GET', '/api/claims');
  check('bob 的 mine 2 条（U盘 + 运动水杯）', r.data.mine.length === 2, r.data.mine.length);
  check('bob 的 mine 均为 APPROVED/PENDING',
    r.data.mine.every(x => ['PENDING', 'APPROVED'].includes(x.claim.status)), r.data.mine.map(x => x.claim.status));

  await api('POST', '/api/user/logout');
  r = await api('POST', '/api/user/login', { username: 'admin', password: 'admin123' });
  check('admin 登录成功', r.code === 0 && r.data.role === 'ADMIN', r);
  r = await api('GET', '/api/admin/items?page=1&size=100');
  check('后台可见全部 20 条', r.data.total === 20, r.data.total);
  r = await api('GET', '/api/admin/audit-records?page=1&size=20');
  check('后台审核记录 4 条', r.data.total === 4, r.data.total);

  console.log('\n---------------------------------------------');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  console.log('---------------------------------------------');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('自检脚本异常：', e);
  process.exit(2);
});
