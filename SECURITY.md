# Security Policy

## Supported versions

The latest published version on npm receives fixes. This project is pre-1.0, so
please stay current.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's [private vulnerability reporting](https://github.com/ajaysingh56656/expo-gradle-properties/security/advisories/new),
or email **ajaysingh56656@gmail.com**. You can expect an acknowledgement within a few
days.

## Threat model

This is a build-time tool. It runs on a developer machine or a CI runner during
`expo prebuild`, and it:

- reads the plugin configuration from your `app.config.ts` / `app.json`
- reads `$GRADLE_USER_HOME/gradle.properties` (default `~/.gradle/gradle.properties`)
  to produce a warning, and never transmits or logs its full contents — only the
  values of keys you yourself set
- writes `android/gradle.properties`
- makes no network requests, and has no runtime dependencies

The most plausible issue is a validation gap that lets a crafted key or value escape
its line and inject an unintended property into the generated file. Reports of that
kind are very welcome.
