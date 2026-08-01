---
pubDatetime: 2026-04-02T15:22:00Z
title: 终端常用命令
slug: quick-command
tags:
  - Linux
description: ""
---

终端日常使用时，经常忘记一些快捷命令，这里记录了一些常用的快捷命令。

## 一键清空整行
### 1. Linux / macOS (Bash/Zsh)
- **清空整行（最推荐）**
  - **`Ctrl + U`**：删除 **从光标到行首** 的所有内容
    → 光标在行尾时，**直接清空整行**
  - **`Ctrl + K`**：删除 **从光标到行尾** 的所有内容
    → 光标在行首时，**直接清空整行**

- **组合 光标移动 + 删除（无论光标在哪）**
  - `Ctrl + A` (行首) → `Ctrl + K` (删到尾)
  - `Ctrl + E` (行尾) → `Ctrl + U` (删到头)

macOS Ctrl 为 Control 键

### 2. Windows (CMD / PowerShell / Windows Terminal)
- **清空整行**
  - **`Esc`**：直接清空当前行
  - **`Ctrl + Home`**：删到行首
  - **`Ctrl + End`**：删到行尾

### 3. 其他常用删除快捷键
- **`Ctrl + W`**：删除光标前**一个单词**
- **`Alt + D`**：删除光标后**一个单词**
- **`Ctrl + Y`**：恢复刚才删除的内容（粘贴回来）


## 清空文件内容
- `> filename`
- `echo "" > filename`
- `: > filename` (冒号是`shell`内置的`true`命令)
- `true > filename`
- 其它的还有 cat truncate dd 命令也可以

## 查找
### 列出当前目录下所有 png 文件（不包含子目录下面的）
```bash
# ls 命令
# 只匹配当前目录，不递归子文件夹
ls -d ./*.png

# 只列出文件名（不带路径）
ls -1 ./*.png


# find 命令
# -maxdepth 1 限制只搜索当前层级，不进入子目录
find . -maxdepth 1 -type f -name "*.png"

# 加上 -delete 删除文件
find . -maxdepth 1 -type f -name "*.png" -delete


# grep + ls
ls | grep '\.png$'
```

## 复制/移动
```bash
# 复制 a 目录下所有 png 文件 到 b目录下，是当前目录下的 a 目录 和 b 目录
cp a/*.png b

# 生成 bak 文件，生成 config.yaml.20250301.bak 备份文件
cp config.yaml config.yaml.$(date +%Y%m%d).bak

# dist 重命名为 app
mv dist app
```

## 上传下载
```bash
# 上传 foo.html 到服务器 /usr/share/nginx/html 目录下
scp ./foo.html user@remote_ip:/usr/share/nginx/html
# 上传 bar 目录 到服务器 /usr/share/nginx/html 目录下
scp -r bar user@remote_ip:/usr/share/nginx/html
# 上传 dist 目录下所有文件 到服务器 /usr/share/nginx/html/app 目录下， dist/* dist/ 都可以
scp -r dist/* user@remote_ip:/usr/share/nginx/html/app/
# 下载 /usr/share/nginx/html/foo.html 文件 到 当前目录下
scp user@remote_ip:/usr/share/nginx/html/foo.html ./
```

另外常用的上传还有 `rsync` 命令，它可以实现增量备份和同步，在传输大量文件时通常效率更高，因为它只传输变更的部分。
```bash
# 上传 foo.html 到服务器 /usr/share/nginx/html 目录下
rsync -avz ./foo.html user@remote_ip:/usr/share/nginx/html
# 上传 bar 目录 到服务器 /usr/share/nginx/html 目录下
rsync -avz bar user@remote_ip:/usr/share/nginx/html
# 上传 dist 目录下所有文件 到服务器 /usr/share/nginx/html/app 目录下
rsync -avz dist/ user@remote_ip:/usr/share/nginx/html/app/
# 增量备份本地目录到远程目录
rsync -avz --delete /path/to/local/dir user@remote_ip:/path/to/remote/dir
```
- `-a` ：归档模式，保留文件权限、所有权等信息。
- `-v` ：详细模式，显示传输过程。
- `-z` ：压缩传输，提高效率。
- `--delete` ：在源目录中删除的文件，在目标目录中也会被删除，以保持两边文件的一致性。
**使用 `--delete` 前请确认源目录正确无误，最好先加 `--dry-run` 测试。`--dry-run` 会模拟执行同步过程，显示哪些文件会被传输、哪些会被删除，但不会真正执行任何操作。**

## ssh
使用 kr 当跳板机登录 rn
```bash
ssh -J kr rn
```
如果想让 ssh rn 默认走跳板，把 ~/.ssh/config 的 Host rn 加一行：ProxyJump kr

通过代理登录服务器
```bash
ssh -o ProxyCommand="nc -x 127.0.0.1:7890 %h %p" user@remote_ip
```

## 网络相关
```bash
# 查询服务器指定端口是否开启
nc -vz remote_ip 8443
```

查询指定端口占用
```bash
# 查看监听 + 连接状态，显示进程
sudo ss -tulnp | grep :5300

# 查看占用5300端口的进程
sudo lsof -i :5300
```