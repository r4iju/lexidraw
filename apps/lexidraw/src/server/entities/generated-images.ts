import { validateImagePixels } from "./image-raster";
import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";
import { z } from "zod";
import { ImageArtifact, validateImage } from "~/lib/images/contracts";
export const SaveImageInput = z.strictObject({
  idempotencyKey: z.string().min(1).max(100),
  entityId: z.string().min(1).max(100),
  image: ImageArtifact,
});
const rowFields = {
  id: z.string(),
  account_id: z.string(),
  entity_id: z.string(),
  content_hash: z.string(),
  pathname: z.string(),
  expires_at: z.number(),
  lease_until: z.number(),
  size: z.number().int().positive().max(2097152),
};
const Row = z.discriminatedUnion("state", [
  z.object({
    ...rowFields,
    state: z.literal("registered"),
    url: z.union([
      z.url(),
      z.string().regex(/^\/api\/generated-images\/[^/?#]+$/),
    ]),
  }),
  z.object({
    ...rowFields,
    state: z.enum(["pending", "abandoned"]),
    url: z.string().nullable(),
  }),
]);
export class GeneratedImages {
  constructor(
    readonly client: Client,
    readonly deps: {
      now: () => number;
      canEdit: (account: string, entity: string) => Promise<boolean>;
      canRead?: (account: string, entity: string) => Promise<boolean>;
      store: {
        put: (path: string, bytes: Uint8Array) => Promise<string>;
        remove: (path: string) => Promise<void>;
        read?: (path: string) => Promise<Uint8Array | null>;
      };
    },
  ) {}
  async save(
    account: string,
    value: unknown,
    assertSafe: (value: string) => void = () => {},
  ): Promise<{ id: string; url: string }> {
    const input = SaveImageInput.parse(value);
    assertSafe(JSON.stringify(input));
    const { bytes } = validateImage(input.image, assertSafe);
    validateImagePixels(bytes);
    if (!(await this.deps.canEdit(account, input.entityId)))
      throw new Error("Edit access required");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const tx = await this.client.transaction("write");
    let row: z.infer<typeof Row>;
    try {
      const prior = (
        await tx.execute({
          sql: "SELECT * FROM generated_images WHERE account_id=? AND idempotency_key=?",
          args: [account, input.idempotencyKey],
        })
      ).rows[0];
      if (prior) {
        row = Row.parse(prior);
        if (row.content_hash !== hash || row.entity_id !== input.entityId)
          throw new Error("Artifact idempotency conflict");
        if (row.state === "registered") {
          await tx.commit();
          return { id: row.id, url: this.url(row.id) };
        }
        if (row.expires_at <= this.deps.now() || row.state === "abandoned")
          throw new Error(
            "Upload expired; retry the retained image with a new upload identity",
          );
        if (row.lease_until > this.deps.now())
          throw new Error("Upload in progress");
      } else {
        const quotas = (
          await tx.execute({
            sql: "SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS size FROM generated_images WHERE account_id=? AND state IN ('pending','registered')",
            args: [account],
          })
        ).rows[0];
        if (
          Number(quotas?.count) >= 100 ||
          Number(quotas?.size) + bytes.length > 100 * 1024 * 1024
        )
          throw new Error("Image artifact quota reached");
        const id = crypto.randomUUID();
        const path = `generated-images/${id}.png`;
        await tx.execute({
          sql: "INSERT INTO generated_images(id,account_id,entity_id,idempotency_key,content_hash,size,pathname,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)",
          args: [
            id,
            account,
            input.entityId,
            input.idempotencyKey,
            hash,
            bytes.length,
            path,
            this.deps.now() + 600_000,
            this.deps.now(),
          ],
        });
        row = Row.parse(
          (
            await tx.execute({
              sql: "SELECT * FROM generated_images WHERE id=?",
              args: [id],
            })
          ).rows[0],
        );
      }
      await tx.execute({
        sql: "UPDATE generated_images SET lease_until=? WHERE id=?",
        args: [this.deps.now() + 30_000, row.id],
      });
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
    try {
      await this.deps.store.put(row.pathname, bytes);
      const url = this.url(row.id);
      if (!(await this.deps.canEdit(account, input.entityId)))
        throw new Error("Edit access required");
      const registered = await this.client.execute({
        sql: "UPDATE generated_images SET state='registered',url=?,lease_until=0 WHERE id=? AND state='pending' AND expires_at>?",
        args: [url, row.id, this.deps.now()],
      });
      if (!registered.rowsAffected) {
        const prior = Row.parse(
          (
            await this.client.execute({
              sql: "SELECT * FROM generated_images WHERE id=?",
              args: [row.id],
            })
          ).rows[0],
        );
        if (prior.state === "registered")
          return { id: prior.id, url: this.url(prior.id) };
        await this.deps.store.remove(row.pathname);
        throw new Error("Upload expired");
      }
      return { id: row.id, url };
    } catch {
      await this.client.execute({
        sql: "UPDATE generated_images SET lease_until=0 WHERE id=? AND state='pending'",
        args: [row.id],
      });
      throw new Error(
        "Image sync failed. The completed device image can be uploaded again without regeneration.",
      );
    }
  }
  private url(id: string) {
    return `/api/generated-images/${id}`;
  }
  async read(account: string, id: string): Promise<Uint8Array | null> {
    if (!account || !z.uuid().safeParse(id).success) return null;
    const value = (
      await this.client.execute({
        sql: "SELECT * FROM generated_images WHERE id=? AND state='registered'",
        args: [id],
      })
    ).rows[0];
    if (!value) return null;
    const row = Row.parse(value);
    if (
      !this.deps.canRead ||
      !(await this.deps.canRead(account, row.entity_id))
    )
      return null;
    const bytes = await this.deps.store.read?.(row.pathname);
    if (!bytes) return null;
    if (
      bytes.length !== row.size ||
      createHash("sha256").update(bytes).digest("hex") !== row.content_hash
    )
      throw new Error("Invalid stored image");
    validateImage({
      mimeType: "image/png",
      width: 1024,
      height: 1024,
      base64: Buffer.from(bytes).toString("base64"),
    });
    validateImagePixels(bytes);
    if (!(await this.deps.canRead(account, row.entity_id))) return null;
    const live = await this.client.execute({
      sql: "SELECT id FROM generated_images WHERE id=? AND state='registered'",
      args: [id],
    });
    return live.rows.length ? bytes : null;
  }
  async cleanup() {
    const now = this.deps.now();
    const tx = await this.client.transaction("write");
    let expiredCount: number;
    try {
      const candidates = z.array(z.strictObject({ id: z.uuid() })).parse(
        (
          await tx.execute({
            sql: "SELECT id FROM generated_images WHERE state='pending' AND expires_at<=? AND lease_until<=? ORDER BY expires_at,id LIMIT 100",
            args: [now, now],
          })
        ).rows,
      );
      expiredCount = 0;
      for (const row of candidates) {
        const result = await tx.execute({
          sql: "UPDATE generated_images SET state='abandoned' WHERE id=? AND state='pending' AND expires_at<=? AND lease_until<=?",
          args: [row.id, now, now],
        });
        expiredCount += result.rowsAffected;
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
    const attempted = new Set<string>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const claim = await this.client.transaction("write");
      let candidate: { id: string; pathname: string } | undefined;
      try {
        const cursor = z
          .strictObject({ last_attempted_id: z.uuid().nullable() })
          .parse(
            (
              await claim.execute(
                "SELECT last_attempted_id FROM generated_image_cleanup_cursor WHERE singleton=1",
              )
            ).rows[0],
          );
        let next = (
          await claim.execute({
            sql: "SELECT id,pathname FROM generated_images WHERE state='abandoned' AND id>? ORDER BY id LIMIT 1",
            args: [cursor.last_attempted_id ?? ""],
          })
        ).rows[0];
        if (!next)
          next = (
            await claim.execute(
              "SELECT id,pathname FROM generated_images WHERE state='abandoned' ORDER BY id LIMIT 1",
            )
          ).rows[0];
        if (next) {
          const parsed = z
            .strictObject({
              id: z.uuid(),
              pathname: z
                .string()
                .regex(/^generated-images\/[0-9a-f-]{36}\.png$/),
            })
            .parse(next);
          if (!attempted.has(parsed.id)) {
            candidate = parsed;
            await claim.execute({
              sql: "UPDATE generated_image_cleanup_cursor SET last_attempted_id=? WHERE singleton=1",
              args: [parsed.id],
            });
          }
        }
        await claim.commit();
      } catch {
        await claim.rollback();
        throw new Error("Image cleanup unavailable");
      } finally {
        claim.close();
      }
      if (!candidate) break;
      attempted.add(candidate.id);
      // Commit rotation before storage: failures and restarts must not starve later tombstones.
      try {
        await this.deps.store.remove(candidate.pathname);
      } catch {}
    }
    return expiredCount;
  }
}
