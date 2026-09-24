import { Button } from "~/components/ui/button";
import { useChatDispatch, useChatState } from "../llm-chat-context";
import { MessageSquarePlus } from "lucide-react";
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
          variant="ghost"
          onClick={handleReset}
          aria-label="New conversation"
          className="shrink-0"
        >
          <MessageSquarePlus className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>New conversation</TooltipContent>
    </Tooltip>
  );
};
