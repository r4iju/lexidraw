export default function FormSkeleton() {
  return (
    <div className="flex animate-pulse justify-end gap-3">
      <div className="h-10 w-20 rounded-md border border-input bg-card" />
      <div className="h-10 w-24 rounded-md bg-muted" />
    </div>
  );
}
