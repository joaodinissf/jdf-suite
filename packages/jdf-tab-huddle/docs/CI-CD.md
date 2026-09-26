# CI/CD

Both workflows live at the monorepo root under `.github/workflows/` and run with `packages/jdf-tab-huddle` as their working directory.

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

It checks out two trees: the workflow's own commit, for the release tooling, and the tag, for everything that is released. Tags older than the workflow can therefore be backfilled too. It then:

1. Installs, lints and runs the unit tests on the tagged tree.
2. Fails unless the tag's version equals the version in both of the tag's `src/manifest.json` and `package.json`.
3. Zips the contents of the tag's `src/`, so `manifest.json` sits at the top of the zip, as the Chrome Web Store requires. The Affinity icon source is left out. `pnpm run package` builds the same zip locally.
4. Writes the notes with the tooling's `scripts/release-notes.sh`, run in the tagged tree: that version's README Version History entry, then the package's commits since the previous `jdf-tab-huddle-v*` tag.
5. Creates or updates the GitHub Release with the zip attached. The Release is marked "Latest" only when its tag is the highest huddle version, so a backfill never takes "Latest" from a newer release.

Publishing to the Chrome Web Store is not automated; it's deferred until v1.0.0 ([#7](https://github.com/joaodinissf/jdf-suite/issues/7)).

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
