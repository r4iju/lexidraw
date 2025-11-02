<!-- 35a744f9-6b9e-44f8-9fe9-263e9c241a88 05b77f50-f639-4f7a-bca6-3761fa213152 -->
# Export Documents as Markdown

### Scope

- Add an "Export → Markdown (.md)" action to Documents that converts the active Lexical `EditorState` to Markdown and downloads a `.md` file client‑side.
- Reuse existing Lexical Markdown transformers so custom nodes serialize sensibly.

### Key references

```114:121:apps/lexidraw/src/app/documents/[documentId]/plugins/options-dropdown.tsx
          <DropdownMenuItem onClick={() => toast.error("Not implemented yet!")}>
            Import from file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toast.error("Not implemented yet!")}>
            Export to file
          </DropdownMenuItem>
```
```6:25:apps/lexidraw/src/app/documents/[documentId]/utils/markdown.ts
export const useMarkdownTools = () => {
  const convertEditorStateToMarkdown = useCallback(
    (editorState: EditorState): string => {
      return editorState.read(() => {
        try {
          const md = $convertToMarkdownString(PLAYGROUND_TRANSFORMERS);
          return md?.trim() ?? "";
        } catch (e) {
          console.error("[convertEditorStateToMarkdown] export error:", e);
          return "";
        }
      });
    },
    [],
  );

  return { convertEditorStateToMarkdown };
};
```
```480:489:apps/lexidraw/src/app/documents/[documentId]/document-editor.tsx
<OptionsDropdown
  className="flex h-12 md:h-10 min-w-12 md:min-w-10"
  onSaveDocument={handleSave}
  isSavingDocument={isUploading}
  entity={{ id: entity.id, title: entity.title, accessLevel: entity.accessLevel }}
/>
```

### Files to change

- `apps/lexidraw/src/app/documents/[documentId]/context/save-and-export.ts`
- `apps/lexidraw/src/app/documents/[documentId]/plugins/options-dropdown.tsx`
- `apps/lexidraw/src/app/documents/[documentId]/document-editor.tsx`

### Implementation steps

1) Extend export hook

- In `useSaveAndExportDocument`, import `useMarkdownTools` and expose `exportMarkdown()`:
  - Guard `editorStateRef.current`.
  - Convert using `convertEditorStateToMarkdown(editorState)`.
  - Compose filename from sanitized title (fallback `document.md`).
  - Create Blob with `text/markdown;charset=utf-8` and trigger download.
  - Toast on success/failure.

2) Wire UI entry point

- Replace the single "Export to file" placeholder in `options-dropdown.tsx` with a submenu `Export to file ▸` and add an item `Markdown (.md)` that calls the new `onExportMarkdown` prop.

3) Plumb prop from editor

- In `document-editor.tsx`, pass `onExportMarkdown={exportMarkdown}` from `useSaveAndExportDocument` to `OptionsDropdown`.

4) Naming & styles

- Keep UI within shadcn dropdown components; follow Tailwind v4 semantic tokens. No changes to `globals.css`.

5) Behavioral details

- Filename: kebab/slug of `entity.title` limited to ~60 chars; default `document.md`.
- Content: pure Markdown from transformers; no frontmatter for MVP.
- Leave images/embeds as links (no asset bundling) for now.

6) Manual QA

- Open a document with headings, lists, tables, images, custom nodes.
- Click `Export → Markdown (.md)` and verify: file downloads, name is correct, content renders in a Markdown viewer.

### Future enhancements (not in scope)

- Optional YAML frontmatter (title, tags, createdAt).
- Image asset bundling (zip) and path rewriting.
- Additional export targets: HTML, PNG, SVG, PDF.

### To-dos

- [ ] Add exportMarkdown to useSaveAndExportDocument
- [ ] Add Export→Markdown item in options-dropdown.tsx
- [ ] Pass onExportMarkdown from document-editor to OptionsDropdown
- [ ] Create sanitized filename, blob, and download flow
- [ ] Smoke test export in UI with a complex doc