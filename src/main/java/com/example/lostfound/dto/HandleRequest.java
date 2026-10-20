package com.example.lostfound.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class HandleRequest {

    /** 处理意见（可选） */
    @Size(max = 300, message = "处理意见不能超过 300 个字符")
    private String note;
}
