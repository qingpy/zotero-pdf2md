# PDF to Markdown for Zotero

English | [中文](README_zh-CN.md)

A Zotero plugin that converts PDF attachments to Markdown and exports
attachments to a folder.

Markdown is easier to parse and search than PDF, and consumes less context
when used with language models — useful for AI, agent, and scripting
workflows.

Conversion is performed by [MinerU](https://github.com/opendatalab/MinerU),
which works well in practice.

> Unofficial plugin. Not affiliated with MinerU/OpenDataLab or Zotero.

## Install

Download `zotero-pdf2md.xpi` from [Releases](https://github.com/qingpy/zotero-pdf2md/releases),
then in Zotero: **Tools → Plugins → ⚙ → Install Plugin From File**.
Compatible with Zotero 7–10.

## Setup

Obtain an API token at <https://mineru.net/apiManage> (free; currently valid
for 90 days) and enter it under **Edit → Settings → PDF to Markdown**.

Without a token, conversion falls back to MinerU's light API
(≤10 MB, ≤20 pages per PDF, IP rate-limited).

## Usage

- Right-click items → **Convert to Markdown (MinerU)**: attaches
  `<pdf name>.md` next to the PDF. Items that already have the `.md` are
  skipped; further requests are queued. Progress is shown in the lower right
  of the window.
- Right-click items → **Export Attachments** (default folder) /
  **Export Attachments To…** (choose folder): select a file type, and the
  files are copied to the destination.
- Settings: model (`vlm`/`pipeline`), language, OCR/formula/table
  recognition, auto-convert for new PDFs, export folder.

## Limitations

- Token API: ≤200 MB / ≤200 pages per PDF; 1,000 high-priority pages per day.
- PDFs are uploaded to mineru.net for conversion.
- Markdown only; image links inside the `.md` are not downloaded.
- Debug log: Help → Debug Output Logging, lines prefixed `PDF2MD:`.

## Building from source

```
node build-xpi.mjs addon build/zotero-pdf2md.xpi
```

(or `.\build.ps1`)

## Acknowledgments

- [MinerU](https://github.com/opendatalab/MinerU)
- [linux.do](https://linux.do)

## License

[MIT](LICENSE)
