import { type ConfigPlugin, withGradleProperties } from 'expo/config-plugins'

import { applyGradleProperties } from './apply'
import { normalizeOptions } from './normalize'
import { findUserOverrides, formatOverrideWarning } from './overrides'
import type { PluginConfig } from './types'

/**
 * Set arbitrary keys in the generated `android/gradle.properties`.
 *
 * ```ts
 * // app.config.ts
 * plugins: [
 *   ['expo-gradle-properties', {
 *     'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=2g',
 *     'org.gradle.parallel': true,
 *   }],
 * ]
 * ```
 *
 * The config is validated immediately, so a malformed key or value fails while the
 * app config is being read rather than surfacing as a Gradle error many minutes
 * into a build.
 *
 * The plugin is deliberately *not* wrapped in `createRunOncePlugin`: listing it
 * more than once is a legitimate way to group unrelated properties, and each entry
 * applies in order.
 */
const withGradlePropertiesPlugin: ConfigPlugin<PluginConfig> = (config, pluginConfig) => {
	// Validate at config-read time so the failure lands next to the mistake.
	const options = normalizeOptions(pluginConfig)

	return withGradleProperties(config, gradleConfig => {
		// Checked inside the mod so it only runs during prebuild — the app config is
		// also read by `expo start`, `expo config` and Metro, and a warning there
		// would just be noise.
		if (options.warnOnUserOverride) {
			const report = findUserOverrides(options.properties)
			if (report) console.warn(formatOverrideWarning(report))
		}

		gradleConfig.modResults = applyGradleProperties(gradleConfig.modResults, options)

		return gradleConfig
	})
}

export default withGradlePropertiesPlugin

export { applyGradleProperties } from './apply'
export type { ApplyOptions } from './apply'
export { GradlePropertiesConfigError } from './errors'
export { DEFAULT_COMMENT, normalizeOptions } from './normalize'
export { findUserOverrides, formatOverrideWarning, parseProperties } from './overrides'
export type { OverrideCollision, OverrideLookupDeps, UserOverrideReport } from './overrides'
export type {
	GradlePropertiesMap,
	GradlePropertiesOptions,
	GradlePropertyValue,
	NormalizedOptions,
	PluginConfig,
	PropertiesItem,
	ResolvedProperty
} from './types'
