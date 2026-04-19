package com.example;

public class User<T extends Comparable<T>> {
    private String name;
    private T id;

    public String getName() { return name; }
}
