# Cursor Agent Checklist

Before making changes for any prompt:

- Work directly on `main`; do not create feature branches.
- Check `git status` and the current branch before editing.
- Pull the latest `main` before starting work when safe to do so.
- Keep changes focused on the user request.
- Commit completed changes with a clear message.
- Push with `git push -u origin main` so GitHub Pages deploys from `main`.
- After pushing, verify the `Deploy to GitHub Pages` workflow completes successfully.
- If the app UI changes, run `npm run build` before pushing.
