export default async function AdminLlmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>; // Sub-nav now rendered by parent Admin layout
}
