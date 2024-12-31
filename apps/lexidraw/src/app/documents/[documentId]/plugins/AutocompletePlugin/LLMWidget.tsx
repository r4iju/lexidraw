"use client";

import { RotateCw, CheckCircleIcon } from "lucide-react";
import { useLLM } from "../../context/llm-context";
import { Progress } from "~/components/ui/progress";
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

export function LLMWidget() {
  const {
    llmState: { loading, progress, text },
  } = useLLM();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const textLower = text.toLowerCase();
    if (textLower.includes("ready") || textLower.includes("finish")) {
      const timeout = setTimeout(() => {
        setHidden(true);
      }, 2000);
      return () => clearTimeout(timeout);
    } else {
      if (hidden === true) {
        setHidden(false);
      }
    }
  }, [text, hidden]);

  return (
    <div
      // animate in and out
      className={cn(
        "fixed bottom-4 right-4 z-50 border bg-background w-full max-w-sm h-20 p-2 rounded-md shadow-md transition-transform duration-300 ease-in-out",
        hidden ? "translate-x-full opacity-0" : "translate-x-0 opacity-100",
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {loading && <RotateCw className="size-4 animate-spin" />}
          {!loading && <CheckCircleIcon className="size-4" />}
          <Progress value={progress} max={1} className="w-full" />
        </div>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
