# Code Smell Baseline (shared — readability lens)

A fixed set of Fowler code smells (Refactoring, ch.3) that applies to EVERY
readability review, even when the project documents no coding standard.
Two binding rules:

1. **The repo overrides.** A documented repo standard always wins; where it
   endorses something the baseline would flag, suppress the smell.
2. **Skip what tooling enforces.** If pre-commit/linters already catch it,
   don't report it here.

Each smell reads *what it is* → *how to fix*. Match it against the diff;
each finding is a labelled heuristic ("possible Feature Envy"), never a hard
violation.

| Smell | What it is | How to fix |
|---|---|---|
| Mysterious Name | A function, variable, or type whose name doesn't reveal what it does or holds | Rename; if no honest name comes, the design is murky |
| Long Parameter List | More than ~3-4 parameters, or params that travel together | Extract a parameter object; group the data that belongs together |
| Long Function | A function doing several jobs (hard to name, needs a comment to explain) | Extract until each function has one obvious name |
| Feature Envy | A method that talks more to another class's data than its own | Move the method (or extract the part that envies) to the data owner |
| Duplicated Code | Same structure repeated in two places | Extract; the duplicate is the shared abstraction's name |
| Primitive Obsession | Using primitives where a small type/record would carry meaning | Introduce a value object for the concept |
| Data Clumps | The same 2-3 fields always travel together | Extract the clump into one object |
| Switch Statements / Type Tests | Repeated type dispatch that must grow with each new type | Replace with polymorphism or a registry |
| Speculative Generality | An abstraction with no current second user | Delete it; let the second user arrive before the abstraction |
| Dead Code | Unused params, functions, branches, or imports | Delete |
| Message Chains | `a.getB().getC().getD()` — a client coupled to the whole path | Hide the intermediate; expose only what the client needs |
| Middle Man | A class that does nothing but delegate | Remove the layer or collapse it |

## Judgment Day / lens usage

The readability lens (R2) reports findings as
`[smell] file:line — what → fix`, grouped by file, only for lines in the
candidate diff. Pre-existing smells on untouched lines are follow-ups, not
blockers.
