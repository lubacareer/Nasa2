# Seccomp profile attribution

`seccomp-profile.json` is derived from the Moby Project's `profiles/seccomp/default.json` at tag `seccomp/v0.2.4`:

<https://github.com/moby/profiles/tree/seccomp/v0.2.4/seccomp>

The upstream profile is licensed under Apache License 2.0; its license text is included in [MOBY-APACHE-2.0-LICENSE.txt](./MOBY-APACHE-2.0-LICENSE.txt).

This copy removes the legacy `socketcall` syscall from the upstream allowlist. It adds narrowly scoped `clone` and `unshare` exceptions for Chromium's user, PID, and network namespace sandbox, while the upstream capability and flag restrictions remain in effect for other namespace operations.
