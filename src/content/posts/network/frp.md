---
pubDatetime: 2026-07-25T15:22:00Z
title: VPS + FRP 实现流量转发，将内网服务暴露到公网
slug: frp
featured: true
tags:
  - Network
description: ""
---

之前使用 IPv6 + DDNS 方案实现了公网访问内网服务，但是现在还是有些网络设备没有 IPv6，自然无法访问了。然后尝试了下 FRP 方案，和 IPv6 + DDNS 搭配使用还是不错的，两者可以互补，这样在任意设备上都可以实现正常访问了。

## 设备信息
- VPS 服务器 Ubuntu
- 家庭路由器 Immortalwrt

## 和 IPv6 + DDNS 方案的区别

**IPv6 + DDNS：**

```text
手机/电脑
   │
   │ HTTPS
   ▼
你的域名 AAAA
   │
   ▼
家庭公网 IPv6
   │
   ▼
ImmortalWrt
   │
   ▼
192.168.x.x:9000
```

这是公网直接访问家庭内网。

优点是：

* 链路最短，延迟最低
* VPS 不消耗流量
* 带宽主要由你家上传决定
* 架构简单

缺点是：

* 客户端网络必须支持 IPv6
* 家庭公网 IPv6 地址变化，需要 DDNS
* 家庭公网 IPv6 暴露在互联网
* 防火墙规则需要自己管理
* 部分运营商可能封锁入站端口
* IPv4-only 网络无法访问


而 **FRP** 是：

```text
                    ┌─────────────────────┐
                    │ VPS 公网 IPv4/IPv6 │
用户 ──HTTPS──────► │ Nginx / FRPS        │
                    └─────────┬───────────┘
                              │
                         FRP 隧道
                              │
                              ▼
                    ┌─────────────────────┐
                    │ ImmortalWrt / FRPC  │
                    └─────────┬───────────┘
                              │
                              ▼
                     NAS 192.168.1.10
                          :9000
```

最关键的一点是：

**FRPC 是从家庭内网主动连接 VPS。**

所以不需要外部主动连接的家庭路由器。

这正是 FRP 能穿 NAT、CGNAT、防火墙的根本原因。


## FRP 的原理

FRP 分成两个程序：

```text
frps
FRP Server
运行在 VPS

frpc
FRP Client
运行在 ImmortalWrt
```

启动以后：

```text
ImmortalWrt
   │
   │ 主动 TCP 连接
   ▼
VPS:7000
   │
   │ 长连接
   ▼
frps
```

例如你告诉 FRPC：

```text
把：
192.168.1.10:9000

映射到：
VPS:19000
```

那么访问：

```text
VPS_IP:19000
```

FRPS 收到连接后，会通过已经建立好的 FRP 通道把连接发送给 FRPC

家庭网络不需要公网 IP。FRP 官方项目本身就是为 将 NAT 或防火墙后的本地服务暴露到互联网 设计的。

## VPS + FRP 相对于 IPv6 + DDNS 的几个明显优势

1. **IPv4 兼容性**。
即使访问设备所在网络没有 IPv6，仍然可以访问。

2. **家庭公网地址完全不需要暴露。**
家庭网络藏在 VPS 后面。

3. **家庭公网地址变化完全无所谓。**

4. **一个 VPS 可以统一代理很多家庭服务。**

例如：

```text
nas.example.com
photo.example.com
router.example.com
homeassistant.example.com
```

都可以指向 VPS：

```text
*.example.com
     ↓
VPS
```

再由：Nginx -> FRP -> 家庭 LAN

转发到：

```text
NAS        192.168.1.10:9000
ImmortalWrt 192.168.1.1:8443
HomeAssistant 192.168.1.20:8123
```

5. **HTTPS/TLS 都集中在 VPS。**

家里的 NAS 服务甚至只需要 HTTP：

```text
192.168.1.10:9000
```

家庭网络不用自己折腾 HTTPS。

## FRP 的缺点
1. 所有流量都绕 VPS
访问速度，取决于 VPS 的带宽速率。

2. VPS 流量会翻倍
VPS 会同时产生 入站 出站流量，看 VPS 厂家的计费，大多只计算出站流量。

## 混合方案

IPv6 DDNS + VPS FRP：

```text
             ┌──────── IPv6 DDNS ────────► 家庭 IPv6
Internet ────┤
             │
             └──────── VPS FRP ──────────► 家庭 LAN
```

### IPv6 + DDNS 线路

用于：

```text
大文件
NAS
视频
高带宽访问
设备有 IPv6
```

### FRP

用于：

```text
管理后台
小型 Web 服务
SSH
LuCI
Home Assistant
临时访问
IPv4-only 网络
```

## 部署 FRP

### 第一步：VPS 安装 FRPS
创建目录：
```bash
mkdir -p /etc/frp
cd /etc/frp
```

