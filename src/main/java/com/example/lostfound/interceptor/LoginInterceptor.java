package com.example.lostfound.interceptor;

import com.example.lostfound.common.SessionUtil;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;

/**
 * 登录拦截器（F1）：未登录访问受保护接口时返回 401 并引导前端跳转登录页。
 * 公开接口：登录/注册、公开列表与详情（GET /api/items）、公开统计（GET /api/stats）。
 */
public class LoginInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String path = request.getRequestURI();
        if (isPublic(request.getMethod(), path)) {
            return true;
        }
        HttpSession session = request.getSession(false);
        if (SessionUtil.currentUser(session) != null) {
            return true;
        }
        response.setStatus(401);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"code\":401,\"message\":\"请先登录后再进行该操作\"}");
        return false;
    }

    private boolean isPublic(String method, String path) {
        if ("/api/user/login".equals(path) || "/api/user/register".equals(path)) {
            return true;
        }
        if ("GET".equalsIgnoreCase(method)) {
            return path.startsWith("/api/items") || path.startsWith("/api/stats");
        }
        return false;
    }
}
