import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { findUserOverrides, formatOverrideWarning, parseProperties } from './overrides'
import type { ResolvedProperty } from './types'

const HOME = path.join(path.sep, 'home', 'dev')

/** A lookup wired to an in-memory home directory. */
const lookup = (properties: ResolvedProperty[], files: Record<string, string>, env: Record<string, string | undefined> = {}) =>
	findUserOverrides(properties, {
		env,
		homedir: () => HOME,
		readFile: filePath => {
			const contents = files[filePath]
			if (contents === undefined) throw new Error(`ENOENT: ${filePath}`)

			return contents
		}
	})

const defaultPath = path.join(HOME, '.gradle', 'gradle.properties')

describe('parseProperties', () => {
	it('reads key=value pairs', () => {
		expect(parseProperties('a=1\nb=2')).toEqual(new Map([['a', '1'], ['b', '2']]))
	})

	it('accepts a colon separator', () => {
		expect(parseProperties('a:1')).toEqual(new Map([['a', '1']]))
	})

	it('keeps separators that appear inside the value', () => {
		expect(parseProperties('jvmargs=-Xmx4g -XX:Max=2g').get('jvmargs')).toBe('-Xmx4g -XX:Max=2g')
	})

	it.each([
		['a hash comment', '# a=1\nb=2'],
		['a bang comment', '! a=1\nb=2']
	])('skips %s', (_label, contents) => {
		expect(parseProperties(contents).has('a')).toBe(false)
	})

	it('skips blank lines and trims leading whitespace', () => {
		expect(parseProperties('\n\n   a=1\n\n')).toEqual(new Map([['a', '1']]))
	})

	it('trims whitespace around the key and leading whitespace of the value', () => {
		expect(parseProperties('  a  =  1')).toEqual(new Map([['a', '1']]))
	})

	it('joins a backslash line continuation', () => {
		expect(parseProperties('a=one \\\ntwo').get('a')).toBe('one two')
	})

	it.each([
		['CRLF', 'a=1\r\nb=2'],
		['CR', 'a=1\rb=2']
	])('handles %s line endings', (_label, contents) => {
		expect(parseProperties(contents)).toEqual(new Map([['a', '1'], ['b', '2']]))
	})

	it('ignores a line with no separator', () => {
		expect(parseProperties('nonsense\na=1')).toEqual(new Map([['a', '1']]))
	})

	it('returns an empty map for an empty file', () => {
		expect(parseProperties('')).toEqual(new Map())
	})
})

describe('findUserOverrides', () => {
	const ours: ResolvedProperty[] = [{ key: 'org.gradle.jvmargs', value: '-Xmx4g' }]

	it('reports a colliding key with both values', () => {
		const report = lookup(ours, { [defaultPath]: 'org.gradle.jvmargs=-Xmx2g' })

		expect(report?.collisions).toEqual([{ key: 'org.gradle.jvmargs', ours: '-Xmx4g', theirs: '-Xmx2g' }])
	})

	it('shortens the home directory for display', () => {
		expect(lookup(ours, { [defaultPath]: 'org.gradle.jvmargs=-Xmx2g' })?.displayPath).toBe(
			path.join('~', '.gradle', 'gradle.properties')
		)
	})

	it('honours GRADLE_USER_HOME over the default location', () => {
		const custom = path.join(path.sep, 'ci', 'gradle')
		const report = lookup(ours, { [path.join(custom, 'gradle.properties')]: 'org.gradle.jvmargs=-Xmx1g' }, {
			GRADLE_USER_HOME: custom
		})

		expect(report?.collisions[0]?.theirs).toBe('-Xmx1g')
		expect(report?.displayPath).toBe(path.join(custom, 'gradle.properties'))
	})

	it('returns null when the keys do not overlap', () => {
		expect(lookup(ours, { [defaultPath]: 'something.else=1' })).toBeNull()
	})

	it('returns null when the file does not exist', () => {
		expect(lookup(ours, {})).toBeNull()
	})

	it('returns null when the file cannot be read at all', () => {
		const report = findUserOverrides(ours, {
			env: {},
			homedir: () => HOME,
			readFile: () => {
				throw new Error('EACCES')
			}
		})

		expect(report).toBeNull()
	})

	it('survives a homedir() that throws', () => {
		const report = findUserOverrides(ours, {
			env: {},
			homedir: () => {
				throw new Error('no home')
			},
			readFile: () => 'org.gradle.jvmargs=-Xmx2g'
		})

		expect(report).toBeNull()
	})

	it('ignores removals, which cannot be overridden', () => {
		expect(lookup([{ key: 'org.gradle.jvmargs', value: null }], { [defaultPath]: 'org.gradle.jvmargs=-Xmx2g' })).toBeNull()
	})

	it('returns null when there is nothing to write', () => {
		expect(lookup([], { [defaultPath]: 'org.gradle.jvmargs=-Xmx2g' })).toBeNull()
	})

	it('reports every colliding key', () => {
		const report = lookup(
			[
				{ key: 'a', value: '1' },
				{ key: 'b', value: '2' },
				{ key: 'c', value: '3' }
			],
			{ [defaultPath]: 'a=x\nc=z' }
		)

		expect(report?.collisions.map(c => c.key)).toEqual(['a', 'c'])
	})
})

describe('formatOverrideWarning', () => {
	const report = (collisions: { key: string; ours: string; theirs: string }[]) => ({
		path: defaultPath,
		displayPath: '~/.gradle/gradle.properties',
		collisions
	})

	it('names the file, the key and both values', () => {
		const message = formatOverrideWarning(report([{ key: 'org.gradle.jvmargs', ours: '-Xmx4g', theirs: '-Xmx2g' }]))

		expect(message).toContain('[expo-gradle-properties]')
		expect(message).toContain('1 property is overridden')
		expect(message).toContain('~/.gradle/gradle.properties')
		expect(message).toContain('org.gradle.jvmargs')
		expect(message).toContain('this plugin: -Xmx4g')
		expect(message).toContain('-Xmx2g')
		expect(message).toContain('warnOnUserOverride: false')
	})

	it('pluralises for several collisions', () => {
		const message = formatOverrideWarning(
			report([
				{ key: 'a', ours: '1', theirs: '2' },
				{ key: 'b', ours: '3', theirs: '4' }
			])
		)

		expect(message).toContain('2 properties are overridden')
	})
})
