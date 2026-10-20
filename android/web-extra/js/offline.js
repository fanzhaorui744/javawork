/* =============================================================================
 * 校园失物招领 · 离线演示引擎（offline.js）
 * -----------------------------------------------------------------------------
 * 作用：
 *   1. 在 window.OFFLINE_MODE === true（或页面以 file:// 打开）时接管 fetch，
 *      拦截所有 /api/** 请求，用内存 + localStorage 里的数据模拟真实后端。
 *   2. 返回体严格对齐真实后端：成功 {code:0, message:"操作成功", data:...}，
 *      业务失败 {code:非0, message:"中文提示"}，未登录 401 / 无权限 403。
 *   3. 提供 window.aiChat(prompt)：优先调用原生桥 window.NativeAI.chat，
 *      失败自动降级为本地关键词提取 / 相似度评分。
 *
 * 演示账号：admin/admin123、alice/123456、bob/123456、carol/123456
 * 重置数据：打开任意页面加参数 ?resetDemo=1，或控制台执行 LFOffline.reset()
 * ========================================================================== */
(function () {
    'use strict';

    if (window.__LF_OFFLINE_LOADED__) {
        return;
    }
    window.__LF_OFFLINE_LOADED__ = true;

    var IS_FILE = (typeof location !== 'undefined' && location.protocol === 'file:');
    var OFFLINE = (window.OFFLINE_MODE === true) || IS_FILE;
    if (OFFLINE) {
        window.OFFLINE_MODE = true;
    }

    var STORAGE_KEY = 'lostfound.offline.v5';
    var STATE_VERSION = 5;
    var LATENCY_MIN = 60;
    var LATENCY_MAX = 180;

    /* ------------------------------------------------------------------ *
     * 0. 基础工具
     * ------------------------------------------------------------------ */
    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    /** Date -> "YYYY-MM-DDTHH:mm:ss"（对齐 Jackson 的 LocalDateTime ISO 输出） */
    function iso(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function nowIso() { return iso(new Date()); }

    function daysAgo(days, hour, minute) {
        var d = new Date();
        d.setDate(d.getDate() - days);
        if (typeof hour === 'number') {
            d.setHours(hour, minute || 0, 0, 0);
        }
        return iso(d);
    }

    /** 对齐 Java：LocalDateTime.now().minusMonths(m).minusDays(d) */
    function monthsAgo(months, days) {
        var d = new Date();
        d.setMonth(d.getMonth() - months);
        d.setDate(d.getDate() - days);
        return iso(d);
    }

    function ts(s) {
        if (!s) { return NaN; }
        var t = Date.parse(String(s).replace(' ', 'T'));
        return isNaN(t) ? NaN : t;
    }

    function toInt(v, def) {
        var n = parseInt(v, 10);
        return isNaN(n) ? def : n;
    }

    function str(v) {
        return v === null || v === undefined ? '' : String(v);
    }

    function contains(a, b) {
        if (!a || !b) { return false; }
        return String(a).toLowerCase().indexOf(String(b).toLowerCase()) >= 0;
    }

    function clone(v) {
        return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    }

    /** 中文按二元组、英文按词切分，用于相似度与关键词提取 */
    var STOP_WORDS = {
        '一个': 1, '一下': 1, '我的': 1, '丢了': 1, '捡到': 1, '东西': 1, '在的': 1,
        '时候': 1, 'the': 1, 'and': 1, 'with': 1, '东西在': 1
    };

    function tokens(text) {
        var set = {};
        if (!text) { return set; }
        var lower = String(text).toLowerCase();
        var words = lower.split(/[^a-z0-9]+/);
        for (var i = 0; i < words.length; i++) {
            if (words[i].length >= 2) { set[words[i]] = 1; }
        }
        var cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) || [];
        for (var r = 0; r < cjkRuns.length; r++) {
            var seg = cjkRuns[r];
            for (var k = 0; k + 2 <= seg.length; k++) {
                set[seg.substring(k, k + 2)] = 1;
            }
        }
        return set;
    }

    function tokenOverlap(a, b) {
        var ta = tokens(a), tb = tokens(b);
        var ka = Object.keys(ta), kb = Object.keys(tb);
        if (!ka.length || !kb.length) { return 0; }
        var inter = 0;
        for (var i = 0; i < ka.length; i++) {
            if (tb[ka[i]]) { inter++; }
        }
        return inter / Math.max(ka.length, kb.length);
    }

    function extractKeywords(text, limit) {
        var out = [];
        var seen = {};
        function push(w) {
            if (!w || w.length < 2 || STOP_WORDS[w] || seen[w]) { return; }
            seen[w] = 1;
            out.push(w);
        }
        var lower = str(text).toLowerCase();
        var words = lower.split(/[^a-z0-9]+/);
        for (var i = 0; i < words.length; i++) { push(words[i]); }
        var runs = str(text).match(/[\u4e00-\u9fff]{2,}/g) || [];
        for (var r = 0; r < runs.length; r++) {
            var seg = runs[r];
            for (var k = 0; k + 2 <= seg.length; k++) { push(seg.substring(k, k + 2)); }
            if (seg.length <= 6) { push(seg); }
        }
        return out.slice(0, limit || 8);
    }

    /* ------------------------------------------------------------------ *
     * 1. 占位图（内联 SVG，不依赖任何远程图片）
     * ------------------------------------------------------------------ */
    var CATEGORY_GLYPH = {
        '生活用品': '☂',
        '证件卡片': '🪪',
        '电子数码': '🎧',
        '书籍资料': '📚',
        '衣物配饰': '🧣',
        '其他': '📦'
    };

    var imageCache = {};

    function svgImage(type, category, label) {
        var key = type + '|' + category + '|' + label;
        if (imageCache[key]) { return imageCache[key]; }
        var glyph = CATEGORY_GLYPH[category] || '📦';
        var accent = type === 'LOST' ? '#FF7A7A' : '#3DE0B0';
        var tag = type === 'LOST' ? 'LOST · 寻物' : 'FOUND · 招领';
        var svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">' +
            '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#182539"/><stop offset="1" stop-color="#0B0F18"/>' +
            '</linearGradient></defs>' +
            '<rect width="160" height="160" rx="22" fill="url(#bg)"/>' +
            '<circle cx="80" cy="70" r="42" fill="' + accent + '" opacity="0.10"/>' +
            '<circle cx="80" cy="70" r="42" fill="none" stroke="' + accent + '" stroke-opacity="0.25"/>' +
            '<text x="80" y="88" font-size="52" text-anchor="middle">' + glyph + '</text>' +
            '<text x="80" y="136" font-size="12" fill="' + accent + '" text-anchor="middle" ' +
            'font-family="sans-serif" letter-spacing="1">' + tag + '</text>' +
            '</svg>';
        var uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        imageCache[key] = uri;
        return uri;
    }

    /* ------------------------------------------------------------------ *
     * 2. 初始演示数据（对齐 DemoDataInitializer）
     * ------------------------------------------------------------------ */
    function seedUsers() {
        return [
            { id: 1, username: 'admin', role: 'ADMIN', nickname: '系统管理员', contact: 'admin@campus.edu', createTime: daysAgo(120, 9, 0), _pwd: 'admin123' },
            { id: 2, username: 'alice', role: 'USER', nickname: '小明（失主）', contact: '13800000001', createTime: daysAgo(118, 10, 0), _pwd: '123456' },
            { id: 3, username: 'bob', role: 'USER', nickname: '小红（拾取者）', contact: '13800000002', createTime: daysAgo(117, 11, 0), _pwd: '123456' },
            { id: 4, username: 'carol', role: 'USER', nickname: '同学C', contact: '13800000003', createTime: daysAgo(116, 12, 0), _pwd: '123456' }
        ];
    }

    /** 对齐 Java：createTime = eventTime.plusHours(2) */
    function plusHours(isoText, hours) {
        var base = ts(isoText);
        if (isNaN(base)) { return isoText; }
        return iso(new Date(base + hours * 3600 * 1000));
    }

    /**
     * 地点 -> {x%, y%}，与后端 DemoDataInitializer.CAMPUS_COORD 完全一致，
     * 也与前端 js/campus-map.js 的 PLACES 对应（底图为 img/campus-map.jpg）。
     */
    var CAMPUS_COORD = {
        '行知楼': [41.4, 21.9],
        '艺术楼': [44.1, 34.1],
        '人文楼': [40.2, 43.8],
        '社科楼': [48.8, 53.1],
        '笃行南楼': [25.9, 38.1],
        '博学南楼D座': [30.8, 45.0],
        'A座': [41.4, 12.4],
        'B座': [30.6, 15.7],
        'C座': [32.0, 11.6],
        '健康科学研究院': [40.9, 5.3],
        '办公楼': [59.6, 68.2],
        '桔园餐厅': [16.2, 8.1],
        '梅园餐厅': [15.9, 45.0],
        '翡翠湖宴会厅': [54.1, 9.2],
        '桔园宿舍楼': [11.1, 15.0],
        '1号楼': [11.1, 17.9],
        '松园': [14.1, 39.6],
        '竹园宿舍楼': [20.2, 50.8],
        '槐园': [23.5, 53.7],
        '枫园': [29.1, 60.9],
        '曙光人工湖': [38.2, 28.6],
        '莲花池': [40.1, 16.8],
        '绿化公园': [33.2, 32.6],
        '神隐花园': [61.4, 33.5],
        '望湖台': [66.8, 11.6],
        '杏坛广场': [43.7, 39.5],
        '南体育场': [36.0, 66.6],
        '篮球场': [60.7, 37.2],
        '西门': [2.6, 26.9],
        '西2门': [57.8, 29.5]
    };

    /**
     * 物品种子：严格按 DemoDataInitializer 的 item(...) / itemWithStatus(...) 调用顺序与参数。
     * 每行 = [type, name, category, location, mapX, mapY, eventTime,
     *         description, contact, publisherId, status]
     * mapX/mapY 为磬苑校区底图（img/campus-map.jpg）百分比坐标，与 static/js/campus-map.js 一致。
     * imagePath 统一为 null（与 Java 的 i.setImagePath(null) 一致）。
     */
    /**
     * 物品种子：严格按 DemoDataInitializer 的 item(...) / itemWithStatus(...) 调用顺序与参数。
     * 每行 = [type, name, category, location, mapX, mapY, eventTime,
     *         description, contact, publisherId, status]
     * mapX/mapY 为磬苑校区底图（img/campus-map.jpg）百分比坐标，与 static/js/campus-map.js 一致。
     * imagePath 统一为 null（与 Java 的 i.setImagePath(null) 一致）。
     */
    function seedItems() {
        function d(n) { return daysAgo(n); }
        function m(months, days) { return monthsAgo(months, days); }

        var list = [

            /* ---- 一、感谢接力演示：雨伞已被认领确认（alice 可见 bob 联系方式） ---- */
            ['FOUND', '黑色折叠雨伞', '生活用品', '行知楼', 41.4, 21.9, d(1),
                '在行知楼二楼自习区座位上捡到一把黑色折叠雨伞，伞柄上系着蓝色挂绳，伞面有轻微磨损。认领请说明挂绳细节。',
                '13800000002', 3, 'RESOLVED'],
            ['LOST', '黑色折叠雨伞', '生活用品', '行知楼', 41.4, 21.9, d(2),
                '昨晚在行知楼二楼自习区丢失一把黑色折叠雨伞，伞柄系蓝色挂绳，内有校园卡套。',
                '13800000001', 2, 'RESOLVED'],
            ['LOST', '校园卡', '证件卡片', '桔园餐厅', 16.2, 8.1, d(3),
                '10月10日中午在桔园餐厅丢失校园卡，卡面姓名范某某，学号 W1243 开头，捡到请联系，感谢！',
                '13800000001', 2, 'PENDING'],
            ['FOUND', '蓝色保温杯', '生活用品', 'A座', 41.4, 12.4, d(4),
                '下课后在 A座 301 捡到蓝色保温杯一个，杯身贴有卡通贴纸，杯盖有磕碰痕迹。',
                '13800000002', 3, 'PENDING'],
            ['LOST', '高等数学教材', '书籍资料', 'B座', 30.6, 15.7, d(8),
                '在 B座 丢失《高等数学》第七版上册，书内有手写笔记和借书卡，封面右下角有破损。',
                '13800000001', 4, 'PENDING'],
            ['FOUND', '苹果无线耳机充电盒', '电子数码', '南体育场', 36.0, 66.6, d(12),
                '傍晚在南体育场看台捡到一个白色 AirPods 充电盒，盒内有左右耳机，外壳有细小划痕。',
                '13800000002', 2, 'PENDING'],

            /* ---- 二、认领处理中（1 条） ---- */
            ['LOST', '运动水杯', '生活用品', '南体育场', 36.0, 66.6, d(15),
                '在南体育场操场丢失透明运动水杯一只，杯身印有校徽。',
                '13800000003', 4, 'CLAIMING'],

            /* ---- 三、已归还（1 条，已完成核心闭环） ---- */
            ['LOST', 'U盘（32G 银色）', '电子数码', 'C座', 32.0, 11.6, d(45),
                '在 C座 机房上课丢失银色 32G U盘一个，内有课程作业文件，捡到必有重谢。',
                '13800000001', 2, 'RESOLVED'],

            /* ---- 四、已关闭（2 条：撤回 / 归档） ---- */
            ['LOST', '宿舍钥匙串', '生活用品', '竹园宿舍楼', 20.2, 50.8, d(70),
                '竹园宿舍楼下丢失钥匙一串，共5把钥匙，带红色钥匙扣。',
                '13800000003', 4, 'CLOSED'],
            ['FOUND', '白色蓝牙耳机', '电子数码', '行知楼', 41.4, 21.9, d(52),
                '行知楼一楼大厅服务台代收白色蓝牙耳机一只，请失主凭购买凭证认领。',
                '13800000002', 3, 'CLOSED'],

            /* ---- 五、历史月份数据（10 条，撑起逐月趋势图） ---- */
            ['FOUND', '灰色围巾', '衣物配饰', '笃行南楼', 25.9, 38.1, m(1, 6),
                '笃行南楼阅览区捡到灰色针织围巾一条，无品牌标识。',
                '13800000002', 3, 'PENDING'],
            ['LOST', '学生证', '证件卡片', '西2门', 57.8, 29.5, m(1, 12),
                '在西2门附近丢失学生证，姓名已涂销，请拾到者联系。',
                '13800000001', 2, 'PENDING'],
            ['FOUND', '机械键盘', '电子数码', '健康科学研究院', 40.9, 5.3, m(2, 5),
                '健康科学研究院机房捡到黑色 87 键机械键盘一把，键帽有使用痕迹。',
                '13800000002', 3, 'PENDING'],
            ['LOST', '篮球', '其他', '篮球场', 60.7, 37.2, m(2, 18),
                '篮球场遗失斯伯丁篮球一个，球面写有「3班」字样。',
                '13800000003', 4, 'PENDING'],
            ['FOUND', '笔记本', '书籍资料', '人文楼', 40.2, 43.8, m(3, 9),
                '人文楼捡到笔记本一本，内含实验报告与课堂笔记。',
                '13800000001', 2, 'PENDING'],
            ['LOST', '电动车钥匙', '生活用品', '枫园', 29.1, 60.9, m(3, 21),
                '枫园楼下丢失电动车钥匙，钥匙扣是蓝色小熊造型。',
                '13800000002', 3, 'PENDING'],
            ['FOUND', '充电宝', '电子数码', '社科楼', 48.8, 53.1, m(4, 11),
                '社科楼一楼大厅捡到白色充电宝一个，容量 10000mAh。',
                '13800000003', 4, 'PENDING'],
            ['LOST', '眼镜', '衣物配饰', '艺术楼', 44.1, 34.1, m(4, 23),
                '艺术楼丢失黑框近视眼镜一副，度数约 400 度。',
                '13800000001', 2, 'PENDING'],
            ['FOUND', '雨衣', '衣物配饰', '西2门', 57.8, 29.5, m(5, 7),
                '西2门传达室收到深蓝色雨衣一件，无人认领。',
                '13800000002', 3, 'PENDING'],
            ['LOST', '水卡', '证件卡片', '梅园餐厅', 15.9, 45.0, m(5, 16),
                '梅园餐厅丢失饭卡充值水卡一张，卡内余额不多但希望找回。',
                '13800000003', 4, 'PENDING'],
        ];

        var out = [];
        for (var i = 0; i < list.length; i++) {
            var t = list[i];
            var createTime = plusHours(t[6], 2);
            /* mapX/mapY 显式为 null 时按地点名回填 */
            var fallback = CAMPUS_COORD[t[3]];
            out.push({
                id: i + 1,
                type: t[0],
                name: t[1],
                category: t[2],
                location: t[3],
                mapX: t[4] != null ? t[4] : (fallback ? fallback[0] : null),
                mapY: t[5] != null ? t[5] : (fallback ? fallback[1] : null),
                eventTime: t[6],
                description: t[7],
                contact: t[8],
                imagePath: null,
                status: t[10],
                publisherId: t[9],
                hidden: 0,
                createTime: createTime,
                updateTime: createTime
            });
        }
        return out;
    }

    /** 认领申请：4 条（对齐 DemoDataInitializer 的 claim(...) 调用） */
    function seedClaims() {
        return [
            // 黑色折叠雨伞（item 1）· alice 申请 bob 的招领 · 已确认 → 演示「感谢接力」
            {
                id: 1, itemId: 1, applicantId: 2,
                description: '伞柄上的蓝色挂绳是我系的，伞内还有一张校园卡套，可以核对卡套里的照片。',
                status: 'APPROVED', handlerId: 1,
                handleNote: '核实挂绳与卡套细节一致，确认归还', handleTime: daysAgo(1),
                thanked: 0, thankNote: null, thankTime: null,
                createTime: daysAgo(1)
            },
            // 运动水杯（item 7）· bob 申请 · 待处理
            {
                id: 2, itemId: 7, applicantId: 3,
                description: '杯子是我的，杯底有一道竖着的划痕，杯身上贴过校运会标签但已撕掉。',
                status: 'PENDING', handlerId: null, handleNote: null, handleTime: null,
                thanked: 0, thankNote: null, thankTime: null,
                createTime: daysAgo(14)
            },
            // U盘（item 8）· bob 申请 · 管理员已确认
            {
                id: 3, itemId: 8, applicantId: 3,
                description: '我在 C座 机房捡到一个银色U盘，插上后里面有一个「课程作业」文件夹。',
                status: 'APPROVED', handlerId: 1,
                handleNote: '核实物品特征一致，确认归还', handleTime: daysAgo(42),
                thanked: 0, thankNote: null, thankTime: null,
                createTime: daysAgo(43)
            },
            // 白色蓝牙耳机（item 10）· carol 申请 · 管理员已确认
            {
                id: 4, itemId: 10, applicantId: 4,
                description: '耳机是我的，右耳外壳有一道浅色刮痕，充电盒内侧贴着保修贴。',
                status: 'APPROVED', handlerId: 1,
                handleNote: '核实物品特征一致，确认归还', handleTime: daysAgo(49),
                thanked: 0, thankNote: null, thankTime: null,
                createTime: daysAgo(50)
            }
        ];
    }

    /** 站内通知：8 条（对齐 DemoDataInitializer 的 notify(...) 调用） */
    function seedNotifications() {
        return [
            { id: 1, userId: 2, itemId: 1, content: '您对「黑色折叠雨伞」的认领申请已被确认，现在可以查看拾取者联系方式并向 TA 致谢。', isRead: 0, createTime: daysAgo(1) },
            { id: 2, userId: 3, itemId: 1, content: '失主已确认您捡到的「黑色折叠雨伞」，感谢您的善意。', isRead: 1, createTime: daysAgo(1) },
            { id: 3, userId: 4, itemId: 7, content: '您发布的「运动水杯」收到一条认领申请，请及时处理。', isRead: 0, createTime: daysAgo(14) },
            { id: 4, userId: 2, itemId: 8, content: '您发布的「U盘（32G 银色）」认领申请已被确认，物品状态更新为「已归还/已解决」。', isRead: 1, createTime: daysAgo(42) },
            { id: 5, userId: 3, itemId: 8, content: '您对「U盘（32G 银色）」的认领申请已被确认，请联系发布者取回。', isRead: 1, createTime: daysAgo(42) },
            { id: 6, userId: 4, itemId: 9, content: '您发布的「宿舍钥匙串」已关闭，不再公开展示。', isRead: 1, createTime: daysAgo(68) },
            { id: 7, userId: 3, itemId: 10, content: '您发布的「白色蓝牙耳机」认领申请已被确认。', isRead: 1, createTime: daysAgo(49) },
            { id: 8, userId: 4, itemId: 10, content: '您对「白色蓝牙耳机」的认领申请已被确认。', isRead: 1, createTime: daysAgo(49) }
        ];
    }

    /** 审核记录：5 条（对齐 DemoDataInitializer 的 audit(...) 调用） */
    function seedAudits() {
        return [
            { id: 1, adminId: 1, action: '认领确认', targetId: 1, detail: '审核认领申请 #1，确认物品已归还，失主可查看拾取者联系方式', createTime: daysAgo(1) },
            { id: 2, adminId: 1, action: '认领确认', targetId: 8, detail: '审核认领申请 #3，确认物品已归还', createTime: daysAgo(42) },
            { id: 3, adminId: 4, action: '撤回', targetId: 9, detail: '发布者本人撤回信息，状态变更为已关闭', createTime: daysAgo(68) },
            { id: 4, adminId: 3, action: '认领确认', targetId: 10, detail: '审核认领申请 #4，确认物品已归还', createTime: daysAgo(49) },
            { id: 5, adminId: 1, action: '归档', targetId: 10, detail: '已归还信息归档关闭', createTime: daysAgo(48) }
        ];
    }

    function buildSeedState() {
        var users = seedUsers();
        return {
            version: STATE_VERSION,
            seq: { item: 20, claim: 4, notif: 8, audit: 5, user: 4 },
            users: users,
            items: seedItems(),
            claims: seedClaims(),
            notifications: seedNotifications(),
            audits: seedAudits(),
            sessionUserId: null
        };
    }

    /* ------------------------------------------------------------------ *
     * 3. 状态存取（localStorage 持久化，模拟数据库）
     * ------------------------------------------------------------------ */
    var state = null;

    function loadState() {
        var fresh = buildSeedState();
        try {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && parsed.version === STATE_VERSION &&
                    parsed.users && parsed.items && parsed.claims) {
                    // 补齐可能缺失的集合，避免旧结构报错
                    parsed.notifications = parsed.notifications || [];
                    parsed.audits = parsed.audits || [];
                    parsed.seq = parsed.seq || fresh.seq;
                    parsed.sessionUserId = parsed.sessionUserId || null;
                    state = parsed;
                    return state;
                }
            }
        } catch (e) {
            // 数据损坏或隐私模式禁用 localStorage：退回内存态
        }
        state = fresh;
        persist();
        return state;
    }

    function persist() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            // 配额超限：把用户上传的 data URL 图片降级成占位图后重试一次
            try {
                for (var i = 0; i < state.items.length; i++) {
                    var it = state.items[i];
                    if (it.imagePath && it.imagePath.indexOf('data:image/svg') !== 0) {
                        it.imagePath = svgImage(it.type, it.category, it.name);
                    }
                }
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } catch (e2) {
                // 仍然失败则只保留内存态，演示不中断
            }
        }
    }

    function nextId(kind) {
        /*
         * 兜底：取「序列当前值」与「该集合已有最大 id」的较大者再 +1。
         * 手工往种子里加数据后忘记同步 seq 时，也不会生成与既有记录重复的 id
         * （曾经因为 claim 种子从 2 条加到 4 条但 seq.claim 仍是 3，
         *  导致新建申请拿到 id=4 与种子记录撞车、approve 命中了别人的申请）。
         */
        var seq = state.seq[kind] || 0;
        var coll = kind === 'item' ? state.items
            : kind === 'claim' ? state.claims
                : kind === 'notif' ? state.notifications
                    : kind === 'audit' ? state.audits
                        : kind === 'user' ? state.users : null;
        if (coll && coll.length) {
            for (var i = 0; i < coll.length; i++) {
                if (coll[i].id > seq) { seq = coll[i].id; }
            }
        }
        state.seq[kind] = seq + 1;
        return state.seq[kind];
    }

    function resetAll() {
        state = buildSeedState();
        persist();
        return state;
    }

    if (OFFLINE) {
        loadState();
        // 支持 ?resetDemo=1 一键恢复演示数据（演示 / 答辩前重置现场）
        try {
            var qs = new URLSearchParams(location.search);
            if (qs.get('resetDemo') === '1') {
                resetAll();
                qs.delete('resetDemo');
                var clean = location.pathname.split('/').pop() +
                    (qs.toString() ? '?' + qs.toString() : '');
                history.replaceState(null, '', clean);
            }
        } catch (e) { /* ignore */ }
    }

    /* ------------------------------------------------------------------ *
     * 4. 对外数据视图（隐藏内部字段 _pwd）
     * ------------------------------------------------------------------ */
    function publicUser(u) {
        if (!u) { return null; }
        return {
            id: u.id,
            username: u.username,
            passwordHash: null,
            role: u.role,
            nickname: u.nickname,
            contact: u.contact,
            createTime: u.createTime
        };
    }

    function currentUser() {
        if (!state || state.sessionUserId === null || state.sessionUserId === undefined) {
            return null;
        }
        for (var i = 0; i < state.users.length; i++) {
            if (state.users[i].id === state.sessionUserId) { return state.users[i]; }
        }
        return null;
    }

    function isAdmin() {
        var u = currentUser();
        return !!u && u.role === 'ADMIN';
    }

    function findItem(id) {
        for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].id === id) { return state.items[i]; }
        }
        return null;
    }

    function findUser(id) {
        for (var i = 0; i < state.users.length; i++) {
            if (state.users[i].id === id) { return state.users[i]; }
        }
        return null;
    }

    function findClaim(id) {
        for (var i = 0; i < state.claims.length; i++) {
            if (state.claims[i].id === id) { return state.claims[i]; }
        }
        return null;
    }

    function nicknameOf(id) {
        var u = findUser(id);
        return u ? u.nickname : '未知用户';
    }

    /* ------------------------------------------------------------------ *
     * 5. 结果构造（对齐 Result<T> 与拦截器响应）
     * ------------------------------------------------------------------ */
    function ok(data) {
        var body = { code: 0, message: '操作成功' };
        if (arguments.length > 0 && data !== undefined) {
            body.data = data;
        }
        return { status: 200, body: body };
    }

    /** 业务异常：后端 GlobalExceptionHandler 返回 HTTP 200 + 非 0 code */
    function bizErr(code, message) {
        return { status: 200, body: { code: code, message: message } };
    }

    function httpErr(status, code, message) {
        return { status: status, body: { code: code, message: message } };
    }

    function unauthorized() {
        return httpErr(401, 401, '请先登录后再进行该操作');
    }

    function forbidden() {
        return httpErr(403, 403, '无权限：该操作仅管理员可执行');
    }

    function notFound(message) {
        return bizErr(404, message || '信息不存在');
    }

    /* ------------------------------------------------------------------ *
     * 6. 状态机（与 ItemStatus.transition 一一对应）
     * ------------------------------------------------------------------ */
    var STATUS_LABEL = {
        PENDING: '待认领',
        CLAIMING: '认领处理中',
        RESOLVED: '已归还/已解决',
        CLOSED: '已关闭'
    };

    var TRANSITIONS = {
        PENDING: { CLAIMING: 1, CLOSED: 1 },
        CLAIMING: { RESOLVED: 1, PENDING: 1 },
        RESOLVED: { CLOSED: 1 },
        CLOSED: {}
    };

    function transition(from, to) {
        var allowed = TRANSITIONS[from];
        if (!allowed || !allowed[to]) {
            throw new MockBizError(400, '状态变更非法：不允许从「' + (STATUS_LABEL[from] || from) +
                '」变更为「' + (STATUS_LABEL[to] || to) + '」');
        }
        return to;
    }

    function MockBizError(code, message) {
        this.code = code;
        this.message = message;
    }

    /* ------------------------------------------------------------------ *
     * 7. 通知 / 审计记录
     * ------------------------------------------------------------------ */
    function notifyUser(userId, itemId, content) {
        state.notifications.push({
            id: nextId('notif'),
            userId: userId,
            itemId: itemId,
            content: content,
            isRead: 0,
            createTime: nowIso()
        });
    }

    function recordAudit(operatorId, action, targetId, detail) {
        state.audits.push({
            id: nextId('audit'),
            adminId: operatorId,
            action: action,
            targetId: targetId,
            detail: detail,
            createTime: nowIso()
        });
    }

    function abbrev(s) {
        s = str(s);
        return s.length <= 50 ? s : s.substring(0, 50) + '…';
    }

    /* ------------------------------------------------------------------ *
     * 8. 各接口实现
     * ------------------------------------------------------------------ */
    var handlers = {};

    /* ---- 用户 ---- */
    handlers.login = function (ctx) {
        var username = str(ctx.body.username).trim();
        var password = str(ctx.body.password);
        if (!username || !password) {
            return bizErr(400, '用户名或密码错误');
        }
        var user = null;
        for (var i = 0; i < state.users.length; i++) {
            if (state.users[i].username === username) { user = state.users[i]; break; }
        }
        if (!user || user._pwd !== password) {
            return bizErr(400, '用户名或密码错误');
        }
        state.sessionUserId = user.id;
        persist();
        return ok(publicUser(user));
    };

    handlers.register = function (ctx) {
        var username = str(ctx.body.username).trim();
        var password = str(ctx.body.password);
        var nickname = str(ctx.body.nickname).trim();
        var contact = str(ctx.body.contact).trim();
        if (!username) { return bizErr(400, '用户名不能为空'); }
        if (username.length < 3 || username.length > 20) { return bizErr(400, '用户名长度须为 3~20 个字符'); }
        if (!password) { return bizErr(400, '密码不能为空'); }
        if (password.length < 6 || password.length > 64) { return bizErr(400, '密码长度须为 6~64 个字符'); }
        if (!nickname) { return bizErr(400, '昵称不能为空'); }
        if (nickname.length > 20) { return bizErr(400, '昵称不能超过 20 个字符'); }
        if (contact.length > 50) { return bizErr(400, '联系方式不能超过 50 个字符'); }
        for (var i = 0; i < state.users.length; i++) {
            if (state.users[i].username === username) {
                return bizErr(409, '用户名「' + username + '」已被注册');
            }
        }
        var u = {
            id: nextId('user'),
            username: username,
            role: 'USER',
            nickname: nickname,
            contact: contact,
            createTime: nowIso(),
            _pwd: password
        };
        state.users.push(u);
        persist();
        return ok(publicUser(u));
    };

    handlers.logout = function () {
        state.sessionUserId = null;
        persist();
        return ok();
    };

    handlers.profileGet = function () {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        return ok(publicUser(u));
    };

    handlers.profileUpdate = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var nickname = str(ctx.body.nickname).trim();
        if (!nickname) { return bizErr(400, '昵称不能为空'); }
        if (nickname.length > 20) { return bizErr(400, '昵称不能超过 20 个字符'); }
        u.nickname = nickname;
        u.contact = str(ctx.body.contact).trim();
        persist();
        return ok(publicUser(u));
    };

    /* ---- 物品 ---- */
    /** 地图坐标（底图百分比）：接受 number 或数字字符串，非法/空 -> null */
    function coordOf(body, key) {
        var v = body ? body[key] : null;
        if (v === null || v === undefined || v === '') { return null; }
        var n = Number(v);
        if (isNaN(n)) { return null; }
        return Math.max(0, Math.min(100, n));
    }

    function validateItemBody(body, isUpdate) {
        if (!isUpdate) {
            var type = str(body.type);
            if (type !== 'LOST' && type !== 'FOUND') {
                return '类型非法：只能为 LOST（寻物）或 FOUND（招领）';
            }
        }
        if (!str(body.name).trim()) { return '物品名称不能为空'; }
        if (str(body.name).length > 50) { return '物品名称不能超过 50 个字符'; }
        if (!str(body.category).trim()) { return '物品类别不能为空'; }
        if (str(body.category).length > 20) { return '物品类别不能超过 20 个字符'; }
        if (!str(body.location).trim()) { return '地点不能为空'; }
        if (str(body.location).length > 50) { return '地点不能超过 50 个字符'; }
        if (!body.eventTime) { return '丢失/拾取时间不能为空'; }
        if (isNaN(ts(body.eventTime))) { return '请求体格式非法，请检查输入'; }
        if (!str(body.description).trim()) { return '描述不能为空'; }
        if (str(body.description).length > 1000) { return '描述不能超过 1000 个字符'; }
        if (!str(body.contact).trim()) { return '联系方式不能为空'; }
        if (str(body.contact).length > 50) { return '联系方式不能超过 50 个字符'; }
        if (str(body.imagePath).length > 200) { return '图片路径不能超过 200 个字符'; }
        return null;
    }

    handlers.itemCreate = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var msg = validateItemBody(ctx.body, false);
        if (msg) { return bizErr(400, msg); }
        var item = {
            id: nextId('item'),
            type: ctx.body.type,
            name: str(ctx.body.name).trim(),
            category: str(ctx.body.category).trim(),
            location: str(ctx.body.location).trim(),
            eventTime: iso(new Date(ts(ctx.body.eventTime))),
            description: str(ctx.body.description).trim(),
            contact: str(ctx.body.contact).trim(),
            imagePath: str(ctx.body.imagePath) || svgImage(ctx.body.type, str(ctx.body.category), str(ctx.body.name)),
            status: 'PENDING',
            publisherId: u.id,
            hidden: 0,
            mapX: coordOf(ctx.body, 'mapX'),
            mapY: coordOf(ctx.body, 'mapY'),
            createTime: nowIso(),
            updateTime: nowIso()
        };
        state.items.push(item);
        persist();
        return ok(clone(item));
    };

    handlers.itemSearch = function (ctx) {
        var q = ctx.query;
        var type = str(q.get('type')).trim();
        var category = str(q.get('category')).trim();
        var location = str(q.get('location')).trim();
        var keyword = str(q.get('keyword')).trim();
        var startTime = str(q.get('startTime')).trim();
        var endTime = str(q.get('endTime')).trim();
        var page = Math.max(toInt(q.get('page'), 1), 1);
        var size = Math.min(Math.max(toInt(q.get('size'), 10), 1), 50);

        if (type && type !== 'LOST' && type !== 'FOUND') {
            return bizErr(400, '类型非法：只能为 LOST（寻物）或 FOUND（招领）');
        }

        var startTs = startTime ? ts(startTime) : NaN;
        var endTs = endTime ? ts(endTime) : NaN;

        var rows = state.items.filter(function (it) {
            if (it.hidden) { return false; }
            if (it.status === 'CLOSED') { return false; }
            if (type && it.type !== type) { return false; }
            if (category && it.category !== category) { return false; }
            if (location && !contains(it.location, location)) { return false; }
            if (keyword && !(contains(it.name, keyword) || contains(it.description, keyword))) { return false; }
            var t = ts(it.eventTime);
            if (!isNaN(startTs) && !(t >= startTs)) { return false; }
            if (!isNaN(endTs) && !(t <= endTs)) { return false; }
            return true;
        });

        rows.sort(function (a, b) { return ts(b.createTime) - ts(a.createTime); });

        var total = rows.length;
        var from = (page - 1) * size;
        var list = rows.slice(from, from + size).map(clone);
        return ok({
            list: list,
            total: total,
            page: page,
            size: size,
            adminView: isAdmin()
        });
    };

    handlers.itemDetail = function (ctx) {
        var item = findItem(ctx.params.id);
        if (!item || (item.hidden === 1 && !isAdmin())) {
            return notFound('信息不存在或已被管理员隐藏');
        }
        return ok(clone(item));
    };

    handlers.itemUpdate = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var item = findItem(ctx.params.id);
        if (!item) { return notFound(); }
        if (item.publisherId !== u.id) { return bizErr(403, '无权限：只能操作本人发布的信息'); }
        if (item.status !== 'PENDING') {
            return bizErr(400, '当前状态为「' + (STATUS_LABEL[item.status] || item.status) +
                '」，仅「待认领」状态的信息可以编辑');
        }
        var msg = validateItemBody(ctx.body, true);
        if (msg) { return bizErr(400, msg); }
        item.name = str(ctx.body.name).trim();
        item.category = str(ctx.body.category).trim();
        item.location = str(ctx.body.location).trim();
        item.eventTime = iso(new Date(ts(ctx.body.eventTime)));
        item.description = str(ctx.body.description).trim();
        item.contact = str(ctx.body.contact).trim();
        /* 地图坐标：允许清空（null 表示取消标注），与后端 ItemService.update 一致 */
        item.mapX = coordOf(ctx.body, 'mapX');
        item.mapY = coordOf(ctx.body, 'mapY');
        if (str(ctx.body.imagePath).trim()) {
            item.imagePath = ctx.body.imagePath;
        }
        if (!item.imagePath) {
            item.imagePath = svgImage(item.type, item.category, item.name);
        }
        item.updateTime = nowIso();
        persist();
        return ok(clone(item));
    };

    handlers.itemWithdraw = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var item = findItem(ctx.params.id);
        if (!item) { return notFound(); }
        if (item.publisherId !== u.id) { return bizErr(403, '无权限：只能操作本人发布的信息'); }
        if (item.status === 'CLOSED') { return bizErr(400, '该信息已处于「已关闭」状态，无需撤回'); }
        try {
            transition(item.status, 'CLOSED');
        } catch (e) {
            return bizErr(e.code, e.message);
        }
        item.status = 'CLOSED';
        item.updateTime = nowIso();
        persist();
        return ok(clone(item));
    };

    handlers.itemImage = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var item = findItem(ctx.params.id);
        if (!item) { return notFound(); }
        if (item.publisherId !== u.id) { return bizErr(403, '无权限：只能操作本人发布的信息'); }
        if (item.status === 'CLOSED') { return bizErr(400, '信息已关闭，不能修改'); }

        var body = ctx.body;
        var file = null;
        if (body && typeof body.get === 'function') {
            file = body.get('file');
        }
        if (file && file.size !== undefined) {
            if (file.type && file.type !== 'image/jpeg' && file.type !== 'image/png') {
                return bizErr(400, '图片格式非法：仅支持 JPG/PNG 格式');
            }
            if (file.size > 5 * 1024 * 1024) {
                return bizErr(400, '图片大小超过 5MB 限制');
            }
            return readFileAsDataUrl(file).then(function (dataUrl) {
                // 过大的 base64 会撑爆 localStorage，超过 400KB 用占位图代替
                item.imagePath = dataUrl.length > 400 * 1024
                    ? svgImage(item.type, item.category, item.name)
                    : dataUrl;
                item.updateTime = nowIso();
                persist();
                return ok(clone(item));
            });
        }
        var path = str(ctx.query.get('imagePath')).trim();
        if (path) {
            item.imagePath = path;
            item.updateTime = nowIso();
            persist();
            return ok(clone(item));
        }
        return bizErr(400, '请提供上传文件或图片路径');
    };

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve) {
            try {
                var reader = new FileReader();
                reader.onload = function () { resolve(String(reader.result || '')); };
                reader.onerror = function () { resolve(''); };
                reader.readAsDataURL(file);
            } catch (e) {
                resolve('');
            }
        });
    }

    /* ---- 认领 ---- */
    handlers.claimCreate = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var itemId = toInt(ctx.body.itemId, -1);
        var description = str(ctx.body.description).trim();
        if (!description) { return bizErr(400, '认领说明不能为空'); }
        if (description.length > 500) { return bizErr(400, '认领说明不能超过 500 个字符'); }
        var item = findItem(itemId);
        if (!item) { return notFound(); }
        if (item.hidden === 1) { return notFound('信息不存在或已被管理员隐藏'); }
        if (item.publisherId === u.id) { return bizErr(400, '不能认领自己发布的信息'); }
        var dup = state.claims.some(function (c) {
            return c.itemId === itemId && c.applicantId === u.id && c.status === 'PENDING';
        });
        if (dup) { return bizErr(409, '您已提交过该物品的认领申请，正在处理中，请勿重复提交'); }
        if (item.status !== 'PENDING') {
            return bizErr(409, '该信息当前状态为「' + (STATUS_LABEL[item.status] || item.status) +
                '」，暂不能提交认领申请');
        }
        var claim = {
            id: nextId('claim'),
            itemId: itemId,
            applicantId: u.id,
            description: description,
            status: 'PENDING',
            handlerId: null,
            thanked: 0,
            thankNote: null,
            thankTime: null,
            handleNote: null,
            handleTime: null,
            createTime: nowIso()
        };
        state.claims.push(claim);

        transition('PENDING', 'CLAIMING');
        item.status = 'CLAIMING';
        item.updateTime = nowIso();

        notifyUser(item.publisherId, itemId,
            '您发布的「' + item.name + '」收到一条认领申请，请及时处理。');
        recordAudit(u.id, '提交认领申请', itemId,
            '认领申请 #' + claim.id + '：' + abbrev(description));
        persist();
        return ok(clone(claim));
    };

    handlers.claimMine = function () {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var mineRows = state.claims
            .filter(function (c) { return c.applicantId === u.id; })
            .sort(function (a, b) { return ts(b.createTime) - ts(a.createTime); });
        var mine = mineRows.map(function (c) {
            return { claim: clone(c), item: clone(findItem(c.itemId)) };
        });

        var myItemIds = {};
        state.items.forEach(function (it) {
            if (it.publisherId === u.id) { myItemIds[it.id] = 1; }
        });
        var incomingRows = state.claims
            .filter(function (c) { return myItemIds[c.itemId]; })
            .sort(function (a, b) { return ts(b.createTime) - ts(a.createTime); });
        var incoming = incomingRows.map(function (c) {
            return {
                claim: clone(c),
                item: clone(findItem(c.itemId)),
                applicant: nicknameOf(c.applicantId)
            };
        });
        return ok({ mine: mine, incoming: incoming });
    };

    handlers.claimHandle = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var claim = null;
        for (var i = 0; i < state.claims.length; i++) {
            if (state.claims[i].id === ctx.params.id) { claim = state.claims[i]; break; }
        }
        if (!claim) { return notFound('认领申请不存在'); }
        if (claim.status !== 'PENDING') { return bizErr(409, '该申请已被处理，请勿重复操作'); }
        var item = findItem(claim.itemId);
        if (!item) { return notFound(); }
        var isPublisher = item.publisherId === u.id;
        if (!isPublisher && u.role !== 'ADMIN') {
            return bizErr(403, '无权限：仅发布者或管理员可处理认领申请');
        }
        if (item.status !== 'CLAIMING') { return bizErr(409, '物品当前状态不允许处理认领申请'); }

        var action = ctx.params.action;
        var note = str(ctx.body.note).trim() || null;
        var actionLabel;
        try {
            if (action === 'approve') {
                transition(item.status, 'RESOLVED');
                item.status = 'RESOLVED';
                claim.status = 'APPROVED';
                actionLabel = '认领确认';
                notifyUser(claim.applicantId, item.id,
                    '您对「' + item.name + '」的认领申请已被确认，物品状态更新为「已归还/已解决」。');
            } else if (action === 'reject') {
                transition(item.status, 'PENDING');
                item.status = 'PENDING';
                claim.status = 'REJECTED';
                actionLabel = '认领拒绝';
                notifyUser(claim.applicantId, item.id,
                    '您对「' + item.name + '」的认领申请未被采纳，该信息已重新开放认领。');
            } else if (action === 'request-more') {
                claim.status = 'MORE_INFO';
                actionLabel = '要求补充';
                notifyUser(claim.applicantId, item.id,
                    '发布者对「' + item.name + '」的认领申请要求补充信息，请完善认领说明后联系对方。');
            } else {
                return bizErr(400, '非法的处理动作：' + action);
            }
        } catch (e) {
            return bizErr(e.code || 400, e.message);
        }

        item.updateTime = nowIso();
        claim.handlerId = u.id;
        claim.handleNote = note;
        claim.handleTime = nowIso();
        recordAudit(u.id, actionLabel, item.id,
            '申请 #' + claim.id + (note ? '，意见：' + abbrev(note) : ''));
        persist();
        return ok(clone(claim));
    };

    /* ---- AI 辅助（走原生桥，失败降级） ---- */
    handlers.aiKeywords = function (ctx) {
        var description = str(ctx.body.description).trim();
        if (!description) { return bizErr(400, '描述不能为空'); }
        var prompt = '用户用自然语言描述在校园丢失/拾取的物品，请提取 5~8 个适合站内搜索的关键词' +
            '（物品名、类别、品牌、特征词）。只输出 JSON 字符串数组，例如 ["雨伞","黑色","图书馆"]，' +
            '不要输出其他内容。\n用户描述：' + description;
        return aiChat(prompt).then(function (text) {
            var arr = parseJsonArray(text);
            if (arr && arr.length) {
                return ok({ keywords: arr.slice(0, 8), degraded: false });
            }
            return ok({
                keywords: extractKeywords(description, 8),
                degraded: true,
                message: 'AI 服务不可用，已使用本地关键词提取'
            });
        });
    };

    handlers.aiDescription = function (ctx) {
        var rough = str(ctx.body.description).trim();
        if (!rough) { return bizErr(400, '描述不能为空'); }
        var prompt = '你是校园失物招领平台的文案助手。请把用户的粗略描述改写成清晰、规范、' +
            '便于认领核对的物品描述草稿（100 字以内，包含物品特征、识别细节），只输出描述正文，' +
            '不要输出其他内容。\n粗略描述：' + rough;
        return aiChat(prompt).then(function (text) {
            var cleaned = cleanAiText(text);
            if (cleaned) {
                return ok({ description: cleaned, degraded: false });
            }
            return ok({
                description: '【AI 不可用，以下为本地整理草稿】物品特征：' + rough +
                    '。认领时请核对物品特征、数量与细节。',
                degraded: true,
                message: 'AI 服务不可用，已使用本地模板生成'
            });
        });
    };

    /* ---- 智能匹配 ---- */
    handlers.match = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var query = findItem(ctx.params.itemId);
        if (!query) { return notFound(); }

        var reverseType = query.type === 'LOST' ? 'FOUND' : 'LOST';
        var qTime = ts(query.eventTime);
        var candidates = state.items.filter(function (it) {
            if (it.type !== reverseType) { return false; }
            if (it.hidden) { return false; }
            if (it.status === 'CLOSED') { return false; }
            if (it.id === query.id) { return false; }
            var catOk = it.category === query.category;
            var locOk = contains(it.location, query.location) || contains(query.location, it.location);
            if (!catOk && !locOk) { return false; }
            if (!isNaN(qTime)) {
                var diff = Math.abs(ts(it.eventTime) - qTime);
                if (diff > 30 * 24 * 3600 * 1000) { return false; }
            }
            return true;
        });
        candidates.sort(function (a, b) { return ts(b.createTime) - ts(a.createTime); });
        candidates = candidates.slice(0, 20);

        if (!candidates.length) {
            return ok({ degraded: false, matches: [] });
        }

        var queryJson = {
            id: query.id, type: query.type, name: query.name, category: query.category,
            location: query.location, eventTime: query.eventTime, description: query.description
        };
        var candJson = candidates.map(function (c) {
            return {
                id: c.id, type: c.type, name: c.name, category: c.category,
                location: c.location, eventTime: c.eventTime, description: c.description
            };
        });
        var prompt = '你是校园失物招领平台的匹配助手。下面是【目标信息】与若干【候选信息】。' +
            '请判断哪些候选疑似是同一物品，按相似度从高到低排序，输出 JSON 数组，' +
            '每个元素格式 {"id": 候选ID, "score": 0~100的相似度, "reason": "一句话相似理由"}，' +
            '最多 5 条，只输出 JSON。\n【目标信息】\n' + JSON.stringify(queryJson) +
            '\n【候选信息】\n' + JSON.stringify(candJson);

        return aiChat(prompt).then(function (text) {
            var arr = parseJsonArray(text);
            if (arr && arr.length) {
                var results = [];
                arr.forEach(function (node) {
                    var id = toInt(node.id, -1);
                    var target = null;
                    for (var i = 0; i < candidates.length; i++) {
                        if (candidates[i].id === id) { target = candidates[i]; break; }
                    }
                    if (!target) { return; }
                    results.push(matchResult(target, clamp(toInt(node.score, 0), 0, 100),
                        str(node.reason) || 'AI 推荐，请人工核验'));
                });
                results.sort(function (a, b) { return b.score - a.score; });
                if (results.length) {
                    return ok({ degraded: false, matches: results.slice(0, 5) });
                }
            }
            return ok({ degraded: true, matches: localMatch(query, candidates) });
        });
    };

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    /* ---- 拾取者联系与致谢（F9「感谢接力」） ---- */

    /** 联系方式脱敏：13812345678 -> 138****5678 */
    function maskContact(contact) {
        if (!contact) { return null; }
        var s = String(contact).trim();
        if (!s) { return null; }
        if (s.length <= 4) { return '****'; }
        if (s.length <= 8) { return s.charAt(0) + '****' + s.charAt(s.length - 1); }
        return s.substring(0, 3) + '****' + s.substring(s.length - 4);
    }

    /** 名称归一化：去掉空白与常见标点 */
    function normName(s) {
        return String(s || '').replace(/[\s（）()【】\[\]·、,，.。-]/g, '').toLowerCase();
    }

    /** 粗糙相似度：公共字符数 / 较长串长度 */
    function similarRatio(a, b) {
        if (!a || !b) { return 0; }
        var hit = 0;
        var used = [];
        for (var i = 0; i < a.length; i++) {
            for (var j = 0; j < b.length; j++) {
                if (!used[j] && a.charAt(i) === b.charAt(j)) { used[j] = true; hit++; break; }
            }
        }
        return hit / Math.max(a.length, b.length);
    }

    /** 寻物 vs 招领 的匹配打分（0~100），与后端 PickupContactService.score 一致 */
    function pickupScore(lost, found) {
        var s = 0;
        var a = normName(lost.name), b = normName(found.name);
        if (a && a === b) { s += 55; }
        else if (a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) { s += 35; }
        else if (similarRatio(a, b) >= 0.5) { s += 25; }
        if (lost.category && lost.category === found.category) { s += 20; }
        if (lost.location && lost.location === found.location) { s += 15; }
        if (lost.eventTime && found.eventTime) {
            var days = Math.abs(ts(lost.eventTime) - ts(found.eventTime)) / 86400000;
            if (days <= 3) { s += 10; }
        }
        return Math.min(s, 100);
    }

    function pickupReasons(lost, found) {
        var r = [];
        var a = normName(lost.name), b = normName(found.name);
        if (a && a === b) { r.push('物品名称完全一致'); }
        else if (a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) { r.push('物品名称高度相近'); }
        if (lost.category && lost.category === found.category) { r.push('属于同一类别'); }
        if (lost.location && lost.location === found.location) { r.push('地点相同'); }
        if (lost.eventTime && found.eventTime
            && Math.abs(ts(lost.eventTime) - ts(found.eventTime)) / 86400000 <= 3) {
            r.push('时间接近');
        }
        if (!r.length) { r.push('特征部分吻合'); }
        return r;
    }

    function userBrief(userId, withContact) {
        var u = findUser(userId);
        return {
            id: userId,
            nickname: u ? u.nickname : '未知用户',
            contact: u ? (withContact ? u.contact : maskContact(u.contact)) : null
        };
    }

    handlers.pickupMatch = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var lost = findItem(ctx.params.lostItemId);
        if (!lost) { return notFound(); }
        if (lost.type !== 'LOST') { return bizErr(400, '只有寻物信息可以查找匹配的招领'); }

        var out = [];
        state.items.forEach(function (found) {
            if (found.type !== 'FOUND') { return; }
            if (found.hidden) { return; }
            if (found.status === 'CLOSED') { return; }
            var score = pickupScore(lost, found);
            if (score < 40) { return; }
            out.push({
                item: clone(found),
                score: score,
                publisher: userBrief(found.publisherId, false),
                reasons: pickupReasons(lost, found)
            });
        });
        out.sort(function (a, b) { return b.score - a.score; });
        return ok(out);
    };

    handlers.pickupContact = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var claim = findClaim(ctx.params.claimId);
        if (!claim) { return notFound(); }
        var item = findItem(claim.itemId);
        if (!item) { return notFound(); }

        var isApplicant = claim.applicantId === u.id;
        if (!isApplicant && u.role !== 'ADMIN') {
            return forbidden('无权限：仅认领申请人本人可查看拾取者联系方式');
        }
        if (claim.status !== 'APPROVED') {
            return bizErr(409, '认领尚未确认，暂不能查看拾取者联系方式');
        }

        var picker = findUser(item.publisherId);
        return ok({
            claimId: claim.id,
            itemId: item.id,
            itemName: item.name,
            pickerId: item.publisherId,
            pickerNickname: picker ? picker.nickname : '未知用户',
            pickerContact: picker ? picker.contact : null,
            itemContact: item.contact,
            pickedLocation: item.location,
            pickedTime: item.eventTime,
            handleNote: claim.handleNote,
            handleTime: claim.handleTime,
            thanked: claim.thanked || 0,
            thankNote: claim.thankNote || null,
            thankTime: claim.thankTime || null
        });
    };

    handlers.pickupThank = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var claim = findClaim(ctx.params.claimId);
        if (!claim) { return notFound(); }
        if (claim.applicantId !== u.id) {
            return forbidden('无权限：仅认领申请人本人可致谢');
        }
        if (claim.status !== 'APPROVED') {
            return bizErr(409, '认领尚未确认，暂不能致谢');
        }
        if (claim.thanked === 1) {
            return bizErr(409, '已经致谢过了，感谢你的善意');
        }
        var body = ctx.body || {};
        claim.thanked = 1;
        claim.thankNote = str(body.note).trim() || '谢谢你帮我找回失物！';
        claim.thankTime = nowIso();

        var item = findItem(claim.itemId);
        if (item) {
            notifyUser(item.publisherId, item.id,
                '失主向您发来致谢：「' + claim.thankNote + '」');
        }
        persist();
        return ok(clone(claim));
    };

    handlers.pickupApproved = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var found = null;
        for (var i = 0; i < state.claims.length; i++) {
            var c = state.claims[i];
            if (c.itemId === ctx.params.foundItemId && c.status === 'APPROVED') {
                found = c;
                break;
            }
        }
        if (!found) { return ok(null); }
        return ok({ claim: clone(found), applicant: userBrief(found.applicantId, true) });
    };

    function matchResult(item, score, reason) {
        return {
            itemId: item.id,
            name: item.name,
            type: item.type,
            category: item.category,
            location: item.location,
            eventTime: item.eventTime,
            score: score,
            reason: reason
        };
    }

    /** 本地降级算法：名称重合 40% + 类别 25% + 地点 20% + 时间 15% */
    function localMatch(query, candidates) {
        var qTime = ts(query.eventTime);
        var scored = candidates.map(function (c) {
            var nameScore = tokenOverlap(query.name, c.name) * 40;
            var categoryScore = (query.category && c.category &&
                String(query.category).toLowerCase() === String(c.category).toLowerCase()) ? 25 : 0;
            var locationScore = tokenOverlap(query.location, c.location) * 20;
            var timeScore = 0;
            var cTime = ts(c.eventTime);
            if (!isNaN(qTime) && !isNaN(cTime)) {
                var days = Math.abs(cTime - qTime) / (24 * 3600 * 1000);
                timeScore = Math.max(0, 1 - days / 30) * 15;
            }
            var total = Math.round(nameScore + categoryScore + locationScore + timeScore);
            var reason = '本地匹配：';
            if (categoryScore > 0) { reason += '类别一致(' + query.category + ') '; }
            if (nameScore > 10) { reason += '名称相似 '; }
            if (locationScore > 5) { reason += '地点相近(' + c.location + ') '; }
            if (timeScore > 5) { reason += '时间相近 '; }
            return matchResult(c, total, reason.trim());
        });
        scored.sort(function (a, b) { return b.score - a.score; });
        return scored.slice(0, 5);
    }

    /* ---- 通知 ---- */
    handlers.notificationList = function () {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var list = state.notifications
            .filter(function (n) { return n.userId === u.id; })
            .sort(function (a, b) { return ts(b.createTime) - ts(a.createTime); })
            .map(clone);
        var unread = list.filter(function (n) { return n.isRead === 0; }).length;
        return ok({ list: list, unread: unread });
    };

    handlers.notificationUnread = function () {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var unread = state.notifications.filter(function (n) {
            return n.userId === u.id && n.isRead === 0;
        }).length;
        return ok({ unread: unread });
    };

    handlers.notificationRead = function (ctx) {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        var hit = null;
        for (var i = 0; i < state.notifications.length; i++) {
            var n = state.notifications[i];
            if (n.id === ctx.params.id && n.userId === u.id && n.isRead === 0) { hit = n; break; }
        }
        if (!hit) { return notFound('通知不存在或已读'); }
        hit.isRead = 1;
        persist();
        return ok();
    };

    handlers.notificationReadAll = function () {
        var u = currentUser();
        if (!u) { return unauthorized(); }
        state.notifications.forEach(function (n) {
            if (n.userId === u.id) { n.isRead = 1; }
        });
        persist();
        return ok();
    };

    /* ---- 管理后台 ---- */
    handlers.adminItems = function (ctx) {
        if (!isAdmin()) { return forbidden(); }
        var page = Math.max(toInt(ctx.query.get('page'), 1), 1);
        var size = Math.min(Math.max(toInt(ctx.query.get('size'), 10), 1), 100);
        var hiddenOnly = str(ctx.query.get('hiddenOnly')) === 'true';
        var rows = state.items.slice();
        if (hiddenOnly) {
            rows = rows.filter(function (it) { return it.hidden === 1; });
        }
        rows.sort(function (a, b) { return ts(b.createTime) - ts(a.createTime); });
        var total = rows.length;
        var list = rows.slice((page - 1) * size, (page - 1) * size + size).map(clone);
        return ok({ list: list, total: total });
    };

    handlers.adminHide = function (ctx, hide) {
        if (!isAdmin()) { return forbidden(); }
        var item = findItem(ctx.params.id);
        if (!item) { return notFound(); }
        item.hidden = hide ? 1 : 0;
        item.updateTime = nowIso();
        recordAudit(currentUser().id, hide ? '隐藏信息' : '恢复信息', item.id,
            '物品「' + item.name + '」');
        persist();
        return ok(clone(item));
    };

    handlers.adminDelete = function (ctx) {
        if (!isAdmin()) { return forbidden(); }
        if (str(ctx.query.get('confirm')) !== 'true') {
            return bizErr(400, '删除操作需要二次确认：请携带 confirm=true 参数');
        }
        var idx = -1;
        for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].id === ctx.params.id) { idx = i; break; }
        }
        if (idx < 0) { return notFound(); }
        var item = state.items[idx];
        state.items.splice(idx, 1);
        recordAudit(currentUser().id, '删除信息', item.id, '物品「' + item.name + '」已删除');
        persist();
        return ok();
    };

    handlers.adminArchive = function (ctx) {
        if (!isAdmin()) { return forbidden(); }
        var item = findItem(ctx.params.id);
        if (!item) { return notFound(); }
        try {
            transition(item.status, 'CLOSED');
        } catch (e) {
            return bizErr(e.code, e.message);
        }
        item.status = 'CLOSED';
        item.updateTime = nowIso();
        recordAudit(currentUser().id, '归档关闭', item.id, '物品「' + item.name + '」');
        persist();
        return ok(clone(item));
    };

    handlers.adminAudits = function (ctx) {
        if (!isAdmin()) { return forbidden(); }
        var page = Math.max(toInt(ctx.query.get('page'), 1), 1);
        var size = Math.min(Math.max(toInt(ctx.query.get('size'), 10), 1), 100);
        var rows = state.audits.slice().sort(function (a, b) {
            return ts(b.createTime) - ts(a.createTime);
        });
        return ok({
            list: rows.slice((page - 1) * size, (page - 1) * size + size).map(clone),
            total: rows.length
        });
    };

    /* ---- 统计（对应 SQL GROUP BY 结果） ---- */
    handlers.statsCategory = function () {
        var visible = state.items.filter(function (it) {
            return !it.hidden && it.status !== 'CLOSED' && it.category;
        });
        return ok(countBy(visible, function (it) { return it.category; }, 10));
    };

    handlers.statsLocation = function () {
        var visible = state.items.filter(function (it) {
            return !it.hidden && it.status !== 'CLOSED' && it.location;
        });
        return ok(countBy(visible, function (it) { return it.location; }, 10));
    };

    handlers.statsMonthly = function () {
        var visible = state.items.filter(function (it) {
            return !it.hidden && it.status !== 'CLOSED' && it.eventTime;
        });
        var counts = {};
        visible.forEach(function (it) {
            var d = new Date(ts(it.eventTime));
            if (isNaN(d.getTime())) { return; }
            var key = d.getFullYear() + '-' + pad(d.getMonth() + 1);
            counts[key] = (counts[key] || 0) + 1;
        });
        var keys = Object.keys(counts).sort();
        return ok(keys.map(function (k) { return { name: k, value: counts[k] }; }));
    };

    function countBy(rows, keyFn, limit) {
        var map = {};
        rows.forEach(function (r) {
            var k = keyFn(r);
            map[k] = (map[k] || 0) + 1;
        });
        var arr = Object.keys(map).map(function (k) { return { name: k, value: map[k] }; });
        arr.sort(function (a, b) {
            if (b.value !== a.value) { return b.value - a.value; }
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        return arr.slice(0, limit);
    }

    /* ------------------------------------------------------------------ *
     * 9. 路由表
     * ------------------------------------------------------------------ */
    // [方法, 路径正则, 处理函数, 路径参数名]
    var ROUTES = [
        // 用户
        ['POST', /^\/api\/user\/login\/?$/, handlers.login, []],
        ['POST', /^\/api\/user\/register\/?$/, handlers.register, []],
        ['POST', /^\/api\/user\/logout\/?$/, handlers.logout, []],
        ['GET', /^\/api\/user\/profile\/?$/, handlers.profileGet, []],
        ['PUT', /^\/api\/user\/profile\/?$/, handlers.profileUpdate, []],

        // 管理端（放在 /api/items 之前，避免前缀冲突）
        ['GET', /^\/api\/admin\/items\/?$/, handlers.adminItems, []],
        ['POST', /^\/api\/admin\/items\/([0-9]+)\/hide\/?$/, function (ctx) { return handlers.adminHide(ctx, true); }, ['id']],
        ['POST', /^\/api\/admin\/items\/([0-9]+)\/unhide\/?$/, function (ctx) { return handlers.adminHide(ctx, false); }, ['id']],
        ['POST', /^\/api\/admin\/items\/([0-9]+)\/archive\/?$/, handlers.adminArchive, ['id']],
        ['DELETE', /^\/api\/admin\/items\/([0-9]+)\/?$/, handlers.adminDelete, ['id']],
        ['GET', /^\/api\/admin\/audit-records\/?$/, handlers.adminAudits, []],

        // 物品
        ['GET', /^\/api\/items\/?$/, handlers.itemSearch, []],
        ['POST', /^\/api\/items\/?$/, handlers.itemCreate, []],
        ['GET', /^\/api\/items\/([0-9]+)\/?$/, handlers.itemDetail, ['id']],
        ['PUT', /^\/api\/items\/([0-9]+)\/?$/, handlers.itemUpdate, ['id']],
        ['POST', /^\/api\/items\/([0-9]+)\/withdraw\/?$/, handlers.itemWithdraw, ['id']],
        ['POST', /^\/api\/items\/([0-9]+)\/image\/?$/, handlers.itemImage, ['id']],

        // 认领
        ['GET', /^\/api\/claims\/?$/, handlers.claimMine, []],
        ['POST', /^\/api\/claims\/?$/, handlers.claimCreate, []],
        ['POST', /^\/api\/claims\/([0-9]+)\/(approve|reject|request-more)\/?$/, handlers.claimHandle, ['id', 'action']],

        // 匹配 / AI
        ['GET', /^\/api\/match\/([0-9]+)\/?$/, handlers.match, ['itemId']],
        ['POST', /^\/api\/ai\/keywords\/?$/, handlers.aiKeywords, []],
        ['POST', /^\/api\/ai\/description\/?$/, handlers.aiDescription, []],

        // 拾取者联系与致谢（F9「感谢接力」）
        ['GET', /^\/api\/pickup\/match\/([0-9]+)\/?$/, handlers.pickupMatch, ['lostItemId']],
        ['GET', /^\/api\/pickup\/contact\/([0-9]+)\/?$/, handlers.pickupContact, ['claimId']],
        ['POST', /^\/api\/pickup\/thank\/([0-9]+)\/?$/, handlers.pickupThank, ['claimId']],
        ['GET', /^\/api\/pickup\/approved\/([0-9]+)\/?$/, handlers.pickupApproved, ['foundItemId']],

        // 通知
        ['GET', /^\/api\/notifications\/?$/, handlers.notificationList, []],
        ['GET', /^\/api\/notifications\/unread-count\/?$/, handlers.notificationUnread, []],
        ['POST', /^\/api\/notifications\/([0-9]+)\/read\/?$/, handlers.notificationRead, ['id']],
        ['POST', /^\/api\/notifications\/read-all\/?$/, handlers.notificationReadAll, []],

        // 统计
        ['GET', /^\/api\/stats\/category\/?$/, handlers.statsCategory, []],
        ['GET', /^\/api\/stats\/location\/?$/, handlers.statsLocation, []],
        ['GET', /^\/api\/stats\/monthly\/?$/, handlers.statsMonthly, []]
    ];

    function resolveRoute(method, path) {
        for (var i = 0; i < ROUTES.length; i++) {
            var r = ROUTES[i];
            if (r[0] !== method) { continue; }
            var m = path.match(r[1]);
            if (!m) { continue; }
            var params = {};
            var names = r[3] || [];
            for (var k = 1; k < m.length; k++) {
                var name = names[k - 1] || ('p' + k);
                params[name] = name === 'action' ? m[k] : toInt(m[k], -1);
            }
            return { handler: r[2], params: params };
        }
        return null;
    }

    /* ------------------------------------------------------------------ *
     * 10. fetch 接管
     * ------------------------------------------------------------------ */
    function isApiUrl(url) {
        if (!url) { return false; }
        var s = String(url);
        return s.indexOf('/api/') >= 0 || s.indexOf('api/') === 0;
    }

    function splitUrl(url) {
        var s = String(url);
        var hashIdx = s.indexOf('#');
        if (hashIdx >= 0) { s = s.substring(0, hashIdx); }
        var qIdx = s.indexOf('?');
        var path = qIdx >= 0 ? s.substring(0, qIdx) : s;
        var search = qIdx >= 0 ? s.substring(qIdx + 1) : '';
        var apiIdx = path.indexOf('/api/');
        if (apiIdx > 0) {
            path = path.substring(apiIdx);
        } else if (path.indexOf('api/') === 0) {
            path = '/' + path;
        }
        if (path.length > 1 && path.charAt(path.length - 1) === '/') {
            path = path.substring(0, path.length - 1);
        }
        return { path: path, search: search };
    }

    function parseBody(raw) {
        if (raw === undefined || raw === null) { return {}; }
        if (typeof raw === 'string') {
            try {
                var parsed = JSON.parse(raw);
                return parsed === null ? {} : parsed;
            } catch (e) {
                return {};
            }
        }
        return raw;
    }

    function makeResponse(status, body) {
        var text = JSON.stringify(body);
        var okFlag = status >= 200 && status < 300;
        if (typeof Response === 'function') {
            try {
                return new Response(text, {
                    status: status,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                });
            } catch (e) {
                // 某些老 WebView 的 Response 构造器限制状态码，走下面的降级实现
            }
        }
        return {
            ok: okFlag,
            status: status,
            statusText: okFlag ? 'OK' : 'Error',
            headers: {
                get: function (name) {
                    return String(name).toLowerCase() === 'content-type'
                        ? 'application/json; charset=utf-8' : null;
                }
            },
            json: function () {
                return Promise.resolve(JSON.parse(text));
            },
            text: function () {
                return Promise.resolve(text);
            },
            clone: function () { return makeResponse(status, body); }
        };
    }

    function handleApi(method, url, init) {
        var parts = splitUrl(url);
        var query = new URLSearchParams(parts.search || '');
        var rawBody = init ? init.body : undefined;
        var body = parseBody(rawBody);

        var matched = resolveRoute(method, parts.path);
        if (!matched) {
            return Promise.resolve(makeResponse(404, { code: 404, message: '接口不存在：' + parts.path }));
        }

        var ctx = {
            method: method,
            path: parts.path,
            query: query,
            body: body,
            rawBody: rawBody,
            params: matched.params || {}
        };

        var delay = LATENCY_MIN + Math.floor(Math.random() * (LATENCY_MAX - LATENCY_MIN));
        return new Promise(function (resolve) {
            setTimeout(function () {
                var result;
                try {
                    result = matched.handler(ctx);
                } catch (e) {
                    if (e && e.code) {
                        result = bizErr(e.code, e.message);
                    } else {
                        result = bizErr(500, '系统繁忙，请稍后重试');
                    }
                }
                Promise.resolve(result).then(function (r) {
                    if (!r || typeof r.status !== 'number') {
                        r = bizErr(500, '系统繁忙，请稍后重试');
                    }
                    resolve(makeResponse(r.status, r.body));
                }, function () {
                    resolve(makeResponse(500, { code: 500, message: '系统繁忙，请稍后重试' }));
                });
            }, delay);
        });
    }

    var nativeFetch = (typeof window.fetch === 'function') ? window.fetch.bind(window) : null;

    function installFetch() {
        window.fetch = function (input, init) {
            var url = '';
            var method = 'GET';
            if (typeof input === 'string') {
                url = input;
                method = (init && init.method) || 'GET';
            } else if (input && typeof input === 'object') {
                url = input.url || '';
                method = (init && init.method) || input.method || 'GET';
            }
            method = String(method).toUpperCase();

            if (isApiUrl(url)) {
                return handleApi(method, url, init);
            }
            if (nativeFetch) {
                return nativeFetch(input, init);
            }
            return Promise.resolve(makeResponse(404, { code: 404, message: '资源不存在' }));
        };
        window.__LF_OFFLINE_FETCH__ = true;
    }

    if (OFFLINE) {
        installFetch();
    }

    /* ------------------------------------------------------------------ *
     * 11. AI 桥 + 本地降级
     * ------------------------------------------------------------------ */
    var aiSeq = 0;
    var aiPending = {};
    var aiDisabled = false;

    // 原生桥通过 window.__lfAiResult 回调（见 AiBridge.deliver）
    window.__lfAiResult = function (requestId, ok, text) {
        var cb = aiPending[requestId];
        if (!cb) { return; }
        delete aiPending[requestId];
        cb(!!ok, text || '');
    };
    // 兼容旧回调名
    window.NativeAI = window.NativeAI || {};
    try {
        window.NativeAI.onResult = function (requestId, ok, text) {
            window.__lfAiResult(requestId, ok, text);
        };
    } catch (e) { /* 某些机型 JS 接口对象不可写，忽略 */ }

    /**
     * 统一的 AI 对话入口。
     * @returns {Promise<string>} 成功返回 assistant 文本，失败返回空字符串（前端降级）
     */
    function aiChat(prompt) {
        if (aiDisabled) { return Promise.resolve(''); }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            aiDisabled = true;
            return Promise.resolve('');
        }
        var bridge = window.NativeAI;
        if (!bridge || typeof bridge.chat !== 'function') {
            aiDisabled = true;
            return Promise.resolve('');
        }
        var requestId = 'lf' + (++aiSeq) + '_' + Date.now();
        return new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) { return; }
                settled = true;
                delete aiPending[requestId];
                resolve('');
            }, 25000);

            aiPending[requestId] = function (ok, text) {
                if (settled) { return; }
                settled = true;
                clearTimeout(timer);
                var value = ok ? String(text || '').trim() : '';
                if (!value) { aiDisabled = true; }
                resolve(value);
            };

            try {
                var accepted = bridge.chat(String(prompt || ''), requestId);
                if (accepted === false) {
                    // 原生明确拒绝（未配置密钥等），直接降级
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        delete aiPending[requestId];
                        aiDisabled = true;
                        resolve('');
                    }
                }
            } catch (e) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    delete aiPending[requestId];
                    aiDisabled = true;
                    resolve('');
                }
            }
        });
    }

    /** 从 AI 文本里提取 JSON 数组（容忍 ```json 包裹与前后说明文字） */
    function parseJsonArray(text) {
        if (!text) { return null; }
        var t = String(text).trim();
        var start = t.indexOf('[');
        var end = t.lastIndexOf(']');
        if (start < 0 || end <= start) { return null; }
        try {
            var arr = JSON.parse(t.substring(start, end + 1));
            return Array.isArray(arr) ? arr : null;
        } catch (e) {
            return null;
        }
    }

    function cleanAiText(text) {
        if (!text) { return ''; }
        var t = String(text).trim();
        if (t.indexOf('```') === 0) {
            t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
        }
        return t;
    }

    /* ------------------------------------------------------------------ *
     * 12. 对外导出
     * ------------------------------------------------------------------ */
    window.aiChat = aiChat;
    window.LFOffline = {
        version: STATE_VERSION,
        isOffline: OFFLINE,
        reset: function () {
            resetAll();
            aiDisabled = false;
            return '演示数据已重置';
        },
        state: function () { return clone(state); },
        currentUser: function () { return publicUser(currentUser()); },
        aiChat: aiChat,
        aiStatus: function () {
            return {
                offline: OFFLINE,
                nativeBridge: !!(window.NativeAI && typeof window.NativeAI.chat === 'function'),
                available: !aiDisabled,
                online: (typeof navigator !== 'undefined' ? navigator.onLine !== false : true)
            };
        },
        keywords: extractKeywords,
        similarity: tokenOverlap
    };

    if (OFFLINE && window.console) {
        console.log('%c校园失物招领 · 离线演示模式已启用', 'color:#3DE0B0;font-weight:bold');
        console.log('演示账号：admin/admin123、alice/123456、bob/123456、carol/123456');
        console.log('重置数据：LFOffline.reset() 或访问任意页面加 ?resetDemo=1');
    }
})();
