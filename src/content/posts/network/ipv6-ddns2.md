---
pubDatetime: 2026-07-24T15:22:00Z
title: ImmortalWrt 安装 Nginx
slug: wrt-install-nginx
featured: true
tags:
  - Network
description: ""
---


## ImmortalWrt 安装 Nginx
在 ImmortalWrt 里直接通过 opkg 安装。ImmortalWrt 当前软件源提供 nginx-ssl、nginx-full 等包。

直接安装支持 HTTPS 的版本：
```bash
opkg update
opkg install nginx-ssl
```

安装完成后启动并设置开机启动：
```bash
/etc/init.d/nginx start
/etc/init.d/nginx enable
```

检查状态和监听端口：
```bash
/etc/init.d/nginx status

ps | grep nginx

# 查看 nginx 监听端口
ss -lntp | grep nginx
# 或者
netstat -lntp 2>/dev/null | grep nginx
```

安装的 Nginx 启用了 UCI 配置模式  
检查配置文件和重载
```bash
nginx -t -c /etc/nginx/uci.conf
/etc/init.d/nginx reload
```

不要修改 /etc/nginx/uci.conf，该文件由 ImmortalWrt 根据 UCI 配置自动生成，Nginx 重启时可能被覆盖。

配置应按用途修改：
- 全局和默认站点配置：使用 uci set nginx...
- 独立站点配置：修改 /etc/nginx/conf.d/*.conf
- 生成配置的框架模板：/etc/nginx/uci.conf.template，一般不建议修改

## 更换端口
ImmortalWrt 的 LuCI 通常由 uhttpd 提供，因此 80/443 很可能已经被占用。

```bash
netstat -lntp 2>/dev/null | grep 80
netstat -lntp 2>/dev/null | grep 443
```
看到 uhttpd，那么 Nginx 不能再监听 80 443。

需要把 uhttpd 监听端口改成 8080 8443，将 80 443 给 Nginx 使用。

[OpenWrt 官方文档](https://openwrt.org/zh-cn/doc/howto/luci.essentials)也直接给出了 8443 作为 LuCI HTTPS 替代端口的配置方式。

执行：
```bash
# 删除原来的 HTTP 监听
uci -q delete uhttpd.main.listen_http

# 改成 8080，同时支持 IPv4 / IPv6
uci add_list uhttpd.main.listen_http='0.0.0.0:8080'
uci add_list uhttpd.main.listen_http='[::]:8080'

# 删除原来的 HTTPS 监听
uci -q delete uhttpd.main.listen_https

# 改成 8443，同时支持 IPv4 / IPv6
uci add_list uhttpd.main.listen_https='0.0.0.0:8443'
uci add_list uhttpd.main.listen_https='[::]:8443'

uci commit uhttpd
/etc/init.d/uhttpd restart

uci commit uhttpd
/etc/init.d/uhttpd restart
```

检查监听：
```bash
netstat -lntp 2>/dev/null | grep 8080
netstat -lntp 2>/dev/null | grep 8443
```
输出 uhttpd，此时 443 已经空出来。LuCI 访问地址就变成： https://192.168.5.1:8080/

之前的端口转发规则 5300 -> 443 需要修改为 5300 -> 8443

重启 Nginx：
```bash
nginx -t -c /etc/nginx/uci.conf
/etc/init.d/nginx restart
```

## 配置 Nginx
新建 /etc/nginx/conf.d/op.example.com.conf
```nginx
server_names_hash_bucket_size 64;
server {
  listen 443 ssl;
  listen [::]:443 ssl;

  server_name op.example.com;

  ssl_certificate     /etc/acme/op.example.com_ecc/fullchain.cer;
  ssl_certificate_key /etc/acme/op.example.com_ecc/op.example.com.key;

  root /www;
  index index.nginx.html;
}
```
使用之前 op.example.com 域名和已经申请的 TLS 证书即可

新建 /www/index.nginx.html
```html
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
```
默认的 /www/index.html 是 ImmortalWrt 的默认跳转页，会自动跳转到： /cgi-bin/luci/，这里自定义一个首页  

添加端口转发规则

网络 - 防火墙 - 端口转发 - 添加

添加页面：
名称：随便输入名称  
地址族限制：仅 IPv6  
协议：只勾选 TCP  
源区域：使用默认的 wan  
外部端口：6300(65535以内即可)  
目标区域：选择 未指定  
内部 IP 地址：保持默认 任意  
内部端口：443  

保存并应用

现在所有从公网发到 6300 端口的数据都会转发给路由器的 443 端口

使用手机流量访问 https://op.example.com:6300，正常显示 Nginx 首页  

## 转发内网其它应用
ssh 进入 ImmortalWrt 找个目录新建一个 index.html，随便写些内容

```
opkg install python3
mkdir /opt
cd /opt
touch index.html
echo 'hello' > index.html
```

在目录下运行 `python3 -m http.server 9800 --bind ::` 开启一个简单应用

本机访问测试 `wget -O- http://127.0.0.1:9800`

本地电脑浏览器访问：http://192.168.5.1:9800，显示 hello

```nginx
location / {
  proxy_pass http://127.0.0.1:9800;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

使用手机流量访问 https://op.example.com:6300，显示 hello

有其它应用，再走一遍
- DDNS 新域名
- acme 生成新域名证书
- 新增 /etc/nginx/conf.d/新域名.conf
- 校验和重启 Nginx
- 手机流量访问 https://新域名:6300

## Nginx UCI 模式

设置 server_tokens
```bash
uci set nginx.global.server_tokens='off'
uci commit nginx
nginx -t -c /etc/nginx/uci.conf
/etc/init.d/nginx reload
```

默认访问日志已关闭（生成配置中是 access_log off;），所以 /var/log/nginx/access.log 目前是空的。错误日志进入系统日志，可这样查看：

`logread | grep nginx`

实时查看：

`logread -f | grep nginx`

如果要记录公网站点的访问日志，在 /etc/nginx/conf.d/op.example.com.conf 的 server { ... } 内加入：

```nginx
access_log /var/log/nginx/access.log openwrt;
error_log  /var/log/nginx/error.log warn;
```

然后执行：

```bash
nginx -t -c /etc/nginx/uci.conf
/etc/init.d/nginx reload
```

之后可用 tail -f /var/log/nginx/access.log 查看请求。注意 /var/log 在 ImmortalWrt 上属于临时存储，重启后日志可能清空。
