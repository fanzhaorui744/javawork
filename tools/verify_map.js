#!/usr/bin/env node
/**
 * 验证 map.html 交互：
 *   1. 点图钉 → map-pop 打开，内容含物品
 *   2. 拖动不误触弹窗
 *   3. 双指缩放改变 VIEW.z
 *   4. 地点列表点击 → 平移并弹窗
 * 用法: node tools/verify_map.js [width] [height]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9477;
const BASE = 'http://localhost:8080';
const W = Number(process.argv[2] || 1440);
const H = Number(process.argv[3] || 900);
const OUT = 'E:\\java\\submit\\preview';
const userDir = path.join(process.env.TEMP, 'vmap-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const httpJson = p => new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
});

/** 新建一个空白标签页（避免连到 Chrome 扩展的后台页） */
const httpJsonPut = p => new Promise((res, rej) => {
    const req = http.request({
        host: '127.0.0.1', port: PORT, path: p, method: 'PUT',
    }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.end();
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

(async () => {
    const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
        '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, 'about:blank'], { stdio: 'ignore' });
    let ws;
    const results = [];
    const check = (name, pass, extra = '') => {
        results.push({ name, pass, extra });
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    };
    try {
        await sleep(3200);
        /* 新建标签页，确保连到我们的页面而不是扩展后台页 */
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
        await cdp.send('Log.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: W, height: H, deviceScaleFactor: 1, mobile: W < 800,
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

        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url: BASE + '/map.html' });
        await loaded;
        await sleep(3500);

        /* ---- 基础 ---- */
        console.log('  [diag] url =', await ev('location.href'));
        console.log('  [diag] readyState =', await ev('document.readyState'));
        console.log('  [diag] CampusMap =', await ev('typeof CampusMap'));
        console.log('  [diag] ICON =', await ev('typeof ICON'));
        console.log('  [diag] page body len =', await ev('document.body.innerHTML.length'));
        const pins = await ev(`document.querySelectorAll('.mp-pin').length`);
        check('图钉已渲染', pins > 5, `pins=${pins}`);
        const items = await ev('typeof ALL_ITEMS !== "undefined" ? ALL_ITEMS.length : -1');
        check('物品已加载', items >= 18, `items=${items}`);
        const overflow = await ev(`
            (() => {
                const s = document.getElementById('map-stage');
                const w = document.getElementById('map-world').getBoundingClientRect();
                const r = s.getBoundingClientRect();
                return JSON.stringify({
                    sw: Math.round(r.width), sh: Math.round(r.height),
                    ww: Math.round(w.width), wh: Math.round(w.height),
                    fillX: +(w.width / r.width * 100).toFixed(1),
                    fillY: +(w.height / r.height * 100).toFixed(1)
                });
            })()`);
        const ov = JSON.parse(overflow);
        /* 纵向必须 100% 铺满（高度是稀缺资源）；横向允许留白，由模糊底图填充 */
        check('地图纵向完全铺满', ov.fillY >= 99, `fillY=${ov.fillY}%`);
        /* 关键回归：地图高度不得超出舞台（超出即被 overflow:hidden 裁掉） */
        check('地图高度未溢出舞台', ov.wh <= ov.sh + 1, `wh=${ov.wh} sh=${ov.sh}`);
        const blurOk = await ev(`(() => {
            const b = document.getElementById('map-blur');
            return b && b.complete && b.naturalWidth > 0 ? 'OK' : 'FAILED';
        })()`);
        check('留白模糊填充图加载', String(blurOk) === 'OK', String(blurOk));
        const topAligned = await ev(`VIEW.y === 0 || VIEW.y === Math.max(0, stage.clientHeight - baseH * VIEW.z)`);
        check('初始视图顶部对齐', topAligned === true, `VIEW=${await ev('JSON.stringify(VIEW)')}`);

        /* ---- 点图钉（用 CDP 真实鼠标事件，验证 setPointerCapture 场景） ---- */
        await ev(`(() => {
            const b = document.querySelector('.mp-pin');
            const r = b.getBoundingClientRect();
            window.__pinXY = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.72) };
            return 1;
        })()`);
        const xy = JSON.parse(await ev('JSON.stringify(window.__pinXY)'));
        for (const type of ['mousePressed', 'mouseReleased']) {
            await cdp.send('Input.dispatchMouseEvent', {
                type, x: xy.x, y: xy.y, button: 'left', clickCount: 1,
            });
        }
        await sleep(900);
        const popOpen = await ev(`document.getElementById('map-pop').classList.contains('open')`);
        check('点图钉弹出物品卡', popOpen === true);
        const popText = await ev(`document.getElementById('pop-body').innerText.replace(/\\n+/g,' | ')`);
        check('弹窗含物品名', !!popText && popText.length > 10, String(popText).substring(0, 90));
        const linkN = await ev(`document.querySelectorAll('.pop-item').length`);
        check('弹窗含可点物品链接', linkN > 0, `links=${linkN}`);
        await shot(`verify_map_pop_${W}`);

        /* ---- 拖动不误触 ---- */
        /*
         * 舞台已锁成底图比例，z=1 时地图正好铺满、没有可平移空间，
         * 所以先放大到 1.8 倍再拖，才符合真实的「放大后拖动查看」路径。
         */
        await ev(`(() => {
            hidePop();
            fitView();
            zoomBy(0.8);                  /* z -> 1.8，此时有可平移空间 */
            const st = document.getElementById('map-stage');
            const r = st.getBoundingClientRect();
            const x0 = r.left + r.width * 0.35, y0 = r.top + r.height * 0.5;
            const opt = (x, y) => ({
                bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
                clientX: x, clientY: y, buttons: 1, button: 0, isPrimary: true
            });
            const before = { x: VIEW.x, y: VIEW.y };
            st.dispatchEvent(new PointerEvent('pointerdown', opt(x0, y0)));
            for (let i = 1; i <= 6; i++) {
                st.dispatchEvent(new PointerEvent('pointermove', opt(x0 - i * 12, y0 - i * 20)));
            }
            const x1 = x0 - 72, y1 = y0 - 120;
            st.dispatchEvent(new PointerEvent('pointerup', opt(x1, y1)));
            /* 浏览器在 pointerup 后会补一个 click 到 stage 上 */
            st.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x1, clientY: y1 }));
            window.__drag = { before, after: { x: VIEW.x, y: VIEW.y }, z: VIEW.z };
            return 1;
        })()`);
        await sleep(500);
        const poppedAfterDrag = await ev(`document.getElementById('map-pop').classList.contains('open')`);
        check('拖拽后不会误开弹窗', poppedAfterDrag === false);
        const dragInfo = JSON.parse(await ev('JSON.stringify(window.__drag)'));
        const moved = Math.abs(dragInfo.after.x - dragInfo.before.x)
            + Math.abs(dragInfo.after.y - dragInfo.before.y) > 20;
        check('拖拽确实平移了地图', moved === true,
            `z=${dragInfo.z} ${JSON.stringify(dragInfo.before)}→${JSON.stringify(dragInfo.after)}`);

        /* ---- 缩放 ---- */
        await ev(`fitView(); 1`);
        await sleep(300);
        await ev(`zoomBy(0.5); 1`);
        await sleep(400);
        const z = await ev('VIEW.z');
        check('放大按钮生效', z > 1.2, `z=${z}`);
        await ev(`document.getElementById('z-fit').click(); 1`);
        await sleep(400);
        const z2 = await ev('VIEW.z');
        check('复位按钮生效', z2 === 1, `z=${z2}`);

        /* ---- 地点列表 ---- */
        const rowN = await ev(`document.querySelectorAll('.place-row').length`);
        check('地点列表有行', rowN > 5, `rows=${rowN}`);
        await ev(`document.querySelectorAll('.place-row')[0].click(); 1`);
        await sleep(1000);
        const popOpen2 = await ev(`document.getElementById('map-pop').classList.contains('open')`);
        check('点地点列表也能弹窗', popOpen2 === true);
        await shot(`verify_map_place_${W}`);

        /* ---- 筛选 ---- */
        await ev(`document.querySelectorAll('#seg-type button')[1].click(); 1`);
        await sleep(800);
        const lostOnly = await ev(`
            (() => {
                const t = document.getElementById('map-stats').innerText.replace(/\\s+/g,' ');
                return t;
            })()`);
        check('筛选「寻物」生效', /招领\s*0/.test(lostOnly), lostOnly);

        check('无 JS 运行时异常', jsErrors.length === 0, jsErrors.slice(0, 2).join(' ;; '));

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
