import { cn } from "~/lib/utils";
import { Label } from "./label";

type Props = Readonly<{
  accept?: string;
  label?: string;
  className?: string;
  onChange: (files: FileList | null) => void;
}>;

export default function FileInput({
  accept,
  label,
  onChange,
  className,
}: Props): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && <Label className="flex-1 whitespace-nowrap">{label}</Label>}
      <input
        type="file"
        accept={accept}
        className={cn(
          "flex-2 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        )}
        onChange={(e) => onChange(e.target.files)}
      />
    </div>
  );
}
