import { Button } from "~/components/ui/button";
import { useChatDispatch, useChatState } from "../llm-chat-context";
import { RefreshCcw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useEntityId } from "~/hooks/use-entity-id";
import { clearStorage } from "../storage/local-chat-storage";

export const Reset = () => {
  const dispatch = useChatDispatch();
  const { mode } = useChatState();
  const documentId = useEntityId();

  const handleReset = () => {
    if (documentId) {
      // Clear localStorage for current documentId + mode
      clearStorage(documentId, mode);
    }
    // Reset state (preserves current mode)
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
