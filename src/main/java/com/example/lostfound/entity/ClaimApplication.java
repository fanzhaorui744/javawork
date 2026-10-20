package com.example.lostfound.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("claim_application")
public class ClaimApplication {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long itemId;

    private Long applicantId;

    /** 认领说明 */
    private String description;

    /** 处理中/已确认/已拒绝/要求补充，见 ClaimStatus */
    private String status;

    private Long handlerId;

    private String handleNote;

    private LocalDateTime handleTime;

    private LocalDateTime createTime;
}
