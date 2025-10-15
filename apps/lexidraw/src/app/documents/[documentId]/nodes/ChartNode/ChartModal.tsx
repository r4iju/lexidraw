"use client";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useDebounceValue } from "~/lib/client-utils";
import type { ChartType } from "./index"; // Assuming ChartNode is in the same directory
import DynamicChartRenderer from "./DynamicChartRenderer";
import type { ChartConfig } from "~/components/ui/chart";
import { cn } from "~/lib/utils";

const AVAILABLE_CHART_TYPES: ChartType[] = ["bar", "line", "pie"];

type Dimension = number | "inherit";

interface ChartModalProps {
  isOpen: boolean;
  initialChartType: ChartType;
  initialChartData: string; // JSON string
  initialChartConfig: string; // JSON string
  initialWidth: Dimension;
  initialHeight: Dimension;
  onCancel: () => void;
  onSave: ({
    newChartType,
    newChartData,
    newChartConfig,
    newWidthAndHeight,
  }: {
    newChartType: ChartType;
    newChartData: string;
    newChartConfig: string;
    newWidthAndHeight: { width: Dimension; height: Dimension };
  }) => void;
}

export default function ChartModal({
  isOpen,
  initialChartType,
  initialChartData,
  initialChartConfig,
  initialWidth,
  initialHeight,
  onCancel,
  onSave,
}: ChartModalProps) {
  const [chartType, setChartType] = useState<ChartType>(initialChartType);
  const [chartDataStr, setChartDataStr] = useState(initialChartData);
  const [chartConfigStr, setChartConfigStr] = useState(initialChartConfig);

  const [debouncedDataStr] = useDebounceValue(chartDataStr, 300);
  const [debouncedConfigStr] = useDebounceValue(chartConfigStr, 300);

  const [previewData, setPreviewData] = useState<unknown[]>([]);
  const [previewConfig, setPreviewConfig] = useState<ChartConfig>({});
  const [dataError, setDataError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [widthAndHeight, setWidthAndHeight] = useState<{
    width: string;
    height: string;
  }>({
    width: initialWidth === "inherit" ? "" : String(initialWidth),
    height: initialHeight === "inherit" ? "" : String(initialHeight),
  });

  useEffect(() => {
    try {
      const parsed = JSON.parse(debouncedDataStr);
      setPreviewData(Array.isArray(parsed) ? parsed : []);
      setDataError(null);
    } catch (_err) {
      console.error(_err);
      setPreviewData([]);
      setDataError("Invalid JSON for chart data.");
    }
  }, [debouncedDataStr]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(debouncedConfigStr);
      setPreviewConfig(
        typeof parsed === "object" && parsed !== null ? parsed : {},
      );
      setConfigError(null);
    } catch (_err) {
      console.error(_err);
      setPreviewConfig({});
      setConfigError("Invalid JSON for chart config.");
    }
  }, [debouncedConfigStr]);

  const saveDisabled = useMemo(() => {
    return chartDataStr.trim().length === 0 || !!dataError || !!configError;
  }, [chartDataStr, dataError, configError]);

  const handleWidthOrHeightChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    key: "width" | "height",
  ) => {
    setWidthAndHeight((prev) => ({
      ...prev,
      [key]: e.target.value,
    }));
  };

  const handleSave = () => {
    if (dataError || configError) return;

    const toNumberOrInherit = (raw: string): Dimension =>
      raw.trim() === "" || isNaN(Number(raw)) ? "inherit" : Number(raw);

    onSave({
      newChartType: chartType,
      newChartData: chartDataStr,
      newChartConfig: chartConfigStr,
      newWidthAndHeight: {
        width: toNumberOrInherit(widthAndHeight.width),
        height: toNumberOrInherit(widthAndHeight.height),
      },
    });
  };

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogOverlay />
      <DialogContent className="max-w-[95dvw] h-[95dvh] md:h-[85dvh] w-full flex flex-col p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>Edit Chart</DialogTitle>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden p-6 pt-0">
          {/* Config & Data Inputs */}
          <div className="flex flex-col gap-4 overflow-y-auto pr-2 pb-2">
            <div>
              <Label htmlFor="chartTypeSelect">Chart Type</Label>
              <Select
                value={chartType}
                onValueChange={(v) => setChartType(v as ChartType)}
              >
                <SelectTrigger id="chartTypeSelect">
                  <SelectValue placeholder="Select chart type" />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_CHART_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5 flex-1">
              <Label htmlFor="chartDataTextarea">Chart Data (JSON)</Label>
              <Textarea
                id="chartDataTextarea"
                value={chartDataStr}
                onChange={(e) => setChartDataStr(e.target.value)}
                placeholder='[{"name": "Jan", "value": 30}, ...]'
                className={cn(
                  "resize-none flex-1 font-mono text-sm",
                  dataError && "border-destructive",
                )}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
              {dataError && (
                <p className="text-xs text-destructive">{dataError}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5 flex-1">
              <Label htmlFor="chartConfigTextarea">Chart Config (JSON)</Label>
              <Textarea
                id="chartConfigTextarea"
                value={chartConfigStr}
                onChange={(e) => setChartConfigStr(e.target.value)}
                placeholder='{"value": {"label": "Visitors", "color": "hsl(var(--chart-1))"}}'
                className={cn(
                  "resize-none flex-1 font-mono text-sm",
                  configError && "border-destructive",
                )}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
              {configError && (
                <p className="text-xs text-destructive">{configError}</p>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="relative border rounded bg-background overflow-auto flex flex-col">
            <Label className="text-xs text-muted-foreground p-2 pb-0">
              Preview
            </Label>
            <div className="flex-1 p-2 min-h-[200px]">
              <Suspense
                fallback={
                  <Loader2 className="size-6 animate-spin mx-auto my-auto" />
                }
              >
                {!dataError && !configError && previewData.length > 0 ? (
                  <DynamicChartRenderer
                    chartType={chartType}
                    data={previewData}
                    config={previewConfig}
                    width="inherit" // Preview takes full width of its container
                    height="inherit" // Preview takes full height of its container
                  />
                ) : dataError || configError ? (
                  <div className="flex items-center justify-center h-full text-sm text-destructive px-4 text-center">
                    {dataError || configError}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Enter data and config to see a preview.
                  </div>
                )}
              </Suspense>
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 flex flex-row justify-between items-end gap-2 border-t">
          <div className="flex flex-row gap-2">
            <div>
              <Label htmlFor="chartWidthInput">Width</Label>
              <Input
                id="chartWidthInput"
                type="number"
                placeholder="auto"
                step={50}
                value={widthAndHeight.width}
                onChange={(e) => handleWidthOrHeightChange(e, "width")}
              />
            </div>
            <div>
              <Label htmlFor="chartHeightInput">Height</Label>
              <Input
                id="chartHeightInput"
                type="number"
                placeholder="auto"
                step={50}
                value={widthAndHeight.height}
                onChange={(e) => handleWidthOrHeightChange(e, "height")}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button disabled={saveDisabled} onClick={handleSave}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
