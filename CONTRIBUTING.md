# Contributing to RunCheck

Thanks for wanting to contribute! RunCheck is a small, focused tool and we want to keep it that way. Please read this guide before opening a PR.

---

## Ground rules

- **Keep `diff.ts` pure.** The `diffRequirementsVsEnvironment` function must stay I/O-free. All file reads go in `requirements.ts`, all machine probes go in `environment.ts`, all network/git ops go in `remote/git.ts`. This keeps the core logic fast and fully unit-testable.
- **Every new check needs unit tests.** If the CI is red your PR won't be merged.
- **TypeScript strict mode.** No `any`, no `@ts-ignore` without an explanatory comment.
- **One PR, one concern.** Small focused PRs get merged faster than large ones.

---

## Getting started

```bash
# Fork, then clone your fork
git clone https://github.com/<your-username>/RunCheck.git
cd RunCheck

# Install dependencies
pnpm install

# Verify everything passes before you change anything
pnpm test
```

---

## Adding a new check

Follow these steps in order:

1. **Add the category** to the `Category` union in `src/types.ts`.
2. **Extend `ProjectRequirements`** (in `types.ts`) if the check needs new data from the project config, and parse it in `src/scanners/requirements.ts`.
3. **Extend `LocalEnvironment`** (in `types.ts`) if the check needs to probe the local machine, and add the probe in `src/scanners/environment.ts`.
4. **Write a pure `check<Name>()` function** in `src/scanners/diff.ts` — it receives `reqs` and `env`, returns `Finding[]`, contains zero I/O.
5. **Call it** from `diffRequirementsVsEnvironment()` and give it a priority number. See the priority table in `diff.ts` for guidance.
6. **Add unit tests** in `test/scanners.test.ts` covering the happy path, the error path, and any edge cases.

---

## Pull request checklist

- [ ] `pnpm test` passes locally
- [ ] New behaviour is covered by tests
- [ ] `pnpm build` produces a clean bundle with no TypeScript errors
- [ ] PR description explains *why* the change is needed, not just *what* it does

---

## Reporting a bug

Please [open an issue](https://github.com/RohitIndurke/RunCheck/issues) and include:

- RunCheck version: `npx runcheck --version`
- Node version and OS
- The exact command you ran
- Full output (or `--json` output if the terminal is garbled)

---

## Code of conduct

Be kind. Disagreement is fine; disrespect is not.
