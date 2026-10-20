package com.example.lostfound.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.lostfound.common.BizException;
import com.example.lostfound.dto.LoginRequest;
import com.example.lostfound.dto.ProfileUpdateRequest;
import com.example.lostfound.dto.RegisterRequest;
import com.example.lostfound.entity.User;
import com.example.lostfound.entity.UserRole;
import com.example.lostfound.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserMapper userMapper;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public User register(RegisterRequest req) {
        Long exists = userMapper.selectCount(new LambdaQueryWrapper<User>().eq(User::getUsername, req.getUsername()));
        if (exists != null && exists > 0) {
            throw BizException.conflict("用户名「" + req.getUsername() + "」已被注册");
        }
        User u = new User();
        u.setUsername(req.getUsername());
        u.setPasswordHash(encoder.encode(req.getPassword()));
        u.setRole(UserRole.USER.name());
        u.setNickname(req.getNickname());
        u.setContact(req.getContact());
        u.setCreateTime(LocalDateTime.now());
        userMapper.insert(u);
        u.setPasswordHash(null);
        return u;
    }

    public User login(LoginRequest req) {
        User u = userMapper.selectOne(new LambdaQueryWrapper<User>().eq(User::getUsername, req.getUsername()));
        if (u == null || !encoder.matches(req.getPassword(), u.getPasswordHash())) {
            throw new BizException(400, "用户名或密码错误");
        }
        u.setPasswordHash(null);
        return u;
    }

    public User getById(Long id) {
        User u = userMapper.selectById(id);
        if (u == null) {
            throw BizException.notFound("用户不存在");
        }
        u.setPasswordHash(null);
        return u;
    }

    public User updateProfile(Long userId, ProfileUpdateRequest req) {
        User u = userMapper.selectById(userId);
        if (u == null) {
            throw BizException.notFound("用户不存在");
        }
        u.setNickname(req.getNickname());
        u.setContact(req.getContact());
        userMapper.updateById(u);
        u.setPasswordHash(null);
        return u;
    }
}
