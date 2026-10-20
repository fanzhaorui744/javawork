package com.example.lostfound.config;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.lostfound.entity.*;
import com.example.lostfound.mapper.AuditRecordMapper;
import com.example.lostfound.mapper.ClaimApplicationMapper;
import com.example.lostfound.mapper.ItemInfoMapper;
import com.example.lostfound.mapper.NotificationMapper;
import com.example.lostfound.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 演示数据初始化：仅当 user 表为空时写入（幂等）。
 * 演示账号密码均为课程演示用途，非真实密码。
 *
 * 数据覆盖说明（用于答辩演示与统计图表）：
 *  - 四种物品状态齐全：待认领 / 认领处理中 / 已归还 / 已关闭
 *  - 跨 6 个月的时间分布，保证「逐月趋势」折线图有形状
 *  - 完整的认领申请 + 站内通知 + 审核记录，管理后台与通知页有真实数据
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DemoDataInitializer implements CommandLineRunner {

    private final UserMapper userMapper;
    private final ItemInfoMapper itemMapper;
    private final ClaimApplicationMapper claimMapper;
    private final NotificationMapper notificationMapper;
    private final AuditRecordMapper auditMapper;

    @Value("${app.demo-data:true}")
    private boolean demoData;

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    private User admin;
    private User alice;
    private User bob;
    private User carol;

    @Override
    public void run(String... args) {
        if (!demoData) {
            return;
        }
        Long count = userMapper.selectCount(new LambdaQueryWrapper<>());
        if (count != null && count > 0) {
            return;
        }

        admin = user("admin", "admin123", UserRole.ADMIN, "系统管理员", "admin@campus.edu");
        alice = user("alice", "123456", UserRole.USER, "小明（失主）", "13800000001");
        bob = user("bob", "123456", UserRole.USER, "小红（拾取者）", "13800000002");
        carol = user("carol", "123456", UserRole.USER, "同学C", "13800000003");
        log.info("演示账号已创建：admin/admin123、alice/123456、bob/123456、carol/123456");

        /* ---------------- 一、待认领（可演示完整认领流程） ---------------- */
        /*
         * 雨伞：bob 捡到并发布招领，alice 是失主、提交认领并已确认。
         * 这条数据专门用于演示 F9「感谢接力」——alice 打开该招领详情页，
         * 就能看到是谁捡到的、联系方式，并发出致谢。
         */
        ItemInfo umbrellaFound = itemWithStatus("FOUND", "黑色折叠雨伞", "生活用品", "行知楼", daysAgo(1),
                "在行知楼二楼自习区座位上捡到一把黑色折叠雨伞，伞柄上系着蓝色挂绳，伞面有轻微磨损。认领请说明挂绳细节。",
                "13800000002", bob.getId(), ItemStatus.RESOLVED);
        ItemInfo umbrellaLost = itemWithStatus("LOST", "黑色折叠雨伞", "生活用品", "行知楼", daysAgo(2),
                "昨晚在行知楼二楼自习区丢失一把黑色折叠雨伞，伞柄系蓝色挂绳，内有校园卡套。",
                "13800000001", alice.getId(), ItemStatus.RESOLVED);
        ClaimApplication umbrellaClaim = claim(umbrellaFound.getId(), alice.getId(),
                "伞柄上的蓝色挂绳是我系的，伞内还有一张校园卡套，可以核对卡套里的照片。",
                ClaimStatus.APPROVED, daysAgo(1), daysAgo(1));
        notify(alice.getId(), umbrellaFound.getId(),
                "您对「黑色折叠雨伞」的认领申请已被确认，现在可以查看拾取者联系方式并向 TA 致谢。", 0, daysAgo(1));
        notify(bob.getId(), umbrellaFound.getId(),
                "失主已确认您捡到的「黑色折叠雨伞」，感谢您的善意。", 1, daysAgo(1));
        audit(admin.getId(), "认领确认", umbrellaFound.getId(),
                "审核认领申请 #" + umbrellaClaim.getId() + "，确认物品已归还，失主可查看拾取者联系方式", daysAgo(1));

        item("LOST", "校园卡", "证件卡片", "桔园餐厅", daysAgo(3),
                "10月10日中午在第一食堂丢失校园卡，卡面姓名范某某，学号 W1243 开头，捡到请联系，感谢！",
                "13800000001", alice.getId());
        item("FOUND", "蓝色保温杯", "生活用品", "A座", daysAgo(4),
                "下课后在教学楼A座301捡到蓝色保温杯一个，杯身贴有卡通贴纸，杯盖有磕碰痕迹。",
                "13800000002", bob.getId());
        item("LOST", "高等数学教材", "书籍资料", "B座", daysAgo(8),
                "丢失《高等数学》第七版上册，书内有手写笔记和借书卡，封面右下角有破损。",
                "13800000001", carol.getId());
        item("FOUND", "苹果无线耳机充电盒", "电子数码", "南体育场", daysAgo(12),
                "傍晚在操场看台捡到一个白色 AirPods 充电盒，盒内有左右耳机，外壳有细小划痕。",
                "13800000002", alice.getId());

        /* ---------------- 二、认领处理中（演示处理态与通知） ---------------- */
        ItemInfo waterBottle = itemWithStatus("LOST", "运动水杯", "生活用品", "南体育场", daysAgo(15),
                "体育馆篮球场丢失透明运动水杯一只，杯身印有校徽。",
                "13800000003", carol.getId(), ItemStatus.CLAIMING);

        claim(waterBottle.getId(), bob.getId(),
                "杯子是我的，杯底有一道竖着的划痕，杯身上贴过校运会标签但已撕掉。", ClaimStatus.PENDING, daysAgo(14), null);
        notify(carol.getId(), waterBottle.getId(), "您发布的「运动水杯」收到一条认领申请，请及时处理。", 0, daysAgo(14));

        /* ---------------- 三、已归还（已完成核心闭环） ---------------- */
        ItemInfo uDisk = itemWithStatus("LOST", "U盘（32G 银色）", "电子数码", "C座", daysAgo(45),
                "机房上课丢失银色 32G U盘一个，内有课程作业文件，捡到必有重谢。",
                "13800000001", alice.getId(), ItemStatus.RESOLVED);

        ClaimApplication approvedClaim = claim(uDisk.getId(), bob.getId(),
                "我在机房楼3楼捡到一个银色U盘，插上后里面有一个「课程作业」文件夹。", ClaimStatus.APPROVED, daysAgo(43), daysAgo(42));
        notify(alice.getId(), uDisk.getId(), "您发布的「U盘（32G 银色）」认领申请已被确认，物品状态更新为「已归还/已解决」。", 1, daysAgo(42));
        notify(bob.getId(), uDisk.getId(), "您对「U盘（32G 银色）」的认领申请已被确认，请联系发布者取回。", 1, daysAgo(42));
        audit(admin.getId(), "认领确认", uDisk.getId(), "审核认领申请 #" + approvedClaim.getId() + "，确认物品已归还", daysAgo(42));

        /* ---------------- 四、已关闭（撤回 / 归档） ---------------- */
        ItemInfo keys = itemWithStatus("LOST", "宿舍钥匙串", "生活用品", "竹园宿舍楼", daysAgo(70),
                "南门快递点附近丢失钥匙一串，共5把钥匙，带红色钥匙扣。",
                "13800000003", carol.getId(), ItemStatus.CLOSED);
        notify(carol.getId(), keys.getId(), "您发布的「宿舍钥匙串」已关闭，不再公开展示。", 1, daysAgo(68));
        audit(carol.getId(), "撤回", keys.getId(), "发布者本人撤回信息，状态变更为已关闭", daysAgo(68));

        ItemInfo headphone = itemWithStatus("FOUND", "白色蓝牙耳机", "电子数码", "行知楼", daysAgo(52),
                "图书馆一楼大厅服务台代收白色蓝牙耳机一只，请失主凭购买凭证认领。",
                "13800000002", bob.getId(), ItemStatus.RESOLVED);
        ClaimApplication approvedClaim2 = claim(headphone.getId(), carol.getId(),
                "耳机是我的，右耳外壳有一道浅色刮痕，充电盒内侧贴着保修贴。", ClaimStatus.APPROVED, daysAgo(50), daysAgo(49));
        notify(bob.getId(), headphone.getId(), "您发布的「白色蓝牙耳机」认领申请已被确认。", 1, daysAgo(49));
        notify(carol.getId(), headphone.getId(), "您对「白色蓝牙耳机」的认领申请已被确认。", 1, daysAgo(49));
        audit(bob.getId(), "认领确认", headphone.getId(), "审核认领申请 #" + approvedClaim2.getId() + "，确认物品已归还", daysAgo(49));

        /* 已归还后再由管理员归档关闭 */
        headphone.setStatus(ItemStatus.CLOSED.name());
        itemMapper.updateById(headphone);
        audit(admin.getId(), "归档", headphone.getId(), "已归还信息归档关闭", daysAgo(48));

        /* ---------------- 五、历史月份数据（撑起逐月趋势图） ---------------- */
        monthItems();

        log.info("演示数据已写入：物品（跨 6 个月 / 覆盖 4 种状态）、"
                + "3 条认领申请（其中 1 条专供「感谢接力」演示）、站内通知、审核记录");
    }

    /** 逐月历史物品，保证 E4 统计的「逐月趋势」有 6 个月数据 */
    private void monthItems() {
        item("FOUND", "灰色围巾", "衣物配饰", "笃行南楼", monthsAgo(1, 6),
                "图书馆三楼阅览区捡到灰色针织围巾一条，无品牌标识。", "13800000002", bob.getId());
        item("LOST", "学生证", "证件卡片", "西2门", monthsAgo(1, 12),
                "在校医院就诊后丢失学生证，姓名已涂销，请拾到者联系。", "13800000001", alice.getId());
        item("FOUND", "机械键盘", "电子数码", "健康科学研究院", monthsAgo(2, 5),
                "机房楼2楼捡到黑色 87 键机械键盘一把，键帽有使用痕迹。", "13800000002", bob.getId());
        item("LOST", "篮球", "其他", "篮球场", monthsAgo(2, 18),
                "体育馆遗失斯伯丁篮球一个，球面写有「3班」字样。", "13800000003", carol.getId());
        item("FOUND", "笔记本", "书籍资料", "人文楼", monthsAgo(3, 9),
                "第一食堂捡到笔记本一本，内含实验报告与课堂笔记。", "13800000001", alice.getId());
        item("LOST", "电动车钥匙", "生活用品", "枫园", monthsAgo(3, 21),
                "南门车棚丢失电动车钥匙，钥匙扣是蓝色小熊造型。", "13800000002", bob.getId());
        item("FOUND", "充电宝", "电子数码", "社科楼", monthsAgo(4, 11),
                "图书馆一楼大厅捡到白色充电宝一个，容量 10000mAh。", "13800000003", carol.getId());
        item("LOST", "眼镜", "衣物配饰", "艺术楼", monthsAgo(4, 23),
                "教学楼C座丢失黑框近视眼镜一副，度数约 400 度。", "13800000001", alice.getId());
        item("FOUND", "雨衣", "衣物配饰", "西2门", monthsAgo(5, 7),
                "东门传达室收到深蓝色雨衣一件，无人认领。", "13800000002", bob.getId());
        item("LOST", "水卡", "证件卡片", "梅园餐厅", monthsAgo(5, 16),
                "宿舍楼下丢失饭卡充值水卡一张，卡内余额不多但希望找回。", "13800000003", carol.getId());
    }

    /* ================== 构造辅助 ================== */

    private User user(String username, String password, UserRole role, String nickname, String contact) {
        User u = new User();
        u.setUsername(username);
        u.setPasswordHash(encoder.encode(password));
        u.setRole(role.name());
        u.setNickname(nickname);
        u.setContact(contact);
        u.setCreateTime(LocalDateTime.now());
        userMapper.insert(u);
        return u;
    }

    private ItemInfo item(String type, String name, String category, String location,
                          LocalDateTime eventTime, String description, String contact, Long publisherId) {
        return itemWithStatus(type, name, category, location, eventTime, description, contact, publisherId, ItemStatus.PENDING);
    }

    private ItemInfo itemWithStatus(String type, String name, String category, String location,
                                    LocalDateTime eventTime, String description, String contact,
                                    Long publisherId, ItemStatus status) {
        ItemInfo i = new ItemInfo();
        i.setType(type);
        i.setName(name);
        i.setCategory(category);
        i.setLocation(location);
        i.setEventTime(eventTime);
        i.setDescription(description);
        i.setContact(contact);
        i.setImagePath(null);
        i.setStatus(status.name());
        i.setHidden(0);
        i.setPublisherId(publisherId);
        i.setCreateTime(eventTime.plusHours(2));
        i.setUpdateTime(eventTime.plusHours(2));
        applyMapCoord(i, location);
        itemMapper.insert(i);
        return i;
    }

    /**
     * 按地点名填地图坐标，与前端 static/js/campus-map.js 的 PLACES 保持一致。
     * 坐标是底图百分比（0~100），底图为 campus-map.jpg。
     */
    private void applyMapCoord(ItemInfo i, String location) {
        double[] xy = CAMPUS_COORD.get(location);
        if (xy != null) {
            i.setMapX(xy[0]);
            i.setMapY(xy[1]);
        }
    }

    /** 地点 -> {x%, y%}，数据来自 campus-map.js */
    private static final Map<String, double[]> CAMPUS_COORD = Map.ofEntries(
            Map.entry("行知楼", new double[]{41.4, 21.9}),
            Map.entry("艺术楼", new double[]{44.1, 34.1}),
            Map.entry("人文楼", new double[]{40.2, 43.8}),
            Map.entry("社科楼", new double[]{48.8, 53.1}),
            Map.entry("笃行南楼", new double[]{25.9, 38.1}),
            Map.entry("博学南楼D座", new double[]{30.8, 45.0}),
            Map.entry("A座", new double[]{41.4, 12.4}),
            Map.entry("B座", new double[]{30.6, 15.7}),
            Map.entry("C座", new double[]{32.0, 11.6}),
            Map.entry("健康科学研究院", new double[]{40.9, 5.3}),
            Map.entry("办公楼", new double[]{59.6, 68.2}),
            Map.entry("桔园餐厅", new double[]{16.2, 8.1}),
            Map.entry("梅园餐厅", new double[]{15.9, 45.0}),
            Map.entry("翡翠湖宴会厅", new double[]{54.1, 9.2}),
            Map.entry("桔园宿舍楼", new double[]{11.1, 15.0}),
            Map.entry("1号楼", new double[]{11.1, 17.9}),
            Map.entry("松园", new double[]{14.1, 39.6}),
            Map.entry("竹园宿舍楼", new double[]{20.2, 50.8}),
            Map.entry("槐园", new double[]{23.5, 53.7}),
            Map.entry("枫园", new double[]{29.1, 60.9}),
            Map.entry("曙光人工湖", new double[]{38.2, 28.6}),
            Map.entry("莲花池", new double[]{40.1, 16.8}),
            Map.entry("绿化公园", new double[]{33.2, 32.6}),
            Map.entry("神隐花园", new double[]{61.4, 33.5}),
            Map.entry("望湖台", new double[]{66.8, 11.6}),
            Map.entry("杏坛广场", new double[]{43.7, 39.5}),
            Map.entry("南体育场", new double[]{36.0, 66.6}),
            Map.entry("篮球场", new double[]{60.7, 37.2}),
            Map.entry("西门", new double[]{2.6, 26.9}),
            Map.entry("西2门", new double[]{57.8, 29.5})
    );

    private ClaimApplication claim(Long itemId, Long applicantId, String description,
                                   ClaimStatus status, LocalDateTime createTime, LocalDateTime handleTime) {
        ClaimApplication c = new ClaimApplication();
        c.setItemId(itemId);
        c.setApplicantId(applicantId);
        c.setDescription(description);
        c.setStatus(status.name());
        c.setCreateTime(createTime);
        if (handleTime != null) {
            c.setHandlerId(admin.getId());
            c.setHandleNote("核实物品特征一致，确认归还");
            c.setHandleTime(handleTime);
        }
        claimMapper.insert(c);
        return c;
    }

    private void notify(Long userId, Long itemId, String content, int isRead, LocalDateTime time) {
        Notification n = new Notification();
        n.setUserId(userId);
        n.setItemId(itemId);
        n.setContent(content);
        n.setIsRead(isRead);
        n.setCreateTime(time);
        notificationMapper.insert(n);
    }

    private void audit(Long adminId, String action, Long targetId, String detail, LocalDateTime time) {
        AuditRecord r = new AuditRecord();
        r.setAdminId(adminId);
        r.setAction(action);
        r.setTargetId(targetId);
        r.setDetail(detail);
        r.setCreateTime(time);
        auditMapper.insert(r);
    }

    private LocalDateTime daysAgo(int days) {
        return LocalDateTime.now().minusDays(days);
    }

    private LocalDateTime monthsAgo(int months, int daysAgo) {
        return LocalDateTime.now().minusMonths(months).minusDays(daysAgo);
    }
}
