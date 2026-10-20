package com.example.lostfound.entity;

public enum ItemType {
    LOST("寻物"),
    FOUND("招领");

    private final String label;

    ItemType(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
