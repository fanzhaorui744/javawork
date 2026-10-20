/* =============================================================================
 * 磬苑校区地理数据（campus-map.js）
 * -----------------------------------------------------------------------------
 * 底图：img/campus-map.jpg
 *   来源 = 安徽大学磬苑校区卫星影像（原图 2030 x 1842），整体缩放到 1700 x 1543，
 *   未做任何裁切，北门 / 东门 / 南门 / 西门 均在图内。
 *   图上自带建筑标注，与点位一一对应。
 *
 * 坐标约定：底图百分比，原点左上角，x 向右、y 向下。
 * 标定方式：在底图上叠点渲染成图（img/_map_calib.html）逐轮肉眼复核后定稿。
 * ========================================================================== */
(function (global) {
    'use strict';

    /** 底图像素尺寸，改图时必须同步 */
    var MAP_W = 1700;
    var MAP_H = 1543;

    /**
     * 校区地点字典。
     *  - id     : 规范名称，与数据库 item.location 对应
     *  - x, y   : 百分比坐标
     *  - cat    : 分类，用于筛选与图例配色
     *  - aliases: 常见别名，用户手输地点时用于归一化
     */
    var PLACES = [


        /* ---------------- 教学 ---------------- */
        { id: '行知楼', x: 41.4, y: 21.9, cat: '教学', aliases: ['行知楼', '行知'] },
        { id: '艺术楼', x: 44.1, y: 34.1, cat: '教学', aliases: ['艺术楼', '艺术'] },
        { id: '人文楼', x: 40.2, y: 43.8, cat: '教学', aliases: ['人文楼', '人文'] },
        { id: '社科楼', x: 48.8, y: 53.1, cat: '教学', aliases: ['社科楼', '社科'] },
        { id: '笃行南楼', x: 25.9, y: 38.1, cat: '教学', aliases: ['笃行南楼', '笃行'] },
        { id: '博学南楼D座', x: 30.8, y: 45.0, cat: '教学', aliases: ['博学南楼', '博学南楼D座', '博学'] },
        { id: 'A座', x: 40.2, y: 10.9, cat: '教学', aliases: ['A座', 'a座'] },
        { id: 'B座', x: 30.0, y: 14.2, cat: '教学', aliases: ['B座', 'b座'] },
        { id: 'C座', x: 31.3, y: 10.2, cat: '教学', aliases: ['C座', 'c座'] },
        { id: '健康科学研究院', x: 39.9, y: 3.9, cat: '教学', aliases: ['健康科学研究院', '健康研究院', '研究院'] },

        /* ---------------- 行政 ---------------- */
        { id: '办公楼', x: 57.4, y: 66.8, cat: '行政', aliases: ['办公楼', '行政楼', '校办'] },

        /* ---------------- 生活 ---------------- */
        { id: '桔园餐厅', x: 14.3, y: 5.5, cat: '生活', aliases: ['桔园餐厅', '桔园食堂', '桔园'] },
        { id: '梅园餐厅', x: 14.1, y: 43.5, cat: '生活', aliases: ['梅园餐厅', '梅园食堂', '梅园'] },
        { id: '翡翠湖宴会厅', x: 52.2, y: 7.3, cat: '生活', aliases: ['翡翠湖宴会厅', '宴会厅'] },

        /* ---------------- 宿舍 ---------------- */
        { id: '桔园宿舍楼', x: 9.6, y: 13.5, cat: '宿舍', aliases: ['桔园宿舍', '桔园宿舍楼'] },
        { id: '1号楼', x: 10.0, y: 16.4, cat: '宿舍', aliases: ['1号楼', '一号楼'] },
        { id: '松园', x: 12.5, y: 38.2, cat: '宿舍', aliases: ['松园', '松园宿舍'] },
        { id: '竹园宿舍楼', x: 18.7, y: 49.5, cat: '宿舍', aliases: ['竹园', '竹园宿舍', '竹园宿舍楼'] },
        { id: '槐园', x: 21.9, y: 52.4, cat: '宿舍', aliases: ['槐园', '槐园宿舍'] },
        { id: '枫园', x: 27.6, y: 59.7, cat: '宿舍', aliases: ['枫园', '枫园宿舍'] },

        /* ---------------- 景观 ---------------- */
        { id: '曙光人工湖', x: 36.7, y: 27.0, cat: '景观', aliases: ['曙光人工湖', '人工湖', '曙光湖'] },
        { id: '莲花池', x: 38.6, y: 15.6, cat: '景观', aliases: ['莲花池'] },
        { id: '绿化公园', x: 31.5, y: 31.4, cat: '景观', aliases: ['绿化公园', '公园'] },
        { id: '神隐花园', x: 59.9, y: 32.1, cat: '景观', aliases: ['神隐花园'] },
        { id: '望湖台', x: 65.2, y: 10.9, cat: '景观', aliases: ['望湖台', '观景台'] },
        { id: '杏坛广场', x: 42.1, y: 38.4, cat: '景观', aliases: ['杏坛广场', '杏坛', '广场'] },

        /* ---------------- 体育 ---------------- */
        { id: '南体育场', x: 35.0, y: 65.2, cat: '体育', aliases: ['南体育场', '体育场', '操场', '田径场'] },
        { id: '篮球场', x: 59.1, y: 35.9, cat: '体育', aliases: ['篮球场', '球场'] },

        /* ---------------- 校门 ---------------- */
        { id: '西门', x: 3.1, y: 25.3, cat: '校门', aliases: ['西门', '西大门'] },
        { id: '西2门', x: 56.4, y: 28.2, cat: '校门', aliases: ['西2门', '西二门'] },    ];

    /** 分类配色，与前端主题一致 */
    var CAT_COLOR = {
        '教学': '#6366f1',
        '行政': '#a855f7',
        '生活': '#fbbf24',
        '宿舍': '#34d399',
        '景观': '#22d3ee',
        '体育': '#fb7185',
        '校门': '#94a3b8',
    };

    var BY_ID = {};
    PLACES.forEach(function (p) { BY_ID[p.id] = p; });

    function allNames() {
        return PLACES.map(function (p) { return p.id; });
    }

    /**
     * 把用户输入的地点文本归一化到规范地点：
     *   1. 完全一致  2. 命中别名  3. 包含关系（最长匹配优先）
     * 匹配不到返回 null。
     */
    function normalizeLocation(text) {
        if (!text) { return null; }
        var s = String(text).trim();
        if (!s) { return null; }
        if (BY_ID[s]) { return s; }

        var best = null, bestLen = 0;
        for (var i = 0; i < PLACES.length; i++) {
            var p = PLACES[i];
            var words = [p.id].concat(p.aliases || []);
            for (var j = 0; j < words.length; j++) {
                var w = words[j];
                if (!w) { continue; }
                if (s === w) { return p.id; }
                if (s.indexOf(w) >= 0 && w.length > bestLen) {
                    best = p.id; bestLen = w.length;
                }
            }
        }
        return best;
    }

    /** 就近吸附：给定底图百分比坐标，返回最近的 n 个地点 */
    function nearestPlaces(x, y, limit) {
        var arr = [];
        for (var i = 0; i < PLACES.length; i++) {
            var p = PLACES[i];
            var dx = p.x - x, dy = p.y - y;
            arr.push({ place: p, dist: Math.sqrt(dx * dx + dy * dy) });
        }
        arr.sort(function (a, b) { return a.dist - b.dist; });
        return arr.slice(0, limit || 1);
    }

    /** 百分比距离 -> 0~100 的贴合分 */
    function snapScore(dist) {
        return Math.max(0, Math.round((1 - dist / 12) * 100));
    }

    global.CampusMap = {
        MAP_W: MAP_W,
        MAP_H: MAP_H,
        PLACES: PLACES,
        CAT_COLOR: CAT_COLOR,
        byId: function (id) { return BY_ID[id] || null; },
        allNames: allNames,
        normalizeLocation: normalizeLocation,
        nearestPlaces: nearestPlaces,
        snapScore: snapScore
    };
})(window);
