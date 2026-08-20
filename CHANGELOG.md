# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — unreleased

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
