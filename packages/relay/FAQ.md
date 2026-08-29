# Running Podbay Relay on a headless host

The relay can run on any NAS, Raspberry Pi, or other always-on machine that
supports Node. This guide covers the common headless setup issues: finding
`npx`, starting the relay at boot, and opening the dashboard remotely.

## `npx: command not found`, even though I just installed Node

Some NAS packages install `node` and `npm` without putting `npx` on your `PATH`.
Synology's DSM Node.js package is one example. Check the directory containing
`node`:

```bash
NODE_BIN="$(dirname "$(which node)")"
ls "$NODE_BIN" | grep npx
```

If `npx` appears, add that directory to `PATH` in `~/.bashrc`, `~/.profile`, or
the equivalent file for your shell.

If it is genuinely absent, search for another copy:

```bash
find / -iname npx 2>/dev/null
```

If you find another copy, add its directory to `PATH`. You can also install it
separately with `npm install -g npx`.

Boot schedulers and one-command SSH sessions often use a shorter `PATH` than a
normal login shell. If `npx` works after you log in but fails in a script, set
`PATH` explicitly at the top of that script.

## How do I make the relay survive a reboot?

The relay itself does not need root. Use whichever startup mechanism your host
provides:

- **Synology DSM**: Go to Control Panel → Task Scheduler → Create →
  Triggered Task → User-defined script, then choose **Boot-up**. Run:

  ```bash
  export PATH=/path/to/node/bin:$PATH   # wherever npx actually lives, see above
  npx @podbay/relay@latest start --gateway <url> --accept
  ```

- **A systemd host**: If you have root, create a service that runs the same
  command at boot.
- **A host with a user crontab**: Run `crontab -e` and add the same command as
  an `@reboot` entry. Not every NAS includes a user crontab.

The scheduler only needs to run the command once. `start` moves the relay into
the background and exits.

## Do I need to pass `--code` again every time it starts?

No. `--code` is only used for the first pairing. The relay saves a reconnect
token locally, so later `start` commands reconnect automatically:

```bash
npx @podbay/relay@latest start --gateway <url> --accept
```

Do not save the original pairing code in your boot script; it expires and is
not needed after pairing. To pair again, run
`npx @podbay/relay@latest reset`. This also clears the relay's other saved data.

## How do I open the dashboard remotely?

The dashboard listens only on `127.0.0.1`, so it is not exposed to your network.
Create an SSH tunnel from your computer:

```bash
ssh -L 7373:127.0.0.1:7373 user@your-nas
```

Keep the tunnel open, run `npx @podbay/relay@latest status` on the relay host,
and open the printed `http://127.0.0.1:7373/...` URL on your computer.

If the tunnel immediately resets, check whether the SSH server disables
forwarding. Synology commonly sets `AllowTcpForwarding no`. Enabling it affects
every authorized SSH user, not only Podbay, and requires administrator access:

```bash
sudo sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /etc/ssh/sshd_config
sudo systemctl restart sshd   # or: synosystemctl restart sshd, on some DSM versions
```
