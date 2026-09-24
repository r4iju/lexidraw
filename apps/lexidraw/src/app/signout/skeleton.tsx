export default function FormSkeleton() {
  return (
    <div className="animate-pulse space-y-10 py-2">
      {Array.from({ length: 1 }).map((_, i) => (
        <div
          key={`signout-skel-${
            // biome-ignore lint/suspicious/noArrayIndexKey: fine for skeleton
            i
          }`}
          className="min-h-[42px] w-full rounded border border-input bg-card text-foreground"
        ></div>
      ))}
      <div className="min-h-[42px] w-full rounded bg-muted text-sm font-bold text-paper-white"></div>
    </div>
  );
}
