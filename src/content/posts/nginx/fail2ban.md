---
pubDatetime: 2026-06-19T15:22:00Z
title: 使用 Fail2Ban 保护 SSH 与 Nginx：拦截恶意扫描和高频请求
slug: fail2ban
tags:
  - Nginx
  - Fail2Ban
  - Safety
description: "Fail2Ban 是一款基于日志分析的自动封禁工具。它会持续监控 SSH、Nginx 等服务产生的日志，当某个 IP 在指定时间内触发过多异常记录时，自动调用 iptables 或 nftables 将其临时封禁。"
---

Fail2Ban 是一款基于日志分析的自动封禁工具。它会持续监控 SSH、Nginx 等服务产生的日志，当某个 IP 在指定时间内触发过多异常记录时，自动调用 iptables 或 nftables 将其临时封禁。

Fail2Ban 原生支持 SSH、Apache 等常见服务，也允许通过自定义 Filter 和 Jail 监控任意日志。

本文将介绍如何使用 Fail2Ban 实现：

* SSH 暴力破解防护；
* Nginx 恶意路径扫描防护；
* Nginx 高频动态请求限制；
* Docker Bridge 网络下的封禁规则；
* 多个 Nginx 日志文件的监控；
* 规则测试、封禁查询与手动解封。

> Fail2Ban 主要用于拦截能够在日志中留下明确特征的攻击行为。它不能替代 Nginx 限流、Cloudflare、安全组、防火墙或专业 DDoS 防护。

---

## 一、安装 Fail2Ban

### Debian、Ubuntu

```bash
sudo apt update
sudo apt install fail2ban -y
```

### CentOS、Rocky Linux、AlmaLinux

部分系统需要先启用 EPEL 软件源：

```bash
sudo dnf install epel-release -y
sudo dnf install fail2ban -y
```

旧版 CentOS 也可以使用：

```bash
sudo yum install epel-release -y
sudo yum install fail2ban -y
```

安装完成后启动 Fail2Ban：

```bash
sudo systemctl enable --now fail2ban
```

查看服务状态：

```bash
sudo systemctl status fail2ban
```

看到以下状态说明服务运行正常：

```text
Active: active (running)
```

查看版本：

```bash
fail2ban-client --version
```

---

## 二、了解 Filter 和 Jail

Fail2Ban 的配置主要分为两部分。

### Filter

Filter 用于定义日志匹配规则，配置文件通常位于：

```text
/etc/fail2ban/filter.d/
```

其中：

* `failregex`：匹配需要计入失败次数的日志；
* `ignoreregex`：排除不应计入失败次数的日志；
* `<HOST>`：由 Fail2Ban 识别并提取客户端 IP。

### Jail

Jail 将 Filter、日志路径、检测时间、最大重试次数和封禁动作组合起来，配置通常放在：

```text
/etc/fail2ban/jail.local
```

或者：

```text
/etc/fail2ban/jail.d/*.local
```

不建议直接修改发行版提供的 `.conf` 文件。Fail2Ban 的配置文档建议保留原始 `.conf` 文件，通过 `.local` 文件覆盖配置，以免软件升级时被覆盖。

---

## 三、配置 Nginx 恶意扫描防护

互联网上存在大量自动化扫描器，会持续尝试访问：

```text
/.env
/.git/config
/wp-login.php
/xmlrpc.php
/phpmyadmin
/vendor/phpunit
```

如果服务器并未运行 WordPress、phpMyAdmin 或 PHP 项目，这些请求通常可以视为恶意扫描。

创建 Filter：

```bash
sudo vim /etc/fail2ban/filter.d/nginx-bad-requests.conf
```

写入：

```ini
[Definition]

failregex = ^<HOST> - .*"(?:GET|POST|HEAD) [^"]*(?:\.php|\.asp|\.aspx|\.jsp|\.cgi|wp-admin|wp-login(?:\.php)?|xmlrpc\.php|\.env|\.git|\.sql|\.bak|\.old|\.swp|\.save)[^"]* HTTP/[^"]+" (?:400|401|403|404) .*
            ^<HOST> - .*"(?:GET|POST|HEAD) /[^"]*(?:phpmyadmin|admin|setup|manager|dashboard|wp-login|xmlrpc)[^"]* HTTP/[^"]+" (?:400|401|403|404) .*

ignoreregex =
```

