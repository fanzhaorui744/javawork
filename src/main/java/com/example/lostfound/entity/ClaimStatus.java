package com.example.lostfound.entity;

public enum ClaimStatus {
    PENDING("处理中"),
    APPROVED("已确认"),
    REJECTED("已拒绝"),
    MORE_INFO("要求补充");

    private final String label;

    ClaimStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
