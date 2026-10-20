package com.example.lostfound.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.lostfound.common.BizException;
import com.example.lostfound.entity.*;
import com.example.lostfound.mapper.ClaimApplicationMapper;
import com.example.lostfound.mapper.ItemInfoMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 认领申请（F4）+ 状态流转（F5）。确认/拒绝/要求补充均驱动物品状态机，并写入通知与处理记录。
 */
@Service
@RequiredArgsConstructor
public class ClaimService {

    private final ClaimApplicationMapper claimMapper;
    private final ItemInfoMapper itemMapper;
    private final NotifyService notifyService;
    private final AuditService auditService;
    private final UserService userService;

    /** 提交认领申请：状态 待认领→认领处理中，并通知发布者 */
    @Transactional
    public ClaimApplication create(User applicant, Long itemId, String description) {
        ItemInfo item = getItem(itemId);
        if (item.getHidden() == 1) {
            throw BizException.notFound("信息不存在或已被管理员隐藏");
        }
        if (item.getPublisherId().equals(applicant.getId())) {
            throw BizException.badRequest("不能认领自己发布的信息");
        }
        Long dup = claimMapper.selectCount(new LambdaQueryWrapper<ClaimApplication>()
                .eq(ClaimApplication::getItemId, itemId)
                .eq(ClaimApplication::getApplicantId, applicant.getId())
                .eq(ClaimApplication::getStatus, ClaimStatus.PENDING.name()));
        if (dup != null && dup > 0) {
            throw BizException.conflict("您已提交过该物品的认领申请，正在处理中，请勿重复提交");
        }
        if (!ItemStatus.PENDING.name().equals(item.getStatus())) {
            throw BizException.conflict("该信息当前状态为「" + ItemStatus.valueOf(item.getStatus()).getLabel()
                    + "」，暂不能提交认领申请");
        }

        ClaimApplication claim = new ClaimApplication();
        claim.setItemId(itemId);
        claim.setApplicantId(applicant.getId());
        claim.setDescription(description);
        claim.setStatus(ClaimStatus.PENDING.name());
        claim.setCreateTime(LocalDateTime.now());
        claimMapper.insert(claim);

        ItemStatus.transition(ItemStatus.PENDING, ItemStatus.CLAIMING);
        item.setStatus(ItemStatus.CLAIMING.name());
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.updateById(item);

        notifyService.notifyUser(item.getPublisherId(), itemId,
                "您发布的「" + item.getName() + "」收到一条认领申请，请及时处理。");
        auditService.record(applicant.getId(), "提交认领申请", itemId,
                "认领申请 #" + claim.getId() + "：" + abbrev(description));
        return claim;
    }

    /** 处理申请（发布者或管理员）：确认 / 拒绝 / 要求补充 */
    @Transactional
    public ClaimApplication handle(User operator, Long claimId, String action, String note) {
        ClaimApplication claim = claimMapper.selectById(claimId);
        if (claim == null) {
            throw BizException.notFound("认领申请不存在");
        }
        if (!ClaimStatus.PENDING.name().equals(claim.getStatus())) {
            throw BizException.conflict("该申请已被处理，请勿重复操作");
        }
        ItemInfo item = getItem(claim.getItemId());
        boolean isPublisher = item.getPublisherId().equals(operator.getId());
        boolean isAdmin = UserRole.ADMIN.name().equals(operator.getRole());
        if (!isPublisher && !isAdmin) {
            throw BizException.forbidden("无权限：仅发布者或管理员可处理认领申请");
        }
        if (!ItemStatus.CLAIMING.name().equals(item.getStatus())) {
            throw BizException.conflict("物品当前状态不允许处理认领申请");
        }

        ItemStatus from = ItemStatus.valueOf(item.getStatus());
        String actionLabel;
        switch (action) {
            case "approve" -> {
                ItemStatus.transition(from, ItemStatus.RESOLVED);
                item.setStatus(ItemStatus.RESOLVED.name());
                claim.setStatus(ClaimStatus.APPROVED.name());
                actionLabel = "认领确认";
                notifyService.notifyUser(claim.getApplicantId(), item.getId(),
                        "您对「" + item.getName() + "」的认领申请已被确认，物品状态更新为「已归还/已解决」。");
            }
            case "reject" -> {
                ItemStatus.transition(from, ItemStatus.PENDING);
                item.setStatus(ItemStatus.PENDING.name());
                claim.setStatus(ClaimStatus.REJECTED.name());
                actionLabel = "认领拒绝";
                notifyService.notifyUser(claim.getApplicantId(), item.getId(),
                        "您对「" + item.getName() + "」的认领申请未被采纳，该信息已重新开放认领。");
            }
            case "request-more" -> {
                // 状态保持「认领处理中」
                claim.setStatus(ClaimStatus.MORE_INFO.name());
                actionLabel = "要求补充";
                notifyService.notifyUser(claim.getApplicantId(), item.getId(),
                        "发布者对「" + item.getName() + "」的认领申请要求补充信息，请完善认领说明后联系对方。");
            }
            default -> throw BizException.badRequest("非法的处理动作：" + action);
        }
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.updateById(item);

        claim.setHandlerId(operator.getId());
        claim.setHandleNote(note);
        claim.setHandleTime(LocalDateTime.now());
        claimMapper.updateById(claim);

        auditService.record(operator.getId(), actionLabel, item.getId(),
                "申请 #" + claim.getId() + (note == null || note.isBlank() ? "" : "，意见：" + abbrev(note)));
        return claim;
    }

    /** 我发起的申请 */
    public List<ClaimApplication> myClaims(Long userId) {
        return claimMapper.selectList(new LambdaQueryWrapper<ClaimApplication>()
                .eq(ClaimApplication::getApplicantId, userId)
                .orderByDesc(ClaimApplication::getCreateTime));
    }

    /** 发给我的（针对我发布信息的）待处理申请 */
    public List<ClaimApplication> claimsForMyItems(Long userId) {
        List<Long> myItemIds = itemMapper.selectList(new LambdaQueryWrapper<ItemInfo>()
                        .eq(ItemInfo::getPublisherId, userId))
                .stream().map(ItemInfo::getId).toList();
        if (myItemIds.isEmpty()) {
            return List.of();
        }
        return claimMapper.selectList(new LambdaQueryWrapper<ClaimApplication>()
                .in(ClaimApplication::getItemId, myItemIds)
                .orderByDesc(ClaimApplication::getCreateTime));
    }

    public ClaimApplication getRaw(Long claimId) {
        return claimMapper.selectById(claimId);
    }

    private ItemInfo getItem(Long itemId) {
        ItemInfo item = itemMapper.selectById(itemId);
        if (item == null) {
            throw BizException.notFound("信息不存在");
        }
        return item;
    }

    private String abbrev(String s) {
        if (s == null) {
            return "";
        }
        return s.length() <= 50 ? s : s.substring(0, 50) + "…";
    }

    /** 脱敏展示用：申请人昵称 */
    public String applicantNickname(ClaimApplication claim) {
        return userService.getById(claim.getApplicantId()).getNickname();
    }
}