该规则适用于类似下面的 Nginx Combined 日志格式：

```text
192.0.2.10 - - [29/Jul/2026:12:00:00 +0800] "GET /.env HTTP/1.1" 404 153 "-" "Mozilla/5.0"
```

需要注意，正则表达式必须与实际日志格式一致。如果修改过 Nginx 的 `log_format`，应根据真实日志进行调整。

### 更保守的扫描规则

如果站点本身使用 PHP、WordPress 或管理后台，不应直接匹配所有 `.php` 或 `/admin` 请求，否则可能误封正常用户。

这种情况下，可以仅匹配明确的敏感路径：

```ini
[Definition]

failregex = ^<HOST> - .*"(?:GET|POST|HEAD) /(?:\.env|\.git(?:/|$)|wp-login\.php|xmlrpc\.php|phpmyadmin(?:/|$)|vendor/phpunit|cgi-bin/)[^"]* HTTP/[^"]+" (?:400|401|403|404) .*

ignoreregex =
```

对于正常运行 WordPress 的站点，应为登录失败、XML-RPC 攻击等行为分别建立更精确的规则，而不是仅凭访问路径封禁。

---

## 四、配置 Nginx 高频请求监控

创建 Filter：

```bash
sudo vim /etc/fail2ban/filter.d/nginx-cc.conf
```

写入：

```ini
[Definition]

failregex = ^<HOST> - .*"(?:GET|POST|HEAD|PUT|DELETE|PATCH|OPTIONS) [^"]* HTTP/[^"]+" \d{3} .*

ignoreregex = ^<HOST> - .*"(?:GET|HEAD) [^"]*\.(?:jpg|jpeg|png|gif|webp|ico|css|js|map|woff|woff2|ttf|svg|mp4|webm)(?:\?[^"]*)? HTTP/[^"]+".*
              ^<HOST> - .*".*" \d{3} .*"(?:Baiduspider|Googlebot|bingbot|Sogou|360Spider|YandexBot)[^"]*"$
```

这条规则会记录非静态资源请求，再由 Jail 中的 `findtime` 和 `maxretry` 判断是否封禁。

但需要特别注意：

1. User-Agent 可以伪造，仅依赖爬虫名称加入白名单并不可靠。
2. NAT、公司网络、学校网络和移动网络可能有大量用户共享同一个出口 IP。
3. API、后台轮询、健康检查和前端 SSR 请求可能在短时间内产生大量正常访问。
4. 如果 Nginx 位于 Cloudflare、CDN 或其他反向代理之后，日志中必须记录真实客户端 IP，否则可能误封代理节点。

因此，CC 防护规则必须结合实际访问量调整，不能直接照搬到高流量网站。

### Fail2Ban 不适合单独承担 CC 防护

Fail2Ban 的工作流程是：

```text
请求到达 Nginx
    ↓
Nginx 写入日志
    ↓
Fail2Ban 读取并分析日志
    ↓
达到阈值后写入防火墙规则
```

它属于事后检测和封禁，不是实时请求限流。

对于高频请求，更推荐同时配置：

* Nginx `limit_req`；
* Nginx `limit_conn`；
* Cloudflare WAF 或 Rate Limiting；
* 上游 CDN；
* 云厂商安全组和流量清洗服务。

Fail2Ban 更适合作为辅助防线。

---

## 五、配置 jail.local

不建议执行下面这种操作：

```bash
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
```

虽然这样通常能够运行，但会将大量系统默认配置复制到本地文件中，后续升级 Fail2Ban 时可能无法自动获得新的默认配置。

更推荐直接创建精简的覆盖文件：

```bash
sudo vim /etc/fail2ban/jail.local
```

写入：

