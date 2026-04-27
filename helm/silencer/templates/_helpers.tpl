{{/*
Application name used for in-cluster resources, labels, and selectors.
We hardcode `silencer` (rather than using `.Chart.Name`) because the chart
artifact is published as `silencer-chart` to avoid Docker Hub repo collisions
with the container image — but the running app's identity is `silencer`.
The Chart.Name still surfaces in the `helm.sh/chart` label below.
*/}}
{{- define "silencer.name" -}}
{{- default "silencer" .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If the release name contains the app name, it's used
as a full name.
*/}}
{{- define "silencer.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := include "silencer.name" . }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "silencer.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels — applied to top-level resource metadata.
Includes chart version, which intentionally does NOT appear on the pod template
(otherwise every chart-only version bump would force a pod rollout).
*/}}
{{- define "silencer.labels" -}}
helm.sh/chart: {{ include "silencer.chart" . }}
{{ include "silencer.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: monitoring
{{- end }}

{{/*
Pod-template labels — selectorLabels (stable across releases) plus the app
version label (rolls when the upstream image moves, which is what we want).
Crucially this excludes `helm.sh/chart`, so chart-only version bumps do not
trigger pod rollouts.
*/}}
{{- define "silencer.podLabels" -}}
{{ include "silencer.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: monitoring
{{- end }}

{{/*
Selector labels — must be stable across releases (cannot include version).
*/}}
{{- define "silencer.selectorLabels" -}}
app.kubernetes.io/name: {{ include "silencer.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name to use.
*/}}
{{- define "silencer.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "silencer.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Container image reference. Honors digest > tag > appVersion.
*/}}
{{- define "silencer.image" -}}
{{- $repo := .Values.image.repository -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" $repo .Values.image.digest -}}
{{- else -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end }}

{{/*
Name of the Secret holding Slack tokens (whatever the source mode).
*/}}
{{- define "silencer.secretName" -}}
{{- if eq .Values.secrets.mode "existing" -}}
{{- required "secrets.existing.name is required when secrets.mode=existing" .Values.secrets.existing.name -}}
{{- else -}}
{{- include "silencer.fullname" . -}}
{{- end -}}
{{- end }}

{{/*
Key in the Secret holding the Slack app-level token. Same value across all
secret modes — the chart writes this key when it owns the Secret, and reads
this key when referencing an existing Secret.
*/}}
{{- define "silencer.appTokenKey" -}}
{{- default "SLACK_APP_TOKEN" .Values.secrets.appTokenKey -}}
{{- end }}

{{/*
Key in the Secret holding the Slack bot token.
*/}}
{{- define "silencer.botTokenKey" -}}
{{- default "SLACK_BOT_TOKEN" .Values.secrets.botTokenKey -}}
{{- end }}
