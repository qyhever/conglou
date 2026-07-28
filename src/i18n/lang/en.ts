import type { UIStrings } from "../types";

// export default {
//   nav: {
//     home: "Home",
//     posts: "Posts",
//     tags: "Tags",
//     about: "About",
//     archives: "Archives",
//     search: "Search",
//   },
//   post: {
//     publishedAt: "Published at",
//     updatedAt: "Updated",
//     sharePostIntro: "Share this post:",
//     sharePostOn: "Share this post on {{platform}}",
//     sharePostViaEmail: "Share this post via email",
//     tagLabel: "Tags",
//     backToTop: "Back to top",
//     goBack: "Go back",
//     editPage: "Edit page",
//     previousPost: "Previous Post",
//     nextPost: "Next Post",
//   },
//   pagination: {
//     prev: "Prev",
//     next: "Next",
//     page: "Page",
//   },
//   home: {
//     socialLinks: "Social Links",
//     featured: "Featured",
//     recentPosts: "Recent Posts",
//     allPosts: "All Posts",
//   },
//   footer: {
//     copyright: "Copyright",
//     allRightsReserved: "All rights reserved.",
//   },
//   pages: {
//     tagTitle: "Tag",
//     tagDesc: "All the articles with the tag",

//     tagsTitle: "Tags",
//     tagsDesc: "All the tags used in posts.",

//     postsTitle: "Posts",
//     postsDesc: "All the articles I've posted.",

//     archivesTitle: "Archives",
//     archivesDesc: "All the articles I've archived.",

//     searchTitle: "Search",
//     searchDesc: "Search any article ...",
//   },
//   a11y: {
//     skipToContent: "Skip to content",
//     openMenu: "Open menu",
//     closeMenu: "Close menu",
//     toggleTheme: "Toggle theme",
//     searchPlaceholder: "Search posts...",
//     noResults: "No results found",
//     goToPreviousPage: "Go to previous page",
//     goToNextPage: "Go to next page",
//   },
//   notFound: {
//     title: "404 Not Found",
//     message: "Page Not Found",
//     goHome: "Go back home",
//   },
// } satisfies UIStrings;

export default {
  nav: {
    home: "首页",
    posts: "文章",
    tags: "标签",
    about: "关于",
    archives: "归档",
    search: "搜索",
  },

  post: {
    publishedAt: "发布于",
    updatedAt: "更新于",
    sharePostIntro: "分享本文：",
    sharePostOn: "分享到 {{platform}}",
    sharePostViaEmail: "通过邮件分享",
    tagLabel: "标签",
    backToTop: "返回顶部",
    goBack: "返回",
    editPage: "编辑文章",
    previousPost: "上一篇",
    nextPost: "下一篇",
  },

  pagination: {
    prev: "上一页",
    next: "下一页",
    page: "第",
  },

  home: {
    socialLinks: "社交链接",
    featured: "精选文章",
    recentPosts: "最近文章",
    allPosts: "全部文章",
  },

  footer: {
    copyright: "Copyright",
    allRightsReserved: "All rights reserved.",
  },

  pages: {
    tagTitle: "标签",
    tagDesc: "该标签下的所有文章",
    tagsTitle: "标签",
    tagsDesc: "文章使用的所有标签。",
    postsTitle: "文章",
    postsDesc: "我发布的所有文章。",
    archivesTitle: "归档",
    archivesDesc: "按时间查看所有文章。",
    searchTitle: "搜索",
    searchDesc: "搜索博客文章。",
  },

  a11y: {
    skipToContent: "跳转到正文",
    openMenu: "打开菜单",
    closeMenu: "关闭菜单",
    toggleTheme: "切换主题",
    searchPlaceholder: "搜索文章……",
    noResults: "没有找到结果",
    goToPreviousPage: "转到上一页",
    goToNextPage: "转到下一页",
  },

  notFound: {
    title: "404 页面不存在",
    message: "没有找到该页面",
    goHome: "返回首页",
  },
} satisfies UIStrings;
