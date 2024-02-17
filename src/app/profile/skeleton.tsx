export default function FormSkeleton() {
  return (
    <div className="animate-pulse space-y-10 py-2">
      {/* Fields */}
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={index}
          className="min-h-[42px] w-full rounded border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        ></div>
      ))}
      {/* Button */}
      <div className="min-h-[42px] w-full rounded bg-gray-600 text-sm font-bold text-white"></div>
    </div>
  );
}
