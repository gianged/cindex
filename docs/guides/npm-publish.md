# NPM Publishing Guide

Publishing is fully automated via Release Please + GitHub Actions.

## One-Time Setup

### 1. Generate npm Token

Go to [npmjs.com/settings/tokens](https://www.npmjs.com/settings/~/tokens):
1. Click **"Generate New Token"** > **"Granular Access Token"**
2. Token name: `cindex-github-actions`
3. Expiration: No expiration (or your preference)
4. Packages: **Read and write**
5. Click **"Generate Token"** and copy it

### 2. Add Token to GitHub

Go to your repository on GitHub:
1. **Settings** > **Secrets and variables** > **Actions**
2. Click **"New repository secret"**
3. Name: `NPM_TOKEN`
4. Value: Paste the token from step 1
5. Click **"Add secret"**

## How It Works

```
Push commits → Release Please creates PR → Merge PR → npm publish
```

1. **Push commits** with conventional format to `main`
2. **Release Please** auto-creates a Release PR (updates `package.json` + CHANGELOG)
3. **Merge the PR** when ready to release
4. **GitHub Actions** auto-publishes to npm

## Commit Message Format

Version bumps are determined by commit prefixes:

| Prefix | Version Bump | Example |
|--------|--------------|---------|
| `fix:` | Patch (1.0.0 → 1.0.1) | `fix: resolve search timeout` |
| `feat:` | Minor (1.0.0 → 1.1.0) | `feat: add new MCP tool` |
| `feat!:` | Major (1.0.0 → 2.0.0) | `feat!: redesign API` |
| `docs:` | No bump | `docs: update README` |
| `chore:` | No bump | `chore: update dependencies` |

### Examples

```bash
git commit -m "fix: resolve embedding timeout issue"
git commit -m "feat: add search_documentation tool"
git commit -m "feat!: change index_repository parameters"
git commit -m "docs: update installation guide"
```

## Publishing Flow

### 1. Make Changes with Conventional Commits

```bash
git add .
git commit -m "feat: add new feature"
git push origin main
```

### 2. Review Release PR (GitHub GUI)

After pushing, Release Please creates a PR titled "chore(main): release X.X.X":
1. Go to **Pull Requests** tab
2. Review the auto-generated CHANGELOG and version bump
3. **Merge** when ready to release

### 3. Automatic Publishing

Merging triggers:
- GitHub Release creation
- npm publish via GitHub Actions

Check progress in **Actions** tab.

## Manual Publishing (Emergency Only)

```bash
npm login
npm run build
npm publish --access public
```

## Prerelease Versions

```bash
npm version prerelease --preid=beta
npm publish --access public --tag beta
```