从 FRP 官方 [release](https://github.com/fatedier/frp/releases) 下载对应 Linux 架构版本。
```bash
cd /opt
wget https://github.com/fatedier/frp/releases/download/v0.71.0/frp_0.71.0_linux_amd64.tar.gz
# 检查 SHA256 与官方 Release 完全一致
sha256sum frp_0.71.0_linux_amd64.tar.gz
tar -xzf frp_0.71.0_linux_amd64.tar.gz
cd tar -xzf frp_0.71.0_linux_amd64
```

然后将可执行文件放到 bin 下：

```bash
cp frps /usr/local/bin/
chmod +x /usr/local/bin/frps
```

创建配置文件 /etc/frp/frps.toml：
```toml
bindPort = 7000

auth.method = "token"
auth.token = "换成一个很长的随机密码"

allowPorts = [
  { start = 19000, end = 19999 }
]
```

`allowPorts` 可以限制客户端能够占用哪些公网端口，官方 FRP 支持这种服务器端限制。

比如：

```text
FRP 控制连接： VPS:7000

公网映射端口： 19000-19999
```

创建 systemd 文件 /etc/systemd/system/frps.service：
```ini
[Unit]
Description=FRP Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启动：
```bash
systemctl daemon-reload
systemctl enable --now frps
systemctl status frps
```

VPS 防火墙开放 7000/tcp。

VPS 厂家可能会发送告警通知，识别 frps 为恶意文件。FRP 官方仓库自己就专门说明过：frpc 因为具备反向代理、内网穿透能力，能够绕过常规防火墙端口限制，所以一些杀毒/主机安全产品会把它识别为风险程序甚至直接隔离。

只要确认 SHA256 和官方一致，可以在 VPS 面板对 frps 这个文件进行信任/白名单处理即可。

### 第二步：VPS Nginx 反向代理

不直接访问 19000，而是 VPS Nginx 反代到 19000

创建 Nginx 配置文件 和 申请证书：
```bash
cd /etc/nginx/sites-available
vim nas.example.com.conf
ln -s /etc/nginx/sites-available/nas.example.com.conf /etc/nginx/sites-enabled/
nginx -t
nginx -s reload
certbot --nginx -d nas.example.com
```

Nginx 配置文件内容：
```nginx
server {
    listen 443 ssl;
    server_name nas.example.com;

    ssl_certificate /etc/letsencrypt/live/nas.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nas.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:19000;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果内网的 19000 是 https 服务，则需要同步 `proxy_pass https://127.0.0.1:19000`，不一致会出现 400 502 访问错误。

最终：

```text
https://nas.example.com
        │
        ▼
VPS :443
        │
      Nginx
        │
127.0.0.1:19000
        │
      FRPS
        │
      FRPC
        │
192.168.1.10:9000
```

### 第三步：ImmortalWrt 安装 FRPC

安装 FRPC：
```bash
opkg update
opkg install luci-i18n-frpc-zh-cn
```

创建 /etc/config/frpc：
```ini
config init
	option stdout '1'
	option stderr '1'
	option user 'root'
	option group 'root'
	option respawn '1'

config conf 'common'
	option server_addr 'nas.example.com'
	option server_port '7000'
	option token '随机密码'
	option tls_enable 'false'

config conf 'web'
	option name 'web'
	option type 'tcp'
	option local_ip '127.0.0.1'
	option local_port '9000'
	option remote_port '19000'
	option use_encryption 'false'
	option use_compression 'false'
```

> /etc/config/frpc 是 OpenWrt UCI 的持久化配置文件。而 /var/etc/frpc.ini 是 /etc/init.d/frpc 启动时根据 UCI 配置自动生成的运行时文件。

启动和查看：
```bash
/etc/init.d/frpc start
/etc/init.d/frpc status
/etc/init.d/frpc restart
uci show frpc
logread -f | grep -i frpc
logread -f
```

python3 在 9000 开启一个服务：
```
opkg install python3
mkdir /opt
cd /opt
touch index.html
echo 'hello' > index.html
```

在目录下运行 `python3 -m http.server 9000` 开启一个简单应用

本机访问测试 `wget -O- http://127.0.0.1:9000`，显示 hello

公网访问 `https://nas.example.com`，显示 hello

## 多个服务

可以这样规划：

```text
19001 → NAS Web        192.168.1.10:9000
19002 → ImmortalWrt   192.168.1.1:8443
19003 → HomeAssistant 192.168.1.20:8123
19004 → SSH NAS       192.168.1.10:22
```

FRPC：

```toml
[[proxies]]
name = "nas"
type = "tcp"
localIP = "192.168.1.10"
localPort = 9000
remotePort = 19001


[[proxies]]
name = "router"
type = "tcp"
localIP = "192.168.1.1"
localPort = 8443
remotePort = 19002


[[proxies]]
name = "ha"
type = "tcp"
localIP = "192.168.1.20"
localPort = 8123
remotePort = 19003
```

然后 VPS Nginx：

```text
nas.example.com
        ↓
127.0.0.1:19001

router.example.com
        ↓
127.0.0.1:19002

ha.example.com
        ↓
127.0.0.1:19003
```

## 文档
- https://github.com/fatedier/frp "GitHub - fatedier/frp: A fast reverse proxy to help you expose a local server behind a NAT or firewall to the internet. · GitHub"
- https://downloads.immortalwrt.org/releases/packages-25.12/x86_64/luci/ "Index of /releases/packages-25.12/x86_64/luci/"
- https://github.com/kuoruan/luci-app-frpc "GitHub - kuoruan/luci-app-frpc: LuCI support for FRPC · GitHub"
