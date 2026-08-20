# expo-gradle-properties

[![npm version](https://img.shields.io/npm/v/expo-gradle-properties.svg)](https://www.npmjs.com/package/expo-gradle-properties)
[![CI](https://github.com/dangerdeveloper/expo-gradle-properties/actions/workflows/ci.yml/badge.svg)](https://github.com/dangerdeveloper/expo-gradle-properties/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/expo-gradle-properties.svg)](./LICENSE)

An [Expo config plugin](https://docs.expo.dev/config-plugins/introduction/) that writes arbitrary keys into the generated `android/gradle.properties`.

It is the generic escape hatch that `expo-build-properties` doesn't have.

```ts
// app.config.ts
plugins: [
  ['expo-gradle-properties', {
    'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=2g',
    'kotlin.daemon.jvmargs': '-Xmx2g',
    'org.gradle.parallel': true,
  }],
]
```

## Why

In a prebuild (CNG) Expo app, `android/` is a build artifact. Editing `android/gradle.properties` by hand works exactly until the next `expo prebuild` throws it away, so the only durable way to set those values is a config plugin.

`expo-build-properties` is the obvious place for this, and it can't do it. As of **v57.0.13** its entire Android surface is:

```
minSdkVersion  compileSdkVersion  targetSdkVersion  buildToolsVersion  cmakeVersion
kotlinVersion  enableMinifyInReleaseBuilds  enableShrinkResourcesInReleaseBuilds
enablePngCrunchInReleaseBuilds  extraProguardRules  packagingOptions  networkInspector
extraMavenRepos  usesCleartextTraffic  useLegacyPackaging  manifestQueries
useDayNightTheme  enableBundleCompression  buildArchs  exclusiveMavenMirror
```

Exactly one of those reaches `gradle.properties` — `buildArchs`, written out as `reactNativeArchitectures`. There is no way to express `org.gradle.jvmargs`, `kotlin.daemon.jvmargs`, `org.gradle.caching`, or any flag your own Gradle code reads.

And the failure is a quiet one. Passing an unknown key to `expo-build-properties` is not an error and not a warning — the value is accepted, dropped, and the build carries on with the template defaults. You find out fourteen minutes into a release build, via an `OutOfMemoryError: Metaspace` that points at nothing.

So this plugin has one job, and it is loud about doing it.

## Install

```sh
npx expo install expo-gradle-properties
```

## Usage

### Shorthand

Pass a flat map. This is the common case.

```ts
plugins: [
  ['expo-gradle-properties', {
    'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=2g -Dfile.encoding=UTF-8',
    'kotlin.daemon.jvmargs': '-Xmx2g',
    'org.gradle.parallel': true,
    'org.gradle.caching': true,
    reactNativeArchitectures: 'arm64-v8a',
  }],
]
```

### Full form

Pass `properties` plus options.

```ts
plugins: [
  ['expo-gradle-properties', {
    properties: {
      'org.gradle.jvmargs': '-Xmx4g',
      'org.gradle.configureondemand': null,  // remove the key entirely
    },
    comment: 'set by our build config',
    warnOnUserOverride: true,
  }],
]
```

The full form is used when the config has a `properties` key holding an object. (A Gradle property genuinely named `properties` therefore needs the full form: `{ properties: { properties: '…' } }`.)

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `properties` | — | The map of properties to write. Required in the full form. |
| `comment` | `'Managed by expo-gradle-properties'` | Header written above appended keys. `false` writes none. |
| `warnOnUserOverride` | `true` | Warn when `$GRADLE_USER_HOME/gradle.properties` will beat these values. [See below.](#the-machine-level-override-warning) |

### Values

| You write | The file gets |
| --- | --- |
| `'-Xmx4g'` | `-Xmx4g` |
| `4096` | `4096` |
| `true` / `false` | `true` / `false` |
| `null` / `undefined` | the key is **removed** |

`null` lets you drop a key the Expo template sets, and makes conditionals read cleanly:

```ts
'org.gradle.caching': process.env.CI ? true : null,
```

## Setting the Android ABIs

`reactNativeArchitectures` is the property people most often come here for, so it's worth spelling out. It takes a **comma-separated string**, not an array:

```ts
plugins: [
  ['expo-gradle-properties', {
    reactNativeArchitectures: 'arm64-v8a',
  }],
]
```

Android has four ABIs (CPU architectures):

| ABI | What it is | Do you need it? |
| --- | --- | --- |
| `arm64-v8a` | 64-bit ARM | **Yes.** Every modern phone, and required by Google Play. |
| `armeabi-v7a` | 32-bit ARM | Only for older devices. Still supported — *not* deprecated. |
| `x86_64` | 64-bit Intel | Only for emulators (Apple Silicon and Intel). |
| `x86` | 32-bit Intel | Effectively legacy. Physical x86 Android devices are long gone. |

**The Expo template builds all four.** That default is safe but expensive: every native dependency you have — Reanimated, Gesture Handler, Nitro, MapLibre, SVG, Screens — gets its C++ compiled **four separate times**. On a large app that dominates build time.

Narrowing to one architecture is the single biggest build-time win available:

```ts
reactNativeArchitectures: 'arm64-v8a'   // every modern phone
```

The tradeoff is real: that build **will not install** on 32-bit ARM devices or on x86 emulators. It's ideal for local development and CI on Apple Silicon, and for testing on modern hardware.

To go back to the full set:

```ts
reactNativeArchitectures: 'armeabi-v7a,arm64-v8a,x86,x86_64'
```

### A note on app size

Narrowing ABIs does **not** shrink what your users download, if you ship an **App Bundle** (`.aab`) — which Google Play requires. Play splits the bundle per device and delivers only the matching ABI, so a user on an arm64 phone downloads arm64 code either way.

What narrowing *does* shrink is a **universal APK** — a dev-client build, an internal-distribution APK, or anything installed via `adb`. And what it always saves is **build time**.

### What Google Play requires

Since **August 2019**, Play has required a 64-bit version of any app containing native code — you cannot publish 32-bit only. `armeabi-v7a` is *not* deprecated and 32-bit devices still exist, so the usual production answer is to ship both ARM ABIs and drop the x86 pair:

```ts
reactNativeArchitectures: 'armeabi-v7a,arm64-v8a'
```

From Android 14, devices with ARMv9 cores cannot run 32-bit code at all, so the long-term direction is arm64-only — but that's not the situation today.

## Behaviour

**Existing keys are replaced in place.** The entry keeps its original position, so a prebuild diff is one changed line rather than a deletion plus an append at the bottom — and the template's explanatory comment stays attached to the property it explains.

**Duplicates are collapsed.** If a key somehow appears twice, the first entry is replaced and the rest are deleted. This is a correctness requirement, not tidiness: `gradle.properties` is last-wins, so a plugin that blindly appends leaves a file that *reads* as though it worked while Gradle uses the other line.

**New keys are appended** at the end, under a single comment header, so anyone reading the generated file can see what put them there.

**Removals are idempotent.** Removing a key that isn't there is a no-op, and running prebuild twice produces a byte-identical file.

## The machine-level override warning

This is the part worth having.

Gradle resolves `gradle.properties` with the **user-level file winning over the project-level one**. Highest priority first:

1. command line `-P`
2. `$GRADLE_USER_HOME/gradle.properties` — usually `~/.gradle/gradle.properties`
3. `<project>/gradle.properties` ← everything this plugin writes
4. `$GRADLE_HOME/gradle.properties`

That inverts the usual "closest file wins" intuition, and it bites hard. A developer who once set `org.gradle.jvmargs` in `~/.gradle/gradle.properties` gets builds that silently disagree with CI on the same commit. On a self-hosted runner, the *runner's* home file beats your repo for every build that machine will ever run.

So during prebuild the plugin reads that file and tells you:

```
[expo-gradle-properties] 1 property is overridden by your machine-level Gradle config.
  ~/.gradle/gradle.properties takes precedence over the project's gradle.properties, so the build will NOT use the value this plugin sets.
    org.gradle.jvmargs
      this plugin: -Xmx4g -XX:MaxMetaspaceSize=2g
      ~/.gradle/gradle.properties: -Xmx1g
  Remove the key from ~/.gradle/gradle.properties, or pass warnOnUserOverride: false to silence this.
```

It warns and never throws — a machine-level override can be deliberate, and a config plugin has no business failing your build over your own dotfile. Set `warnOnUserOverride: false` to turn it off.

## Validation

Expo writes `gradle.properties` as `key=value` with **no escaping at all**, so a malformed key produces a file Gradle quietly reads as something else. Everything below throws while your app config is being read, naming the key and the reason:

- keys containing whitespace, `=`, `:` or `\` — all of these separate or escape entries
- keys starting with `#` or `!` — the line would be a comment
- values containing a line break
- values ending in an odd number of backslashes — a trailing `\` is a line continuation and would swallow the next property
- non-finite numbers and objects
- arrays — with a message showing the joined string to write instead, since `expo-build-properties` takes its ABI list as an array and the habit carries over
- unknown options in the full form — because silently dropping an option is the bug this package exists to fix

## Should you use this or `expo-build-properties`?

Use `expo-build-properties` for anything it covers. It is first-party, and it edits `build.gradle`, Proguard rules and Maven repos, which this plugin deliberately does not touch.

| | `expo-build-properties` | `expo-gradle-properties` |
| --- | --- | --- |
| SDK versions, Kotlin, minify, Proguard, Maven repos | ✅ | ❌ (out of scope) |
| `reactNativeArchitectures` | ✅ as `buildArchs` | ✅ |
| `org.gradle.jvmargs`, `kotlin.daemon.jvmargs`, `org.gradle.caching`, custom flags | ❌ | ✅ |
| Unknown option | silently ignored | throws |
| iOS | ✅ | ❌ (no counterpart file) |

They compose — run both.

## Requirements

- Expo SDK 50 or newer
- Node 18+
- A prebuild (CNG) workflow. If you check `android/` into git and never run `expo prebuild`, edit the file directly instead.

## Development

```sh
bun install
bun run test        # 99 tests
bun run typecheck
bun run build
```

The interesting logic is pure and lives in `src/apply.ts` and `src/normalize.ts`; neither imports anything from Expo, so it can be tested without a prebuild. `src/integration.test.ts` round-trips through Expo's own `parsePropertiesFile` / `propertiesListToString` to prove the output is a file Expo will still read.

See [DESIGN.md](./DESIGN.md) for why it is built this way.

## Contributing

Bug reports, failing test cases and doc fixes are all welcome — you don't need to
bring a full solution. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the layout, where
your change probably goes, and how to test against a real prebuild.

By taking part you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MIT © [dangerdeveloper](https://github.com/dangerdeveloper)
