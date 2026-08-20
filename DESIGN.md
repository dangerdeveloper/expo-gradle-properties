# expo-gradle-properties — design

An Expo config plugin that writes arbitrary keys into the generated
`android/gradle.properties`.

Status: design accepted, v0.1.0 in progress.

---

## 1. Why this exists

`gradle.properties` is where a React Native Android build gets its memory limits,
its daemon settings, its ABI list, and any custom flag the app's own Gradle code
reads. In a Continuously-Native-Generated (CNG) Expo app, `android/` is a build
artifact — `expo prebuild` regenerates it, so hand-editing that file is lost on the
next prebuild. The only durable way to set those values is a config plugin.

Expo's own `expo-build-properties` is the obvious place for this, and it does not
have it. Verified against **`expo-build-properties@57.0.13`**, the full Android
option list is:

```
minSdkVersion  compileSdkVersion  targetSdkVersion  buildToolsVersion  cmakeVersion
kotlinVersion  enableMinifyInReleaseBuilds  enableShrinkResourcesInReleaseBuilds
enablePngCrunchInReleaseBuilds  extraProguardRules  packagingOptions  networkInspector
extraMavenRepos  usesCleartextTraffic  useLegacyPackaging  manifestQueries
useDayNightTheme  enableBundleCompression  buildArchs  exclusiveMavenMirror
```

Exactly one of those reaches `gradle.properties`: `buildArchs`, which is written out
as `reactNativeArchitectures`. There is **no generic escape hatch**. Setting
`org.gradle.jvmargs`, `kotlin.daemon.jvmargs`, `org.gradle.parallel`,
`org.gradle.caching`, or any app-specific flag is simply not expressible.

The failure mode that motivated this package is the bad one: passing an unknown key
to `expo-build-properties` is **not** an error and **not** a warning. The value is
accepted, silently dropped, and the build proceeds with the template defaults. The
symptom shows up much later as an out-of-memory crash fourteen minutes into a
release build, and nothing points back at the config.

So the package has one job, and a strong opinion about how to do it loudly.

## 2. Scope

**In scope**

- Set, overwrite, and remove keys in the generated `android/gradle.properties`.
- Reject malformed keys and values at config time, with an actionable message.
- Warn when a machine-level `gradle.properties` will beat what we just wrote.

**Out of scope**

- iOS. There is no counterpart file; `expo-build-properties` covers the iOS knobs.
- Anything in `build.gradle`, `settings.gradle`, or `proguard-rules.pro`.
  `expo-build-properties` owns those and does them well.
- Reading values back out, or exposing them to app JS.

Non-goal: replacing `expo-build-properties`. This is the escape hatch that sits
next to it. The README says so explicitly, and recommends `buildArchs` over our
own `reactNativeArchitectures` when the user only needs that one key.

## 3. Public API

The plugin accepts either a flat map of properties, or a full options object.

```ts
// app.config.ts — shorthand, the common case
plugins: [
  ['expo-gradle-properties', {
    'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=2g',
    'org.gradle.parallel': true,
    'kotlin.daemon.jvmargs': '-Xmx2g',
    reactNativeArchitectures: 'arm64-v8a',
  }],
]
```

```ts
// full form, when you need the options
plugins: [
  ['expo-gradle-properties', {
    properties: {
      'org.gradle.jvmargs': '-Xmx4g',
      'org.gradle.configureondemand': null,   // remove the key entirely
    },
    comment: 'set by expo-gradle-properties',
    warnOnUserOverride: true,
  }],
]
```

### Disambiguating the two forms

The config is treated as the full form **iff** it has an own `properties` key whose
value is a non-null object. Otherwise it is a flat map.

A Gradle property literally named `properties` is therefore unreachable in
shorthand. This is documented, and the full form is the escape hatch
(`{ properties: { properties: 'x' } }`). The alternative — a reserved sigil like
`$options` — was rejected as uglier for the 99% case.

### Value coercion

| Input                | Written as        |
| -------------------- | ----------------- |
| `string`             | verbatim          |
| `number` (finite)    | `String(n)`       |
| `boolean`            | `'true'`/`'false'`|
| `null` / `undefined` | key is removed    |
| anything else        | throws            |

`NaN` and `Infinity` throw rather than writing the string `"NaN"` into a build file.

### Options

| Option               | Default                          | Meaning |
| -------------------- | -------------------------------- | ------- |
| `properties`         | —                                | the map, required in full form |
| `comment`            | `'Managed by expo-gradle-properties'` | header written above appended keys; `false` disables |
| `warnOnUserOverride` | `true`                           | see §5 |

## 4. Behaviour

### Validation, at config time

A Java `.properties` key cannot contain `=`, `:`, or whitespace, and cannot begin
with `#` or `!` (those start a comment). A value cannot contain a raw newline. Each
of these is rejected with a message naming the offending key and why, because the
whole point of the package is to fail loudly where `expo-build-properties` failed
silently. Validation runs when the config is read — before prebuild writes anything.

