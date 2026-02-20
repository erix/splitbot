# Splitbot Kubernetes Manifests

## Layout

- `base/`: core resources (namespace, PVC, deployment)
- `overlays/local/`: local overlay for direct `kubectl` or Flux path

## Quick Start

Create namespace + secret:

```bash
kubectl apply -f k8s/base/namespace.yaml
kubectl -n splitbot create secret generic splitbot-secret \
  --from-literal=TELEGRAM_BOT_TOKEN='your_token_here'
```

Apply app:

```bash
kubectl apply -k k8s/overlays/local
```

## Backups

Backups are written to `/data/backups` in the Pod.
Periodic backup loop is controlled by deployment env vars:

- `BACKUP_INTERVAL_SECONDS` (`300` by default in manifest)
- `BACKUP_RUN_ON_START` (`1` by default)
- `BACKUP_KEEP` (`288` by default)
