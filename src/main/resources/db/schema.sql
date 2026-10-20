-- 校园失物招领系统建库脚本（H2 / MySQL 8 通用 DDL）
-- MySQL 使用：CREATE DATABASE IF NOT EXISTS lostfound DEFAULT CHARACTER SET utf8mb4; USE lostfound;

CREATE TABLE IF NOT EXISTS user (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    nickname VARCHAR(50),
    contact VARCHAR(100),
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_user_username ON user (username);

CREATE TABLE IF NOT EXISTS item_info (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(10) NOT NULL,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    location VARCHAR(100) NOT NULL,
    event_time TIMESTAMP,
    description VARCHAR(2000),
    contact VARCHAR(100),
    image_path VARCHAR(300),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    publisher_id BIGINT NOT NULL,
    hidden INT NOT NULL DEFAULT 0,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_item_status ON item_info (status, hidden);
CREATE INDEX IF NOT EXISTS idx_item_category ON item_info (category);
CREATE INDEX IF NOT EXISTS idx_item_event_time ON item_info (event_time);

CREATE TABLE IF NOT EXISTS claim_application (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    item_id BIGINT NOT NULL,
    applicant_id BIGINT NOT NULL,
    description VARCHAR(1000),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    handler_id BIGINT,
    handle_note VARCHAR(500),
    handle_time TIMESTAMP,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_claim_item ON claim_application (item_id, status);
-- MySQL 环境可选：用生成列兜底“同一用户同一物品仅一条处理中申请”的唯一约束
-- ALTER TABLE claim_application ADD COLUMN active_key VARCHAR(100) GENERATED ALWAYS AS
--   (CASE WHEN status = 'PENDING' THEN CONCAT(item_id, '-', applicant_id) ELSE NULL END) STORED,
--   ADD UNIQUE KEY uk_claim_active (active_key);

CREATE TABLE IF NOT EXISTS notification (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    item_id BIGINT,
    content VARCHAR(500) NOT NULL,
    is_read INT NOT NULL DEFAULT 0,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notification_user ON notification (user_id, is_read);

CREATE TABLE IF NOT EXISTS audit_record (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    action VARCHAR(50) NOT NULL,
    target_id BIGINT,
    detail VARCHAR(500),
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_record (create_time);
