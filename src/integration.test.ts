import { AndroidConfig } from 'expo/config-plugins'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyGradleProperties } from './apply'
import withGradleProperties from './index'
import { normalizeOptions } from './normalize'
import type { PluginConfig } from './types'

const { parsePropertiesFile, propertiesListToString } = AndroidConfig.Properties

/** The config shape the plugin accepts, without depending on @expo/config-types. */
type TestConfig = Parameters<typeof withGradleProperties>[0]

/**
 * A representative `android/gradle.properties` as Expo prebuild generates it —
 * comments, blank lines, commented-out defaults and the keys people actually
 * override.
 */
const TEMPLATE = `# Project-wide Gradle settings.

# IDE (e.g. Android Studio) users:
# Gradle settings configured through the IDE *will override*
# any settings specified in this file.

# Specifies the JVM arguments used for the daemon process.
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m

# When configured, Gradle will run in incubating parallel mode.
# org.gradle.parallel=true

# AndroidX package structure to make it clearer which packages are bundled with the
# Android operating system, and which are packaged with your app's APK
android.useAndroidX=true

# Use this property to specify which architecture you want to build.
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64

# Use this property to enable support to the new architecture.
newArchEnabled=true

# Use this property to enable or disable the Hermes JS engine.
hermesEnabled=true

# Enable GIF support in React Native images
expo.gif.enabled=true
expo.webp.enabled=true
expo.webp.animated=false

EX_DEV_CLIENT_NETWORK_INSPECTOR=true
`

/** Run the pure core over real parsed input and hand back the real serialized text. */
function roundTrip(source: string, config: PluginConfig): string {
	const options = normalizeOptions(config)
	const applied = applyGradleProperties(parsePropertiesFile(source), options)

	return propertiesListToString(applied)
}

describe('round trip through Expo’s own parser and serializer', () => {
	it('overwrites a template key in place', () => {
		const output = roundTrip(TEMPLATE, { 'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=2g' })

		expect(output).toContain('org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=2g')
		expect(output).not.toContain('-Xmx2048m')
		// The explanatory comment above it must survive.
		expect(output).toContain('# Specifies the JVM arguments used for the daemon process.\norg.gradle.jvmargs=')
	})

	it('appends a key the template does not have, under a header', () => {
		const output = roundTrip(TEMPLATE, { 'kotlin.daemon.jvmargs': '-Xmx2g' })

		expect(output).toContain('# Managed by expo-gradle-properties\nkotlin.daemon.jvmargs=-Xmx2g')
	})

	it('re-parses to exactly the values that were set', () => {
		const output = roundTrip(TEMPLATE, {
			'org.gradle.jvmargs': '-Xmx4g',
			'org.gradle.parallel': true,
			'kotlin.daemon.jvmargs': '-Xmx2g',
			reactNativeArchitectures: 'arm64-v8a',
			newArchEnabled: false,
			'expo.webp.animated': null
		})

		const reparsed = new Map(
			parsePropertiesFile(output).flatMap(item => (item.type === 'property' ? [[item.key, item.value] as const] : []))
		)

		expect(reparsed.get('org.gradle.jvmargs')).toBe('-Xmx4g')
		expect(reparsed.get('org.gradle.parallel')).toBe('true')
		expect(reparsed.get('kotlin.daemon.jvmargs')).toBe('-Xmx2g')
		expect(reparsed.get('reactNativeArchitectures')).toBe('arm64-v8a')
		expect(reparsed.get('newArchEnabled')).toBe('false')
		expect(reparsed.has('expo.webp.animated')).toBe(false)
	})

	it('leaves no duplicate key in the serialized file', () => {
		const output = roundTrip(TEMPLATE, { 'org.gradle.jvmargs': '-Xmx4g', added: '1' })

		const keys = parsePropertiesFile(output).flatMap(item => (item.type === 'property' ? [item.key] : []))
		expect(keys).toEqual([...new Set(keys)])
	})

	it('does not resurrect a commented-out default', () => {
		// `# org.gradle.parallel=true` is a comment, not a property, so setting the
		// key must append a real entry rather than pretending one already exists.
		const output = roundTrip(TEMPLATE, { 'org.gradle.parallel': true })

		expect(output).toContain('# org.gradle.parallel=true')
		expect(output).toContain('\norg.gradle.parallel=true')
	})

	it('is byte-identical when applied twice', () => {
		const config = { 'org.gradle.jvmargs': '-Xmx4g', added: '1', 'expo.webp.animated': null }

		expect(roundTrip(roundTrip(TEMPLATE, config), config)).toBe(roundTrip(TEMPLATE, config))
	})

	it('leaves the file untouched when there is nothing to do', () => {
		expect(roundTrip(TEMPLATE, {})).toBe(TEMPLATE)
	})

	it('ends the file with a newline', () => {
		expect(roundTrip(TEMPLATE, { added: '1' }).endsWith('\n')).toBe(true)
	})
})

