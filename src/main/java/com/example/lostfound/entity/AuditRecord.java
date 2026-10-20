package com.example.lostfound.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("audit_record")
public class AuditRecord {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 操作人（管理员或处理者） */
    private Long adminId;

    /** 动作：审核/隐藏/恢复/删除/认领确认/认领拒绝/要求补充/归档 */
    private String action;

    /** 作用对象（物品或申请 ID） */
    private Long targetId;

    private String detail;

    private LocalDateTime createTime;
}
