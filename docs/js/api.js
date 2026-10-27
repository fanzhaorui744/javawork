/* 统一 API 封装：自动带 session cookie，401 引导登录，错误统一弹提示 */

/* 401 只跳转一次，避免公开页面开屏被反复打断 */
let _authRedirecting = false;

async function apiReq(method, path, body, isForm, opts) {
    opts = opts || {};
    const opt = { method, credentials: 'include', headers: {} };
    if (body !== undefined && body !== null) {
        if (isForm) {
            opt.body = body;
        } else {
            opt.headers['Content-Type'] = 'application/json';
            opt.body = JSON.stringify(body);
        }
    }
    let res;
    try {
        res = await fetch(API_BASE + path, opt);
    } catch (e) {
        alert('网络异常，请检查后端服务是否启动');
        throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }

    if (res.status === 401) {
        /* 静默模式：调用方自行处理（公开页面的 loadUser 走这条） */
        if (!opts.silent401 && !_authRedirecting) {
            _authRedirecting = true;
            const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
            location.href = 'login.html?redirect=' + back + '&reason=auth';
        }
        const err = new Error(data && data.message ? data.message : '请先登录');
        err.status = 401;
        err.handled = true;
        throw err;
    }
    if (!res.ok || (data && data.code !== 0)) {
        const msg = data && data.message ? data.message : ('请求失败（' + res.status + '）');
        const err = new Error(msg);
        err.status = res.status;
        err.handled = true;
        throw err;
    }
    return data.data;
}

const api = {
    get: (p, opts) => apiReq('GET', p, undefined, false, opts),
    post: (p, b) => apiReq('POST', p, b === undefined ? {} : b),
    put: (p, b) => apiReq('PUT', p, b),
    del: (p) => apiReq('DELETE', p),
    upload: (p, formData) => apiReq('POST', p, formData, true),
};
