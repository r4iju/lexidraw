import { api } from "~/trpc/react";
import { useLLM } from "../../context/llm-context";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { cn } from "~/lib/utils";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Check } from "lucide-react";
import { Switch } from "~/components/ui/switch";

export function LlmModelSelector({ className }: { className?: string }) {
  const {
    chatState,
    setChatLlmOptions,
    autocompleteState,
    setAutocompleteLlmOptions,
    availableModels,
  } = useLLM();
  const utils = api.useUtils();

  // Fetch the config to get enabled states
  const { data: llmConfig, isLoading: isLoadingConfig } =
    api.config.getConfig.useQuery(
      undefined,
      { staleTime: 5 * 60 * 1000 }, // Fetch occasionally
    );

  // Mutation to update config
  const updateLlmConfigMutation = api.config.updateLlmConfig.useMutation({
    onSuccess: async () => {
      await utils.config.getConfig.invalidate(); // Refetch config after update
    },
    onError: (error) => {
      console.error("Failed to update LLM config:", error);
      // TODO: Add user feedback
    },
  });

  const [selectedMode, setSelectedMode] = useState<"chat" | "autocomplete">(
    "chat",
  );

  const currentState = selectedMode === "chat" ? chatState : autocompleteState;
  const currentSetter =
    selectedMode === "chat" ? setChatLlmOptions : setAutocompleteLlmOptions;

  const isCurrentModeEnabled =
    selectedMode === "chat"
      ? (llmConfig?.chat?.enabled ?? false)
      : (llmConfig?.autocomplete?.enabled ?? false);

  const [localTemperature, setLocalTemperature] = useState<string>("0");
  const [localMaxTokens, setLocalMaxTokens] = useState<string>("0");

  useEffect(() => {
    setLocalTemperature(currentState.temperature.toString());
    setLocalMaxTokens(currentState.maxTokens.toLocaleString());
  }, [currentState, selectedMode]);

  const handleTemperatureBlur = () => {
    const tempValue = parseFloat(localTemperature);
    if (!isNaN(tempValue) && tempValue >= 0 && tempValue <= 1) {
      if (tempValue !== currentState.temperature) {
        currentSetter({ temperature: tempValue });
      }
    } else {
      setLocalTemperature(currentState.temperature.toString());
    }
  };
  const handleMaxTokensBlur = () => {
    const numValue = parseInt(localMaxTokens.replace(/\D/g, ""), 10);
    if (!isNaN(numValue) && numValue >= 0) {
      if (numValue !== currentState.maxTokens) {
        currentSetter({ maxTokens: numValue });
      }
    } else {
      setLocalMaxTokens(currentState.maxTokens.toLocaleString());
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("flex gap-2 h-12 md:h-10", className)}
        >
          AI
          <ChevronDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[280px] p-2">
        <Tabs
          value={selectedMode}
          onValueChange={(value) => {
            if (value === "chat" || value === "autocomplete") {
              setSelectedMode(value);
            }
          }}
          className="mb-3"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="autocomplete">Autocomplete</TabsTrigger>
          </TabsList>
        </Tabs>

        <DropdownMenuItem
          className="flex items-center justify-between mb-1 pr-2"
          onSelect={(e) => e.preventDefault()}
        >
          <Label
            htmlFor={`enable-${selectedMode}`}
            className="font-normal cursor-pointer"
          >
            Enable {selectedMode === "chat" ? "Chat" : "Autocomplete"}
          </Label>
          <Switch
            id={`enable-${selectedMode}`}
            checked={isCurrentModeEnabled}
            disabled={isLoadingConfig}
            onCheckedChange={(checked: boolean | string) => {
              const isEnabled = checked === true;
              if (selectedMode === "chat") {
                updateLlmConfigMutation.mutate({
                  chat: { enabled: isEnabled },
                });
              } else {
                updateLlmConfigMutation.mutate({
                  autocomplete: { enabled: isEnabled },
                });
              }
            }}
          />
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-2" />

        <div className="mb-2">
          <Label>Temperature</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={localTemperature}
            onChange={(e) => setLocalTemperature(e.target.value)}
            onBlur={handleTemperatureBlur}
            disabled={isLoadingConfig || !isCurrentModeEnabled}
          />
        </div>
        <div className="mb-2">
          <Label>Max Tokens</Label>
          <Input
            type="text"
            inputMode="numeric"
            value={localMaxTokens}
            onChange={(e) => {
              const value = e.target.value.replace(/[^\d,]/g, "");
              setLocalMaxTokens(value);
            }}
            onBlur={handleMaxTokensBlur}
            disabled={isLoadingConfig || !isCurrentModeEnabled}
          />
        </div>
        <DropdownMenuSeparator className="my-2" />

        <Label>Select Model</Label>
        <Command>
          <CommandInput
            placeholder="Search model..."
            disabled={isLoadingConfig || !isCurrentModeEnabled}
          />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {availableModels.map((model) => (
                <CommandItem
                  key={model.modelId}
                  value={model.modelId}
                  disabled={isLoadingConfig || !isCurrentModeEnabled}
                  onSelect={() => {
                    if (isLoadingConfig || !isCurrentModeEnabled) return;
                    if (
                      model.modelId !== currentState.modelId ||
                      model.provider !== currentState.provider
                    ) {
                      currentSetter({
                        modelId: model.modelId,
                        provider: model.provider,
                      });
                    }
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      model.modelId === currentState.modelId
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {model.name} ({model.provider})
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
