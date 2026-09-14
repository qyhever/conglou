---
pubDatetime: 2026-04-06T15:22:00Z
title: crontab 定时任务工具
slug: crontab
tags:
  - Linux
  - Crontab
description: ""
---

crontab 是 Linux/macOS 中的定时任务工具，用来让系统在指定时间自动执行命令或脚本。适合“固定时间、周期性、无人值守”的任务。

常见场景：
- 定时备份数据库、网站文件
- 定期清理日志和临时文件
- 每天执行数据统计、生成报表
- 定时同步 Git 仓库或云存储
- 定期检查服务器状态、证书有效期
- 定时调用 API、发送通知
- 定时更新订阅、规则或汇率数据
- 定期运行爬虫、下载任务
- 定时重启服务或刷新缓存

基本格式：
## 基础语法
```
*   *   *   *   *   要执行的命令
分  时  日   月   周
```

|位置|含义|取值范围|
|---|---|---|
|第1位|分钟|0‑59|
|第2位|小时|0‑23|
|第3位|日期|1‑31|
|第4位|月份|1‑12|
|第5位|星期|0‑7 （0和7都代表周日）|

### 特殊符号
- `*`：每单位，`* * * * *` = 每分钟执行
- `,`：多个时间点，`0,10,20 * * * *` 每小时的0、10、20分
- `-`：区间，`9‑18 * * * *` 9点到18点每一分钟
- `/`：间隔，`*/5 * * * *` 每5分钟执行一次

> **日期和星期是或(OR)关系**，不是同时满足；不要同时限制日期+星期。

## 常用 crontab 命令
```bash
# 编辑当前用户定时任务
crontab -e

# 查看当前用户定时任务
crontab -l

# 删除当前用户全部定时任务
crontab -r

# 查看root用户任务(需要sudo)
sudo crontab -l
sudo crontab -e
```

> 用户独立：`crontab -e` 编辑的是当前登录用户的任务；root任务要加 `sudo`。

## 常见示例
```bash
# 1. 每分钟执行脚本
* * * * * /bin/bash /home/user/check.sh

# 2. 每5分钟执行
*/5 * * * * /home/user/check.sh

# 3. 每小时整点执行
0 * * * * /home/user/check.sh

# 4. 每天凌晨2点30分执行
30 2 * * * /home/user/backup.sh

# 5. 每天 23:00 执行备份
0 23 * * * /root/backup.sh

# 6. 每周一早上8点执行
0 8 * * 1 /home/user/week_job.sh

# 7. 工作日(周一‑周五)22点
0 22 * * 1-5 /home/user/job.sh

# 8. 每月1号凌晨3点
0 3 1 * * /home/user/month.sh
```

## 日志 & 排错
### 开启输出日志
```bash
30 2 * * * /home/user/check.sh >> /var/log/check_cron.log 2>&1
```
- `>>` 追加输出日志
- `2>&1` 错误信息也一并写入日志

### 系统 cron 日志路径
Ubuntu/Debian：
```
/var/log/syslog
#过滤cron日志
grep CRON /var/log/syslog
```
CentOS/RHEL：
```
/var/log/cron
```

