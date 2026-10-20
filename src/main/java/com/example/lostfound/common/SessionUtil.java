package com.example.lostfound.common;

import com.example.lostfound.entity.User;
import jakarta.servlet.http.HttpSession;

/**
 * 登录态工具：登录成功后 User 存入 HttpSession。
 */
public final class SessionUtil {

    public static final String LOGIN_USER = "LOGIN_USER";

    private SessionUtil() {
    }

    public static void login(HttpSession session, User user) {
        session.setAttribute(LOGIN_USER, user);
    }

    public static void logout(HttpSession session) {
        if (session != null) {
            session.invalidate();
        }
    }

    /** 未登录返回 null，由拦截器保证业务接口必登录 */
    public static User currentUser(HttpSession session) {
        if (session == null) {
            return null;
        }
        Object u = session.getAttribute(LOGIN_USER);
        return u instanceof User user ? user : null;
    }

    public static Long currentUserId(HttpSession session) {
        User u = currentUser(session);
        return u == null ? null : u.getId();
    }

    public static boolean isAdmin(HttpSession session) {
        User u = currentUser(session);
        return u != null && "ADMIN".equals(u.getRole());
    }
}
