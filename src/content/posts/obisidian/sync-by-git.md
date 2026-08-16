---
pubDatetime: 2026-05-19T15:22:00Z
title: Obsidian 使用 Git 实现 Windows、macOS、iOS 与 Android 多端同步
slug: sync-by-git
tags:
  - Obisidian
  - Tools
  - Git
description: ""
---

Obsidian 官方同步服务简单稳定，但需要付费。如果你熟悉 Git，也可以使用 GitHub 或 Gitee 私有仓库，在电脑、iPhone 和 Android 设备之间同步笔记。

本文介绍一套基于 Git 的多端同步方案：

* PC：Obsidian Git 插件
* iOS：iSH + Obsidian Git 插件
* Android：Termux + Obsidian Git 插件
* 远程仓库：GitHub 或 Gitee 私有仓库

> Git 同步更适合作为个人笔记同步方案。多台设备同时编辑同一个文件时，仍然可能产生 Git 冲突。

## 一、安装 Obsidian

前往 [Obsidian 官网](https://obsidian.md/download) 下载并安装对应平台的客户端。

首次打开时，可以新建一个仓库，也可以打开已有文件夹作为 Obsidian 仓库（Vault）。

## 二、创建私有 Git 仓库

在 GitHub 或 Gitee 创建一个私有仓库，例如：

```text
notes
```

建议将仓库设置为 Private，避免个人笔记意外公开。

### 配置 `.gitignore`

不建议直接忽略整个 `.obsidian` 目录，否则主题、插件及大部分 Obsidian 配置都无法在设备间同步。

建议只忽略容易产生冲突的工作区状态文件：

```gitignore
# Obsidian 工作区状态
.obsidian/workspace.json
.obsidian/workspace-mobile.json

# 系统文件
.DS_Store
Thumbs.db

# 回收站
.trash/
```

如果你不希望同步任何 Obsidian 配置，也可以忽略整个目录：

```gitignore
.obsidian/
```

两种方式的区别如下：

| 配置方式                  | 同步内容          | 适用情况       |
| --------------------- | ------------- | ---------- |
| 仅忽略 `workspace*.json` | 同步主题、插件和大部分设置 | 推荐，多端体验更一致 |
| 忽略整个 `.obsidian/`     | 只同步笔记和附件      | 每台设备需要独立配置 |

## 三、PC 端同步

Windows、macOS 和 Linux 可以通过 Obsidian Git 插件完成自动同步。

### 1. 安装 Git

从 [Git 官网](https://git-scm.com/downloads) 下载并安装 Git。

安装完成后检查版本：

```bash
git --version
```

### 2. 克隆远程仓库

```bash
git clone https://github.com/用户名/notes.git
```

然后打开 Obsidian，选择：

```text
打开本地仓库 → 选择克隆得到的 notes 文件夹
```

### 3. 安装 Obsidian Git 插件

进入：

```text
设置 → 第三方插件 → 关闭安全模式 → 浏览
```

搜索并安装 **Git**，然后启用插件。

可以在插件设置中配置：

* 自动拉取间隔
* 自动提交和推送间隔
* 提交信息
* Obsidian 启动时自动拉取
* 文件修改后自动备份

建议启用：

```text
Pull updates on startup
Auto pull
Auto backup
```

首次同步前，最好先执行一次：

```text
Obsidian Git: Pull
```

确认没有冲突后再提交和推送。

PC 端可以选择不使用 Obsidian 客户端，使用命令行进行 git 推送拉取，选择其它的 md 编辑器。

## 四、iOS 端同步

iOS 对文件系统的限制较多，可以使用 iSH 挂载 Obsidian 文件夹，然后在 iSH 中执行 Git 操作。

> iSH 方案存在性能和稳定性限制。如果笔记库较大，Git 操作可能比较慢，甚至出现卡住的情况。

### 1. 安装依赖

安装并打开 iSH，然后执行：

```sh
apk update
apk add git vim openssh openrc
```

### 2. 挂载 Obsidian 文件夹

在 iSH 中创建挂载目录：

```sh
cd ~
mkdir -p repo
mount -t ios-unsafe . repo
```

执行 `mount` 后，iOS 会弹出目录选择器。

请选择用于保存 Obsidian 仓库的上一级目录。例如准备将仓库保存到：

```text
On My iPhone/Obsidian/notes
```

此时应选择：

```text
On My iPhone/Obsidian
```

### 3. 克隆远程仓库

挂载成功后执行：

```sh
cd ~/repo
git clone https://github.com/用户名/notes.git
```

克隆完成后，在 Obsidian 中选择：

```text
打开本地仓库 → On My iPhone → Obsidian → notes
```

### 4. 配置 Git 身份

```sh
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

### 5. 配置 GitHub Token

GitHub 已经不支持使用账号密码进行 HTTPS Git 认证，需要使用 Personal Access Token。

进入：

```text
GitHub → Settings → Developer settings
→ Personal access tokens → Fine-grained tokens
→ Generate new token
```

为 Token 指定需要同步的私有仓库，并授予仓库内容读写权限：

```text
Repository permissions → Contents → Read and write
```

Git 要求输入密码时：

* Username：GitHub 用户名
* Password：刚刚生成的 Personal Access Token

> Token 相当于密码，请勿写入笔记、脚本或提交到 Git 仓库。

### 6. 安装 Obsidian Git 插件

在 Obsidian 中进入：

```text
设置 → 第三方插件
```

搜索、安装并启用 **Git** 插件。

不同版本的插件设置项可能有所不同。如果插件提供认证配置，可以填写：

* Username：GitHub 用户名
* Personal Access Token：GitHub Token
* Author Name：Git 提交用户名
* Author Email：Git 提交邮箱

如果移动端插件运行不稳定，也可以直接在 iSH 中同步：

```sh
cd ~/repo/notes
git pull --rebase
git add .
git commit -m "Update notes from iPhone"
git push
```

如果没有文件变化，`git commit` 提示 `nothing to commit` 属于正常现象。

## 五、解决 iSH 执行 Git 命令卡住的问题

iSH 挂载 iOS 文件目录后，Git 操作有时会卡住。相关讨论：

* [iSH Issue #1640](https://github.com/ish-app/ish/issues/1640)
* [iSH Issue #1581](https://github.com/ish-app/ish/issues/1581)

即使使用 `ios-unsafe` 参数，部分设备上仍然可能出现问题。一种可行的处理方式是：每次执行 Git 操作前重新挂载目录。

创建脚本：

```sh
cd ~
vim remount.sh
```

写入：

```sh
#!/bin/sh

cd ~
umount repo 2>/dev/null
mount -t ios-unsafe . repo
```

添加执行权限：

```sh
chmod +x ~/remount.sh
```

以后执行 Git 操作前运行：

```sh
~/remount.sh
```

然后进入仓库：

```sh
cd ~/repo/notes
git pull --rebase
```

> 重新挂载时，iOS 可能再次要求选择目录，请始终选择同一个 Obsidian 上级目录。

## 六、Android 端同步

Android 可以使用 Termux 操作共享存储中的 Obsidian 仓库。

建议从 [Termux GitHub Releases](https://github.com/termux/termux-app/releases) 或 F-Droid 安装 Termux，不建议使用长期未更新的 Google Play 版本。

### 1. 安装依赖

打开 Termux，执行：

```sh
pkg update
pkg install git vim openssh
```

### 2. 授予存储权限

执行：

```sh
termux-setup-storage
```

Android 会弹出文件访问权限请求，选择“允许”。

授权后，Termux 会在主目录中创建：

```text
~/storage
```

常用目录包括：

```text
~/storage/shared
~/storage/downloads
~/storage/dcim
```

其中 `~/storage/shared` 对应手机共享存储的根目录。

### 3. 克隆远程仓库

进入共享存储并创建 Obsidian 目录：

```sh
mkdir -p ~/storage/shared/Obsidian
cd ~/storage/shared/Obsidian
git clone https://github.com/用户名/notes.git
```

配置 Git 身份：

```sh
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

然后在 Obsidian 中选择：

```text
打开本地仓库 → 内部存储 → Obsidian → notes
```

### 4. 执行同步

同上，安装 Obsidian Git 插件实现自动同步。

## 七、推荐的同步顺序

为了降低冲突概率，每次编辑笔记时遵循下面的顺序：

```text
开始编辑前：Pull
完成编辑后：Commit → Push
切换设备后：先 Pull，再编辑
```

常用命令如下：

```sh
git pull --rebase
git add .
git commit -m "Update notes"
git push
```

如果两台设备同时修改同一个文件，Git 可能提示冲突。此时不要强制推送，应先打开冲突文件，保留正确内容并删除冲突标记，然后重新提交。

## 八、注意事项

### 不要把 Git 当作实时同步工具

Git 更接近版本管理工具，不会像 iCloud 或 Obsidian Sync 那样实时合并修改。频繁在多台设备之间切换时，一定要养成“先拉取、后编辑、再推送”的习惯。

### 不要在多台设备同时编辑同一篇笔记

这是产生 Git 冲突最常见的原因。尤其要避免电脑和手机同时打开并修改同一个 Markdown 文件。

### 定期检查同步状态

不要只依赖自动同步。建议定期检查：

```sh
git status
```

正常情况下会显示：

```text
nothing to commit, working tree clean
```

### 仓库必须设置为私有

笔记中可能包含个人资料、账号信息或工作内容。创建远程仓库时，应确认仓库可见性为 Private。

### GitHub Token 应使用最小权限

Fine-grained Token 只授权给 Obsidian 笔记仓库，并仅开放所需的 Contents 读写权限。不要使用权限范围过大的 Token。

## 九、相关资料

* [Obsidian 官网](https://obsidian.md)
* [Obsidian Git 插件](https://github.com/Vinzent03/obsidian-git)
* [Termux GitHub Releases](https://github.com/termux/termux-app/releases)
* [Obsidian 使用 Git 进行多终端同步](https://zhuanlan.zhihu.com/p/697196173)
* [网状的思考，线性的写作](https://www.codedump.info/post/20220612-weekly-18/)
* [阮一峰：最适合程序员的笔记软件](https://www.ruanyifeng.com/blog/2021/08/best-note-taking-software-for-programmers.html)

## 总结

使用 Git 同步 Obsidian 的优势是免费、可控，并且天然保留文件历史版本；缺点是配置相对复杂，移动端稳定性不如官方同步服务。

如果你的笔记主要在电脑上编辑，手机只用于查看和少量修改，这套方案比较实用。如果经常在多台移动设备之间切换，或者需要实时同步，Obsidian Sync、iCloud 或其他专业同步工具通常更省心。
