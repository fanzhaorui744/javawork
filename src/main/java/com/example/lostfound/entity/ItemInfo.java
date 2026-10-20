package com.example.lostfound.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("item_info")
public class ItemInfo {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 寻物(LOST) / 招领(FOUND) */
    private String type;

    private String name;

    private String category;

    private String location;

    /** 丢失或拾取时间 */
    private LocalDateTime eventTime;

    private String description;

    private String contact;

    /** 物品图片路径（uploads/ 下相对路径或用户填写的本地路径） */
    private String imagePath;

    /** 待认领/认领处理中/已归还/已关闭，见 ItemStatus */
    private String status;

    private Long publisherId;

    /** 管理员隐藏标记：1=隐藏，公开列表与搜索统一过滤 */
    private Integer hidden;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;
}
