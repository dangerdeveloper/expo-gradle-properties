# Contributing

Thanks for taking the time. Bug reports, failing test cases and doc fixes are all
genuinely welcome — you do not need to bring a full solution.

## Getting set up

```sh
git clone https://github.com/dangerdeveloper/expo-gradle-properties.git
cd expo-gradle-properties
bun install

bun run test        # vitest
bun run typecheck   # tsc --noEmit
bun run build       # tsc -> build/
```

The repo uses [bun](https://bun.sh). If you'd rather not install it, `npm install`
and `npx vitest run` work fine too — bun is a convenience here, not a requirement of
the code.

## How the code is laid out

The one rule worth knowing: **the interesting logic must be testable without running
a prebuild.** Prebuild is slow and awkward to drive from a test, so the real work
lives in pure functions and only a thin shell touches Expo.

| File | Role |
| --- | --- |
| `src/normalize.ts` | Turns raw plugin config into validated, coerced options. Every error message starts life here. |
| `src/apply.ts` | Pure: `(PropertiesItem[], properties) -> PropertiesItem[]`. No I/O at all. |
| `src/overrides.ts` | Reads `$GRADLE_USER_HOME/gradle.properties` and reports collisions. |
| `src/index.ts` | The config plugin. The only file that imports from `expo`. |
| `src/types.ts` | Public types, plus a local copy of Expo's `PropertiesItem` shape. |

`normalize.ts`, `apply.ts` and `overrides.ts` deliberately import **nothing** from
Expo. Please keep it that way — it is what makes the test suite fast and hermetic.

## Where your change probably goes

- **A new validation rule** → `src/normalize.ts`, plus cases in `src/normalize.test.ts`.
  Error messages should say what is wrong *and* why it matters, because this package
  exists to replace a silent failure with a loud one.
- **Different write behaviour** (ordering, comments, dedup) → `src/apply.ts` and
  `src/apply.test.ts`. Also add a case to `src/integration.test.ts` so the change is
  proven against Expo's real parser.
- **Override detection** → `src/overrides.ts`. Use the injected `env` / `homedir` /
  `readFile` seams so tests never touch a real home directory.

## Tests

Every behavioural change needs a test. The suite is fast (about 300ms), so there is
no excuse not to run it.

`src/integration.test.ts` is the one that matters most: it round-trips through Expo's
own `parsePropertiesFile` / `propertiesListToString` against a realistic template
file. If your change alters the output, that test should show it.

### Testing against a real prebuild

Unit tests can't prove the plugin works inside Expo's actual pipeline. To check by
hand:

```sh
npm pack                                  # -> expo-gradle-properties-x.y.z.tgz

# in a scratch Expo app:
npm install ../expo-gradle-properties/expo-gradle-properties-x.y.z.tgz
npx expo prebuild --platform android --no-install --clean
cat android/gradle.properties
```

Set `GRADLE_USER_HOME` to a throwaway directory while doing this, or the override
warning will read your own `~/.gradle/gradle.properties`.

## Pull requests

- Branch off `main`.
- Keep the diff focused. Two unrelated fixes are two pull requests.
- `bun run typecheck && bun run test && bun run build` must pass. CI runs exactly this.
- Explain **why**, not just what. A comment explaining a non-obvious constraint is
  worth more than a tidy diff.

Commit messages loosely follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Not enforced by a hook — just keeps the
changelog honest.

## Reporting a bug

The most useful report contains your `app.config.ts` plugin block, the relevant part
of the generated `android/gradle.properties`, and what you expected instead. A failing
test case is even better.

## Scope

This plugin writes `android/gradle.properties`, and that is all it does. Changes to
`build.gradle`, Proguard rules, Maven repos or anything iOS belong in
[`expo-build-properties`](https://docs.expo.dev/versions/latest/sdk/build-properties/),
which is first-party and already does them well.

Requests that widen the scope will probably be declined — not because they're bad
ideas, but because a small tool that does one thing predictably is the point.
