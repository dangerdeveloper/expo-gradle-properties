import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import type { ResolvedProperty } from './types'

/** One key set both by this plugin and by the machine-level Gradle config. */
export interface OverrideCollision {
	key: string
	/** What this plugin writes into the project file. */
	ours: string
	/** What the user's machine-level file says — the value Gradle will actually use. */
	theirs: string
}

export interface UserOverrideReport {
	/** Absolute path of the machine-level file. */
	path: string
	/** The same path with `$HOME` shortened to `~`, for display. */
	displayPath: string
	collisions: OverrideCollision[]
}

/** Injection seams, so the lookup can be tested without touching a real home dir. */
export interface OverrideLookupDeps {
	env?: Record<string, string | undefined>
	homedir?: () => string
	readFile?: (filePath: string) => string
}

/**
 * Minimal `.properties` reader.
 *
 * Deliberately not a complete Java properties implementation — it does not decode
 * `\\uXXXX` escapes or unescape separators. This output is only ever used to
 * *compare keys and show values* in a warning, so the cost of being wrong is a
 * slightly odd diagnostic string, never a wrong build. Anything more would be
 * dead weight.
 */
export function parseProperties(contents: string): Map<string, string> {
	const result = new Map<string, string>()
	const lines = contents.split(/\r\n|\r|\n/)

	let buffer = ''

	for (const rawLine of lines) {
		const line = buffer + rawLine.replace(/^\s+/, '')
		buffer = ''

		if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) continue

		// A line ending in an odd number of backslashes continues onto the next one.
		const trailing = /\\*$/.exec(line)?.[0].length ?? 0
		if (trailing % 2 === 1) {
			buffer = line.slice(0, -1)
			continue
		}

		const separator = /(?<!\\)[=:]/.exec(line)
		if (!separator || separator.index === 0) continue

		const key = line.slice(0, separator.index).trim()
		const value = line.slice(separator.index + 1).replace(/^\s+/, '')
		if (key.length > 0) result.set(key, value)
	}

	return result
}

/** `~/.gradle/gradle.properties` reads better than the absolute path in a warning. */
function shorten(filePath: string, home: string): string {
	return home.length > 0 && filePath.startsWith(home + path.sep)
		? `~${filePath.slice(home.length)}`
		: filePath
}

/**
 * Find properties that a machine-level Gradle config will override.
 *
 * Gradle resolves `gradle.properties` with `$GRADLE_USER_HOME` winning over the
 * project directory — the opposite of the usual "closest file wins" intuition.
 * Everything this plugin writes goes in the project file, so a stray
 * `~/.gradle/gradle.properties` silently beats it. On a self-hosted CI runner the
 * runner's own home file beats the repo for every build that machine ever runs,
 * which is how the same commit ends up building differently in two places.
 *
 * Returns `null` when there is nothing to say — no file, unreadable file, or no
 * overlapping keys. Every failure is swallowed on purpose: this is a diagnostic,
 * and it must never be able to break a prebuild.
 */
export function findUserOverrides(
	properties: readonly ResolvedProperty[],
	deps: OverrideLookupDeps = {}
): UserOverrideReport | null {
	const env = deps.env ?? process.env
	const homedir = deps.homedir ?? os.homedir
	const readFile = deps.readFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf8'))

	// Keys we remove cannot be "overridden" in any meaningful sense.
	const ours = properties.filter((property): property is { key: string; value: string } => property.value !== null)
	if (ours.length === 0) return null

	let home = ''
	try {
		home = homedir()
	} catch {
		home = ''
	}

	const gradleUserHome = env.GRADLE_USER_HOME ?? (home.length > 0 ? path.join(home, '.gradle') : undefined)
	if (!gradleUserHome) return null

	const filePath = path.join(gradleUserHome, 'gradle.properties')

	let contents: string
	try {
		contents = readFile(filePath)
	} catch {
		return null
	}

	const theirs = parseProperties(contents)

	const collisions: OverrideCollision[] = []
	for (const property of ours) {
		const value = theirs.get(property.key)
		if (value !== undefined) collisions.push({ key: property.key, ours: property.value, theirs: value })
	}

	if (collisions.length === 0) return null

	return { path: filePath, displayPath: shorten(filePath, home), collisions }
}

/** Render a report as the multi-line warning shown during prebuild. */
export function formatOverrideWarning({ displayPath, collisions }: UserOverrideReport): string {
	const count = collisions.length
	const noun = count === 1 ? 'property is' : 'properties are'

	const lines = [
		`[expo-gradle-properties] ${count} ${noun} overridden by your machine-level Gradle config.`,
		`  ${displayPath} takes precedence over the project's gradle.properties, so the build will NOT use the value this plugin sets.`
	]

	for (const { key, ours, theirs } of collisions) {
		lines.push(`    ${key}`)
		lines.push(`      this plugin: ${ours}`)
		lines.push(`      ${displayPath}: ${theirs}`)
	}

	lines.push(`  Remove the key from ${displayPath}, or pass warnOnUserOverride: false to silence this.`)

	return lines.join('\n')
}
