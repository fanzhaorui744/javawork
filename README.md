# 校园失物招领系统（Lost & Found）

Java 课程项目 · 乙方开发方交付物
对应《01_软件需求说明书》《02_项目开发计划书》，实现必做功能 F1～F8 与扩展功能 E1～E4。

## 1. 环境要求

| 项目 | 要求 |
|---|---|
| JDK | Java 17（LTS，开发使用 Eclipse Temurin 17.0.20） |
| 构建工具 | Maven 3.9+ |
| 数据库 | 默认嵌入式 H2（MySQL 兼容模式，文件持久化，零安装）；可选 MySQL 8 |
| 浏览器 | Chrome / Edge 最新版 |

> 默认配置使用嵌入式 H2 数据库文件（`./data/lostfound`），启动即用，重启数据不丢；
> 与计划书一致的 MySQL 8 部署方式见第 4 节「可选：MySQL 8 配置」。

## 2. 启动步骤

### 方式一：直接运行可执行 JAR（验收推荐）

```bash
java -jar lostfound.jar
```

启动成功后浏览器访问 <http://localhost:8080> 。

- Windows 双击 `启动Windows.bat` 亦可。
- 首次启动自动建表，并写入演示账号与演示数据（共 10 条跨类别、跨地点、跨月份的信息）。
- 再次启动会复用已有数据库文件，数据完整保留（F7）。

### 方式二：源码构建运行

```bash
mvn clean package
java -jar target/lostfound.jar
```

### 运行测试

```bash
mvn test
```

共 20 个测试：状态机单元测试（6）＋ 本地匹配算法测试（4）＋ API 集成测试（10），覆盖 F1～F8、E1～E4 主流程与异常分支。

## 3. 配置方法

### 3.1 DeepSeek API 密钥（E2 智能匹配）

密钥**只放本地配置文件，不写入代码、不随提交物上交**：

1. 在 `application.yml` 同目录新建 `application-local.yml`（已加入 .gitignore）：

```yaml
app:
  deepseek:
    api-key: sk-你的真实密钥
```

2. 启动时激活本地配置：`java -jar lostfound.jar --spring.profiles.active=local`
   或通过环境变量：`set DEEPSEEK_API_KEY=sk-...` 后启动。

**未配置密钥或 API 不可用时**：关键词推荐、描述优化、疑似匹配自动降级为本地算法，
接口返回 `degraded=true`，页面明确提示「本地匹配结果，请谨慎核验」，其余功能不受影响。

### 3.2 关键配置项（application.yml）

| 配置 | 默认 | 说明 |
|---|---|---|
| `server.port` | 8080 | 服务端口 |
| `app.upload-dir` | ./uploads | 物品图片存储目录 |
| `app.demo-data` | true | 首次启动写入演示数据（幂等，表非空则跳过） |
| `app.deepseek.timeout-seconds` | 10 | AI 调用超时（失败重试 1 次） |

前端 API 基址集中在 `static/js/config.js`，前后端分离部署时只改这一处。

## 4. 可选：MySQL 8 配置（与计划书 F7 技术选型一致）

```bash
# 1. 建库（MySQL 8 客户端执行 db/schema.sql 前两句）
CREATE DATABASE IF NOT EXISTS lostfound DEFAULT CHARACTER SET utf8mb4;
USE lostfound;
SOURCE db/schema.sql;

# 2. 修改 src/main/resources/application-mysql.yml 中的账号密码

# 3. 以 mysql 配置启动
mvn spring-boot:run "-Dspring-boot.run.profiles=mysql"
```

> 说明：五张表结构与计划书第 5 章一致；`claim_application` 的
> 「同一用户同一物品仅一条处理中申请」由服务层校验，schema.sql 中附
> MySQL 生成列唯一索引的可选兜底方案。

## 5. 示例数据（演示账号）

| 账号 | 密码 | 角色 | 用途 |
|---|---|---|---|
| admin | admin123 | 管理员 | 管理审核、隐藏/删除/归档、处理记录 |
| alice | 123456 | 普通用户 | 演示失主 |
| bob | 123456 | 普通用户 | 演示拾取者 |
| carol | 123456 | 普通用户 | 第三方隔离验证（E3） |

