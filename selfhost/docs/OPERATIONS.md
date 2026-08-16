# Operating Podbay Self-Hosted

Run these commands from the directory containing `compose.yaml`, normally `./podbay`.

## Check status and logs

```sh
docker compose ps
docker compose logs -f web serve proxy
```

For a pod that remains in **Creating**, check the provisioning service first:

```sh
docker compose logs -f serve
docker images | grep pod-base
```

The initial pod image is several gigabytes, so a slow or interrupted pull can look like a stalled
pod.

## Start and stop

```sh
docker compose up -d
docker compose stop
```

Stopping the Compose services stops the dashboard and control plane. Existing pod containers are
separate sibling containers and may continue running. Suspend or delete pods from the dashboard
before stopping Podbay if you do not want them to keep using resources.

## Update Podbay

```sh
docker compose pull
docker compose up -d
```

This updates the dashboard, control plane, gateway, and cached image for newly created pods.
Existing pod containers keep the image they were created with; automatic local pod upgrades are
not available in the alpha.

For more predictable updates, set `PODBAY_APP_IMAGE` and `PODBAY_POD_IMAGE` to tested image digests
in `.env` before running `docker compose up -d`.

## Back up important data

Podbay stores three different kinds of data:

1. Dashboard and pod records in the `podbay_pgdata` Docker volume.
2. The secret-vault and owner-session keys in the `podbay_appdata` Docker volume.
3. Project files inside each pod container.

Back up the database:

```sh
docker compose exec -T db pg_dump -U postgres podbay > podbay-db.sql
```

Back up the vault data:

```sh
docker run --rm \
  -v podbay_appdata:/data:ro \
  -v "$PWD":/backup \
  alpine tar -czf /backup/podbay-appdata.tgz -C /data .
```

Keep the database dump and app-data backup together. Encrypted secrets cannot be recovered without
the vault key, and existing owner sessions depend on the session-signing key.

Pod workspaces are not included in those backups. Commit project work to a Git repository or
export it before deleting a pod.

## Remove Podbay

First delete or export every pod you care about from the dashboard. Then stop and remove the
Compose services while retaining their data:

```sh
docker compose down
```

To permanently remove the database and secret-vault volumes as well:

> [!CAUTION]
> The next command permanently deletes Podbay's database, owner login, and stored keys. It cannot
> be undone from Podbay unless you have a backup.

```sh
docker compose down -v
```

## Common problems

### Port 8080 is already in use

Choose another port and restart:

```sh
PODBAY_PORT=8090 docker compose up -d
```

### A pod stays in Creating

Run `docker compose logs serve`. On a first launch, wait for the `pod-base` image pull to finish.
Also check disk space with `docker system df`.

### The terminal does not connect

Run `docker compose logs proxy serve`. Confirm the browser is using the same hostname and scheme as
the dashboard, and that a reverse proxy is allowing WebSocket upgrades for `/pods/*`.

### An app preview does not open

Confirm the app inside the pod is listening on `0.0.0.0:3000`, not only `127.0.0.1`. Check the host
firewall if Podbay runs on another machine. In this alpha, preview links from a remote installation
use `127.0.0.1` and therefore do not open on a different device; see [Deployment](DEPLOYMENT.md).

### Postgres reports too many clients

Collect `docker compose logs web db`, restart the affected services, and report the logs in a
[GitHub issue](https://github.com/podbay-cloud/install/issues). This should not recur on current
images.

### No space left on device

Check `docker system df` before removing anything. Podbay images use several gigabytes and project
containers add more. Do not prune volumes unless you have identified them and backed up their data.