```ini
[DEFAULT]

# 本机回环地址不封禁
ignoreip = 127.0.0.1/8 ::1

# 默认封禁时间：1 小时
bantime = 1h

# 统计窗口：10 分钟
findtime = 10m

# 在统计窗口内最多允许失败 5 次
maxretry = 5

# 自动选择日志后端
backend = auto

# Debian 11、Ubuntu 22.04 等系统通常可以自动选择 nftables
# 如果系统明确使用 iptables，可以取消下一行注释
# banaction = iptables-multiport
```

### SSH 防护

Debian、Ubuntu：

```ini
[sshd]

enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
findtime = 10m
bantime = 1h
```

CentOS、Rocky Linux、AlmaLinux 通常使用：

```ini
[sshd]

enabled = true
port = ssh
filter = sshd
logpath = /var/log/secure
maxretry = 3
findtime = 10m
bantime = 1h
```

如果 SSH 修改了端口，例如 `2222`，需要同步修改：

```ini
port = 2222
```

使用 systemd journal 的系统也可以尝试：

```ini
backend = systemd
```

当 `backend = systemd` 时，通常由 Filter 中的 `journalmatch` 确定日志来源，不应盲目照搬文件型 `logpath`。

### Nginx 恶意扫描防护

```ini
[nginx-bad-requests]

enabled = true
port = http,https
filter = nginx-bad-requests
logpath = /var/log/nginx/access.log

# 5 分钟内触发 10 次后封禁
findtime = 5m
maxretry = 10

# 封禁 30 分钟
bantime = 30m
```

### Nginx 高频请求防护

```ini
[nginx-cc]

enabled = true
port = http,https
filter = nginx-cc
logpath = /var/log/nginx/access.log

# 60 秒内最多允许匹配 120 次
findtime = 60s
maxretry = 120

# 封禁 2 小时
bantime = 2h
```

这里的“120 次”并不是服务器的绝对请求上限，而是同一个 IP 在 60 秒内匹配该 Filter 的次数。

对于 API、图片站、视频在线播放、WebSocket 或高并发业务，需要根据实际流量提高阈值，或者不启用该 Jail。

---

## 六、根据防火墙选择 banaction

不同发行版、Fail2Ban 版本和防火墙环境使用的封禁动作可能不同。

查看系统中可用的 Action：

```bash
ls /etc/fail2ban/action.d/ | grep -E 'iptables|nftables'
```

### 使用 iptables

```ini
banaction = iptables-multiport
```

### 使用 nftables

部分系统可以使用：

```ini
banaction = nftables-multiport
```

或者由 Fail2Ban 根据系统默认配置自动选择。

不建议在不确认系统防火墙环境的情况下，强制将所有服务器统一设置为 `iptables-multiport`。现代 Debian、Ubuntu、Rocky Linux 可能使用 nftables，或者通过 iptables-nft 兼容层管理规则。

查看当前防火墙：

```bash
sudo nft list ruleset
```

以及：

```bash
sudo iptables -V
```

---

## 七、Docker 化 Nginx 的注意事项

Docker Bridge 网络会创建自己的转发链。Docker 官方提供了 `DOCKER-USER` 链，用于放置需要在 Docker 自身转发规则之前执行的用户规则。

如果满足以下条件：

* Fail2Ban 安装在宿主机；
* Nginx 运行在 Docker Bridge 网络中；
* Nginx 通过 `ports` 将端口映射到宿主机；
* 默认封禁规则写入 `INPUT` 链后无法阻止容器端口访问；

可以尝试为相关 Jail 指定：

```ini
chain = DOCKER-USER
```

例如：

```ini
[nginx-bad-requests]

enabled = true
port = http,https
filter = nginx-bad-requests
logpath = /opt/nginx/log/access.log
findtime = 5m
maxretry = 10
bantime = 30m
chain = DOCKER-USER
```

不过，`chain` 是否会被当前 Action 正确读取，取决于所使用的 Fail2Ban Action 模板。

可以先查看：

```bash
grep -R "chain" /etc/fail2ban/action.d/iptables*.conf
```

必要时显式指定：

```ini
banaction = iptables-multiport
chain = DOCKER-USER
```

### Host 网络模式

如果 Nginx 容器使用：

```yaml
network_mode: host
```

