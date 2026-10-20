#!/usr/bin/env node
/**
 * 用 Chrome DevTools Protocol 截图（支持登录态）
 * 依赖：Node 22 内置 WebSocket + fetch
 * 用法：node tools/shot.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const BASE = 'http://localhost:8080';
const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'screenshots');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpJson(pathname) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: PORT, path: pathname }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

/* ---------------- 极简 CDP 客户端 ---------------- */
class CDP {
    constructor(ws) {
        this.ws = ws;
        this.id = 0;
        this.pending = new Map();
        this.events = new Map();
        ws.addEventListener('message', ev => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
            } else if (msg.method) {
                (this.events.get(msg.method) || []).forEach(fn => fn(msg.params));
            }
        });
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error('timeout: ' + method));
                }
            }, 45000);
        });
    }
    on(method, fn) {
        if (!this.events.has(method)) this.events.set(method, []);
        this.events.get(method).push(fn);
    }
    once(method) {
        return new Promise(resolve => {
            const fn = p => {
                const arr = this.events.get(method) || [];
                const i = arr.indexOf(fn);
                if (i >= 0) arr.splice(i, 1);
                resolve(p);
            };
            this.on(method, fn);
        });
    }
}

async function connect() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await httpJson('/json/list');
            const page = list.find(t => t.type === 'page');
            if (page) {
                const ws = new WebSocket(page.webSocketDebuggerUrl);
                await new Promise((res, rej) => {
                    ws.addEventListener('open', res);
                    ws.addEventListener('error', rej);
                });
                return new CDP(ws);
            }
        } catch (e) { /* 还没起来 */ }
        await sleep(400);
    }
    throw new Error('无法连接 Chrome DevTools');
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });

    const userDir = path.join(process.env.TEMP || '.', 'lf-shot-profile');
    fs.rmSync(userDir, { recursive: true, force: true });

    const chrome = spawn(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${userDir}`,
        '--window-size=1440,900',
        'about:blank',
    ], { stdio: 'ignore' });

    let cdp;
    try {
        cdp = await connect();
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Network.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
        });

        async function goto(url) {
            const loaded = cdp.once('Page.loadEventFired');
            await cdp.send('Page.navigate', { url });
            await loaded;
            await sleep(2200);
        }

        async function evaluate(expr) {
            const r = await cdp.send('Runtime.evaluate', {
                expression: expr, awaitPromise: true, returnByValue: true,
            });
            return r.result && r.result.value;
        }

        async function shot(name, fullPage = true) {
            let height = 900;
            if (fullPage) {
                const h = await evaluate('Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)');
                height = Math.min(Math.max(900, Math.ceil(h) + 40), 4200);
            }
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width: 1440, height, deviceScaleFactor: 1, mobile: false,
            });
            await sleep(700);
            const { data } = await cdp.send('Page.captureScreenshot', {
                format: 'png', captureBeyondViewport: true,
            });
            const file = path.join(OUT, name + '.png');
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
            console.log('  ✓', name + '.png', `(${width()}x${height})`);
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
            });
            return height;
        }

        function width() { return 1440; }

        /* 登录辅助：直接在页面上下文里 fetch，让 cookie 落到当前域 */
        async function loginAs(u, p) {
            await goto(BASE + '/login.html');
            const r = await evaluate(`
                (async () => {
                    const res = await fetch('/api/user/login', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        credentials: 'same-origin',
                        body: JSON.stringify({username: '${u}', password: '${p}'})
                    });
                    const j = await res.json();
                    return j.code === 0 ? 'OK:' + j.data.nickname : 'ERR:' + j.message;
                })()
            `);
            const text = (r && typeof r === 'object') ? String(r.value ?? r) : String(r ?? '');
            console.log(`  登录 ${u} -> ${text}`);
            return text.startsWith('OK');
        }

        /* ---------- 1. 公开页面 ---------- */
        console.log('截图中（未登录）...');
        await goto(BASE + '/index.html');
        await shot('01_信息广场_首页');

        await goto(BASE + '/login.html');
        await shot('02_登录注册', false);

        await goto(BASE + '/stats.html');
        await shot('03_数据统计');

        /* ---------- 2. 普通用户 alice ---------- */
        console.log('截图中（alice）...');
        await loginAs('alice', '123456');

        await goto(BASE + '/index.html');
        await shot('04_信息广场_已登录');

        await goto(BASE + '/map.html');
        await sleep(1500);
        await shot('05_校区地图');

        await goto(BASE + '/publish.html');
        await shot('06_发布信息');

        await goto(BASE + '/item.html?id=8');
        await evaluate('window.aiMatch ? aiMatch() : null');
        await sleep(2800);
        await shot('07_信息详情_AI匹配');

        /* 感谢接力：alice 认领的招领已确认，可见拾取者联系方式 */
        await goto(BASE + '/item.html?id=1');
        await sleep(1200);
        if (process.env.DEBUG_PICKUP) {
            console.log('    [dbg] ITEM =', await evaluate('ITEM ? ITEM.id + "/" + ITEM.type + "/" + ITEM.publisherId : "null"'));
            console.log('    [dbg] CURRENT_USER =', await evaluate('CURRENT_USER ? CURRENT_USER.id + ":" + CURRENT_USER.username : "null"'));
            console.log('    [dbg] isOwner =', await evaluate('typeof isOwner === "function" ? isOwner() : "no fn"'));
            console.log('    [dbg] itemId =', await evaluate('"[" + itemId() + "]"'));
            console.log('    [dbg] card display =', await evaluate('document.getElementById("pickup-card") ? document.getElementById("pickup-card").style.display : "no el"'));
            console.log('    [dbg] body len =', await evaluate('document.getElementById("pickup-body") ? document.getElementById("pickup-body").innerHTML.length : "no el"'));
            console.log('    [dbg] claims =', await evaluate(`
                (async () => {
                    const r = await fetch('/api/claims', {credentials: 'same-origin'});
                    const j = await r.json();
                    if (j.code !== 0) return 'ERR ' + j.message;
                    return JSON.stringify((j.data.mine||[]).map(v => v.claim.id + '@' + (v.item&&v.item.id) + ':' + v.claim.status));
                })()`));
        }
        await shot('08_拾取者联系方式');

        await goto(BASE + '/claims.html');
        await shot('09_认领中心');

        await goto(BASE + '/notifications.html');
        await shot('10_站内通知');

        /* ---------- 3. 管理员 ---------- */
        console.log('截图中（admin）...');
        await loginAs('admin', 'admin123');

        await goto(BASE + '/admin.html');
        await shot('11_管理后台');

        /* ---------- 4. 移动端 ---------- */
        console.log('截图中（移动端）...');
        await loginAs('alice', '123456');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 414, height: 896, deviceScaleFactor: 2, mobile: true,
        });
        await goto(BASE + '/index.html');
        await sleep(1000);
        /* 移动端只截首屏，避免超长图 */
        let s = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, '12_移动端_信息广场.png'), Buffer.from(s.data, 'base64'));
        console.log('  ✓ 12_移动端_信息广场.png');

        await goto(BASE + '/login.html');
        await sleep(600);
        s = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, '13_移动端_登录.png'), Buffer.from(s.data, 'base64'));
        console.log('  ✓ 13_移动端_登录.png');

        /* 移动端汉堡菜单展开态 */
        await goto(BASE + '/index.html');
        await sleep(600);
        await evaluate("document.getElementById('nav').classList.add('open')");
        await sleep(500);
        s = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, '14_移动端_导航展开.png'), Buffer.from(s.data, 'base64'));
        console.log('  ✓ 14_移动端_导航展开.png');

        /* 移动端地图页 */
        await goto(BASE + '/map.html');
        await sleep(1800);
        s = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, '15_移动端_校区地图.png'), Buffer.from(s.data, 'base64'));
        console.log('  ✓ 15_移动端_校区地图.png');

        console.log('\n全部完成 ->', OUT);
    } finally {
        try { chrome.kill(); } catch (e) { /* ignore */ }
        await sleep(500);
        fs.rmSync(userDir, { recursive: true, force: true });
    }
}

main().catch(e => {
    console.error('截图失败:', e.message);
    process.exit(1);
});
