# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.4] - 2026-04-28

### Fixed
- **Dockerfile HEALTHCHECK now probes `/livez` instead of `/healthz`.** The previous probe followed the readiness endpoint, which returns 503 during Slack outages and would cause `docker run`/Compose users to restart-loop in lockstep with Slack incidents. K8s deployments use the chart's own probe config and ignore Docker's HEALTHCHECK directive, so this was only a problem for non-K8s consumers. The app's own code at `slack-socket-silencer-bot.js` documents this design ("Liveness uses /livez (always 200) on purpose"); the Dockerfile now matches.

### Added
- **OCI labels on the runtime image** (`org.opencontainers.image.title`, `description`, `source`, `url`, `licenses`, `authors`). Display on GHCR's package page and ArtifactHub.

### Changed
- Runtime stage in Dockerfile is now named `runtime` for readability and external tooling references.

## [Chart 0.3.1] - 2026-04-28

### Changed
- Bumps `appVersion` to `v2.0.4` (Dockerfile HEALTHCHECK fix + OCI labels). No values-schema changes.

## [Chart 0.3.0] - 2026-04-28

### Changed (BREAKING)
- Chart name renamed `silencer-chart` → `silencer` (drops the Docker Hub flat-namespace workaround now that we publish to GHCR). Default `image.repository` moved `docker.io/vtmocanu/silencer` → `ghcr.io/vtmocanu/silencer`. Chart now published at `oci://ghcr.io/vtmocanu/charts/silencer` (was `oci://registry-1.docker.io/vtmocanu/silencer-chart`). Existing installs that pinned the old OCI URL or relied on the Docker Hub default need their `helm install`/`HelmRelease` updated.

### CI
- Workflows ported from `.forgejo/workflows/` (Codeberg) to `.github/workflows/` (GitHub Actions). Image build now uses `docker/build-push-action` with BuildKit GitHub Actions cache. Chart job uses `azure/setup-helm`. All third-party actions SHA-pinned for OSS supply-chain hygiene. Auth via `${{ secrets.GITHUB_TOKEN }}` (no manual Docker Hub PAT).

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
