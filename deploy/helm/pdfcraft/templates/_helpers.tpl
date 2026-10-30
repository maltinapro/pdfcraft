{{- define "pdfcraft.labels" -}}
app.kubernetes.io/name: pdfcraft
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
