## ADDED Requirements

### Requirement: Self-host is reachable from a remote browser via a deployment mode

The self-host edition SHALL support being reached from a browser on a DIFFERENT machine than the
Docker host, selected by a deployment mode recorded at install time. It SHALL support three modes:
`local` (bind `localhost:8080`, no TLS — private/dev use), `ip` (a public host with no domain), and
`domain` (the owner's own domain). The dashboard URL and every pod preview URL SHALL be derived from
the active mode, and the control plane SHALL surface those real URLs rather than the Docker host's
loopback.

#### Scenario: Local mode is unchanged

- **WHEN** the owner installs in `local` mode (or on a host with no public IP)
- **THEN** the dashboard SHALL be served at `http://localhost:8080` and pod previews SHALL use the
  host loopback, exactly as before — no TLS, no external DNS

#### Scenario: A public host with no domain still gets working, secure previews

- **WHEN** the owner installs on a public host without providing a domain (the `ip` default)
- **THEN** the dashboard and each pod preview SHALL be reachable at an HTTPS subdomain derived from
  the host's public IP via a magic-DNS service (`<pod>.<ip>.sslip.io`), with certificates obtained
  automatically — the owner SHALL NOT be required to own or configure a domain, and SHALL be offered
  a raw `http://<public-ip>:<port>` fallback as an explicit opt-out

#### Scenario: An owner-supplied domain gives clean per-pod subdomains

- **WHEN** the owner installs in `domain` mode with their domain
- **THEN** the dashboard SHALL be served on their chosen host and each pod preview at a per-pod
  subdomain under that domain (`<pod>.pods.<domain>`), and the install SHALL print the exact DNS
  records the owner must create

#### Scenario: A host that already uses 80/443 coexists instead of failing

- **WHEN** the owner installs on a public host where an existing reverse proxy already holds 80/443
- **THEN** the installer SHALL NOT fail or seize those ports; it SHALL keep podbay on its own local
  port, render podbay's routing there without TLS, and emit a snippet the owner adds to their front
  proxy to terminate TLS and forward the dashboard + preview hostnames to podbay — so previews still
  work through the existing proxy (verified live in both this behind-proxy mode and the podbay-owns-
  80/443 mode)

### Requirement: Pod previews route through the single front door, not per-pod host ports

In the public deployment modes (`ip`, `domain`), pod HTTP previews SHALL be served THROUGH the
existing reverse proxy — routed by the pod's preview hostname to the pod container's dev-server port
over the shared pod network — rather than by publishing a distinct host port per pod. The
`publishedAddress()` the control plane returns SHALL be the front-door preview URL for that mode.

#### Scenario: One open port pair serves every pod

- **WHEN** any number of pods are running in a public mode
- **THEN** all their previews SHALL be reachable through the single 80/443 front door (proxied to
  each `podbay-<id>` dev-server port), with NO per-pod host port to publish or per-pod firewall rule
  to open

#### Scenario: The preview URL is the public URL, never the host loopback

- **WHEN** the dashboard shows a pod's preview link in a public mode
- **THEN** it SHALL be the pod's public HTTPS URL for that mode, never `127.0.0.1:<port>` or the
  Docker host's loopback

### Requirement: Automatic HTTPS in public modes, gated to valid hostnames

In the `ip` and `domain` modes the proxy SHALL obtain and serve TLS certificates automatically for
the dashboard and pod preview hostnames. Because certificate issuance is triggered by inbound
hostnames, the proxy SHALL consult an authorization check so that certificates are issued ONLY for
the dashboard host and hostnames that map to a real, current pod — an unknown hostname SHALL NOT
cause a certificate to be requested.

#### Scenario: A live pod's preview host gets a certificate; a bogus one does not

- **WHEN** a request arrives for `<pod>.<base>` where `<pod>` is a running pod
- **THEN** the proxy SHALL obtain a certificate and serve the preview; **AND WHEN** a request arrives
  for a hostname that maps to no current pod, the proxy SHALL refuse to request a certificate for it

### Requirement: Install detects the environment and reports reachability honestly

The installer SHALL detect the host's public IP (via cloud metadata or a sanctioned outbound fetch,
not merely `hostname -I`), select and confirm the deployment mode, write the proxy hostnames and
mode configuration, and offer to open the host OS firewall (detecting ufw/iptables/firewalld) for the
ports the chosen mode needs. It SHALL then verify what it can and **report honestly**: it SHALL NOT
claim a URL is "verified reachable" when it cannot prove external reachability, and SHALL explicitly
state that a cloud provider's security group is outside the host and may still block access, with the
exact ports to open. It SHALL finish by printing the real working URL(s) and any required DNS records.

#### Scenario: OS firewall is opened and the honest caveat is shown

- **WHEN** the installer runs in a public mode and detects an active OS firewall
- **THEN** it SHALL offer to open the required ports there, and regardless of that outcome SHALL tell
  the owner that a cloud security group (invisible from inside the host) may still need those ports
  opened — never presenting a bare "verified ✅" it cannot substantiate

#### Scenario: The owner is given a URL that reflects the real mode

- **WHEN** installation completes
- **THEN** the final output SHALL print the dashboard URL for the active mode (e.g. the sslip.io or
  domain URL in public modes, `localhost:8080` in local mode) rather than only a private
  `hostname -I` address
