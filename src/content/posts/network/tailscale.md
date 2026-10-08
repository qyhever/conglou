---
pubDatetime: 2026-10-03T15:22:00Z
title: 用 Tailscale 打通家庭网络与 VPS
slug: tailscale
featured: true
tags:
  - Network
description: ""
---

最近入手了一台友善 R28S，我希望在外面访问家庭设备，也希望家里的设备能访问 VPS，同时保留光猫拨号、R28S 路由和 OpenClash 的现有用法。最终使用 R28S 作为 Tailscale 子网路由，VPS 和 Mac 作为普通节点。

## 网络拓扑

```text
互联网
├── 电信光猫（拨号，LAN：192.168.1.0/24）
│   └── R28S WAN：192.168.1.4
│       └── 家庭 LAN：192.168.2.0/24（R28S：192.168.2.1）
│           └── Mac 等家庭设备
└── VPS（Rocky Linux 9.8）

Tailscale tailnet：R28S 发布 192.168.2.0/24；VPS 和 Mac 接受该路由。
```

R28S 运行 OpenWrt 25.12.5，使用 `apk` 管理软件包，并启用了 OpenClash 的 `fake-ip-tun` 模式。最初家庭 LAN 是 `192.168.2.0/24`；组网完成后，我将它迁移到了 `192.168.20.0/24`。下面先按初始网段说明组网，再记录改址过程。

## 安装并加入同一个 tailnet

### R28S：安装并发布家庭子网

通过 SSH 登录 R28S，安装 OpenWrt 软件源中的 Tailscale，并设为开机启动：

```sh
apk update
apk add tailscale
/etc/init.d/tailscale enable
/etc/init.d/tailscale start
tailscale version
```

首次启动时发布当时的家庭网段。`--accept-dns=false` 让路由器继续使用现有的 OpenClash、dnsmasq DNS 配置：

```sh
tailscale up \
  --hostname=home-r28s \
  --accept-dns=false \
  --advertise-routes=192.168.2.0/24
```

命令会给出一次性认证链接。用自己的 Tailscale 账号打开链接，完成设备登录。不要将该链接或认证密钥保存到博客、脚本或仓库。

R28S 需要让 `tailscale0` 进入 OpenWrt 防火墙的独立区域，并允许它与 LAN 双向转发。本次使用的关键配置如下；在已有同名配置的机器上，先检查再写入：

```sh
uci set network.tailscale=interface
uci set network.tailscale.proto='none'
uci set network.tailscale.device='tailscale0'

uci set firewall.tailscale=zone
uci set firewall.tailscale.name='tailscale'
uci set firewall.tailscale.network='tailscale'
uci set firewall.tailscale.input='ACCEPT'
uci set firewall.tailscale.output='ACCEPT'
uci set firewall.tailscale.forward='REJECT'
uci set firewall.tailscale.mtu_fix='1'

uci set firewall.ts_to_lan=forwarding
uci set firewall.ts_to_lan.src='tailscale'
uci set firewall.ts_to_lan.dest='lan'
uci set firewall.lan_to_ts=forwarding
uci set firewall.lan_to_ts.src='lan'
uci set firewall.lan_to_ts.dest='tailscale'

uci commit network
uci commit firewall
fw4 check
/etc/init.d/network reload
/etc/init.d/firewall reload
```

这里没有开启防火墙区域的 masquerading，保留 Tailscale 子网路由默认的源地址转换（SNAT）。本次实测两个方向都能通信。子网路由的发布还不等于客户端立即可用：需要在 Tailscale 管理后台的 **Machines → home-r28s → Edit route settings** 中批准 `192.168.2.0/24`。路由和访问策略都必须允许相应流量。

### VPS：安装并接收子网路由

VPS 使用 Rocky Linux 9.8。添加 Tailscale 官方软件源、启动服务，再加入相同的 tailnet：

```sh
curl -fsSL https://pkgs.tailscale.com/stable/rhel/9/tailscale.repo \
  -o /etc/yum.repos.d/tailscale.repo
dnf install -y tailscale
systemctl enable --now tailscaled
tailscale up --hostname=home-vps --accept-dns=false --accept-routes
```

