# 📷 EXIF Remover

> 图片 EXIF 数据查看与删除工具 — 保护隐私，一键清除照片元数据

## ✨ 功能

| 功能 | 说明 |
|---|---|
| 👁️ **EXIF 查看** | 解析 JPEG 照片的 EXIF 元数据，包括相机型号、拍摄日期、曝光参数等 |
| 🗺️ **GPS 检测** | 检测并警告照片中的地理位置信息 |
| 🧹 **一键清除** | Canvas 重新编码图片，彻底删除所有元数据（EXIF、XMP、ICC 等） |
| 📊 **文件对比** | 清除前后文件大小对比，显示节省空间 |
| 🖼️ **多格式** | 支持 JPG、PNG、WebP、GIF |

## 🛠 技术栈

- 纯 HTML5 + CSS3 + JavaScript
- Canvas API（重新编码图片）
- JPEG EXIF 解析器（TIFF/IFD 结构解析）
- 零外部依赖

## 🚀 部署

支持 Vercel / Netlify / Cloudflare Pages 等静态托管平台。

```bash
npx vercel --prod
```

## 🔒 隐私

所有处理在浏览器端完成，**图片不上传服务器**。

## 📄 许可

MIT