流量通常直接经过宿主机网络栈，不需要改为 `DOCKER-USER`，可以继续使用默认链。

### 容器日志必须能够被宿主机读取

Fail2Ban 安装在宿主机时，不能直接读取只存在于容器内部的日志文件。

应将日志挂载到宿主机：

```yaml
services:
  nginx:
    image: nginx:alpine
    volumes:
      - ./logs:/var/log/nginx
```

宿主机上的 Jail 可以配置：

```ini
logpath = /opt/nginx/logs/access.log
```

也可以让 Nginx 将日志写到宿主机目录，或者使用 journald，并配置对应的 Fail2Ban 后端。

---

## 八、反向代理和 Cloudflare 真实 IP

当 Nginx 位于 Cloudflare、负载均衡器或其他反向代理之后时，Nginx 默认日志中的来源 IP 可能是代理服务器地址。

如果 Fail2Ban读取到的是 Cloudflare 节点 IP，可能会产生两个问题：

* 多个访客被统计成同一个 IP；
* 触发规则后误封 Cloudflare 节点，导致网站无法访问。

需要先在 Nginx 中正确配置 Real IP，例如：

```nginx
real_ip_header CF-Connecting-IP;
real_ip_recursive on;
```

同时配置可信代理网段：

```nginx
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# 其余 Cloudflare IPv4、IPv6 网段需要一并加入
```

Cloudflare IP 网段可能更新，应以 Cloudflare 官方公布的数据为准。

配置完成后检查访问日志第一列是否已经变成真实客户端 IP：

```bash
sudo tail -f /var/log/nginx/access.log
```

只有日志中记录了真实客户端 IP，Fail2Ban 才能正确封禁攻击来源。

---

## 九、测试 Filter 规则

完成 Filter 后，不要直接重启服务。应先使用 `fail2ban-regex` 测试：

```bash
sudo fail2ban-regex \
  /var/log/nginx/access.log \
  /etc/fail2ban/filter.d/nginx-bad-requests.conf
```

测试 CC 规则：

```bash
sudo fail2ban-regex \
  /var/log/nginx/access.log \
  /etc/fail2ban/filter.d/nginx-cc.conf
```

`fail2ban-regex` 是 Fail2Ban 提供的正则测试工具，用于验证 `failregex` 和 `ignoreregex` 是否能够匹配目标日志。

重点查看结果中的：

```text
Failregex: ... total
Ignoreregex: ... total
Lines: ... lines, ... ignored, ... matched, ... missed
```

其中：

* `matched`：成功匹配的日志数量；
* `ignored`：被 `ignoreregex` 排除的日志数量；
* `missed`：未匹配的日志数量。

有匹配数量只能说明正则能够命中日志，不代表规则一定合理。

还应重点检查：

* 是否误匹配正常访问；
* 是否能够正确提取 IP；
* 是否会匹配静态资源；
* 是否会匹配搜索引擎爬虫；
* 是否与当前 Nginx 日志格式一致。

查看未匹配样本：

```bash
sudo fail2ban-regex \
  /var/log/nginx/access.log \
  /etc/fail2ban/filter.d/nginx-bad-requests.conf \
  --print-all-missed
```

查看全部匹配样本：

```bash
sudo fail2ban-regex \
  /var/log/nginx/access.log \
  /etc/fail2ban/filter.d/nginx-bad-requests.conf \
  --print-all-matched
```

如果日志文件很大，可以先截取最近的数据：

```bash
sudo tail -n 5000 /var/log/nginx/access.log > /tmp/nginx-access-test.log
```

然后测试：

```bash
sudo fail2ban-regex \
  /tmp/nginx-access-test.log \
  /etc/fail2ban/filter.d/nginx-bad-requests.conf
```

---

## 十、校验并加载配置

测试 Filter 后，先检查 Fail2Ban 整体配置：

```bash
sudo fail2ban-client -t
```

部分版本也可以使用：

```bash
sudo fail2ban-client --test
```

配置没有错误时，重新加载：

```bash
sudo fail2ban-client reload
```

如果修改了 Action、服务启动参数或出现加载异常，可以重启：

