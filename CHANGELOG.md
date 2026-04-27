# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.3] - 2026-04-27

### Fixed
- **Crash on alerts without a Silence button.** When a user replied with
  `s 1w` (or similar) to a Slack alert whose attachment did not include
  the `Silence :no_bell:` action button, `findAlertMessageFilter` called
  `.url` on `undefined` and crashed the bolt event handler. The bot now
  treats this as "no alert here" (logs at debug) and falls through, so
  the channel-history search keeps looking and the thread case returns
  cleanly. This typically happens when an alertname contains characters
  that break Slack's button URL validation (spaces, brackets), causing
  Slack to silently drop the button from the rendered message.

## [2.0.2] - 2026-04-27

### Added
- New `/livez` endpoint that always returns 200. Use this for the kubelet
  liveness probe. `/healthz` (which reports 503 during prolonged Slack
  disconnects) should now be used only for readiness, so a Slack outage
  no longer triggers cluster-wide restart loops.

### Changed
- **Dockerfile** is now multi-stage (`npm ci --omit=dev` in a builder stage)
  and requires a committed `package-lock.json` for reproducible builds.
- HEALTHCHECK now probes `/healthz` instead of `/`.

## [2.0.1] - 2026-04-27

### Changed
- **Container**: now runs as the official Node.js image's pre-existing `node` user (UID/GID 1000) instead of a custom Alpine `appuser` with a dynamic system UID. Lets the published Helm chart's default `runAsUser: 1000` match the running container.

### Added
- **Helm chart** at `helm/silencer/`, published as `oci://registry-1.docker.io/vtmocanu/silencer-chart`. Pluggable secret modes (`existing` / `create` / `externalSecret`), optional `ServiceMonitor` / VPA / `PodDisruptionBudget` / `NetworkPolicy`. See chart README for installation.
- Chart-publish CI (`.forgejo/workflows/chart.yml`) with helm lint, kubeconform, helm-docs drift check, and registry-presence-based publish to Docker Hub.

## [2.0.0] - 2026-04-26

- Initial open-source release on Codeberg.
