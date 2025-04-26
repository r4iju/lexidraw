import { Button } from "~/components/ui/button";
import { useChatDispatch } from "../context/llm-chat-context";
import { RefreshCcw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

export const Reset = () => {
  const dispatch = useChatDispatch();

  const handleReset = () => {
    dispatch({ type: "reset" });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          onClick={handleReset}
          className="gap-2"
        >
          <RefreshCcw className="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Reset the chat</TooltipContent>
    </Tooltip>
  );
};
