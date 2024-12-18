type Props = Readonly<{
  "data-test-id"?: string;
  accept?: string;
  label: string;
  onChange: (files: FileList | null) => void;
}>;

export default function FileInput({
  accept,
  label,
  onChange,
  "data-test-id": dataTestId,
}: Props): React.JSX.Element {
  return (
    <div className="flex flex-row items-center mb-2">
      <label className="flex-1 text-muted-foreground">{label}</label>
      <input
        type="file"
        accept={accept}
        className="flex-2 border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        onChange={(e) => onChange(e.target.files)}
        data-test-id={dataTestId}
      />
    </div>
  );
}
