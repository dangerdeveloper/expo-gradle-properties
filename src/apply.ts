import type { NormalizedOptions, PropertiesItem } from './types'

/** The subset of the options that the pure transform needs. */
export type ApplyOptions = Pick<NormalizedOptions, 'properties' | 'comment'>

const isProperty = (item: PropertiesItem, key: string): boolean => item.type === 'property' && item.key === key

/** Indices of every entry for `key`, in file order. */
function indicesOf(items: readonly PropertiesItem[], key: string): number[] {
	const found: number[] = []
	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		if (item && isProperty(item, key)) found.push(i)
	}

	return found
}

/** Remove the given indices without disturbing the ones still to be removed. */
function removeAt(items: PropertiesItem[], indices: readonly number[]): void {
	for (let i = indices.length - 1; i >= 0; i--) {
		const index = indices[i]
		if (index !== undefined) items.splice(index, 1)
	}
}

/**
 * Apply resolved properties to a parsed `gradle.properties`.
 *
 * Pure: takes the parsed lines, returns new parsed lines, touches no filesystem.
 * That is what lets the interesting behaviour be tested without running a prebuild.
 *
 * Three cases per key:
 *
 * - **absent** — appended at the end, under a single comment header.
 * - **present once** — replaced *at its original position*, so a prebuild diff is
 *   one changed line rather than a deletion plus an append.
 * - **present more than once** — the first entry is replaced and the rest deleted.
 *
 * That third case is the one that has to be right. `gradle.properties` is
 * last-wins, so an implementation that simply appends leaves two lines for the same
 * key: the file then reads as though the plugin worked while Gradle uses whichever
 * line came last. Deleting the duplicates is not a tidy-up, it is the correctness
 * requirement.
 */
export function applyGradleProperties(
	items: readonly PropertiesItem[],
	{ properties, comment }: ApplyOptions
): PropertiesItem[] {
	const next: PropertiesItem[] = [...items]
	const toAppend: { key: string; value: string }[] = []

	for (const { key, value } of properties) {
		const indices = indicesOf(next, key)

		if (value === null) {
			// Removing a key that was never there is a no-op, not an error: config
			// plugins have to be idempotent across repeated prebuilds.
			removeAt(next, indices)
			continue
		}

		const [first, ...duplicates] = indices

		if (first === undefined) {
			toAppend.push({ key, value })
			continue
		}

		next[first] = { type: 'property', key, value }
		removeAt(next, duplicates)
	}

	if (toAppend.length === 0) return next

	if (comment !== false) {
		const alreadyPresent = next.some(item => item.type === 'comment' && item.value === comment)
		if (!alreadyPresent) {
			if (next.at(-1)?.type !== 'empty') next.push({ type: 'empty' })
			next.push({ type: 'comment', value: comment })
		}
	}

	for (const { key, value } of toAppend) {
		next.push({ type: 'property', key, value })
	}

	// Leave the file ending in a newline, the way the Expo template does.
	if (next.at(-1)?.type !== 'empty') next.push({ type: 'empty' })

	return next
}
