# OCA Repository Policy

Complete guide to OCA repository structure, governance, and policies for maintaining quality, stable, and relevant addon modules.

## OCA Mission

**OCA aims to provide a reference business feature library.**

This is achieved through:
- Quality addon modules
- Stable and relevant features
- Community collaboration
- Peer review process

## Quality Goals

### Automated Checks

All modules must pass automated CI checks:
- Code linting (flake8, ESLint)
- Python/JS compilation
- Test execution
- Documentation generation

### Peer Review

Code must be peer reviewed:
- Ensures quality
- Catches bugs and design issues
- Distributes knowledge
- "Given enough eyeballs, all bugs are shallow"

## Stability Policy

### API Stability

OCA follows an **API stable** policy similar to Odoo:

```
✅ ADDITIONS ALLOWED:
- New optional fields
- New methods with default parameters
- New optional parameters
- Bug fixes
- Performance improvements

❌ BREAKING CHANGES PROHIBITED:
- Renaming fields
- Changing method signatures
- Modifying existing behavior
- Removing fields or methods
- Changing default values
```

### For Breaking Changes

If you need breaking changes:

1. Increment the major version (e.g., 1.0.0 → 2.0.0)
2. Provide migration script
3. Document breaking changes clearly
4. Consider if the change is truly necessary

### Rationale

Stable modules are used in production by many companies. Breaking changes cause:
- Migration effort for users
- Potential data loss
- Integration breakage
- Loss of trust

## Relevance Curation

### Why It Matters

OCA aims to be the **reference implementation** for each business feature:
- One module per problem/need
- Best implementation wins
- Avoids fragmentation
- Helps users choose

### Maintainer Curation

Maintainers ensure modules are:

1. **Generic enough** - Useful beyond single implementation
2. **Not overlapping** - No duplicate functionality
3. **Actively maintained** - Responds to issues/PRs
4. **Well documented** - Users can understand and use

### Rejecting Modules

Modules may be rejected if:
- Too specific to one use case
- Duplicating existing stable module
- Not following OCA conventions
- Low quality or unmaintained

## Repository Structure

### Naming Conventions

| Repository Type | Pattern | Example |
|----------------|---------|---------|
| Vertical/Functional | `project-*, stock-*, sale-*` | `project`, `stock-logistics` |
| Localization | `l10n-*` | `l10n-spain`, `l10n-latam` |
| Connector | `connector-*` | `connector-magento`, `connector-amazon` |

### Forbidden Names

- Names containing `odoo` or `openerp`
- Names already taken by other repositories
- Generic names that don't describe purpose

### Team Names

For GitHub teams:
- No `odoo` or `openerp` in names
- Localization: "Country Maintainers" (e.g., "Belgium Maintainers")

## Branch Configuration

### Standard Branches

Each repository maintains branches for supported Odoo versions:
- `16.0`
- `17.0`
- `18.0`
- etc.

### Version Compatibility

| Module Version | Odoo Version |
|---------------|--------------|
| 16.0.x.x | Odoo 16.0 |
| 17.0.x.x | Odoo 17.0 |
| 18.0.x.x | Odoo 18.0 |

### Branch Naming

Branches follow Odoo version numbers:
```
16.0
17.0
18.0
```

## Dependencies

### Within OCA

OCA modules can depend on each other:
```
sale_workflow
    └── sale
    └── stock
```

### External Dependencies

Declare in `requirements.txt`:
```text
# OCA dependencies
sale-workflow

# External dependencies
python-barcode>=0.13
```

### Circular Dependencies

Avoid circular dependencies between modules:
- A depends on B
- B depends on A

This causes installation and upgrade issues.

## Incubation Concept

### Purpose

Incubation lowers barriers for new contributors:
- Easier entry for new modules
- Iterative development
- Community improvement
- Gradual quality improvement

### Incubation Repositories

New contributors can:
1. Start with Alpha/Beta status
2. Improve iteratively
3. Get reviews from community
4. Progress toward Stable

### Migration to Stable

Incubated modules can become Stable when:
- CI passes consistently
- Peer reviews obtained
- Documentation complete
- Community demand exists

## Contributing New Features

### From Scratch (OCA-Native)

For modules created with OCA in mind:

1. **Check existing modules** - Avoid overlap
2. **Create RFC Issue** - Discuss design upfront
3. **Get early feedback** - Before implementing
4. **Follow guidelines** - OCA conventions
5. **Submit PR** - With complete implementation

### From Outside OCA

For modules created outside OCA:

**May require significant adaptation:**
- Pass code lint checks
- Adapt to OCA naming conventions
- Change technical name if needed
- Address overlap concerns
- Demonstrate quality

**The process is harder** because:
- Original assumptions may not fit
- Technical name may need changes
- May conflict with existing modules
- Less community context

## Module Creation Economics

### Why People Create Modules

Modules are created when:
- Someone funds the work (employer/customer)
- Specific requirements need addressing
- Generic features emerge from specific implementations
- Personal interest or learning

### The Challenge

Initial development is often:
- Focused on specific requirements
- Company/customer-specific
- Not generalized for community

### Making It OCA-Ready

Separation needed:
1. **Customer-specific** code → Separate module or custom
2. **Generic** features → OCA-ready module

This separation is often an afterthought, making contribution harder.

## Development Status Transition

### Lifecycle Flow

```
Alpha → Beta → Stable → Mature
  ↓       ↓       ↓        ↓
  WIP    Test   Prod    Prod+
```

### Promotion Requirements

See `oca-maturity-levels.md` for detailed requirements for each level.

## Repository Size Management

### Why Repositories Stay Manageable

OCA keeps repositories at manageable size by:
- Splitting large repos when needed
- Grouping by functional area
- Creating focused sub-topics
- Maintaining clear boundaries

### Split Example

`OCA/project` was split into:
- `OCA/project`
- `OCA/contract`
- `OCA/project-agile`

This made each more maintainable and focused.

## Governance

### Project Steering Committee (PSC)

Each repository has a PSC responsible for:
- Setting direction
- Maintaining quality
- Merging PRs
- Resolving disputes
- Ensuring continuity

### PSC Composition

PSC members:
- Are elected per repository
- Represent functional area
- Have merge rights
- Coordinate maintainers

### Decision Making

For significant decisions:
1. PSC discussion
2. Community input
3. Consensus preferred
4. Vote if needed

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-contributing-guide.md` | Contributing guidelines |
| `oca-pr-workflow.md` | PR submission workflow |
| `oca-maturity-levels.md` | Development status levels |
| `oca-maintainer-role.md` | Maintainer responsibilities |
| `oca-lookup-guideline.md` | Quick reference |
