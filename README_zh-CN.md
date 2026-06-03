# PDF to Markdown for Zotero

[English](README.md) | 中文

一个 Zotero 插件:将 PDF 附件转换为 Markdown,并可将附件导出到指定文件夹。

相比 PDF,Markdown 更易解析和检索,配合大模型使用时也更节省上下文,
适合 AI、Agent 及脚本类工作流。

转换由 [MinerU](https://github.com/opendatalab/MinerU) 完成。

> 非官方插件,与 MinerU / OpenDataLab、Zotero 均无关联。

## 安装

从 [Releases](https://github.com/qingpy/zotero-pdf2md/releases) 下载
`zotero-pdf2md.xpi`,在 Zotero 中:**工具 → 插件 → ⚙ → Install Plugin From File**。
支持 Zotero 7–10。

## 配置

在 <https://mineru.net/apiManage> 申请 API Token(免费,目前有效期 90 天),
填入 **编辑 → 设置 → PDF to Markdown**。

未填写 Token 时,将使用 MinerU 的轻量接口(单个 PDF ≤10 MB、≤20 页,按 IP 限流)。

## 使用

- 右键条目 → **Convert to Markdown (MinerU)**:转换结果 `<PDF 文件名>.md`
  作为子附件保存在条目下。已转换的条目自动跳过;转换期间再次发起会进入队列。
  进度显示在窗口右下角。
- 右键条目 → **Export Attachments**(默认文件夹)/ **Export Attachments To…**
  (每次选择文件夹):先选择文件类型,再将附件复制到目标位置。
- 设置项:模型(`vlm`/`pipeline`)、语言、OCR / 公式 / 表格识别、
  新增 PDF 自动转换、默认导出文件夹。

## 限制

- Token 接口:单个 PDF ≤200 MB / ≤200 页;每日 1000 页高优先级额度。
- PDF 会上传至 mineru.net 进行解析。
- 仅保存 Markdown 文本,`.md` 中引用的图片不会下载。
- 调试日志:帮助 → 调试输出,查看 `PDF2MD:` 开头的行。

## 从源码构建

```
node build-xpi.mjs addon build/zotero-pdf2md.xpi
```

(或运行 `.\build.ps1`)

## 致谢

- [MinerU](https://github.com/opendatalab/MinerU)
- [linux.do](https://linux.do)

## 许可

[MIT](LICENSE)
