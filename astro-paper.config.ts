import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://blog.qyhever.com/",
    title: "Conglou's Space",
    description: "记录技术、AI、互联网和产品思考。",
    author: "Conglou",
    profile: "https://github.com/qyhever",
    ogImage: "default-og.jpg",
    lang: "en",
    timezone: "Asia/Shanghai",
    dir: "ltr",
  },
  posts: {
    // 文章列表每页数量
    perPage: 8,
    // 首页最近文章数量
    perIndex: 8,
    // 定时文章允许的时间误差
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    // 深色/浅色模式
    lightAndDarkMode: true,
    // 自动生成文章分享图
    dynamicOgImage: true,
    // 是否显示归档页面
    showArchives: true,
    // 是否显示返回按钮
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    // 启用 Pagefind 搜索
    search: "pagefind",
  },
  socials: [
    { name: "github",   url: "https://github.com/qyhever" },
    { name: "mail",     url: "mailto:conglou@qyhever.com" },
  ],
  shareLinks: [
    { name: "whatsapp", url: "https://wa.me/?text=" },
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "x",        url: "https://x.com/intent/post?url=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "pinterest", url: "https://pinterest.com/pin/create/button/?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});