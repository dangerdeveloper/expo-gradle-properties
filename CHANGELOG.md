# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — unreleased

### Changed

- Passing an array now fails with a message that shows the exact string to write
  instead, in both the comma-separated and space-separated forms. Arrays are still
  refused rather than joined automatically: `reactNativeArchitectures` separates with
  commas while `org.gradle.jvmargs` separates with spaces, so guessing would quietly
  produce a broken build file. The previous message only said "expected a string,
  number, boolean or null", which was correct but gave no way forward — and anyone
  arriving from `expo-build-properties` reaches for an array, because `buildArchs`
  takes one.

### Documentation

- Added a section on setting the Android ABIs: what the four are, why the template's
  all-four default costs build time, and the App Bundle caveat — narrowing ABIs does
  not shrink what users download from Google Play, only universal APKs and build time.

## [0.1.0] — 2026-08-20

Initial release.

### Added

- Set arbitrary keys in the generated `android/gradle.properties`, via a flat map or
  a full options object.
- Remove keys by setting them to `null`, so template defaults can be dropped.
- Replace existing keys **in place**, collapsing any duplicates — `gradle.properties`
  is last-wins, so a leftover duplicate silently beats the value that was written.
- Validate keys and values against the `.properties` format at config-read time.
  Expo serializes with no escaping, so a bad key would otherwise produce a file
  Gradle reads as a different property.
- Throw on unknown options rather than ignoring them.
- Warn during prebuild when `$GRADLE_USER_HOME/gradle.properties` overrides a key,
  showing both values. That file takes precedence over the project one, which is how
  the same commit builds differently on two machines.
