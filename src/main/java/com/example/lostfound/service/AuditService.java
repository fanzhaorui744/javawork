package com.example.lostfound.service;

import com.example.lostfound.entity.AuditRecord;
import com.example.lostfound.mapper.AuditRecordMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 管理处理记录（F6）：审核、隐藏、删除、归档、认领处理全部留痕。
 */
@Service
@RequiredArgsConstructor
public class AuditService {

    private final AuditRecordMapper auditRecordMapper;

    public void record(Long operatorId, String action, Long targetId, String detail) {
        AuditRecord r = new AuditRecord();
        r.setAdminId(operatorId);
        r.setAction(action);
        r.setTargetId(targetId);
        r.setDetail(detail);
        r.setCreateTime(LocalDateTime.now());
        auditRecordMapper.insert(r);
    }
}