`--accept-routes` 很关键：Linux 客户端默认不会接收其他节点发布的子网路由。登录后可用 `ip route get 192.168.2.1` 检查是否走 `tailscale0`。如果仍走 VPS 的公网默认网关，先检查 R28S 路由是否已在管理后台批准。

### Mac：安装客户端

Mac 安装 [Tailscale 独立版](https://tailscale.com/docs/install/mac)，允许 macOS 添加 VPN 配置，并使用同一账号登录。macOS 会自动接收已批准的子网路由。Mac 在家庭 LAN 内时，访问本地网关仍走 Wi-Fi；离家后则可通过 Tailscale 访问家庭网段。

## 从中继切换到直连

初次验证时，R28S 和 VPS 虽然互通，但 `tailscale ping` 显示 `DERP(lax)`，往返延迟约 **320 ms**。VPS 已在本机 firewalld 放行 UDP `41641`，但从家里向其公网地址发出的测试包没有到达 VPS 网卡。后来在 VPS 云平台安全组中放行 UDP `41641` 入站，连接改为直连：

```sh
# VPS 本机防火墙
firewall-cmd --permanent --zone=public --add-port=41641/udp
firewall-cmd --reload

# 在 R28S 或 Mac 上验证到 VPS 的连接
tailscale ping home-vps
```

直连后，R28S 与 VPS 的稳定往返延迟约 **29–33 ms**，此前的中继延迟约为 **320 ms**。Tailscale 通常不要求手动开放端口；本次因实测长期经 DERP 中继，才检查并放行了 VPS 的 UDP 入站。


## 将家庭 LAN 从 192.168.2.0/24 改为 192.168.20.0/24

改 LAN 地址会使原来的 `192.168.2.1` 立即失效。迁移前应先确认可通过 R28S 的 Tailscale 地址 SSH 登录。为减少路由空窗，可以先同时发布旧、新网段，并在管理后台批准新路由：

```sh
tailscale set --advertise-routes=192.168.2.0/24,192.168.20.0/24
```

随后在 R28S 上修改 LAN 地址：

```sh
uci set network.lan.ipaddr='192.168.20.1/24'
uci commit network
/etc/init.d/network reload
```

家庭设备重新获取 DHCP 地址，无线设备删除 Wifi 后重连，有线设备禁用再启用网卡；手动配置 IP 的设备还需分别修改地址、网关和 DNS。此次 DHCP 地址池使用相对主机号 `100–249`，没有写死旧网段；防火墙按 `lan`、`tailscale` 区域转发，也不需要改规则。确认 VPS 能访问 `192.168.20.1` 和新 LAN 中的设备后，撤下旧路由：

```sh
tailscale set --advertise-routes=192.168.20.0/24
```

最后在管理后台取消旧网段路由，并更新保存的 LuCI、SSH 地址。

## 最终验证

```bash
tailscale status
tailscale ping 100.xxx
```

## 对比 frp方案 和 IPv6 + DDNS 方案
### Tailscale	
Tailscale 建立了一个虚拟私有局域网，访问家里设备，体验几乎就像人在家里。

缺点是访问端通常也需要加入 Tailscale 网络。

可以用于自己远程访问家里设备、NAS、监控等私人服务。

### FRP
FRP 的优势在于公网入口非常可控，任何人都可以访问。

缺点是需要购置云服务器，访问速度也受限于云服务器带宽。

把某些服务公开给互联网，分享给朋友。

### IPv6 + DDNS
IPv6 + DDNS 的优势则是直连，性能通常最好。

缺点是有些设备没有 IPv6 则无法访问。

可以用于大文件高速远程访问，追求高性能。

## Reference
- [Tailscale 子网路由文档](https://tailscale.com/docs/features/subnet-routers?tab=linux)
- [Tailscale 路由注入说明](https://tailscale.com/docs/reference/route-injection)
- [Tailscale 家庭设备访问指南](https://tailscale.com/docs/use-cases/personal-or-at-home-use/access-devices-without-tailscale?tab=macos)
- [Tailscale 防火墙说明](https://tailscale.com/docs/reference/faq/firewall-ports)