describe('the plugin as Expo runs it', () => {
	// Expo's `withMod` mutates the config it is handed, so every case needs a fresh
	// one — a shared object would accumulate mods across tests.
	const baseConfig = () => ({ name: 'test', slug: 'test' }) as TestConfig

	// Point the override lookup at an empty directory by default. Without this the
	// tests read whoever's real ~/.gradle/gradle.properties is on the machine, and
	// pass or warn depending on the developer's dotfiles.
	const previousGradleUserHome = process.env.GRADLE_USER_HOME

	beforeEach(() => {
		process.env.GRADLE_USER_HOME = `${__dirname}/__fixtures__/empty-gradle-home`
	})

	afterEach(() => {
		process.env.GRADLE_USER_HOME = previousGradleUserHome
	})

	/** Register the plugin, then drive the mod the way prebuild would. */
	async function runPlugin(pluginConfig: PluginConfig, source = TEMPLATE) {
		const base = baseConfig()
		const config = withGradleProperties(base, pluginConfig)
		const mod = (config as { mods?: { android?: { gradleProperties?: unknown } } }).mods?.android?.gradleProperties

		expect(typeof mod).toBe('function')

		const result = (await (mod as (c: unknown) => Promise<{ modResults: AndroidConfig.Properties.PropertiesItem[] }>)({
			...config,
			modResults: parsePropertiesFile(source),
			modRequest: { projectRoot: '/tmp/project', platform: 'android', modName: 'gradleProperties' },
			modRawConfig: base
		})) as { modResults: AndroidConfig.Properties.PropertiesItem[] }

		return propertiesListToString(result.modResults)
	}

	it('registers an android gradleProperties mod and writes through it', async () => {
		const output = await runPlugin({ 'org.gradle.jvmargs': '-Xmx4g' })

		expect(output).toContain('org.gradle.jvmargs=-Xmx4g')
	})

	it('validates the config immediately, before any mod runs', () => {
		// The throw has to happen while the app config is being read, not deep in prebuild.
		expect(() => withGradleProperties(baseConfig(), { 'bad key': '1' })).toThrow(/Invalid Gradle property key/)
	})

	it('composes when listed more than once', async () => {
		const base = baseConfig()
		const first = withGradleProperties(base, { a: '1' })
		const second = withGradleProperties(first, { b: '2' })
		const mod = (second as unknown as {
			mods: { android: { gradleProperties: (c: unknown) => Promise<{ modResults: AndroidConfig.Properties.PropertiesItem[] }> } }
		}).mods.android.gradleProperties

		const result = await mod({
			...second,
			modResults: parsePropertiesFile('existing=0\n'),
			modRequest: { projectRoot: '/tmp/project', platform: 'android', modName: 'gradleProperties' },
			modRawConfig: base
		})

		const output = propertiesListToString(result.modResults)
		expect(output).toContain('a=1')
		expect(output).toContain('b=2')
	})

	it('resolves a key set twice to the EARLIER entry, not the later one', async () => {
		// Counter-intuitive, and worth pinning down: Expo runs mods in reverse
		// registration order, so the first `expo-gradle-properties` entry in the
		// plugins array is the one that runs last and therefore wins. The README tells
		// people not to rely on this and to set a key in one place only.
		const base = baseConfig()
		const first = withGradleProperties(base, { 'org.gradle.jvmargs': '-Xmx2g' })
		const second = withGradleProperties(first, { 'org.gradle.jvmargs': '-Xmx8g' })
		const mod = (second as unknown as {
			mods: { android: { gradleProperties: (c: unknown) => Promise<{ modResults: AndroidConfig.Properties.PropertiesItem[] }> } }
		}).mods.android.gradleProperties

		const result = await mod({
			...second,
			modResults: parsePropertiesFile('existing=0\n'),
			modRequest: { projectRoot: '/tmp/project', platform: 'android', modName: 'gradleProperties' },
			modRawConfig: base
		})

		const output = propertiesListToString(result.modResults)
		expect(output).toContain('org.gradle.jvmargs=-Xmx2g')
		expect(output).not.toContain('-Xmx8g')

		const keys = parsePropertiesFile(output).flatMap(i => (i.type === 'property' ? [i.key] : []))
		expect(keys).toEqual([...new Set(keys)])
	})

	it('warns when the machine-level Gradle config overrides a key', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		process.env.GRADLE_USER_HOME = `${__dirname}/__fixtures__/gradle-user-home`

		try {
			await runPlugin({ 'org.gradle.jvmargs': '-Xmx4g' })

			expect(warn).toHaveBeenCalledOnce()
			expect(warn.mock.calls[0]?.[0]).toContain('org.gradle.jvmargs')
			expect(warn.mock.calls[0]?.[0]).toContain('-Xmx512m')
		} finally {
			warn.mockRestore()
		}
	})

	it('stays silent when warnOnUserOverride is off', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		process.env.GRADLE_USER_HOME = `${__dirname}/__fixtures__/gradle-user-home`

		try {
			await runPlugin({ properties: { 'org.gradle.jvmargs': '-Xmx4g' }, warnOnUserOverride: false })

			expect(warn).not.toHaveBeenCalled()
		} finally {
			warn.mockRestore()
		}
	})
})
