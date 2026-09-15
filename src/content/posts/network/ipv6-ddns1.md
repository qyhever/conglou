---
pubDatetime: 2026-07-23T15:22:00Z
title: IPv6 + DDNS 将内网服务暴露到公网
slug: ipv6-ddns1
featured: true
tags:
  - Network
description: ""
---

入手了一台磊科 N60pro 路由器，已刷机，并外接了 128G 硬盘，打算在上面跑几个小服务，然后可以通过公网访问，折腾了下 IPv6 + DDNS 这条路。

## 路由器 ImmortalWrt 信息
固件版本: ImmortalWrt 24.10  
内核版本: 6.6.133  

## 获取 ImmortalWrt IPv6 地址
从 状态 - 概览 - IPv6上游信息 - 地址 可查看

或者从 网络 - 接口 - wan6 - IPv6 可查看

使用地址长的那个，/64结尾的

复制 IPv6 地址 到 https://www.itdog.cn/ping_ipv6/ 测试下能否 ping 通

不能 ping 通，登录光猫管理面板查看防火墙设置，关闭 IPv6 防火墙，后面就使用 ImmortalWrt 防火墙即可

## 端口转发
目前 80 443等常见端口被运营商封禁，无法直接从公网访问，路由器的管理地址默认就是 80 端口， 如: http://192.168.5.1，可以直接修改管理地址的监听端口，也可以使用端口转发。

使用端口转发

网络 - 防火墙 - 端口转发 - 添加

添加页面：
名称：随便输入名称  
地址族限制：仅 IPv6  
协议：只勾选 TCP  
源区域：使用默认的 wan  
外部端口：5300(65535以内即可)  
目标区域：选择 未指定  
内部 IP 地址：保持默认 任意  
内部端口：80  

保存并应用

现在所有从公网发到 5300 端口的数据都会转发给路由器的 80 端口

使用手机流量访问之前获取的 IPv6 地址，http://[IPv6 地址]:5300，可以访问路由器管理地址

## DDNS
运营商分配的 IPv6 地址并不是固定的，会定期更换，这时候需要用到动态 DNS，定期检测 IP 变化，自动将更换后的 IP 地址解析到配置的域名。所以配置好后，直接访问 http://域名:5300 即可。

首先需要一个域名，如：example.com 托管到了 Cloudflare。

### 安装插件

系统 - 软件包 - 点击更新列表

过滤器输入 ddns，下方列表选择 luci-i18n-ddns-go-zh-cn 安装

安装完成刷新网页，服务 - DDNS-Go - 打开 Web 页面

首次进入，输入即可设置账号密码，点击登录进入配置页

做如下设置：
DNS服务商：选择 Cloudflare  
Token：API令牌  
IPv4 - 是否启用：取消勾选  
IPv6 - 获取 IP 方式：选择 wan 或者是 eth  
IPv6 - Domains：输入 example.com 的多级域名，例如 op.example.com  

点击保存

在 Cloudflare example.com dns解析记录中可以看到生成了一条 IPv6 的解析记录

使用手机流量访问 http://op.example.com:5300，可以访问路由器管理地址  

在内网无法访问 http://op.example.com:5300 是正常的，这个是公网的规则。内网属于 lan 区域，没有 5300 的端口转发规则，内网可以访问 http://op.example.com:80。如果内网也需要可以访问 5300 端口，需要再添加 端口转发规则。

Cloudflare API令牌创建：
我的个人资料 - API令牌 - 创建令牌 - 编辑区域DNS使用模板
区域资源选择 example.com，其它都不变，点击继续 - 创建令牌，复制令牌并妥善保管，后面再次进入无法查看。

## TLS 证书
目前访问 http://op.example.com:80 输入账号密码登录，是明文传输，网络链条上都可以看到传输信息，需要配置 https 加密传输。

### 修改转发规则
将之前的端口转发规则 5300 -> 80，更改为 5300 -> 443。

### 安装插件
系统 - 软件包 - 安装 luci-i18n-uhttpd-zh-cn luci-app-acme acme-acmesh-dnsapi 插件

刷新页面

### 生成证书
服务 - ACME证书

输入邮箱地址，删除两个默认的证书配置项

输入 openwrt 点击添加
做如下设置：
已启用：勾选  
域名：op.example.com  
验证方式：选择 DNS  
DNS API：选择 Cloudflare.com  
CF Token：之前创建的 API 令牌  
CF Zone ID：CF 域名面板获取  

获取 CF Zone ID：进入 example.com 域名面板，最下面可以看到 Zone ID

点击保存，现在 acme 插件开始申请 CA 证书了

### 使用证书
等待几分钟，进入 服务 - uHTTPd

HTTPS监听输入：0.0.0.0:443 [::]:443  
HTTPS证书选择：/etc/acme/op.example.com/fullchain.cer  
HTTPS私钥选择：/etc/acme/op.example.com/op.example.com.key  

点击保存并应用

使用手机流量访问 https://op.example.com:5300，可以访问路由器管理地址 
