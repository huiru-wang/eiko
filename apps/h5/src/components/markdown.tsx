import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });
const defaultLinkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen ? defaultLinkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
};

export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => DOMPurify.sanitize(markdown.render(content), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['img', 'style', 'iframe', 'object'],
  }), [content]);
  return <article className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
