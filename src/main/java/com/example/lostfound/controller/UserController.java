package com.example.lostfound.controller;

import com.example.lostfound.common.Result;
import com.example.lostfound.common.SessionUtil;
import com.example.lostfound.dto.LoginRequest;
import com.example.lostfound.dto.ProfileUpdateRequest;
import com.example.lostfound.dto.RegisterRequest;
import com.example.lostfound.entity.User;
import com.example.lostfound.service.UserService;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/user")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @PostMapping("/register")
    public Result<User> register(@Valid @RequestBody RegisterRequest req) {
        return Result.ok(userService.register(req));
    }

    @PostMapping("/login")
    public Result<User> login(@Valid @RequestBody LoginRequest req, HttpSession session) {
        User u = userService.login(req);
        SessionUtil.login(session, u);
        return Result.ok(u);
    }

    @PostMapping("/logout")
    public Result<Void> logout(HttpSession session) {
        SessionUtil.logout(session);
        return Result.ok();
    }

    @GetMapping("/profile")
    public Result<User> profile(HttpSession session) {
        return Result.ok(SessionUtil.currentUser(session));
    }

    @PutMapping("/profile")
    public Result<User> updateProfile(@Valid @RequestBody ProfileUpdateRequest req, HttpSession session) {
        User u = SessionUtil.currentUser(session);
        return Result.ok(userService.updateProfile(u.getId(), req));
    }
}
