package com.example.lostfound.controller;

import com.example.lostfound.common.Result;
import com.example.lostfound.common.SessionUtil;
import com.example.lostfound.dto.HandleRequest;
import com.example.lostfound.entity.ClaimApplication;
import com.example.lostfound.entity.User;
import com.example.lostfound.service.PickupContactService;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * F9「感谢接力」：失主确认认领后，可以看到拾取者是谁、怎么联系。
 */
@RestController
@RequestMapping("/api/pickup")
@RequiredArgsConstructor
public class PickupContactController {

    private final PickupContactService pickupService;

    /** 为一条寻物信息查找可能匹配的招领信息（含匹配度与拾取者昵称） */
    @GetMapping("/match/{lostItemId}")
    public Result<List<Map<String, Object>>> match(@PathVariable Long lostItemId, HttpSession session) {
        SessionUtil.currentUser(session);
        return Result.ok(pickupService.matchForLostItem(lostItemId));
    }

    /** 查看拾取者联系方式（仅认领已确认的申请人可见） */
    @GetMapping("/contact/{claimId}")
    public Result<Map<String, Object>> contact(@PathVariable Long claimId, HttpSession session) {
        User u = SessionUtil.currentUser(session);
        return Result.ok(pickupService.pickupContact(claimId, u));
    }

    /** 向拾取者致谢 */
    @PostMapping("/thank/{claimId}")
    public Result<ClaimApplication> thank(@PathVariable Long claimId,
                                          @RequestBody(required = false) HandleRequest req,
                                          HttpSession session) {
        User u = SessionUtil.currentUser(session);
        return Result.ok(pickupService.thank(claimId, u, req == null ? null : req.getNote()));
    }

    /** 某条招领信息已被谁认领（详情页用） */
    @GetMapping("/approved/{foundItemId}")
    public Result<Map<String, Object>> approved(@PathVariable Long foundItemId, HttpSession session) {
        User u = SessionUtil.currentUser(session);
        return Result.ok(pickupService.approvedClaimOf(foundItemId, u));
    }
}
