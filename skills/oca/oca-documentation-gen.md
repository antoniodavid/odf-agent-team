# OCA Documentation Generator

Generate OCA-compliant documentation for modules.

## Files to Generate

| File | Purpose |
|------|---------|
| `README.md` | Overview, install, usage |
| `DESCRIPTION.rst` | PyPI description |
| `USAGE.rst` | User guide |
| `CONTRIBUTORS.rst` | Contributors list |
| `HISTORY.rst` | Changelog |

## README.md Template

```markdown
# Module Name

Brief description.

## Features
- Feature 1
- Feature 2

## Installation
1. Copy to addons
2. Update module list
3. Install

## Configuration
Settings > ...

## Usage
1. Go to Menu > ...
2. Click New
3. Fill form

## Credits
### Contributors
* Name <email>

### Maintainer
Maintained by OCA.

## License
LGPL-3
```

## OCA Standards

- README.md: Features, Install, Config, Usage, Credits, License
- DESCRIPTION.rst: reStructuredText format
- USAGE.rst: Step-by-step user guide
- Docstrings on all public methods
