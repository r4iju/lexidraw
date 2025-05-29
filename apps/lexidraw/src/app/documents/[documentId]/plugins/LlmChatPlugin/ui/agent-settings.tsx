import React, { useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { SettingsIcon } from "lucide-react";
import { useChatState, useChatDispatch } from "../llm-chat-context";
import { z } from "zod";

export const AgentSettings: React.FC = () => {
  const { maxAgentSteps } = useChatState();
  const dispatch = useChatDispatch();
  const [showSettings, setShowSettings] = useState(false);

  const handleMaxStepsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const value = z.coerce.number().min(1).max(25).parse(e.target.value);
      dispatch({ type: "setMaxAgentSteps", steps: value });
    } catch (error) {
      console.warn("Invalid max agent steps value:", e.target.value, error);
    }
  };

  return (
    <div className="flex flex-row-reverse px-2 pt-2 gap-2 items-center">
      <Button
        variant="outline"
        size="icon"
        onClick={() => setShowSettings(!showSettings)}
        aria-label={
          showSettings ? "Hide agent settings" : "Show agent settings"
        }
      >
        <SettingsIcon className="size-4" />
      </Button>

      {showSettings && (
        <div className="flex flex-col w-full gap-2 flex-1">
          {/* max agent steps */}
          <div className="flex flex-row w-full items-center gap-2">
            <Label
              htmlFor="max-agent-steps"
              className="text-xs font-medium text-muted-foreground pl-1"
            >
              Max Tool Steps
            </Label>
            <Input
              className="flex-1"
              id="max-agent-steps"
              type="number"
              value={maxAgentSteps}
              onChange={handleMaxStepsChange}
              min={1}
              max={25}
              aria-label="Maximum agent tool steps"
            />
            {/* other settings? */}
          </div>
        </div>
      )}
    </div>
  );
};
