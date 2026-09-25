"use client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Loader2 } from "lucide-react";
import mermaid from "mermaid";
import { useEffect, useId, useMemo, useState } from "react";
import { useDebounceValue } from "~/lib/client-utils";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { mono } from "~/lib/fonts";
import { cn } from "~/lib/utils";

type Props = {
  isOpen: boolean;
  initialSchema: string;
  initialWidth: number | "inherit";
  initialHeight: number | "inherit";
  onCancel: () => void;
  onSave: ({
    schema,
    widthAndHeight,
  }: {
    schema: string;
    widthAndHeight: {
      width: number | "inherit";
      height: number | "inherit";
    };
  }) => void;
};

export default function MermaidModal({
  isOpen,
  initialSchema,
  initialWidth,
  initialHeight,
  onCancel,
  onSave,
}: Props) {
  const isDark = useIsDarkTheme();
  const id = useId();

  // ───────────── state ─────────────
  const [schema, setSchema] = useState(initialSchema);
  const [debouncedSchema] = useDebounceValue(schema, 250);
  const [svgUri, setSvgUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [widthAndHeight, setWidthAndHeight] = useState<{
    width: string;
    height: string;
  }>({
    width: initialWidth === "inherit" ? "" : String(initialWidth),
    height: initialHeight === "inherit" ? "" : String(initialHeight),
  });

  // ───────────── live preview ─────────────
  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
      });
      try {
        const { svg } = await mermaid.render(
          `prev-${Math.random().toString(36).slice(2)}`,
          debouncedSchema,
        );
        if (cancelled) return;

        const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`; // safer embed
        setSvgUri(uri);
        setError(null);
      } catch (err: unknown) {
        setSvgUri(null);
        setError(err instanceof Error ? err.message : "Failed to render");
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [debouncedSchema, isDark]);

  // ───────────── helpers ─────────────
  const saveDisabled = useMemo(() => schema.trim().length === 0, [schema]);

  const handleWidthOrHeightChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    key: "width" | "height",
  ) => {
    setWidthAndHeight((prev) => ({
      ...prev,
      [key]: e.target.value, // just keep the text
    }));
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (saveDisabled) return;
    const toNumberOrInherit = (raw: string): number | "inherit" =>
      raw.trim() === "" ? "inherit" : Number(raw);

    onSave({
      schema,
      widthAndHeight: {
        width: toNumberOrInherit(widthAndHeight.width),
        height: toNumberOrInherit(widthAndHeight.height),
      },
    });
  };

  if (!isOpen) return null;

  // ───────────── UI ─────────────
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent size="xl" className="flex flex-col sm:h-[80dvh]">
        <form onSubmit={handleSave} className="contents">
          <DialogHeader>
            <DialogTitle>Edit Mermaid diagram</DialogTitle>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-rows-2 gap-4 sm:grid-cols-2 sm:grid-rows-1">
            <Textarea
              aria-label="Diagram source"
              value={schema}
              onChange={(e) => setSchema(e.target.value)}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              className={cn(
                "resize-none w-full h-full font-mono font-semibold",
                mono.className,
              )}
            />
            <div className="relative border-border border rounded bg-background overflow-auto">
              {svgUri ? (
                <img
                  src={svgUri}
                  alt="diagram preview"
                  className="w-full h-full object-contain"
                />
              ) : error ? (
                <div className="flex items-center justify-center h-full text-sm text-destructive px-4 text-center">
                  {error}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-width`}>Width</Label>
              <Input
                id={`${id}-width`}
                type="number"
                placeholder="auto"
                step={50}
                value={widthAndHeight.width}
                onChange={(e) => handleWidthOrHeightChange(e, "width")}
                className="w-28"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-height`}>Height</Label>
              <Input
                id={`${id}-height`}
                type="number"
                placeholder="auto"
                step={50}
                value={widthAndHeight.height}
                onChange={(e) => handleWidthOrHeightChange(e, "height")}
                className="w-28"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveDisabled}>
              Save diagram
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
