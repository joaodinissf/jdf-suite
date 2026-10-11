# jdf-skill-library

Fills a skill library that agents do not discover on their own, for use with
the [`skill-browser`](https://github.com/joaodinissf/jdf-skills/tree/main/skills/skill-browser)
skill.

Only `skill-browser` is linked into each agent's skills folder. The other
skills live in `library/` next to it, with every `SKILL.md` renamed
`SKILL.dormant.md`, so no client loads them at any search depth. Agents see
them only when you ask the browser for them.

```
<root>/                 default ~/Dropbox/skills/skill-browser
  SKILL.md, README.md   skill-browser itself
  manifest.txt          where each skill comes from
  library/<skill>/      SKILL.dormant.md + the skill's other files
```

## Usage

```sh
jdf-skill-library sync   [root]   # fill root/ and library/ from manifest.txt
jdf-skill-library status [root]   # list library skills; warn about live SKILL.md files
```

`manifest.txt`, one source per line (`#` starts a comment):

```
browser github:joaodinissf/jdf-skills
github:joaodinissf/jdf-skills handover silly-sweep recursive-planner
~/Git/my-skills@main some-local-skill
```

A source is `github:owner/repo[@ref]` (fetched into a cache; the ref may be
a branch, tag or commit id, default branch if none) or a local git repository
path `[@ref]` (default `HEAD`). Only committed content is exported, with
`git archive`. A skill name must be a plain folder name (letters, digits,
`.`, `_`, `-`; not starting with `.` or `-`); `sync` checks every name before
it changes anything.

`sync` replaces each listed skill's folder. It never deletes a library skill
the manifest no longer lists; it reports it instead.

## Tests

```sh
zsh packages/jdf-skill-library/tests/test.zsh
```

A local bare repo stands in for GitHub (`JDF_SKILL_LIBRARY_GITHUB` overrides
`https://github.com`).

## Install the browser

Link the root into each agent's skills folder, once per machine:

```sh
ln -s ~/Dropbox/skills/skill-browser ~/.claude/skills/skill-browser
ln -s ~/Dropbox/skills/skill-browser ~/.codex/skills/skill-browser
```
