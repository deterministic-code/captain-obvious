import { logEvent } from "./audit.js";
import type { Db } from "./open.js";
import type { ActionTypeRow, ConfigureActionOpts } from "./types.js";

/**
 * Manage the action-type catalog (warn / halt / delay_halt / fix* / custom). With
 * `add: true` a missing type is created; otherwise it must already exist.
 * `name` is updated when provided.
 */
export function configureActionType(
  db: Db,
  slug: string,
  opts: ConfigureActionOpts,
): ActionTypeRow {
  if (!slug) throw new Error("configure-action requires an action-type slug");

  const existing = db
    .prepare("SELECT * FROM action_types WHERE slug = ?")
    .get(slug) as ActionTypeRow | undefined;

  if (!existing) {
    if (!opts.add) {
      throw new Error(`unknown action type: ${slug} (pass --add to create it)`);
    }
    const info = db
      .prepare("INSERT INTO action_types (slug, name) VALUES (?, ?)")
      .run(slug, opts.name ?? slug);
    logEvent("action_type.added", `added action type ${slug}`);
    return byId(db, info.lastInsertRowid);
  }

  if (opts.name !== undefined) {
    db.prepare("UPDATE action_types SET name = ? WHERE id = ?").run(
      opts.name,
      existing.id,
    );
    logEvent(
      "action_type.updated",
      `renamed action type ${slug} to ${opts.name}`,
    );
  }
  return byId(db, existing.id);
}

function byId(db: Db, id: number | bigint): ActionTypeRow {
  return db
    .prepare("SELECT * FROM action_types WHERE id = ?")
    .get(id) as ActionTypeRow;
}
