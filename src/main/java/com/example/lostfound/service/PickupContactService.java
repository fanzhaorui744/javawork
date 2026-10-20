package com.example.lostfound.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.lostfound.common.BizException;
import com.example.lostfound.entity.*;
import com.example.lostfound.mapper.ClaimApplicationMapper;
import com.example.lostfound.mapper.ItemInfoMapper;
import com.example.lostfound.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 拾取者联系与致谢（F9「感谢接力」）。
 *
 * 业务背景：
 *   失主丢了东西，最想知道的是「谁捡到了、怎么联系上」。
 *   本服务把「招领信息（FOUND）」与「寻物信息（LOST）」按物品特征自动匹配，
 *   匹配成功且认领确认后，向失主开放拾取者的联系方式与致谢入口。
 *
 * 隐私边界（重要）：
 *   - 联系方式只在「认领已确认」后才返回，未确认一律打码；
 *   - 只有失主本人（该认领申请的发起人）能看到，其他人看不到；
 *   - 致谢只能由失主发起一次。
 */
@Service
@RequiredArgsConstructor
public class PickupContactService {

    private final ItemInfoMapper itemMapper;
    private final ClaimApplicationMapper claimMapper;
    private final UserMapper userMapper;

    /**
     * 为一条「寻物」信息寻找可能匹配的「招领」信息。
     *
     * 匹配打分（总分 100）：
     *   物品名称完全一致        +55
     *   名称互相包含 / 高度相似  +35
     *   同一类别                +20
     *   地点相同或相邻          +15
     *   时间接近（3 天内）      +10
     */
    public List<Map<String, Object>> matchForLostItem(Long lostItemId) {
        ItemInfo lost = requireItem(lostItemId);
        if (!ItemType.LOST.name().equals(lost.getType())) {
            throw BizException.badRequest("只有寻物信息可以查找匹配的招领");
        }

        List<ItemInfo> candidates = itemMapper.selectList(new LambdaQueryWrapper<ItemInfo>()
                .eq(ItemInfo::getType, ItemType.FOUND.name())
                .eq(ItemInfo::getHidden, 0)
                .ne(ItemInfo::getStatus, ItemStatus.CLOSED.name()));

        List<Map<String, Object>> out = new ArrayList<>();
        for (ItemInfo found : candidates) {
            int score = score(lost, found);
            if (score < 40) {
                continue;
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("item", found);
            m.put("score", score);
            m.put("publisher", publisherBrief(found.getPublisherId(), false));
            /* 未确认前只给昵称与脱敏联系方式，确认后由 contact 接口给全量 */
            m.put("reasons", reasons(lost, found));
            out.add(m);
        }
        out.sort((a, b) -> (int) b.get("score") - (int) a.get("score"));
        return out;
    }

    /**
     * 失主查看拾取者联系方式。
     *
     * 放行条件（三个都要满足）：
     *   1. 调用者是该「寻物」信息的发布者（失主）；
     *   2. 存在一条针对该寻物信息的、状态为 APPROVED 的认领申请……
     *      —— 实际链路里，认领申请是挂在「招领」信息上的，失主认领的是 FOUND 物品，
     *         所以这里按 itemId 找到已确认的认领，再取该招领信息的发布者（拾取者）。
     */
    public Map<String, Object> pickupContact(Long claimId, User viewer) {
        ClaimApplication claim = claimMapper.selectById(claimId);
        if (claim == null) {
            throw BizException.notFound("认领记录不存在");
        }
        ItemInfo item = requireItem(claim.getItemId());

        boolean isApplicant = claim.getApplicantId().equals(viewer.getId());
        boolean isAdmin = UserRole.ADMIN.name().equals(viewer.getRole());
        if (!isApplicant && !isAdmin) {
            throw BizException.forbidden("无权限：仅认领申请人本人可查看拾取者联系方式");
        }
        if (!ClaimStatus.APPROVED.name().equals(claim.getStatus())) {
            throw BizException.conflict("认领尚未确认，暂不能查看拾取者联系方式");
        }

        User picker = userMapper.selectById(item.getPublisherId());
        if (picker == null) {
            throw BizException.notFound("拾取者账号不存在");
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("claimId", claim.getId());
        data.put("itemId", item.getId());
        data.put("itemName", item.getName());
        data.put("pickerId", picker.getId());
        data.put("pickerNickname", picker.getNickname());
        data.put("pickerContact", picker.getContact());
        data.put("itemContact", item.getContact());
        data.put("pickedLocation", item.getLocation());
        data.put("pickedTime", item.getEventTime());
        data.put("handleNote", claim.getHandleNote());
        data.put("handleTime", claim.getHandleTime());
        data.put("thanked", claim.getThanked() == null ? 0 : claim.getThanked());
        data.put("thankNote", claim.getThankNote());
        data.put("thankTime", claim.getThankTime());
        return data;
    }

    /** 失主向拾取者致谢（一次） */
    @Transactional
    public ClaimApplication thank(Long claimId, User viewer, String note) {
        ClaimApplication claim = claimMapper.selectById(claimId);
        if (claim == null) {
            throw BizException.notFound("认领记录不存在");
        }
        if (!claim.getApplicantId().equals(viewer.getId())) {
            throw BizException.forbidden("无权限：仅认领申请人本人可致谢");
        }
        if (!ClaimStatus.APPROVED.name().equals(claim.getStatus())) {
            throw BizException.conflict("认领尚未确认，暂不能致谢");
        }
        if (claim.getThanked() != null && claim.getThanked() == 1) {
            throw BizException.conflict("已经致谢过了，感谢你的善意");
        }
        claim.setThanked(1);
        claim.setThankNote(note == null || note.isBlank() ? "谢谢你帮我找回失物！" : note.trim());
        claim.setThankTime(LocalDateTime.now());
        claimMapper.updateById(claim);
        return claim;
    }

    /** 某条信息收到的全部认领中，已确认的那条（供详情页展示「谁捡到了」） */
    public Map<String, Object> approvedClaimOf(Long foundItemId, User viewer) {
        ClaimApplication claim = claimMapper.selectOne(new LambdaQueryWrapper<ClaimApplication>()
                .eq(ClaimApplication::getItemId, foundItemId)
                .eq(ClaimApplication::getStatus, ClaimStatus.APPROVED.name())
                .last("LIMIT 1"));
        if (claim == null) {
            return null;
        }
        // 隐私边界：只有该招领信息的发布者（拾取者）本人才能看到认领人信息；
        // 其他人一律按“未确认”处理，返回 null，由前端继续走无卡片分支。
        ItemInfo item = itemMapper.selectById(foundItemId);
        if (item == null || viewer == null
                || !viewer.getId().equals(item.getPublisherId())) {
            return null;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("claim", claim);
        m.put("applicant", publisherBrief(claim.getApplicantId(), true));
        return m;
    }

    // ------------------------------------------------------------------ 内部

    /** 对外的用户简介；withContact=false 时联系方式打码 */
    private Map<String, Object> publisherBrief(Long userId, boolean withContact) {
        User u = userMapper.selectById(userId);
        Map<String, Object> m = new LinkedHashMap<>();
        if (u == null) {
            m.put("id", userId);
            m.put("nickname", "未知用户");
            m.put("contact", null);
            return m;
        }
        m.put("id", u.getId());
        m.put("nickname", u.getNickname());
        m.put("contact", withContact ? u.getContact() : mask(u.getContact()));
        return m;
    }

    /** 联系方式脱敏：13812345678 -> 138****5678 */
    static String mask(String contact) {
        if (contact == null || contact.isBlank()) {
            return null;
        }
        String s = contact.trim();
        if (s.length() <= 4) {
            return "****";
        }
        if (s.length() <= 8) {
            return s.charAt(0) + "****" + s.charAt(s.length() - 1);
        }
        return s.substring(0, 3) + "****" + s.substring(s.length() - 4);
    }

    private int score(ItemInfo lost, ItemInfo found) {
        int s = 0;
        String a = normalize(lost.getName());
        String b = normalize(found.getName());
        if (!a.isEmpty() && a.equals(b)) {
            s += 55;
        } else if (!a.isEmpty() && !b.isEmpty()
                && (a.contains(b) || b.contains(a))) {
            s += 35;
        } else if (similar(a, b) >= 0.5) {
            s += 25;
        }
        if (lost.getCategory() != null && lost.getCategory().equals(found.getCategory())) {
            s += 20;
        }
        if (lost.getLocation() != null && lost.getLocation().equals(found.getLocation())) {
            s += 15;
        }
        if (lost.getEventTime() != null && found.getEventTime() != null) {
            long days = Math.abs(java.time.Duration.between(
                    lost.getEventTime(), found.getEventTime()).toDays());
            if (days <= 3) {
                s += 10;
            }
        }
        return Math.min(s, 100);
    }

    private List<String> reasons(ItemInfo lost, ItemInfo found) {
        List<String> r = new ArrayList<>();
        String a = normalize(lost.getName());
        String b = normalize(found.getName());
        if (!a.isEmpty() && a.equals(b)) {
            r.add("物品名称完全一致");
        } else if (!a.isEmpty() && !b.isEmpty() && (a.contains(b) || b.contains(a))) {
            r.add("物品名称高度相近");
        }
        if (lost.getCategory() != null && lost.getCategory().equals(found.getCategory())) {
            r.add("属于同一类别");
        }
        if (lost.getLocation() != null && lost.getLocation().equals(found.getLocation())) {
            r.add("地点相同");
        }
        if (lost.getEventTime() != null && found.getEventTime() != null
                && Math.abs(java.time.Duration.between(lost.getEventTime(), found.getEventTime())
                .toDays()) <= 3) {
            r.add("时间接近");
        }
        if (r.isEmpty()) {
            r.add("特征部分吻合");
        }
        return r;
    }

    private String normalize(String s) {
        if (s == null) {
            return "";
        }
        return s.replaceAll("[\\s（）()【】\\[\\]·、,，.。-]", "").toLowerCase();
    }

    /** 粗糙相似度：公共字符数 / 较长串长度 */
    private double similar(String a, String b) {
        if (a.isEmpty() || b.isEmpty()) {
            return 0;
        }
        int hit = 0;
        boolean[] used = new boolean[b.length()];
        for (int i = 0; i < a.length(); i++) {
            for (int j = 0; j < b.length(); j++) {
                if (!used[j] && a.charAt(i) == b.charAt(j)) {
                    used[j] = true;
                    hit++;
                    break;
                }
            }
        }
        return hit / (double) Math.max(a.length(), b.length());
    }

    private ItemInfo requireItem(Long id) {
        ItemInfo item = itemMapper.selectById(id);
        if (item == null) {
            throw BizException.notFound("信息不存在");
        }
        return item;
    }
}
