package com.example.lostfound;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import javax.sql.DataSource;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * API 集成测试（MockMvc + H2 内存库）：
 * 覆盖核心业务流程（F1~F5）、权限（F6）、异常与边界（F8）、通知隔离（E3）、AI 降级（E2）、统计一致性（E4）。
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:testdb;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;NON_KEYWORDS=USER;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "app.demo-data=false",
        "app.deepseek.api-key="
})
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ApiIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    DataSource dataSource;

    final ObjectMapper om = new ObjectMapper();

    private static MockHttpSession sessionA;
    private static MockHttpSession sessionB;
    private static MockHttpSession sessionC;
    private static MockHttpSession sessionAdmin;
    private static long itemId;
    private static long claimId;

    MockHttpSession registerAndLogin(String username, String nickname) throws Exception {
        mvc.perform(post("/api/user/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"123456\",\"nickname\":\"" + nickname + "\",\"contact\":\"13800000000\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        MvcResult r = mvc.perform(post("/api/user/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"123456\"}"))
                .andExpect(status().isOk())
                .andReturn();
        return (MockHttpSession) r.getRequest().getSession();
    }

    @Test
    @Order(1)
    void f1_registerLoginAndSession() throws Exception {
        sessionA = registerAndLogin("usera", "用户A");
        sessionB = registerAndLogin("userb", "用户B");
        sessionC = registerAndLogin("userc", "用户C");

        // 重复注册 → 409
        mvc.perform(post("/api/user/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"usera\",\"password\":\"123456\",\"nickname\":\"x\"}"))
                .andExpect(jsonPath("$.code").value(409));

        // 未登录访问受保护接口 → 401
        mvc.perform(post("/api/items")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value("请先登录后再进行该操作"));

        // 公开列表未登录可访问
        mvc.perform(get("/api/items")).andExpect(status().isOk());

        // 密码错误 → 400 中文提示
        mvc.perform(post("/api/user/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"usera\",\"password\":\"wrong\"}"))
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("用户名或密码错误"));
    }

    @Test
    @Order(2)
    void f2_publishValidationAndVisibility() throws Exception {
        // 缺必填项 → 400 逐项提示
        mvc.perform(post("/api/items").session(sessionA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"FOUND\",\"name\":\"\",\"category\":\"生活用品\"}"))
                .andExpect(jsonPath("$.code").value(400));

        // 非法类型 → 400
        mvc.perform(post("/api/items").session(sessionA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"STOLEN\",\"name\":\"x\",\"category\":\"生活用品\",\"location\":\"图书馆\",\"eventTime\":\"2026-10-10T12:00:00\",\"description\":\"d\",\"contact\":\"138\"}"))
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("类型非法：只能为 LOST（寻物）或 FOUND（招领）"));

        // 正常发布
        MvcResult r = mvc.perform(post("/api/items").session(sessionA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"FOUND\",\"name\":\"黑色折叠雨伞\",\"category\":\"生活用品\",\"location\":\"图书馆二楼\",\"eventTime\":\"2026-10-10T12:00:00\",\"description\":\"捡到黑色雨伞，蓝色挂绳\",\"contact\":\"13800000001\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andReturn();
        itemId = om.readTree(r.getResponse().getContentAsString()).path("data").path("id").asLong();
        assertTrue(itemId > 0);

        // 普通用户角色为 USER（管理入口由角色区分）
        MvcResult me = mvc.perform(get("/api/user/profile").session(sessionA)).andReturn();
        assertEquals("USER", om.readTree(me.getResponse().getContentAsString()).path("data").path("role").asText());
    }

    @Test
    @Order(3)
    void f3_searchCombinationFilters() throws Exception {
        // 关键词命中名称
        mvc.perform(get("/api/items?keyword=雨伞"))
                .andExpect(jsonPath("$.data.total").value(1));
        // 组合筛选：类别+地点+类型同时满足
        mvc.perform(get("/api/items?type=FOUND&category=生活用品&location=图书馆&keyword=雨伞"))
                .andExpect(jsonPath("$.data.total").value(1));
        // 组合筛选：地点不匹配 → 0
        mvc.perform(get("/api/items?type=FOUND&category=生活用品&location=体育馆"))
                .andExpect(jsonPath("$.data.total").value(0));
        // 关键词同时匹配描述
        mvc.perform(get("/api/items?keyword=挂绳"))
                .andExpect(jsonPath("$.data.total").value(1));
        // 无匹配关键词
        mvc.perform(get("/api/items?keyword=不存在的东西xyz"))
                .andExpect(jsonPath("$.data.total").value(0));
        // 详情
        mvc.perform(get("/api/items/" + itemId))
                .andExpect(jsonPath("$.data.name").value("黑色折叠雨伞"));
        // 越界页码不报错
        mvc.perform(get("/api/items?page=999&size=10"))
                .andExpect(jsonPath("$.code").value(0));
    }

    @Test
    @Order(4)
    void f4_claimFlowAndDuplicateRejection() throws Exception {
        // 发布者本人不能认领
        mvc.perform(post("/api/claims").session(sessionA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":" + itemId + ",\"description\":\"本人认领\"}"))
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("不能认领自己发布的信息"));

        // B 提交认领（缺说明 → 400）
        mvc.perform(post("/api/claims").session(sessionB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":" + itemId + ",\"description\":\"\"}"))
                .andExpect(jsonPath("$.code").value(400));

        // B 正常提交 → 物品进入认领处理中
        MvcResult r = mvc.perform(post("/api/claims").session(sessionB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":" + itemId + ",\"description\":\"伞柄有蓝色挂绳，是我的\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andReturn();
        claimId = om.readTree(r.getResponse().getContentAsString()).path("data").path("id").asLong();

        // 物品状态同步为认领处理中
        mvc.perform(get("/api/items/" + itemId).session(sessionB))
                .andExpect(jsonPath("$.data.status").value("CLAIMING"));

        // 同一用户重复提交 → 409
        mvc.perform(post("/api/claims").session(sessionB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":" + itemId + ",\"description\":\"再次提交\"}"))
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("您已提交过该物品的认领申请，正在处理中，请勿重复提交"));

        // 第三人 C 在认领处理中不能提交
        mvc.perform(post("/api/claims").session(sessionC)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":" + itemId + ",\"description\":\"我也来认领\"}"))
                .andExpect(jsonPath("$.code").value(409));

        // E3：发布者 A 收到通知，C 收不到任何相关通知
        MvcResult na = mvc.perform(get("/api/notifications").session(sessionA)).andReturn();
        assertTrue(om.readTree(na.getResponse().getContentAsString()).path("data").path("unread").asLong() >= 1);
        MvcResult nc = mvc.perform(get("/api/notifications").session(sessionC)).andReturn();
        assertEquals(0, om.readTree(nc.getResponse().getContentAsString()).path("data").path("list").size());
    }

    @Test
    @Order(5)
    void f4f5_handleApproveAndIllegalTransitions() throws Exception {
        // 无权用户 C 不能处理
        mvc.perform(post("/api/claims/" + claimId + "/approve").session(sessionC))
                .andExpect(jsonPath("$.code").value(403));

        // 发布者 A 确认认领 → 已归还/已解决
        mvc.perform(post("/api/claims/" + claimId + "/approve").session(sessionA)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"挂绳核对无误\"}"))
                .andExpect(jsonPath("$.data.status").value("APPROVED"));
        mvc.perform(get("/api/items/" + itemId).session(sessionA))
                .andExpect(jsonPath("$.data.status").value("RESOLVED"));

        // 重复处理 → 409
        mvc.perform(post("/api/claims/" + claimId + "/reject").session(sessionA))
                .andExpect(jsonPath("$.code").value(409));

        // E3：认领人 B 收到确认通知
        MvcResult nb = mvc.perform(get("/api/notifications").session(sessionB)).andReturn();
        String content = nb.getResponse().getContentAsString();
        assertTrue(content.contains("已被确认"),
                "通知内容应包含'已被确认'，实际=" + java.net.URLEncoder.encode(content, java.nio.charset.StandardCharsets.UTF_8));

        // 标记已读
        long nid = om.readTree(content).path("data").path("list").get(0).path("id").asLong();
        mvc.perform(post("/api/notifications/" + nid + "/read").session(sessionB))
                .andExpect(jsonPath("$.code").value(0));
        MvcResult ub = mvc.perform(get("/api/notifications/unread-count").session(sessionB)).andReturn();
        assertEquals(0, om.readTree(ub.getResponse().getContentAsString()).path("data").path("unread").asLong());

        // F5 非法：已归还状态不能再编辑（仅待认领可编辑）
        mvc.perform(put("/api/items/" + itemId).session(sessionA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"改名\",\"category\":\"生活用品\",\"location\":\"图书馆\",\"eventTime\":\"2026-10-10T12:00:00\",\"description\":\"d\",\"contact\":\"138\"}"))
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("当前状态为「已归还/已解决」，仅「待认领」状态的信息可以编辑"));
    }

    @Test
    @Order(6)
    void f2WithdrawAndOwnership() throws Exception {
        // A 再发布一条并撤回
        MvcResult r = mvc.perform(post("/api/items").session(sessionA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"LOST\",\"name\":\"校园卡\",\"category\":\"证件卡片\",\"location\":\"食堂\",\"eventTime\":\"2026-10-11T08:00:00\",\"description\":\"丢失校园卡\",\"contact\":\"138\"}"))
                .andExpect(status().isOk()).andReturn();
        long id2 = om.readTree(r.getResponse().getContentAsString()).path("data").path("id").asLong();

        // 他人（B）不能撤回/编辑 A 的信息 → 403
        mvc.perform(post("/api/items/" + id2 + "/withdraw").session(sessionB))
                .andExpect(jsonPath("$.code").value(403));
        mvc.perform(put("/api/items/" + id2).session(sessionB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"x\",\"category\":\"证件卡片\",\"location\":\"食堂\",\"eventTime\":\"2026-10-11T08:00:00\",\"description\":\"x\",\"contact\":\"138\"}"))
                .andExpect(jsonPath("$.code").value(403))
                .andExpect(jsonPath("$.message").value("无权限：只能操作本人发布的信息"));

        // 本人撤回 → 已关闭且公开列表不可见
        mvc.perform(post("/api/items/" + id2 + "/withdraw").session(sessionA))
                .andExpect(jsonPath("$.data.status").value("CLOSED"));
        mvc.perform(get("/api/items?keyword=校园卡"))
                .andExpect(jsonPath("$.data.total").value(0));

        // F5：已关闭为终态，再次撤回被拒
        mvc.perform(post("/api/items/" + id2 + "/withdraw").session(sessionA))
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    @Order(7)
    void f6_adminPermissionHideDeleteAndAuditRecords() throws Exception {
        // 普通用户访问管理接口 → 403
        mvc.perform(get("/api/admin/items").session(sessionB))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("无权限：该操作仅管理员可执行"));

        // 直接写入管理员账号（测试环境 demo-data=false，不依赖初始化器）
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        String hash = new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode("admin123");
        jdbc.update("INSERT INTO user(username, password_hash, role, nickname, contact, create_time) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)",
                "admin", hash, "ADMIN", "管理员", "admin@campus.edu");
        MvcResult ra = mvc.perform(post("/api/user/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk()).andReturn();
        sessionAdmin = (MockHttpSession) ra.getRequest().getSession();

        // 管理员隐藏 → 公开列表与搜索不可见
        mvc.perform(post("/api/admin/items/" + itemId + "/hide").session(sessionAdmin))
                .andExpect(jsonPath("$.data.hidden").value(1));
        mvc.perform(get("/api/items?keyword=雨伞"))
                .andExpect(jsonPath("$.data.total").value(0));
        // 普通用户访问被隐藏详情 → 404
        mvc.perform(get("/api/items/" + itemId).session(sessionB))
                .andExpect(jsonPath("$.code").value(404));

        // 删除缺少 confirm → 400
        mvc.perform(delete("/api/admin/items/" + itemId).session(sessionAdmin))
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("删除操作需要二次确认：请携带 confirm=true 参数"));

        // 恢复可见后归档：已归还 → 已关闭
        mvc.perform(post("/api/admin/items/" + itemId + "/unhide").session(sessionAdmin))
                .andExpect(jsonPath("$.data.hidden").value(0));
        mvc.perform(post("/api/admin/items/" + itemId + "/archive").session(sessionAdmin))
                .andExpect(jsonPath("$.data.status").value("CLOSED"));

        // 处理记录可查到操作人/动作/对象
        MvcResult ar = mvc.perform(get("/api/admin/audit-records").session(sessionAdmin)).andReturn();
        JsonNode records = om.readTree(ar.getResponse().getContentAsString()).path("data");
        assertTrue(records.path("total").asLong() >= 3);
        boolean hasHide = false, hasArchive = false;
        for (JsonNode n : records.path("list")) {
            if ("隐藏信息".equals(n.path("action").asText())) {
                hasHide = true;
            }
            if ("归档关闭".equals(n.path("action").asText())) {
                hasArchive = true;
            }
        }
        assertTrue(hasHide && hasArchive, "处理记录应包含隐藏与归档动作，实际=" +
                java.net.URLEncoder.encode(records.toString(), java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test
    @Order(8)
    void e2_aiDegradationWithoutKey() throws Exception {
        // 未配置密钥 → 自动降级并明确提示
        MvcResult kw = mvc.perform(post("/api/ai/keywords").session(sessionB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"我在图书馆丢了一把黑色的雨伞\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.degraded").value(true))
                .andReturn();
        List<?> keywords = om.readValue(om.readTree(kw.getResponse().getContentAsString())
                .path("data").path("keywords").toString(), List.class);
        assertFalse(keywords.isEmpty(), "本地降级也应给出关键词");

        // 描述优化降级
        mvc.perform(post("/api/ai/description").session(sessionB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"捡到一张校园卡\"}"))
                .andExpect(jsonPath("$.data.degraded").value(true));

        // 空描述 → 400
        mvc.perform(post("/api/ai/keywords").session(sessionB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"\"}"))
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    @Order(9)
    void e4_statisticsAggregation() throws Exception {
        // 前置数据在先前用例中均已进入终态（已关闭），补发一条待认领信息作为统计样本
        mvc.perform(post("/api/items").session(sessionA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"LOST\",\"name\":\"运动水杯\",\"category\":\"生活用品\",\"location\":\"体育馆\",\"eventTime\":\"2026-10-12T18:00:00\",\"description\":\"透明水杯\",\"contact\":\"138\"}"))
                .andExpect(status().isOk());

        MvcResult c = mvc.perform(get("/api/stats/category")).andReturn();
        JsonNode cat = om.readTree(c.getResponse().getContentAsString()).path("data");
        assertTrue(cat.isArray() && cat.size() >= 1, "类别统计应有数据");

        MvcResult l = mvc.perform(get("/api/stats/location")).andReturn();
        assertTrue(om.readTree(l.getResponse().getContentAsString()).path("data").size() >= 1);

        MvcResult m = mvc.perform(get("/api/stats/monthly")).andReturn();
        JsonNode monthly = om.readTree(m.getResponse().getContentAsString()).path("data");
        assertTrue(monthly.isArray());

        // 抽查一致性：类别统计合计 = 公开列表总数（当前库内全部为未隐藏、含一条已归档已关闭信息，公开列表排除已关闭）
        long sum = 0;
        for (JsonNode n : cat) {
            sum += n.path("value").asLong();
        }
        MvcResult list = mvc.perform(get("/api/items?size=50")).andReturn();
        long publicTotal = om.readTree(list.getResponse().getContentAsString()).path("data").path("total").asLong();
        long hiddenExcluded = jdbc().queryForObject(
                "SELECT COUNT(*) FROM item_info WHERE status <> 'CLOSED' AND hidden = 0", Long.class);
        assertEquals(hiddenExcluded, sum, "类别统计合计应等于数据库中非已关闭未隐藏信息数");
        assertTrue(publicTotal >= 1);
    }

    @Test
    @Order(10)
    void f7_persistenceEvidenceInDatabase() throws Exception {
        // F7 由运行环境重启验证；此处验证数据持久化到数据库表而非运行时变量
        JdbcTemplate jdbc = jdbc();
        Integer itemCount = jdbc.queryForObject("SELECT COUNT(*) FROM item_info", Integer.class);
        Integer claimCount = jdbc.queryForObject("SELECT COUNT(*) FROM claim_application", Integer.class);
        Integer notifCount = jdbc.queryForObject("SELECT COUNT(*) FROM notification", Integer.class);
        assertTrue(itemCount != null && itemCount >= 2);
        assertTrue(claimCount != null && claimCount >= 1);
        assertTrue(notifCount != null && notifCount >= 2);
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
