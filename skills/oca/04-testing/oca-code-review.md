# OCA Code Review

Complete code review combining compliance + patterns + improvements.

## Review Steps

1. Run `oca-compliance-check`
2. Run `oca-pattern-match` for similar code
3. Run `oca-suggest-improve` for optimizations
4. Compile report

## Output Format

```
## 🔍 OCA Code Review

### Overview
- Module: {name}
- Files: {count}
- Score: {X}/100

### 🚨 Critical (Must Fix)
| File | Line | Issue | Fix |

### ⚠️ High (Should Fix)
| File | Line | Issue | Fix |

### 📊 Patterns Found
[From oca-pattern-match]

### 💡 Improvements
[From oca-suggest-improve]

### ✅ What's Good
- [Good practices found]

### 🛠️ Action Plan
1. Phase 1: Critical fixes
2. Phase 2: High priority
3. Phase 3: Improvements

### Verdict
Status: [Ready / Needs Work]
Can Merge: [Yes / After fixes]
```
