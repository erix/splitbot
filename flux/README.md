# FluxCD Resources For Splitbot

This directory contains Flux resources that let Flux watch this repository
reconcile `k8s/overlays/local`, and auto-update image tags.

## Apply

```bash
kubectl apply -k flux/
```

## Required Git Auth Secret

`ImageUpdateAutomation` pushes commits to `main`, so Flux needs repo write credentials.

Create a local file from `git-auth-secret.example.yaml`:

```bash
cp flux/git-auth-secret.example.yaml flux/git-auth-secret.yaml
```

Set a GitHub token with repo write access, then apply:

```bash
kubectl apply -f flux/git-auth-secret.yaml
```

Patch `flux/splitbot-gitrepository.yaml` to include:

```yaml
spec:
  secretRef:
    name: splitbot-flux-git-auth
```

Then apply:

```bash
kubectl apply -k flux/
```

The real `flux/git-auth-secret.yaml` file is gitignored.

## Files

- `splitbot-gitrepository.yaml`: Flux source (`https://github.com/erix/splitbot`)
- `splitbot-kustomization.yaml`: Flux kustomization (`./k8s/overlays/local`)
- `splitbot-imagerepository.yaml`: scans `ghcr.io/erix/splitbot`
- `splitbot-imagepolicy.yaml`: selects newest sortable `main-<run>-sha-<sha>` tag
- `splitbot-imageupdateautomation.yaml`: commits updated tag setters to `main`

If your repo URL or branch differs, update `splitbot-gitrepository.yaml`.
