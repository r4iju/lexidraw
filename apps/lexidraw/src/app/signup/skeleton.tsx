export default function FormSkeleton() {
  return (
    <div className="animate-pulse space-y-8 py-2">
      <div className="min-h-[42px] w-full rounded bg-gray-600 text-sm font-bold text-white"></div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={`signup-skeleton-input-${
            // biome-ignore lint/suspicious/noArrayIndexKey: fine for skeleton
            i
          }`}
          className="min-h-[42px] w-full rounded border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        ></div>
      ))}
      <div className="min-h-[42px] w-full rounded bg-gray-600 text-sm font-bold text-white"></div>
    </div>
  );
}
