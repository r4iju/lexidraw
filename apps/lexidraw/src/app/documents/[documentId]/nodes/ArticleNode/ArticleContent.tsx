export function ArticleContent({ html }: { html: string }) {
  return (
    <div className="prose max-w-none dark:prose-invert" data-prose="scoped">
      <div
        // biome-ignore lint/security/noDangerouslySetInnerHtml: article HTML is sanitized at the server boundary
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
