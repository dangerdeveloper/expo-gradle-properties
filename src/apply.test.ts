import { describe, expect, it } from 'vitest'

import { applyGradleProperties } from './apply'
import { DEFAULT_COMMENT } from './normalize'
import type { PropertiesItem } from './types'

const property = (key: string, value: string): PropertiesItem => ({ type: 'property', key, value })
const comment = (value: string): PropertiesItem => ({ type: 'comment', value })
const empty = (): PropertiesItem => ({ type: 'empty' })

const apply = (items: PropertiesItem[], properties: Record<string, string | null>, commentOption: string | false = DEFAULT_COMMENT) =>
	applyGradleProperties(items, {
		properties: Object.entries(properties).map(([key, value]) => ({ key, value })),
		comment: commentOption
	})

/** The property entries of a result, as a plain map — order-insensitive assertions. */
const asMap = (items: PropertiesItem[]) =>
	Object.fromEntries(items.flatMap(item => (item.type === 'property' ? [[item.key, item.value]] : [])))

describe('applyGradleProperties — appending', () => {
	it('appends a missing key under a comment header', () => {
		const result = apply([property('existing', '1')], { added: '2' })

		expect(result).toEqual([
			property('existing', '1'),
			empty(),
			comment(DEFAULT_COMMENT),
			property('added', '2'),
			empty()
		])
	})

	it('writes the header only once for several appended keys', () => {
		const result = apply([property('existing', '1')], { a: '1', b: '2', c: '3' })

		expect(result.filter(item => item.type === 'comment')).toHaveLength(1)
		expect(asMap(result)).toEqual({ existing: '1', a: '1', b: '2', c: '3' })
	})

	it('appends in the order the properties were given', () => {
		const result = apply([], { z: '1', a: '2' })
		expect(result.flatMap(i => (i.type === 'property' ? [i.key] : []))).toEqual(['z', 'a'])
	})

	it('omits the header when comment is false', () => {
		const result = apply([property('existing', '1')], { added: '2' }, false)

		expect(result.some(item => item.type === 'comment')).toBe(false)
		expect(asMap(result)).toEqual({ existing: '1', added: '2' })
	})

	it('does not add a second blank line when the file already ends in one', () => {
		const result = apply([property('existing', '1'), empty()], { added: '2' })

		expect(result).toEqual([property('existing', '1'), empty(), comment(DEFAULT_COMMENT), property('added', '2'), empty()])
	})

	it('does not repeat a header that is already in the file', () => {
		const result = apply([comment(DEFAULT_COMMENT), property('existing', '1')], { added: '2' })

		expect(result.filter(item => item.type === 'comment')).toHaveLength(1)
	})

	it('leaves the file ending in a newline', () => {
		expect(apply([property('a', '1')], { b: '2' }).at(-1)).toEqual(empty())
	})
})

describe('applyGradleProperties — replacing', () => {
	it('replaces an existing key at its original position', () => {
		const result = apply(
			[property('first', '1'), property('target', 'old'), property('last', '3')],
			{ target: 'new' }
		)

		expect(result).toEqual([property('first', '1'), property('target', 'new'), property('last', '3')])
	})

	it('adds no comment header when nothing was appended', () => {
		const result = apply([property('target', 'old')], { target: 'new' })
		expect(result.some(item => item.type === 'comment')).toBe(false)
	})

	it('leaves surrounding comments and blank lines untouched', () => {
		const input = [comment('explains the default'), property('target', 'old'), empty(), property('other', '2')]

		expect(apply(input, { target: 'new' })).toEqual([
			comment('explains the default'),
			property('target', 'new'),
			empty(),
			property('other', '2')
		])
	})

	it('replaces the first duplicate and deletes the rest', () => {
		// gradle.properties is last-wins, so leaving a duplicate behind means the
		// file reads as though the plugin worked while Gradle uses the other line.
		const result = apply(
			[property('dupe', 'a'), property('other', '1'), property('dupe', 'b'), property('dupe', 'c')],
			{ dupe: 'final' }
		)

		expect(result).toEqual([property('dupe', 'final'), property('other', '1')])
		expect(result.filter(item => item.type === 'property' && item.key === 'dupe')).toHaveLength(1)
	})
})

describe('applyGradleProperties — removing', () => {
	it('removes every entry for the key', () => {
		const result = apply([property('gone', 'a'), property('kept', '1'), property('gone', 'b')], { gone: null })

		expect(result).toEqual([property('kept', '1')])
	})

	it('is a no-op when the key is absent', () => {
		const input = [property('kept', '1')]
		expect(apply(input, { absent: null })).toEqual(input)
	})

	it('appends nothing and writes no header for a removal', () => {
		const result = apply([property('kept', '1')], { absent: null })
		expect(result.some(item => item.type === 'comment')).toBe(false)
	})

	it('handles a set and a removal in one pass', () => {
		const result = apply([property('gone', 'x'), property('stay', '1')], { gone: null, added: '2' })
		expect(asMap(result)).toEqual({ stay: '1', added: '2' })
	})
})

describe('applyGradleProperties — invariants', () => {
	it('does not mutate the input array or its items', () => {
		const items = [property('target', 'old')]
		const snapshot = structuredClone(items)

		apply(items, { target: 'new', added: '1' })

		expect(items).toEqual(snapshot)
	})

	it('is idempotent — applying twice changes nothing the second time', () => {
		const input = [property('existing', '1')]
		const properties = { existing: '2', added: '3', gone: null }

		const once = apply(input, properties)
		const twice = apply(once, properties)

		expect(twice).toEqual(once)
	})

	it('never leaves a duplicate key behind', () => {
		const result = apply(
			[property('a', '1'), property('a', '2'), property('b', '1'), property('b', '2')],
			{ a: 'x', b: 'y', c: 'z' }
		)

		const keys = result.flatMap(item => (item.type === 'property' ? [item.key] : []))
		expect(keys).toEqual([...new Set(keys)])
	})

	it('handles an empty file', () => {
		expect(asMap(apply([], { a: '1' }))).toEqual({ a: '1' })
	})

	it('handles an empty property list', () => {
		const input = [property('a', '1')]
		expect(apply(input, {})).toEqual(input)
	})
})
