package com.example.lostfound;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.example.lostfound.mapper")
public class LostfoundApplication {

    public static void main(String[] args) {
        SpringApplication.run(LostfoundApplication.class, args);
    }
}
