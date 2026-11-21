{{- define "pdfcraft.labels" -}}
app.kubernetes.io/name: pdfcraft
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Prefix of all resource names. Defaults to the release name (so existing installs keep their
names); `fullnameOverride` lets a parent chart that includes this chart as a dependency avoid
name clashes with its own resources.
*/}}
{{- define "pdfcraft.fullname" -}}
{{- .Values.fullnameOverride | default .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- end }}
