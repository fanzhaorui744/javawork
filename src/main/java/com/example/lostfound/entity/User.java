package com.example.lostfound.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 登录名，唯一 */
    private String username;

    /** BCrypt 加密后的密码，绝不明文入库 */
    private String passwordHash;

    /** USER=普通用户，ADMIN=管理员 */
    private String role;

    private String nickname;

    /** 联系方式（手机号/微信等），登录用户在详情页可见 */
    private String contact;

    private LocalDateTime createTime;
}
