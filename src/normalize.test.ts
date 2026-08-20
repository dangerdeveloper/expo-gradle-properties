import { describe, expect, it } from 'vitest'

import { GradlePropertiesConfigError } from './errors'
import { DEFAULT_COMMENT, normalizeOptions } from './normalize'
import type { PluginConfig } from './types'

const normalize = (config: unknown) => normalizeOptions(config as PluginConfig)

describe('normalizeOptions — shorthand form', () => {
	it('reads a flat map and applies the defaults', () => {
		expect(normalize({ 'org.gradle.jvmargs': '-Xmx4g' })).toEqual({
			properties: [{ key: 'org.gradle.jvmargs', value: '-Xmx4g' }],
			comment: DEFAULT_COMMENT,
			warnOnUserOverride: true
		})
	})

	it('preserves key order, so an unchanged config rewrites the file identically', () => {
		const { properties } = normalize({ b: '1', a: '2', c: '3' })
		expect(properties.map(p => p.key)).toEqual(['b', 'a', 'c'])
	})

	it('accepts an empty map as a no-op rather than an error', () => {
		expect(normalize({}).properties).toEqual([])
	})
})

describe('normalizeOptions — full form', () => {
	it('reads properties alongside options', () => {
		expect(
			normalize({
				properties: { 'org.gradle.parallel': true },
				comment: 'custom header',
				warnOnUserOverride: false
			})
		).toEqual({
			properties: [{ key: 'org.gradle.parallel', value: 'true' }],
			comment: 'custom header',
			warnOnUserOverride: false
		})
	})

	it('accepts comment: false', () => {
		expect(normalize({ properties: { a: '1' }, comment: false }).comment).toBe(false)
	})

	it('is chosen only when "properties" holds an object', () => {
		// A non-object "properties" is a Gradle property literally named `properties`.
		expect(normalize({ properties: 'x' }).properties).toEqual([{ key: 'properties', value: 'x' }])
	})

	it('lets the full form write a property named "properties"', () => {
		expect(normalize({ properties: { properties: 'x' } }).properties).toEqual([{ key: 'properties', value: 'x' }])
	})

	it('treats an array "properties" as shorthand, not as the full form', () => {
		expect(() => normalize({ properties: ['a'] })).toThrow(/expected a string, number, boolean or null/)
	})

	it('throws on an unknown option instead of silently dropping it', () => {
		expect(() => normalize({ properties: { a: '1' }, warnOnUserOverides: false })).toThrow(
			GradlePropertiesConfigError
		)
		expect(() => normalize({ properties: { a: '1' }, warnOnUserOverides: false })).toThrow(
			/Unknown option "warnOnUserOverides"/
		)
	})

	it('rejects a mistyped comment or warnOnUserOverride', () => {
		expect(() => normalize({ properties: { a: '1' }, comment: 42 })).toThrow(/Invalid "comment"/)
		expect(() => normalize({ properties: { a: '1' }, warnOnUserOverride: 'yes' })).toThrow(
			/Invalid "warnOnUserOverride"/
		)
	})
})

describe('normalizeOptions — value coercion', () => {
	it.each([
		['a string', 'hello', 'hello'],
		['an empty string', '', ''],
		['a number', 4096, '4096'],
		['a negative number', -1, '-1'],
		['true', true, 'true'],
		['false', false, 'false']
	])('coerces %s', (_label, input, expected) => {
		expect(normalize({ key: input }).properties[0]?.value).toBe(expected)
	})

	it.each([
		['null', null],
		['undefined', undefined]
	])('treats %s as a removal', (_label, input) => {
		expect(normalize({ key: input }).properties).toEqual([{ key: 'key', value: null }])
	})

	it.each([
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY]
	])('rejects %s rather than writing it into a build file', (_label, input) => {
		expect(() => normalize({ key: input })).toThrow(/is not a finite number/)
	})

	it.each([
		['an array', ['a']],
		['an object', { a: 1 }]
	])('rejects %s', (_label, input) => {
		expect(() => normalize({ key: input })).toThrow(GradlePropertiesConfigError)
	})
})

describe('normalizeOptions — key validation', () => {
	it.each([
		['a space', 'org.gradle jvmargs'],
		['a tab', 'org\tgradle'],
		['an equals sign', 'a=b'],
		['a colon', 'a:b'],
		['a backslash', 'a\\b']
	])('rejects a key containing %s', (_label, key) => {
		expect(() => normalize({ [key]: '1' })).toThrow(/Invalid Gradle property key/)
	})

	it('rejects an empty key', () => {
		expect(() => normalize({ '': '1' })).toThrow(/cannot be an empty string/)
	})

	it.each([
		['#', '#comment'],
		['!', '!comment']
	])('rejects a key starting with %s', (_label, key) => {
		expect(() => normalize({ [key]: '1' })).toThrow(/cannot start with "#" or "!"/)
	})

	it('allows the dotted and camelCase keys real projects use', () => {
		expect(() =>
			normalize({
				'org.gradle.jvmargs': '-Xmx4g',
				reactNativeArchitectures: 'arm64-v8a',
				'android.useAndroidX': true,
				EX_DEV_CLIENT_NETWORK_INSPECTOR: false,
				'my-custom-flag': '1'
			})
		).not.toThrow()
	})
})

describe('normalizeOptions — value validation', () => {
	it.each([
		['a newline', 'a\nb'],
		['a carriage return', 'a\rb']
	])('rejects a value containing %s', (_label, value) => {
		expect(() => normalize({ key: value })).toThrow(/cannot contain a line break/)
	})

	it('rejects a value ending in an odd number of backslashes', () => {
		expect(() => normalize({ key: 'C:\\path\\' })).toThrow(/line continuation/)
		expect(() => normalize({ key: 'a\\\\\\' })).toThrow(/line continuation/)
	})

	it('allows an even number of trailing backslashes', () => {
		expect(() => normalize({ key: 'a\\\\' })).not.toThrow()
	})

	it('allows the characters that legitimately appear in jvmargs', () => {
		expect(() =>
			normalize({ 'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=2g -Dfile.encoding=UTF-8' })
		).not.toThrow()
	})
})

describe('normalizeOptions — malformed config', () => {
	it.each([
		['undefined', undefined],
		['null', null]
	])('throws a usage message on %s', (_label, config) => {
		expect(() => normalize(config)).toThrow(/No properties given/)
	})

	it.each([
		['an array', []],
		['a string', 'nope'],
		['a number', 1]
	])('throws on %s', (_label, config) => {
		expect(() => normalize(config)).toThrow(/Expected an object of Gradle properties/)
	})

	it('prefixes every message with the package name', () => {
		expect(() => normalize({ '': '1' })).toThrow(/^\[expo-gradle-properties\]/)
	})
})
