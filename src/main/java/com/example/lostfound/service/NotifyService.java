package com.example.lostfound.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.example.lostfound.common.BizException;
import com.example.lostfound.entity.Notification;
import com.example.lostfound.mapper.NotificationMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 站内定向通知（E3）：只在当事用户之间投递，不做全站广播。
 */
@Service
@RequiredArgsConstructor
public class NotifyService {

    private final NotificationMapper notificationMapper;

    public void notifyUser(Long userId, Long itemId, String content) {
        Notification n = new Notification();
        n.setUserId(userId);
        n.setItemId(itemId);
        n.setContent(content);
        n.setIsRead(0);
        n.setCreateTime(LocalDateTime.now());
        notificationMapper.insert(n);
    }

    /** 当前用户的通知列表（按用户隔离） */
    public List<Notification> listMine(Long userId) {
        return notificationMapper.selectList(new LambdaQueryWrapper<Notification>()
                .eq(Notification::getUserId, userId)
                .orderByDesc(Notification::getCreateTime));
    }

    public long unreadCount(Long userId) {
        Long c = notificationMapper.selectCount(new LambdaQueryWrapper<Notification>()
                .eq(Notification::getUserId, userId)
                .eq(Notification::getIsRead, 0));
        return c == null ? 0 : c;
    }

    /** 标记已读（只能读自己的） */
    public void markRead(Long userId, Long id) {
        int rows = notificationMapper.update(null, new LambdaUpdateWrapper<Notification>()
                .eq(Notification::getId, id)
                .eq(Notification::getUserId, userId)
                .eq(Notification::getIsRead, 0)
                .set(Notification::getIsRead, 1));
        if (rows == 0) {
            throw BizException.notFound("通知不存在或已读");
        }
    }

    public void markAllRead(Long userId) {
        notificationMapper.update(null, new LambdaUpdateWrapper<Notification>()
                .eq(Notification::getUserId, userId)
                .eq(Notification::getIsRead, 0)
                .set(Notification::getIsRead, 1));
    }
}
