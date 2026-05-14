# OCA Maintainer Role

Complete guide to the maintainer role in OCA repositories, responsibilities, and how to become or remove a maintainer.

## Overview

A **Maintainer** is responsible for coordinating specific addon modules to ensure quality and consistency of contributions. Maintainers are typically members of the Project Steering Committee (PSC) for their repository.

## Maintainer vs PSC

| Role | Scope | Responsibilities |
|------|-------|------------------|
| **Maintainer** | Specific module(s) | Day-to-day coordination of their modules |
| **PSC Member** | Entire repository | Project oversight, governance, merge rights |

PSC members can maintain specific modules, but not all repository maintainers are PSC members.

## Responsibilities

### 1. Communication

Ensure that discussions and reviews don't stall:

- Respond to PR comments in a timely manner
- Ping involved people for next steps when communication stops
- Keep the community informed of module status
- Coordinate between contributors

### 2. Control

Do final checks and merge approved pull requests:

- Verify PR meets all requirements
- Ensure CI passes
- Check for proper review coverage
- Merge when all criteria met
- Bump version numbers during or after merge

### 3. Versioning

Manage version numbers across branches:

- Bump version during merge or immediately after
- Follow semantic versioning (X.Y.Z.W format)
- For Mature modules, maintain HISTORY.rst changelog
- Coordinate version bumps across related modules

### 4. Support

Handle support requests and questions:

- Respond to issues related to the module
- Provide guidance to users
- Triage bug reports vs feature requests
- Redirect to appropriate channels when needed

### 5. Documentation

Document and manage the roadmap:

- Ensure README is accurate and complete
- Keep USAGE.rst up to date
- Maintain HISTORY.rst for Mature modules
- Track future improvement ideas
- Document known issues

### 6. Guidance

Keep an eye on related contributions:

- Help ensure functional consistency in OCA
- Merge new features in maintained modules
- Guide contributors toward new extension modules
- Foster innovation while maintaining quality

## Maintainer Privileges

### Write Access

Declared maintainers receive **write access** to the repository. However:

- Non-PSC maintainers should **not** merge PRs affecting other modules
- Focus on your maintained modules only
- Coordinate with PSC for cross-module changes

### Relaxed Code Review Rules

Maintainers may perform certain operations with relaxed review:

- Simple forward/backports
- Backports to stable versions
- Documentation improvements
- Cosmetic code improvements (linting)
- Version bumps

**Expectation**: Maintainers follow highest quality standards for these operations.

## Coordination Requirements

### Multiple Maintainers

If a module has more than one declared maintainer:

- Ensure good coordination between you
- Don't assume another maintainer will handle something
- Divide responsibilities clearly
- Respond even if "not your area"

### No Active Maintainer

Modules without declared maintainers:
- Managed by PSC members
- May have slower response times
- Community can propose becoming maintainer

## PSC Relationship

### When PSC Should Not Merge

PSC members should **not** merge PRs for modules with declared maintainers unless:
- The maintainer is unreactive
- The maintainer requests PSC intervention
- There's a governance issue

### When PSC Can Merge

PSC members can merge:
- Their own modules
- Modules without declared maintainers
- With maintainer approval for others
- Emergency fixes (with subsequent notification)

## Adding a Maintainer

### Via Manifest

Maintainers are declared in the `maintainers` key of `__manifest__.py`:

```python
{
    'name': 'My Module',
    'version': '17.0.1.0.0',
    'maintainers': ['github_username'],
}
```

### Process

1. Candidate proposes themselves via PR adding their GitHub login
2. PR reviewed by PSC
3. PSC approves and merges
4. Write access granted to maintainer

### Good Maintainer Candidates

- Active contributor to the module
- Understanding of the module's purpose
- Time available for maintenance
- Responsiveness to issues and PRs

## Removing a Maintainer

### Voluntary Removal

Maintainers who wish to stop maintaining a module:

1. Create PR removing themselves from `maintainers` key
2. Announce on contributors mailing list
3. Call for volunteers to take over

### Involuntary Removal

PSC may remove maintainers who:
- Don't follow OCA rules
- Fail to fulfill maintenance duties
- Are unresponsive for extended periods

This action is coordinated with the OCA board.

## No Maintainer Scenario

### What Happens

- Module becomes "unmaintained"
- PSC takes over management
- Community can propose becoming maintainer
- Module may eventually be archived if abandoned

### Proposing as Maintainer

To become maintainer of an unmaintained module:

1. Check if module is still relevant
2. Review current state and issues
3. Create PR adding yourself to `maintainers`
4. Include plan for addressing issues
5. PSC reviews and approves

## Maintaining Multiple Modules

### Large Repositories

In large repositories (server-tools, stock-logistics, etc.):
- PSC may not maintain all modules
- Individual maintainers adopt specific modules
- Helps distribute workload
- Improves response time

### Focus Areas

Good maintainers focus on:
- Modules they have expertise in
- Modules they actively use
- Modules with community demand
- Related modules (group by functionality)

## Best Practices

### For New Maintainers

1. **Read the module** - Understand what it does and how
2. **Check the issues** - Triage existing issues
3. **Review pending PRs** - Understand what's waiting
4. **Set expectations** - Let community know your availability
5. **Ask questions** - PSC can help with guidance

### Communication Tips

- Respond to new issues within a week
- Acknowledge PRs even if you can't review immediately
- Use labels to categorize issues
- Keep discussions on GitHub for visibility

### Code Review as Maintainer

When reviewing PRs:

1. **Be cordial** - Thank contributors
2. **Be specific** - Explain what's needed
3. **Be timely** - Don't let PRs stall
4. **Be consistent** - Apply same standards to everyone

## Emergency Procedures

### Security Issues

For security vulnerabilities:

1. **Don't** publicly disclose before fix
2. **Contact** OCA security team
3. **Prepare** fix as private PR if needed
4. **Coordinate** disclosure with OCA board

### Critical Bugs

For critical bugs affecting many users:

1. Assess impact
2. Create or prioritize fix
3. Fast-track review
4. Merge quickly
5. Consider backports

## Related Skills

| Skill | Purpose |
|-------|---------|
| `oca-contributing-guide.md` | Contributing guidelines |
| `oca-pr-workflow.md` | PR submission workflow |
| `oca-maturity-levels.md` | Development status levels |
| `oca-repository-policy.md` | Repository policies |
| `oca-lookup-guideline.md` | Quick reference |
