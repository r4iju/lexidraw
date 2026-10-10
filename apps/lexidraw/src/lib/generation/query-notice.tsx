import { Button } from "~/components/ui/button";
import type { QueryAccess } from "./query-access";
export function QueryNotice({
  access,
  retry,
}: {
  access: QueryAccess<unknown>;
  retry: () => void;
}) {
  if (access.kind === "ready" || access.kind === "disabled") return null;
  return (
    <div role={access.kind === "error" ? "alert" : "status"}>
      <p>{access.message}</p>
      {access.kind === "error" && (
        <Button type="button" variant="outline" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
