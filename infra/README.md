# Felony Bench hosting (AWS CDK)

One EC2 instance runs the production stack, [`compose.prod.yml`](../compose.prod.yml) (Caddy, API + SPA, Postgres, the scheduled refresh and nightly `pg_dump` backups). AWS services used: EC2 (instance, EBS, Elastic IP, security group, a one-subnet VPC with no NAT), IAM, Route 53 (one A record), SSM (shell, deploys, refresh keys) and DLM (daily EBS snapshots).

```
Route 53 A ──▶ Elastic IP ──▶ t4g.small, Amazon Linux 2023 arm64
                              /opt/felony/src   git checkout at the deployed commit, runs compose.prod.yml
                              /data             separate 20 GB gp3 volume, retained, 7 daily snapshots
                                ├─ docker/      Docker data root: pgdata, Caddy certs, images
                                ├─ backups/     nightly pg_dump (symlinked as ./backups)
                                └─ felony/.env  generated secrets (symlinked as ./.env)
```

- **No SSH.** The security group allows 80/443 only. Get a shell with `aws ssm start-session --target <InstanceId>` (needs the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)).
- **The instance is disposable.** Everything stateful is on the data volume, which survives instance replacement and `cdk destroy`.
- **Deploys** run [`deploy/deploy.sh`](../deploy/deploy.sh): check out the commit, set `IMAGE_TAG=sha-<commit>`, copy SSM parameters into `.env`, `pull` and `up -d --wait`.

## First deploy

1. Merge to `main` so CI pushes `ghcr.io/sbayer55/felony-bench` and `…-refresh`. Then on GitHub, **Packages → each package → Package settings → Change visibility → Public** (the host pulls anonymously).
2. Have a Route 53 hosted zone for the domain. Note its ID.
3. Deploy (needs AWS credentials for the target account/region):

   ```bash
   cd infra
   pnpm install
   pnpm cdk bootstrap        # once per account/region
   pnpm cdk deploy \
     -c domainName=felonybench.example.com \
     -c hostedZoneId=Z0123456789ABCDEFGHIJ \
     -c hostedZoneName=example.com \
     -c acmeEmail=you@example.com
   ```

   Add `-c createOidcProvider=false` if the account already has GitHub's OIDC provider (`token.actions.githubusercontent.com`). The first synth writes the AMI and AZ lookups to `cdk.context.json`; commit it so later deploys don't replace the instance when a new AMI ships.

4. First boot takes a few minutes (packages, data volume, image pull, migrate and seed). Follow it with `sudo tail -f /var/log/felony-bootstrap.log` in a session.
5. In the GitHub repo, **Settings → Secrets and variables → Actions → Variables**: set `AWS_DEPLOY_ROLE_ARN` (stack output `DeployRoleArn`) and `AWS_REGION`. From then on every push to `main` builds images and deploys that commit. Leave the `DATABASE_URL` secret unset; the refresh runs on the host.
6. Add refresh provider settings as SSM parameters, then redeploy (`deploy.sh latest`, or push to `main`) to copy them into `.env`:

   ```bash
   aws ssm put-parameter --type SecureString --name /felony-bench/env/ANTHROPIC_API_KEY --value 'sk-ant-…'
   ```

   Every parameter under `/felony-bench/env/` becomes a `.env` line named after its last path segment, so any variable from the README's provider table works (`OLLAMA_MODEL`, `BRAVE_API_KEY`, `REFRESH_SCHEDULE`, …).

## Day to day

In a session on the host, `sudo -i; cd /opt/felony/src`, then use the commands in the README's Deploy section with `docker compose -f compose.prod.yml` (`just` isn't installed). For example:

| | |
|---|---|
| Admin token for `/admin` | `grep ADMIN_TOKEN .env` |
| Status, logs | `docker compose -f compose.prod.yml ps`, `… logs -f api refresh` |
| Deploy by hand | `deploy/deploy.sh latest` (or a commit SHA on `main` that CI has built) |
| Refresh now | `docker compose -f compose.prod.yml exec refresh tsx scripts/refresh-incidents.ts --dry-run` |

## Restore

- **From a nightly dump**: the README's Restore command, with a file from `backups/`.
- **From an EBS snapshot**: create a volume from the DLM snapshot in the same AZ, stop the instance, detach the current data volume, attach the restored one as `/dev/sdf`, and start the instance. `/etc/fstab` mounts by filesystem UUID, which a snapshot keeps. To have CloudFormation track the restored volume, import it in place of `DataVolume`.

## Cost (us-east-1, on-demand)

t4g.small ~$12/mo, 36 GB gp3 ~$3/mo, public IPv4 ~$3.60/mo, snapshots (incremental) and the Route 53 zone ~$0.50 each.
