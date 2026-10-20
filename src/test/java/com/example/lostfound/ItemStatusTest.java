package com.example.lostfound;

import com.example.lostfound.common.BizException;
import com.example.lostfound.entity.ItemStatus;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * F5 状态流转单元测试：SRS 图 3-2 五条合法路径全部覆盖，非法跳转全部拒绝。
 */
class ItemStatusTest {

    @Test
    void legalTransitions_allPass() {
        // 路径 1：待认领 → 认领处理中
        assertEquals(ItemStatus.CLAIMING, ItemStatus.transition(ItemStatus.PENDING, ItemStatus.CLAIMING));
        // 路径 2：认领处理中 → 已归还/已解决
        assertEquals(ItemStatus.RESOLVED, ItemStatus.transition(ItemStatus.CLAIMING, ItemStatus.RESOLVED));
        // 路径 3：认领处理中 → 待认领（拒绝后重新开放）
        assertEquals(ItemStatus.PENDING, ItemStatus.transition(ItemStatus.CLAIMING, ItemStatus.PENDING));
        // 路径 4：待认领 → 已关闭（本人撤回）
        assertEquals(ItemStatus.CLOSED, ItemStatus.transition(ItemStatus.PENDING, ItemStatus.CLOSED));
        // 路径 5：已归还/已解决 → 已关闭（管理员归档）
        assertEquals(ItemStatus.CLOSED, ItemStatus.transition(ItemStatus.RESOLVED, ItemStatus.CLOSED));
    }

    @Test
    void illegalTransition_pendingToResolved_rejected() {
        BizException e = assertThrows(BizException.class,
                () -> ItemStatus.transition(ItemStatus.PENDING, ItemStatus.RESOLVED));
        assertEquals(400, e.getCode());
        assertEquals("状态变更非法：不允许从「待认领」变更为「已归还/已解决」", e.getMessage());
    }

    @Test
    void illegalTransition_claimingToClosed_rejected() {
        assertThrows(BizException.class, () -> ItemStatus.transition(ItemStatus.CLAIMING, ItemStatus.CLOSED));
    }

    @Test
    void illegalTransition_resolvedBackToPending_rejected() {
        assertThrows(BizException.class, () -> ItemStatus.transition(ItemStatus.RESOLVED, ItemStatus.PENDING));
    }

    @Test
    void illegalTransition_closedIsTerminal() {
        for (ItemStatus to : ItemStatus.values()) {
            assertThrows(BizException.class, () -> ItemStatus.transition(ItemStatus.CLOSED, to));
        }
    }

    @Test
    void illegalTransition_selfLoop_rejected() {
        assertThrows(BizException.class, () -> ItemStatus.transition(ItemStatus.PENDING, ItemStatus.PENDING));
    }
}
