package com.example.lostfound.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("notification")
public class Notification {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 唯一接收人（E3：站内定向通知，不做全站广播） */
    private Long userId;

    private Long itemId;

    private String content;

    /** 0=未读，1=已读 */
    private Integer isRead;

    private LocalDateTime createTime;
}
