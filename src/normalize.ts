import { GradlePropertiesConfigError } from './errors'
import type {
	GradlePropertiesMap,
	GradlePropertiesOptions,
	NormalizedOptions,
	PluginConfig,
	ResolvedProperty
} from './types'

export const DEFAULT_COMMENT = 'Managed by expo-gradle-properties'

/** Every option the full form accepts. Anything else is a typo, and throws. */
const KNOWN_OPTIONS = new Set(['properties', 'comment', 'warnOnUserOverride'])

/**
 * Characters that cannot appear in a `.properties` key.
 *
 * `=` and `:` are both key/value separators in the Java properties format, and
 * whitespace terminates a key. Expo's `propertiesListToString` writes
 * `${key}=${value}` with no escaping whatsoever, so a key containing any of these
 * produces a file that Gradle silently reads as some other key — the exact class of
 * quiet failure this package is meant to remove.
 */
const ILLEGAL_KEY_CHARS = /[\s=:\\]/

/** `#` and `!` at the start of a line begin a comment. */
const COMMENT_PREFIX = /^[#!]/

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The full options form is used if and only if the config has an own `properties`
 * key holding a non-null, non-array object. Otherwise the config is a flat map.
 *
 * The cost of this rule is that a Gradle property genuinely named `properties`
 * cannot be written in shorthand; the full form
 * (`{ properties: { properties: '…' } }`) is the escape hatch. A reserved sigil
 * such as `$options` would remove the ambiguity, but at the price of making the
 * overwhelmingly common case uglier.
 */
const isFullForm = (config: Record<string, unknown>): config is GradlePropertiesOptions & Record<string, unknown> =>
	Object.hasOwn(config, 'properties') && isPlainObject(config.properties)

function assertValidKey(key: string): void {
	if (key.length === 0) {
		throw new GradlePropertiesConfigError('A Gradle property key cannot be an empty string.')
	}

	const illegal = ILLEGAL_KEY_CHARS.exec(key)
	if (illegal) {
		const char = illegal[0] === '\\' ? '\\' : JSON.stringify(illegal[0])
		throw new GradlePropertiesConfigError(
			`Invalid Gradle property key ${JSON.stringify(key)}: it contains ${char}. ` +
				'Keys cannot contain whitespace, "=", ":" or "\\" — those separate or escape ' +
				'entries in a .properties file, so Gradle would read a different key than you wrote.'
		)
	}

	if (COMMENT_PREFIX.test(key)) {
		throw new GradlePropertiesConfigError(
			`Invalid Gradle property key ${JSON.stringify(key)}: keys cannot start with "#" or "!", ` +
				'which begin a comment in a .properties file. The line would be ignored entirely.'
		)
	}
}

function assertValidValue(key: string, value: string): void {
	if (/[\n\r]/.test(value)) {
		throw new GradlePropertiesConfigError(
			`Invalid value for ${JSON.stringify(key)}: values cannot contain a line break. ` +
				'Expo writes gradle.properties one entry per line with no escaping, so a ' +
				'multi-line value would corrupt the rest of the file.'
		)
	}

	// A line ending in an odd number of backslashes continues onto the next line,
	// which would swallow whichever property happens to follow it.
	const trailingBackslashes = /\\*$/.exec(value)?.[0].length ?? 0
	if (trailingBackslashes % 2 === 1) {
		throw new GradlePropertiesConfigError(
			`Invalid value for ${JSON.stringify(key)}: values cannot end in an odd number of ` +
				'backslashes. A trailing "\\" is a line continuation, so the next property in the ' +
				'file would be read as part of this value.'
		)
	}
}

/** Coerce a supported value to its `.properties` text, or `null` to remove the key. */
function coerceValue(key: string, value: unknown): string | null {
	if (value === null || value === undefined) return null

	if (typeof value === 'string') return value

	if (typeof value === 'boolean') return value ? 'true' : 'false'

	if (typeof value === 'number') {
		// Writing "NaN" or "Infinity" into a build file is never what anyone meant.
		if (!Number.isFinite(value)) {
			throw new GradlePropertiesConfigError(
				`Invalid value for ${JSON.stringify(key)}: ${String(value)} is not a finite number.`
			)
		}

		return String(value)
	}

	throw new GradlePropertiesConfigError(
		`Invalid value for ${JSON.stringify(key)}: expected a string, number, boolean or null, ` +
			`but got ${Array.isArray(value) ? 'an array' : typeof value}.`
	)
}

function normalizeProperties(map: GradlePropertiesMap): ResolvedProperty[] {
	const resolved: ResolvedProperty[] = []

	// Object key order is the write order, which keeps repeated prebuilds of an
	// unchanged config byte-identical.
	for (const [key, value] of Object.entries(map)) {
		assertValidKey(key)
		const coerced = coerceValue(key, value)
		if (coerced !== null) assertValidValue(key, coerced)
		resolved.push({ key, value: coerced })
	}

	return resolved
}

/**
 * Turn whatever came out of `app.config.ts` into a fully resolved options object,
 * throwing on anything malformed.
 */
export function normalizeOptions(config: PluginConfig | undefined): NormalizedOptions {
	if (config === undefined || config === null) {
		throw new GradlePropertiesConfigError(
			'No properties given. Pass the plugin a map of Gradle properties, e.g.\n' +
				"  plugins: [['expo-gradle-properties', { 'org.gradle.jvmargs': '-Xmx4g' }]]"
		)
	}

	if (!isPlainObject(config)) {
		throw new GradlePropertiesConfigError(
			`Expected an object of Gradle properties, but got ${Array.isArray(config) ? 'an array' : typeof config}.`
		)
	}

	if (!isFullForm(config)) {
		return {
			properties: normalizeProperties(config as GradlePropertiesMap),
			comment: DEFAULT_COMMENT,
			warnOnUserOverride: true
		}
	}

	// Unknown options throw rather than being ignored. Silently dropping an option
	// is the bug that motivated this package; reproducing it here would be absurd.
	const unknown = Object.keys(config).filter(key => !KNOWN_OPTIONS.has(key))
	if (unknown.length > 0) {
		throw new GradlePropertiesConfigError(
			`Unknown option${unknown.length === 1 ? '' : 's'} ${unknown.map(k => JSON.stringify(k)).join(', ')}. ` +
				`Valid options are ${[...KNOWN_OPTIONS].map(k => JSON.stringify(k)).join(', ')}. ` +
				'To write a Gradle property of that name, put it inside "properties".'
		)
	}

	const { comment, warnOnUserOverride } = config

	if (comment !== undefined && comment !== false && typeof comment !== 'string') {
		throw new GradlePropertiesConfigError(
			`Invalid "comment": expected a string or false, but got ${typeof comment}.`
		)
	}

	if (warnOnUserOverride !== undefined && typeof warnOnUserOverride !== 'boolean') {
		throw new GradlePropertiesConfigError(
			`Invalid "warnOnUserOverride": expected a boolean, but got ${typeof warnOnUserOverride}.`
		)
	}

	return {
		properties: normalizeProperties(config.properties),
		comment: comment === undefined ? DEFAULT_COMMENT : comment,
		warnOnUserOverride: warnOnUserOverride ?? true
	}
}
