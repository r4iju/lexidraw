import { z } from "zod";

const BlankableType = z.enum(["drawing", "document", "directory"]);

const createdEntity = z.object({
  id: z.string(),
  entityType: z.enum([...BlankableType.options, "url"]),
  title: z
    .string()
    .optional()
    .describe(
      'Omitted is "New document", "New drawing" or "New folder"; a url needs it',
    ),
  elements: z
    .string()
    .optional()
    .describe(
      "Omitted starts it empty, as the editor opens a new one; a url needs it",
    ),
  parentId: z
    .string()
    .nullish()
    .describe("The folder it goes into; omitted or null is Home"),
});

type Created = Omit<
  z.infer<typeof createdEntity>,
  "entityType" | "title" | "elements"
> &
  (
    | {
        entityType: z.infer<typeof BlankableType>;
        title?: string;
        elements?: string;
      }
    // A link has no empty state: its address is its content.
    | { entityType: "url"; title: string; elements: string }
  );

/**
 * A union on `entityType` in its output; its input stays one object, since
 * the REST adapter takes nothing else as a procedure's input.
 */
export const CreateEntity = createdEntity.refine(
  (input): input is Created =>
    input.entityType !== "url" ||
    (input.title !== undefined && input.elements !== undefined),
  { message: "A url needs its title and elements", path: ["elements"] },
);

export type CreateEntity = z.output<typeof CreateEntity>;

export const SaveEntity = z.object({
  id: z.string(),
  title: z.string().optional(),
  elements: z.string(),
  // Omitted leaves the stored appState alone; null clears it.
  appState: z.string().nullable().optional(),
  // Carried by the editors but not written back: a save never retypes an
  // entity, so a REST caller does not have to look it up to send one.
  entityType: z.enum(["drawing", "document", "directory", "url"]).optional(),
  parentId: z.string().optional(),
  /**
   * The `updatedAt` of the revision this content was made over. A save that
   * no longer matches it is refused with CONFLICT instead of overwriting what
   * was written since.
   */
  ifUnmodifiedSince: z.iso.datetime().optional(),
});

export type SaveEntity = z.infer<typeof SaveEntity>;
