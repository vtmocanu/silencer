# silencer

Slack bot that silences Prometheus Alertmanager alerts via thread replies.

![Version: 0.3.1](https://img.shields.io/badge/Version-0.3.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v2.0.4](https://img.shields.io/badge/AppVersion-v2.0.4-informational?style=flat-square)

**Homepage:** <https://github.com/vtmocanu/silencer>

## TL;DR

```bash
kubectl create namespace monitoring

# Provide tokens out-of-band (recommended)
kubectl -n monitoring create secret generic silencer \
  --from-literal=SLACK_APP_TOKEN=xapp-1-... \
  --from-literal=SLACK_BOT_TOKEN=xoxb-...

helm install silencer oci://ghcr.io/vtmocanu/charts/silencer \
  --version 0.3.1 \
  --namespace monitoring \
  --set secrets.existing.name=silencer
```

## Introduction

Silencer is a Slack bot that lets you silence
[Prometheus Alertmanager](https://github.com/prometheus/alertmanager) alerts
by replying directly in the Slack alert thread (`s 1h`, `s 30m`, `check`,
`expire`). The Alertmanager URL is read off each alert's silence-button, so
one bot can manage silences across multiple Alertmanager instances.

This chart deploys silencer as a `Deployment` with optional
`ServiceMonitor`, `VerticalPodAutoscaler`, `PodDisruptionBudget`, and
`NetworkPolicy` resources.

## Prerequisites

- Kubernetes >= 1.29
- A Slack app with Socket Mode enabled. See
  [`Silencer_manifest.json`](https://codeberg.org/vtmocanu/silencer/src/branch/main/Silencer_manifest.json)
  in the source repo.
- (optional) [Prometheus Operator](https://github.com/prometheus-operator/prometheus-operator)
  CRDs if you enable `serviceMonitor`.
- (optional) [VPA](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)
  CRDs if you enable `verticalPodAutoscaler`.
- (optional) [External Secrets Operator](https://external-secrets.io/) if
  you set `secrets.mode=externalSecret`.

## Secret modes

| Mode             | Who owns the Secret                  | Use when                                             |
|------------------|--------------------------------------|------------------------------------------------------|
| `existing`       | You (created out-of-band)            | Default. Pairs well with sealed-secrets / GitOps.    |
| `create`         | Chart (rendered from values)         | Quick demos. **Not recommended for production.**     |
| `externalSecret` | External Secrets Operator            | You want an `ExternalSecret` CR managed by the chart.|

The keys inside the Secret are configurable via `secrets.appTokenKey` and
`secrets.botTokenKey` (defaults: `SLACK_APP_TOKEN` / `SLACK_BOT_TOKEN`). The
same key names apply to all three modes.

## Probes

The container exposes two HTTP endpoints used by kubelet probes:

| Path       | What it returns                               | Used for     |
|------------|-----------------------------------------------|--------------|
| `/livez`   | always 200                                    | liveness     |
| `/healthz` | 503 once Slack socket-mode has been down past the in-app grace window | readiness    |

This split means a Slack outage pulls pods out of the Service (via readiness)
without restarting them (via liveness). Override either probe via the usual
`livenessProbe` / `readinessProbe` value blocks.

## NetworkPolicy + ServiceMonitor

When both `networkPolicy.enabled` and `serviceMonitor.enabled` are true, the
chart auto-injects an ingress rule allowing traffic from the namespace given
by `networkPolicy.scrapeNamespace` (default: `monitoring`). Set that value
to `""` to opt out and configure ingress manually.

## Replicas and Slack Socket Mode

Silencer connects to Slack via Socket Mode. Slack delivers each event to
exactly one connected client at a time, but silencer has no leader-election
or de-duplication layer. **Run a single replica** unless you have an
external coordination mechanism, multiple replicas can race to create
duplicate Alertmanager silences from a single thread reply. The chart
defaults to `replicaCount: 1` with a `Recreate` rollout strategy.

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| Vlad Mocanu |  | <https://github.com/vtmocanu> |

## Source Code

* <https://github.com/vtmocanu/silencer>

## Requirements

Kubernetes: `>=1.29.0-0`

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` | Pod affinity / anti-affinity. |
| extraEnv | list | `[]` | Extra environment variables passed to the container. Use this to override `LOG_LEVEL` or pass app-specific overrides. |
| extraEnvFrom | list | `[]` | Extra envFrom sources (configMapRef / secretRef). Useful when secrets are managed by an out-of-band controller. |
| extraVolumeMounts | list | `[]` | Extra volume mounts added to the container. |
| extraVolumes | list | `[]` | Extra volumes added to the pod. |
| fullnameOverride | string | `""` | Override the fully qualified release name. Defaults to "<release>-<chart>". |
| image.digest | string | `""` | Pin to an immutable digest (e.g. `sha256:abc…`). Wins over `tag` when set. |
| image.pullPolicy | string | `"IfNotPresent"` | Image pull policy. |
| image.repository | string | `"ghcr.io/vtmocanu/silencer"` | Container image repository. |
| image.tag | string | `""` | Image tag. Defaults to the chart's appVersion when empty. |
| imagePullSecrets | list | `[]` | imagePullSecrets to use for pulling the image. Names of existing Secrets. |
| livenessProbe.enabled | bool | `true` |  |
| livenessProbe.failureThreshold | int | `3` |  |
| livenessProbe.httpGet.path | string | `"/livez"` |  |
| livenessProbe.httpGet.port | string | `"http"` |  |
| livenessProbe.initialDelaySeconds | int | `30` |  |
| livenessProbe.periodSeconds | int | `30` |  |
| livenessProbe.timeoutSeconds | int | `3` |  |
| logLevel | string | `"info"` |  |
| nameOverride | string | `""` | Override the chart name used in templates. Defaults to the chart name. |
| networkPolicy.egress | list | `[]` | Egress rules. Empty = allow all egress (recommended starting point; tighten once you know your Alertmanager IP ranges). |
| networkPolicy.enabled | bool | `false` | Create a NetworkPolicy. |
| networkPolicy.ingress | object | `{"fromNamespaceSelectors":[],"fromPodSelectors":[]}` | Allow ingress to the metrics port from these selectors. |
| networkPolicy.scrapeNamespace | string | `"monitoring"` | Namespace label value (`kubernetes.io/metadata.name`) of the Prometheus instance scraping `/metrics`. Used to auto-allow scrape traffic when `serviceMonitor.enabled=true`. Set to "" to opt out and configure ingress manually below. |
| nodeSelector | object | `{}` | nodeSelector for pod scheduling. |
| podAnnotations | object | `{}` | Pod-level annotations. The chart automatically adds a checksum annotation that triggers a rollout when secret values change. |
| podDisruptionBudget.enabled | bool | `false` | Create a PDB. |
| podDisruptionBudget.maxUnavailable | string | `""` | maxUnavailable (mutually exclusive with minAvailable). |
| podDisruptionBudget.minAvailable | string | `""` | minAvailable (mutually exclusive with maxUnavailable). |
| podLabels | object | `{}` | Pod-level labels. |
| podSecurityContext | object | `{"runAsGroup":1000,"runAsNonRoot":true,"runAsUser":1000,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod-level securityContext. Defaults to non-root + restricted PSS. `fsGroup` is intentionally omitted: the container runs with a read-only root filesystem and mounts no PVCs, so there's nothing to chown. |
| priorityClassName | string | `""` | Priority class. Empty string falls through to the namespace default. |
| readinessProbe.enabled | bool | `true` |  |
| readinessProbe.failureThreshold | int | `3` |  |
| readinessProbe.httpGet.path | string | `"/healthz"` |  |
| readinessProbe.httpGet.port | string | `"http"` |  |
| readinessProbe.periodSeconds | int | `10` |  |
| readinessProbe.timeoutSeconds | int | `3` |  |
| replicaCount | int | `1` | Number of pod replicas. Silencer uses Slack Socket Mode, which delivers each event to exactly one connected client; running >1 replica risks duplicate Alertmanager silences when both pods react to the same thread message. Keep this at 1 unless you have a coordination layer. |
| resources | object | `{"limits":{"memory":"128Mi"},"requests":{"cpu":"10m","memory":"64Mi"}}` | Resource requests and limits. Memory limit is set conservatively for the Node.js runtime; tune via VPA if enabled. |
| secrets.appTokenKey | string | `"SLACK_APP_TOKEN"` | Key inside the Secret that holds the Slack app-level token. Used in all modes (the chart writes this key when it owns the Secret, and reads this key when referencing an existing one). |
| secrets.botTokenKey | string | `"SLACK_BOT_TOKEN"` | Key inside the Secret that holds the Slack bot OAuth token. Used in all modes. |
| secrets.create.annotations | object | `{}` | Extra annotations on the created Secret. |
| secrets.create.appToken | string | `""` | App-level token (xapp-…). Required when mode=create. |
| secrets.create.botToken | string | `""` | Bot OAuth token (xoxb-…). Required when mode=create. |
| secrets.existing.name | string | `"silencer"` | Name of the existing Secret. Required when mode=existing. |
| secrets.externalSecret.annotations | object | `{}` | Extra annotations on the created ExternalSecret. |
| secrets.externalSecret.appToken | object | `{"remoteRef":{"key":"","property":""}}` | Remote keys for each token. The `key` field follows your provider's conventions (e.g. Infisical: "/path/to/secret"; AWS: "/prod/silencer"). |
| secrets.externalSecret.botToken.remoteRef.key | string | `""` |  |
| secrets.externalSecret.botToken.remoteRef.property | string | `""` |  |
| secrets.externalSecret.refreshInterval | string | `"1h"` | Refresh interval for the ExternalSecret. |
| secrets.externalSecret.secretStoreRef | object | `{"kind":"ClusterSecretStore","name":""}` | Name of the ClusterSecretStore or SecretStore. |
| secrets.mode | string | `"existing"` | One of: existing, create, externalSecret. |
| securityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"privileged":false,"readOnlyRootFilesystem":true}` | Container-level securityContext. Defaults to a hardened profile that satisfies the Kubernetes "restricted" Pod Security Standard. |
| service.annotations | object | `{}` | Extra annotations on the Service. |
| service.port | int | `3000` | Service port (the cluster-internal port). |
| service.type | string | `"ClusterIP"` | Service type. ClusterIP is correct for the bot; it does not need to be reachable from outside the cluster. |
| serviceAccount.annotations | object | `{}` | Extra annotations on the ServiceAccount. |
| serviceAccount.automountServiceAccountToken | bool | `false` | Whether to mount the API token. Silencer doesn't talk to the K8s API, so disable by default. |
| serviceAccount.create | bool | `true` | Whether to create a ServiceAccount. |
| serviceAccount.name | string | `""` | Name of the ServiceAccount. Auto-generated if empty and create=true. |
| serviceMonitor.enabled | bool | `false` | Create a ServiceMonitor. Requires the Prometheus Operator CRD. |
| serviceMonitor.interval | string | `"30s"` | Scrape interval. |
| serviceMonitor.labels | object | `{}` | Extra labels on the ServiceMonitor (often used to match Prometheus `serviceMonitorSelector`). |
| serviceMonitor.metricRelabelings | list | `[]` | Relabelings applied after scraping. |
| serviceMonitor.path | string | `"/metrics"` | Metric path on the bot. |
| serviceMonitor.relabelings | list | `[]` | Relabelings applied before scraping. |
| serviceMonitor.scrapeTimeout | string | `"10s"` | Scrape timeout. |
| startupProbe.enabled | bool | `true` |  |
| startupProbe.failureThreshold | int | `12` |  |
| startupProbe.httpGet.path | string | `"/livez"` |  |
| startupProbe.httpGet.port | string | `"http"` |  |
| startupProbe.periodSeconds | int | `5` |  |
| terminationGracePeriodSeconds | int | `30` | Termination grace period. Keep low; the bot is stateless. |
| tests.enabled | bool | `true` | Enable rendering of the test pod. |
| tests.image.pullPolicy | string | `"IfNotPresent"` |  |
| tests.image.repository | string | `"docker.io/curlimages/curl"` |  |
| tests.image.tag | string | `"8.16.0"` |  |
| tolerations | list | `[]` | Pod tolerations. |
| topologySpreadConstraints | list | `[]` | Pod topology spread constraints. |
| updateStrategy | object | `{"type":"Recreate"}` | Deployment update strategy. `Recreate` avoids two pods holding Socket Mode connections during a rollout, which is the safest default for single-replica socket-mode bots. |
| verticalPodAutoscaler.enabled | bool | `false` | Create a VPA. |
| verticalPodAutoscaler.resourcePolicy | object | `{"containerPolicies":[{"containerName":"silencer","controlledResources":["memory"],"maxAllowed":{"memory":"256Mi"},"minAllowed":{"memory":"32Mi"}}]}` | Per-container resource policy. |
| verticalPodAutoscaler.updateMode | string | `"Auto"` | VPA update mode (Off, Initial, Recreate, Auto). |

## License

Apache License 2.0 — see [LICENSE](https://codeberg.org/vtmocanu/silencer/src/branch/main/LICENSE).
