package com.example.lostfound.entity;

public enum UserRole {
    USER("普通用户"),
    ADMIN("管理员");

    private final String label;

    UserRole(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
