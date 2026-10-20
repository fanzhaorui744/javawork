package com.example.lostfound.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class ClaimCreateRequest {

    @NotNull(message = "物品 ID 不能为空")
    private Long itemId;

    @NotBlank(message = "认领说明不能为空")
    @Size(max = 500, message = "认领说明不能超过 500 个字符")
    private String description;
}
