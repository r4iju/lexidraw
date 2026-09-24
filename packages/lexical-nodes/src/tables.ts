import { $createTableNodeWithDimensions } from "@lexical/table";

export function $createDocumentTable(rows: number, columns: number) {
  return $createTableNodeWithDimensions(rows, columns, {
    rows: true,
    columns: false,
  });
}
