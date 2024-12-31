import { LoaderIcon, CheckCircleIcon } from "lucide-react";
import { useLLM } from "../../context/llm-context";
import { Progress } from "~/components/ui/progress";
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

export function LLMWidget() {
  const {
    llmState: { loading: llmLoading, progress: llmProgress, text: llmText },
  } = useLLM();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const text = llmText.toLowerCase();
    if (text.includes("ready") || text.includes("finish")) {
      const timeout = setTimeout(() => {
        setHidden(true);
      }, 2000);
      return () => clearTimeout(timeout);
    } else {
      if (hidden === true) {
        setHidden(false);
      }
    }
  }, [llmText, hidden]);

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 border bg-background w-full max-w-sm h-16 p-2 rounded-md shadow-md",
        hidden && "hidden",
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {llmLoading && <LoaderIcon className="size-4 animate-spin" />}
          {!llmLoading && <CheckCircleIcon className="size-4" />}
          <Progress value={llmProgress} max={1} className="w-full" />
        </div>
        <p className="text-xs text-muted-foreground">{llmText}</p>
      </div>
    </div>
  );
}
