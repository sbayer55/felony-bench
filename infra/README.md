# Felony Bench hosting (AWS CDK)

One EC2 instance runs every container. AWS services used: EC2 (instance, EBS, Elastic IP, security group, a one-subnet VPC with no NAT), IAM, Route 53 (one A record), SSM (shell, deploys, API keys) and DLM (daily EBS snapshots).

```
Route 53 A ──▶ Elastic IP ──▶ t4g.small, Amazon Linux 2023 arm64
                              ├─ caddy     :80/:443, Let's Encrypt ──▶ api:8787
                              ├─ api       ghcr.io/<repo>:<sha>  (API + SPA)
                              ├─ db        postgres:17 ──▶ /data/pgdata
                              └─ refresh   ghcr.io/<repo>-refresh, systemd timer 06:17 UTC
                              /data = separate 20 GB gp3 volume, retained, 7 daily snapshots
```

- **No SSH.** Security group allows 80/443 only; get a shell with `aws ssm start-session --target <InstanceId>` (needs the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)).
- **The instance is disposable.** Postgres data, Caddy certificates and the generated secrets (`/data/felony/.env`) live on the data volume, which survives instance replacement and `cdk destroy`.
- **Host files** (`deploy/`: compose file, Caddyfile, deploy and refresh scripts, systemd units) are a git checkout at `/opt/felony/src`, moved to the deployed commit on every deploy.

## First deploy

1. Merge to `main` so CI pushes `ghcr.io/<owner>/felony-bench` and `…-refresh`. Then on GitHub, **Packages → each package → Package settings → Change visibility → Public** (the host pulls anonymously).
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

4. First boot takes a few minutes (packages, data volume, image pull, seed). Follow it with `sudo tail -f /var/log/felony-bootstrap.log` in a session.
5. In the GitHub repo, **Settings → Secrets and variables → Actions → Variables**: set `AWS_DEPLOY_ROLE_ARN` (stack output `DeployRoleArn`) and `AWS_REGION`. From then on every push to `main` builds images and runs `deploy/deploy.sh <sha>` on the host.
6. Add the refresh key (the daily job skips itself until a parameter exists):

   ```bash
   aws ssm put-parameter --type SecureString --name /felony-bench/env/ANTHROPIC_API_KEY --value 'sk-ant-…'
   ```

   Every parameter under `/felony-bench/env/` is passed to the refresh container as an env var named after its last path segment.

## Day to day

In a session on the host (`sudo -i` first):

| | |
|---|---|
| Admin token for `/admin` | `grep ADMIN_TOKEN /data/felony/.env` |
| Containers | `/opt/felony/src/deploy/dc ps`, `… logs -f api` |
| Deploy by hand | `/opt/felony/src/deploy/deploy.sh latest` (or a commit SHA that has images) |
| Refresh now / preview | `systemctl start felony-refresh` / `/opt/felony/src/deploy/refresh.sh --dry-run` |
| Refresh logs, next run | `journalctl -u felony-refresh`, `systemctl list-timers felony-refresh` |
| psql | `/opt/felony/src/deploy/dc exec db psql -U felony` |

## Restore from a snapshot

Create a volume from a DLM snapshot in the same AZ, stop the instance, detach the current data volume, attach the restored one as `/dev/sdf`, and start the instance. `/etc/fstab` mounts by filesystem UUID, which a snapshot keeps. If you want CloudFormation to track the restored volume, import it in place of `DataVolume` instead.

## Cost (us-east-1, on-demand)

t4g.small ~$12/mo, 36 GB gp3 ~$3/mo, public IPv4 ~$3.60/mo, snapshots (incremental) and Route 53 zone ~$0.50 each.
