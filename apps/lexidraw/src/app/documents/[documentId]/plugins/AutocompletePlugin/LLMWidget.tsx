"use client";

import { XCircleIcon, XIcon } from "lucide-react";
import { useLLM } from "../../context/llm-context";
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";

export function LLMWidget() {
  const {
    llmState: { isError, error },
  } = useLLM();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isError) {
      setHidden(false);
    }
  }, [isError]);

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 border bg-background w-full max-w-sm h-20 p-2 rounded-md shadow-md transition-transform duration-300 ease-in-out",
        hidden ? "translate-x-full opacity-0" : "translate-x-0 opacity-100",
        {
          "bg-destructive": isError,
        },
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            asChild
            onClick={() => setHidden(true)}
            className="h-6 w-6 p-1 cursor-pointer"
          >
            <XIcon />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    </div>
  );
}
