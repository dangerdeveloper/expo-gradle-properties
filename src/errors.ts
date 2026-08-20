/**
 * Thrown when the plugin config is malformed.
 *
 * This package exists because `expo-build-properties` accepts an unknown option,
 * drops it, and lets the build proceed on template defaults — a failure that only
 * surfaces as a confusing Gradle error much later. So every reachable bad input
 * here throws at config time with a message that names the key and the fix.
 */
export class GradlePropertiesConfigError extends Error {
	override readonly name = 'GradlePropertiesConfigError'

	constructor(message: string) {
		super(`[expo-gradle-properties] ${message}`)
	}
}