```bash
sudo systemctl restart fail2ban
```

查看服务状态：

```bash
sudo systemctl status fail2ban
```

查看最近日志：

```bash
sudo journalctl -u fail2ban -n 100 --no-pager
```

实时查看：

```bash
sudo journalctl -u fail2ban -f
```

如果发行版使用独立日志文件，也可以查看：

```bash
sudo tail -f /var/log/fail2ban.log
```

---

## 十一、一个 Jail 监控多个日志文件

Fail2Ban 支持一个 Jail 监控多个日志文件，但推荐使用缩进换行或通配符。

### 写法一：缩进换行

```ini
[nginx-bad-requests]

enabled = true
filter = nginx-bad-requests
port = http,https

logpath = /root/nginx/log/access.log
          /data/www/site1/log/access.log
          /data/www/site2/log/access.log

findtime = 5m
maxretry = 10
bantime = 30m
```

多个日志路径使用“换行加缩进”的方式更加稳妥。部分 Fail2Ban 配置解析场景要求多个路径使用换行和空白字符分隔，而不是简单地写在同一行。

### 写法二：使用通配符

监控目录下所有 `.log` 文件：

```ini
logpath = /root/nginx/log/*.log
```

监控多个目录：

```ini
logpath = /root/nginx/log/*.log
          /var/log/nginx/vhost_*.log
```

监控多个站点：

```ini
logpath = /data/www/*/logs/access.log
```

### 不建议监控无关日志

下面这种写法范围过大：

```ini
logpath = /var/log/nginx/*.log
```

它可能同时匹配：

* `access.log`；
* `error.log`；
* 已轮转的日志；
* 自定义格式日志。

如果 Filter 是根据 access log 格式编写的，却把 error log 一起加入，虽然不一定报错，但会增加无效扫描和排障难度。

推荐明确指定：

```ini
logpath = /var/log/nginx/access.log
          /var/log/nginx/site1-access.log
          /var/log/nginx/site2-access.log
```

### 检查 Jail 实际监控的文件

重新加载后执行：

```bash
sudo fail2ban-client get nginx-bad-requests logpath
```

Fail2Ban 客户端支持查询某个 Jail 当前使用的日志路径。

---

## 十二、常用管理命令

### 查看 Fail2Ban 状态

```bash
sudo fail2ban-client status
```

示例：

```text
Status
|- Number of jail:  3
`- Jail list:       nginx-bad-requests, nginx-cc, sshd
```

### 查看某个 Jail

```bash
sudo fail2ban-client status sshd
```

```bash
sudo fail2ban-client status nginx-bad-requests
```

```bash
sudo fail2ban-client status nginx-cc
```

### 查看已封禁 IP

```bash
sudo fail2ban-client get sshd banip
```

```bash
sudo fail2ban-client get nginx-bad-requests banip
```

### 手动封禁 IP

```bash
sudo fail2ban-client set sshd banip 192.0.2.100
```

封禁到 Nginx Jail：

```bash
sudo fail2ban-client set nginx-bad-requests banip 192.0.2.100
```

### 手动解封 IP

```bash
sudo fail2ban-client set sshd unbanip 192.0.2.100
```

```bash
sudo fail2ban-client set nginx-bad-requests unbanip 192.0.2.100
```

### 查看历史封禁记录

```bash
sudo grep " Ban " /var/log/fail2ban.log
```

同时查询轮转日志：

```bash
sudo zgrep " Ban " /var/log/fail2ban.log*
```

### 查看某个 IP 的记录

```bash
sudo zgrep "192.0.2.100" /var/log/fail2ban.log*
```

### 查看防火墙规则

iptables：

```bash
sudo iptables -L -n --line-numbers
```

Docker：

```bash
sudo iptables -L DOCKER-USER -n --line-numbers
```

nftables：

```bash
sudo nft list ruleset
```

---

## 十三、添加白名单

可以在 `[DEFAULT]` 中配置全局白名单：

```ini
[DEFAULT]

