declare const changeIdBrand: unique symbol;

/**
 * Stable identity for a pending sync change, independent of its current file
 * path. Using this instead of a path lets selection and operation state
 * survive rename/move without losing the user's intent.
 *
 * Branded (rather than a plain `string` alias) so callers can't pass a raw
 * file path where a ChangeId is expected.
 */
export type ChangeId = string & { readonly [changeIdBrand]: never };

/** Wraps a raw id string as a ChangeId at the one place it's minted. */
export function toChangeId(id: string): ChangeId {
    return id as ChangeId;
}