### Writing: replace in place, append once

For each key:

- **Not present** → appended at the end of the file, under a single comment header.
- **Present once** → the existing entry is replaced **at its original position**.
  This keeps prebuild diffs to one line instead of a delete plus an append.
- **Present more than once** → the first occurrence is replaced, the rest deleted.

That last case is the bug this package must not reproduce. `gradle.properties` is
last-wins, so a plugin that blindly appends leaves two lines for the same key. The
file then *reads* as though the plugin worked while Gradle uses whichever line
happens to be last. Any correct implementation has to delete the duplicates.

Ordering is stable: the properties are applied in `Object.keys` order, so repeated
prebuilds of an unchanged config produce a byte-identical file and an empty diff.

### Removal

`null` deletes every entry for that key and does not append anything. Removing a
key that was never there is a no-op, not an error — config plugins must be
idempotent across prebuilds.

## 5. The user-override warning

This is the part no other tool does, and the reason the package is worth more than
the thirty lines it takes to write.

Gradle resolves `gradle.properties` with the **user-level file winning over the
project-level one**. The documented order, highest first:

1. command line `-P`
2. `$GRADLE_USER_HOME/gradle.properties` (default `~/.gradle/gradle.properties`)
3. `<project>/gradle.properties`  ← everything this plugin writes lands here
4. `$GRADLE_HOME/gradle.properties`

This inverts the intuition that the file closest to the project wins, and it has a
nasty consequence for React Native teams: a developer who once set
`org.gradle.jvmargs` in `~/.gradle/gradle.properties` gets a build that silently
disagrees with CI on the same commit — and, on a self-hosted runner, the *runner's*
home file beats the repo for every build that machine ever runs.

So when `warnOnUserOverride` is on, prebuild reads
`$GRADLE_USER_HOME/gradle.properties` (falling back to `~/.gradle/gradle.properties`),
intersects its keys with ours, and warns per colliding key with both values:

```
warn expo-gradle-properties: 1 property is overridden by your machine-level Gradle config.
     ~/.gradle/gradle.properties takes precedence over the project file, so the build will NOT use the value below.
       org.gradle.jvmargs
         this plugin:            -Xmx4g -XX:MaxMetaspaceSize=2g
         ~/.gradle/gradle.properties: -Xmx2g
     Remove the key from ~/.gradle/gradle.properties, or set warnOnUserOverride: false.
```

It warns, never throws — a machine-level override can be deliberate, and a config
plugin has no business failing someone's build over their own dotfile. Any error
reading the file (missing, unreadable, permissions) is swallowed: this is a
diagnostic, not a dependency.

## 6. Module layout

The design constraint is that the interesting logic must be testable without
running a prebuild.

```
src/
  index.ts        the plugin. Thin: normalize, then withGradleProperties(...).
  normalize.ts    unknown config -> NormalizedOptions. All validation lives here.
  apply.ts        pure: (PropertiesItem[], props) -> PropertiesItem[]. No I/O.
  overrides.ts    reads $GRADLE_USER_HOME/gradle.properties, returns collisions.
  types.ts        public types + a local PropertiesItem structural copy.
```

`apply.ts` and `normalize.ts` import nothing from Expo — `PropertiesItem` is a
three-variant union that is cheaper to restate than to depend on. That keeps the
unit tests free of the prebuild machinery, and it means the core can be exercised
against a real Expo template file in an integration test that parses and stringifies
with Expo's own `parsePropertiesFile` / `propertiesListToString`. Round-tripping
through the real parser is what proves the output is a valid properties file, so
that test is the one that actually matters.

`app.plugin.js` at the package root re-exports `build/index.js`; that filename is
the convention Expo looks for when resolving `['expo-gradle-properties', {...}]`.

## 7. Compatibility

- **Peer:** `expo >= 50`. `withGradleProperties` and the `expo/config-plugins`
  re-export are stable across that range.
- **Ships:** CommonJS plus `.d.ts`. Config plugins are `require`d by Expo's config
  resolution, so CJS is the format that matters; ESM buys nothing here.
- **Node:** >= 18.

## 8. Risks

| Risk | Response |
| ---- | -------- |
| Expo adds a real `gradleProperties` to `expo-build-properties` | Good outcome. README points there, package goes into maintenance. The API is deliberately small enough to deprecate cleanly. |
| `withGradleProperties` changes shape in a future SDK | The dependency is one function and a three-variant union; the blast radius is `index.ts`. CI runs against the current SDK. |
| Shorthand/full-form ambiguity confuses someone | Documented, escape hatch exists, and a config with `properties` as a non-object still parses as shorthand rather than throwing. |
| Users set a key that Expo's own template also manages | Replace-in-place means we win the file, and the override warning covers the machine-level case. Cannot detect a *Gradle-code*-level override; out of scope. |
