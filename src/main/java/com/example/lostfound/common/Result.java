package com.example.lostfound.common;

import lombok.Data;

/**
 * 统一响应结构：页面只展示 message，不输出堆栈。
 */
@Data
public class Result<T> {

    private int code;
    private String message;
    private T data;

    public static <T> Result<T> ok(T data) {
        Result<T> r = new Result<>();
        r.code = 0;
        r.message = "操作成功";
        r.data = data;
        return r;
    }

    public static Result<Void> ok() {
        Result<Void> r = new Result<>();
        r.code = 0;
        r.message = "操作成功";
        return r;
    }

    public static <T> Result<T> error(int code, String message) {
        Result<T> r = new Result<>();
        r.code = code;
        r.message = message;
        return r;
    }
}
