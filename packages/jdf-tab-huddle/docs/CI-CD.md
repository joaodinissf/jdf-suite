# CI/CD

Both workflows live at the monorepo root under `.github/workflows/` and run with `packages/jdf-tab-huddle` as their working directory.

Every action is pinned to a commit SHA, with its version in a trailing comment (`uses: actions/checkout@<sha> # v6.1.0`). Dependabot (`.github/dependabot.yml`) opens a weekly PR when an action has a new release. pnpm is pinned to one exact version in each workflow's `pnpm/action-setup` `version:`; change them together.

## CI: `jdf-tab-huddle-ci.yml`

Runs on every pull request to `main` and every push to `main` that touches `packages/jdf-tab-huddle/**` or the workflow itself.

| Job | What it runs |
|---|---|
| Lint + unit tests + manifest validate | `pnpm run lint`, `pnpm test` (Vitest), `pnpm run validate` |
| E2E (Playwright, headless extension) | `pnpm run test:e2e` in headless Chromium; the test results are uploaded as an artifact on failure |

## Release: `jdf-tab-huddle-release.yml`

Runs when a `jdf-tab-huddle-v*` tag is pushed, or by hand (`workflow_dispatch`) with an existing tag, to backfill a Release:

```bash
gh workflow run jdf-tab-huddle-release.yml -f tag=jdf-tab-huddle-v0.4.1
```

Add `-f dry_run=true` to build and test without publishing anything.

It runs as two jobs, so the token that can write releases never meets the dev dependencies:

- **Test and package** has a read-only token and keeps no credentials in git config. It checks out two trees: the workflow's own commit, for the release tooling, and the tag, for everything that is released. Tags older than the workflow can therefore be backfilled too. It does steps 1–4 below and uploads the zip and the notes as an artifact.
- **Publish GitHub Release** holds the write token. It checks out nothing and installs nothing: it downloads that artifact and does step 5. A dry run skips it.

The steps:

1. Installs, lints and runs the unit tests on the tagged tree.
2. Fails unless the tag's version equals the version in both of the tag's `src/manifest.json` and `package.json`.
3. Zips the contents of the tag's `src/`, so `manifest.json` sits at the top of the zip, as the Chrome Web Store requires. The Affinity icon source is left out. `pnpm run package` builds the same zip locally.
4. Writes the notes with the tooling's `scripts/release-notes.sh`, run in the tagged tree: that version's README Version History entry, then the package's commits since the previous `jdf-tab-huddle-v*` tag.
5. Creates or updates the GitHub Release with the zip attached. The Release is marked "Latest" only when its tag is the highest huddle version. After a backfill, the workflow sets "Latest" back on the highest version's Release, because GitHub can move "Latest" to a newly created Release even when it is asked not to.

Publishing to the Chrome Web Store is not automated ([#7](https://github.com/joaodinissf/jdf-suite/issues/7)). From v1.0.0 the release zip is uploaded by hand; [`store/README.md`](../store/README.md) has the listing, the Privacy tab's answers and the steps in the dashboard.

## Cutting a release

1. On a branch, bump `version` in `src/manifest.json` and `package.json`, and add a `- **vX.Y.Z**: …` entry at the top of the README's Version History.
2. Open a PR, and merge it (rebase-merge) once CI is green.
3. Tag the release commit and push the tag:

   ```bash
   git tag -a jdf-tab-huddle-vX.Y.Z -m "jdf-tab-huddle vX.Y.Z" <commit>
   git push origin jdf-tab-huddle-vX.Y.Z
   ```

4. Check the Release that the workflow created.

To preview the notes or the package locally:

```bash
bash scripts/release-notes.sh jdf-tab-huddle-vX.Y.Z
pnpm run package && unzip -l jdf-tab-huddle-X.Y.Z.zip
```

## Running E2E locally

Branded Google Chrome ignores `--load-extension`, so the suite runs on Playwright's bundled Chromium. To use a different Chromium or a Chrome for Testing build, point `PW_EXECUTABLE` at it. Set `HEADED=1` to watch a run.
