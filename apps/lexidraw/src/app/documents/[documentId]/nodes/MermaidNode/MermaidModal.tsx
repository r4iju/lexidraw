"use client";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Loader2 } from "lucide-react";
import mermaid from "mermaid";
import { useEffect, useMemo, useState } from "react";
import { useDebounceValue } from "~/lib/client-utils";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";

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
          "prev-" + Math.random().toString(36).slice(2),
          debouncedSchema,
        );
        if (cancelled) return;

        const uri = "data:image/svg+xml;utf8," + encodeURIComponent(svg); // safer embed
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

  const handleSave = () => {
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
      <DialogOverlay />
      <DialogContent className="max-w-screen-xl h-[80dvh] w-full flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Mermaid diagram</DialogTitle>
        </DialogHeader>

        <div className="flex-1 grid grid-rows-[58%_30%_10%] gap-4 overflow-hidden p-1">
          {/* Preview */}
          <div className="relative border rounded bg-background overflow-auto">
            {svgUri ? (
              // eslint-disable-next-line @next/next/no-img-element
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

          {/* Editor */}
          <Textarea
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            className="font-mono text-xs resize-none w-full h-full overflow-visible"
          />

          {/* width and height */}
          <div className="flex flex-row gap-2">
            <div className="flex flex-col items-center gap-1 justify-start">
              <Label>Width</Label>
              <Input
                type="number"
                placeholder="auto"
                step={50}
                value={widthAndHeight.width}
                onChange={(e) => handleWidthOrHeightChange(e, "width")}
              />
            </div>
            <div className="flex flex-col items-center gap-1 justify-start">
              <Label>Height</Label>
              <Input
                type="number"
                placeholder="auto"
                step={50}
                value={widthAndHeight.height}
                onChange={(e) => handleWidthOrHeightChange(e, "height")}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={saveDisabled} onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
