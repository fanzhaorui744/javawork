#!/usr/bin/env node
/**
 * 线上 GitHub Pages 端到端验证（真浏览器、真网络、真鼠标事件）。
 * 覆盖用户反馈的四个问题：
 *   1. 地图上半部分被截掉  → 断言整图完整可见、无裁切
 *   2. 地图做大一点        → 断言地图高度占屏比例
 *   3. 手机手指拖动地图    → 派发触摸 PointerEvent 断言位移
 *   4. 点图钉显示物品信息  → CDP 真实鼠标点击断言弹层
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9501;
const BASE = 'https://fanzhaorui744.github.io/javawork/';
const OUT = 'E:\\java\\submit\\preview';
const userDir = path.join(process.env.TEMP, 'livesite-' + Date.now());
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
    once(evt, timeout = 30000) {
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

async function session(width, height, mobile, fn) {
    const chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, 'about:blank',
    ], { stdio: 'ignore' });
    let ws;
    try {
        await sleep(3500);
        const tab = await httpJsonPut('/json/new?about:blank');
        ws = new WebSocket(tab.webSocketDebuggerUrl);
        const cdp = new CDP(ws);
        await new Promise(r => ws.addEventListener('open', r));
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        await cdp.send('Network.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width, height, deviceScaleFactor: 1, mobile,
        });

        const jsErrors = [];
        cdp.handlers.set('Runtime.exceptionThrown', [
            p => jsErrors.push(((p.exceptionDetails || {}).exception || {}).description || 'err'),
        ]);
        const failedReq = [];
        cdp.handlers.set('Network.loadingFailed', [p => failedReq.push(p.errorText)]);

        const ev = async expr => {
            const r = await cdp.send('Runtime.evaluate', {
                expression: expr, awaitPromise: true, returnByValue: true,
            });
            if (r.exceptionDetails) {
                return 'EXC: ' + ((r.exceptionDetails.exception || {}).description || '');
            }
            return r.result ? r.result.value : undefined;
        };
        const goto = async url => {
            const loaded = cdp.once('Page.loadEventFired');
            await cdp.send('Page.navigate', { url });
            await loaded;
            await sleep(4000);
        };
        const shot = async name => {
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
        };
        await fn({ cdp, ev, goto, shot, width, height, mobile, jsErrors, failedReq });
        ws.close();
    } finally {
        try { chrome.kill(); } catch (e) {}
        await sleep(500);
    }
}

(async () => {
    /* ================= 桌面 1440x900 ================= */
    await session(1440, 900, false, async ({ cdp, ev, goto, shot, jsErrors, failedReq }) => {
        await goto(BASE + 'map.html');

        check('线上 map.html 标题正确',
            String(await ev('document.title')).length > 0, await ev('document.title'));

        const geo = JSON.parse(await ev(`(() => {
            const st = document.getElementById('map-stage');
            const r = st.getBoundingClientRect();
            const w = baseW * VIEW.z, h = baseH * VIEW.z;
            return JSON.stringify({
                sw: Math.round(r.width), sh: Math.round(r.height),
                mw: Math.round(w), mh: Math.round(h),
                fillX: +(w / r.width * 100).toFixed(1),
                fillY: +(h / r.height * 100).toFixed(1),
                z: VIEW.z
            });
        })()`));
        check('地图纵向铺满舞台', geo.fillY >= 99, `fillY=${geo.fillY}%`);
        check('地图未溢出舞台（无裁切）', geo.mh <= geo.sh + 1, `mh=${geo.mh} sh=${geo.sh}`);
        check('地图横向铺满舞台', geo.fillX >= 99, `fillX=${geo.fillX}%`);
        check('地图高度足够大', geo.mh / 900 > 0.9,
            `${geo.mh}px = 屏高 ${(geo.mh / 900 * 100).toFixed(0)}%`);

        const pins = await ev(`document.querySelectorAll('.mp-pin').length`);
        check('图钉数量', pins > 8, `pins=${pins}`);

        /* 验证所有图钉都在可视区内（顶部不被裁） */
        const clipped = JSON.parse(await ev(`(() => {
            const st = document.getElementById('map-stage').getBoundingClientRect();
            let out = 0;
            document.querySelectorAll('.mp-pin').forEach(p => {
                const r = p.getBoundingClientRect();
                if (r.top < st.top - 1 || r.bottom > st.bottom + 1) out++;
            });
            return JSON.stringify(out);
        })()`));
        check('没有图钉被上下裁切', clipped === 0, `被裁=${clipped}`);

        /* 真实鼠标点击图钉 */
        const xy = JSON.parse(await ev(`(() => {
            const b = document.querySelector('.mp-pin');
            const r = b.getBoundingClientRect();
            return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.7) });
        })()`));
        for (const type of ['mousePressed', 'mouseReleased']) {
            await cdp.send('Input.dispatchMouseEvent', {
                type, x: xy.x, y: xy.y, button: 'left', clickCount: 1,
            });
        }
        await sleep(1000);
        check('点图钉弹出物品卡',
            (await ev(`document.getElementById('map-pop').classList.contains('open')`)) === true);
        const popName = await ev(`(document.querySelector('.pop-item b, .pop-item .pi-name, .pop-item h4') || {}).textContent`);
        check('弹窗显示物品名', !!popName, String(popName).trim().substring(0, 20));
        const links = await ev(`document.querySelectorAll('#map-pop a[href*="item.html"]').length`);
        check('弹窗含详情链接', links > 0, `links=${links}`);
        await shot('live_01_map_pop');

        /* 拖拽不误开 */
        await ev(`(() => {
            hidePop(); fitView(); zoomBy(0.8);
            const st = document.getElementById('map-stage');
            const r = st.getBoundingClientRect();
            const x0 = r.left + r.width * 0.4, y0 = r.top + r.height * 0.5;
            const o = (x, y) => ({ bubbles:true, cancelable:true, pointerId:1, pointerType:'mouse',
                clientX:x, clientY:y, buttons:1, button:0, isPrimary:true });
            window.__b = { x: VIEW.x, y: VIEW.y };
            st.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0)));
            for (let i = 1; i <= 6; i++) st.dispatchEvent(new PointerEvent('pointermove', o(x0 - i*14, y0 - i*10)));
            st.dispatchEvent(new PointerEvent('pointerup', o(x0 - 84, y0 - 60)));
            window.__a = { x: VIEW.x, y: VIEW.y };
            return 1;
        })()`);
        await sleep(400);
        check('拖拽后不误开弹窗',
            (await ev(`document.getElementById('map-pop').classList.contains('open')`)) === false);
        check('拖拽确实平移地图',
            (await ev(`Math.abs(window.__a.x - window.__b.x) + Math.abs(window.__a.y - window.__b.y) > 20`)) === true);

        /* 筛选（属性名是 data-v，不是 data-type） */
        await ev(`(() => {
            const b = document.querySelector('button[data-v="LOST"]');
            if (b) b.click();
            return 1;
        })()`);
        await sleep(800);
        const lostOnly = await ev(`(() => {
            const t = document.body.innerText;
            const m = t.match(/共\\s*(\\d+)\\s*件[\\s\\S]{0,20}?寻物\\s*(\\d+)[\\s\\S]{0,20}?招领\\s*(\\d+)/);
            return m ? m[0].replace(/\\s+/g, ' ') : 'NO-MATCH';
        })()`);
        check('筛选「寻物」后招领数归零', /招领\s*0/.test(String(lostOnly)), String(lostOnly));
        const lostPins = await ev(`document.querySelectorAll('.mp-pin').length`);
        check('筛选后图钉只剩寻物', lostPins > 0 && lostPins < pins,
            `${pins} → ${lostPins}`);

        check('全程无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 1).join(''));
        check('无资源加载失败', failedReq.length === 0, failedReq.slice(0, 2).join(','));
    });

    /* ================= 手机 390x844 ================= */
    await session(390, 844, true, async ({ ev, goto, shot, jsErrors }) => {
        await goto(BASE + 'map.html');
        check('手机端图钉渲染', (await ev(`document.querySelectorAll('.mp-pin').length`)) > 8);

        const geo = JSON.parse(await ev(`(() => {
            const r = document.getElementById('map-stage').getBoundingClientRect();
            const w = baseW * VIEW.z, h = baseH * VIEW.z;
            return JSON.stringify({
                sw: Math.round(r.width), sh: Math.round(r.height),
                mw: Math.round(w), mh: Math.round(h),
                wRatio: +(w / 390 * 100).toFixed(0),
                fillY: +(h / r.height * 100).toFixed(1)
            });
        })()`));
        check('手机地图纵向铺满', geo.fillY >= 99, `fillY=${geo.fillY}%`);
        check('手机地图宽度超出屏宽（可横向拖动）', geo.mw > 390,
            `${geo.mw}px = 屏宽 ${geo.wRatio}%`);

        /* 单指拖动 */
        const drag = JSON.parse(await ev(`(() => {
            const st = document.getElementById('map-stage');
            const r = st.getBoundingClientRect();
            const x0 = r.left + r.width * 0.6, y0 = r.top + r.height * 0.5;
            const o = (x, y) => ({ bubbles:true, cancelable:true, pointerId:1, pointerType:'touch',
                clientX:x, clientY:y, buttons:1, button:0, isPrimary:true });
            const before = VIEW.x;
            st.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0)));
            for (let i = 1; i <= 8; i++) st.dispatchEvent(new PointerEvent('pointermove', o(x0 - i*15, y0)));
            st.dispatchEvent(new PointerEvent('pointerup', o(x0 - 120, y0)));
            return JSON.stringify({ before, after: VIEW.x });
        })()`));
        check('手机单指拖动平移地图', Math.abs(drag.after - drag.before) > 20,
            `${drag.before} → ${drag.after}`);

        /* 图钉点击：用 CDP 真实触摸事件（touchStart/touchEnd），
           这样浏览器会生成真实指针，setPointerCapture 才有效 */
        await ev(`fitView()`);
        await sleep(400);
        const pt = JSON.parse(await ev(`(() => {
            const b = document.querySelectorAll('.mp-pin')[3];
            const r = b.getBoundingClientRect();
            return JSON.stringify({
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height * 0.7)
            });
        })()`));
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: pt.x, y: pt.y, id: 1 }],
        });
        await sleep(120);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(1100);
        check('手机点图钉弹出底部抽屉',
            (await ev(`document.getElementById('map-pop').classList.contains('open')`)) === true);
        await shot('live_02_mobile_pop');

        check('手机端无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 1).join(''));
    });

    /* ================= 首页 / 详情页 ================= */
    await session(1440, 900, false, async ({ ev, goto, shot, jsErrors }) => {
        await goto(BASE + 'index.html');
        const cards = await ev(`document.querySelectorAll('.item-card, .card-item, [data-id]').length`);
        check('线上首页渲染物品', cards > 3, `cards=${cards}`);
        await shot('live_03_index');

        await goto(BASE + 'item.html?id=1');
        const bodyLen = await ev('document.body.innerHTML.length');
        check('线上详情页渲染', bodyLen > 5000, `len=${bodyLen}`);
        check('详情页无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 1).join(''));
    });

    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
    const bad = results.filter(r => !r.pass);
    console.log(`\n== ${results.length - bad.length}/${results.length} 通过 ==`);
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
