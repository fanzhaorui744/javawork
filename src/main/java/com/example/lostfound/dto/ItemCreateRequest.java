package com.example.lostfound.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class ItemCreateRequest {

    @NotBlank(message = "类型不能为空（寻物/招领）")
    private String type;

    @NotBlank(message = "物品名称不能为空")
    @Size(max = 50, message = "物品名称不能超过 50 个字符")
    private String name;

    @NotBlank(message = "物品类别不能为空")
    @Size(max = 20, message = "物品类别不能超过 20 个字符")
    private String category;

    @NotBlank(message = "地点不能为空")
    @Size(max = 50, message = "地点不能超过 50 个字符")
    private String location;

    @NotNull(message = "丢失/拾取时间不能为空")
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime eventTime;

    @NotBlank(message = "描述不能为空")
    @Size(max = 1000, message = "描述不能超过 1000 个字符")
    private String description;

    @NotBlank(message = "联系方式不能为空")
    @Size(max = 50, message = "联系方式不能超过 50 个字符")
    private String contact;

    /** 可选：直接填写本地图片路径进行关联 */
    @Size(max = 200, message = "图片路径不能超过 200 个字符")
    private String imagePath;
}