## 常见问题
1. **脚本里用相对路径会失败！crontab执行时工作目录是 /**
解决：脚本、所有文件路径全部写**绝对路径**

2. **环境变量缺失**，很多命令在终端能跑，cron跑失败

方案一：脚本开头导入环境
```bash
#!/bin/bash
source /etc/profile
```
方案二：在crontab行写全命令路径，用 `which nginx` 找完整路径

3. 权限问题：普通用户任务不能操作root文件；需要root任务就 `sudo crontab -e`

4. 脚本没执行权限：`chmod +x /home/user/test.sh`

## 系统级定时任务（/etc/crontab）
`crontab -e` 是用户任务；`/etc/crontab` 是系统任务，格式多一个**用户字段**：
```
*  *  *  *  * root /xxx/command
```

## 服务启停（systemd）
```bash
# 启动
systemctl start cron     # Debian/Ubuntu
systemctl start crond    # CentOS/RHEL

# 设置开机自启
systemctl enable cron
systemctl enable crond

# 查看状态
systemctl status cron
```

## 海外服务器 crontab 按北京时间执行任务

### 方案一：修改服务器系统时区
把服务器操作系统时区直接改成 **Asia/Shanghai（北京时间 UTC+8）**

#### Ubuntu / Debian
```bash
# 交互式选择时区
tzselect

# 写入上海时区
timedatectl set-timezone Asia/Shanghai

# 验证
date
```

#### CentOS 7+ / Rocky / AlmaLinux
```bash
timedatectl set-timezone Asia/Shanghai

# 旧版CentOS6
rm -f /etc/localtime
ln -s /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

date
```

改完时区后，`crontab -e` 直接写北京时间即可。
示例：**北京时间凌晨 2:30 执行**
```cron
30 2 * * * /bin/bash /root/run.sh >> /root/log.log 2>&1
```

---

### 方案二：不修改服务器时区（服务器保留海外时区），时间换算
> 举例：服务器时区为 **纽约 UTC‑5**、伦敦 UTC+0、洛杉矶 UTC‑8
> 北京时间 = UTC+8
> 时差 = 北京时间 − 服务器时间

例子：
> 想要 **北京时间 02:30** 运行脚本
> 服务器在伦敦(UTC+0)，比北京慢8小时 → 服务器时间前一天 18:30
> cron：`30 18 * * * /root/run.sh`

时差速查表
| 服务器时区 | 和北京时差 | 北京时间08:00 = 服务器时间 |
|---|---|---|
| 伦敦 UTC+0 | -8h | 00:00 |
| 纽约 UTC‑5 | -13h | 前一天 19:00 |
| 洛杉矶 UTC‑8 | -16h | 前一天 16:00 |

> 缺点：夏令时会变时差！欧美国家夏令时切换会导致定时任务偏移，所以不推荐长期用换算方式。

---

### 方案三：时区不变，crontab 使用 TZ 环境变量（推荐，单条任务用北京时间）

编辑 crontab
```bash
crontab -e
```

任务写法：
```cron
TZ=Asia/Shanghai
30 2 * * * /bin/bash /root/run.sh >> /root/log.log 2>&1
30 5 * * * /bin/bash /root/check.sh >> /root/log.log 2>&1
```
> 此时 `30 2` 代表 **北京时间 02:30**，不受服务器本地时区影响。
> 优点：一台服务器可同时跑多个不同时区的定时任务。

> 注意：`TZ=Asia/Shanghai` 写在 crontab 文件顶部一次，下面所有任务都会生效。

单个任务写法：
```cron
30 2 * * * /bin/bash /root/run.sh >> /root/log.log 2>&1
30 5 * * * TZ=Asia/Shanghai /bin/bash /root/run.sh >> /root/log.log 2>&1
```
> 只有 `30 5` 代表 **北京时间 05:30**，不受服务器本地时区影响。

---

### 验证任务是否是北京时间执行
在脚本内打印执行时间，写入日志
run.sh
```bash
#!/bin/bash
echo "任务执行时间: $(date)"
echo "北京时间: $(TZ=Asia/Shanghai date)"
```
然后查看日志，核对两个时间是否符合预期。

---

## crontab 如何执行 `.js` 文件
前提：服务器装好 **Node.js**，crontab 本质只是调用 node 解释器运行脚本。

### 方式1：直接调用 node 执行
```bash
# 查看node绝对路径
which node
```
输出示例：`/usr/bin/node` 或者 `/root/.nvm/versions/node/v20.12.2/bin/node`

crontab 任务：
```cron
30 2 * * * /usr/bin/node /home/xxx/test.js >> /home/xxx/js_log.log 2>&1
```
> 必须写 **node 绝对路径 + js 文件绝对路径**

### 方式2：js脚本头部加解释器
test.js
```js
#!/usr/bin/node
console.log("定时任务运行成功");
```
添加执行权限
```bash
chmod +x /home/xxx/test.js
```
crontab：
```cron
30 2 * * * /home/xxx/test.js >> /home/xxx/js_log.log 2>&1
```

### 常见问题
#### 1. nvm 安装的 node，crontab 找不到！
crontab 环境变量很干净，读不到 nvm 的 node。

解决方案：
1. 使用 `which node` 获取 node **完整绝对路径**，不要直接写 `node`
2. 或者在脚本开头加载环境
```js
// 不推荐js里加载shell环境，改用shell包装脚本最稳
```

可以包装一层 shell 脚本 run.sh
```bash
#!/bin/bash
# 加载nvm环境
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
node /home/xxx/test.js
```
```bash
chmod +x run.sh
```
crontab：
```cron
30 2 * * * /bin/bash /home/xxx/run.sh >> /home/xxx/js_log.log 2>&1
```

#### 2. 相对路径全部失效
js 文件里 `./config.json` 这类相对路径，在 cron 下工作目录是 `/`，会报文件找不到。
修复：js 内部全部改成 **绝对路径**
```js
import fs from 'fs';
fs.readFile('/home/xxx/config.json')
```
