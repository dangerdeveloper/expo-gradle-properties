/**
 * A single line of a `gradle.properties` file.
 *
 * This is a structural copy of `Properties.PropertiesItem` from
 * `@expo/config-plugins`. It is restated here rather than imported so that the
 * pure core (`normalize.ts`, `apply.ts`, `overrides.ts`) carries no dependency on
 * the prebuild machinery and can be unit-tested on its own. `index.ts` is the only
 * module that touches Expo, and the integration test round-trips through Expo's
 * real parser to prove the two shapes still agree.
 */
export type PropertiesItem =
	| { type: 'comment'; value: string }
	| { type: 'empty' }
	| { type: 'property'; key: string; value: string }

/**
 * A value accepted for a Gradle property.
 *
 * `null` and `undefined` both mean "remove this key", which lets a caller write
 * `'org.gradle.caching': someFlag ? true : null` without branching.
 */
export type GradlePropertyValue = string | number | boolean | null | undefined

/** A flat map of Gradle property keys to values. */
export type GradlePropertiesMap = Record<string, GradlePropertyValue>

/** The full options form of the plugin config. */
export interface GradlePropertiesOptions {
	/** The properties to write. */
	properties: GradlePropertiesMap
	/**
	 * Header comment written above newly appended keys, so a human reading the
	 * generated file knows what put them there. `false` writes no comment.
	 *
	 * @default 'Managed by expo-gradle-properties'
	 */
	comment?: string | false
	/**
	 * Warn during prebuild when `$GRADLE_USER_HOME/gradle.properties` sets one of
	 * these keys. That file outranks the project one, so the build would silently
	 * ignore the value written here.
	 *
	 * @default true
	 */
	warnOnUserOverride?: boolean
}

/**
 * What the plugin accepts: either a flat map of properties, or the full options
 * object.
 *
 * The full form is chosen if and only if the config has an own `properties` key
 * holding a non-null object — see `normalize.ts`.
 */
export type PluginConfig = GradlePropertiesMap | GradlePropertiesOptions

/** One property after validation and coercion. `value: null` means "remove". */
export interface ResolvedProperty {
	key: string
	value: string | null
}

/** The plugin config after normalization. Every field is resolved. */
export interface NormalizedOptions {
	properties: ResolvedProperty[]
	comment: string | false
	warnOnUserOverride: boolean
}