ignoreip = 127.0.0.1/8 ::1 192.168.1.0/24 203.0.113.10
```

也可以使用多行写法：

```ini
ignoreip = 127.0.0.1/8
           ::1
           192.168.1.0/24
           203.0.113.10
```

适合加入白名单的地址包括：

* 本机回环地址；
* 可信家庭公网 IP；
* 公司固定出口 IP；
* 运维跳板机 IP；
* 内网网段；
* 健康检查节点。

动态家庭公网 IP 不适合长期写入白名单，因为 IP 变化后可能白名单失效，原 IP 也可能被其他用户获得。

修改后重新加载：

```bash
sudo fail2ban-client reload
```

查看某个 Jail 的白名单：

```bash
sudo fail2ban-client get sshd ignoreip
```

---

## 十四、开启邮件报警

邮件报警依赖服务器具备可用的邮件发送能力，例如：

* Postfix；
* Sendmail；
* 外部 SMTP 中继；
* 邮件服务商提供的 SMTP。

在 `[DEFAULT]` 中配置：

```ini
[DEFAULT]

destemail = admin@example.com
sender = fail2ban@example.com
mta = sendmail
```

将默认动作改为带邮件通知的动作：

```ini
action = %(action_mwl)s
```

常见动作含义：

```ini
# 只封禁
action = %(action_)s

# 封禁并发送基础邮件
action = %(action_mw)s

# 封禁、发送邮件并附带相关日志
action = %(action_mwl)s
```

生产环境启用前应先测试服务器能否正常发信，避免 Fail2Ban 动作执行失败或通知全部进入垃圾邮件。

如果服务器的 25 端口受限，可以使用支持 465 或 587 端口的 SMTP 中继。

---

## 十五、监控 Nginx error.log

如果希望监控 Nginx `error.log`，建议单独创建 Filter 和 Jail，不要直接复用按照 access log 编写的正则。

创建 Filter：

```bash
sudo vim /etc/fail2ban/filter.d/nginx-error-scan.conf
```

示例：

```ini
[Definition]

failregex = ^.*client: <HOST>,.*(?:access forbidden by rule|directory index of .* is forbidden|open\(\).* failed).*$

ignoreregex =
```

配置 Jail：

```ini
[nginx-error-scan]

enabled = true
port = http,https
filter = nginx-error-scan
logpath = /var/log/nginx/error.log
findtime = 10m
maxretry = 20
bantime = 1h
```

不过，`open() failed`、目录索引禁止和资源不存在也可能由正常页面配置错误产生，因此上线前必须使用真实日志测试，避免误封。

---

## 十六、推荐的生产环境配置

对于普通个人网站或小型 VPS，可以从下面的配置开始：

```ini
[DEFAULT]

ignoreip = 127.0.0.1/8 ::1
bantime = 1h
findtime = 10m
maxretry = 5
backend = auto

[sshd]

enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
findtime = 10m
maxretry = 3
bantime = 1h

[nginx-bad-requests]

enabled = true
port = http,https
filter = nginx-bad-requests
logpath = /var/log/nginx/access.log
findtime = 5m
maxretry = 10
bantime = 30m

# 建议观察正常访问量后再启用
[nginx-cc]

enabled = false
port = http,https
filter = nginx-cc
logpath = /var/log/nginx/access.log
findtime = 60s
maxretry = 120
bantime = 2h
```

建议先启用：

* `sshd`；
* `nginx-bad-requests`。

观察一段时间并确认没有误封后，再考虑启用 `nginx-cc`。

---

## 十七、排查 Fail2Ban 不生效

### 1. Jail 没有启用

查看 Jail 列表：

```bash
sudo fail2ban-client status
```

如果列表中没有目标 Jail，检查：

```ini
enabled = true
```

### 2. Filter 没有匹配日志

运行：

```bash
sudo fail2ban-regex \
  /var/log/nginx/access.log \
  /etc/fail2ban/filter.d/nginx-bad-requests.conf
