# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.1] - 2026-04-27

### Changed
- **Container**: UID and GID for `appuser`/`appgroup` are now pinned to `1000` (was Alpine's dynamic `adduser -S`). Lets the published Helm chart's default `runAsUser: 1000` match the running container.

### Added
- **Helm chart** at `helm/silencer/`, published as `oci://registry-1.docker.io/vtmocanu/silencer-chart`. Pluggable secret modes (`existing` / `create` / `externalSecret`), optional `ServiceMonitor` / VPA / `PodDisruptionBudget` / `NetworkPolicy`. See chart README for installation.
- Chart-publish CI (`.forgejo/workflows/chart.yml`) with helm lint, kubeconform, helm-docs drift check, and registry-presence-based publish to Docker Hub.

## [2.0.0] - 2026-04-26

- Initial open-source release on Codeberg.
