---
pubDatetime: 2026-05-19T15:22:00Z
title: curl 使用介绍
slug: curl
tags:
  - API
  - Tools
  - CURL/Client URL
description: ""
---

`curl`（Client URL）是一个**命令行网络请求工具**，用于从服务器传输或向服务器发送数据，最常用于：

* 测试 HTTP / HTTPS 接口
* 调用 REST API
* 下载文件
* 上传文件
* 查看 HTTP 请求头
* 调试网络连接
* 测试服务器状态

它支持 HTTP、HTTPS、FTP、SFTP、SMTP、WebSocket 等多种协议。

我最常用的场景是，服务器部署了一个后端服务，这个后端服务外部不能直接访问，是通过 nginx 代理访问的，如果不能访问，先在服务器 curl 测试下本机后端服务能否正常访问再确定后续问题。

Docker 容器服务也是如此，发现外部访问异常，先在容器内部使用 curl 测试下容器内部能否访问正常。

---

## 1. 基本语法

```bash
curl [参数] URL
```

例如：

```bash
curl https://www.baidu.com
```

作用：

* 发送 GET 请求
* 输出服务器返回内容

---

## 2. GET 请求

### 普通 GET

```bash
curl https://api.example.com/users
```

等价：

```http
GET /users HTTP/1.1
```

---

### 显示响应头

```bash
curl -i https://example.com
```

输出：

```
HTTP/2 200
content-type: text/html
server: nginx

<html>
...
```

---

### 只查看响应头

```bash
curl -I https://example.com
```

常用于：

* 查看服务器是否正常
* 查看 CDN
* 查看缓存

例如：

```bash
curl -I https://cdn.example.com/test.jpg
```

返回：

```
HTTP/2 200
content-type: image/jpeg
cache-control: max-age=86400
```

---

## 3. POST 请求

### 普通表单提交

```bash
curl -X POST \
https://api.example.com/login \
-d "username=admin&password=123456"
```

对应：

```http
POST /login

username=admin&password=123456
```

---

### JSON 请求（API 最常用）

```bash
curl -X POST https://api.example.com/users \
-H "Content-Type: application/json" \
-d '{
  "name":"tom",
  "age":18
}'
```

等价：

```http
POST /users

Content-Type: application/json

{
"name":"tom"
}
```

---

## 4. 添加请求 Header

格式：

```bash
-H "Header: value"
```

例如：

### Token认证

```bash
curl https://api.example.com/user \
-H "Authorization: Bearer TOKEN"
```

---

### 自定义 User-Agent

```bash
curl https://example.com \
-H "User-Agent: Mozilla/5.0"
```

模拟浏览器访问。

---

### 多个 Header

```bash
curl https://api.example.com \
-H "Authorization: Bearer xxx" \
-H "Accept: application/json"
```

---

## 5. 下载文件

### 下载并保存原文件名

```bash
curl -O https://example.com/test.zip
```

生成：

```
test.zip
```

---

### 指定文件名

```bash
curl -o demo.zip https://example.com/test.zip
```

保存：

```
demo.zip
```

---

### 断点续传

大文件下载：

```bash
curl -C - -O https://example.com/movie.mp4
```

适合：

* VPS下载
* 视频文件
* ISO镜像

---

## 6. 上传文件

### POST 上传

```bash
curl -X POST \
-F "file=@test.jpg" \
https://example.com/upload
```

等价：

```
multipart/form-data
```

---

### 上传多个文件

```bash
curl \
-F "img=@a.jpg" \
-F "img=@b.jpg" \
https://example.com/upload
```

---

## 7. Cookie 操作

### 发送 Cookie

```bash
curl https://example.com \
-b "session=abc123"
```

---

### 保存 Cookie

```bash
curl \
-c cookie.txt \
https://example.com/login
```

生成：

```
cookie.txt
```

---

### 使用 Cookie 文件

```bash
curl \
-b cookie.txt \
https://example.com/profile
```

常用于：

* 登录测试
* 网站爬取

---

## 8. 调试网络

### 查看完整请求过程

非常重要：

```bash
curl -v https://example.com
```

显示：

```
* DNS解析
* TCP连接
* TLS握手
> GET / HTTP/2
< HTTP/2 200
```

排查：

* DNS问题
* SSL问题
* CDN问题
* 防火墙问题

---

### 更详细日志

```bash
curl --trace trace.txt https://example.com
```

保存：

