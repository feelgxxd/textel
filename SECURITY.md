# Security

## Supported versions

The latest release gets fixes. Before 1.0, only the newest 0.x does.

## Reporting a problem

Please do not open a public issue. Report it privately on GitHub instead:
**[Report a vulnerability](https://github.com/feelgxxd/textel/security/advisories/new)** (the
repository's Security tab, then "Report a vulnerability"). Only the maintainer sees it.

Say what is affected (the CLI, the library, `<textel-player>` or `<textel-viewer>`), how to reproduce
it, and, if you can, a file that shows it. You will get an answer within a week, and credit in the
release notes when it is fixed, unless you would rather not.

## What counts

textel reads model files and frames files that may come from anyone, so the most likely problems are
a file that makes it hang, use far too much memory, or crash in a way that takes the page or the
terminal down with it, and anything that lets a file run code or reach the network. The CLI writes
only the files you name; anything else it writes is a bug worth reporting too.
