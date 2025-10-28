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
import { useSettings } from "../../context/settings-context";

export function LlmModelSelector({ className }: { className?: string }) {
  const {
    llmConfig: llmConfigState,
    setLlmConfiguration,
    availableModels,
  } = useLLM();

  const { settings, setOption } = useSettings();

  const [selectedMode, setSelectedMode] = useState<"chat" | "autocomplete">(
    "chat",
  );

  const currentState =
    selectedMode === "chat" ? llmConfigState.chat : llmConfigState.autocomplete;

  const isCurrentModeEnabled = settings[selectedMode];

  const [localTemperature, setLocalTemperature] = useState<string>("0");
  const [localMaxTokens, setLocalMaxTokens] = useState<string>("0");

  useEffect(() => {
    setLocalTemperature(currentState.temperature.toString());
    setLocalMaxTokens(currentState.maxOutputTokens.toString());
  }, [currentState]);

  const handleTemperatureBlur = () => {
    const tempValue = parseFloat(localTemperature);
    if (!Number.isNaN(tempValue) && tempValue >= 0 && tempValue <= 1) {
      if (tempValue !== currentState.temperature) {
        setLlmConfiguration({
          [selectedMode]: {
            temperature: tempValue,
          },
        });
      }
    } else {
      setLocalTemperature(currentState.temperature.toString());
    }
  };
  const handleMaxTokensBlur = () => {
    const numValue = parseInt(localMaxTokens.replace(/\D/g, ""), 10);

    if (!Number.isNaN(numValue) && numValue >= 0) {
      const currentProvider = currentState.provider;
      let cappedValue = numValue;

      if (currentProvider === "openai") {
        cappedValue = Math.min(numValue, 32768);
      } else if (currentProvider === "google") {
        cappedValue = Math.min(numValue, 65535);
      }

      if (cappedValue !== currentState.maxOutputTokens) {
        setLlmConfiguration({
          [selectedMode]: {
            maxOutputTokens: cappedValue,
          },
        });
      }
      setLocalMaxTokens(cappedValue.toString());
    } else {
      setLocalMaxTokens(currentState.maxOutputTokens.toString());
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
            if (value === "chat") {
              setSelectedMode(value);
            }
          }}
          className="mb-3"
        >
          <TabsList className="grid w-full grid-cols-1">
            <TabsTrigger value="chat">Chat</TabsTrigger>
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
            checked={settings[selectedMode]}
            onCheckedChange={(checked: boolean | string) => {
              const isEnabled = checked === true;
              setOption(selectedMode, isEnabled);
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
            disabled={!isCurrentModeEnabled}
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
            disabled={!isCurrentModeEnabled}
          />
        </div>
        <DropdownMenuSeparator className="my-2" />

        <Label>Select Model</Label>
        <Command>
          <CommandInput
            placeholder="Search model..."
            disabled={!isCurrentModeEnabled}
          />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {availableModels.map((model) => (
                <CommandItem
                  key={model.modelId}
                  value={model.modelId}
                  disabled={!isCurrentModeEnabled}
                  onSelect={() => {
                    if (!isCurrentModeEnabled) return;

                    const newProvider = model.provider;
                    const newModelId = model.modelId;
                    let newMaxTokens = currentState.maxOutputTokens;

                    if (newProvider === "openai") {
                      newMaxTokens = 32768;
                    } else if (newProvider === "google") {
                      newMaxTokens = 65535;
                    }

                    if (
                      newModelId !== currentState.modelId ||
                      newProvider !== currentState.provider ||
                      newMaxTokens !== currentState.maxOutputTokens
                    ) {
                      setLlmConfiguration({
                        [selectedMode]: {
                          modelId: newModelId,
                          provider: newProvider,
                          maxOutputTokens: newMaxTokens,
                        },
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