```
trace.txt
```

---

## 9. HTTPS证书问题

### 忽略SSL证书错误

测试环境常用：

```bash
curl -k https://example.com
```

等价：

```bash
--insecure
```

例如：

自签证书：

```
curl -k https://192.168.1.10
```

---

## 10. 设置超时时间

### 连接超时

```bash
curl \
--connect-timeout 5 \
https://example.com
```

5秒连接失败退出。

---

### 总请求超时

```bash
curl \
--max-time 10 \
https://example.com
```

10秒全部结束。

---

## 11. 跟随 HTTP 重定向

默认：

```
301
302
```

不会继续访问。

开启：

```bash
curl -L https://example.com
```

例如：

```
http://a.com

302

https://a.com
```

---

## 12. 使用代理

### HTTP代理

```bash
curl \
-x http://127.0.0.1:7890 \
https://google.com
```

---

### SOCKS5代理

```bash
curl \
--socks5 127.0.0.1:1080 \
https://google.com
```

适合：

* Clash
* Shadowrocket
* Xray

---

## 13. 查看公网 IP

常用：

```bash
curl https://ipinfo.io
```

返回：

```json
{
 "ip":"1.2.3.4",
 "country":"US"
}
```

或者：

```bash
curl ifconfig.me
```

---

## 14. API测试常用组合

### GET JSON接口

```bash
curl \
-H "Accept: application/json" \
https://api.example.com/users
```

---

### POST JSON

```bash
curl \
-X POST \
-H "Content-Type: application/json" \
-d '{"name":"jack"}' \
https://api.example.com/users
```

---

### PUT

```bash
curl \
-X PUT \
-d '{"name":"new"}' \
https://api.example.com/user/1
```

---

### DELETE

```bash
curl \
-X DELETE \
https://api.example.com/user/1
```

---

## 15. 查看 HTTP 状态码

只输出状态码：

```bash
curl \
-o /dev/null \
-s \
-w "%{http_code}\n" \
https://example.com
```

结果：

```
200
```

常用于脚本：

```bash
if [ $(curl -s -o /dev/null -w "%{http_code}" URL) = "200" ]
then
 echo OK
fi
```

---

## 16. 查看请求耗时

```bash
curl \
-o /dev/null \
-s \
-w "
DNS: %{time_namelookup}
TCP: %{time_connect}
TLS: %{time_appconnect}
Server: %{time_starttransfer}
Total: %{time_total}
" \
https://example.com
```

输出：

```
DNS: 0.02
TCP: 0.05
TLS: 0.10
Server:0.20
Total:0.30
```

非常适合：

* VPS测速
* CDN测速
* 网络排障

---

## 17. curl 常用参数速查

| 参数         | 作用          |
| ---------- | ----------- |
| `-X`       | 指定HTTP方法    |
| `-H`       | 添加Header    |
| `-d`       | POST数据      |
| `-F`       | 文件上传        |
| `-o`       | 输出文件        |
| `-O`       | 保留文件名下载     |
| `-I`       | 只看Header    |
| `-i`       | Header+Body |
| `-v`       | 调试模式        |
| `-L`       | 跟随跳转        |
| `-k`       | 忽略SSL       |
| `-b`       | Cookie      |
| `-c`       | 保存Cookie    |
| `-x`       | HTTP代理      |
| `--socks5` | SOCKS代理     |

---

## 18. 运维场景常用

### 检查网站是否存活

```bash
curl -I https://example.com
```

---

### 检查端口 HTTPS

```bash
curl -vk https://example.com:8443
```

---

### 检查 Cloudflare CDN

```bash
curl -I https://domain.com
```

看：

```
server: cloudflare
cf-cache-status: HIT
```

---

### 测试 VPS 到目标网络

```bash
curl -o /dev/null \
-w "%{speed_download}\n" \
https://speedtest.example.com/file
```

---

## 19. curl 和 wget 区别

|        | curl  | wget  |
| ------ | ----- | ----- |
| API测试  | ⭐⭐⭐⭐⭐ | ⭐     |
| HTTP请求 | 强     | 一般    |
| 下载文件   | 可以    | ⭐⭐⭐⭐⭐ |
| 递归下载网站 | 不适合   | 支持    |
| 上传     | 支持    | 弱     |
| 调试     | 强     | 弱     |

* **调用接口 → curl**
* **下载文件 → wget**
* **网络排障 → curl -v**