> 以上均为课程演示用途的模拟账号，非真实密码。

核心验收场景一次走通：alice 发布招领 → bob 检索并提交认领申请 → alice 确认 →
状态「待认领→认领处理中→已归还/已解决」，全程站内定向通知，第三人 carol 收不到任何相关通知。

## 6. 需求追踪一览

| SRS 编号 | 实现位置 |
|---|---|
| F1 用户与身份 | `UserController` / `LoginInterceptor` / `AdminInterceptor` / BCrypt |
| F2 信息发布 | `ItemController` / `ItemService`（发布、编辑、撤回） |
| F3 列表与搜索 | `ItemService.search`（MyBatis-Plus 组合条件 + 分页） |
| F4 认领申请 | `ClaimController` / `ClaimService`（提交 + 确认/拒绝/要求补充） |
| F5 状态流转 | `ItemStatus` 状态机（统一 transition 入口 + 单元测试全覆盖） |
| F6 管理审核 | `AdminController` / `AdminService` / `AuditService` |
| F7 数据保存 | H2 文件库（默认）/ MySQL 8（可选），五张表 |
| F8 反馈与异常 | `GlobalExceptionHandler` 统一 {code, message}，无堆栈输出 |
| E1 图片关联 | `POST /api/items/{id}/image`（jpg/png ≤ 5MB，UUID 重命名） |
| E2 智能匹配 | `AiService`（OkHttp + DeepSeek）/ `MatchService.localScore` 降级 |
| E3 站内通知 | `NotifyService`（当事用户定向、未读标记、按用户隔离） |
| E4 数据统计 | `StatisticsMapper`（GROUP BY 聚合）+ ECharts 三图 |

## 7. 已知限制

1. **AI 功能依赖外部 DeepSeek API**：未配置密钥或断网时自动降级为本地算法（接口返回 `degraded=true`，页面有降级提示）。
2. **Android APK**：本包未含 APK。APP 方案为 WebView 壳封装本 Web 版（计划书 R18），需 Android SDK 环境打包。
3. **会话为服务端内存会话**：服务重启后需重新登录（业务数据持久化不受影响）。
4. **性能按课程演示规模设计**：不承诺高并发，见 SRS 第 7 章。
5. GitHub Pages 仅托管静态前端展示入口，完整功能演示在本机运行整套系统。

## 8. AI 使用说明（课程合规要求）

开发过程中使用 AI 辅助完成部分样板代码（实体类、前端页面）与调试；
核心业务逻辑（状态机、认领流转、权限拦截、降级算法、聚合统计）均经本人逐行检查与测试验证，可现场讲解。

## 9. 目录结构

```
lostfound/
├── pom.xml
├── db/schema.sql                  # 建库脚本（H2/MySQL 通用）
├── e2e_test.sh                    # 端到端验证脚本（正常/异常/边界）
├── 启动Windows.bat
├── src/main/java/com/example/lostfound/
│   ├── entity/                    # User/ItemInfo/ClaimApplication/Notification/AuditRecord + 枚举
│   ├── mapper/                    # MyBatis-Plus Mapper + 统计聚合 SQL
│   ├── service/                   # 业务层（Item/Claim/Notify/Admin/Match/Ai/Statistics/User/Audit）
│   ├── controller/                # REST 接口层
│   ├── interceptor/               # 登录 / 管理员拦截器
│   ├── config/                    # Web/MyBatisPlus 配置、演示数据初始化
│   └── common/                    # 统一返回、业务异常、全局异常处理、会话工具
├── src/main/resources/
│   ├── application.yml            # 默认配置（H2 文件库）
│   ├── application-mysql.yml      # 可选 MySQL 8 配置
│   └── static/                    # 前端页面（HTML + 原生 JS + ECharts）
└── src/test/java/                 # JUnit 5 单元测试与 MockMvc 集成测试
```
