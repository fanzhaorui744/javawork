#!/usr/bin/env node
/**
 * 模拟 APK 的 file:// 环境验证前端：
 *   - 用 file:// 打开 assets/www 里的页面（和 WebView 加载方式一致）
 *   - 确认 offline.js 接管、物品与地图图钉渲染、点图钉出弹窗
 * 用法: node tools/verify_apk_web.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9488;
const WWW = 'E:\\java\\lostfound\\android\\app\\src\\main\\assets\\www';
const OUT = 'E:\\java\\submit\\preview';
const userDir = path.join(process.env.TEMP, 'vapk-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const httpJson = p => new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
});
const httpJsonPut = p => new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'PUT' }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej); req.end();
});

class CDP {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
        ws.addEventListener('message', ev => {
            const m = JSON.parse(ev.data);
            if (m.id && this.pending.has(m.id)) {
                const { resolve } = this.pending.get(m.id);
                this.pending.delete(m.id); resolve(m.result || {});
            } else if (m.method) {
                (this.handlers.get(m.method) || []).forEach(fn => fn(m.params));
            }
        });
    }
    send(method, params) {
        return new Promise(resolve => {
            const id = ++this.id;
            this.pending.set(id, { resolve });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    once(evt, timeout = 15000) {
        return new Promise(resolve => {
            const arr = this.handlers.get(evt) || [];
            const fn = p => {
                clearTimeout(t);
                this.handlers.set(evt, (this.handlers.get(evt) || []).filter(x => x !== fn));
                resolve(p);
            };
            const t = setTimeout(() => {
                this.handlers.set(evt, (this.handlers.get(evt) || []).filter(x => x !== fn));
                resolve(null);
            }, timeout);
            arr.push(fn); this.handlers.set(evt, arr);
        });
    }
}

const results = [];
const check = (name, pass, extra = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

(async () => {
    const chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox',
        '--allow-file-access-from-files',
        '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, 'about:blank',
    ], { stdio: 'ignore' });
    let ws;
    try {
        await sleep(3200);
        let tab = await httpJsonPut('/json/new?about:blank');
        if (!tab || !tab.webSocketDebuggerUrl) {
            const tabs = await httpJson('/json/list');
            tab = tabs.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension://')) || tabs[0];
        }
        ws = new WebSocket(tab.webSocketDebuggerUrl);
        const cdp = new CDP(ws);
        await new Promise(r => ws.addEventListener('open', r));
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
        });

        const jsErrors = [];
        cdp.handlers.set('Runtime.exceptionThrown', [
            p => jsErrors.push(((p.exceptionDetails || {}).exception || {}).description || 'err'),
        ]);

        const ev = async expr => {
            const r = await cdp.send('Runtime.evaluate', {
                expression: expr, awaitPromise: true, returnByValue: true,
            });
            if (r.exceptionDetails) return 'EXC: ' + ((r.exceptionDetails.exception || {}).description || '');
            return r.result ? r.result.value : undefined;
        };
        const shot = async name => {
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
        };
        const goto = async url => {
            const loaded = cdp.once('Page.loadEventFired');
            await cdp.send('Page.navigate', { url });
            await loaded;
            await sleep(3000);
        };
        const fileUrl = rel => 'file:///' + path.join(WWW, rel).replace(/\\/g, '/');

        /* ---------- 1. 首页（file:// 下 offline 是否接管） ---------- */
        await goto(fileUrl('index.html'));
        check('file:// 下打开首页', (await ev('location.protocol')) === 'file:',
            await ev('location.protocol'));
        check('OFFLINE_MODE 已开启', (await ev('window.OFFLINE_MODE')) === true);
        const itemTotal = await ev(`
            (async () => {
                const r = await fetch('/api/items?page=1&size=100');
                const j = await r.json();
                return j.code === 0 ? j.data.total : -1;
            })()`);
        check('离线引擎返回物品数据', itemTotal >= 18, `total=${itemTotal}`);
        const cards = await ev(`document.querySelectorAll('.item-card, .card-item, [onclick*="item.html"]').length`);
        check('首页渲染出物品卡片', cards > 5, `cards=${cards}`);
        await shot('apk_01_index');

        /* ---------- 2. 地图页 ---------- */
        await goto(fileUrl('map.html'));
        const pins = await ev(`document.querySelectorAll('.mp-pin').length`);
        check('地图页渲染图钉', pins > 5, `pins=${pins}`);
        const imgOk = await ev(`(() => {
            const i = document.getElementById('map-img');
            return i && i.complete && i.naturalWidth > 0 ? i.naturalWidth + 'x' + i.naturalHeight : 'FAILED';
        })()`);
        check('底图 campus-map.jpg 加载成功', /\d+x\d+/.test(String(imgOk)), String(imgOk));
        const logoOk = await ev(`(() => {
            const i = document.querySelector('.nav img, .ahu-logo');
            return i ? (i.complete && i.naturalWidth > 0 ? 'OK' : 'FAILED') : 'NO-IMG';
        })()`);
        check('导航栏校徽加载', ['OK', 'NO-IMG'].includes(String(logoOk)), String(logoOk));
        const placeRows = await ev(`document.querySelectorAll('.place-row').length`);
        check('地点分布列表渲染', placeRows > 5, `rows=${placeRows}`);

        /* 点图钉 */
        await ev(`(() => {
            const b = document.querySelector('.mp-pin');
            dragMoved = 0;
            b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return 1;
        })()`);
        await sleep(800);
        const popOpen = await ev(`document.getElementById('map-pop').classList.contains('open')`);
        check('点图钉弹出物品卡', popOpen === true);
        const popItems = await ev(`document.querySelectorAll('.pop-item').length`);
        check('弹窗含物品', popItems > 0, `items=${popItems}`);
        await shot('apk_02_map_pop');

        /* 拖动 */
        await ev(`(() => {
            hidePop();
            const st = document.getElementById('map-stage');
            const r = st.getBoundingClientRect();
            const x0 = r.left + r.width * 0.5, y0 = r.top + r.height * 0.5;
            const opt = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
                clientX: x, clientY: y, buttons: 1, button: 0, isPrimary: true });
            st.dispatchEvent(new PointerEvent('pointerdown', opt(x0, y0)));
            for (let i = 1; i <= 5; i++) {
                st.dispatchEvent(new PointerEvent('pointermove', opt(x0 - i * 14, y0 - i * 18)));
            }
            st.dispatchEvent(new PointerEvent('pointerup', opt(x0 - 70, y0 - 90)));
            return JSON.stringify(VIEW);
        })()`).then(v => check('触摸拖动平移地图', /\-?[1-9]/.test(String(v)) || String(v).includes('-'),
            String(v)));

        /* ---------- 3. 详情页 F9 ---------- */
        await goto(fileUrl('login.html'));
        const loginRes = await ev(`
            (async () => {
                const r = await fetch('/api/user/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({username: 'alice', password: '123456'})
                });
                const j = await r.json();
                return j.code === 0 ? 'OK' : 'ERR:' + j.message;
            })()`);
        check('离线登录 alice', String(loginRes) === 'OK', String(loginRes));

        await goto(fileUrl('item.html?id=1'));
        const pickupShown = await ev(`document.getElementById('pickup-card').style.display !== 'none'`);
        check('详情页显示拾取者联系方式卡', pickupShown === true);
        const pickupText = await ev(`document.getElementById('pickup-body').innerText.replace(/\\n+/g,' | ')`);
        check('联系方式卡含拾取者信息', /小红|138/.test(String(pickupText)), String(pickupText).substring(0, 80));
        await shot('apk_03_pickup');

        /* ---------- 4. 发布页 + 其余页面无异常 ---------- */
        for (const [page, name] of [
            ['publish.html', '发布页'],
            ['claims.html', '认领中心'],
            ['notifications.html', '通知页'],
            ['stats.html', '统计页'],
            ['admin.html', '管理后台'],
        ]) {
            await goto(fileUrl(page));
            const bodyLen = await ev('document.body.innerHTML.length');
            check(`${name}可渲染`, bodyLen > 3000, `len=${bodyLen}`);
        }

        check('全程无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 2).join(' ;; '));
        ws.close();
    } finally {
        try { chrome.kill(); } catch (e) {}
        await sleep(400);
        try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
    }
    const bad = results.filter(r => !r.pass);
    console.log(`\n== ${results.length - bad.length}/${results.length} 通过 ==`);
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
