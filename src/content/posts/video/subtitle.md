---
pubDatetime: 2026-06-02T15:22:00Z
title: 内嵌字幕 硬字幕 外挂字幕的区别
slug: subtitle
featured: true
ogImage: https://r2.qyhever.com/subtitle/7739c2a0-19ae-4ebd-93b9-73b9dc559f00.png
tags:
  - Video
  - FFmpeg
description: "使用 yt-dlp 下载了内嵌字幕视频后放在 nginx 静态目录下，然后通过浏览器直接访问 下载的 .webm 文件，发现视频没有字幕，但是使用 vlc 播放器播放视频是可以正常显示字幕的，然后就了解了下 web 浏览器播放视频解析字幕和 视频里几种字幕的区别"
---

![cover](https://r2.qyhever.com/subtitle/7739c2a0-19ae-4ebd-93b9-73b9dc559f00.png)

起因是之前使用 yt-dlp 下载了内嵌字幕视频后放在 nginx 静态目录下，然后通过浏览器直接访问 下载的 .webm 文件，发现视频没有字幕，但是使用 vlc 播放器播放视频是可以正常显示字幕的，然后就了解了下 web 浏览器播放视频解析字幕和 视频里几种字幕的区别。

## 几种字幕的区别
三者的核心区别在于：**字幕是否已经“烧进”画面，以及字幕是否单独保存。**

| 类型   | 字幕存放方式            | 能否关闭/切换 |       是否影响画质 | 常见格式                        |
| ---- | ----------------- | ------: | -----------: | --------------------------- |
| 内嵌字幕 | 封装在视频文件内部，作为独立字幕轨 |      可以 |      不影响视频画面 | MKV、MP4 内的 SRT、ASS、PGS      |
| 硬字幕  | 已经压制到视频画面像素中      |     不可以 | 二次制作通常需要重新编码 | 视频画面的一部分                    |
| 外挂字幕 | 单独的字幕文件，与视频分开保存   |      可以 |      不影响视频画面 | `.srt`、`.ass`、`.ssa`、`.vtt` |

### 1. 内嵌字幕

内嵌字幕也叫**封装字幕、软字幕轨**。

例如一个 `movie.mkv` 文件里面同时包含：

```text
视频轨
音频轨：中文、英文
字幕轨：简体中文、繁体中文、英文
```

播放器可以自由选择：

* 显示或关闭字幕
* 切换不同语言
* 调整字幕大小和位置，具体取决于播放器
* 提取字幕轨

特点：

* 视频和字幕只有一个文件，管理方便
* 字幕不是画面的一部分
* 直接封装字幕通常很快，不需要重新编码视频
* MKV 对字幕支持最好；MP4 对 ASS 特效字幕的支持相对有限

### 2. 硬字幕

硬字幕也叫**烧录字幕、压制字幕**。

字幕已经变成视频画面的一部分，例如画面底部的文字实际上就是视频像素：

```text
原始画面 + 字幕 → 重新编码 → 带硬字幕的视频
```

特点：

* 任何播放器都能看到
* 不能关闭、切换或单独提取
* 字幕样式显示稳定，不依赖播放器
* 制作时通常需要重新编码，耗时较长
* 原字幕位置可能遮挡画面
* 再次压制可能导致画质损失

适合：

* 上传到不支持字幕轨的平台
* 确保复杂 ASS 特效字幕完整显示
* 需要所有观众强制看到字幕

### 3. 外挂字幕

外挂字幕是独立文件，例如：

```text
movie.mp4
movie.zh-CN.ass
movie.en.srt
```

通常只要字幕文件名和视频文件名相近，播放器就能自动加载。

特点：

* 可以关闭、切换、编辑
* 不需要修改视频文件
* 字幕更新和校对方便
* 复制或移动视频时容易漏掉字幕文件
* 不同播放器对 ASS 字体、动画、位置等效果支持可能不同

### 简单理解

可以把视频比作一本书：

* **外挂字幕**：夹在书里的独立翻译稿
* **内嵌字幕**：翻译稿装订在书中，但仍是独立页面
* **硬字幕**：翻译文字直接印在原始图片上，无法撕掉

需要自由开关和切换语言时，优先选择**内嵌字幕或外挂字幕**；追求最大兼容性、确保字幕样式不变时，使用**硬字幕**。

## yt-dlp 下载视频
默认情况下，yt-dlp 下载的是没有字幕轨道的视频

```bash
yt-dlp --cookies cookies.txt "https://www.bilibili.com/video/BV1qJ411t7ef"
```
> cookies.txt 是 netspace 格式的 cookie

如果字幕是视频画面的一部分，也就是硬字幕。yt-dlp 无法去掉，下载后自然带字幕。
```bash
yt-dlp --cookies cookies.txt "https://www.bilibili.com/video/BV1kH4y1j7dX"
```

下载前，可以先查询下视频有哪些字幕文件
```bash
# 列出全部字幕
yt-dlp --cookies cookies.txt --list-subs "https://www.bilibili.com/video/BV1qJ411t7ef"
# 输出结果只保留可用的中/英文字幕
yt-dlp --cookies cookies.txt --list-subs "https://www.bilibili.com/video/BV1qJ411t7ef" | egrep "en|zh"
```

下载时将字幕内嵌到视频
```bash
yt-dlp --cookies cookies.txt --write-auto-sub --sub-lang "ai-zh" --embed-sub "https://www.bilibili.com/video/BV1qJ411t7ef"
# 不下载视频，仅下载字幕
yt-dlp --cookies cookies.txt --write-auto-sub --sub-lang "ai-zh" --skip-download "https://www.bilibili.com/video/BV1qJ411t7ef"
```

## Web 浏览器原生播放器的限制
通过 yt-dlp 下载了一个内嵌字幕视频，放到 nginx 静态目录下，通过链接直接访问视频，视频正常播放，但没有显示字幕，这主要是 Web 浏览器原生播放器的限制。

大部分主流播放器如 VLC 会主动解析 MP4、MKV 容器中的字幕轨道；浏览器通过视频直链打开文件时，通常只处理其中的视频轨和音频轨，不一定解析或显示内嵌字幕轨道。

网页中最通用的方式是：视频和 WebVTT 字幕分开提供，通过 HTML 的 `<track>` 元素加载。HTML 标准及浏览器主要围绕 WebVTT 提供网页字幕支持。[MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video)

html 示例：
```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>视频播放</title>
  <style>
    video {
      width: min(100%, 1200px);
    }
  </style>
</head>
<body>
  <video controls preload="metadata">
    <source src="/videos/video.mp4" type="video/mp4">
    <track
      src="/videos/subtitle.zh.vtt"
      kind="subtitles"
      srclang="zh"
      label="中文"
      default
    >
    浏览器不支持 HTML5 视频。
  </video>
</body>
</html>
```

## ffmpeg 烧录硬字幕
如果希望任何播放器都必定显示字幕：可以烧录成硬字幕，但视频播放时字幕无法关闭。

但是烧录字幕是非常耗时的操作，一般采用高性能配置电脑会加快速度，烧录字幕不是简单地把字幕文件塞进视频，而是需要对视频逐帧解码、绘制字幕、再重新编码：
```ini
原视频 → 解码成每一帧 → 渲染字幕到画面 → 重新压缩编码 → 新视频
```

主要耗时通常在最后的**视频重新编码**。

### 为什么会慢

#### 1. 必须重新编码整个视频

外挂字幕或内嵌软字幕只需封装，通常几秒就完成：

```bash
ffmpeg -i input.mp4 -i subtitle.srt \
  -c copy -c:s mov_text output.mp4
```

但硬字幕会改变画面像素，因此不能使用：

```bash
-c:v copy
```

必须重新编码：

```bash
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v libx264 \
  -c:a copy \
  output.mp4
```

即使字幕只出现几分钟，也要处理视频的每一帧。

#### 2. 分辨率和帧率越高越慢

例如一小时的视频：

| 视频规格        | 大约需要处理的帧数 |
| ----------- | --------: |
| 1080p 24fps |  86,400 帧 |
| 1080p 60fps | 216,000 帧 |
| 4K 30fps    | 108,000 帧 |
| 4K 60fps    | 216,000 帧 |

4K 每帧的像素数量又是 1080p 的约 4 倍，因此会明显更慢。

#### 3. 编码器预设过慢

使用 `libx264` 时，`preset` 决定编码速度和压缩效率：

```bash
-preset ultrafast
-preset veryfast
-preset medium
-preset slow
-preset veryslow
```

越慢的 preset：

* 编码耗时越长
* 同等画质下文件更小
* 或同等码率下画质更好

FFmpeg 默认通常是：

```bash
-preset medium
```

可以改成：

```bash
-preset veryfast
```

例如：

```bash
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v libx264 \
  -preset veryfast \
  -crf 23 \
  -c:a copy \
  output.mp4
```

这是速度、画质和文件大小比较均衡的设置。

#### 4. 使用 CPU 软件编码

`libx264` 和 `libx265` 默认使用 CPU。

特别是 H.265：

```bash
-c:v libx265
```

通常比 H.264：

```bash
-c:v libx264
```

慢很多。

如果只是普通播放或上传，优先使用：

```bash
-c:v libx264
```

如果设备支持硬件编码，可以使用 GPU，大幅提升速度。

### 使用硬件加速

```bash
# NVIDIA 显卡
ffmpeg -hwaccel cuda \
  -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v h264_nvenc \
  -preset p5 \
  -cq 23 \
  -c:a copy \
  output.mp4

# NVIDIA 显卡 较快的设置
ffmpeg -hwaccel cuda \
  -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v h264_nvenc \
  -preset p3 \
  -cq 23 \
  -c:a copy \
  output.mp4

# Intel 核显 Quick Sync
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v h264_qsv \
  -global_quality 23 \
  -c:a copy \
  output.mp4

# AMD 显卡 Linux 常用：
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v h264_vaapi \
  -qp 23 \
  -c:a copy \
  output.mp4

# macOS Apple 芯片或 Intel Mac
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v h264_videotoolbox \
  -b:v 6M \
  -c:a copy \
  output.mp4
```

注意：字幕滤镜通常仍在 CPU 上渲染，但视频编码交给 GPU 后，整体依然会快很多。

macOS 的 VideoToolbox 一般速度很快，但通常使用码率控制，而不是 `CRF`。

### 字幕本身也可能拖慢速度

#### ASS 特效字幕

复杂的 `.ass` 字幕可能包含：

* 阴影
* 描边
* 模糊
* 动画
* 卡拉 OK 效果
* 多层字幕
* 大量字体切换
* 逐字定位

例如动态弹幕、特效字幕，会比普通 SRT 慢。

普通字幕：

```text
Hello world
```

复杂 ASS 可能每一帧都需要计算位置、透明度、描边和动画，因此滤镜本身也会成为瓶颈。

#### 字体缺失或字体查找缓慢

ASS 字幕使用自定义字体时，FFmpeg 可能需要查找系统字体。可以指定字体目录：

```bash
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.ass:fontsdir=./fonts" \
  -c:v libx264 \
  -preset veryfast \
  -crf 23 \
  -c:a copy \
  output.mp4
```

### 推荐命令

#### CPU 编码，兼顾速度和画质

```bash
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v libx264 \
  -preset veryfast \
  -crf 22 \
  -c:a copy \
  output.mp4
```

一般可以调整：

* `crf 18`：高画质，文件较大
* `crf 20–23`：常用范围
* `crf 28`：画质较低，文件较小

`CRF` 越小，画质越高、文件越大。

#### 追求最快 CPU 编码

```bash
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.srt" \
  -c:v libx264 \
  -preset ultrafast \
  -crf 23 \
  -c:a copy \
  output.mp4
```

不过 `ultrafast` 的文件通常会非常大。日常更建议：

```bash
-preset veryfast
```

#### NVIDIA 快速烧录

```bash
ffmpeg -hwaccel cuda \
  -i input.mp4 \
  -vf "subtitles=subtitle.ass" \
  -c:v h264_nvenc \
  -preset p4 \
  -cq 23 \
  -c:a copy \
  output.mp4
```

### 查看实际处理速度

FFmpeg 输出中通常有：

```text
speed=0.52x
```

含义是：

* `speed=1.0x`：处理一小时视频需要约一小时
* `speed=0.5x`：处理一小时视频需要约两小时
* `speed=2.0x`：处理一小时视频需要约半小时

也可以观察：

```text
fps=45
```

对于 30fps 视频，编码达到 45fps，速度大约是：

```text
45 ÷ 30 = 1.5x
```

因此，烧录字幕慢是正常现象。最有效的优化通常是：**改用 `libx264 -preset veryfast`，复制音频 `-c:a copy`，或者启用 NVIDIA、Intel、AMD、Apple 的硬件编码器。**
