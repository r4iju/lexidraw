import { LucideIcon } from "lucide-react";
import { Button, ButtonProps } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

type TooltipButtonProps = {
  onClick: () => void;
  disabled: boolean;
  title: string;
  Icon: LucideIcon;
  ariaLabel: string;
  className?: string;
  /** @default "outline" */
  variant?: ButtonProps["variant"];
};

export function TooltipButton({
  onClick,
  variant = "outline",
  disabled,
  title,
  Icon,
  ariaLabel,
  className,
}: TooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant ?? "outline"}
          disabled={disabled}
          onClick={onClick}
          aria-label={ariaLabel}
          className={cn("px-0.5 h-10 w-8", className)}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