```

重点检查：

* Nginx 日志格式；
* 正则是否包含 `<HOST>`；
* HTTP 方法和状态码是否一致；
* Filter 文件名和 Jail 中的 `filter` 是否一致。

例如：

```ini
filter = nginx-bad-requests
```

对应文件必须是：

```text
/etc/fail2ban/filter.d/nginx-bad-requests.conf
```

### 3. 日志路径错误

检查文件：

```bash
sudo ls -lah /var/log/nginx/
```

查看 Jail 实际路径：

```bash
sudo fail2ban-client get nginx-bad-requests logpath
```

### 4. Fail2Ban 没有日志读取权限

检查权限：

```bash
sudo namei -l /var/log/nginx/access.log
```

如果日志位于 `/root` 或某个权限严格的目录中，Fail2Ban 服务可能无法穿过父目录读取日志。

### 5. Nginx 在 Docker 中

检查宿主机是否能够看到日志：

```bash
sudo tail -f /opt/nginx/logs/access.log
```

如果宿主机没有对应日志，Fail2Ban 无法分析容器内部文件。

### 6. 封禁链不正确

查看规则：

```bash
sudo iptables -L -n --line-numbers
```

Docker Bridge 网络继续检查：

```bash
sudo iptables -L DOCKER-USER -n --line-numbers
```

### 7. 反向代理导致 IP 不正确

查看日志第一列：

```bash
sudo tail -n 20 /var/log/nginx/access.log
```

如果全部是 Cloudflare、负载均衡器或内网代理 IP，需要先正确配置 Real IP。

### 8. 日志没有时间戳

Fail2Ban 需要根据日志时间计算 `findtime`。自定义 Nginx 日志格式时不要删除时间字段。

推荐保留：

```nginx
$time_local
```

---

## 十八、安全建议

### 不要把自己的运维 IP 封掉

启用规则前，将可信出口 IP 加入：

```ini
ignoreip =
```

同时保留一个已经登录的 SSH 会话，再打开另一个终端测试。

### SSH 优先使用密钥认证

Fail2Ban 只能降低暴力破解频率，不能弥补弱密码。

建议在确认密钥登录正常后关闭密码认证：

```text
PasswordAuthentication no
PermitRootLogin prohibit-password
```

修改后先检查配置：

```bash
sudo sshd -t
```

再重新加载 SSH：

```bash
sudo systemctl reload ssh
```

不同发行版的服务名也可能是：

```bash
sudo systemctl reload sshd
```

### 不要设置过低的 CC 阈值

以下业务容易出现高频正常请求：

* REST API；
* GraphQL；
* WebSocket 降级轮询；
* 管理后台；
* 前端热更新；
* 移动 App；
* 健康检查；
* 图片和视频服务；
* 多用户共享出口网络。

建议先分析访问日志：

```bash
awk '{print $1}' /var/log/nginx/access.log |
  sort |
  uniq -c |
  sort -nr |
  head -20
```

统计最近日志中的高频 IP 后，再确定 `maxretry`。

### 配合日志轮转

确认 Nginx 日志由 logrotate 管理：

```bash
cat /etc/logrotate.d/nginx
```

避免日志无限增长。

### 配合其他安全措施

完整的服务器安全体系通常还应包括：

* SSH 密钥登录；
* 关闭不需要的端口；
* 云安全组；
* UFW、firewalld、iptables 或 nftables；
* Nginx `limit_req` 和 `limit_conn`；
* Cloudflare WAF；
* 定期更新系统软件；
* 最小权限原则；
* 登录和封禁告警；
* 配置与数据备份。

---

## 总结

Fail2Ban 的核心工作流程可以概括为：

```text
服务产生日志
    ↓
Filter 通过正则识别异常记录
    ↓
Jail 在指定时间窗口内统计次数
    ↓
达到阈值后执行封禁 Action
    ↓
封禁时间结束后自动解封
```

实际部署时，应重点关注四个方面：

1. Filter 是否与真实日志格式一致；
2. Jail 的阈值是否会误伤正常用户；
3. 防火墙 Action 和封禁链是否正确；
4. 反向代理环境中是否记录了真实客户端 IP。

对于个人网站，可以先启用 SSH 和恶意扫描防护。高频请求防护应在观察正常访问量后谨慎启用，并与 Nginx 限流、CDN 和 WAF 配合使用。
