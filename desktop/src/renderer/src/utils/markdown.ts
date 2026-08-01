import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * 将服务端下发的 Markdown 转为安全 HTML。
 *
 * 信息差与自定义消息共用这一入口，确保两处的语法能力和 XSS 清洗规则一致。
 */
export function renderMarkdown(content: string): string {
  if (!content) return ''

  const html = marked.parse(content, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  })
}
