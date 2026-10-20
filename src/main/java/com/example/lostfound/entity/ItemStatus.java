package com.example.lostfound.entity;

import com.example.lostfound.common.BizException;

import java.util.EnumMap;
import java.util.Map;
import java.util.Set;

/**
 * 物品状态机（F5）：全部状态变更必须经 transition() 入口校验。
 * 合法路径与 SRS 图 3-2 一一对应：
 * 待认领 → 认领处理中（提交申请）
 * 待认领 → 已关闭（本人撤回）
 * 认领处理中 → 已归还/已解决（确认）
 * 认领处理中 → 待认领（拒绝）
 * 已归还/已解决 → 已关闭（管理员归档）
 */
public enum ItemStatus {

    PENDING("待认领"),
    CLAIMING("认领处理中"),
    RESOLVED("已归还/已解决"),
    CLOSED("已关闭");

    private final String label;

    ItemStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    private static final Map<ItemStatus, Set<ItemStatus>> TRANSITIONS = new EnumMap<>(ItemStatus.class);

    static {
        TRANSITIONS.put(PENDING, Set.of(CLAIMING, CLOSED));
        TRANSITIONS.put(CLAIMING, Set.of(RESOLVED, PENDING));
        TRANSITIONS.put(RESOLVED, Set.of(CLOSED));
        TRANSITIONS.put(CLOSED, Set.of());
    }

    /**
     * 状态流转统一入口。非法跳转抛业务异常并给出原因。
     */
    public static ItemStatus transition(ItemStatus from, ItemStatus to) {
        Set<ItemStatus> allowed = TRANSITIONS.get(from);
        if (allowed == null || !allowed.contains(to)) {
            throw BizException.badRequest("状态变更非法：不允许从「" + from.label + "」变更为「" + to.label + "」");
        }
        return to;
    }
}
